import type { TrainingContentAssignment, TrainingContentItem } from "@voicepractice/shared";

export interface FocusTopicContentAuthorityRecord {
  content: TrainingContentItem;
  categoryArchivedAt: string | null;
  assignments: readonly TrainingContentAssignment[];
  topicAttachments: readonly {
    topicId: string;
    detachedAt: string | null;
  }[];
}

export function isContentVisibleToWholeOrganization(
  record: FocusTopicContentAuthorityRecord,
): boolean {
  return record.content.publicationState === "published"
    && record.content.archivedAt === null
    && record.categoryArchivedAt === null
    && record.assignments.some((assignment) =>
      assignment.revokedAt === null
      && assignment.orgId === record.content.orgId
      && assignment.contentId === record.content.id
      && assignment.assignmentType === "organization"
      && assignment.subjectUserId === null
    );
}

export function canScopedActorAttachContent(params: {
  actorId: string;
  record: FocusTopicContentAuthorityRecord;
}): boolean {
  const { content } = params.record;
  if (content.archivedAt !== null || params.record.categoryArchivedAt !== null) return false;
  return content.createdByActorId === params.actorId
    || isContentVisibleToWholeOrganization(params.record);
}

export function canScopedActorMutateContent(params: {
  actorId: string;
  actorOrgId: string;
  actorCurrent: boolean;
  organizationCurrent: boolean;
  learningResourcesEnabled: boolean;
  record: FocusTopicContentAuthorityRecord;
  manageableTopicIds: ReadonlySet<string>;
}): boolean {
  const { content } = params.record;
  if (!params.actorId || !params.actorCurrent || !params.organizationCurrent
    || !params.learningResourcesEnabled || content.orgId !== params.actorOrgId
    || content.archivedAt !== null || params.record.categoryArchivedAt !== null) {
    return false;
  }
  if (params.record.assignments.some((assignment) => assignment.revokedAt === null)) {
    return false;
  }
  const activeTopicIds = new Set(params.record.topicAttachments
    .filter((attachment) => attachment.detachedAt === null)
    .map((attachment) => attachment.topicId));
  return activeTopicIds.size > 0
    && [...activeTopicIds].every((topicId) => params.manageableTopicIds.has(topicId));
}
