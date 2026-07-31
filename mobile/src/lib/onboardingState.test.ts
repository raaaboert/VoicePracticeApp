import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfile } from "@voicepractice/shared";

import {
  buildMobileOnboardRequest,
  buildMobileVerifyProfile,
  canStartMobileUpdates,
  hasApprovedMobileOrganizationAccess,
  hasCompleteMobileProfile,
  isCompanyCodeRequiredForSetup,
  resolveMobileSetupStep,
  shouldShowCompanyAccessScreen,
} from "./onboardingState";

const COMPLETE_USER = {
  id: "user_1",
  email: "user@example.com",
  emailVerifiedAt: "2026-07-27T12:00:00.000Z",
  firstName: "Free",
  lastName: "User",
  accountType: "individual",
  status: "active",
  isSuperUser: false,
  mobileProfileReonboardingRequired: false,
} as UserProfile;

test("mobile setup state requires verified email and nonblank names before app access", () => {
  assert.equal(resolveMobileSetupStep(null), "onboarding");
  assert.equal(hasCompleteMobileProfile(COMPLETE_USER), true);
  assert.equal(resolveMobileSetupStep(COMPLETE_USER), "ready");
  assert.equal(canStartMobileUpdates(COMPLETE_USER, "home"), true);
  assert.equal(canStartMobileUpdates(COMPLETE_USER, "onboarding"), false);
  assert.equal(canStartMobileUpdates(COMPLETE_USER, "verify_email"), false);

  const missingNames = { ...COMPLETE_USER, firstName: " ", lastName: null };
  assert.equal(hasCompleteMobileProfile(missingNames), false);
  assert.equal(resolveMobileSetupStep(missingNames), "onboarding");
  assert.equal(canStartMobileUpdates(missingNames, "home"), false);

  const unverified = { ...COMPLETE_USER, emailVerifiedAt: null };
  assert.equal(resolveMobileSetupStep(unverified), "verify_email");
  assert.equal(canStartMobileUpdates(unverified, "home"), false);
});

test("mobile setup requires company code only for flagged enterprise re-onboarding", () => {
  const flaggedEnterprise = {
    ...COMPLETE_USER,
    accountType: "enterprise",
    orgId: "org_1",
    mobileProfileReonboardingRequired: true,
  } as UserProfile;

  assert.equal(isCompanyCodeRequiredForSetup(flaggedEnterprise), true);
  assert.equal(resolveMobileSetupStep(flaggedEnterprise), "onboarding");
  assert.equal(canStartMobileUpdates(flaggedEnterprise, "home"), false);
  assert.equal(isCompanyCodeRequiredForSetup(COMPLETE_USER), false);
});

test("mobile onboarding payloads omit blank company code and trim provided values", () => {
  assert.deepEqual(
    buildMobileOnboardRequest({
      email: "  PERSON@EXAMPLE.COM ",
      firstName: " Ada ",
      lastName: " Lovelace ",
      timezone: " America/Denver ",
      companyCode: "   ",
    }),
    {
      email: "person@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      timezone: "America/Denver",
    },
  );

  assert.deepEqual(
    buildMobileVerifyProfile({
      firstName: " Grace ",
      lastName: " Hopper ",
      companyCode: " acme2026 ",
    }),
    {
      firstName: "Grace",
      lastName: "Hopper",
      joinCode: "acme2026",
    },
  );
});

test("verified individual and pending users remain in Company Access until enterprise approval", () => {
  assert.equal(hasApprovedMobileOrganizationAccess(COMPLETE_USER), false);
  assert.equal(shouldShowCompanyAccessScreen(COMPLETE_USER), true);
  assert.equal(
    shouldShowCompanyAccessScreen({
      ...COMPLETE_USER,
      accountType: "enterprise",
      orgId: "org_1",
    } as UserProfile),
    false,
  );
  assert.equal(
    hasApprovedMobileOrganizationAccess({
      ...COMPLETE_USER,
      isSuperUser: true,
    } as UserProfile),
    true,
  );
});
