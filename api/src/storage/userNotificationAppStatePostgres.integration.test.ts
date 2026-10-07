import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { ApiDatabase, AuditEvent, EnterpriseJoinRequestRecord, UserProfile } from "@voicepractice/shared";

import { commitAuthoritativeAppState } from "../services/authoritativeAppStateCommit.js";
import { buildAccessRequestNotificationInputs, resolveAccessRequestNotifications } from "../services/accessRequestNotifications.js";
import { createDatabaseStorage } from "../storage.js";
import { createAuditEventStore } from "./auditEventStore.js";
import { createUserEmployeeIdClaimStore } from "./userEmployeeIdClaimStore.js";
import { createUserNotificationStore } from "./userNotificationStore.js";
import { createWebAuthSessionStore } from "./webAuthSessionStore.js";

const databaseUrl = process.env.USER_NOTIFICATION_INTEGRATION_DATABASE_URL?.trim() ?? "";
const NOW = "2026-10-06T12:00:00.000Z";

function assertSafeDatabase(url: string): void {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").toLowerCase();
  assert.match(name, /(test|integration|throwaway)/);
  assert.doesNotMatch(url.toLowerCase(), /peritio[-_]db[-_]prod/);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase()));
}

function scopedUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

function user(id: string, orgRole: UserProfile["orgRole"], overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email: `${id}@integration.test`,
    employeeId: null,
    emailVerifiedAt: NOW,
    dashboardAccessEnabled: orgRole !== "user",
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole,
    performanceAccess: "none",
    timezone: "UTC",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: NOW,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function request(id: string): EnterpriseJoinRequestRecord {
  return {
    id,
    userId: "applicant",
    email: "applicant@integration.test",
    emailDomain: "integration.test",
    orgId: "org_1",
    orgNameSnapshot: "Integration Organization",
    joinCodeSnapshot: "JOIN123",
    status: "pending",
    createdAt: NOW,
    expiresAt: "2026-10-13T12:00:00.000Z",
    updatedAt: NOW,
    decidedAt: null,
    decidedByUserId: null,
    decisionReason: null,
  };
}

function state(requests: EnterpriseJoinRequestRecord[] = []): ApiDatabase {
  return {
    users: [
      user("org_admin", "org_admin"),
      user("user_admin", "user_admin"),
      user("regular", "user"),
      user("manager_only", "user"),
      user("manager_report", "user", { managerUserId: "manager_only" }),
      user("cross_org", "org_admin", { orgId: "org_2" }),
      user("inactive_admin", "org_admin", { status: "disabled" }),
      user("applicant", "user", { accountType: "individual", tier: "free", orgId: null, dashboardAccessEnabled: false }),
    ],
    orgs: [
      { id: "org_1", name: "Integration Organization", status: "active" },
      { id: "org_2", name: "Other Organization", status: "active" },
    ],
    enterpriseJoinRequests: requests,
  } as unknown as ApiDatabase;
}

function audit(id: string, requestId: string): AuditEvent {
  return {
    id,
    actorType: "web_user",
    actorId: "org_admin",
    action: "org_join.approved_by_dashboard_admin",
    orgId: "org_1",
    userId: "applicant",
    message: "Approved organization access request.",
    metadata: { requestId },
    createdAt: NOW,
  };
}

test("real PostgreSQL commits notification and app-state authority atomically", { skip: !databaseUrl }, async (t) => {
  assertSafeDatabase(databaseUrl);
  const setup = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `notification_tx_${randomBytes(8).toString("hex")}`;
  const quotedSchema = `"${schema}"`;
  const pools: Pool[] = [];
  try {
    await setup.query(`CREATE SCHEMA ${quotedSchema}`);
    const url = scopedUrl(databaseUrl, schema);
    const makePool = () => {
      const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000 });
      pools.push(pool);
      return pool;
    };
    const statePool = makePool();
    const auditPool = makePool();
    const claimPool = makePool();
    const sessionPool = makePool();
    const notificationPool = makePool();
    const verifyPool = makePool();
    const options = {
      provider: "postgres" as const,
      dbPath: "unused",
      databaseUrl: url,
      pgPoolMax: 3,
      pgConnectTimeoutMs: 15_000,
      pgIdleTimeoutMs: 10_000,
    };
    const storage = createDatabaseStorage({
      ...options,
      queryPool: statePool,
      ensureDatabaseShape: (candidate) => candidate as ApiDatabase,
      createDefaultDatabase: () => state(),
    });
    const auditStore = createAuditEventStore({ ...options, queryPool: auditPool });
    const claimStore = createUserEmployeeIdClaimStore({ ...options, queryPool: claimPool });
    const sessionStore = createWebAuthSessionStore({ ...options, queryPool: sessionPool });
    const notificationStore = createUserNotificationStore({ ...options, queryPool: notificationPool });
    await Promise.all([auditStore.initialize(), claimStore.initialize(), sessionStore.initialize(), notificationStore.initialize()]);
    let published: ApiDatabase | null = null;

    const reset = async (next: ApiDatabase) => {
      await storage.save(next);
      await verifyPool.query("TRUNCATE TABLE user_notifications, audit_events, user_employee_id_claims, web_auth_sessions");
      published = null;
    };
    const commit = async (before: ApiDatabase, working: ApiDatabase, params?: {
      auditEvents?: AuditEvent[];
      sideWrites?: Parameters<typeof commitAuthoritativeAppState>[0]["requiredTransactionSideWrites"];
      failBeforeSave?: boolean;
    }) => {
      await commitAuthoritativeAppState({
        storage,
        claimStore,
        sessionStore,
        auditStore,
        before,
        working,
        auditEvents: params?.auditEvents ?? [],
        requiredTransactionSideWrites: params?.sideWrites,
        beforeAppStateSave: params?.failBeforeSave ? async () => { throw new Error("injected authoritative failure"); } : undefined,
        buildPersistedSnapshot: (value) => value,
        onCommitted: (value) => { published = value; },
      });
    };

    await t.test("A request creation commits only intended recipient notifications", async () => {
      const before = state();
      await reset(before);
      const working = state([request("request_commit")]);
      const inputs = buildAccessRequestNotificationInputs({ db: working, request: working.enterpriseJoinRequests[0]! });
      await commit(before, working, {
        sideWrites: [async (client) => { await notificationStore.enqueueMany(inputs, { client }); }],
      });
      const persisted = await verifyPool.query<{ state_json: ApiDatabase }>("SELECT state_json FROM app_state WHERE id = 'primary'");
      assert.equal(persisted.rows[0]?.state_json.enterpriseJoinRequests[0]?.id, "request_commit");
      const recipients = await verifyPool.query<{ recipient_user_id: string }>("SELECT recipient_user_id FROM user_notifications ORDER BY recipient_user_id");
      assert.deepEqual(recipients.rows.map((row) => row.recipient_user_id), ["org_admin", "user_admin"]);
      assert.equal(published?.enterpriseJoinRequests[0]?.id, "request_commit");
    });

    await t.test("B notification failure rolls request, notifications, and cache publication back", async () => {
      const before = state();
      await reset(before);
      const working = state([request("request_notification_failure")]);
      const inputs = buildAccessRequestNotificationInputs({ db: working, request: working.enterpriseJoinRequests[0]! });
      await assert.rejects(commit(before, working, {
        sideWrites: [async (client) => {
          await notificationStore.enqueueMany(inputs, { client });
          throw new Error("injected notification failure");
        }],
      }), /injected notification failure/);
      assert.equal((await verifyPool.query("SELECT 1 FROM user_notifications")).rowCount, 0);
      const persisted = await verifyPool.query<{ state_json: ApiDatabase }>("SELECT state_json FROM app_state WHERE id = 'primary'");
      assert.equal(persisted.rows[0]?.state_json.enterpriseJoinRequests.length, 0);
      assert.equal(published, null);
    });

    await t.test("C decision commits state, governance audit, and all-recipient resolution", async () => {
      const pending = request("request_decision_commit");
      const before = state([pending]);
      await reset(before);
      await notificationStore.enqueueMany(buildAccessRequestNotificationInputs({ db: before, request: pending }));
      const working = structuredClone(before);
      working.enterpriseJoinRequests[0]!.status = "approved";
      working.enterpriseJoinRequests[0]!.decidedAt = NOW;
      await commit(before, working, {
        auditEvents: [audit("audit_decision_commit", pending.id)],
        sideWrites: [async (client) => {
          await resolveAccessRequestNotifications({ store: notificationStore, requestIds: [pending.id], resolution: "approved", client });
        }],
      });
      const persisted = await verifyPool.query<{ state_json: ApiDatabase }>("SELECT state_json FROM app_state WHERE id = 'primary'");
      assert.equal(persisted.rows[0]?.state_json.enterpriseJoinRequests[0]?.status, "approved");
      assert.equal((await verifyPool.query("SELECT 1 FROM audit_events WHERE id = 'audit_decision_commit'")).rowCount, 1);
      assert.equal((await verifyPool.query("SELECT 1 FROM user_notifications WHERE resolved_at IS NOT NULL AND resolution = 'approved'")).rowCount, 2);
    });

    await t.test("D decision failure rolls state, audit, and notification resolution back", async () => {
      const pending = request("request_decision_failure");
      const before = state([pending]);
      await reset(before);
      await notificationStore.enqueueMany(buildAccessRequestNotificationInputs({ db: before, request: pending }));
      const working = structuredClone(before);
      working.enterpriseJoinRequests[0]!.status = "approved";
      await assert.rejects(commit(before, working, {
        auditEvents: [audit("audit_decision_failure", pending.id)],
        sideWrites: [async (client) => {
          await resolveAccessRequestNotifications({ store: notificationStore, requestIds: [pending.id], resolution: "approved", client });
        }],
        failBeforeSave: true,
      }), /injected authoritative failure/);
      const persisted = await verifyPool.query<{ state_json: ApiDatabase }>("SELECT state_json FROM app_state WHERE id = 'primary'");
      assert.equal(persisted.rows[0]?.state_json.enterpriseJoinRequests[0]?.status, "pending");
      assert.equal((await verifyPool.query("SELECT 1 FROM audit_events WHERE id = 'audit_decision_failure'")).rowCount, 0);
      assert.equal((await verifyPool.query("SELECT 1 FROM user_notifications WHERE resolved_at IS NOT NULL")).rowCount, 0);
      assert.equal(published, null);
    });

    await t.test("E retrying an equivalent enqueue keeps one row per recipient dedup key", async () => {
      const pending = request("request_dedup");
      const source = state([pending]);
      await reset(source);
      const inputs = buildAccessRequestNotificationInputs({ db: source, request: pending });
      await notificationStore.enqueueMany(inputs);
      await notificationStore.enqueueMany(inputs);
      const counts = await verifyPool.query<{ recipient_user_id: string; count: string }>(
        "SELECT recipient_user_id, COUNT(*)::text AS count FROM user_notifications GROUP BY recipient_user_id ORDER BY recipient_user_id",
      );
      assert.deepEqual(counts.rows, [
        { recipient_user_id: "org_admin", count: "1" },
        { recipient_user_id: "user_admin", count: "1" },
      ]);
    });
  } finally {
    await Promise.allSettled(pools.map(async (pool) => await pool.end()));
    try { await setup.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`); } finally { await setup.end(); }
  }
});
