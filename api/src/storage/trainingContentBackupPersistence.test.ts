import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadTrainingContentMigrationSql } from "./trainingContentMigrations.js";

test("backup migration is additive, idempotent, and targets only ready unbacked assets", async () => {
  const migrations = await loadTrainingContentMigrationSql();
  assert.equal(migrations.length, 6);
  const backup = migrations.at(-2) ?? "";

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
    /SET backed_up_at = COALESCE\(backed_up_at, \$2\)[\s\S]*?WHERE id = \$1[\s\S]*?AND upload_state = 'ready'/
  );
  assert.match(
    source,
    /SET backup_attempt_count = backup_attempt_count \+ 1[\s\S]*?AND backed_up_at IS NULL/
  );
  assert.match(
    source,
    /WHERE upload_state = 'ready'[\s\S]*?AND backed_up_at IS NULL[\s\S]*?AND final_object_key IS NOT NULL[\s\S]*?LIMIT \$1/
  );
  assert.doesNotMatch(
    persistenceSource,
    /processing_attempt_count|SET\s+upload_state/i
  );
});
