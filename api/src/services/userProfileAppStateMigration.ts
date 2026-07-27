import type { ApiDatabase, UserProfile } from "@voicepractice/shared";

export const USER_PROFILE_APP_STATE_MIGRATION_KEY = "user_profile_management_v1";
export const USER_PROFILE_APP_STATE_MIGRATION_VERSION = "2026-07-27";

const MISSING_FIELD = "__peritio_missing_field__";

export interface UserProfileAppStateMigrationStorage {
  loadRaw(): Promise<unknown>;
  save(db: ApiDatabase): Promise<void>;
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
      dashboardAccessEnabled: persistedField(record, "dashboardAccessEnabled"),
      mobileProfileReonboardingRequired: persistedField(record, "mobileProfileReonboardingRequired")
    };
  });
}

function fingerprintsMatch(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function migrateUserProfileAppStateNormalization(params: {
  storage: UserProfileAppStateMigrationStorage;
  ensureDatabaseShape: (candidate: unknown) => ApiDatabase;
  buildPersistedDatabaseSnapshot: (db: ApiDatabase) => ApiDatabase;
  syncEmployeeIds?: (users: UserProfile[]) => Promise<void>;
}): Promise<UserProfileAppStateMigrationResult> {
  const raw = await params.storage.loadRaw();
  const rawRecord = asRecord(raw);
  const normalized = params.ensureDatabaseShape(raw);
  const migrations = normalizeAppStateMigrations(rawRecord.appStateMigrations);
  const markerChanged = migrations[USER_PROFILE_APP_STATE_MIGRATION_KEY] !== USER_PROFILE_APP_STATE_MIGRATION_VERSION;
  const profileChanged = !fingerprintsMatch(
    buildUserProfileMigrationFingerprint(rawRecord.users),
    buildUserProfileMigrationFingerprint(normalized.users)
  );

  normalized.appStateMigrations = {
    ...migrations,
    [USER_PROFILE_APP_STATE_MIGRATION_KEY]: USER_PROFILE_APP_STATE_MIGRATION_VERSION
  };

  if (!profileChanged && !markerChanged) {
    return {
      saved: false,
      profileChanged,
      markerChanged
    };
  }

  await params.syncEmployeeIds?.(normalized.users);
  await params.storage.save(params.buildPersistedDatabaseSnapshot(normalized));
  return {
    saved: true,
    profileChanged,
    markerChanged
  };
}
