import assert from "node:assert/strict";
import test from "node:test";

import { UserProfile } from "@voicepractice/shared";

import { createUserEmployeeIdClaimStore } from "./userEmployeeIdClaimStore.js";

function buildUser(overrides: Partial<UserProfile>): UserProfile {
  return {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user@example.com",
    employeeId: overrides.employeeId ?? null,
    emailVerifiedAt: overrides.emailVerifiedAt ?? "2026-07-25T00:00:00.000Z",
    isPlatformAdmin: overrides.isPlatformAdmin ?? false,
    isSuperUser: overrides.isSuperUser ?? false,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? false,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: overrides.orgId ?? "org_1",
    orgRole: overrides.orgRole ?? "user",
    divisionId: overrides.divisionId ?? null,
    timezone: overrides.timezone ?? "UTC",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? "2026-07-25T00:00:00.000Z",
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-25T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-25T00:00:00.000Z",
  };
}

test("postgres Employee ID claim store initializes idempotently and syncs org-scoped claims", async () => {
  const poolQueries: string[] = [];
  const clientQueries: Array<{ text: string; values?: readonly unknown[] }> = [];
  let releaseCount = 0;
  const queryPool = {
    async query(text: string) {
      poolQueries.push(text);
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        async query(text: string, values?: readonly unknown[]) {
          clientQueries.push({ text, values });
          return { rows: [], rowCount: 0 };
        },
        release() {
          releaseCount += 1;
        },
      };
    },
  };

  const store = createUserEmployeeIdClaimStore({
    provider: "postgres",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });

  await store.initialize();
  await store.initialize();
  await store.syncFromUsers([
    buildUser({ id: "user_a", orgId: "org_1", employeeId: "EMP-1" }),
    buildUser({ id: "user_b", orgId: "org_2", employeeId: "EMP-1" }),
    buildUser({ id: "user_blank", orgId: "org_1", employeeId: null }),
    buildUser({ id: "user_individual", accountType: "individual", orgId: null, employeeId: "EMP-2" }),
  ]);

  assert.equal(poolQueries.length, 1);
  assert.match(poolQueries[0], /CREATE TABLE IF NOT EXISTS user_employee_id_claims/);
  assert.match(poolQueries[0], /CREATE UNIQUE INDEX IF NOT EXISTS user_employee_id_claims_org_employee_id_unique_idx/);
  assert.equal(clientQueries[0]?.text, "BEGIN");
  assert.equal(clientQueries[1]?.text, "LOCK TABLE user_employee_id_claims IN SHARE ROW EXCLUSIVE MODE");
  assert.equal(clientQueries[2]?.text, "DELETE FROM user_employee_id_claims");
  const inserts = clientQueries.filter((query) => query.text.includes("INSERT INTO user_employee_id_claims"));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map((query) => query.values), [
    ["user_a", "org_1", "EMP-1", "emp-1"],
    ["user_b", "org_2", "EMP-1", "emp-1"],
  ]);
  assert.equal(clientQueries.at(-1)?.text, "COMMIT");
  assert.equal(releaseCount, 1);
});

test("concurrent postgres Employee ID claim syncs serialize before replacing claims", async () => {
  const storedUserIds = new Set<string>();
  let syncLockTail = Promise.resolve();
  let lockQueryCount = 0;
  let unprotectedDeleteCount = 0;
  let releaseUnprotectedDeletes: (() => void) | null = null;
  let primaryKeyViolationCount = 0;
  const unprotectedDeletesReady = new Promise<void>((resolve) => {
    releaseUnprotectedDeletes = resolve;
  });

  const queryPool = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      let releaseSyncLock: (() => void) | null = null;

      const releaseHeldLock = () => {
        const release = releaseSyncLock;
        releaseSyncLock = null;
        release?.();
      };

      return {
        async query(text: string, values?: readonly unknown[]) {
          const normalizedSql = text.replace(/\s+/g, " ").trim();
          if (normalizedSql === "BEGIN") {
            return { rows: [], rowCount: 0 };
          }
          if (normalizedSql === "LOCK TABLE user_employee_id_claims IN SHARE ROW EXCLUSIVE MODE") {
            lockQueryCount += 1;
            const previousLock = syncLockTail;
            syncLockTail = new Promise<void>((resolve) => {
              releaseSyncLock = resolve;
            });
            await previousLock;
            return { rows: [], rowCount: 0 };
          }
          if (normalizedSql === "DELETE FROM user_employee_id_claims") {
            if (releaseSyncLock) {
              storedUserIds.clear();
            } else {
              unprotectedDeleteCount += 1;
              if (unprotectedDeleteCount === 2) {
                releaseUnprotectedDeletes?.();
              }
              await unprotectedDeletesReady;
            }
            return { rows: [], rowCount: 0 };
          }
          if (normalizedSql.startsWith("INSERT INTO user_employee_id_claims")) {
            const userId = String(values?.[0] ?? "");
            if (storedUserIds.has(userId)) {
              primaryKeyViolationCount += 1;
              throw Object.assign(
                new Error('duplicate key value violates unique constraint "user_employee_id_claims_pkey"'),
                {
                  code: "23505",
                  constraint: "user_employee_id_claims_pkey",
                }
              );
            }
            storedUserIds.add(userId);
            return { rows: [], rowCount: 1 };
          }
          if (normalizedSql === "COMMIT" || normalizedSql === "ROLLBACK") {
            releaseHeldLock();
            return { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected SQL in concurrent claim-sync test: ${normalizedSql}`);
        },
        release() {
          releaseHeldLock();
        },
      };
    },
  };

  const createStore = () => createUserEmployeeIdClaimStore({
    provider: "postgres",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 2,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });
  const users = [buildUser({ id: "user_a", orgId: "org_1", employeeId: "EMP-1" })];

  await Promise.all([
    createStore().syncFromUsers(users),
    createStore().syncFromUsers(users),
  ]);

  assert.equal(lockQueryCount, 2);
  assert.equal(primaryKeyViolationCount, 0);
  assert.deepEqual([...storedUserIds], ["user_a"]);
});
