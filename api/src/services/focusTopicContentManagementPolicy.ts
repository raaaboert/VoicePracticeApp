import type { TrainingContentAssignment, TrainingContentItem } from "@voicepractice/shared";

export interface FocusTopicContentAuthorityRecord {
  content: TrainingContentItem;
  categoryArchivedAt: string | null;
  assignments: readonly TrainingContentAssignment[];
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
