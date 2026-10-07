import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDatabase, AuditEvent, UserProfile, WebAuthSessionRecord } from "@voicepractice/shared";
import type { AppStateTransactionClient, DatabaseStorage } from "../storage.js";
import type { AuditEventStore } from "../storage/auditEventStore.js";
import type { UserEmployeeIdClaimStore } from "../storage/userEmployeeIdClaimStore.js";
import type { WebAuthSessionStore } from "../storage/webAuthSessionStore.js";
import { commitAuthoritativeAppState } from "./authoritativeAppStateCommit.js";

function user(status: UserProfile["status"]): UserProfile {
  return {
    id: "user_1", email: "user@example.test", emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    status, accountType: "enterprise", orgId: "org_1", orgRole: "user_admin",
    dashboardAccessEnabled: true,
  } as UserProfile;
}

function db(status: UserProfile["status"]): ApiDatabase {
  return { users: [user(status)], orgs: [{ id: "org_1", status: "active" }] } as ApiDatabase;
}

const auditEvent: AuditEvent = {
  id: "audit_1", actorType: "web_user", actorId: "admin", action: "org_user.deactivated",
  orgId: "org_1", userId: "user_1", message: "Disabled user.", metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

type Failure = "claims" | "sessions" | "session_create" | "audit" | "sidewrite" | "save" | "commit" | null;
function harness(
  failure: Failure = null,
  fileMode = false,
  initialStatus: UserProfile["status"] = "active",
  initialOrgStatus: "active" | "disabled" = "active",
  options?: { initialDb?: ApiDatabase; auditEvent?: AuditEvent; newWebSessions?: WebAuthSessionRecord[] },
) {
  type Durable = { appState: ApiDatabase; sessions: string[]; audits: AuditEvent[]; claims: string[]; notifications: string[] };
  const initialDb = options?.initialDb ?? db(initialStatus);
  (initialDb.orgs[0] as { status: string }).status = initialOrgStatus;
  let durable: Durable = { appState: initialDb, sessions: ["user_1"], audits: [], claims: [], notifications: [] };
  let staged: Durable | null = null;
  let activeClient: AppStateTransactionClient | null = null;
  let cached: ApiDatabase | null = null;
  const client = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as AppStateTransactionClient;
  const checkClient = (received?: AppStateTransactionClient | null) => {
    assert.equal(received ?? null, fileMode ? null : activeClient);
    assert.ok(staged);
    return staged;
  };
  const storage: DatabaseStorage = {
    loadRaw: async () => durable.appState,
    load: async () => durable.appState,
    save: async (value, received) => {
      const target = checkClient(received);
      if (failure === "save") throw new Error("injected app_state save failure");
      target.appState = structuredClone(value);
    },
    updateAppStateWithLock: async () => { throw new Error("unused"); },
    runTransaction: async (callback) => {
      staged = structuredClone(durable);
      activeClient = fileMode ? null : client;
      try {
        const result = await callback(activeClient);
        if (failure === "commit") throw new Error("injected COMMIT failure");
        durable = staged;
        return result;
      } finally {
        staged = null;
        activeClient = null;
      }
    },
  };
  const claimStore = {
    syncFromUsers: async (users: readonly UserProfile[], received?: AppStateTransactionClient | null) => {
      const target = checkClient(received);
      if (failure === "claims") throw new Error("injected claim failure");
      target.claims = users.map((entry) => entry.id);
    },
  } as UserEmployeeIdClaimStore;
  const sessionStore = {
    revokeSessionsForUsers: async (ids: string[], received?: AppStateTransactionClient | null) => {
      const target = checkClient(received);
      if (failure === "sessions") throw new Error("injected session delete failure");
      target.sessions = target.sessions.filter((id) => !ids.includes(id));
      return ids.length;
    },
    saveSession: async (session: WebAuthSessionRecord, received?: AppStateTransactionClient | null) => {
      const target = checkClient(received);
      if (failure === "session_create") throw new Error("injected session create failure");
      target.sessions.push(session.userId);
    },
  } as WebAuthSessionStore;
  const auditStore = {
    appendEvents: async (events: AuditEvent[], options?: { client?: AppStateTransactionClient | null }) => {
      const target = checkClient(options?.client);
      if (failure === "audit") throw new Error("injected audit failure");
      target.audits.push(...events);
    },
  } as AuditEventStore;
  const commit = async (working = db("disabled")) => await commitAuthoritativeAppState({
    storage, claimStore, sessionStore, auditStore,
    before: structuredClone(durable.appState), working,
    auditEvents: [options?.auditEvent ?? auditEvent],
    newWebSessions: options?.newWebSessions,
    requiredTransactionSideWrites: [async (received) => {
      const target = checkClient(received);
      if (failure === "sidewrite") throw new Error("injected notification side-write failure");
      target.notifications.push("notification_1");
    }],
    buildPersistedSnapshot: (value) => value,
    onCommitted: (value) => { cached = value; },
  });
  return { commit, getDurable: () => durable, getCache: () => cached };
}

for (const failure of ["claims", "sessions", "audit", "sidewrite", "save", "commit"] as const) {
  test(`authoritative ${failure} failure rolls back state, session purge, audit, and cache publication`, async () => {
    const subject = harness(failure);
    await assert.rejects(subject.commit(), /injected/);
    assert.equal(subject.getDurable().appState.users[0]?.status, "active");
    assert.deepEqual(subject.getDurable().sessions, ["user_1"]);
    assert.deepEqual(subject.getDurable().audits, []);
    assert.deepEqual(subject.getDurable().notifications, []);
    assert.equal(subject.getCache(), null);
  });
}

test("successful privileged mutation commits one audit, revocation, and app_state before publishing cache", async () => {
  const subject = harness();
  await subject.commit();
  assert.equal(subject.getDurable().appState.users[0]?.status, "disabled");
  assert.deepEqual(subject.getDurable().sessions, []);
  assert.deepEqual(subject.getDurable().audits.map((event) => event.id), ["audit_1"]);
  assert.deepEqual(subject.getDurable().notifications, ["notification_1"]);
  assert.equal(subject.getCache()?.users[0]?.status, "disabled");
});

test("re-activation also purges an old web session before commit", async () => {
  const subject = harness(null, false, "disabled");
  await subject.commit(db("active"));
  assert.deepEqual(subject.getDurable().sessions, []);
});

test("organization re-enable also purges an old web session before commit", async () => {
  const subject = harness(null, false, "active", "disabled");
  await subject.commit(db("active"));
  assert.deepEqual(subject.getDurable().sessions, []);
});

test("file-mode authoritative side-write failure does not save or publish app_state", async () => {
  const subject = harness("sessions", true);
  await assert.rejects(subject.commit(), /session delete failure/);
  assert.equal(subject.getDurable().appState.users[0]?.status, "active");
  assert.equal(subject.getCache(), null);
});

test("join approval commits membership, request transition, and exactly one governance audit together", async () => {
  const initial = db("active");
  initial.users[0] = {
    ...initial.users[0]!, accountType: "individual", orgId: null,
    orgRole: "user", dashboardAccessEnabled: false,
  } as UserProfile;
  initial.enterpriseJoinRequests = [{
    id: "join_1", userId: "user_1", orgId: "org_1", status: "pending",
  } as unknown as ApiDatabase["enterpriseJoinRequests"][number]];
  const approved = structuredClone(initial);
  approved.users[0] = {
    ...approved.users[0]!, accountType: "enterprise", orgId: "org_1",
    orgRole: "user", dashboardAccessEnabled: false,
  } as UserProfile;
  approved.enterpriseJoinRequests[0]!.status = "approved";
  const approvalAudit: AuditEvent = {
    ...auditEvent, action: "org_join.approved_by_dashboard_admin", metadata: { requestId: "join_1" },
  };

  const failed = harness("save", false, "active", "active", { initialDb: initial, auditEvent: approvalAudit });
  await assert.rejects(failed.commit(approved), /injected app_state save failure/);
  assert.equal(failed.getDurable().appState.users[0]?.orgId, null);
  assert.equal(failed.getDurable().appState.enterpriseJoinRequests[0]?.status, "pending");
  assert.deepEqual(failed.getDurable().audits, []);
  assert.equal(failed.getCache(), null);

  const successful = harness(null, false, "active", "active", { initialDb: initial, auditEvent: approvalAudit });
  await successful.commit(approved);
  assert.equal(successful.getDurable().appState.users[0]?.orgId, "org_1");
  assert.equal(successful.getDurable().appState.enterpriseJoinRequests[0]?.status, "approved");
  assert.deepEqual(successful.getDurable().audits.map((event) => event.action), ["org_join.approved_by_dashboard_admin"]);
});

test("new web sign-in session and its audit cannot survive a failed app_state transaction", async () => {
  const newSession = { sessionId: "new_session", userId: "user_1" } as WebAuthSessionRecord;
  const failure = harness("save", false, "active", "active", { newWebSessions: [newSession] });
  await assert.rejects(failure.commit(db("active")), /injected app_state save failure/);
  assert.deepEqual(failure.getDurable().sessions, ["user_1"]);
  assert.deepEqual(failure.getDurable().audits, []);
  assert.equal(failure.getCache(), null);

  const insertionFailure = harness("session_create", false, "active", "active", { newWebSessions: [newSession] });
  await assert.rejects(insertionFailure.commit(db("active")), /injected session create failure/);
  assert.deepEqual(insertionFailure.getDurable().sessions, ["user_1"]);
  assert.deepEqual(insertionFailure.getDurable().audits, []);

  const success = harness(null, false, "active", "active", { newWebSessions: [newSession] });
  await success.commit(db("active"));
  assert.deepEqual(success.getDurable().sessions, ["user_1", "user_1"]);
  assert.deepEqual(success.getDurable().audits.map((event) => event.id), ["audit_1"]);
});
