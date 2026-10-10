import type { ApiDatabase, OrgTrainingRecord, UserProfile } from "@voicepractice/shared";

import type { FocusTopicAssignment } from "./focusTopicAuthority.js";
import { canFutureLearnerAccessFocusTopic } from "./focusTopicAuthority.js";
import type { EnqueueUserNotificationInput } from "../storage/userNotificationStore.js";
import type { UserNotificationRecord } from "../storage/userNotificationStore.js";
import type { FocusTopicAuthoritySnapshot } from "../storage/focusTopicAuthorityStore.js";

export const TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE = "focus_topic";
const FOCUS_TOPIC_NOTIFICATION_KINDS = new Set(["topic_assigned", "topic_due_7d", "topic_due_1d", "topic_overdue"]);

export function buildTopicAssignedNotificationInputs(params: {
  db: ApiDatabase;
  topic: OrgTrainingRecord;
  assignmentsBefore: readonly FocusTopicAssignment[];
  assignmentsAfter: readonly FocusTopicAssignment[];
  topicBefore?: OrgTrainingRecord;
  eventKey: string;
  createdAt: Date;
}): EnqueueUserNotificationInput[] {
  const org = params.db.orgs.find((candidate) => candidate.id === params.topic.orgId);
  if (!org || org.status !== "active" || params.topic.status !== "active") return [];
  return params.db.users
    .filter((user) => {
      const hadAccess = canFutureLearnerAccessFocusTopic({
        user, users: params.db.users, organization: org, topic: params.topicBefore ?? params.topic,
        assignments: params.assignmentsBefore,
      });
      const hasAccess = canFutureLearnerAccessFocusTopic({
        user, users: params.db.users, organization: org, topic: params.topic,
        assignments: params.assignmentsAfter,
      });
      return !hadAccess && hasAccess;
    })
    .map((recipient) => ({
      orgId: org.id,
      recipientUserId: recipient.id,
      kind: "topic_assigned" as const,
      subjectType: TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE,
      subjectId: params.topic.id,
      dedupKey: `topic-assigned:${params.eventKey}:${recipient.id}`,
      payload: {
        title: "New Focus Topic",
        body: `You have access to ${params.topic.name}.`,
        destination: "/app/",
      },
      createdAt: params.createdAt,
    }));
}

export function shouldPreserveTopicAssignedNotificationInLegacyMode(params: {
  db: ApiDatabase;
  recipient: UserProfile;
  notification: UserNotificationRecord;
}): boolean {
  const { db, recipient, notification } = params;
  if (!FOCUS_TOPIC_NOTIFICATION_KINDS.has(notification.kind)
    || notification.subjectType !== TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE
    || notification.recipientUserId !== recipient.id
    || recipient.status !== "active"
    || recipient.accountType !== "enterprise"
    || !recipient.emailVerifiedAt
    || !recipient.orgId
    || recipient.orgId !== notification.orgId) return false;
  const org = db.orgs.find((candidate) => candidate.id === notification.orgId);
  const topic = db.orgTrainings.find((candidate) => candidate.orgId === notification.orgId
    && candidate.id === notification.subjectId);
  return Boolean(org?.status === "active" && topic?.status === "active");
}

export function canViewTopicAssignedNotification(params: {
  db: ApiDatabase;
  recipient: UserProfile;
  notification: UserNotificationRecord;
  authority: FocusTopicAuthoritySnapshot | null;
}): boolean {
  const { db, recipient, notification, authority } = params;
  if (!authority || !FOCUS_TOPIC_NOTIFICATION_KINDS.has(notification.kind)
    || notification.subjectType !== TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE
    || notification.recipientUserId !== recipient.id) return false;
  const org = db.orgs.find((candidate) => candidate.id === notification.orgId);
  const topic = db.orgTrainings.find((candidate) => candidate.orgId === notification.orgId
    && candidate.id === notification.subjectId);
  return Boolean(org && topic && canFutureLearnerAccessFocusTopic({
    user: recipient, users: db.users, organization: org, topic,
    assignments: authority.assignments,
  }));
}
