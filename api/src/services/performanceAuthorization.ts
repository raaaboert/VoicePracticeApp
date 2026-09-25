import {
  type ApiDatabase,
  type DashboardViewer,
  type PerformanceAccessLevel,
  type UserProfile,
} from "@voicepractice/shared";

import { normalizeManagerUserId, normalizePerformanceAccess } from "./userProfiles.js";

export interface PerformanceAuthorizationUser {
  readonly id: string;
  readonly accountType: UserProfile["accountType"];
  readonly orgId: string | null;
  readonly orgRole: UserProfile["orgRole"];
  readonly isSuperUser?: boolean;
  readonly managerUserId?: string | null;
  readonly performanceAccess?: PerformanceAccessLevel;
}

export function resolvePerformanceAccessLevel(
  actor: PerformanceAuthorizationUser,
  validOrganizationIds?: ReadonlySet<string>
): PerformanceAccessLevel {
  return normalizePerformanceAccess(actor, validOrganizationIds);
}

function isDashboardSuperUser(actor: PerformanceAuthorizationUser, viewer: DashboardViewer): boolean {
  return viewer.accessType === "super_user" && actor.isSuperUser === true;
}

export function canViewPerformanceTarget(params: {
  actor: PerformanceAuthorizationUser;
  viewer?: DashboardViewer;
  target: PerformanceAuthorizationUser;
  validOrganizationIds?: ReadonlySet<string>;
}): boolean {
  if (params.viewer && isDashboardSuperUser(params.actor, params.viewer)) {
    return (
      params.target.accountType === "enterprise" &&
      Boolean(params.target.orgId) &&
      (!params.validOrganizationIds || params.validOrganizationIds.has(params.target.orgId!))
    );
  }

  if (
    !params.viewer &&
    params.actor.isSuperUser === true &&
    params.actor.accountType === "enterprise" &&
    params.target.accountType === "enterprise" &&
    Boolean(params.actor.orgId) &&
    params.actor.orgId === params.target.orgId
  ) {
    return true;
  }

  if (params.actor.accountType !== "enterprise" || params.target.accountType !== "enterprise") {
    return false;
  }
  if (!params.actor.orgId || params.actor.orgId !== params.target.orgId) {
    return false;
  }
  if (params.validOrganizationIds && !params.validOrganizationIds.has(params.actor.orgId)) {
    return false;
  }

  const accessLevel = resolvePerformanceAccessLevel(params.actor, params.validOrganizationIds);
  if (accessLevel === "organization") {
    return true;
  }
  if (accessLevel !== "team") {
    return false;
  }

  if (params.target.id === params.actor.id) {
    return true;
  }

  return (
    params.target.orgRole === "user" &&
    normalizeManagerUserId(params.target.managerUserId) === params.actor.id
  );
}

export function resolvePerformanceScope(params: {
  db: Pick<ApiDatabase, "users"> | { users: readonly PerformanceAuthorizationUser[] };
  actor: PerformanceAuthorizationUser;
  viewer: DashboardViewer;
  orgIds?: ReadonlySet<string> | null;
}): Set<string> {
  const validOrganizationIds = params.orgIds ?? undefined;
  const permitted = new Set<string>();

  for (const target of params.db.users) {
    if (
      canViewPerformanceTarget({
        actor: params.actor,
        viewer: params.viewer,
        target,
        validOrganizationIds,
      })
    ) {
      permitted.add(target.id);
    }
  }

  return permitted;
}

export function getDashboardPermittedUserIds(params: {
  db: Pick<ApiDatabase, "users"> | { users: readonly PerformanceAuthorizationUser[] };
  actor: PerformanceAuthorizationUser;
  viewer: DashboardViewer;
  orgIds?: ReadonlySet<string> | null;
}): Set<string> {
  return resolvePerformanceScope(params);
}

export function canActorManagePerformanceUser(params: {
  actor: PerformanceAuthorizationUser;
  viewer: DashboardViewer;
  target: PerformanceAuthorizationUser;
}): boolean {
  return canViewPerformanceTarget(params);
}

export function canViewOrganizationPerformance(params: {
  actor: PerformanceAuthorizationUser;
  orgId: string;
}): boolean {
  if (params.actor.accountType !== "enterprise" || params.actor.orgId !== params.orgId) {
    return false;
  }

  if (params.actor.isSuperUser === true) {
    return true;
  }

  return resolvePerformanceAccessLevel(params.actor, new Set([params.orgId])) === "organization";
}
