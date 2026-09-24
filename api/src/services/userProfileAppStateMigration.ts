import {
  isOrgUserRole,
  isPerformanceAccessLevel,
  type ApiDatabase,
  type PerformanceAccessLevel,
  type UserProfile,
} from "@voicepractice/shared";
import type { LockedAppStateUpdate } from "../storage.js";

export const USER_PROFILE_APP_STATE_MIGRATION_KEY = "user_profile_management_v1";
export const USER_PROFILE_APP_STATE_MIGRATION_VERSION = "2026-07-27";
export const PERFORMANCE_ACCESS_APP_STATE_MIGRATION_KEY = "performance_access_v1";
export const PERFORMANCE_ACCESS_APP_STATE_MIGRATION_VERSION = "2026-09-22";

const MISSING_FIELD = "__peritio_missing_field__";
const LEGACY_EXTRACTED_STORE_FIELDS = [
  "usageSessions",
  "aiUsageEvents",
  "scoreRecords",
  "webAuthSessions",
  "auditEvents",
  "supportCases"
] as const;

export interface UserProfileAppStateMigrationStorage {
  loadRaw(): Promise<unknown>;
  save(db: ApiDatabase): Promise<void>;
  updateAppStateWithLock?<T>(handler: (raw: unknown) => LockedAppStateUpdate<T> | Promise<LockedAppStateUpdate<T>>): Promise<T>;
}

export interface UserProfileAppStateMigrationResult {
  saved: boolean;
  profileChanged: boolean;
  markerChanged: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeAppStateMigrations(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const normalized: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(source)) {
    if (typeof rawValue === "string" && rawValue.trim()) {
      normalized[key] = rawValue.trim();
    }
  }
  return normalized;
}

function persistedField(record: Record<string, unknown>, key: keyof UserProfile): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] ?? null : MISSING_FIELD;
}

export function deriveLegacyPerformanceAccessForMigration(
  user: Record<string, unknown>,
  validOrganizationIds: ReadonlySet<string>,
): PerformanceAccessLevel {
  const hasOrganizationContext =
    user.accountType === "enterprise" &&
    typeof user.orgId === "string" &&
    user.orgId.trim().length > 0 &&
    validOrganizationIds.has(user.orgId);
  if (!hasOrganizationContext) {
    return "none";
  }

  if (typeof user.performanceAccess === "string" && isPerformanceAccessLevel(user.performanceAccess)) {
    return user.performanceAccess;
  }

  const orgRole = typeof user.orgRole === "string" && isOrgUserRole(user.orgRole) ? user.orgRole : "user";
  if (orgRole === "org_admin") {
    return "organization";
  }
  if (orgRole === "user_admin") {
    return "team";
  }
  return "none";
}

function applyLegacyPerformanceAccessMigration(rawUsers: unknown, normalized: ApiDatabase): void {
  const persistedUsers = Array.isArray(rawUsers) ? rawUsers.map((user) => asRecord(user)) : [];
  const persistedUsersById = new Map(
    persistedUsers
      .filter((user) => typeof user.id === "string")
      .map((user) => [user.id as string, user] as const),
  );
  const validOrganizationIds = new Set(normalized.orgs.map((org) => org.id));

  normalized.users = normalized.users.map((user, index) => {
    const persistedUser = persistedUsersById.get(user.id) ?? persistedUsers[index] ?? {};
    return {
      ...user,
      performanceAccess: deriveLegacyPerformanceAccessForMigration(persistedUser, validOrganizationIds),
    };
  });
}

export function buildUserProfileMigrationFingerprint(users: unknown): unknown[] {
  if (!Array.isArray(users)) {
    return [];
  }

  return users.map((user) => {
    const record = asRecord(user);
    return {
      id: record.id,
      firstName: persistedField(record, "firstName"),
      lastName: persistedField(record, "lastName"),
      employeeId: persistedField(record, "employeeId"),
      managerUserId: persistedField(record, "managerUserId"),
      orgRole: persistedField(record, "orgRole"),
      performanceAccess: persistedField(record, "performanceAccess"),
      dashboardAccessEnabled: persistedField(record, "dashboardAccessEnabled"),
      mobileProfileReonboardingRequired: persistedField(record, "mobileProfileReonboardingRequired")
    };
  });
}

function fingerprintsMatch(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function preserveLegacyExtractedStorePayloads(
  snapshot: ApiDatabase,
  rawRecord: Record<string, unknown>
): ApiDatabase {
  const preserved = snapshot as ApiDatabase & Record<string, unknown>;
  const preservedRecord = preserved as Record<string, unknown>;
  for (const field of LEGACY_EXTRACTED_STORE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawRecord, field)) {
      preservedRecord[field] = rawRecord[field];
    }
  }
  return preserved;
}

export async function migrateUserProfileAppStateNormalization(params: {
  storage: UserProfileAppStateMigrationStorage;
  ensureDatabaseShape: (candidate: unknown) => ApiDatabase;
  buildPersistedDatabaseSnapshot: (db: ApiDatabase) => ApiDatabase;
  syncEmployeeIds?: (users: UserProfile[]) => Promise<void>;
}): Promise<UserProfileAppStateMigrationResult> {
  const prepareUpdate = async (raw: unknown): Promise<LockedAppStateUpdate<UserProfileAppStateMigrationResult>> => {
    const rawRecord = asRecord(raw);
    const migrations = normalizeAppStateMigrations(rawRecord.appStateMigrations);
    const performanceAccessMigrationRequired =
      migrations[PERFORMANCE_ACCESS_APP_STATE_MIGRATION_KEY] !== PERFORMANCE_ACCESS_APP_STATE_MIGRATION_VERSION;
    const normalized = params.ensureDatabaseShape(raw);
    if (performanceAccessMigrationRequired) {
      applyLegacyPerformanceAccessMigration(rawRecord.users, normalized);
    }
    const markerChanged =
      migrations[USER_PROFILE_APP_STATE_MIGRATION_KEY] !== USER_PROFILE_APP_STATE_MIGRATION_VERSION ||
      performanceAccessMigrationRequired;
    const profileChanged = !fingerprintsMatch(
      buildUserProfileMigrationFingerprint(rawRecord.users),
      buildUserProfileMigrationFingerprint(normalized.users)
    );

    normalized.appStateMigrations = {
      ...migrations,
      [USER_PROFILE_APP_STATE_MIGRATION_KEY]: USER_PROFILE_APP_STATE_MIGRATION_VERSION,
      [PERFORMANCE_ACCESS_APP_STATE_MIGRATION_KEY]: PERFORMANCE_ACCESS_APP_STATE_MIGRATION_VERSION
    };

    if (!profileChanged && !markerChanged) {
      return {
        shouldSave: false,
        result: {
          saved: false,
          profileChanged,
          markerChanged
        }
      };
    }

    await params.syncEmployeeIds?.(normalized.users);
    return {
      shouldSave: true,
      state: preserveLegacyExtractedStorePayloads(
        params.buildPersistedDatabaseSnapshot(normalized),
        rawRecord
      ),
      result: {
        saved: true,
        profileChanged,
        markerChanged
      }
    };
  };

  if (params.storage.updateAppStateWithLock) {
    return params.storage.updateAppStateWithLock(prepareUpdate);
  }

  const raw = await params.storage.loadRaw();
  const update = await prepareUpdate(raw);
  if (update.shouldSave) {
    await params.storage.save(update.state);
  }
  return update.result;
}
