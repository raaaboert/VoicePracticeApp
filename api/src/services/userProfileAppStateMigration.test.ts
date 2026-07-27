import assert from "node:assert/strict";
import test from "node:test";

import { ApiDatabase, createDefaultConfig, isOrgUserRole, UserProfile } from "@voicepractice/shared";

import { normalizeEmployeeIdInput } from "./employeeIds.js";
import {
  normalizeManagerUserId,
  normalizeOptionalStoredUserName,
  repairInvalidManagerAssignments
} from "./userProfiles.js";
import {
  migrateUserProfileAppStateNormalization,
  normalizeAppStateMigrations,
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

function buildDb(users: UserProfile[], migrations?: Record<string, string>): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users,
    orgs: [],
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

test("user profile app-state migration preserves valid fields and clears invalid managers", async () => {
  const raw = buildDb([
    buildUser("valid_manager", { orgRole: "user_admin", dashboardAccessEnabled: true }),
    buildUser("inactive_manager", { orgRole: "user_admin", status: "disabled" }),
    buildUser("regular_manager"),
    buildUser("cross_org_manager", { orgId: "org_2", orgRole: "user_admin" }),
    buildUser("valid_report", {
      firstName: "Grace",
      lastName: "Hopper",
      employeeId: "GH-1",
      managerUserId: "valid_manager",
      mobileProfileReonboardingRequired: true
    }),
    buildUser("cross_org_report", { managerUserId: "cross_org_manager" }),
    buildUser("regular_manager_report", { managerUserId: "regular_manager" }),
    buildUser("inactive_manager_report", { managerUserId: "inactive_manager" })
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
  assert.equal(usersById.get("cross_org_report")?.managerUserId, null);
  assert.equal(usersById.get("regular_manager_report")?.managerUserId, null);
  assert.equal(usersById.get("inactive_manager_report")?.managerUserId, null);
});

test("postgres app-state storage exposes raw load and save for durable profile migration", async () => {
  let stateJson: unknown = buildDb([
    buildUser("pg_manager", { orgRole: "user_admin", dashboardAccessEnabled: true }),
    {
      ...buildUser("pg_report", { managerUserId: " pg_manager " }),
      firstName: " Lin ",
      employeeId: " PG-1 "
    }
  ]);
  let writeCount = 0;
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
      async query(text: string, values?: unknown[]) {
        queries.push(text);
        if (/SELECT state_json FROM app_state/.test(text)) {
          return { rows: [{ state_json: stateJson }], rowCount: 1 };
        }
        if (/INSERT INTO app_state/.test(text)) {
          stateJson = JSON.parse(String(values?.[1]));
          writeCount += 1;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    } as any
  });

  const result = await migrateUserProfileAppStateNormalization({
    storage,
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot
  });

  assert.equal(result.saved, true);
  assert.equal(writeCount, 1);
  assert.ok(queries.some((query) => /CREATE TABLE IF NOT EXISTS app_state/.test(query)));
  const saved = stateJson as ApiDatabase;
  assert.equal(saved.users[1]?.firstName, "Lin");
  assert.equal(saved.users[1]?.employeeId, "PG-1");
  assert.equal(saved.users[1]?.managerUserId, "pg_manager");
  assert.equal(saved.appStateMigrations?.[USER_PROFILE_APP_STATE_MIGRATION_KEY], USER_PROFILE_APP_STATE_MIGRATION_VERSION);

  const replay = await migrateUserProfileAppStateNormalization({
    storage,
    ensureDatabaseShape: ensureTestDatabaseShape,
    buildPersistedDatabaseSnapshot: persistedSnapshot
  });
  assert.equal(replay.saved, false);
  assert.equal(writeCount, 1);
});
