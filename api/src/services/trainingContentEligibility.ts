import type {
  TrainingContentAssignment,
  TrainingContentAssignmentType,
  TrainingContentItem,
  UserProfile,
} from "@voicepractice/shared";

import { isEligibleManagerUser, normalizeManagerUserId } from "./userProfiles.js";

export interface TrainingContentEligibilityResult {
  eligible: boolean;
  grants: TrainingContentAssignmentType[];
  reason:
    | "eligible"
    | "module_disabled"
    | "content_unavailable"
    | "inactive_membership"
    | "not_assigned";
}

export function resolveTrainingContentEligibility(params: {
  orgId: string;
  userId: string;
  moduleEnabled: boolean;
  content: TrainingContentItem;
  assignments: readonly TrainingContentAssignment[];
  users: readonly UserProfile[];
}): TrainingContentEligibilityResult {
  if (!params.moduleEnabled) {
    return { eligible: false, grants: [], reason: "module_disabled" };
  }
  if (
    params.content.orgId !== params.orgId
    || params.content.publicationState !== "published"
  ) {
    return { eligible: false, grants: [], reason: "content_unavailable" };
  }

  const user = params.users.find((candidate) => candidate.id === params.userId) ?? null;
  if (!isActiveOrganizationMember(user, params.orgId)) {
    return { eligible: false, grants: [], reason: "inactive_membership" };
  }

  const usersById = new Map(params.users.map((candidate) => [candidate.id, candidate]));
  const grants = new Set<TrainingContentAssignmentType>();
  for (const assignment of params.assignments) {
    if (
      assignment.orgId !== params.orgId
      || assignment.contentId !== params.content.id
      || assignment.revokedAt !== null
    ) {
      continue;
    }
    if (assignment.assignmentType === "organization") {
      grants.add("organization");
      continue;
    }
    if (assignment.assignmentType === "user" && assignment.subjectUserId === user.id) {
      grants.add("user");
      continue;
    }
    if (!assignment.subjectUserId) {
      continue;
    }

    const manager = usersById.get(assignment.subjectUserId) ?? null;
    if (!manager || !isEligibleManagerUser(manager, params.orgId)) {
      continue;
    }
    if (assignment.assignmentType === "manager" && manager.id === user.id) {
      grants.add("manager");
    }
    if (
      assignment.assignmentType === "manager_team"
      && normalizeManagerUserId(user.managerUserId) === manager.id
    ) {
      grants.add("manager_team");
    }
  }

  const orderedGrants = [
    "organization",
    "user",
    "manager",
    "manager_team",
  ].filter((type): type is TrainingContentAssignmentType =>
    grants.has(type as TrainingContentAssignmentType)
  );
  return orderedGrants.length > 0
    ? { eligible: true, grants: orderedGrants, reason: "eligible" }
    : { eligible: false, grants: [], reason: "not_assigned" };
}

function isActiveOrganizationMember(
  user: UserProfile | null,
  orgId: string
): user is UserProfile {
  return Boolean(
    user
    && user.accountType === "enterprise"
    && user.orgId === orgId
    && user.status === "active"
    && user.emailVerifiedAt
  );
}
