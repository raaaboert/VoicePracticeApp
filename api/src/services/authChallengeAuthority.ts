import type { ApiDatabase, UserProfile } from "@voicepractice/shared";
import { authorizationFingerprint, collectWebSessionInvalidations } from "./webSessionInvalidation.js";

export type VerificationAuthorityState = Pick<ApiDatabase, "users" | "orgs"> & Partial<Pick<ApiDatabase,
  "mobileAuthTokens" | "emailVerifications" | "webAuthChallenges">>;

/** Binding material is HMACed by the store, never persisted or logged as plaintext. */
export function verificationAuthorityMaterial(db: VerificationAuthorityState, user: UserProfile): string {
  const org = db.orgs.find((org) => org.id === user.orgId);
  const token = db.mobileAuthTokens?.find((token) => token.userId === user.id);
  const reports = db.users.filter((report) => report.accountType === "enterprise" && report.managerUserId === user.id && report.orgId === user.orgId && report.status === "active")
    .map((report) => [report.id, report.updatedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([authorizationFingerprint(user), user.updatedAt, org?.status, org?.updatedAt, token?.tokenHash, reports]);
}

export function canVerifyCurrentIdentity(db: VerificationAuthorityState, user: UserProfile, allowPlatformAdmin = true): boolean {
  return user.status === "active" && (user.accountType !== "enterprise" || user.isSuperUser === true || (allowPlatformAdmin && user.isPlatformAdmin === true)
    || db.orgs.some((org) => org.id === user.orgId && org.status === "active"));
}

/** Broader challenge cancellation does not alter the established session-revocation policy. */
export function collectAuthChallengeInvalidations(before: VerificationAuthorityState, after: VerificationAuthorityState): string[] {
  const affected = new Set(collectWebSessionInvalidations(before, after));
  const usersBefore = new Map(before.users.map((user) => [user.id, user]));
  const usersAfter = new Map(after.users.map((user) => [user.id, user]));
  const tokensBefore = new Map(before.mobileAuthTokens?.map((token) => [token.userId, token.tokenHash]));
  const tokensAfter = new Map(after.mobileAuthTokens?.map((token) => [token.userId, token.tokenHash]));
  for (const id of new Set([...tokensBefore.keys(), ...tokensAfter.keys()])) {
    if (tokensBefore.get(id) !== tokensAfter.get(id)) affected.add(id);
  }
  for (const id of new Set([...usersBefore.keys(), ...usersAfter.keys()])) {
    const oldUser = usersBefore.get(id), newUser = usersAfter.get(id);
    if (oldUser?.managerUserId !== newUser?.managerUserId || oldUser?.status !== newUser?.status || oldUser?.orgId !== newUser?.orgId || oldUser?.accountType !== newUser?.accountType) {
      if (oldUser?.managerUserId) affected.add(oldUser.managerUserId);
      if (newUser?.managerUserId) affected.add(newUser.managerUserId);
    }
  }
  // Preserve explicit legacy challenge-clear actions even if no profile field changed.
  for (const field of ["emailVerifications", "webAuthChallenges"] as const) {
    const remaining = new Set(after[field]?.map((challenge) => challenge.id));
    for (const challenge of before[field] ?? []) if (!remaining.has(challenge.id)) affected.add(challenge.userId);
  }
  return [...affected].sort();
}
