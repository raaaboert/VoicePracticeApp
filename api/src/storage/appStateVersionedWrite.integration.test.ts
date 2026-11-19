import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import type { ApiDatabase, UsageSessionRecord } from "@voicepractice/shared";
import { Pool } from "pg";

import {
  createDatabaseStorage,
  isAppStateWriteConflictError,
  type AppStateVersion,
  type DatabaseStorage,
} from "../storage.js";
import { migrateTrainingPackSchema } from "./trainingPackMigrations.js";

// Requires a disposable LOCAL PostgreSQL database whose name contains "test",
// "integration" or "throwaway". Never point this at staging or production.
const databaseUrl = process.env.APP_STATE_INTEGRATION_DATABASE_URL?.trim() || "";

function assertLocalThrowawayDatabase(url: string): void {
  const normalized = url.toLowerCase();
  if (normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod") || normalized.includes("render.com")) {
    throw new Error("app_state version integration tests refuse hosted databases.");
  }
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").toLowerCase();
  if (!/(test|integration|throwaway)/.test(databaseName)) {
    throw new Error("app_state version integration tests require an explicitly named test database.");
  }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("app_state version integration tests require a LOCAL PostgreSQL database.");
  }
}

function scopedDatabaseUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

type Doc = ApiDatabase & { probe?: string };
const asDoc = (candidate: unknown) => candidate as Doc;

function storageFor(url: string, pools: Pool[]): DatabaseStorage {
  // A separate pool per storage instance models a separate API process.
  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 1_000 });
  pools.push(pool);
  return createDatabaseStorage({
    provider: "postgres", dbPath: "unused", databaseUrl: url,
    pgPoolMax: 3, pgConnectTimeoutMs: 15_000, pgIdleTimeoutMs: 1_000,
    ensureDatabaseShape: asDoc,
    createDefaultDatabase: () => ({ probe: "default" }) as Doc,
    queryPool: pool,
  });
}

async function rowVersion(pool: Pool): Promise<{ version: string; updatedAt: string; state: Doc }> {
  const result = await pool.query<{ version: string; updated_at: Date; state_json: Doc }>(
    "SELECT xmin::text AS version, updated_at, state_json FROM app_state WHERE id = 'primary'",
  );
  const row = result.rows[0]!;
  return { version: row.version, updatedAt: row.updated_at.toISOString(), state: row.state_json };
}

/** Resolves "pending" if the promise has not settled within `ms`. */
async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<"settled" | "pending"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"pending">((resolve) => { timer = setTimeout(() => resolve("pending"), ms); });
  try {
    return await Promise.race([promise.then(() => "settled" as const, () => "settled" as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

test("app_state whole-document writes are version-checked on real PostgreSQL", { skip: !databaseUrl }, async (t) => {
  assertLocalThrowawayDatabase(databaseUrl);
  const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `app_state_cas_${randomBytes(8).toString("hex")}`;
  const pools: Pool[] = [];
  try {
    await setupPool.query(`CREATE SCHEMA "${schema}"`);
    const url = scopedDatabaseUrl(databaseUrl, schema);
    const verify = new Pool({ connectionString: url, max: 2 });
    pools.push(verify);
    const processA = storageFor(url, pools);
    const processB = storageFor(url, pools);
    await processA.loadVersioned(); // creates the table and the default row

    const reset = async (probe: string): Promise<AppStateVersion> => {
      const version = await processA.save({ probe } as Doc);
      assert.ok(version);
      return version;
    };

    await t.test("two processes load the same version; the stale one cannot overwrite the first commit", async () => {
      await reset("initial");
      const a = await processA.loadVersioned();
      const b = await processB.loadVersioned();
      assert.equal(a.version, b.version, "both processes start from the same stored version");
      assert.equal(asDoc(b.db).probe, "initial");

      const committed = await processA.save({ ...a.db, probe: "written by A" } as Doc, null, { expectedVersion: a.version });
      assert.ok(committed);
      assert.notEqual(committed, a.version, "a successful write produces a new version");

      await assert.rejects(
        processB.save({ ...b.db, probe: "stale write by B" } as Doc, null, { expectedVersion: b.version }),
        (error: unknown) => isAppStateWriteConflictError(error),
      );

      const stored = await rowVersion(verify);
      assert.equal(stored.state.probe, "written by A", "A's update survives B's stale attempt");
      assert.equal(stored.version, committed, "B's refused attempt left no new row version");

      // After reloading, B works from A's document and can write normally.
      const reloaded = await processB.loadVersioned();
      assert.equal(asDoc(reloaded.db).probe, "written by A");
      const next = await processB.save({ ...reloaded.db, probe: "B after reload" } as Doc, null, { expectedVersion: reloaded.version });
      assert.equal((await rowVersion(verify)).version, next);
      assert.equal((await rowVersion(verify)).state.probe, "B after reload");
    });

    await t.test("a concurrent stale write waits for the in-flight commit, then is refused", async () => {
      const base = await reset("concurrent base");
      let releaseA!: () => void;
      const holdA = new Promise<void>((resolve) => { releaseA = resolve; });
      let aWroteInsideTransaction!: () => void;
      const aWrote = new Promise<void>((resolve) => { aWroteInsideTransaction = resolve; });

      const aCommit = processA.runTransaction(async (client) => {
        const version = await processA.save({ probe: "A in transaction" } as Doc, client, { expectedVersion: base });
        aWroteInsideTransaction();
        await holdA; // A holds the row lock and has not committed yet
        return version;
      });
      await aWrote;

      const bWrite = processB.save({ probe: "B concurrent" } as Doc, null, { expectedVersion: base });
      assert.equal(await settledWithin(bWrite, 400), "pending", "B's write blocks behind A's uncommitted update");
      assert.equal((await rowVersion(verify)).state.probe, "concurrent base", "readers do not see A before COMMIT");

      releaseA();
      const aVersion = await aCommit;
      await assert.rejects(bWrite, (error: unknown) => isAppStateWriteConflictError(error));
      const stored = await rowVersion(verify);
      assert.equal(stored.state.probe, "A in transaction");
      assert.equal(stored.version, aVersion);
    });

    await t.test("if the in-flight transaction rolls back, the waiting write proceeds", async () => {
      const base = await reset("rollback base");
      let releaseA!: () => void;
      const holdA = new Promise<void>((resolve) => { releaseA = resolve; });
      let aWroteInsideTransaction!: () => void;
      const aWrote = new Promise<void>((resolve) => { aWroteInsideTransaction = resolve; });

      const aCommit = processA.runTransaction(async (client) => {
        await processA.save({ probe: "A rolled back" } as Doc, client, { expectedVersion: base });
        aWroteInsideTransaction();
        await holdA;
        throw new Error("injected failure after app_state write");
      });
      await aWrote;
      const bWrite = processB.save({ probe: "B after A rollback" } as Doc, null, { expectedVersion: base });
      assert.equal(await settledWithin(bWrite, 400), "pending");
      releaseA();
      await assert.rejects(aCommit, /injected failure/);
      const bVersion = await bWrite;
      const stored = await rowVersion(verify);
      assert.equal(stored.state.probe, "B after A rollback");
      assert.equal(stored.version, bVersion);
    });

    await t.test("a conflict rolls back the other writes in the same transaction", async () => {
      await verify.query("CREATE TABLE IF NOT EXISTS side_effects (id TEXT PRIMARY KEY)");
      const stale = await reset("side-effect base");
      await processA.save({ probe: "newer" } as Doc, null, { expectedVersion: stale });
      await assert.rejects(
        processB.runTransaction(async (client) => {
          await client!.query("INSERT INTO side_effects (id) VALUES ('written_before_conflict')");
          await processB.save({ probe: "stale" } as Doc, client, { expectedVersion: stale });
        }),
        (error: unknown) => isAppStateWriteConflictError(error),
      );
      assert.equal((await verify.query("SELECT 1 FROM side_effects")).rowCount, 0);
      assert.equal((await rowVersion(verify)).state.probe, "newer");
    });

    await t.test("locked writers interoperate: lock-only keeps the version, a locked save changes it", async () => {
      const base = await reset("locked base");
      await processA.updateAppStateWithLock(() => ({ result: null, shouldSave: false }));
      assert.equal((await rowVersion(verify)).version, base, "a lock without an update does not change the version");
      const afterLockOnly = await processB.save({ probe: "B after lock-only" } as Doc, null, { expectedVersion: base });

      await processA.updateAppStateWithLock((raw) => ({
        result: null, shouldSave: true, state: { ...asDoc(raw), probe: "locked migration" } as Doc,
      }));
      await assert.rejects(
        processB.save({ probe: "stale after locked migration" } as Doc, null, { expectedVersion: afterLockOnly }),
        (error: unknown) => isAppStateWriteConflictError(error),
      );
      assert.equal((await rowVersion(verify)).state.probe, "locked migration");
    });

    await t.test("an unconditional operator-style write also invalidates cached versions", async () => {
      const base = await reset("operator base");
      await verify.query("UPDATE app_state SET state_json = '{\"probe\":\"operator script\"}'::jsonb WHERE id = 'primary'");
      await assert.rejects(
        processB.save({ probe: "stale API write" } as Doc, null, { expectedVersion: base }),
        (error: unknown) => isAppStateWriteConflictError(error),
      );
      assert.equal((await rowVersion(verify)).state.probe, "operator script");
    });

    await t.test("a write with no known base version is refused", async () => {
      await reset("unknown base");
      await assert.rejects(
        processB.save({ probe: "no base" } as Doc, null, { expectedVersion: null }),
        (error: unknown) => isAppStateWriteConflictError(error),
      );
      assert.equal((await rowVersion(verify)).state.probe, "unknown base");
    });
  } finally {
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
    await setupPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await setupPool.end();
  }
});

test("real API startup migrations and request writes against real PostgreSQL", { skip: !databaseUrl }, async (t) => {
  assertLocalThrowawayDatabase(databaseUrl);
  const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `app_state_boot_${randomBytes(8).toString("hex")}`;
  const pools: Pool[] = [];
  try {
    await setupPool.query(`CREATE SCHEMA "${schema}"`);
    const url = scopedDatabaseUrl(databaseUrl, schema);
    // Explicit values win over any .env file: dotenv never overrides set variables.
    Object.assign(process.env, {
      NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres", DATABASE_URL: url,
      PG_IDLE_TIMEOUT_MS: "100", FOCUS_TOPIC_AUTHORITY: "legacy",
      ADMIN_TOKEN_SECRET: "app_state_cas_admin_secret_2026", ADMIN_BOOTSTRAP_PASSWORD: "local_test_password",
      WEB_AUTH_TOKEN_SECRET: "app_state_cas_web_token_secret_2026", WEB_AUTH_CODE_SECRET: "app_state_cas_web_code_secret_2026",
      MOBILE_TOKEN_SECRET: "app_state_cas_mobile_token_secret_2026", SUPPORT_TRANSCRIPT_SECRET: "app_state_cas_support_secret_2026",
      AUTH_CODE_DELIVERY_PROVIDER: "log_only", OPENAI_API_KEY: "local-test-key", ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false",
    });
    const verify = new Pool({ connectionString: url, max: 2 });
    pools.push(verify);
    // The API refuses to start without this explicit operator migration.
    await migrateTrainingPackSchema(verify);
    const api = await import("../index.js");
    assert.equal(process.env.DATABASE_URL, url, "the API under test uses the throwaway database");

    // Persisted document as a current API would store it, plus one legacy
    // usage session still embedded in app_state (a real pending migration).
    const persisted = api.createDefaultDatabase() as ApiDatabase & Record<string, unknown>;
    api.ensureDemoEnterpriseData(persisted, "2026-11-01T00:00:00.000Z");
    const sourceOrg = persisted.orgs.find((row) => row.status === "active")!;
    const org = { ...sourceOrg, id: "b08_org", name: "B08 organization", joinCode: "B08-LOCAL" };
    const owner = {
      ...persisted.users.find((row) => row.orgId === sourceOrg.id && !row.isSuperUser)!,
      id: "legacy_user", orgId: org.id, email: "legacy-user@b08.test",
    };
    persisted.orgs = [org];
    persisted.users = [owner];
    for (const key of ["usageSessions", "aiUsageEvents", "scoreRecords", "webAuthSessions", "auditEvents", "supportCases"]) {
      delete persisted[key];
    }
    // The owner exists in app_state, so startup integrity cleanup keeps the moved row.
    const legacySession: UsageSessionRecord = {
      id: "legacy_usage_1", userId: owner.id, orgId: org.id, segmentId: "solution_manager", scenarioId: "legacy_scenario",
      startedAt: "2026-11-01T10:00:00.000Z", endedAt: "2026-11-01T10:05:00.000Z", rawDurationSeconds: 300,
      createdAt: "2026-11-01T10:05:00.000Z",
    };
    await verify.query(`CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY, state_json JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await verify.query("INSERT INTO app_state (id, state_json) VALUES ('primary', $1::jsonb)",
      [JSON.stringify({ ...persisted, usageSessions: [legacySession] })]);

    await t.test("a real pending migration still persists its changes", async () => {
      const before = await rowVersion(verify);
      await api.runStartupDatabaseInitializationForTest();
      const after = await rowVersion(verify);
      assert.notEqual(after.version, before.version, "the migration rewrote app_state");
      assert.equal(Object.prototype.hasOwnProperty.call(after.state, "usageSessions"), false,
        "legacy usage sessions were stripped from app_state");
      const moved = await verify.query<{ id: string }>("SELECT id FROM usage_sessions WHERE id = 'legacy_usage_1'");
      assert.equal(moved.rowCount, 1, "the legacy usage session moved to its dedicated table");
    });

    await t.test("a normal restart with nothing pending performs no app_state write", async () => {
      const before = await rowVersion(verify);
      await api.runStartupDatabaseInitializationForTest();
      const after = await rowVersion(verify);
      assert.equal(after.version, before.version, "no new row version after restart");
      assert.equal(after.updatedAt, before.updatedAt, "updated_at unchanged after restart");
      assert.deepEqual(after.state, before.state);

      await api.runStartupDatabaseInitializationForTest();
      assert.equal((await rowVersion(verify)).version, before.version, "a second restart writes nothing either");
    });

    await t.test("a request write from a stale cache is refused, not replayed, and the cache reloads", async () => {
      // Warm this API process's cache with the current version.
      await api.withDatabaseWriteForTest((db) => {
        db.appStateMigrations = { ...db.appStateMigrations, b08_warm: "1" };
      });
      const warmed = await rowVersion(verify);

      // Another API process commits a newer document.
      const otherStorage = storageFor(url, pools);
      const current = await otherStorage.loadRaw() as ApiDatabase;
      await otherStorage.save({
        ...current, appStateMigrations: { ...current.appStateMigrations, b08_other_process: "1" },
      } as ApiDatabase, null, { expectedVersion: warmed.version });
      const afterOther = await rowVersion(verify);

      let handlerCalls = 0;
      await assert.rejects(
        api.withDatabaseWriteForTest((db) => {
          handlerCalls += 1;
          db.appStateMigrations = { ...db.appStateMigrations, b08_stale_attempt: "1" };
        }),
        (error: unknown) => isAppStateWriteConflictError(error),
      );
      assert.equal(handlerCalls, 1, "the conflicting operation is not replayed automatically");
      const afterConflict = await rowVersion(verify);
      assert.equal(afterConflict.version, afterOther.version, "the refused write changed nothing");
      assert.equal(afterConflict.state.appStateMigrations?.b08_other_process, "1", "the other process's update survives");
      assert.equal(afterConflict.state.appStateMigrations?.b08_stale_attempt, undefined);

      // The cache was dropped, so the next request works from the newer document.
      await api.withDatabaseWriteForTest((db) => {
        assert.equal(db.appStateMigrations?.b08_other_process, "1", "the cache reloaded the newer document");
        db.appStateMigrations = { ...db.appStateMigrations, b08_after_reload: "1" };
      });
      const final = await rowVersion(verify);
      assert.equal(final.state.appStateMigrations?.b08_other_process, "1");
      assert.equal(final.state.appStateMigrations?.b08_after_reload, "1");
    });
  } finally {
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
    await setupPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await setupPool.end();
  }
});
