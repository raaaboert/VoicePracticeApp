import {
  isOrgUserRole,
  isPerformanceAccessLevel,
  type DashboardViewer,
  type OrgUserRole,
  type PerformanceAccessLevel,
  type UserProfile,
} from "@voicepractice/shared";

export const USER_PROFILE_NAME_MAX_LENGTH = 80;
export const USER_PROFILE_NAME_NOT_PROVIDED = "Not provided";

export type UserNameField = "firstName" | "lastName";

export type UserNameNormalizationResult =
  | { ok: true; value: string }
  | { ok: false; error: string; code: "user_name_invalid" };

export function normalizeRequiredUserNameInput(value: unknown, field: UserNameField): UserNameNormalizationResult {
  const label = field === "firstName" ? "First name" : "Last name";
  if (typeof value !== "string") {
    return {
      ok: false,
      error: `${label} is required.`,
      code: "user_name_invalid",
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: `${label} is required.`,
      code: "user_name_invalid",
    };
  }

  if (trimmed.length > USER_PROFILE_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `${label} must be ${USER_PROFILE_NAME_MAX_LENGTH} characters or fewer.`,
      code: "user_name_invalid",
    };
  }

  return { ok: true, value: trimmed };
}

export function normalizeOptionalStoredUserName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, USER_PROFILE_NAME_MAX_LENGTH) : null;
}

export function getUserFirstName(user: UserProfile): string | null {
  return normalizeOptionalStoredUserName(user.firstName);
}

export function getUserLastName(user: UserProfile): string | null {
  return normalizeOptionalStoredUserName(user.lastName);
}

export function hasCompleteUserName(user: UserProfile): boolean {
  return Boolean(getUserFirstName(user) && getUserLastName(user));
}

export function resolveStoredUserDisplayName(user: UserProfile): string {
  const names = [getUserFirstName(user), getUserLastName(user)].filter(Boolean);
  return names.length > 0 ? names.join(" ") : USER_PROFILE_NAME_NOT_PROVIDED;
}

export function normalizeManagerUserId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizePerformanceAccess(user: {
  accountType?: unknown;
  orgId?: unknown;
  orgRole?: unknown;
  performanceAccess?: unknown;
}, validOrganizationIds?: ReadonlySet<string>): PerformanceAccessLevel {
  const hasOrganizationContext =
    user.accountType === "enterprise" &&
    typeof user.orgId === "string" &&
    user.orgId.trim().length > 0 &&
    (!validOrganizationIds || validOrganizationIds.has(user.orgId));
  if (!hasOrganizationContext) {
    return "none";
  }

  if (typeof user.performanceAccess === "string" && isPerformanceAccessLevel(user.performanceAccess)) {
    return user.performanceAccess;
  }

  const orgRole = typeof user.orgRole === "string" && isOrgUserRole(user.orgRole) ? user.orgRole : "user";
  if (orgRole === "org_admin") {
    return "organization";
  }
  if (orgRole === "user_admin") {
    return "team";
  }
  return "none";
}

// Manager relationships currently require an active User Admin. Keep this
// separate from Learning Resource content subjects and future performance rules.
export function canBeAssignedAsManager(user: UserProfile, orgId: string): boolean {
  return (
    user.accountType === "enterprise" &&
    user.orgId === orgId &&
    user.status === "active" &&
    user.orgRole === "user_admin"
  );
}

// Learning Resource manager and manager-team assignments intentionally retain the
// current active User Admin requirement. Keep this separate from manager
// relationship eligibility and future performance visibility rules.
export function isContentManagerSubject(user: UserProfile, orgId: string): boolean {
  return (
    user.accountType === "enterprise" &&
    user.orgId === orgId &&
    user.status === "active" &&
    user.orgRole === "user_admin"
  );
}

export function isRegularManagedUser(user: UserProfile): boolean {
  return user.accountType === "enterprise" && user.orgRole === "user";
}

export function canActorSeeOrganizationUser(params: {
  actor: UserProfile;
  viewer: DashboardViewer;
  target: UserProfile;
}): boolean {
  if (params.viewer.accessType === "super_user" && params.actor.isSuperUser === true) {
    return true;
  }

  return canEnterpriseActorSeeOrganizationUser(params);
}

export function canEnterpriseActorSeeOrganizationUser(params: {
  actor: UserProfile;
  target: UserProfile;
}): boolean {
  if (params.actor.accountType !== "enterprise" || params.target.accountType !== "enterprise") {
    return false;
  }
  if (!params.actor.orgId || params.actor.orgId !== params.target.orgId) {
    return false;
  }
  if (params.actor.orgRole === "org_admin") {
    return true;
  }
  if (params.actor.orgRole !== "user_admin") {
    return false;
  }

  return (
    params.target.id === params.actor.id ||
    (params.target.orgRole === "user" && normalizeManagerUserId(params.target.managerUserId) === params.actor.id)
  );
}

export function listVisibleOrganizationUsers(params: {
  users: readonly UserProfile[];
  actor: UserProfile;
  viewer: DashboardViewer;
  orgId: string;
}): UserProfile[] {
  return params.users.filter((user) => {
    if (user.accountType !== "enterprise" || user.orgId !== params.orgId) {
      return false;
    }
    return canActorSeeOrganizationUser({
      actor: params.actor,
      viewer: params.viewer,
      target: user,
    });
  });
}

export function canManagerAssignmentTargetBeManaged(target: UserProfile): boolean {
  return target.accountType === "enterprise" && target.orgRole === "user";
}

export function validateManagerAssignment(params: {
  orgUsers: readonly UserProfile[];
  target: UserProfile;
  managerUserId: string | null;
}): { ok: true; manager: UserProfile | null } | { ok: false; error: string; code: "manager_invalid" } {
  if (!canManagerAssignmentTargetBeManaged(params.target)) {
    return {
      ok: false,
      error: "Managers can only be assigned to regular users.",
      code: "manager_invalid",
    };
  }

  if (!params.managerUserId) {
    return { ok: true, manager: null };
  }

  if (params.managerUserId === params.target.id) {
    return {
      ok: false,
      error: "A user cannot be assigned as their own manager.",
      code: "manager_invalid",
    };
  }

  const manager = params.orgUsers.find((user) => user.id === params.managerUserId) ?? null;
  if (!manager || !params.target.orgId || !canBeAssignedAsManager(manager, params.target.orgId)) {
    return {
      ok: false,
      error: "Manager must be an active user admin in the same organization.",
      code: "manager_invalid",
    };
  }

  return { ok: true, manager };
}

export function clearAssignmentsForManager(params: {
  users: UserProfile[];
  managerUserId: string;
  updatedAt: string;
}): string[] {
  const clearedUserIds: string[] = [];
  for (const user of params.users) {
    if (normalizeManagerUserId(user.managerUserId) !== params.managerUserId) {
      continue;
    }
    user.managerUserId = null;
    user.updatedAt = params.updatedAt;
    clearedUserIds.push(user.id);
  }
  return clearedUserIds;
}

export function repairInvalidManagerAssignments(users: UserProfile[], updatedAt: string): string[] {
  const byId = new Map(users.map((user) => [user.id, user] as const));
  const repairedUserIds: string[] = [];

  for (const user of users) {
    const managerUserId = normalizeManagerUserId(user.managerUserId);
    if (!managerUserId) {
      user.managerUserId = null;
      continue;
    }

    const manager = byId.get(managerUserId) ?? null;
    const valid =
      canManagerAssignmentTargetBeManaged(user) &&
      Boolean(user.orgId) &&
      managerUserId !== user.id &&
      Boolean(manager && user.orgId && canBeAssignedAsManager(manager, user.orgId));

    if (!valid) {
      user.managerUserId = null;
      user.updatedAt = updatedAt;
      repairedUserIds.push(user.id);
    }
  }

  return repairedUserIds;
}

export function canActorManageRegularUser(params: {
  actor: UserProfile;
  viewer: DashboardViewer;
  target: UserProfile;
}): boolean {
  if (params.viewer.accessType === "super_user" && params.actor.isSuperUser === true) {
    return true;
  }

  return canEnterpriseActorManageRegularUser(params);
}

export function canEnterpriseActorManageRegularUser(params: {
  actor: UserProfile;
  target: UserProfile;
}): boolean {
  if (params.actor.accountType !== "enterprise" || params.target.accountType !== "enterprise") {
    return false;
  }
  if (!params.actor.orgId || params.actor.orgId !== params.target.orgId) {
    return false;
  }
  if (params.actor.orgRole === "org_admin") {
    return true;
  }
  if (params.actor.orgRole === "user_admin") {
    return params.target.orgRole === "user" && normalizeManagerUserId(params.target.managerUserId) === params.actor.id;
  }
  return false;
}

export function canOrgAdminManageRole(role: OrgUserRole): role is "user" | "user_admin" {
  return role === "user" || role === "user_admin";
}
