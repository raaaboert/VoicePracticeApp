import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import { Pool, type PoolClient } from "pg";

import { migrateTrainingPackSchema } from "./trainingPackMigrations.js";

const databaseUrl =
  process.env.TRAINING_PACK_INTEGRATION_DATABASE_URL?.trim() || "";
const allowStaging =
  process.env.TRAINING_PACK_ALLOW_STAGING_INTEGRATION_TESTS === "true";

function assertSafeIntegrationDatabase(url: string): void {
  const normalized = url.toLowerCase();
  if (
    normalized.includes("peritio-db-prod") ||
    normalized.includes("peritio_db_prod")
  ) {
    throw new Error(
      "Training Pack PostgreSQL integration tests refuse production databases."
    );
  }
  const parsed = new URL(url);
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(
    parsed.hostname.toLowerCase()
  );
  const looksStaging =
    normalized.includes("voicepractice_db") ||
    normalized.includes("voicepractice-db");
  if (!isLocal && !(looksStaging && allowStaging)) {
    throw new Error(
      "Use a local test PostgreSQL database, or explicitly allow an isolated staging schema."
    );
  }
}

function migrationPoolForClient(client: PoolClient) {
  return {
    async connect() {
      return {
        query: client.query.bind(client),
        release() {},
      };
    },
  } as any;
}

test(
  "real PostgreSQL Training Pack migration creates, backfills, constrains, and becomes inspection-only",
  { skip: !databaseUrl },
  async () => {
    assertSafeIntegrationDatabase(databaseUrl);
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 10_000,
    });
    const client = await pool.connect();
    const schema = `training_pack_migration_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET search_path TO ${quotedSchema}`);
      const migrationPool = migrationPoolForClient(client);

      const fresh = await migrateTrainingPackSchema(migrationPool);
      assert.equal(fresh.before.tableExists, false);
      assert.equal(fresh.after.current, true);
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO training_packs (
               id, organization_id, title, training_topic,
               required_behavioral_triggers, display_order
             ) VALUES ($1, 'org-a', 'Invalid', 'Invalid', '[]', -1)`,
            [randomUUID()]
          ),
        (error: unknown) =>
          (error as { code?: string } | null)?.code === "23514"
      );

      await client.query("DROP TABLE training_packs CASCADE");
      await client.query(`
        CREATE TABLE training_packs (
          id UUID PRIMARY KEY,
          organization_id TEXT NOT NULL,
          title TEXT NOT NULL,
          training_topic TEXT NOT NULL,
          required_behavioral_triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
          active BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL
        )
      `);
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await client.query(
        `INSERT INTO training_packs (
           id, organization_id, title, training_topic, created_at
         ) VALUES
           ($1, 'org-a', 'Later', 'Later', '2026-02-01T00:00:00Z'),
           ($2, 'org-a', 'Earlier', 'Earlier', '2026-01-01T00:00:00Z'),
           ($3, 'org-b', 'Other org', 'Other org', '2026-03-01T00:00:00Z')`,
        ids
      );

      const migrated = await migrateTrainingPackSchema(migrationPool);
      assert.equal(migrated.after.current, true);
      const ordered = await client.query<{
        organization_id: string;
        title: string;
        display_order: number;
      }>(
        `SELECT organization_id, title, display_order
         FROM training_packs
         ORDER BY organization_id, display_order`
      );
      assert.deepEqual(ordered.rows, [
        { organization_id: "org-a", title: "Earlier", display_order: 0 },
        { organization_id: "org-a", title: "Later", display_order: 1 },
        { organization_id: "org-b", title: "Other org", display_order: 0 },
      ]);

      const repeated = await migrateTrainingPackSchema(migrationPool);
      assert.deepEqual(repeated.appliedChanges, []);
      assert.equal(repeated.after.current, true);
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      client.release();
      await pool.end();
    }
  }
);
