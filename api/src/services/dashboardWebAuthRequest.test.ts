import assert from "node:assert/strict";
import test from "node:test";

import { ApiDatabase, UserProfile, WebAuthRequestCodeResponse } from "@voicepractice/shared";

import { AuthCodeDeliveryError } from "./authCodeDelivery.js";
import {
  DASHBOARD_WEB_AUTH_REQUEST_CODE_DELIVERY_FAILURE_MESSAGE,
  DASHBOARD_WEB_AUTH_REQUEST_CODE_MESSAGE,
  handleDashboardWebAuthCodeRequest,
} from "./dashboardWebAuthRequest.js";

function createDb(params?: {
  users?: UserProfile[];
  orgs?: Array<{ id: string; name: string; status: "active" | "disabled" }>;
}): ApiDatabase {
  return {
    users: params?.users ?? [],
    orgs: (params?.orgs ?? []).map((org) => ({
      id: org.id,
      name: org.name,
      status: org.status,
    })),
  } as ApiDatabase;
}

function createUser(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: "user_1",
    email: "eligible@example.com",
    emailVerifiedAt: "2026-03-30T00:00:00.000Z",
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: true,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_active",
    orgRole: "org_admin",
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: "2026-03-01T00:00:00.000Z",
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    ...overrides,
  };
}

test("dashboard request-code returns the same public response for unknown and ineligible emails", async () => {
  const eligibleUser = createUser();
  const inactiveUser = createUser({
    id: "user_inactive",
    email: "inactive@example.com",
    status: "disabled",
  });
  const inactiveOrgUser = createUser({
    id: "user_inactive_org",
    email: "inactive-org@example.com",
    orgId: "org_disabled",
  });
  const db = createDb({
    users: [eligibleUser, inactiveUser, inactiveOrgUser],
    orgs: [
      { id: "org_active", name: "Active Org", status: "active" },
      { id: "org_disabled", name: "Disabled Org", status: "disabled" },
    ],
  });

  const expectedPublicResponse: WebAuthRequestCodeResponse = {
    ok: true,
    status: "acknowledged",
    message: DASHBOARD_WEB_AUTH_REQUEST_CODE_MESSAGE,
  };

  let issuedSignInCodes = 0;
  const request = (email: string) =>
    handleDashboardWebAuthCodeRequest({
      db,
      email,
      now: new Date("2026-03-30T12:00:00.000Z"),
      issueSignInCode: async () => {
        issuedSignInCodes += 1;
        return {
          expiresAt: "2026-03-30T12:15:00.000Z",
          delivery: "email",
        };
      },
      issueEmailVerificationCode: async () => {
        throw new Error("Email verification should not be used in this test.");
      },
    });

  const unknownResult = await request("missing@example.com");
  const inactiveUserResult = await request("inactive@example.com");
  const inactiveOrgResult = await request("inactive-org@example.com");
  const eligibleResult = await request("eligible@example.com");

  assert.equal(unknownResult.outcome, "acknowledged");
  assert.equal(inactiveUserResult.outcome, "acknowledged");
  assert.equal(inactiveOrgResult.outcome, "acknowledged");
  assert.equal(eligibleResult.outcome, "issued");

  assert.deepEqual(unknownResult.response, expectedPublicResponse);
  assert.deepEqual(inactiveUserResult.response, expectedPublicResponse);
  assert.deepEqual(inactiveOrgResult.response, expectedPublicResponse);
  assert.deepEqual(eligibleResult.response, {
    ok: true,
    status: "code_sent",
    message: DASHBOARD_WEB_AUTH_REQUEST_CODE_MESSAGE,
  });

  assert.equal(unknownResult.reason, "user_not_found");
  assert.equal(inactiveUserResult.reason, "inactive_user");
  assert.equal(inactiveOrgResult.reason, "inactive_org");
  assert.equal(eligibleResult.challengeType, "sign_in");
  assert.equal(issuedSignInCodes, 1);
});

test("dashboard request-code returns an explicit failure when eligible delivery fails", async () => {
  const eligibleUser = createUser();
  const db = createDb({
    users: [eligibleUser],
    orgs: [{ id: "org_active", name: "Active Org", status: "active" }],
  });

  const result = await handleDashboardWebAuthCodeRequest({
    db,
    email: eligibleUser.email,
    now: new Date("2026-03-30T12:00:00.000Z"),
    issueSignInCode: async () => {
      throw new AuthCodeDeliveryError("Resend delivery failed.");
    },
    issueEmailVerificationCode: async () => {
      throw new Error("Email verification should not be used in this test.");
    },
  });

  assert.equal(result.outcome, "delivery_failed");
  assert.equal(result.reason, "sign_in_delivery_failed");
  assert.equal(result.publicMessage, DASHBOARD_WEB_AUTH_REQUEST_CODE_DELIVERY_FAILURE_MESSAGE);
  assert.equal(result.statusCode, 502);
  assert.match(result.error.message, /Resend delivery failed/);
});

test("dashboard request-code issues an email verification code for an eligible unverified user", async () => {
  const unverifiedUser = createUser({
    id: "user_unverified",
    email: "unverified@example.com",
    emailVerifiedAt: null,
  });
  const db = createDb({
    users: [unverifiedUser],
    orgs: [{ id: "org_active", name: "Active Org", status: "active" }],
  });

  let signInRequests = 0;
  let emailVerificationRequests = 0;

  const result = await handleDashboardWebAuthCodeRequest({
    db,
    email: unverifiedUser.email,
    now: new Date("2026-03-30T12:00:00.000Z"),
    issueSignInCode: async () => {
      signInRequests += 1;
      return {
        expiresAt: "2026-03-30T12:15:00.000Z",
        delivery: "email",
      };
    },
    issueEmailVerificationCode: async () => {
      emailVerificationRequests += 1;
      return {
        expiresAt: "2026-03-30T12:15:00.000Z",
        delivery: "email",
      };
    },
  });

  assert.equal(result.outcome, "issued");
  assert.equal(result.challengeType, "email_verification");
  assert.deepEqual(result.response, {
    ok: true,
    status: "code_sent",
    message: DASHBOARD_WEB_AUTH_REQUEST_CODE_MESSAGE,
  });
  assert.equal(emailVerificationRequests, 1);
  assert.equal(signInRequests, 0);
});
