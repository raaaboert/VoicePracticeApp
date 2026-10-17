import type { UserProfile } from "@voicepractice/shared";

const PLACEHOLDER_DATE = "1970-01-01T00:00:00.000Z";

/** Compatibility shell for unverified clients. Never accepts or spreads a stored profile. */
export function buildUnverifiedMobileProfile(input: {
  userId: string; email: string; firstName: string; lastName: string; timezone: string;
}): UserProfile {
  return {
    id: input.userId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    timezone: input.timezone,
    emailVerifiedAt: null,
    employeeId: null,
    managerUserId: null,
    divisionId: null,
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: false,
    mobileProfileReonboardingRequired: false,
    accountType: "individual",
    tier: "free",
    status: "active",
    orgId: null,
    orgRole: "user",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: PLACEHOLDER_DATE,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: PLACEHOLDER_DATE,
    updatedAt: PLACEHOLDER_DATE,
  };
}
