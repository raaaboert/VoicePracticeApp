import type { ApiDatabase, OrgTrainingRecord, UserProfile } from "@voicepractice/shared";

import type { FocusTopicAssignment } from "./focusTopicAuthority.js";
import { canFutureLearnerAccessFocusTopic } from "./focusTopicAuthority.js";
import type { EnqueueUserNotificationInput } from "../storage/userNotificationStore.js";
import type { UserNotificationRecord } from "../storage/userNotificationStore.js";
import type { FocusTopicAuthoritySnapshot } from "../storage/focusTopicAuthorityStore.js";

export const TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE = "focus_topic";

export function buildTopicAssignedNotificationInputs(params: {
  db: ApiDatabase;
  topic: OrgTrainingRecord;
  assignments: readonly FocusTopicAssignment[];
  eventKey: string;
  createdAt: Date;
}): EnqueueUserNotificationInput[] {
  const org = params.db.orgs.find((candidate) => candidate.id === params.topic.orgId);
  if (!org || org.status !== "active" || params.topic.status !== "active") return [];
  return params.db.users
    .filter((user) => canFutureLearnerAccessFocusTopic({
      user, users: params.db.users, organization: org, topic: params.topic,
      assignments: params.assignments,
    }))
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

export function canViewTopicAssignedNotification(params: {
  db: ApiDatabase;
  recipient: UserProfile;
  notification: UserNotificationRecord;
  authority: FocusTopicAuthoritySnapshot | null;
}): boolean {
  const { db, recipient, notification, authority } = params;
  if (!authority || notification.kind !== "topic_assigned"
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
