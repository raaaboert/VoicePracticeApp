import { readFile } from "node:fs/promises";

import type { Pool, PoolClient } from "pg";

const TRAINING_CONTENT_MIGRATIONS = [
  "008_training_content.sql",
  "009_training_content_storage.sql",
] as const;

type MigrationPool = Pick<Pool, "connect">;

async function readMigration(filename: string): Promise<string> {
  const candidates = [
    new URL(`../../sql/${filename}`, import.meta.url),
    new URL(`../sql/${filename}`, import.meta.url),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Training Content migration "${filename}" is missing from the runtime artifact.`, {
    cause: lastError,
  });
}

export async function loadTrainingContentMigrationSql(): Promise<string[]> {
  return Promise.all(TRAINING_CONTENT_MIGRATIONS.map(readMigration));
}

export async function initializeTrainingContentSchema(pool: MigrationPool): Promise<void> {
  const migrationSql = await loadTrainingContentMigrationSql();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('peritio_training_content_schema_v1', 0))"
    );
    for (const sql of migrationSql) {
      await client.query(sql);
    }
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackQuietly(client: Pick<PoolClient, "query">): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the migration error that caused the rollback.
  }
}
