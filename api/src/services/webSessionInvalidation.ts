import type { ApiDatabase, UserProfile } from "@voicepractice/shared";

// The web session is an authorization credential. Purge on either a loss or a
// re-grant so a credential from an earlier privilege period cannot revive.
function authorizationFingerprint(user: UserProfile): string {
  return JSON.stringify([
    user.email,
    user.emailVerifiedAt,
    user.status,
    user.accountType,
    user.orgId,
    user.orgRole,
    user.dashboardAccessEnabled === true,
    user.isSuperUser === true,
    user.isPlatformAdmin === true,
    user.managerUserId ?? null,
    user.performanceAccess ?? "none",
    user.divisionId ?? null,
  ]);
}

export function collectWebSessionInvalidations(
  before: Pick<ApiDatabase, "users" | "orgs">,
  after: Pick<ApiDatabase, "users" | "orgs">,
): string[] {
  const changedOrgIds = new Set<string>();
  const orgsBefore = new Map(before.orgs.map((org) => [org.id, org]));
  const orgsAfter = new Map(after.orgs.map((org) => [org.id, org]));
  for (const orgId of new Set([...orgsBefore.keys(), ...orgsAfter.keys()])) {
    if ((orgsBefore.get(orgId)?.status ?? null) !== (orgsAfter.get(orgId)?.status ?? null)) {
      changedOrgIds.add(orgId);
    }
  }

  const usersBefore = new Map(before.users.map((user) => [user.id, user]));
  const usersAfter = new Map(after.users.map((user) => [user.id, user]));
  const affected = new Set<string>();
  for (const userId of new Set([...usersBefore.keys(), ...usersAfter.keys()])) {
    const previous = usersBefore.get(userId);
    const current = usersAfter.get(userId);
    if (
      !previous || !current
      || authorizationFingerprint(previous) !== authorizationFingerprint(current)
      || (previous.orgId !== null && changedOrgIds.has(previous.orgId))
      || (current.orgId !== null && changedOrgIds.has(current.orgId))
    ) {
      affected.add(userId);
    }
  }
  return [...affected].sort();
}
