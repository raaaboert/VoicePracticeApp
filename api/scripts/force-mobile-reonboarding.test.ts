import assert from "node:assert/strict";
import test from "node:test";

import { ApiDatabase, createDefaultConfig, MobileAuthRecord, UserProfile } from "@voicepractice/shared";

import {
  appendResetAudit,
  applyReset,
  assertTargetSafety,
} from "./force-mobile-reonboarding.js";

const NOW = "2026-07-27T12:00:00.000Z";
const PRODUCTION_CONFIRMATION = "I understand this writes to production";

function buildUser(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    firstName: null,
    lastName: null,
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: false,
    mobileProfileReonboardingRequired: false,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
    divisionId: null,
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: NOW,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildToken(userId: string): MobileAuthRecord {
  return {
    userId,
    tokenHash: `hash_${userId}`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildDb(): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users: [
      buildUser("active_user"),
      buildUser("already_flagged", { mobileProfileReonboardingRequired: true }),
      buildUser("disabled_user", { status: "disabled" }),
      buildUser("individual_user", {
        accountType: "individual",
        tier: "free",
        orgId: null,
      }),
      buildUser("super_user", {
        isSuperUser: true,
        isPlatformAdmin: true,
        accountType: "individual",
        tier: "pro_plus",
        orgId: null,
      }),
    ],
    orgs: [],
    orgDivisions: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    usageSessions: [],
    mobileAuthTokens: [
      buildToken("active_user"),
      buildToken("already_flagged"),
      buildToken("disabled_user"),
      buildToken("individual_user"),
      buildToken("super_user"),
    ],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [],
    admin: {
      passwordHash: null,
      activeSessionIds: [],
    },
  };
}

function stagingTarget(databaseUrl = "postgres://peritio:secret@voicepractice-db.example.com/peritio") {
  return {
    storageProvider: "postgres" as const,
    dbPath: "db.local.json",
    databaseUrl,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
  };
}

function productionTarget(databaseUrl = "postgres://peritio:secret@peritio-db-prod.example.com/peritio") {
  return {
    ...stagingTarget(databaseUrl),
    databaseUrl,
  };
}

test("force mobile re-onboarding reset reports, applies, audits, and replays idempotently", () => {
  const db = buildDb();

  const report = applyReset(db, NOW);
  assert.deepEqual(report, {
    activeEnterpriseUserCount: 2,
    alreadyFlaggedUserCount: 1,
    newlyFlaggedUserCount: 1,
    revokedMobileTokenCount: 2,
  });
  assert.equal(db.users.find((user) => user.id === "active_user")?.mobileProfileReonboardingRequired, true);
  assert.equal(db.users.find((user) => user.id === "disabled_user")?.mobileProfileReonboardingRequired, false);
  assert.deepEqual(
    db.mobileAuthTokens.map((token) => token.userId).sort(),
    ["disabled_user", "individual_user", "super_user"]
  );

  const event = appendResetAudit(db, report, "staging", NOW);
  assert.equal(db.auditEvents?.length, 1);
  assert.equal(db.auditEvents?.[0], event);
  assert.equal(event.action, "mobile.profile_reonboarding_reset.applied");
  assert.equal(event.metadata?.target, "staging");
  assert.equal(event.metadata?.newlyFlaggedUserCount, 1);
  const metadataJson = JSON.stringify(event.metadata);
  assert.equal(metadataJson.includes("token"), false);
  assert.equal(metadataJson.includes("company"), false);
  assert.equal(metadataJson.includes("code"), false);
  assert.equal(metadataJson.includes("credential"), false);

  const replay = applyReset(db, NOW);
  assert.deepEqual(replay, {
    activeEnterpriseUserCount: 2,
    alreadyFlaggedUserCount: 2,
    newlyFlaggedUserCount: 0,
    revokedMobileTokenCount: 0,
  });
});

test("force mobile re-onboarding target safety fails closed before data load or writes", () => {
  assert.throws(
    () => assertTargetSafety(stagingTarget(), { apply: false, target: null, confirmProduction: null }),
    /--target staging or --target production is required/
  );
  assert.throws(
    () => assertTargetSafety(stagingTarget(), { apply: true, target: null, confirmProduction: null }),
    /--target staging or --target production is required/
  );
  assert.throws(
    () => assertTargetSafety(stagingTarget(), { apply: false, target: "development", confirmProduction: null }),
    /--target must be "staging" or "production"/
  );
  assert.throws(
    () => assertTargetSafety(productionTarget(), { apply: false, target: "staging", confirmProduction: null }),
    /target mismatch/
  );
  assert.throws(
    () => assertTargetSafety(stagingTarget(), { apply: false, target: "production", confirmProduction: PRODUCTION_CONFIRMATION }),
    /target mismatch/
  );
  assert.throws(
    () => assertTargetSafety(productionTarget(), { apply: true, target: "production", confirmProduction: null }),
    /refuses to write to production/
  );
});

test("force mobile re-onboarding allows valid staging dry-run without mutating source state", () => {
  const originalDb = buildDb();
  const dryRunWorkingCopy = structuredClone(originalDb) as ApiDatabase;

  assert.equal(
    assertTargetSafety(stagingTarget(), { apply: false, target: "staging", confirmProduction: null }),
    "staging"
  );
  const dryRunReport = applyReset(dryRunWorkingCopy, NOW);

  assert.equal(dryRunReport.newlyFlaggedUserCount, 1);
  assert.equal(originalDb.users.find((user) => user.id === "active_user")?.mobileProfileReonboardingRequired, false);
  assert.equal(originalDb.mobileAuthTokens.length, 5);
  assert.equal(originalDb.auditEvents, undefined);
});

test("force mobile re-onboarding allows production only with exact typed confirmation", () => {
  assert.equal(
    assertTargetSafety(productionTarget(), {
      apply: true,
      target: "production",
      confirmProduction: PRODUCTION_CONFIRMATION,
    }),
    "production"
  );
});
