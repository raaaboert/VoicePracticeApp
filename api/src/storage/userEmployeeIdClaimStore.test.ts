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
  assert.equal(clientQueries[1]?.text, "DELETE FROM user_employee_id_claims");
  const inserts = clientQueries.filter((query) => query.text.includes("INSERT INTO user_employee_id_claims"));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map((query) => query.values), [
    ["user_a", "org_1", "EMP-1", "emp-1"],
    ["user_b", "org_2", "EMP-1", "emp-1"],
  ]);
  assert.equal(clientQueries.at(-1)?.text, "COMMIT");
  assert.equal(releaseCount, 1);
});
