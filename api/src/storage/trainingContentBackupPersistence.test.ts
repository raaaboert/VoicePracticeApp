import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadTrainingContentMigrationSql } from "./trainingContentMigrations.js";
import { createTrainingContentAssetStore } from "./trainingContentAssetStore.js";

test("backup migration is additive, idempotent, and targets only ready unbacked assets", async () => {
  const migrations = await loadTrainingContentMigrationSql();
  assert.equal(migrations.length, 7);
  const backup = migrations[4] ?? "";

  assert.match(backup, /ADD COLUMN IF NOT EXISTS backed_up_at TIMESTAMPTZ NULL/);
  assert.match(
    backup,
    /ADD COLUMN IF NOT EXISTS backup_attempt_count INTEGER NOT NULL DEFAULT 0/
  );
  assert.match(backup, /CREATE INDEX IF NOT EXISTS org_content_assets_backup_pending_idx/);
  assert.match(
    backup,
    /WHERE upload_state = 'ready' AND backed_up_at IS NULL/
  );
  assert.doesNotMatch(backup, /DROP COLUMN|DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test("asset backup persistence preserves ready state and uses a bounded pending query", async () => {
  const source = await readFile(new URL("./trainingContentAssetStore.ts", import.meta.url), "utf8");
  const persistenceStart = source.lastIndexOf("async markAssetBackedUp");
  const persistenceEnd = source.indexOf("async clearTemporaryObject", persistenceStart);
  const persistenceSource = source.slice(persistenceStart, persistenceEnd);

  assert.match(
    source,
    /SET backed_up_at = COALESCE\(backed_up_at, \$2\)[\s\S]*?WHERE id = \$1[\s\S]*?AND upload_state IN \('ready', 'superseded'\)/
  );
  assert.match(
    source,
    /SET backup_attempt_count = backup_attempt_count \+ 1[\s\S]*?AND object_deleted_at IS NULL/
  );
  assert.match(
    source,
    /WHERE upload_state IN \('ready', 'superseded'\)[\s\S]*?AND object_deleted_at IS NULL[\s\S]*?backed_up_at IS NULL[\s\S]*?AND final_object_key IS NOT NULL[\s\S]*?LIMIT \$1/
  );
  assert.doesNotMatch(
    persistenceSource,
    /processing_attempt_count|SET\s+upload_state/i
  );
});

test("operator inventory checks existing schema without migrations and bounds complete-object verification", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const store = createTrainingContentAssetStore({
    provider: "postgres", databaseUrl: "postgres://test:test@invalid/voicepractice_db", pgPoolMax: 1,
    pgConnectTimeoutMs: 100, pgIdleTimeoutMs: 100, schemaInitialization: "existing",
    queryPool: {
      async connect() { throw new Error("Schema migration/write connection requested"); },
      async query(sql: any, values: any = []) {
        queries.push({ sql, values });
        assert.match(sql.trim(), /^SELECT/);
        return { rows: sql.includes("COUNT(*)") ? [{ pending_count: 0 }] : [] } as any;
      },
    },
  });
  await store.countAssetsPendingBackup();
  await store.listAssetsPendingBackup(7);
  const afterId = "11111111-1111-4111-8111-111111111111";
  await store.listAssetsPendingBackup(3, { afterId });
  assert.match(queries[0]!.sql, /LIMIT 0/);
  assert.match(queries[1]!.sql, /upload_state IN \('ready', 'superseded'\)/);
  assert.match(queries[1]!.sql, /object_deleted_at IS NULL/);
  assert.deepEqual(queries[2]!.values, [7, false]);
  assert.deepEqual(queries[3]!.values, [3, true, afterId]);
  assert.match(queries[3]!.sql, /id > \$3::uuid/);
  assert.match(queries[3]!.sql, /ORDER BY id ASC/);
});
