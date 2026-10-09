import type {
  EnterpriseOrg,
  OrganizationProductSettings,
  OrgTrainingRecord,
  UserProfile,
} from "@voicepractice/shared";

export const FOCUS_TOPIC_ASSIGNMENT_AUDIENCES = [
  "organization",
  "managers_and_admins",
  "manager_only",
  "manager_with_team",
  "individual",
] as const;

export type FocusTopicAssignmentAudience =
  (typeof FOCUS_TOPIC_ASSIGNMENT_AUDIENCES)[number];

export interface FocusTopicAssignment {
  id: string;
  orgId: string;
  topicId: string;
  audience: FocusTopicAssignmentAudience;
  subjectUserId: string | null;
  grantsManagement: boolean;
  createdBy: string;
  createdAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

type AuthorityUser = Pick<
  UserProfile,
  "id" | "accountType" | "orgId" | "orgRole" | "status" | "emailVerifiedAt" | "managerUserId"
>;

export function canFutureLearnerAccessFocusTopic(params: {
  user: AuthorityUser;
  users: readonly AuthorityUser[];
  organization: Pick<EnterpriseOrg, "id" | "status">;
  topic: Pick<OrgTrainingRecord, "id" | "orgId" | "status">;
  assignments: readonly FocusTopicAssignment[];
}): boolean {
  if (!isActiveVerifiedMember(params.user, params.organization)) return false;
  if (params.topic.orgId !== params.organization.id || params.topic.status !== "active") return false;
  return params.assignments.some((assignment) =>
    isActiveSameTopicAssignment(assignment, params.organization.id, params.topic.id)
    && !assignment.grantsManagement
    && learnerAudienceMatches(assignment, params.user, params.users, params.organization.id)
  );
}

export function canFutureActorManageFocusTopic(params: {
  actor: AuthorityUser;
  users: readonly AuthorityUser[];
  organization: Pick<EnterpriseOrg, "id" | "status">;
  topic: Pick<OrgTrainingRecord, "id" | "orgId" | "status">;
  assignments: readonly FocusTopicAssignment[];
  productSettings: Pick<
    OrganizationProductSettings,
    "allowUserAdminFocusTopicManagement" | "allowManagerFocusTopicManagement"
  >;
}): boolean {
  const { actor, organization, topic } = params;
  if (!isActiveVerifiedMember(actor, organization)) return false;
  if (topic.orgId !== organization.id || topic.status !== "active") return false;
  if (actor.orgRole === "org_admin") return true;

  if (actor.orgRole === "user_admin") {
    return params.productSettings.allowUserAdminFocusTopicManagement
      && params.assignments.some((assignment) =>
        isActiveSameTopicAssignment(assignment, organization.id, topic.id)
        && assignment.grantsManagement
        && assignment.audience === "individual"
        && assignment.subjectUserId === actor.id
      );
  }
  return params.productSettings.allowManagerFocusTopicManagement
    && hasActiveDirectReport(actor.id, params.users, organization.id)
    && params.assignments.some((assignment) =>
      isActiveSameTopicAssignment(assignment, organization.id, topic.id)
      && assignment.grantsManagement
      && assignment.audience === "manager_only"
      && assignment.subjectUserId === actor.id
    );
}

export function isActiveVerifiedMember(
  user: AuthorityUser,
  organization: Pick<EnterpriseOrg, "id" | "status">
): boolean {
  return organization.status === "active"
    && user.accountType === "enterprise"
    && user.orgId === organization.id
    && user.status === "active"
    && Boolean(user.emailVerifiedAt);
}

function learnerAudienceMatches(
  assignment: FocusTopicAssignment,
  user: AuthorityUser,
  users: readonly AuthorityUser[],
  orgId: string
): boolean {
  if (isTargetedAudience(assignment.audience)) {
    const subject = users.find((candidate) => candidate.id === assignment.subjectUserId);
    if (
      !subject
      || subject.accountType !== "enterprise"
      || subject.orgId !== orgId
      || subject.status !== "active"
    ) {
      return false;
    }
  }
  switch (assignment.audience) {
    case "organization": return true;
    case "managers_and_admins":
      return user.orgRole === "org_admin"
        || user.orgRole === "user_admin"
        || hasActiveDirectReport(user.id, users, orgId);
    case "manager_only": return assignment.subjectUserId === user.id;
    case "manager_with_team":
      return assignment.subjectUserId === user.id
        || user.managerUserId === assignment.subjectUserId;
    case "individual": return assignment.subjectUserId === user.id;
  }
}

function hasActiveDirectReport(
  managerId: string,
  users: readonly AuthorityUser[],
  orgId: string
): boolean {
  return users.some((user) =>
    user.accountType === "enterprise"
    && user.orgId === orgId
    && user.status === "active"
    && user.managerUserId === managerId
  );
}

function isActiveSameTopicAssignment(
  assignment: FocusTopicAssignment,
  orgId: string,
  topicId: string
): boolean {
  return assignment.revokedAt === null
    && assignment.orgId === orgId
    && assignment.topicId === topicId;
}

function isTargetedAudience(audience: FocusTopicAssignmentAudience): boolean {
  return audience === "individual" || audience === "manager_only" || audience === "manager_with_team";
}
