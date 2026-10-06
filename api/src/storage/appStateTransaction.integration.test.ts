import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import type {
  ApiDatabase,
  AuditEvent,
  EnterpriseOrg,
  UserProfile,
  WebAuthSessionRecord,
} from "@voicepractice/shared";
import { Pool } from "pg";

import { commitAuthoritativeAppState } from "../services/authoritativeAppStateCommit.js";
import { createDatabaseStorage } from "../storage.js";
import { createAuditEventStore } from "./auditEventStore.js";
import { createUserEmployeeIdClaimStore } from "./userEmployeeIdClaimStore.js";
import { createWebAuthSessionStore } from "./webAuthSessionStore.js";

const databaseUrl = process.env.APP_STATE_INTEGRATION_DATABASE_URL?.trim() || "";
const allowNonLocal = process.env.APP_STATE_ALLOW_NON_LOCAL_INTEGRATION_TESTS === "true";

function assertSafeIntegrationDatabase(url: string): void {
  const normalized = url.toLowerCase();
  if (normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod")) {
    throw new Error("App-state PostgreSQL integration tests refuse production databases.");
  }
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").toLowerCase();
  if (!/(test|integration|throwaway)/.test(databaseName)) {
    throw new Error("App-state PostgreSQL integration tests require an explicitly named test database.");
  }
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  if (!isLocal && !allowNonLocal) {
    throw new Error(
      "Use a local throwaway PostgreSQL database or explicitly set APP_STATE_ALLOW_NON_LOCAL_INTEGRATION_TESTS=true.",
    );
  }
}

function scopedDatabaseUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

const now = "2026-10-06T12:00:00.000Z";

function buildUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user_1",
    email: "user-1@app-state-integration.test",
    employeeId: "EMP-001",
    emailVerifiedAt: now,
    dashboardAccessEnabled: true,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user_admin",
    performanceAccess: "team",
    timezone: "UTC",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: now,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildOrg(): EnterpriseOrg {
  return {
    id: "org_1",
    name: "Integration Organization",
    status: "active",
    contactName: "Integration Owner",
    contactEmail: "owner@app-state-integration.test",
    emailDomain: null,
    joinCode: "INTEGRATION",
    activeIndustries: [],
    dailySecondsQuota: 3600,
    perUserDailySecondsCap: 1800,
    pendingPerUserDailySecondsCap: null,
    pendingPerUserDailySecondsCapEffectiveAt: null,
    manualBonusSeconds: 0,
    contractSignedAt: now,
    monthlyMinutesAllotted: 100,
    renewalTotalUsd: 0,
    softLimitPercentTriggers: [80, 100],
    maxSimulationMinutes: 20,
    createdAt: now,
    updatedAt: now,
  };
}

function buildState(user = buildUser()): ApiDatabase {
  return { users: [user], orgs: [buildOrg()] } as unknown as ApiDatabase;
}

function buildSession(): WebAuthSessionRecord {
  return {
    sessionId: "session_user_1",
    userId: "user_1",
    accessType: "customer_dashboard_user",
    orgId: "org_1",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    expiresAt: "2027-10-06T12:00:00.000Z",
    createdUserAgent: "integration-test",
    lastSeenUserAgent: "integration-test",
    createdIp: "127.0.0.1",
    lastSeenIp: "127.0.0.1",
  };
}

function buildAudit(id: string, action = "user.disabled", createdAt = now): AuditEvent {
  return {
    id,
    actorType: "platform_admin",
    actorId: "integration_test",
    action,
    orgId: "org_1",
    userId: "user_1",
    message: "Integration governance event.",
    metadata: { source: "app_state_transaction_integration" },
    createdAt,
  };
}

test(
  "real PostgreSQL commits and rolls back authoritative app-state side-writes atomically",
  { skip: !databaseUrl },
  async (t) => {
    assertSafeIntegrationDatabase(databaseUrl);
    const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const schema = `app_state_tx_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    const pools: Pool[] = [];
    try {
      await setupPool.query(`CREATE SCHEMA ${quotedSchema}`);
      const scopedUrl = scopedDatabaseUrl(databaseUrl, schema);
      const createPool = () => {
        const pool = new Pool({
          connectionString: scopedUrl,
          max: 2,
          connectionTimeoutMillis: 15_000,
          idleTimeoutMillis: 10_000,
        });
        pools.push(pool);
        return pool;
      };
      const statePool = createPool();
      const claimPool = createPool();
      const sessionPool = createPool();
      const auditPool = createPool();
      const verificationPool = createPool();
      const storeOptions = {
        provider: "postgres" as const,
        dbPath: "unused",
        databaseUrl: scopedUrl,
        pgPoolMax: 2,
        pgConnectTimeoutMs: 15_000,
        pgIdleTimeoutMs: 10_000,
      };
      const storage = createDatabaseStorage({
        ...storeOptions,
        ensureDatabaseShape: (candidate) => candidate as ApiDatabase,
        createDefaultDatabase: () => buildState(),
        queryPool: statePool,
      });
      const claimStore = createUserEmployeeIdClaimStore({ ...storeOptions, queryPool: claimPool });
      const sessionStore = createWebAuthSessionStore({ ...storeOptions, queryPool: sessionPool });
      const auditStore = createAuditEventStore({ ...storeOptions, queryPool: auditPool });

      await storage.load();
      await claimStore.initialize();
      await sessionStore.initialize();
      await auditStore.initialize();

      const seed = async () => {
        await verificationPool.query(
          "TRUNCATE TABLE app_state, user_employee_id_claims, web_auth_sessions, audit_events",
        );
        const initial = buildState();
        await storage.save(initial);
        await claimStore.syncFromUsers(initial.users);
        await sessionStore.saveSession(buildSession());
        return initial;
      };

      const commitDisabledUser = async (
        before: ApiDatabase,
        options?: { beforeAppStateSave?: () => Promise<void>; onCommitted?: () => void },
      ) => {
        const working = structuredClone(before);
        working.users[0]!.status = "disabled";
        await commitAuthoritativeAppState({
          storage,
          claimStore,
          sessionStore,
          auditStore,
          before,
          working,
          auditEvents: [buildAudit("audit_disable")],
          buildPersistedSnapshot: (value) => value,
          beforeAppStateSave: options?.beforeAppStateSave,
          onCommitted: () => options?.onCommitted?.(),
        });
      };

      await t.test("successful commit persists state, claim, revocation, audit, and one cache publication", async () => {
        const before = await seed();
        let committedCount = 0;
        await commitDisabledUser(before, { onCommitted: () => { committedCount += 1; } });

        const persisted = await verificationPool.query<{ state_json: ApiDatabase }>(
          "SELECT state_json FROM app_state WHERE id = 'primary'",
        );
        assert.equal(persisted.rows[0]?.state_json.users[0]?.status, "disabled");
        assert.equal((await verificationPool.query("SELECT 1 FROM web_auth_sessions WHERE user_id = 'user_1'")).rowCount, 0);
        assert.equal((await verificationPool.query("SELECT 1 FROM audit_events WHERE id = 'audit_disable'")).rowCount, 1);
        const claim = await verificationPool.query<{ employee_id: string; employee_id_normalized: string }>(
          "SELECT employee_id, employee_id_normalized FROM user_employee_id_claims WHERE user_id = 'user_1'",
        );
        assert.deepEqual(claim.rows, [{ employee_id: "EMP-001", employee_id_normalized: "emp-001" }]);
        assert.equal(committedCount, 1);
      });

      await t.test("failure before app_state persistence rolls every authoritative side-write back", async () => {
        const before = await seed();
        const working = structuredClone(before);
        working.users[0]!.status = "disabled";
        working.users[0]!.employeeId = "EMP-CHANGED";
        let committedCount = 0;
        await assert.rejects(
          commitAuthoritativeAppState({
            storage,
            claimStore,
            sessionStore,
            auditStore,
            before,
            working,
            auditEvents: [buildAudit("audit_failed_disable")],
            buildPersistedSnapshot: (value) => value,
            beforeAppStateSave: async () => { throw new Error("injected pre-save failure"); },
            onCommitted: () => { committedCount += 1; },
          }),
          /injected pre-save failure/,
        );

        const persisted = await verificationPool.query<{ state_json: ApiDatabase }>(
          "SELECT state_json FROM app_state WHERE id = 'primary'",
        );
        assert.equal(persisted.rows[0]?.state_json.users[0]?.status, "active");
        assert.equal(persisted.rows[0]?.state_json.users[0]?.employeeId, "EMP-001");
        assert.equal((await verificationPool.query("SELECT 1 FROM web_auth_sessions WHERE user_id = 'user_1'")).rowCount, 1);
        assert.equal((await verificationPool.query("SELECT 1 FROM audit_events WHERE id = 'audit_failed_disable'")).rowCount, 0);
        const claim = await verificationPool.query<{ employee_id: string; employee_id_normalized: string }>(
          "SELECT employee_id, employee_id_normalized FROM user_employee_id_claims WHERE user_id = 'user_1'",
        );
        assert.deepEqual(claim.rows, [{ employee_id: "EMP-001", employee_id_normalized: "emp-001" }]);
        assert.equal(committedCount, 0);
      });

      await t.test("revoked session cannot be recreated by the real UPDATE-only touch path", async () => {
        const before = await seed();
        await commitDisabledUser(before);
        assert.equal(await sessionStore.touchSessionIfPresent(buildSession()), false);
        assert.equal((await verificationPool.query("SELECT 1 FROM web_auth_sessions WHERE user_id = 'user_1'")).rowCount, 0);
      });

      await t.test("real retention SQL trims only explicitly classified telemetry", async () => {
        await seed();
        await auditStore.appendEvents([
          buildAudit("telemetry_old", "ai.simulation.opening.details", "2026-10-01T00:00:00.000Z"),
          buildAudit("telemetry_middle", "ai.simulation.turn.details", "2026-10-02T00:00:00.000Z"),
          buildAudit("telemetry_new", "ai.simulation.score.details", "2026-10-03T00:00:00.000Z"),
          buildAudit("governance_known", "user.disabled", "2026-10-04T00:00:00.000Z"),
          buildAudit("governance_unknown", "future.unknown.governance", "2026-10-05T00:00:00.000Z"),
        ]);
        assert.equal(await auditStore.trimTelemetry(1), 2);
        const rows = await verificationPool.query<{ id: string }>("SELECT id FROM audit_events ORDER BY id");
        assert.deepEqual(rows.rows.map((row) => row.id), [
          "governance_known",
          "governance_unknown",
          "telemetry_new",
        ]);
      });
    } finally {
      await Promise.allSettled(pools.map(async (pool) => await pool.end()));
      try {
        await setupPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      } finally {
        await setupPool.end();
      }
    }
  },
);
