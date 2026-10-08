import type {
  ApiDatabase,
  EnterpriseOrg,
  OrganizationProductSettings,
  OrgTrainingRecord,
  UserProfile,
} from "@voicepractice/shared";

import {
  canFutureActorManageFocusTopic,
  type FocusTopicAssignment,
  type FocusTopicAssignmentAudience,
} from "./focusTopicAuthority.js";

export interface FocusTopicManagementScope {
  canManageAllTopics: boolean;
  manageableTopicIds: ReadonlySet<string>;
}

export function resolveFocusTopicManagementScope(params: {
  db: Pick<ApiDatabase, "users">;
  actor: UserProfile;
  organization: EnterpriseOrg;
  topics: readonly OrgTrainingRecord[];
  assignments: readonly FocusTopicAssignment[];
  productSettings: Pick<
    OrganizationProductSettings,
    "allowUserAdminFocusTopicManagement" | "allowManagerFocusTopicManagement"
  >;
  platformAdmin?: boolean;
}): FocusTopicManagementScope {
  const currentMember = params.organization.status === "active"
    && params.actor.accountType === "enterprise"
    && params.actor.orgId === params.organization.id
    && params.actor.status === "active"
    && Boolean(params.actor.emailVerifiedAt);
  if (params.platformAdmin === true || params.actor.isSuperUser === true
    || (params.actor.orgRole === "org_admin" && currentMember)) {
    return {
      canManageAllTopics: true,
      manageableTopicIds: new Set(params.topics
        .filter((topic) => topic.orgId === params.organization.id)
        .map((topic) => topic.id)),
    };
  }

  const manageableTopicIds = new Set(params.topics
    .filter((topic) => canFutureActorManageFocusTopic({
      actor: params.actor,
      users: params.db.users,
      organization: params.organization,
      topic,
      assignments: params.assignments,
      productSettings: params.productSettings,
    }))
    .map((topic) => topic.id));

  return { canManageAllTopics: false, manageableTopicIds };
}

export type ManagementGrantValidationResult =
  | { ok: true; audience: "individual" | "manager_only"; subject: UserProfile }
  | { ok: false; error: string };

export function validateFocusTopicManagementGrant(params: {
  db: Pick<ApiDatabase, "users">;
  organization: EnterpriseOrg;
  audience: FocusTopicAssignmentAudience;
  subjectUserId: string | null;
}): ManagementGrantValidationResult {
  if (params.audience !== "individual" && params.audience !== "manager_only") {
    return { ok: false, error: "Management grants must target one User Admin or Manager." };
  }
  if (!params.subjectUserId) {
    return { ok: false, error: "Management grant subject is required." };
  }
  const subject = params.db.users.find((user) => user.id === params.subjectUserId);
  if (!subject
    || subject.accountType !== "enterprise"
    || subject.orgId !== params.organization.id
    || subject.status !== "active"
    || !subject.emailVerifiedAt) {
    return { ok: false, error: "Management grant subject is not an active organization member." };
  }
  if (params.audience === "individual") {
    return subject.orgRole === "user_admin"
      ? { ok: true, audience: "individual", subject }
      : { ok: false, error: "Individual management grants require a User Admin subject." };
  }
  const hasActiveDirectReport = params.db.users.some((user) => user.accountType === "enterprise"
    && user.orgId === params.organization.id
    && user.status === "active"
    && user.managerUserId === subject.id);
  return hasActiveDirectReport
    ? { ok: true, audience: "manager_only", subject }
    : { ok: false, error: "Manager management grants require an active direct report." };
}
