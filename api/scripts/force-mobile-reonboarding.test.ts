import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ApiDatabase, createDefaultConfig, MobileAuthRecord, UserProfile } from "@voicepractice/shared";

import {
  appendResetAudit,
  applyReset,
  assertTargetSafety,
} from "./force-mobile-reonboarding.js";

const NOW = "2026-07-27T12:00:00.000Z";

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

function auditEventsPath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.audit-events${extension}`);
}

test("force mobile re-onboarding reset reports, applies, audits, and replays idempotently", async () => {
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

  const replay = applyReset(db, NOW);
  assert.deepEqual(replay, {
    activeEnterpriseUserCount: 2,
    alreadyFlaggedUserCount: 2,
    newlyFlaggedUserCount: 0,
    revokedMobileTokenCount: 0,
  });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "force-mobile-reonboarding-audit-"));
  const dbPath = path.join(tempDir, "db.local.json");
  try {
    await appendResetAudit(
      {
        storageProvider: "file",
        dbPath,
        databaseUrl: null,
        pgPoolMax: 1,
        pgConnectTimeoutMs: 1,
        pgIdleTimeoutMs: 1,
      },
      report,
      "staging"
    );
    const auditPayload = JSON.parse(await readFile(auditEventsPath(dbPath), "utf8")) as {
      events?: Array<{ action?: string; metadata?: Record<string, unknown> }>;
    };
    const event = auditPayload.events?.find((entry) => entry.action === "mobile.profile_reonboarding_reset.applied");
    assert.ok(event);
    assert.equal(event.metadata?.target, "staging");
    assert.equal(event.metadata?.newlyFlaggedUserCount, 1);
    assert.equal(JSON.stringify(event.metadata).includes("token"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("force mobile re-onboarding reset dry-run safety and production confirmation guard", () => {
  const originalDb = buildDb();
  const dryRunWorkingCopy = structuredClone(originalDb) as ApiDatabase;
  const dryRunReport = applyReset(dryRunWorkingCopy, NOW);
  assert.equal(dryRunReport.newlyFlaggedUserCount, 1);
  assert.equal(originalDb.users.find((user) => user.id === "active_user")?.mobileProfileReonboardingRequired, false);
  assert.equal(originalDb.mobileAuthTokens.length, 5);

  assert.equal(
    assertTargetSafety(
      {
        storageProvider: "file",
        dbPath: "db.local.json",
        databaseUrl: null,
        pgPoolMax: 1,
        pgConnectTimeoutMs: 1,
        pgIdleTimeoutMs: 1,
      },
      { apply: false, target: "staging", confirmProduction: null }
    ),
    "staging"
  );

  assert.throws(
    () => assertTargetSafety(
      {
        storageProvider: "postgres",
        dbPath: "db.local.json",
        databaseUrl: "postgres://peritio:secret@production.example.com/peritio",
        pgPoolMax: 1,
        pgConnectTimeoutMs: 1,
        pgIdleTimeoutMs: 1,
      },
      { apply: true, target: "production", confirmProduction: null }
    ),
    /refuses to write/
  );
});
