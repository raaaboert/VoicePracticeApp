import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDatabase, EnterpriseJoinRequestRecord, UserProfile } from "@voicepractice/shared";

import { createMemoryUserNotificationStoreForTest } from "../storage/userNotificationStore.js";
import type { FocusTopicAuthoritySnapshot } from "../storage/focusTopicAuthorityStore.js";
import {
  buildAccessRequestNotificationInputs,
  listAuthorizedDashboardNotifications,
  markAuthorizedDashboardNotificationRead,
  resolveAccessRequestNotifications,
} from "./accessRequestNotifications.js";
import { TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE } from "./topicAssignedNotifications.js";

const NOW = "2026-10-06T12:00:00.000Z";

function user(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email: `${id}@example.test`,
    firstName: "Test",
    lastName: "User",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
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

function request(overrides: Partial<EnterpriseJoinRequestRecord> = {}): EnterpriseJoinRequestRecord {
  return {
    id: "request_1",
    userId: "applicant",
    email: "applicant@example.test",
    emailDomain: "example.test",
    orgId: "org_1",
    orgNameSnapshot: "Organization",
    joinCodeSnapshot: "JOIN123",
    status: "pending",
    createdAt: NOW,
    expiresAt: "2026-10-13T12:00:00.000Z",
    updatedAt: NOW,
    decidedAt: null,
    decidedByUserId: null,
    decisionReason: null,
    ...overrides,
  };
}

function db(users: UserProfile[], requests = [request()]): ApiDatabase {
  return {
    users,
    orgs: [
      { id: "org_1", name: "Organization", status: "active" },
      { id: "org_2", name: "Other", status: "active" },
    ],
    enterpriseJoinRequests: requests,
  } as unknown as ApiDatabase;
}

test("access-request producer selects active Org and User Admins only at creation time", () => {
  const source = db([
    user("org_admin", { orgRole: "org_admin" }),
    user("user_admin", { orgRole: "user_admin" }),
    user("regular"),
    user("manager"),
    user("manager_report", { managerUserId: "manager" }),
    user("cross_org", { orgId: "org_2", orgRole: "org_admin" }),
    user("inactive", { orgRole: "org_admin", status: "disabled" }),
  ]);
  const rows = buildAccessRequestNotificationInputs({ db: source, request: source.enterpriseJoinRequests[0]! });
  assert.deepEqual(rows.map((row) => row.recipientUserId).sort(), ["org_admin", "user_admin"]);
  assert.ok(rows.every((row) => row.dedupKey === "access-request:request_1"));
  assert.ok(rows.every((row) => row.payload?.destination === "/app/admin?tab=access"));
});

test("duplicate access-request enqueue remains exactly once per intended recipient", async () => {
  const source = db([user("org_admin", { orgRole: "org_admin" }), user("user_admin", { orgRole: "user_admin" })]);
  const store = createMemoryUserNotificationStoreForTest();
  const rows = buildAccessRequestNotificationInputs({ db: source, request: source.enterpriseJoinRequests[0]! });
  await store.enqueueMany(rows);
  await store.enqueueMany(rows);
  assert.equal((await store.listForRecipient({ recipientUserId: "org_admin", limit: 10 })).length, 1);
  assert.equal((await store.listForRecipient({ recipientUserId: "user_admin", limit: 10 })).length, 1);
});

test("authorized notification paging continues after the last returned row without skipping", async () => {
  const recipient = user("org_admin", { orgRole: "org_admin" });
  const requests = [request({ id: "request_1" }), request({ id: "request_2" }), request({ id: "request_3" })];
  const source = db([recipient], requests);
  const store = createMemoryUserNotificationStoreForTest();
  for (const [index, accessRequest] of requests.entries()) {
    await store.enqueueMany(buildAccessRequestNotificationInputs({
      db: source,
      request: accessRequest,
      createdAt: new Date(`2026-10-0${index + 1}T12:00:00.000Z`),
    }));
  }

  const first = await listAuthorizedDashboardNotifications({ db: source, recipient, store, limit: 2 });
  assert.equal(first.notifications.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 2);
  const second = await listAuthorizedDashboardNotifications({
    db: source,
    recipient,
    store,
    limit: 2,
    offset: first.nextOffset!,
  });
  assert.deepEqual(second.notifications.map((row) => row.subjectId), ["request_1"]);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextOffset, null);
});

test("read-time policy shows active Org Admin and User Admin recipients", async () => {
  for (const orgRole of ["org_admin", "user_admin"] as const) {
    const recipient = user(`recipient_${orgRole}`, { orgRole });
    const source = db([recipient]);
    const store = createMemoryUserNotificationStoreForTest();
    await store.enqueueMany(buildAccessRequestNotificationInputs({ db: source, request: source.enterpriseJoinRequests[0]! }));
    const result = await listAuthorizedDashboardNotifications({ db: source, recipient, store, limit: 20 });
    assert.equal(result.notifications.length, 1);
    assert.equal(result.unreadCount, 1);
  }
});

test("demoted, moved, inactive, and inactive-organization recipients are hidden and resolved", async () => {
  const original = user("recipient", { orgRole: "user_admin" });
  for (const changed of [
    user("recipient", { orgRole: "user" }),
    user("recipient", { orgRole: "user_admin", orgId: "org_2" }),
    user("recipient", { orgRole: "user_admin", status: "disabled" }),
  ]) {
    const originalDb = db([original]);
    const store = createMemoryUserNotificationStoreForTest();
    await store.enqueueMany(buildAccessRequestNotificationInputs({ db: originalDb, request: originalDb.enterpriseJoinRequests[0]! }));
    const currentDb = db([changed]);
    if (changed.status === "disabled") currentDb.orgs[0]!.status = "active";
    const result = await listAuthorizedDashboardNotifications({ db: currentDb, recipient: changed, store, limit: 20 });
    assert.equal(result.notifications.length, 0);
    const stored = await store.listForRecipient({ recipientUserId: changed.id, limit: 10 });
    assert.equal(stored[0]?.resolution, "authorization_revoked");
  }

  const recipient = user("recipient", { orgRole: "org_admin" });
  const source = db([recipient]);
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueMany(buildAccessRequestNotificationInputs({ db: source, request: source.enterpriseJoinRequests[0]! }));
  source.orgs[0]!.status = "disabled";
  assert.equal((await listAuthorizedDashboardNotifications({ db: source, recipient, store, limit: 20 })).notifications.length, 0);
});

test("cross-user notification lookup is denied and an authorized open marks read without resolving", async () => {
  const adminA = user("admin_a", { orgRole: "org_admin" });
  const adminB = user("admin_b", { orgRole: "user_admin" });
  const source = db([adminA, adminB]);
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueMany(buildAccessRequestNotificationInputs({ db: source, request: source.enterpriseJoinRequests[0]! }));
  const rowA = (await store.listForRecipient({ recipientUserId: adminA.id, limit: 10 }))[0]!;
  assert.equal(await markAuthorizedDashboardNotificationRead({
    db: source, recipient: adminB, store, notificationId: rowA.id,
  }), null);
  const opened = await markAuthorizedDashboardNotificationRead({
    db: source, recipient: adminA, store, notificationId: rowA.id, readAt: new Date("2026-10-07T00:00:00Z"),
  });
  assert.ok(opened?.readAt);
  assert.equal(opened?.resolvedAt, null);
});

test("request completion resolves every recipient row while retaining inbox history", async () => {
  const adminA = user("admin_a", { orgRole: "org_admin" });
  const adminB = user("admin_b", { orgRole: "user_admin" });
  const source = db([adminA, adminB]);
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueMany(buildAccessRequestNotificationInputs({ db: source, request: source.enterpriseJoinRequests[0]! }));
  assert.equal(await resolveAccessRequestNotifications({ store, requestIds: ["request_1"], resolution: "approved" }), 2);
  for (const recipient of [adminA, adminB]) {
    const result = await listAuthorizedDashboardNotifications({ db: source, recipient, store, limit: 20 });
    assert.equal(result.notifications.length, 1);
    assert.equal(result.notifications[0]?.resolution, "approved");
    assert.equal(result.unreadCount, 0);
  }
});

test("actionable unread count excludes notifications whose request is no longer pending", async () => {
  const recipient = user("admin", { orgRole: "org_admin" });
  const pending = request();
  const source = db([recipient], [pending]);
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueMany(buildAccessRequestNotificationInputs({ db: source, request: pending }));
  pending.status = "rejected";

  const result = await listAuthorizedDashboardNotifications({ db: source, recipient, store, limit: 20 });
  assert.equal(result.notifications.length, 1);
  assert.equal(result.unreadCount, 0);
  assert.equal(result.notifications[0]?.resolution, "rejected");
  assert.ok(result.notifications[0]?.resolvedAt);
});

test("unknown notification kinds fail closed at the policy layer", async () => {
  const recipient = user("admin", { orgRole: "org_admin" });
  const source = db([recipient]);
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueOne({
    ...buildAccessRequestNotificationInputs({ db: source, request: source.enterpriseJoinRequests[0]! })[0]!,
    kind: "topic_assigned",
    dedupKey: "future:1",
  });
  const result = await listAuthorizedDashboardNotifications({ db: source, recipient, store, limit: 20 });
  assert.equal(result.notifications.length, 0);
  assert.equal((await store.listForRecipient({ recipientUserId: recipient.id, limit: 10 }))[0]?.resolution, "authorization_revoked");
});

test("legacy authority mode hides Topic notifications without destroying them and assignments restoration re-evaluates access", async () => {
  const recipient = user("learner");
  const source = db([recipient], []);
  source.orgTrainings = [{ id: "topic_1", orgId: "org_1", name: "Coaching", description: "",
    status: "active", createdAt: NOW, updatedAt: NOW }];
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueOne({ orgId: "org_1", recipientUserId: recipient.id, kind: "topic_assigned",
    subjectType: TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE, subjectId: "topic_1", dedupKey: "topic:event:learner",
    payload: { title: "New Focus Topic" }, createdAt: new Date(NOW) });
  const authority: FocusTopicAuthoritySnapshot = { assignments: [{ id: "assignment_1", orgId: "org_1",
    topicId: "topic_1", audience: "individual", subjectUserId: recipient.id, grantsManagement: false,
    createdBy: "admin", createdAt: NOW, revokedBy: null, revokedAt: null }],
    scenarioAttachments: [], contentAttachments: [] };
  const assigned = await listAuthorizedDashboardNotifications({ db: source, recipient, store,
    topicAuthority: authority, topicAuthorityMode: "assignments", limit: 20 });
  assert.equal(assigned.notifications.length, 1);
  const legacy = await listAuthorizedDashboardNotifications({ db: source, recipient, store,
    topicAuthority: null, topicAuthorityMode: "legacy", limit: 20 });
  assert.equal(legacy.notifications.length, 0);
  assert.equal((await store.listForRecipient({ recipientUserId: recipient.id, limit: 10 }))[0]?.resolvedAt, null);
  const restored = await listAuthorizedDashboardNotifications({ db: source, recipient, store,
    topicAuthority: authority, topicAuthorityMode: "assignments", limit: 20 });
  assert.equal(restored.notifications.length, 1);

  source.orgTrainings[0]!.status = "archived";
  await listAuthorizedDashboardNotifications({ db: source, recipient, store,
    topicAuthority: null, topicAuthorityMode: "legacy", limit: 20 });
  assert.equal((await store.listForRecipient({ recipientUserId: recipient.id, limit: 10 }))[0]?.resolution,
    "authorization_revoked");
});
