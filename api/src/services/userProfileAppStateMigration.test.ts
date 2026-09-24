import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ApiDatabase,
  createDefaultConfig,
  type EnterpriseOrg,
  isOrgUserRole,
  UserProfile,
} from "@voicepractice/shared";

import { normalizeEmployeeIdInput } from "./employeeIds.js";
import {
  normalizeManagerUserId,
  normalizeOptionalStoredUserName,
  normalizePerformanceAccess,
  repairInvalidManagerAssignments,
  validateManagerAssignment
} from "./userProfiles.js";
import {
  migrateUserProfileAppStateNormalization,
  normalizeAppStateMigrations,
  PERFORMANCE_ACCESS_APP_STATE_MIGRATION_KEY,
  PERFORMANCE_ACCESS_APP_STATE_MIGRATION_VERSION,
  USER_PROFILE_APP_STATE_MIGRATION_KEY,
  USER_PROFILE_APP_STATE_MIGRATION_VERSION
} from "./userProfileAppStateMigration.js";
import { createDatabaseStorage } from "../storage.js";

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
    ...overrides
  };
}

function buildOrg(id: string): EnterpriseOrg {
  return {
    id,
    name: `Organization ${id}`,
    status: "active",
    contactName: "Organization Owner",
    contactEmail: `owner-${id}@example.test`,
    emailDomain: null,
    joinCode: `JOIN-${id}`,
    activeIndustries: ["people_management"],
    dailySecondsQuota: 3600,
    perUserDailySecondsCap: 1800,
    pendingPerUserDailySecondsCap: null,
    pendingPerUserDailySecondsCapEffectiveAt: null,
    manualBonusSeconds: 0,
    contractSignedAt: NOW,
    monthlyMinutesAllotted: 1000,
    renewalTotalUsd: 1000,
    softLimitPercentTriggers: [80, 100],
    maxSimulationMinutes: 20,
    divisionsEnabled: false,
    customScenarios: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildDb(users: UserProfile[], migrations?: Record<string, string>): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users,
    orgs: [buildOrg("org_1"), buildOrg("org_2")],
    orgDivisions: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    usageSessions: [],
    mobileAuthTokens: [],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [],
    appStateMigrations: migrations ?? {},
    admin: {
      passwordHash: null,
      activeSessionIds: []
    }
  };
}

function normalizeOrgUserRole(value: unknown): UserProfile["orgRole"] {
  return typeof value === "string" && isOrgUserRole(value) ? value : "user";
}

function ensureTestDatabaseShape(raw: unknown): ApiDatabase {
  const candidate = (raw ?? {}) as Partial<ApiDatabase>;
  const users = (Array.isArray(candidate.users) ? candidate.users : []).map((user) => {
    const candidateUser = user as Partial<UserProfile>;
    const normalizedEmployeeId = normalizeEmployeeIdInput(candidateUser.employeeId);
    return {
      ...buildUser(typeof candidateUser.id === "string" ? candidateUser.id : "unknown_user"),
      ...candidateUser,
      firstName: normalizeOptionalStoredUserName(candidateUser.firstName),
      lastName: normalizeOptionalStoredUserName(candidateUser.lastName),
      employeeId: normalizedEmployeeId.ok ? normalizedEmployeeId.value : null,
      managerUserId:
        candidateUser.accountType === "enterprise" ? normalizeManagerUserId(candidateUser.managerUserId) : null,
      orgRole: candidateUser.accountType === "enterprise" ? normalizeOrgUserRole(candidateUser.orgRole) : "user",
      performanceAccess: normalizePerformanceAccess(candidateUser, new Set(["org_1", "org_2"])),
      dashboardAccessEnabled:
        candidateUser.accountType === "enterprise" ? candidateUser.dashboardAccessEnabled === true : false,
      mobileProfileReonboardingRequired:
        candidateUser.accountType === "enterprise" ? candidateUser.mobileProfileReonboardingRequired === true : false
    } satisfies UserProfile;
  });
  repairInvalidManagerAssignments(users, NOW);
  return {
    ...buildDb(users, normalizeAppStateMigrations(candidate.appStateMigrations)),
    users
  };
}

function persistedSnapshot(db: ApiDatabase): ApiDatabase {
  return structuredClone(db) as ApiDatabase;
}

function createFileStorage(dbPath: string) {
  return createDatabaseStorage({
    provider: "file",
    dbPath,
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    ensureDatabaseShape: ensureTestDatabaseShape,
    createDefaultDatabase: () => buildDb([]),
  });
}

test("user profile app-state migration saves legacy normalized fields and then becomes idempotent", async () => {
  const raw = buildDb([
    buildUser("manager", { orgRole: "user_admin", dashboardAccessEnabled: true }),
    {
      ...buildUser("report", { managerUserId: " manager " }),
      firstName: " Ada ",
      lastName: " ",
      employeeId: " EMP-1 ",
      mobileProfileReonboardingRequired: undefined as unknown as boolean,
      dashboardAccessEnabled: undefined as unknown as boolean
    }
  ]);
  delete (raw.users[1] as Partial<UserProfile>).mobileProfileReonboardingRequired;
  delete (raw.users[1] as Partial<UserProfile>).dashboardAccessEnabled;

  let persisted: unknown = structuredClone(raw);
  let saveCount = 0;
  const result = await migrateUserProfileAppStateNormalization({
    storage: {
      async loadRaw() {
        return persisted;
      },
      async save(db) {
        saveCount += 1;
        persisted = db;
      }
    },
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot
  });

  assert.deepEqual(result, { saved: true, profileChanged: true, markerChanged: true });
  assert.equal(saveCount, 1);
  const saved = persisted as ApiDatabase;
  assert.equal(saved.appStateMigrations?.[USER_PROFILE_APP_STATE_MIGRATION_KEY], USER_PROFILE_APP_STATE_MIGRATION_VERSION);
  assert.equal(
    saved.appStateMigrations?.[PERFORMANCE_ACCESS_APP_STATE_MIGRATION_KEY],
    PERFORMANCE_ACCESS_APP_STATE_MIGRATION_VERSION
  );
  assert.equal(saved.users[1]?.firstName, "Ada");
  assert.equal(saved.users[1]?.lastName, null);
  assert.equal(saved.users[1]?.employeeId, "EMP-1");
  assert.equal(saved.users[1]?.managerUserId, "manager");
  assert.equal(saved.users[1]?.mobileProfileReonboardingRequired, false);
  assert.equal(saved.users[1]?.dashboardAccessEnabled, false);

  const replay = await migrateUserProfileAppStateNormalization({
    storage: {
      async loadRaw() {
        return persisted;
      },
      async save(db) {
        saveCount += 1;
        persisted = db;
      }
    },
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot
  });

  assert.deepEqual(replay, { saved: false, profileChanged: false, markerChanged: false });
  assert.equal(saveCount, 1);
});

test("performance-access migration backfills compatibility values, preserves explicit values, and is idempotent", async () => {
  const raw = buildDb([
    buildUser("legacy_org_admin", { orgRole: "org_admin" }),
    buildUser("legacy_user_admin", { orgRole: "user_admin" }),
    buildUser("legacy_user", { orgRole: "user" }),
    buildUser("explicit_none", { orgRole: "org_admin", performanceAccess: "none" }),
    buildUser("explicit_team", { orgRole: "user", performanceAccess: "team" }),
    buildUser("explicit_organization", {
      firstName: "Grace",
      lastName: "Hopper",
      employeeId: "GH-1",
      managerUserId: "legacy_user_admin",
      orgRole: "user",
      performanceAccess: "organization",
      divisionId: "division_1",
      dashboardAccessEnabled: true,
      mobileProfileReonboardingRequired: true,
    }),
    {
      ...buildUser("invalid_user_admin", { orgRole: "user_admin" }),
      performanceAccess: "invalid",
    } as unknown as UserProfile,
    {
      ...buildUser("individual", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      performanceAccess: "invalid",
    } as unknown as UserProfile,
  ]);
  for (const userId of ["legacy_org_admin", "legacy_user_admin", "legacy_user"]) {
    delete (raw.users.find((user) => user.id === userId) as Partial<UserProfile>).performanceAccess;
  }
  const unrelatedBefore = {
    ...raw.users.find((user) => user.id === "explicit_organization")!,
  };

  let persisted: unknown = structuredClone(raw);
  let saveCount = 0;
  const migrate = () => migrateUserProfileAppStateNormalization({
    storage: {
      async loadRaw() {
        return persisted;
      },
      async save(db) {
        saveCount += 1;
        persisted = db;
      },
    },
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot,
  });

  const result = await migrate();
  assert.deepEqual(result, { saved: true, profileChanged: true, markerChanged: true });
  assert.equal(saveCount, 1);
  const saved = persisted as ApiDatabase;
  const usersById = new Map(saved.users.map((user) => [user.id, user]));
  assert.equal(usersById.get("legacy_org_admin")?.performanceAccess, "organization");
  assert.equal(usersById.get("legacy_user_admin")?.performanceAccess, "team");
  assert.equal(usersById.get("legacy_user")?.performanceAccess, "none");
  assert.equal(usersById.get("explicit_none")?.performanceAccess, "none");
  assert.equal(usersById.get("explicit_team")?.performanceAccess, "team");
  assert.equal(usersById.get("explicit_organization")?.performanceAccess, "organization");
  assert.equal(usersById.get("invalid_user_admin")?.performanceAccess, "team");
  assert.equal(usersById.get("individual")?.performanceAccess, "none");
  assert.equal(saved.appStateMigrations?.[PERFORMANCE_ACCESS_APP_STATE_MIGRATION_KEY], PERFORMANCE_ACCESS_APP_STATE_MIGRATION_VERSION);
  assert.deepEqual(
    {
      ...usersById.get("explicit_organization"),
      performanceAccess: unrelatedBefore.performanceAccess,
    },
    unrelatedBefore
  );

  const snapshotAfterFirstRun = structuredClone(saved);
  const replay = await migrate();
  assert.deepEqual(replay, { saved: false, profileChanged: false, markerChanged: false });
  assert.equal(saveCount, 1);
  assert.deepEqual(persisted, snapshotAfterFirstRun);
});

test("file-backed unmigrated production state preserves raw legacy roles until performance-access migration", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "performance-access-unmigrated-"));
  const dbPath = path.join(tempDir, "db.local.json");
  try {
    const raw = buildDb([
      buildUser("org_admin_missing", { orgRole: "org_admin" }),
      buildUser("user_admin_missing", { orgRole: "user_admin" }),
      buildUser("user_missing"),
      { ...buildUser("org_admin_invalid", { orgRole: "org_admin" }), performanceAccess: "garbage" } as unknown as UserProfile,
      { ...buildUser("user_admin_invalid", { orgRole: "user_admin" }), performanceAccess: "TEAM" } as unknown as UserProfile,
      { ...buildUser("user_invalid"), performanceAccess: "invalid" } as unknown as UserProfile,
      buildUser("org_admin_explicit_none", { orgRole: "org_admin", performanceAccess: "none" }),
      buildUser("user_explicit_organization", { performanceAccess: "organization" }),
      buildUser("individual_missing", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
    ]);
    for (const id of ["org_admin_missing", "user_admin_missing", "user_missing", "individual_missing"]) {
      delete (raw.users.find((user) => user.id === id) as Partial<UserProfile>).performanceAccess;
    }
    await writeFile(dbPath, JSON.stringify(raw, null, 2), "utf8");

    const storage = createFileStorage(dbPath);
    const beforeRuntimeLoad = await readFile(dbPath, "utf8");
    const runtimeBeforeMigration = await storage.load();
    const runtimeBeforeById = new Map(runtimeBeforeMigration.users.map((user) => [user.id, user]));
    assert.equal(runtimeBeforeById.get("org_admin_missing")?.performanceAccess, "none");
    assert.equal(runtimeBeforeById.get("user_admin_missing")?.performanceAccess, "none");
    assert.equal(runtimeBeforeById.get("org_admin_invalid")?.performanceAccess, "none");
    assert.equal(runtimeBeforeById.get("user_admin_invalid")?.performanceAccess, "none");
    assert.equal(await readFile(dbPath, "utf8"), beforeRuntimeLoad);

    const result = await migrateUserProfileAppStateNormalization({
      storage,
      ensureDatabaseShape: ensureTestDatabaseShape,
      buildPersistedDatabaseSnapshot: persistedSnapshot,
    });
    assert.deepEqual(result, { saved: true, profileChanged: true, markerChanged: true });

    const persisted = JSON.parse(await readFile(dbPath, "utf8")) as ApiDatabase;
    const persistedById = new Map(persisted.users.map((user) => [user.id, user]));
    assert.equal(persistedById.get("org_admin_missing")?.performanceAccess, "organization");
    assert.equal(persistedById.get("user_admin_missing")?.performanceAccess, "team");
    assert.equal(persistedById.get("user_missing")?.performanceAccess, "none");
    assert.equal(persistedById.get("org_admin_invalid")?.performanceAccess, "organization");
    assert.equal(persistedById.get("user_admin_invalid")?.performanceAccess, "team");
    assert.equal(persistedById.get("user_invalid")?.performanceAccess, "none");
    assert.equal(persistedById.get("org_admin_explicit_none")?.performanceAccess, "none");
    assert.equal(persistedById.get("user_explicit_organization")?.performanceAccess, "organization");
    assert.equal(persistedById.get("individual_missing")?.performanceAccess, "none");
    assert.equal(
      persisted.appStateMigrations?.[PERFORMANCE_ACCESS_APP_STATE_MIGRATION_KEY],
      PERFORMANCE_ACCESS_APP_STATE_MIGRATION_VERSION,
    );

    const afterFirstMigration = await readFile(dbPath, "utf8");
    const reloaded = await createFileStorage(dbPath).load();
    assert.deepEqual(
      reloaded.users.map((user) => [user.id, user.performanceAccess]),
      persisted.users.map((user) => [user.id, user.performanceAccess]),
    );
    const replay = await migrateUserProfileAppStateNormalization({
      storage: createFileStorage(dbPath),
      ensureDatabaseShape: ensureTestDatabaseShape,
      buildPersistedDatabaseSnapshot: persistedSnapshot,
    });
    assert.deepEqual(replay, { saved: false, profileChanged: false, markerChanged: false });
    assert.equal(await readFile(dbPath, "utf8"), afterFirstMigration);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file-backed marker-present state fails closed and preserves every explicit performance value", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "performance-access-migrated-"));
  const dbPath = path.join(tempDir, "db.local.json");
  try {
    const raw = buildDb([
      buildUser("org_admin_missing", { orgRole: "org_admin" }),
      buildUser("user_admin_missing", { orgRole: "user_admin" }),
      { ...buildUser("org_admin_invalid", { orgRole: "org_admin" }), performanceAccess: "garbage" } as unknown as UserProfile,
      { ...buildUser("user_admin_invalid", { orgRole: "user_admin" }), performanceAccess: "TEAM" } as unknown as UserProfile,
      buildUser("org_admin_none", { orgRole: "org_admin", performanceAccess: "none" }),
      buildUser("user_admin_none", { orgRole: "user_admin", performanceAccess: "none" }),
      buildUser("user_team", { orgRole: "user", performanceAccess: "team" }),
      buildUser("user_organization", { orgRole: "user", performanceAccess: "organization" }),
      buildUser("org_admin_team", { orgRole: "org_admin", performanceAccess: "team" }),
      buildUser("user_admin_organization", { orgRole: "user_admin", performanceAccess: "organization" }),
    ], {
      [USER_PROFILE_APP_STATE_MIGRATION_KEY]: USER_PROFILE_APP_STATE_MIGRATION_VERSION,
      [PERFORMANCE_ACCESS_APP_STATE_MIGRATION_KEY]: PERFORMANCE_ACCESS_APP_STATE_MIGRATION_VERSION,
    });
    for (const id of ["org_admin_missing", "user_admin_missing"]) {
      delete (raw.users.find((user) => user.id === id) as Partial<UserProfile>).performanceAccess;
    }
    await writeFile(dbPath, JSON.stringify(raw, null, 2), "utf8");

    const storage = createFileStorage(dbPath);
    const loaded = await storage.load();
    const loadedById = new Map(loaded.users.map((user) => [user.id, user]));
    for (const id of ["org_admin_missing", "user_admin_missing", "org_admin_invalid", "user_admin_invalid"]) {
      assert.equal(loadedById.get(id)?.performanceAccess, "none");
    }
    assert.equal(loadedById.get("org_admin_none")?.performanceAccess, "none");
    assert.equal(loadedById.get("user_admin_none")?.performanceAccess, "none");
    assert.equal(loadedById.get("user_team")?.performanceAccess, "team");
    assert.equal(loadedById.get("user_organization")?.performanceAccess, "organization");
    assert.equal(loadedById.get("org_admin_team")?.performanceAccess, "team");
    assert.equal(loadedById.get("user_admin_organization")?.performanceAccess, "organization");

    const result = await migrateUserProfileAppStateNormalization({
      storage,
      ensureDatabaseShape: ensureTestDatabaseShape,
      buildPersistedDatabaseSnapshot: persistedSnapshot,
    });
    assert.deepEqual(result, { saved: true, profileChanged: true, markerChanged: false });
    const persisted = JSON.parse(await readFile(dbPath, "utf8")) as ApiDatabase;
    const persistedById = new Map(persisted.users.map((user) => [user.id, user]));
    for (const id of ["org_admin_missing", "user_admin_missing", "org_admin_invalid", "user_admin_invalid"]) {
      assert.equal(persistedById.get(id)?.performanceAccess, "none");
    }
    assert.equal(persistedById.get("org_admin_none")?.performanceAccess, "none");
    assert.equal(persistedById.get("user_admin_none")?.performanceAccess, "none");
    assert.equal(persistedById.get("user_team")?.performanceAccess, "team");
    assert.equal(persistedById.get("user_organization")?.performanceAccess, "organization");
    assert.equal(persistedById.get("org_admin_team")?.performanceAccess, "team");
    assert.equal(persistedById.get("user_admin_organization")?.performanceAccess, "organization");

    const afterRepair = await readFile(dbPath, "utf8");
    const replay = await migrateUserProfileAppStateNormalization({
      storage: createFileStorage(dbPath),
      ensureDatabaseShape: ensureTestDatabaseShape,
      buildPersistedDatabaseSnapshot: persistedSnapshot,
    });
    assert.deepEqual(replay, { saved: false, profileChanged: false, markerChanged: false });
    assert.equal(await readFile(dbPath, "utf8"), afterRepair);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("user profile app-state migration preserves role-independent managers and clears invalid managers", async () => {
  const raw = buildDb([
    buildUser("valid_manager", { orgRole: "user_admin", dashboardAccessEnabled: true }),
    buildUser("org_admin_manager", { orgRole: "org_admin" }),
    buildUser("inactive_manager", { orgRole: "user_admin", status: "disabled" }),
    buildUser("regular_manager"),
    buildUser("cross_org_manager", { orgId: "org_2", orgRole: "user_admin" }),
    buildUser("individual_manager", { accountType: "individual", tier: "free", orgId: null }),
    buildUser("valid_report", {
      firstName: "Grace",
      lastName: "Hopper",
      employeeId: "GH-1",
      managerUserId: "valid_manager",
      mobileProfileReonboardingRequired: true
    }),
    buildUser("cross_org_report", { managerUserId: "cross_org_manager" }),
    buildUser("regular_manager_report", { managerUserId: "regular_manager" }),
    buildUser("org_admin_manager_report", { managerUserId: "org_admin_manager" }),
    buildUser("inactive_manager_report", { managerUserId: "inactive_manager" }),
    buildUser("individual_manager_report", { managerUserId: "individual_manager" }),
    buildUser("missing_manager_report", { managerUserId: "missing_manager" })
  ]);

  const savedSnapshots: ApiDatabase[] = [];
  const result = await migrateUserProfileAppStateNormalization({
    storage: {
      async loadRaw() {
        return raw;
      },
      async save(db) {
        savedSnapshots.push(db);
      }
    },
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot
  });

  assert.equal(result.saved, true);
  assert.equal(savedSnapshots.length, 1);
  const savedDb = savedSnapshots[0]!;
  const usersById = new Map(savedDb.users.map((user) => [user.id, user]));
  assert.equal(usersById.get("valid_report")?.firstName, "Grace");
  assert.equal(usersById.get("valid_report")?.lastName, "Hopper");
  assert.equal(usersById.get("valid_report")?.employeeId, "GH-1");
  assert.equal(usersById.get("valid_report")?.managerUserId, "valid_manager");
  assert.equal(usersById.get("valid_report")?.mobileProfileReonboardingRequired, true);
  assert.equal(usersById.get("regular_manager_report")?.managerUserId, "regular_manager");
  assert.equal(usersById.get("org_admin_manager_report")?.managerUserId, "org_admin_manager");
  assert.equal(usersById.get("cross_org_report")?.managerUserId, null);
  assert.equal(usersById.get("inactive_manager_report")?.managerUserId, null);
  assert.equal(usersById.get("individual_manager_report")?.managerUserId, null);
  assert.equal(usersById.get("missing_manager_report")?.managerUserId, null);
});

test("file storage reload cycles preserve a valid regular manager relationship", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "manager-load-cycle-"));
  const dbPath = path.join(tempDir, "db.local.json");
  try {
    const regularManager = buildUser("regular_manager", { performanceAccess: "none" });
    const report = buildUser("report", { managerUserId: regularManager.id });
    const assignment = validateManagerAssignment({
      orgUsers: [regularManager, report],
      target: report,
      managerUserId: regularManager.id,
    });
    assert.equal(assignment.ok, true);

    await writeFile(dbPath, JSON.stringify(buildDb([regularManager, report]), null, 2), "utf8");
    const createFileStorage = () => createDatabaseStorage({
      provider: "file",
      dbPath,
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1,
      pgIdleTimeoutMs: 1,
      ensureDatabaseShape: ensureTestDatabaseShape,
      createDefaultDatabase: () => buildDb([]),
    });

    const firstLoad = await createFileStorage().load();
    assert.equal(firstLoad.users.find((user) => user.id === report.id)?.managerUserId, regularManager.id);
    await createFileStorage().save(firstLoad);

    const secondLoad = await createFileStorage().load();
    assert.equal(secondLoad.users.find((user) => user.id === report.id)?.managerUserId, regularManager.id);
    assert.equal(secondLoad.users.find((user) => user.id === regularManager.id)?.performanceAccess, "none");
    await createFileStorage().save(secondLoad);

    const thirdLoad = await createFileStorage().load();
    assert.equal(thirdLoad.users.find((user) => user.id === report.id)?.managerUserId, regularManager.id);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function createPostgresMigrationHarness(params: {
  initialState: unknown;
  beforeLockedRead?: () => void;
  failUpdate?: boolean;
}) {
  let stateJson = params.initialState;
  let updateCount = 0;
  let commitCount = 0;
  let rollbackCount = 0;
  let releaseCount = 0;
  const queries: string[] = [];

  const storage = createDatabaseStorage({
    provider: "postgres",
    dbPath: "unused.json",
    databaseUrl: "postgres://peritio:secret@voicepractice-db.example.com/peritio",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    ensureDatabaseShape: ensureTestDatabaseShape,
    createDefaultDatabase: () => buildDb([]),
    queryPool: {
      async query(text: string) {
        queries.push(text);
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return {
          async query(text: string, values?: unknown[]) {
            queries.push(text);
            if (/^BEGIN\b/.test(text)) {
              return { rows: [], rowCount: 0 };
            }
            if (/INSERT INTO app_state/.test(text)) {
              return { rows: [], rowCount: 0 };
            }
            if (/SELECT state_json FROM app_state WHERE id = \$1 FOR UPDATE/.test(text)) {
              params.beforeLockedRead?.();
              return { rows: [{ state_json: stateJson }], rowCount: 1 };
            }
            if (/UPDATE app_state/.test(text)) {
              if (params.failUpdate) {
                throw new Error("simulated update failure");
              }
              stateJson = JSON.parse(String(values?.[1]));
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
          }
        };
      }
    } as any
  });

  return {
    storage,
    queries,
    setStateJson(value: unknown) {
      stateJson = value;
    },
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
    }
  };
}

test("postgres app-state migration uses row-level locking and is idempotent", async () => {
  const harness = createPostgresMigrationHarness({
    initialState: buildDb([
      buildUser("pg_manager", { orgRole: "user_admin", dashboardAccessEnabled: true }),
      {
        ...buildUser("pg_report", { managerUserId: " pg_manager " }),
        firstName: " Lin ",
        employeeId: " PG-1 "
      }
    ])
  });

  const result = await migrateUserProfileAppStateNormalization({
    storage: harness.storage,
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot
  });

  assert.deepEqual(result, { saved: true, profileChanged: true, markerChanged: true });
  assert.equal(harness.updateCount, 1);
  assert.equal(harness.commitCount, 1);
  assert.equal(harness.rollbackCount, 0);
  assert.equal(harness.releaseCount, 1);
  assert.ok(harness.queries.some((query) => /CREATE TABLE IF NOT EXISTS app_state/.test(query)));
  assert.ok(harness.queries.some((query) => /SELECT state_json FROM app_state WHERE id = \$1 FOR UPDATE/.test(query)));
  assert.ok(harness.queries.some((query) => /UPDATE app_state/.test(query)));
  const saved = harness.stateJson as ApiDatabase;
  assert.equal(saved.users[1]?.firstName, "Lin");
  assert.equal(saved.users[1]?.employeeId, "PG-1");
  assert.equal(saved.users[1]?.managerUserId, "pg_manager");
  assert.equal(saved.appStateMigrations?.[USER_PROFILE_APP_STATE_MIGRATION_KEY], USER_PROFILE_APP_STATE_MIGRATION_VERSION);

  harness.queries.length = 0;
  const replay = await migrateUserProfileAppStateNormalization({
    storage: harness.storage,
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot
  });
  assert.deepEqual(replay, { saved: false, profileChanged: false, markerChanged: false });
  assert.equal(harness.updateCount, 1);
  assert.ok(harness.queries.some((query) => /SELECT state_json FROM app_state WHERE id = \$1 FOR UPDATE/.test(query)));
  assert.equal(harness.queries.some((query) => /UPDATE app_state/.test(query)), false);
});

test("postgres app-state migration preserves newer state observed under the row lock", async () => {
  const newerState = buildDb([
    buildUser("pg_manager", { orgRole: "user_admin", dashboardAccessEnabled: true }),
    {
      ...buildUser("pg_report", { managerUserId: " pg_manager " }),
      firstName: " Newer ",
      lastName: " Writer ",
      employeeId: " PG-NEW "
    }
  ]);
  let replacedBeforeRead = false;
  let harness: ReturnType<typeof createPostgresMigrationHarness>;
  harness = createPostgresMigrationHarness({
    initialState: buildDb([
      buildUser("pg_manager", { orgRole: "user_admin", dashboardAccessEnabled: true }),
      {
        ...buildUser("pg_report", { managerUserId: " pg_manager " }),
        firstName: " Stale ",
        employeeId: " PG-OLD "
      }
    ]),
    beforeLockedRead: () => {
      if (!replacedBeforeRead) {
        harness.setStateJson(newerState);
        replacedBeforeRead = true;
      }
    }
  });

  const result = await migrateUserProfileAppStateNormalization({
    storage: harness.storage,
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot
  });

  assert.deepEqual(result, { saved: true, profileChanged: true, markerChanged: true });
  const saved = harness.stateJson as ApiDatabase;
  assert.equal(saved.users[1]?.firstName, "Newer");
  assert.equal(saved.users[1]?.lastName, "Writer");
  assert.equal(saved.users[1]?.employeeId, "PG-NEW");
  assert.equal(saved.users[1]?.managerUserId, "pg_manager");
  assert.equal(harness.updateCount, 1);
});

test("postgres app-state migration rolls back without persisting marker when normalization save fails", async () => {
  const initialState = buildDb([
    buildUser("pg_manager", { orgRole: "user_admin", dashboardAccessEnabled: true }),
    {
      ...buildUser("pg_report", { managerUserId: "missing_manager" }),
      firstName: " Fail ",
      employeeId: " PG-FAIL "
    }
  ]);
  const harness = createPostgresMigrationHarness({
    initialState,
    failUpdate: true
  });

  await assert.rejects(
    migrateUserProfileAppStateNormalization({
      storage: harness.storage,
      ensureDatabaseShape: ensureTestDatabaseShape,
      buildPersistedDatabaseSnapshot: persistedSnapshot
    }),
    /simulated update failure/
  );

  assert.equal(harness.commitCount, 0);
  assert.equal(harness.rollbackCount, 1);
  assert.equal(harness.releaseCount, 1);
  assert.equal(harness.updateCount, 0);
  assert.equal(
    (harness.stateJson as ApiDatabase).appStateMigrations?.[USER_PROFILE_APP_STATE_MIGRATION_KEY],
    undefined
  );
  assert.equal((harness.stateJson as ApiDatabase).users[1]?.managerUserId, "missing_manager");
});
