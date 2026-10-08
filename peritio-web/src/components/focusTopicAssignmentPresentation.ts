export interface FocusTopicAssignmentPresentationRow {
  id: string;
  subjectUserId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export function partitionFocusTopicAssignments<T extends FocusTopicAssignmentPresentationRow>(
  assignments: readonly T[]
): { activeAssignments: T[]; assignmentHistory: T[] } {
  return {
    activeAssignments: assignments.filter((assignment) => assignment.revokedAt === null),
    assignmentHistory: assignments.filter((assignment) => assignment.revokedAt !== null),
  };
}
