import type { ApiDatabase, PerformancePlan, UserProfile } from "@voicepractice/shared";

import { canViewPerformanceTarget } from "./performanceAuthorization.js";
import type { EnqueueUserNotificationInput, UserNotificationRecord } from "../storage/userNotificationStore.js";

export const PERFORMANCE_GOAL_NOTIFICATION_SUBJECT_TYPE = "performance_plan";
const DESTINATION = "/app/performance/goals";

function isCurrentMember(db: ApiDatabase, user: UserProfile | undefined, orgId: string): user is UserProfile {
  const org = db.orgs.find((candidate) => candidate.id === orgId);
  return Boolean(org && org.status === "active" && user
    && user.accountType === "enterprise"
    && user.orgId === orgId
    && user.status === "active"
    && user.emailVerifiedAt);
}

function canCurrentAuthorViewPlan(db: ApiDatabase, recipient: UserProfile, plan: PerformancePlan): boolean {
  const target = db.users.find((user) => user.id === plan.userId);
  return Boolean(target && isCurrentMember(db, target, plan.orgId)
    && recipient.dashboardAccessEnabled
    && canViewPerformanceTarget({ actor: recipient, target }));
}

export function isMaterialPerformanceGoalUpdate(before: PerformancePlan, after: PerformancePlan): boolean {
  return JSON.stringify({
    startDate: before.startDate,
    endDate: before.endDate,
    timeZone: before.timeZone,
    activityGoal: before.activityGoal,
    performanceGoal: before.performanceGoal,
    scope: before.scope,
  }) !== JSON.stringify({
    startDate: after.startDate,
    endDate: after.endDate,
    timeZone: after.timeZone,
    activityGoal: after.activityGoal,
    performanceGoal: after.performanceGoal,
    scope: after.scope,
  });
}

export function buildPerformanceGoalChangedNotificationInputs(params: {
  db: ApiDatabase;
  plan: PerformancePlan;
  actorId: string | null;
  event: "created" | "updated";
  createdAt: Date;
}): EnqueueUserNotificationInput[] {
  const recipient = params.db.users.find((user) => user.id === params.plan.userId);
  if (!isCurrentMember(params.db, recipient, params.plan.orgId) || recipient.id === params.actorId) return [];
  const verb = params.event === "created" ? "assigned" : "updated";
  return [{
    orgId: params.plan.orgId,
    recipientUserId: recipient.id,
    kind: "goal_updated",
    subjectType: PERFORMANCE_GOAL_NOTIFICATION_SUBJECT_TYPE,
    subjectId: params.plan.id,
    dedupKey: `performance-goal-${params.event}:${params.plan.id}:${params.plan.updatedAt}:${recipient.id}`,
    payload: {
      title: params.event === "created" ? "New Performance goal" : "Performance goal updated",
      body: `A Performance goal was ${verb} for you.`,
      destination: DESTINATION,
    },
    createdAt: params.createdAt,
  }];
}

export function buildPerformanceGoalCommentNotificationInputs(params: {
  db: ApiDatabase;
  plan: PerformancePlan;
  actorId: string | null;
  updateId: string;
  createdAt: Date;
}): EnqueueUserNotificationInput[] {
  const recipients = new Map<string, UserProfile>();
  const target = params.db.users.find((user) => user.id === params.plan.userId);
  if (isCurrentMember(params.db, target, params.plan.orgId)) recipients.set(target.id, target);
  if (params.plan.createdByActorId) {
    const author = params.db.users.find((user) => user.id === params.plan.createdByActorId);
    if (isCurrentMember(params.db, author, params.plan.orgId)
      && canCurrentAuthorViewPlan(params.db, author, params.plan)) {
      recipients.set(author.id, author);
    }
  }
  recipients.delete(params.actorId ?? "");
  return [...recipients.values()].map((recipient) => ({
    orgId: params.plan.orgId,
    recipientUserId: recipient.id,
    kind: "goal_commented" as const,
    subjectType: PERFORMANCE_GOAL_NOTIFICATION_SUBJECT_TYPE,
    subjectId: params.plan.id,
    dedupKey: `performance-goal-comment:${params.updateId}:${recipient.id}`,
    payload: {
      title: "New Performance goal comment",
      body: "There is a new comment on a Performance goal.",
      destination: DESTINATION,
    },
    createdAt: params.createdAt,
  }));
}

export function canViewPerformanceGoalNotification(params: {
  db: ApiDatabase;
  recipient: UserProfile;
  notification: UserNotificationRecord;
  plan: PerformancePlan | null;
}): boolean {
  const { notification, recipient, plan } = params;
  if ((notification.kind !== "goal_updated" && notification.kind !== "goal_commented")
    || notification.subjectType !== PERFORMANCE_GOAL_NOTIFICATION_SUBJECT_TYPE
    || notification.recipientUserId !== recipient.id
    || !plan
    || plan.id !== notification.subjectId
    || plan.orgId !== notification.orgId
    || !isCurrentMember(params.db, recipient, plan.orgId)) return false;
  return recipient.id === plan.userId || canCurrentAuthorViewPlan(params.db, recipient, plan);
}
