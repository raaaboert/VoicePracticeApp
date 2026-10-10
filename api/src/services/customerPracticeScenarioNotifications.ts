import type { ApiDatabase, CustomerPracticeScenario, UserProfile } from "@voicepractice/shared";
import type { EnqueueUserNotificationInput, UserNotificationRecord } from "../storage/userNotificationStore.js";

export const CUSTOMER_PRACTICE_SCENARIO_NOTIFICATION_SUBJECT_TYPE = "customer_practice_scenario";
const DESTINATION = "/app/admin/focus-topics";

function isCurrentOrgAdmin(user: UserProfile, orgId: string): boolean {
  return user.accountType === "enterprise" && user.orgId === orgId && user.orgRole === "org_admin"
    && user.status === "active" && Boolean(user.emailVerifiedAt);
}

function isCurrentOrgMember(user: UserProfile, orgId: string): boolean {
  return user.accountType === "enterprise" && user.orgId === orgId
    && user.status === "active" && Boolean(user.emailVerifiedAt);
}

export function buildScenarioSubmittedNotificationInputs(params: {
  db: ApiDatabase; scenario: CustomerPracticeScenario; actorId: string; createdAt: Date;
}): EnqueueUserNotificationInput[] {
  if (params.scenario.status !== "in_review") return [];
  return params.db.users.filter((user) => isCurrentOrgAdmin(user, params.scenario.orgId)
    && user.id !== params.actorId).map((recipient) => ({
      orgId: params.scenario.orgId, recipientUserId: recipient.id, kind: "scenario_submitted" as const,
      subjectType: CUSTOMER_PRACTICE_SCENARIO_NOTIFICATION_SUBJECT_TYPE,
      subjectId: params.scenario.id,
      dedupKey: `scenario-submitted:${params.scenario.currentVersionId}:${recipient.id}`,
      payload: { title: "Practice Scenario awaiting review",
        body: `${params.scenario.currentVersion.title} is ready for review.`, destination: DESTINATION },
      createdAt: params.createdAt,
    }));
}

export function buildScenarioDecisionNotificationInputs(params: {
  db: ApiDatabase; scenario: CustomerPracticeScenario; actorId: string;
  decision: "approve" | "reject" | "publish"; createdAt: Date;
}): EnqueueUserNotificationInput[] {
  const author = params.db.users.find((user) => user.id === params.scenario.createdByActorId);
  if (!author || author.id === params.actorId || !isCurrentOrgMember(author, params.scenario.orgId)) return [];
  const past = params.decision === "approve" ? "approved" : params.decision === "reject" ? "rejected" : "published";
  return [{
    orgId: params.scenario.orgId, recipientUserId: author.id, kind: "scenario_reviewed",
    subjectType: CUSTOMER_PRACTICE_SCENARIO_NOTIFICATION_SUBJECT_TYPE,
    subjectId: params.scenario.id,
    dedupKey: `scenario-${past}:${params.scenario.currentVersionId}:${author.id}`,
    payload: { title: `Practice Scenario ${past}`,
      body: `${params.scenario.currentVersion.title} was ${past}.`, destination: DESTINATION },
    createdAt: params.createdAt,
  }];
}

export function canViewCustomerPracticeScenarioNotification(params: {
  db: ApiDatabase; recipient: UserProfile; notification: UserNotificationRecord;
  scenarios: readonly CustomerPracticeScenario[];
}): boolean {
  const { recipient, notification } = params;
  if ((notification.kind !== "scenario_submitted" && notification.kind !== "scenario_reviewed")
    || notification.subjectType !== CUSTOMER_PRACTICE_SCENARIO_NOTIFICATION_SUBJECT_TYPE
    || notification.recipientUserId !== recipient.id || !isCurrentOrgMember(recipient, notification.orgId)) return false;
  const org = params.db.orgs.find((candidate) => candidate.id === notification.orgId);
  const scenario = params.scenarios.find((candidate) => candidate.id === notification.subjectId
    && candidate.orgId === notification.orgId);
  if (!org || org.status !== "active" || !scenario) return false;
  return notification.kind === "scenario_submitted"
    ? isCurrentOrgAdmin(recipient, scenario.orgId) && scenario.status === "in_review"
    : scenario.createdByActorId === recipient.id;
}
