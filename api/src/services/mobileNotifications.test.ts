import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDatabase, PerformancePlan, UserProfile } from "@voicepractice/shared";
import { createMemoryUserNotificationStoreForTest } from "../storage/userNotificationStore.js";
import { listMobileNotifications, markAllMobileNotificationsRead, mutateMobileNotification, type MobileNotificationContext } from "./mobileNotifications.js";

function fixture(): MobileNotificationContext {
  const recipient = { id: "learner", orgId: "org", accountType: "enterprise", status: "active", emailVerifiedAt: "2026-10-14", orgRole: "user" } as UserProfile;
  return {
    recipient, orgId: "org", store: createMemoryUserNotificationStoreForTest(),
    db: { users: [recipient], orgs: [{ id: "org", status: "active" }],
      orgTrainings: [{ id: "topic", orgId: "org", name: "Practice", status: "active" }] } as unknown as ApiDatabase,
    authority: { assignments: [{ id: "assignment", orgId: "org", topicId: "topic", audience: "individual",
      subjectUserId: recipient.id, grantsManagement: false, createdAt: "2026-10-14", createdBy: "admin", revokedAt: null, revokedBy: null }],
      scenarioAttachments: [], contentAttachments: [] },
    plans: [{ id: "goal", orgId: "org", userId: recipient.id }, { id: "other-goal", orgId: "org", userId: "other" }] as PerformancePlan[],
  };
}
const list = (context: MobileNotificationContext, offset = 0) => listMobileNotifications(context, { limit: 2, offset, history: false });

test("learner notifications reuse goal and Topic authority without administrative payloads", async () => {
  const context = fixture();
  for (const [kind, subjectType, subjectId] of [["topic_assigned", "focus_topic", "topic"],
    ["goal_updated", "performance_plan", "goal"], ["goal_commented", "performance_plan", "goal"],
    ["goal_commented", "performance_plan", "other-goal"], ["content_added", "focus_topic", "topic"],
    ["scenario_reviewed", "customer_practice_scenario", "draft"]] as const) {
    await context.store.enqueueOne({ orgId: "org", recipientUserId: "learner", kind, subjectType, subjectId,
      dedupKey: `${kind}:${subjectId}`, payload: { title: "PRIVATE", body: "PRIVATE", destination: "/app/admin" } });
  }
  const first = await list(context);
  assert.equal(first.unreadCount, 3);
  assert.equal(first.notifications.length, 2);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|\/admin|other-goal|draft/);
  const second = await list(context, first.nextOffset!);
  assert.equal(second.notifications.length, 1);
  assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.notifications, ...second.notifications].map((row) => row.id)).size, 3);
  await markAllMobileNotificationsRead(context);
  await markAllMobileNotificationsRead(context);
  assert.equal((await list(context)).unreadCount, 0);
  const unreadHidden = (await context.store.listForRecipient({ recipientUserId: "learner", limit: 100 })).filter((row) => !row.readAt);
  assert.equal(unreadHidden.length, 3, "mark-all never marks administrative or unauthorized notifications");
});

test("revocation archival org switching and goal deletion hide history and deny open", async () => {
  const context = fixture();
  const row = await context.store.enqueueOne({ orgId: "org", recipientUserId: "learner", kind: "topic_assigned",
    subjectType: "focus_topic", subjectId: "topic", dedupKey: "topic" });
  assert.ok(row);
  assert.ok(await mutateMobileNotification(context, row.id, "dismiss"));
  assert.ok(await mutateMobileNotification(context, row.id, "dismiss"));
  assert.equal((await list(context)).notifications.length, 0);
  assert.equal((await listMobileNotifications(context, { limit: 20, offset: 0, history: true })).notifications.length, 1);
  for (const restricted of [
    { ...context, orgId: "other-org" },
    { ...context, authority: null },
    { ...context, recipient: { ...context.recipient, status: "disabled" as const } },
    { ...context, db: { ...context.db, orgTrainings: context.db.orgTrainings.map((topic) => ({ ...topic, status: "archived" as const })) } },
  ]) {
    assert.equal(await mutateMobileNotification(restricted, row.id, "open"), null);
    assert.equal((await listMobileNotifications(restricted, { limit: 20, offset: 0, history: true })).notifications.length, 0);
    assert.equal((await list(restricted)).unreadCount, 0);
  }
  const goal = await context.store.enqueueOne({ orgId: "org", recipientUserId: "learner", kind: "goal_updated",
    subjectType: "performance_plan", subjectId: "goal", dedupKey: "goal" });
  assert.ok(goal);
  assert.equal(await mutateMobileNotification({ ...context, plans: [] }, goal.id, "open"), null);
});
