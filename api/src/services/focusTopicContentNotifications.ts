import type {
  ApiDatabase,
  OrgTrainingRecord,
  TrainingContentItem,
  UserProfile,
} from "@voicepractice/shared";

import type {
  EnqueueUserNotificationInput,
  UserNotificationRecord,
} from "../storage/userNotificationStore.js";

export const FOCUS_TOPIC_CONTENT_NOTIFICATION_SUBJECT_TYPE = "focus_topic";

export function canViewFocusTopicContentAttachedNotification(params: {
  db: ApiDatabase;
  recipient: UserProfile;
  notification: UserNotificationRecord;
}): boolean {
  const { recipient, notification } = params;
  if (notification.kind !== "content_added"
    || notification.subjectType !== FOCUS_TOPIC_CONTENT_NOTIFICATION_SUBJECT_TYPE
    || notification.recipientUserId !== recipient.id
    || recipient.accountType !== "enterprise"
    || recipient.orgRole !== "org_admin"
    || recipient.status !== "active"
    || !recipient.emailVerifiedAt
    || !recipient.orgId
    || notification.orgId !== recipient.orgId) return false;
  const org = params.db.orgs.find((candidate) => candidate.id === recipient.orgId);
  const topic = (params.db.orgTrainings ?? []).find((candidate) => candidate.id === notification.subjectId);
  return Boolean(org?.status === "active" && topic?.orgId === org.id);
}

export function buildFocusTopicContentAttachedNotificationInputs(params: {
  db: ApiDatabase;
  topic: Pick<OrgTrainingRecord, "id" | "orgId" | "name" | "status">;
  content: Pick<TrainingContentItem, "id" | "orgId" | "title" | "archivedAt">;
  attachmentId: string;
  actorId: string;
  createdAt: Date;
}): EnqueueUserNotificationInput[] {
  const org = params.db.orgs.find((candidate) => candidate.id === params.topic.orgId);
  if (!org || org.status !== "active"
    || params.topic.orgId !== params.content.orgId
    || params.topic.status === "archived"
    || params.content.archivedAt) return [];
  return params.db.users
    .filter((user) => user.accountType === "enterprise"
      && user.orgId === org.id
      && user.orgRole === "org_admin"
      && user.status === "active"
      && user.id !== params.actorId
      && Boolean(user.emailVerifiedAt))
    .map((recipient) => ({
      orgId: org.id,
      recipientUserId: recipient.id,
      kind: "content_added" as const,
      subjectType: FOCUS_TOPIC_CONTENT_NOTIFICATION_SUBJECT_TYPE,
      subjectId: params.topic.id,
      dedupKey: `focus-topic-content-attached:${params.attachmentId}:${recipient.id}`,
      payload: {
        title: "Learning Resource added",
        body: `${params.content.title} was added to ${params.topic.name}.`,
        destination: "/app/admin/focus-topics",
      },
      createdAt: params.createdAt,
    }));
}
