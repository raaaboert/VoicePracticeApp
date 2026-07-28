import type { MobileOnboardRequest, MobileVerifyEmailRequest, UserProfile } from "@voicepractice/shared";

export type MobileSetupStep = "onboarding" | "verify_email" | "ready";

export function hasRequiredMobileNames(user: Pick<UserProfile, "firstName" | "lastName"> | null | undefined): boolean {
  return Boolean(user?.firstName?.trim() && user?.lastName?.trim());
}

export function hasCompleteMobileProfile(
  user: Pick<UserProfile, "emailVerifiedAt" | "firstName" | "lastName"> | null | undefined,
): boolean {
  return Boolean(user?.emailVerifiedAt && hasRequiredMobileNames(user));
}

export function isCompanyCodeRequiredForSetup(
  user: Pick<UserProfile, "accountType" | "isSuperUser" | "mobileProfileReonboardingRequired"> | null | undefined,
): boolean {
  return Boolean(
    user?.accountType === "enterprise" &&
      user.isSuperUser !== true &&
      user.mobileProfileReonboardingRequired === true,
  );
}

export function resolveMobileSetupStep(
  user: Pick<
    UserProfile,
    "emailVerifiedAt" | "firstName" | "lastName" | "accountType" | "isSuperUser" | "mobileProfileReonboardingRequired"
  > | null | undefined,
): MobileSetupStep {
  if (!user) {
    return "onboarding";
  }

  if (isCompanyCodeRequiredForSetup(user) || !hasRequiredMobileNames(user)) {
    return "onboarding";
  }

  if (!user.emailVerifiedAt) {
    return "verify_email";
  }

  return "ready";
}

export function canStartMobileUpdates(
  user: Pick<
    UserProfile,
    "emailVerifiedAt" | "firstName" | "lastName" | "accountType" | "isSuperUser" | "mobileProfileReonboardingRequired"
  > | null | undefined,
  screen: string,
): boolean {
  if (!user || user.isSuperUser === true) {
    return false;
  }
  if (screen === "onboarding" || screen === "verify_email") {
    return false;
  }
  return resolveMobileSetupStep(user) === "ready";
}

export function buildMobileOnboardRequest(input: {
  email: string;
  firstName: string;
  lastName: string;
  timezone: string;
  companyCode: string;
}): MobileOnboardRequest {
  const request: MobileOnboardRequest = {
    email: input.email.trim().toLowerCase(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    timezone: input.timezone.trim(),
  };
  const joinCode = input.companyCode.trim();
  if (joinCode) {
    request.joinCode = joinCode;
  }
  return request;
}

export function buildMobileVerifyProfile(input: {
  firstName: string;
  lastName: string;
  companyCode: string;
}): Pick<MobileVerifyEmailRequest, "firstName" | "lastName" | "joinCode"> {
  const profile: Pick<MobileVerifyEmailRequest, "firstName" | "lastName" | "joinCode"> = {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
  };
  const joinCode = input.companyCode.trim();
  if (joinCode) {
    profile.joinCode = joinCode;
  }
  return profile;
}

export function shouldShowOrgRequestPendingScreen(companyCode: string, user: UserProfile): boolean {
  return Boolean(companyCode.trim() && user.accountType === "individual" && user.isSuperUser !== true);
}
