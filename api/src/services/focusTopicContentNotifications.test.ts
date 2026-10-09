import assert from "node:assert/strict";
import test from "node:test";

import type { ApiDatabase, OrgTrainingRecord, TrainingContentItem, UserProfile } from "@voicepractice/shared";

import { buildFocusTopicContentAttachedNotificationInputs } from "./focusTopicContentNotifications.js";
import {
  listAuthorizedDashboardNotifications,
  markAuthorizedDashboardNotificationRead,
} from "./accessRequestNotifications.js";
import { createMemoryUserNotificationStoreForTest } from "../storage/userNotificationStore.js";

const now = new Date("2026-10-08T12:00:00.000Z");
const topic = {
  id: "topic_a", orgId: "org_a", name: "Coaching", status: "active",
} as OrgTrainingRecord;
const content = {
  id: "content_a", orgId: "org_a", title: "Discovery guide", archivedAt: null,
} as TrainingContentItem;
const member = (id: string, orgRole: "org_admin" | "user_admin" | "user", overrides = {}) => ({
  id, accountType: "enterprise", orgId: "org_a", orgRole, status: "active",
  emailVerifiedAt: now.toISOString(), ...overrides,
}) as UserProfile;

test("content attachment notifications target only current organization administrators", () => {
  const db = {
    orgs: [{ id: "org_a", status: "active" }],
    users: [
      member("admin", "org_admin"),
      member("user_admin", "user_admin"),
      member("manager", "user"),
      member("disabled_admin", "org_admin", { status: "disabled" }),
      member("foreign_admin", "org_admin", { orgId: "org_b" }),
    ],
  } as ApiDatabase;
  const rows = buildFocusTopicContentAttachedNotificationInputs({
    db, topic, content, attachmentId: "attachment_a", actorId: "manager", createdAt: now,
  });
  assert.deepEqual(rows.map((row) => row.recipientUserId), ["admin"]);
  assert.equal(rows[0]?.kind, "content_added");
  assert.equal(rows[0]?.subjectId, topic.id);
  assert.equal(rows[0]?.payload?.destination, "/app/admin/focus-topics");
});

test("an attaching Org Admin does not receive their own content-added notification", () => {
  const db = {
    orgs: [{ id: "org_a", status: "active" }],
    users: [member("attaching_admin", "org_admin"), member("other_admin", "org_admin")],
  } as ApiDatabase;
  const rows = buildFocusTopicContentAttachedNotificationInputs({
    db, topic, content, attachmentId: "attachment_a", actorId: "attaching_admin", createdAt: now,
  });
  assert.deepEqual(rows.map((row) => row.recipientUserId), ["other_admin"]);
});

test("content attachment notifications fail closed for cross-org, archived, or inactive records", () => {
  const db = {
    orgs: [{ id: "org_a", status: "active" }],
    users: [member("admin", "org_admin")],
  } as ApiDatabase;
  const build = (nextTopic = topic, nextContent = content) =>
    buildFocusTopicContentAttachedNotificationInputs({
      db, topic: nextTopic, content: nextContent, attachmentId: "attachment_a",
      actorId: "manager", createdAt: now,
    });
  assert.deepEqual(build(topic, { ...content, orgId: "org_b" }), []);
  assert.deepEqual(build({ ...topic, status: "archived" }), []);
  assert.deepEqual(build(topic, { ...content, archivedAt: now.toISOString() }), []);
});

test("content attachment notification is visible and readable only through current Org Admin authorization", async () => {
  const admin = member("admin", "org_admin");
  const db = {
    orgs: [{ id: "org_a", status: "active" }],
    users: [admin],
    orgTrainings: [topic],
    enterpriseJoinRequests: [],
  } as unknown as ApiDatabase;
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueMany(buildFocusTopicContentAttachedNotificationInputs({
    db, topic, content, attachmentId: "attachment_a", actorId: "manager", createdAt: now,
  }));
  const listed = await listAuthorizedDashboardNotifications({ db, recipient: admin, store, limit: 20 });
  assert.equal(listed.unreadCount, 1);
  assert.equal(listed.notifications[0]?.kind, "content_added");
  const opened = await markAuthorizedDashboardNotificationRead({
    db, recipient: admin, store, notificationId: listed.notifications[0]!.id, readAt: now,
  });
  assert.equal(opened?.readAt, now.toISOString());

  const demoted = member("admin", "user_admin");
  const hidden = await listAuthorizedDashboardNotifications({ db, recipient: demoted, store, limit: 20 });
  assert.equal(hidden.notifications.length, 0);
});
