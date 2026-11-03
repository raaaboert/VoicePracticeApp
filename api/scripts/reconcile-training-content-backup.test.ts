import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PRODUCTION_WRITE_CONFIRMATION } from "../src/productionSafety.js";
import { assertTrainingContentBackupReconciliationTarget, runBackupReconciliation, backupReconciliationExitCode } from "./reconcile-training-content-backup.js";
import type { RuntimeConfig } from "../src/runtimeConfig.js";

const STAGING = {
  target: "staging" as const,
  deploymentEnvironment: "staging",
  liveStorageEnvironment: "staging",
  databaseUrl: "postgres://user:pass@host/voicepractice_db",
  apply: false,
  confirmProduction: null,
};

test("backup reconciliation requires aligned explicit environment lanes", () => {
  assert.equal(assertTrainingContentBackupReconciliationTarget(STAGING), "staging");
  assert.throws(
    () => assertTrainingContentBackupReconciliationTarget({
      ...STAGING,
      liveStorageEnvironment: "production",
    }),
    /must match PERITIO_ENV, live R2 environment, and DATABASE_URL/
  );
});

test("production backup apply requires the normal explicit confirmation", () => {
  const production = {
    target: "production" as const,
    deploymentEnvironment: "production",
    liveStorageEnvironment: "production",
    databaseUrl: "postgres://user:pass@host/peritio-db-prod",
    apply: true,
    confirmProduction: null,
  };
  assert.throws(
    () => assertTrainingContentBackupReconciliationTarget(production),
    /refuses to write to production/
  );
  assert.equal(assertTrainingContentBackupReconciliationTarget({
    ...production,
    confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
  }), "production");
});

test("production confirmation cannot be supplied to a dry run", () => {
  assert.throws(
    () => assertTrainingContentBackupReconciliationTarget({
      target: "production",
      deploymentEnvironment: "production",
      liveStorageEnvironment: "production",
      databaseUrl: "postgres://user:pass@host/peritio-db-prod",
      apply: false,
      confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
    }),
    /only valid for an applied production backup reconciliation/
  );
});

test("reconciliation is dry-run by default and reports IDs without object keys", async () => {
  const source = await readFile(
    new URL("./reconcile-training-content-backup.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /const apply = process\.argv\.includes\("--apply"\)/);
  assert.doesNotMatch(source, /import ["']dotenv/);
  assert.match(source, /objectVerification: "not_requested"/);
});

function databaseFixture(backedUp = false) {
  const row: Record<string, any> = {
    id: "11111111-1111-4111-8111-111111111111", org_id: "org_test", content_id: "22222222-2222-4222-8222-222222222222",
    asset_role: "primary", version: 1, upload_state: "superseded", storage_provider: "r2",
    final_object_key: "objects/private-synthetic-key", original_filename: "synthetic.pdf",
    detected_mime_type: "application/pdf", byte_size: 42, declared_byte_size: 42,
    processing_attempt_count: 0, backup_attempt_count: 1, is_current: false, cleanup_pending: false,
    created_by_actor_id: "test", created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z",
    finalized_at: "2026-11-01T00:00:00Z", superseded_at: "2026-11-02T00:00:00Z",
    backed_up_at: backedUp ? "2026-11-01T00:00:00Z" : null,
  };
  for (const key of ["temporary_object_key", "declared_mime_type", "file_extension", "checksum_or_etag",
    "upload_expires_at", "finalization_nonce", "finalization_started_at", "processing_lease_token",
    "processing_lease_expires_at", "processing_next_attempt_at", "processing_error_category", "replacement_for_asset_id",
    "rejection_reason_category", "object_deleted_at", "authorization_topic_id"]) row[key] = null;
  const rows = [row];
  const statements: string[] = [];
  let released = 0, connected = false;
  const releaseErrors: boolean[] = [];
  const client = {
    async query(sql: string, values: any[] = []) {
      assert.equal(connected, true, "Query attempted after connection release");
      statements.push(sql);
      assert.match(sql.trim(), /^(SELECT|BEGIN TRANSACTION .* READ ONLY|ROLLBACK)\b/);
      assert.doesNotMatch(sql, /advisory|FOR UPDATE|FOR SHARE|\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
      if (sql.includes("LIMIT 0")) return { rows: [] };
      if (sql.includes("COUNT(*)")) return { rows: [{ pending_count: rows.filter(r => !r.backed_up_at).length }] };
      if (sql.includes("FROM org_content_assets")) return { rows: rows.filter(r =>
        (!r.backed_up_at || values[1]) && (!values[2] || r.id > values[2])).slice(0, values[0]) };
      return { rows: [] };
    },
    release(error = false) { released++; connected = false; releaseErrors.push(error); },
  };
  const pool = { async connect() { connected = true; return client; }, async query() { throw new Error("Unscoped connection used"); } };
  return { row, rows, pool, statements, releaseErrors, released: () => released, connected: () => connected };
}

const CONFIG = {
  databaseUrl: STAGING.databaseUrl, pgConnectTimeoutMs: 100, pgIdleTimeoutMs: 100,
  trainingContentStorage: { backup: { enabled: true }, r2: { bucket: "live" } },
} as RuntimeConfig;

test("real store dry-run uses only read-only SQL and does not instantiate R2 or alter retry state", async () => {
  const db = databaseFixture();
  const before = structuredClone(db.row);
  const report = await runBackupReconciliation({ runtimeConfig: CONFIG, pool: db.pool as any,
    apply: false, limit: 100, storageFactory: () => { throw new Error("R2 instantiated during inventory"); } });
  assert.equal(report.pending, 1);
  assert.deepEqual(report.assetIds, [db.row.id]);
  assert.equal(backupReconciliationExitCode(report), 2);
  assert.equal(JSON.stringify(report).includes(db.row.final_object_key), false);
  assert.deepEqual(db.row, before);
  assert.match(db.statements[0]!, /READ ONLY/);
  assert.equal(db.statements.at(-1), "ROLLBACK");
  assert.equal(db.released(), 1);
});

test("read-only verification detects missing objects despite a historical receipt and pages safely", async () => {
  const db = databaseFixture(true);
  const before = structuredClone(db.row);
  let heads = 0;
  const args = { runtimeConfig: CONFIG, pool: db.pool as any, apply: false, limit: 1,
    verification: { afterId: null }, storageFactory: () => ({
      async headObject() { heads++; return null; },
      async copyFromSource() { throw new Error("Dry-run attempted copy"); },
    }) };
  for (let i = 0; i < 2; i++) {
    const report = await runBackupReconciliation(args);
    assert.equal(report.missing, 1);
    assert.equal(report.failed, 1);
    assert.equal(report.stillPending, 0);
    assert.equal(report.nextAfter, db.row.id);
    assert.equal(backupReconciliationExitCode(report), 2);
  }
  const next = await runBackupReconciliation({ ...args, verification: { afterId: db.row.id } });
  assert.equal(next.scanned, 0);
  assert.equal(next.nextAfter, null);
  assert.equal(heads, 2);
  assert.deepEqual(db.row, before);
  assert.equal(db.released(), 3);
});

test("missing schema fails closed without migrations and still releases read-only connection", async () => {
  const db = databaseFixture();
  const connect = db.pool.connect.bind(db.pool);
  db.pool.connect = async () => {
    const client = await connect();
    const query = client.query.bind(client);
    client.query = async (sql: string, values?: any[]) => {
      if (sql.includes("LIMIT 0")) throw new Error("missing_column");
      return query(sql, values);
    };
    return client;
  };
  await assert.rejects(runBackupReconciliation({ runtimeConfig: CONFIG, pool: db.pool as any, apply: false, limit: 10 }), /missing_column/);
  assert.equal(db.statements.at(-1), "ROLLBACK");
  assert.equal(db.released(), 1);
});

test("exit codes distinguish complete, failed and bounded unfinished reconciliation", () => {
  assert.equal(backupReconciliationExitCode({ failed: 0, stillPending: 0 }), 0);
  assert.equal(backupReconciliationExitCode({ failed: 1, stillPending: 0 }), 2);
  assert.equal(backupReconciliationExitCode({ failed: 0, stillPending: 1 }), 2);
});

test("applied verification repairs a missing receipt-backed object and repeated runs do not transfer again", async () => {
  const db = databaseFixture(true);
  const historicalReceipt = db.row.backed_up_at;
  const pool = {
    async connect() { throw new Error("Unexpected migration transaction"); },
    async query(sql: string, values: any[] = []) {
      assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|DELETE|INSERT)\b|advisory/i);
      if (sql.includes("LIMIT 0")) return { rows: [] };
      if (sql.includes("COUNT(*)")) return { rows: [{ pending_count: db.row.backed_up_at ? 0 : 1 }] };
      if (sql.trim().startsWith("UPDATE")) {
        if (sql.includes("backup_attempt_count =")) db.row.backup_attempt_count++;
        else db.row.backed_up_at ??= values[1];
        return { rows: [structuredClone(db.row)] };
      }
      return { rows: [structuredClone(db.row)] };
    },
  };
  let exists = false, copies = 0;
  const args = { runtimeConfig: CONFIG, pool: pool as any, apply: true, limit: 10,
    verification: { afterId: null }, storageFactory: () => ({
      async headObject(key: string) { return exists ? { key, byteSize: 42, contentType: "application/pdf", etag: null, lastModified: null } : null; },
      async copyFromSource() { copies++; exists = true; return "copied" as const; },
    }) };
  assert.equal((await runBackupReconciliation(args)).backedUp, 1);
  const repeated = await runBackupReconciliation(args);
  assert.equal(repeated.alreadyPresent, 1);
  assert.equal(backupReconciliationExitCode(repeated), 0);
  assert.equal(copies, 1);
  assert.equal(db.row.backed_up_at, historicalReceipt);
});

function assertReleasedBeforeR2(db: ReturnType<typeof databaseFixture>) {
  assert.equal(db.connected(), false);
  assert.equal(db.released(), 1);
  assert.equal(db.statements.at(-1), "ROLLBACK");
  assert.deepEqual(db.releaseErrors, [false]);
}

test("verification releases its read-only transaction before constructing R2 and before the first HEAD", async () => {
  const db = databaseFixture(true);
  const before = structuredClone(db.row);
  const report = await runBackupReconciliation({ runtimeConfig: CONFIG, pool: db.pool as any,
    apply: false, limit: 1, verification: { afterId: null }, storageFactory: () => {
      assertReleasedBeforeR2(db);
      return {
        async headObject(key: string, signal?: AbortSignal) {
          assertReleasedBeforeR2(db);
          assert.ok(signal);
          assert.equal(signal.aborted, false);
          return { key, byteSize: 42, contentType: "application/pdf", etag: null, lastModified: null };
        },
        async copyFromSource() { throw new Error("Dry-run attempted copy"); },
      };
    } });
  assert.deepEqual(report, { apply: false, verify: true, scanned: 1, backedUp: 0,
    alreadyPresent: 1, failed: 0, missing: 0, stillPending: 0, nextAfter: db.row.id });
  assert.equal(backupReconciliationExitCode(report), 0);
  assert.deepEqual(db.row, before);
});

test("a stalled mocked HEAD holds no transaction or connection while it is pending", async () => {
  const db = databaseFixture(true);
  let started!: () => void;
  const headStarted = new Promise<void>(resolve => { started = resolve; });
  let finish!: (value: null) => void;
  const stalledHead = new Promise<null>(resolve => { finish = resolve; });
  const run = runBackupReconciliation({ runtimeConfig: CONFIG, pool: db.pool as any,
    apply: false, limit: 1, verification: { afterId: null }, storageFactory: () => ({
      async headObject() { assertReleasedBeforeR2(db); started(); return stalledHead; },
      async copyFromSource() { throw new Error("Dry-run attempted copy"); },
    }) });
  await headStarted;
  await new Promise<void>(resolve => setImmediate(resolve));
  assertReleasedBeforeR2(db);
  const statementCount = db.statements.length;
  finish(null);
  const report = await run;
  assert.equal(report.failed, 1);
  assert.equal(report.missing, 1);
  assert.equal(report.nextAfter, db.row.id);
  assert.equal(backupReconciliationExitCode(report), 2);
  assert.equal(db.statements.length, statementCount, "Verification must not return to the released database connection");
});

test("verification uses a 30-second abort signal and cancellation remains an incomplete result without an open DB connection", async t => {
  const db = databaseFixture(true);
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 30_000);
    return controller.signal;
  });
  let started!: () => void;
  const headStarted = new Promise<void>(resolve => { started = resolve; });
  const run = runBackupReconciliation({ runtimeConfig: CONFIG, pool: db.pool as any,
    apply: false, limit: 1, verification: { afterId: null }, storageFactory: () => ({
      async headObject(_key: string, signal?: AbortSignal) {
        assertReleasedBeforeR2(db);
        assert.ok(signal);
        return new Promise<null>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          started();
        });
      },
      async copyFromSource() { throw new Error("Dry-run attempted copy"); },
    }) });
  await headStarted;
  controller.abort(new Error("synthetic_verification_timeout"));
  const report = await run;
  assert.equal(report.failed, 1);
  assert.equal(report.missing, 0);
  assert.equal(backupReconciliationExitCode(report), 2);
  assertReleasedBeforeR2(db);
});

test("R2 failures do not stop the materialized page or change pending snapshot counts and pagination", async () => {
  const db = databaseFixture();
  db.rows.push({ ...db.row, id: "33333333-3333-4333-8333-333333333333", final_object_key: "objects/second-synthetic-key" });
  const before = structuredClone(db.rows);
  let heads = 0;
  const report = await runBackupReconciliation({ runtimeConfig: CONFIG, pool: db.pool as any,
    apply: false, limit: 2, verification: { afterId: null }, storageFactory: () => ({
      async headObject(key: string) {
        assertReleasedBeforeR2(db);
        if (++heads === 1) throw new Error("synthetic_provider_error");
        return { key, byteSize: 42, contentType: "application/pdf", etag: null, lastModified: null };
      },
      async copyFromSource() { throw new Error("Dry-run attempted copy"); },
    }) });
  assert.equal(heads, 2);
  assert.equal(report.failed, 1);
  assert.equal(report.alreadyPresent, 1);
  assert.equal(report.missing, 0);
  assert.equal(report.stillPending, 2);
  assert.equal(report.nextAfter, db.rows[1]!.id);
  assert.equal(backupReconciliationExitCode(report), 2);
  assert.deepEqual(db.rows, before);
});

test("a rollback error discards the connection and prevents all R2 work", async () => {
  const db = databaseFixture(true);
  const connect = db.pool.connect.bind(db.pool);
  db.pool.connect = async () => {
    const client = await connect();
    const query = client.query.bind(client);
    client.query = async (sql: string, values?: any[]) => {
      if (sql === "ROLLBACK") throw new Error("synthetic_rollback_error");
      return query(sql, values);
    };
    return client;
  };
  let providerCreated = false;
  await assert.rejects(runBackupReconciliation({ runtimeConfig: CONFIG, pool: db.pool as any,
    apply: false, limit: 1, verification: { afterId: null }, storageFactory: () => {
      providerCreated = true;
      throw new Error("R2 must not be reached");
    } }), /synthetic_rollback_error/);
  assert.equal(providerCreated, false);
  assert.equal(db.connected(), false);
  assert.equal(db.released(), 1);
  assert.deepEqual(db.releaseErrors, [true]);
});
