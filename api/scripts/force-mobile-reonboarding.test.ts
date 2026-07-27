import assert from "node:assert/strict";
import test from "node:test";

import { ApiDatabase, createDefaultConfig, MobileAuthRecord, UserProfile } from "@voicepractice/shared";

import {
  appendResetAudit,
  applyReset,
  applyResetToTarget,
  assertTargetSafety,
  buildResetDryRunReport,
  updatePostgresAppStateWithLock,
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

function createPostgresPoolHarness(params: {
  initialState: ApiDatabase;
  beforeLockedRead?: (current: ApiDatabase) => ApiDatabase;
  failUpdate?: boolean;
}) {
  let stateJson = structuredClone(params.initialState) as ApiDatabase;
  let updateCount = 0;
  let commitCount = 0;
  let rollbackCount = 0;
  let releaseCount = 0;
  let endCount = 0;
  const queries: string[] = [];

  return {
    poolFactory: () => ({
      async connect() {
        return {
          async query(text: string, values?: unknown[]) {
            queries.push(text);
            if (/^BEGIN\b/.test(text)) {
              return { rows: [], rowCount: 0 };
            }
            if (/SELECT state_json FROM app_state WHERE id = \$1 FOR UPDATE/.test(text)) {
              stateJson = params.beforeLockedRead?.(stateJson) ?? stateJson;
              return { rows: [{ state_json: stateJson }], rowCount: 1 };
            }
            if (/UPDATE app_state/.test(text)) {
              if (params.failUpdate) {
                throw new Error("simulated app_state update failure");
              }
              stateJson = JSON.parse(String(values?.[1])) as ApiDatabase;
              updateCount += 1;
              return { rows: [], rowCount: 1 };
            }
            if (/^COMMIT\b/.test(text)) {
              commitCount += 1;
              return { rows: [], rowCount: 0 };
            }
            if (/^ROLLBACK\b/.test(text)) {
              rollbackCount += 1;
              return { rows: [], rowCount: 0 };
            }
            return { rows: [], rowCount: 0 };
          },
          release() {
            releaseCount += 1;
          },
        };
      },
      async end() {
        endCount += 1;
      },
    }),
    queries,
    get stateJson() {
      return stateJson;
    },
    get updateCount() {
      return updateCount;
    },
    get commitCount() {
      return commitCount;
    },
    get rollbackCount() {
      return rollbackCount;
    },
    get releaseCount() {
      return releaseCount;
    },
    get endCount() {
      return endCount;
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

test("force mobile re-onboarding postgres apply locks current app_state and commits reset data together", async () => {
  const staleDb = buildDb();
  const concurrentDb = buildDb();
  concurrentDb.admin.activeSessionIds = ["dashboard_session_keep"];
  concurrentDb.users.push(buildUser("concurrent_user", { employeeId: "EMP-CONCURRENT" }));
  concurrentDb.mobileAuthTokens.push(buildToken("concurrent_user"));
  const harness = createPostgresPoolHarness({
    initialState: staleDb,
    beforeLockedRead: () => concurrentDb,
  });

  const report = await applyResetToTarget({
    target: stagingTarget(),
    resolvedTarget: "staging",
    nowIso: NOW,
    storage: {
      async load() {
        throw new Error("postgres apply must not use stale load path");
      },
      async save() {
        throw new Error("postgres apply must not use unlocked save path");
      },
      async updatePostgresWithLock(target, handler) {
        return updatePostgresAppStateWithLock(target, handler, harness.poolFactory);
      },
    },
  });

  assert.deepEqual(report, {
    activeEnterpriseUserCount: 3,
    alreadyFlaggedUserCount: 1,
    newlyFlaggedUserCount: 2,
    revokedMobileTokenCount: 3,
  });
  assert.ok(harness.queries.some((query) => /^BEGIN\b/.test(query)));
  assert.ok(harness.queries.some((query) => /SELECT state_json FROM app_state WHERE id = \$1 FOR UPDATE/.test(query)));
  assert.ok(harness.queries.some((query) => /UPDATE app_state/.test(query)));
  assert.equal(harness.commitCount, 1);
  assert.equal(harness.rollbackCount, 0);
  assert.equal(harness.releaseCount, 1);
  assert.equal(harness.endCount, 1);
  assert.equal(harness.updateCount, 1);

  const saved = harness.stateJson;
  const active = saved.users.find((user) => user.id === "active_user");
  const concurrent = saved.users.find((user) => user.id === "concurrent_user");
  assert.equal(active?.mobileProfileReonboardingRequired, true);
  assert.equal(concurrent?.mobileProfileReonboardingRequired, true);
  assert.equal(concurrent?.employeeId, "EMP-CONCURRENT");
  assert.deepEqual(
    saved.mobileAuthTokens.map((token) => token.userId).sort(),
    ["disabled_user", "individual_user", "super_user"]
  );
  assert.equal(saved.auditEvents?.length, 1);
  assert.equal(saved.auditEvents?.[0]?.action, "mobile.profile_reonboarding_reset.applied");
  assert.equal(saved.auditEvents?.[0]?.metadata?.revokedMobileTokenCount, 3);
  assert.deepEqual(saved.admin.activeSessionIds, ["dashboard_session_keep"]);
});

test("force mobile re-onboarding postgres apply rolls back all reset changes on write failure", async () => {
  const original = buildDb();
  const harness = createPostgresPoolHarness({
    initialState: original,
    failUpdate: true,
  });

  await assert.rejects(
    applyResetToTarget({
      target: stagingTarget(),
      resolvedTarget: "staging",
      nowIso: NOW,
      storage: {
        async load() {
          throw new Error("postgres apply must not use stale load path");
        },
        async save() {
          throw new Error("postgres apply must not use unlocked save path");
        },
        async updatePostgresWithLock(target, handler) {
          return updatePostgresAppStateWithLock(target, handler, harness.poolFactory);
        },
      },
    }),
    /simulated app_state update failure/
  );

  assert.equal(harness.commitCount, 0);
  assert.equal(harness.rollbackCount, 1);
  assert.equal(harness.releaseCount, 1);
  assert.equal(harness.endCount, 1);
  assert.equal(harness.updateCount, 0);
  assert.equal(harness.stateJson.users.find((user) => user.id === "active_user")?.mobileProfileReonboardingRequired, false);
  assert.equal(harness.stateJson.mobileAuthTokens.length, 5);
  assert.equal(harness.stateJson.auditEvents, undefined);
});

test("force mobile re-onboarding dry-run performs zero writes and avoids postgres app_state lock", async () => {
  const originalDb = buildDb();
  let loadCount = 0;
  let saveCount = 0;
  let lockCount = 0;

  const report = await buildResetDryRunReport({
    target: stagingTarget(),
    nowIso: NOW,
    storage: {
      async load() {
        loadCount += 1;
        return originalDb;
      },
      async save() {
        saveCount += 1;
      },
      async updatePostgresWithLock() {
        lockCount += 1;
        throw new Error("dry-run must not acquire the write lock");
      },
    },
  });

  assert.equal(loadCount, 1);
  assert.equal(saveCount, 0);
  assert.equal(lockCount, 0);
  assert.equal(report.newlyFlaggedUserCount, 1);
  assert.equal(originalDb.users.find((user) => user.id === "active_user")?.mobileProfileReonboardingRequired, false);
  assert.equal(originalDb.mobileAuthTokens.length, 5);
  assert.equal(originalDb.auditEvents, undefined);
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
