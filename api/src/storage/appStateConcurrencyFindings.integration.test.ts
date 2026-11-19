import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import type { ApiDatabase, SupportCaseRecord, UserProfile } from "@voicepractice/shared";
import { Pool } from "pg";

import { commitAuthoritativeAppState } from "../services/authoritativeAppStateCommit.js";
import { inspectOrphanedUserScopedHistory, repairOrphanedUserScopedHistory } from "../services/integrityMaintenance.js";
import {
  migrateUserProfileAppStateNormalization,
  USER_PROFILE_APP_STATE_MIGRATION_KEY,
} from "../services/userProfileAppStateMigration.js";
import { createDatabaseStorage, isAppStateWriteConflictError, type DatabaseStorage } from "../storage.js";
import { createAuditEventStore } from "./auditEventStore.js";
import { createSupportCaseStore } from "./supportCaseStore.js";
import { migrateTrainingPackSchema } from "./trainingPackMigrations.js";
import { createUserEmployeeIdClaimStore, type UserEmployeeIdClaimStore } from "./userEmployeeIdClaimStore.js";
import { createWebAuthSessionStore } from "./webAuthSessionStore.js";

// Regression tests for the Nov 19 independent review findings F1-F3.
// Requires a disposable LOCAL PostgreSQL database whose name contains "test",
// "integration" or "throwaway". Never point this at staging or production.
const databaseUrl = process.env.APP_STATE_INTEGRATION_DATABASE_URL?.trim() || "";

function assertLocalThrowawayDatabase(url: string): void {
  const normalized = url.toLowerCase();
  if (normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod") || normalized.includes("render.com")) {
    throw new Error("concurrency regression tests refuse hosted databases.");
  }
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").toLowerCase();
  if (!/(test|integration|throwaway)/.test(databaseName)) {
    throw new Error("concurrency regression tests require an explicitly named test database.");
  }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("concurrency regression tests require a LOCAL PostgreSQL database.");
  }
}

function scopedDatabaseUrl(url: string, schema: string, extraOptions = ""): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}${extraOptions}`);
  return parsed.toString();
}

const LEGACY_KEYS = ["usageSessions", "aiUsageEvents", "scoreRecords", "webAuthSessions", "auditEvents", "supportCases"];
function persistedSnapshot(db: ApiDatabase): ApiDatabase {
  const snapshot = { ...db } as ApiDatabase & Record<string, unknown>;
  for (const key of LEGACY_KEYS) delete snapshot[key];
  return snapshot;
}

/** Rejects if `promise` has not settled within `ms` (a hang becomes a failure). */
async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not complete within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function isPending(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const pending = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), ms); });
  try {
    return await Promise.race([promise.then(() => false, () => false), pending]);
  } finally {
    clearTimeout(timer);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("Nov 19 review findings F1-F3 on real PostgreSQL", { skip: !databaseUrl }, async (t) => {
  assertLocalThrowawayDatabase(databaseUrl);
  const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `app_state_findings_${randomBytes(8).toString("hex")}`;
  const pools: Pool[] = [];
  const newPool = (url: string) => {
    const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 1_000 });
    pools.push(pool);
    return pool;
  };
  try {
    await setupPool.query(`CREATE SCHEMA "${schema}"`);
    const url = scopedDatabaseUrl(databaseUrl, schema);
    Object.assign(process.env, {
      NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres", DATABASE_URL: url,
      PG_IDLE_TIMEOUT_MS: "100", FOCUS_TOPIC_AUTHORITY: "legacy",
      ADMIN_TOKEN_SECRET: "app_state_findings_admin_secret_2026", ADMIN_BOOTSTRAP_PASSWORD: "local_test_password",
      WEB_AUTH_TOKEN_SECRET: "app_state_findings_web_token_2026", WEB_AUTH_CODE_SECRET: "app_state_findings_web_code_2026",
      MOBILE_TOKEN_SECRET: "app_state_findings_mobile_token_2026", SUPPORT_TRANSCRIPT_SECRET: "app_state_findings_support_2026",
      AUTH_CODE_DELIVERY_PROVIDER: "log_only", OPENAI_API_KEY: "local-test-key", ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false",
    });
    const verify = newPool(url);
    await migrateTrainingPackSchema(verify);
    const api = await import("../index.js");
    assert.equal(process.env.DATABASE_URL, url, "the API under test uses the throwaway database");

    const storeOptions = {
      provider: "postgres" as const, dbPath: "unused", databaseUrl: url,
      pgPoolMax: 3, pgConnectTimeoutMs: 15_000, pgIdleTimeoutMs: 1_000,
    };
    const newStorage = (): DatabaseStorage => createDatabaseStorage({
      ...storeOptions, queryPool: newPool(url),
      ensureDatabaseShape: api.ensureDatabaseShape, createDefaultDatabase: api.createDefaultDatabase,
    });
    const newClaims = (poolUrl = url): UserEmployeeIdClaimStore =>
      createUserEmployeeIdClaimStore({ ...storeOptions, queryPool: newPool(poolUrl) });
    const sessionStore = createWebAuthSessionStore({ ...storeOptions, queryPool: newPool(url) });
    const auditStore = createAuditEventStore({ ...storeOptions, queryPool: newPool(url) });
    const supportStore = createSupportCaseStore(storeOptions);

    // Seed: one enterprise user with an employee ID.
    const seed = api.createDefaultDatabase() as ApiDatabase;
    api.ensureDemoEnterpriseData(seed, "2026-11-01T00:00:00.000Z");
    const sourceOrg = seed.orgs.find((row) => row.status === "active")!;
    const org = { ...sourceOrg, id: "findings_org", name: "Findings organization", joinCode: "FINDINGS-1" };
    const owner: UserProfile = {
      ...seed.users.find((row) => row.orgId === sourceOrg.id && !row.isSuperUser)!,
      id: "findings_owner", orgId: org.id, email: "owner@findings.test", accountType: "enterprise", employeeId: "EMP-1",
    };
    seed.orgs = [org];
    seed.users = [owner];
    await verify.query(`CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY, state_json JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await verify.query("INSERT INTO app_state (id, state_json) VALUES ('primary', $1::jsonb)",
      [JSON.stringify(persistedSnapshot(seed))]);
    await api.runStartupDatabaseInitializationForTest(); // creates every store table, reconciles claims
    await supportStore.initialize();

    const storedState = async () =>
      (await verify.query<{ state_json: ApiDatabase; version: string }>(
        "SELECT state_json, xmin::text AS version FROM app_state WHERE id = 'primary'")).rows[0]!;
    const claimRows = async () =>
      (await verify.query<{ user_id: string; employee_id: string }>(
        "SELECT user_id, employee_id FROM user_employee_id_claims ORDER BY user_id")).rows;
    const assertClaimsMatchAppState = async (label: string) => {
      const { state_json } = await storedState();
      const expected = state_json.users
        .filter((user) => user.accountType === "enterprise" && user.orgId && user.employeeId?.trim())
        .map((user) => ({ user_id: user.id, employee_id: user.employeeId! }))
        .sort((left, right) => left.user_id.localeCompare(right.user_id));
      assert.deepEqual(await claimRows(), expected, `${label}: claims match the committed users`);
    };
    /** Another API process commits through the real authoritative commit path. */
    const commitAs = async (storage: DatabaseStorage, claims: UserEmployeeIdClaimStore, mutate: (db: ApiDatabase) => void) => {
      const { db: before, version } = await storage.loadVersioned();
      const working = structuredClone(before);
      mutate(working);
      await commitAuthoritativeAppState({
        storage, claimStore: claims, sessionStore, auditStore, before, expectedVersion: version, working,
        auditEvents: [], buildPersistedSnapshot: persistedSnapshot, onCommitted: () => {},
      });
    };
    const supportCase = (id: string, userId: string): SupportCaseRecord => ({
      id, status: "open", userId, orgId: org.id, segmentId: null, scenarioId: null, message: "Synthetic support request.",
      transcriptEncrypted: null, transcriptExpiresAt: null, transcriptFileName: null, transcriptMeta: null,
      createdAt: "2026-11-19T12:00:00.000Z", updatedAt: "2026-11-19T12:00:00.000Z",
    });
    const emptyHistory = {
      usageSessionAccess: { list: () => [], deleteForUser: async () => 0 },
      simulationSessionStore: { listSessions: async () => [], deleteSessionsForUser: async () => 0, pruneStartedSessionsLastSeenBefore: async () => 0 },
      scoreRecordAccess: { list: () => [], deleteForUser: async () => 0 },
      aiUsageEventAccess: { list: async () => [], deleteForUser: async () => 0 },
    };

    await t.test("F1: startup inspection with a stale user snapshot never deletes a newly created user's record", async () => {
      // Process A reads the user population.
      const staleSnapshot = (await newStorage().loadVersioned()).db;
      // Process B creates a valid user and that user's first support case.
      await commitAs(newStorage(), newClaims(), (db) => {
        db.users.push({ ...db.users[0]!, id: "f1_new_user", email: "f1-new@findings.test", employeeId: null });
      });
      await supportStore.saveCase(supportCase("f1_case", "f1_new_user"));
      assert.ok((await storedState()).state_json.users.some((user) => user.id === "f1_new_user"));

      // A's startup integrity pass runs against its stale snapshot.
      const inspection = await inspectOrphanedUserScopedHistory({
        db: staleSnapshot, ...emptyHistory, supportCaseStore: supportStore, now: new Date(),
      });
      assert.equal(inspection.suspectedOrphanedSupportCases, 1, "reported as a suspect for diagnostics");
      assert.ok(await supportStore.getCaseById("f1_case"), "the valid support case still exists");

      // Control: the previous startup behavior (destructive repair) with the same
      // stale snapshot deletes the valid record. This is the defect F1 removes.
      const repaired = await repairOrphanedUserScopedHistory({
        db: structuredClone(staleSnapshot), ...emptyHistory, supportCaseStore: supportStore,
      } as unknown as Parameters<typeof repairOrphanedUserScopedHistory>[0]);
      assert.equal(repaired.orphanedSupportCasesDeleted, 1);
      assert.equal(await supportStore.getCaseById("f1_case"), null, "control: old startup repair destroyed the record");
    });

    await t.test("F1: real API startup leaves records of unknown users in place", async () => {
      await supportStore.saveCase(supportCase("f1_unknown_case", "f1_user_not_in_app_state"));
      await api.runStartupDatabaseInitializationForTest();
      assert.ok(await supportStore.getCaseById("f1_unknown_case"), "startup is non-destructive");
    });

    await t.test("F2: a stale writer's refused save leaves no stale employee-ID claims", async () => {
      await assertClaimsMatchAppState("before");
      // This API process warms its cache.
      await api.withDatabaseWriteForTest((db) => {
        db.appStateMigrations = { ...db.appStateMigrations, f2_warm: "1" };
      });
      // Another process changes the employee ID (app_state and claims commit together).
      await commitAs(newStorage(), newClaims(), (db) => {
        db.users.find((user) => user.id === owner.id)!.employeeId = "EMP-NEW";
      });
      assert.deepEqual((await claimRows()).find((row) => row.user_id === owner.id)?.employee_id, "EMP-NEW");

      // The stale process tries to write its own employee ID for the same user.
      await assert.rejects(
        api.withDatabaseWriteForTest((db) => {
          db.users.find((user) => user.id === owner.id)!.employeeId = "EMP-STALE";
        }),
        (error: unknown) => isAppStateWriteConflictError(error),
      );
      const stored = await storedState();
      assert.equal(stored.state_json.users.find((user) => user.id === owner.id)?.employeeId, "EMP-NEW");
      await assertClaimsMatchAppState("after refused stale write");
    });

    await t.test("F2: a refused startup-migration save (saveDatabase) rolls its claim rewrite back", async () => {
      // Warm this process's cache, then let another process change the employee ID.
      await api.withDatabaseWriteForTest((db) => {
        db.appStateMigrations = { ...db.appStateMigrations, f2_save_warm: "1" };
      });
      await commitAs(newStorage(), newClaims(), (db) => {
        db.users.find((user) => user.id === owner.id)!.employeeId = "EMP-SAVE-NEWER";
      });
      // The stale cache still has the previous ID; its save syncs claims from it, then is refused.
      await assert.rejects(
        api.saveCachedDatabaseForTest((db) => {
          db.users.find((user) => user.id === owner.id)!.employeeId = "EMP-SAVE-STALE";
        }),
        (error: unknown) => isAppStateWriteConflictError(error),
      );
      assert.equal((await storedState()).state_json.users.find((user) => user.id === owner.id)?.employeeId, "EMP-SAVE-NEWER");
      await assertClaimsMatchAppState("after refused saveDatabase");
    });

    await t.test("F2: drift from the old read-time sync is repaired by the locked reconcile; a no-op reconcile writes nothing", async () => {
      // Emulate the removed behavior: a read-path sync from a stale snapshot
      // committed on its own connection, leaving claims behind app_state.
      const stale = structuredClone((await storedState()).state_json);
      stale.users.find((user) => user.id === owner.id)!.employeeId = "EMP-OLD-SNAPSHOT";
      await newClaims().syncFromUsers(stale.users);
      assert.equal((await claimRows()).find((row) => row.user_id === owner.id)?.employee_id, "EMP-OLD-SNAPSHOT");

      await api.runStartupDatabaseInitializationForTest();
      await assertClaimsMatchAppState("after startup reconcile");

      const stamp = async () => (await verify.query<{ stamp: string }>(
        "SELECT coalesce(string_agg(user_id || ':' || updated_at::text, ',' ORDER BY user_id), '') AS stamp FROM user_employee_id_claims"
      )).rows[0]!.stamp;
      const before = await stamp();
      await api.runStartupDatabaseInitializationForTest();
      assert.equal(await stamp(), before, "consistent claims are not rewritten on restart or reads");
    });

    const markMigrationPending = async () => {
      const storage = newStorage();
      const current = (await storage.loadVersioned()).db;
      const migrations = { ...current.appStateMigrations };
      delete migrations[USER_PROFILE_APP_STATE_MIGRATION_KEY];
      await storage.save(persistedSnapshot({ ...current, appStateMigrations: migrations }));
    };
    const migrate = (storage: DatabaseStorage, options: {
      claims: UserEmployeeIdClaimStore;
      gate?: () => Promise<void>;
      legacyWiring?: boolean;
    }) => migrateUserProfileAppStateNormalization({
      storage,
      ensureDatabaseShape: api.ensureDatabaseShape,
      buildPersistedDatabaseSnapshot: persistedSnapshot,
      ...(options.legacyWiring
        ? {
            // Previous wiring: no claims lock before the row, claims synced on a
            // separate connection while the app_state row lock is held.
            syncEmployeeIds: async (users) => { await options.claims.syncFromUsers(users); },
          }
        : {
            lockBeforeAppStateRow: (client) => options.claims.lockForAppStateWrite(client),
            syncEmployeeIds: async (users, client) => {
              await options.gate?.();
              await options.claims.reconcileFromUsers(users, client);
            },
          }),
    });
    const requestCommitHeldAtSave = async (change: string) => {
      const storage = newStorage();
      const { db: before, version } = await storage.loadVersioned();
      const working = structuredClone(before);
      working.appStateMigrations = { ...working.appStateMigrations, [change]: "1" };
      const atSave = deferred();
      const release = deferred();
      const commit = commitAuthoritativeAppState({
        storage, claimStore: newClaims(), sessionStore, auditStore, before, expectedVersion: version, working,
        auditEvents: [], buildPersistedSnapshot: persistedSnapshot,
        beforeAppStateSave: async () => { atSave.resolve(); await release.promise; },
        onCommitted: () => {},
      });
      return { commit, atSave: atSave.promise, release: release.resolve };
    };

    await t.test("F3 control: the previous migration wiring forms a wait cycle (ends only by lock_timeout)", async () => {
      await markMigrationPending();
      const request = await requestCommitHeldAtSave("f3_control_request");
      await request.atSave; // the request holds the claims table lock
      // lock_timeout only bounds this control; without it the cycle hangs.
      const claimsWithTimeout = newClaims(scopedDatabaseUrl(databaseUrl, schema, " -c lock_timeout=1500"));
      const migration = migrate(newStorage(), { claims: claimsWithTimeout, legacyWiring: true });
      assert.equal(await isPending(migration, 300), true, "migration waits for the claims lock while holding the row");
      request.release(); // the request now needs the row the migration holds
      await assert.rejects(within(migration, 10_000, "legacy migration"),
        (error: unknown) => (error as { code?: string }).code === "55P03", "legacy wiring deadlocks until lock_timeout");
      await within(request.commit, 10_000, "request after legacy migration aborted");
    });

    await t.test("F3: request first — migration waits on the claims lock, then both complete consistently", async () => {
      await markMigrationPending();
      const request = await requestCommitHeldAtSave("f3_request_first");
      await request.atSave;
      const migration = migrate(newStorage(), { claims: newClaims() });
      assert.equal(await isPending(migration, 300), true, "migration queues behind the request's claims lock");
      request.release();
      await within(request.commit, 5_000, "request commit");
      const result = await within(migration, 5_000, "migration");
      assert.equal(result.saved, true, "the pending migration still ran");
      const stored = (await storedState()).state_json;
      assert.equal(stored.appStateMigrations?.f3_request_first, "1", "the request's change survived");
      assert.ok(stored.appStateMigrations?.[USER_PROFILE_APP_STATE_MIGRATION_KEY], "the migration marker was written");
      await assertClaimsMatchAppState("request first");
    });

    await t.test("F3: migration first — the request waits, then is refused as stale; state stays consistent", async () => {
      await markMigrationPending();
      const atGate = deferred();
      const release = deferred();
      const migration = migrate(newStorage(), {
        claims: newClaims(),
        gate: async () => { atGate.resolve(); await release.promise; },
      });
      await atGate.promise; // the migration holds the claims lock and the row lock
      const storage = newStorage();
      const { db: before, version } = await storage.loadVersioned();
      const working = structuredClone(before);
      working.appStateMigrations = { ...working.appStateMigrations, f3_stale_request: "1" };
      const request = commitAuthoritativeAppState({
        storage, claimStore: newClaims(), sessionStore, auditStore, before, expectedVersion: version, working,
        auditEvents: [], buildPersistedSnapshot: persistedSnapshot, onCommitted: () => {},
      });
      assert.equal(await isPending(request, 300), true, "the request waits for the claims lock");
      release.resolve();
      assert.equal((await within(migration, 5_000, "migration")).saved, true);
      await assert.rejects(within(request, 5_000, "stale request"), (error: unknown) => isAppStateWriteConflictError(error));
      const stored = (await storedState()).state_json;
      assert.equal(stored.appStateMigrations?.f3_stale_request, undefined);
      assert.ok(stored.appStateMigrations?.[USER_PROFILE_APP_STATE_MIGRATION_KEY]);
      await assertClaimsMatchAppState("migration first");
    });
  } finally {
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
    await setupPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await setupPool.end();
  }
});
