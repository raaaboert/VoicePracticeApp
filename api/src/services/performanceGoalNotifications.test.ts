import assert from "node:assert/strict";
import test from "node:test";

import type { ApiDatabase, PerformancePlan, UserProfile } from "@voicepractice/shared";

import { createMemoryUserNotificationStoreForTest } from "../storage/userNotificationStore.js";
import {
  buildPerformanceGoalChangedNotificationInputs,
  buildPerformanceGoalCommentNotificationInputs,
  canViewPerformanceGoalNotification,
  isMaterialPerformanceGoalUpdate,
  PERFORMANCE_GOAL_NOTIFICATION_SUBJECT_TYPE,
} from "./performanceGoalNotifications.js";
import { listAuthorizedDashboardNotifications, markAuthorizedDashboardNotificationRead } from "./accessRequestNotifications.js";

const NOW = "2026-10-10T12:00:00.000Z";

function user(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id, email: `${id}@example.com`, firstName: id, lastName: "User", employeeId: null,
    managerUserId: null, emailVerifiedAt: NOW, isPlatformAdmin: false, isSuperUser: false,
    dashboardAccessEnabled: true, mobileProfileReonboardingRequired: false,
    accountType: "enterprise", tier: "enterprise", status: "active", orgId: "org_1",
    orgRole: "user", performanceAccess: "none", divisionId: null, timezone: "UTC",
    pendingTimezone: null, pendingTimezoneEffectiveAt: null, planAnchorAt: NOW,
    manualBonusSeconds: 0, dailySecondsCapOverride: null, allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function plan(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  return {
    id: "plan_1", orgId: "org_1", userId: "learner", createdByActorType: "web_user",
    createdByActorId: "manager", createdAt: NOW, submittedAt: NOW, effectiveAt: NOW,
    startDate: "2026-10-10", endDate: "2026-11-10", timeZone: "UTC", status: "active",
    completedAt: null, cancelledAt: null, cancelledByActorType: null, cancelledByActorId: null,
    cancellationReason: null,
    activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 3 },
    performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null },
    scope: { allAssignedScenarios: true, selectedFocusTopicIds: [], selectedScenarioIds: [], scenarios: [] },
    baseline: null, finalResult: null, updatedAt: NOW, ...overrides,
  };
}

function database(users: UserProfile[]): ApiDatabase {
  return {
    orgs: [{ id: "org_1", status: "active" }], users,
    enterpriseJoinRequests: [], orgTrainings: [],
  } as unknown as ApiDatabase;
}

test("goal create and material update notify the target only, with idempotent durable keys", async () => {
  const manager = user("manager", { performanceAccess: "team" });
  const learner = user("learner", { managerUserId: manager.id, dashboardAccessEnabled: false });
  const db = database([manager, learner]);
  const initial = plan();
  const created = buildPerformanceGoalChangedNotificationInputs({ db, plan: initial, actorId: manager.id, event: "created", createdAt: new Date(NOW) });
  assert.equal(created.length, 1);
  assert.equal(created[0]?.recipientUserId, learner.id);
  assert.equal(created[0]?.kind, "goal_updated");
  assert.equal(created.at(0)?.payload?.body?.includes("session"), false);

  const store = createMemoryUserNotificationStoreForTest();
  assert.equal((await store.enqueueMany(created)).length, 1);
  assert.equal((await store.enqueueMany(created)).length, 0);

  const cosmetic = { ...initial, updatedAt: "2026-10-10T13:00:00.000Z" };
  assert.equal(isMaterialPerformanceGoalUpdate(initial, cosmetic), false);
  const changed = { ...initial, endDate: "2026-11-17", updatedAt: "2026-10-10T14:00:00.000Z" };
  assert.equal(isMaterialPerformanceGoalUpdate(initial, changed), true);
  assert.equal(buildPerformanceGoalChangedNotificationInputs({ db, plan: changed, actorId: manager.id, event: "updated", createdAt: new Date(NOW) }).length, 1);
});

test("goal comments notify the other current participant, exclude self, and fail closed across organizations", () => {
  const manager = user("manager", { performanceAccess: "team" });
  const learner = user("learner", { managerUserId: manager.id });
  const db = database([manager, learner]);
  const goal = plan();
  const managerComment = buildPerformanceGoalCommentNotificationInputs({
    db, plan: goal, actorId: manager.id, updateId: "comment_manager", createdAt: new Date(NOW),
  });
  assert.deepEqual(managerComment.map((input) => input.recipientUserId), [learner.id]);
  const learnerComment = buildPerformanceGoalCommentNotificationInputs({
    db, plan: goal, actorId: learner.id, updateId: "comment_learner", createdAt: new Date(NOW),
  });
  assert.deepEqual(learnerComment.map((input) => input.recipientUserId), [manager.id]);
  assert.equal(buildPerformanceGoalCommentNotificationInputs({
    db, plan: goal, actorId: "unknown", updateId: "comment_cross_org", createdAt: new Date(NOW),
  }).length, 2);

  const foreignManager = { ...manager, orgId: "org_2" };
  assert.equal(buildPerformanceGoalCommentNotificationInputs({
    db: database([foreignManager, learner]), plan: goal, actorId: learner.id, updateId: "foreign", createdAt: new Date(NOW),
  }).length, 0);
});

test("goal notification visibility reauthorizes the target and creator against current access", () => {
  const manager = user("manager", { performanceAccess: "team" });
  const learner = user("learner", { managerUserId: manager.id });
  const db = database([manager, learner]);
  const goal = plan();
  const notification = {
    id: "notice", orgId: "org_1", recipientUserId: manager.id, kind: "goal_commented",
    subjectType: PERFORMANCE_GOAL_NOTIFICATION_SUBJECT_TYPE, subjectId: goal.id, dedupKey: "comment",
    payload: {}, createdAt: NOW, readAt: null, resolvedAt: null, resolution: null,
  };
  assert.equal(canViewPerformanceGoalNotification({ db, recipient: manager, notification, plan: goal }), true);
  manager.performanceAccess = "none";
  assert.equal(canViewPerformanceGoalNotification({ db, recipient: manager, notification, plan: goal }), false);
  const ownerNotification = { ...notification, recipientUserId: learner.id };
  assert.equal(canViewPerformanceGoalNotification({ db, recipient: learner, notification: ownerNotification, plan: goal }), true);
  learner.status = "disabled";
  assert.equal(canViewPerformanceGoalNotification({ db, recipient: learner, notification: ownerNotification, plan: goal }), false);
});

test("revoked Performance access hides and resolves a goal notification before a dashboard deep link can open", async () => {
  const manager = user("manager", { performanceAccess: "team" });
  const learner = user("learner", { managerUserId: manager.id });
  const db = database([manager, learner]);
  const goal = plan();
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueOne({
    orgId: goal.orgId, recipientUserId: manager.id, kind: "goal_commented",
    subjectType: PERFORMANCE_GOAL_NOTIFICATION_SUBJECT_TYPE, subjectId: goal.id,
    dedupKey: "manager-comment", payload: { destination: "/app/performance/goals" }, createdAt: new Date(NOW),
  });
  const planStore = { getPlanById: async (id: string) => id === goal.id ? { plan: goal } : null };
  const visible = await listAuthorizedDashboardNotifications({
    db, recipient: manager, store, performancePlanStore: planStore as never, limit: 20,
  });
  assert.equal(visible.notifications.length, 1);
  manager.performanceAccess = "none";
  const hidden = await listAuthorizedDashboardNotifications({
    db, recipient: manager, store, performancePlanStore: planStore as never, limit: 20,
  });
  assert.equal(hidden.notifications.length, 0);
  assert.equal(hidden.unreadCount, 0);
  const stored = (await store.listForRecipient({ recipientUserId: manager.id, limit: 1 }))[0];
  assert.equal(stored?.resolution, "authorization_revoked");
  assert.equal(await markAuthorizedDashboardNotificationRead({
    db, recipient: manager, store, performancePlanStore: planStore as never, notificationId: stored!.id,
  }), null);
});
