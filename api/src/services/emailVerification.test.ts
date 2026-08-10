import assert from "node:assert/strict";
import test from "node:test";

import { ApiDatabase, EmailVerificationRecord, UserProfile } from "@voicepractice/shared";

import {
  AppReviewCredential,
  hashEmailVerificationCode,
  timingSafeEqualText,
  verifyLatestEmailVerification,
} from "./emailVerification.js";

const CODE_SECRET = "email_verification_test_secret_123456789";
const NORMAL_CODE = "123456";
const REVIEWER_CODE = "808080";
const NOW = new Date("2026-08-10T12:00:00.000Z");
const REVIEWER_CREDENTIAL: AppReviewCredential = {
  email: "reviewer@example.test",
  code: REVIEWER_CODE,
};

function buildUser(email: string, id = "user_1"): UserProfile {
  return {
    id,
    email,
    firstName: null,
    lastName: null,
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: null,
    mobileProfileReonboardingRequired: false,
    accountType: "individual",
    tier: "free",
    status: "active",
    orgId: null,
    orgRole: "user",
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: NOW.toISOString(),
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function buildChallenge(
  user: UserProfile,
  code = NORMAL_CODE,
  overrides: Partial<EmailVerificationRecord> = {}
): EmailVerificationRecord {
  return {
    id: "verification_1",
    userId: user.id,
    email: user.email,
    codeHash: hashEmailVerificationCode(CODE_SECRET, user.id, user.email, code),
    createdAt: "2026-08-10T11:55:00.000Z",
    expiresAt: "2026-08-10T12:10:00.000Z",
    consumedAt: null,
    ...overrides,
  };
}

function buildDb(challenges: EmailVerificationRecord[]): ApiDatabase {
  return { emailVerifications: challenges } as ApiDatabase;
}

function verify(params: {
  user: UserProfile;
  code: string;
  challenges?: EmailVerificationRecord[];
  credential?: AppReviewCredential | null;
  now?: Date;
}) {
  const challenges = params.challenges ?? [buildChallenge(params.user)];
  const db = buildDb(challenges);
  const result = verifyLatestEmailVerification({
    db,
    user: params.user,
    code: params.code,
    now: params.now ?? NOW,
    codeSecret: CODE_SECRET,
    appReviewCredential: params.credential,
  });
  return { result, challenges };
}

test("normal user with a valid normal OTP succeeds and consumes the challenge", () => {
  const user = buildUser("normal@example.test");
  const { result, challenges } = verify({ user, code: NORMAL_CODE, credential: REVIEWER_CREDENTIAL });

  assert.equal(result, "ok");
  assert.equal(challenges[0]?.consumedAt, NOW.toISOString());
});

test("normal user cannot use the configured reviewer fixed code", () => {
  const user = buildUser("normal@example.test");
  const { result, challenges } = verify({ user, code: REVIEWER_CODE, credential: REVIEWER_CREDENTIAL });

  assert.equal(result, "invalid");
  assert.equal(challenges[0]?.consumedAt, null);
});

test("reviewer fixed code is disabled when the caller does not supply reviewer configuration", () => {
  const user = buildUser(REVIEWER_CREDENTIAL.email);
  const { result, challenges } = verify({ user, code: REVIEWER_CODE, credential: null });

  assert.equal(result, "invalid");
  assert.equal(challenges[0]?.consumedAt, null);
});

test("exact reviewer user can use the fixed code and consumes the current challenge", () => {
  const user = buildUser(REVIEWER_CREDENTIAL.email);
  const { result, challenges } = verify({ user, code: REVIEWER_CODE, credential: REVIEWER_CREDENTIAL });

  assert.equal(result, "ok");
  assert.equal(challenges[0]?.consumedAt, NOW.toISOString());
});

test("reviewer user can still use the generated normal OTP", () => {
  const user = buildUser(REVIEWER_CREDENTIAL.email);
  const { result, challenges } = verify({ user, code: NORMAL_CODE, credential: REVIEWER_CREDENTIAL });

  assert.equal(result, "ok");
  assert.equal(challenges[0]?.consumedAt, NOW.toISOString());
});

test("reviewer fixed-code mismatch falls through to a valid normal OTP", () => {
  const user = buildUser(REVIEWER_CREDENTIAL.email);
  const normalOtpAlsoUsedAsInput = "343434";
  const challenge = buildChallenge(user, normalOtpAlsoUsedAsInput);
  const { result } = verify({
    user,
    code: normalOtpAlsoUsedAsInput,
    challenges: [challenge],
    credential: REVIEWER_CREDENTIAL,
  });

  assert.equal(result, "ok");
});

test("reviewer user with an invalid code receives the normal invalid result", () => {
  const user = buildUser(REVIEWER_CREDENTIAL.email);
  const { result } = verify({ user, code: "999999", credential: REVIEWER_CREDENTIAL });

  assert.equal(result, "invalid");
});

test("expired challenge fails even with the correct reviewer code", () => {
  const user = buildUser(REVIEWER_CREDENTIAL.email);
  const challenge = buildChallenge(user, NORMAL_CODE, { expiresAt: NOW.toISOString() });
  const { result } = verify({ user, code: REVIEWER_CODE, challenges: [challenge], credential: REVIEWER_CREDENTIAL });

  assert.equal(result, "expired");
  assert.equal(challenge.consumedAt, NOW.toISOString());
});

test("consumed and missing challenges fail even with the correct reviewer code", () => {
  const user = buildUser(REVIEWER_CREDENTIAL.email);
  const consumed = buildChallenge(user, NORMAL_CODE, { consumedAt: "2026-08-10T11:58:00.000Z" });

  assert.equal(verify({ user, code: REVIEWER_CODE, challenges: [consumed], credential: REVIEWER_CREDENTIAL }).result, "missing");
  assert.equal(verify({ user, code: REVIEWER_CODE, challenges: [], credential: REVIEWER_CREDENTIAL }).result, "missing");
});

test("reviewer matching is exact after trimming and lowercasing the persisted email", () => {
  const normalizedUser = buildUser("  Reviewer@Example.Test  ");
  const nearMatchUser = buildUser("reviewer+other@example.test", "user_2");

  assert.equal(
    verify({ user: normalizedUser, code: REVIEWER_CODE, credential: REVIEWER_CREDENTIAL }).result,
    "ok"
  );
  assert.equal(
    verify({ user: nearMatchUser, code: REVIEWER_CODE, credential: REVIEWER_CREDENTIAL }).result,
    "invalid"
  );
});

test("reviewer fixed code cannot authenticate another user with a distinct email", () => {
  const otherUser = buildUser("other@example.test", "other_user");
  const { result } = verify({ user: otherUser, code: REVIEWER_CODE, credential: REVIEWER_CREDENTIAL });

  assert.equal(result, "invalid");
});

test("timing-safe text comparison covers equal, unequal, and unequal-length secrets", () => {
  assert.equal(timingSafeEqualText(REVIEWER_CODE, REVIEWER_CODE), true);
  assert.equal(timingSafeEqualText(REVIEWER_CODE, "808081"), false);
  assert.equal(timingSafeEqualText(REVIEWER_CODE, "80808"), false);
});
