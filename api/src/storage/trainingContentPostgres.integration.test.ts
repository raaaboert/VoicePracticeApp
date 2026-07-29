import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import { Pool, type PoolClient } from "pg";

import { createTrainingContentAssetStore } from "./trainingContentAssetStore.js";
import { loadTrainingContentMigrationSql } from "./trainingContentMigrations.js";

const databaseUrl = process.env.TRAINING_CONTENT_INTEGRATION_DATABASE_URL?.trim() || "";
const allowStaging = process.env.TRAINING_CONTENT_ALLOW_STAGING_INTEGRATION_TESTS === "true";

function assertSafeIntegrationDatabase(url: string): void {
  const normalized = url.toLowerCase();
  if (normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod")) {
    throw new Error("Training Content PostgreSQL integration tests refuse production databases.");
  }
  const parsed = new URL(url);
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  const looksStaging = normalized.includes("voicepractice_db") || normalized.includes("voicepractice-db");
  if (!isLocal && !(looksStaging && allowStaging)) {
    throw new Error(
      "Use a local test PostgreSQL database, or explicitly allow an isolated staging schema."
    );
  }
}

async function runMigrations(client: PoolClient, migrationSql: string[]): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('peritio_training_content_schema_v1', 0))"
    );
    for (const sql of migrationSql) {
      await client.query(sql);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function expectPostgresError(
  operation: () => Promise<unknown>,
  expectedCode: "23503" | "23505" | "23514"
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    return (error as { code?: string } | null)?.code === expectedCode;
  });
}

test(
  "real PostgreSQL enforces Training Content tenant, assignment, uniqueness, and asset-state constraints",
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
    const schema = `tc_integration_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET search_path TO ${quotedSchema}`);
      const migrations = await loadTrainingContentMigrationSql();
      await runMigrations(client, migrations);
      await runMigrations(client, migrations);

      const tables = await client.query<{ table_name: string }>(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name LIKE 'org_content_%'
          ORDER BY table_name
        `,
        [schema]
      );
      assert.deepEqual(tables.rows.map((row) => row.table_name), [
        "org_content_assets",
        "org_content_assignments",
        "org_content_items",
        "org_content_scenario_links",
        "org_content_usage",
        "org_content_usage_sessions",
      ]);

      const orgA = "org_a";
      const orgB = "org_b";
      const contentA = randomUUID();
      await client.query(
        `
          INSERT INTO org_content_items (
            id, org_id, title, content_type, publication_state,
            created_by_actor_id, updated_by_actor_id
          )
          VALUES ($1, $2, 'Org A PDF', 'pdf', 'draft', 'actor_a', 'actor_a')
        `,
        [contentA, orgA]
      );

      const orgAAsset = randomUUID();
      await client.query(
        `
          INSERT INTO org_content_assets (
            id, org_id, content_id, asset_role, version, upload_state,
            storage_provider, temporary_object_key, original_filename,
            declared_mime_type, file_extension, declared_byte_size,
            upload_expires_at, finalization_nonce, created_by_actor_id
          )
          VALUES (
            $1, $2, $3, 'primary', 1, 'pending',
            'r2', 'tmp/org_a/content/asset/nonce', 'reference.pdf',
            'application/pdf', 'pdf', 8,
            NOW() + INTERVAL '10 minutes', 'nonce_nonce_nonce_nonce', 'actor_a'
          )
        `,
        [orgAAsset, orgA, contentA]
      );

      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assets (
              id, org_id, content_id, asset_role, version, upload_state,
              storage_provider, temporary_object_key, original_filename,
              declared_mime_type, file_extension, declared_byte_size,
              upload_expires_at, finalization_nonce, created_by_actor_id
            )
            VALUES (
              $1, $2, $3, 'primary', 1, 'pending',
              'r2', 'tmp/org_b/content/asset/nonce', 'reference.pdf',
              'application/pdf', 'pdf', 8,
              NOW() + INTERVAL '10 minutes', 'nonce_nonce_nonce_nonce', 'actor_b'
            )
          `,
          [randomUUID(), orgB, contentA]
        ),
        "23503"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assignments (
              id, org_id, content_id, assignment_type, subject_user_id, created_by_actor_id
            )
            VALUES ($1, $2, $3, 'user', 'user_b', 'actor_b')
          `,
          [randomUUID(), orgB, contentA]
        ),
        "23503"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_scenario_links (
              id, org_id, content_id, focus_topic_id, scenario_id, created_by_actor_id
            )
            VALUES ($1, $2, $3, 'topic_b', 'scenario_b', 'actor_b')
          `,
          [randomUUID(), orgB, contentA]
        ),
        "23503"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_usage (org_id, content_id, user_id)
            VALUES ($1, $2, 'user_b')
          `,
          [orgB, contentA]
        ),
        "23503"
      );

      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assignments (
              id, org_id, content_id, assignment_type, subject_user_id, created_by_actor_id
            )
            VALUES ($1, $2, $3, 'organization', 'unexpected_user', 'actor_a')
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23514"
      );

      const activeAssignment = randomUUID();
      await client.query(
        `
          INSERT INTO org_content_assignments (
            id, org_id, content_id, assignment_type, subject_user_id, created_by_actor_id
          )
          VALUES ($1, $2, $3, 'user', 'user_a', 'actor_a')
        `,
        [activeAssignment, orgA, contentA]
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assignments (
              id, org_id, content_id, assignment_type, subject_user_id, created_by_actor_id
            )
            VALUES ($1, $2, $3, 'user', 'user_a', 'actor_a')
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23505"
      );
      await client.query(
        `
          UPDATE org_content_assignments
          SET revoked_at = NOW(), revoked_by_actor_id = 'actor_a'
          WHERE id = $1
        `,
        [activeAssignment]
      );
      await client.query(
        `
          INSERT INTO org_content_assignments (
            id, org_id, content_id, assignment_type, subject_user_id, created_by_actor_id
          )
          VALUES ($1, $2, $3, 'user', 'user_a', 'actor_a')
        `,
        [randomUUID(), orgA, contentA]
      );

      await client.query(
        `
          INSERT INTO org_content_scenario_links (
            id, org_id, content_id, focus_topic_id, scenario_id, created_by_actor_id
          )
          VALUES ($1, $2, $3, 'topic_a', 'scenario_a', 'actor_a')
        `,
        [randomUUID(), orgA, contentA]
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_scenario_links (
              id, org_id, content_id, focus_topic_id, scenario_id, created_by_actor_id
            )
            VALUES ($1, $2, $3, 'topic_a', 'scenario_a', 'actor_a')
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23505"
      );

      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_items (
              id, org_id, title, content_type, publication_state,
              created_by_actor_id, updated_by_actor_id
            )
            VALUES ($1, $2, 'Bad Type', 'executable', 'draft', 'actor_a', 'actor_a')
          `,
          [randomUUID(), orgA]
        ),
        "23514"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assets (
              id, org_id, content_id, asset_role, version, upload_state,
              storage_provider, temporary_object_key, original_filename,
              declared_mime_type, file_extension, declared_byte_size,
              upload_expires_at, finalization_nonce, created_by_actor_id
            )
            VALUES (
              $1, $2, $3, 'primary', 2, 'pending',
              'r2', 'tmp/org_a/content/asset/duplicate-active', 'reference.pdf',
              'application/pdf', 'pdf', 8,
              NOW() + INTERVAL '10 minutes', 'nonce_nonce_nonce_nonce', 'actor_a'
            )
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23505"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assets (
              id, org_id, content_id, asset_role, version, upload_state,
              storage_provider, temporary_object_key, original_filename,
              declared_mime_type, file_extension, declared_byte_size,
              upload_expires_at, finalization_nonce, detected_mime_type,
              byte_size, created_by_actor_id
            )
            VALUES (
              $1, $2, $3, 'inline', 3, 'processing',
              'r2', 'tmp/org_a/content/asset/missing-final', 'image.png',
              'image/png', 'png', 8,
              NOW() + INTERVAL '10 minutes', 'nonce_nonce_nonce_nonce', 'image/png',
              8, 'actor_a'
            )
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23514"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assets (
              id, org_id, content_id, asset_role, version, upload_state,
              storage_provider, final_object_key, detected_mime_type, byte_size,
              is_current, created_by_actor_id
            )
            VALUES (
              $1, $2, $3, 'inline', 4, 'ready',
              'r2', 'objects/org/content/inline/4/missing-finalized-at',
              'image/png', 8, TRUE, 'actor_a'
            )
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23514"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_items (
              id, org_id, title, content_type, publication_state,
              created_by_actor_id, updated_by_actor_id
            )
            VALUES ($1, $2, 'Bad State', 'pdf', 'deleted', 'actor_a', 'actor_a')
          `,
          [randomUUID(), orgA]
        ),
        "23514"
      );

      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assets (
              id, org_id, content_id, asset_role, version, upload_state,
              storage_provider, created_by_actor_id
            )
            VALUES ($1, $2, $3, 'inline', 1, 'pending', 'r2', 'actor_a')
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23514"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assets (
              id, org_id, content_id, asset_role, version, upload_state,
              storage_provider, temporary_object_key, original_filename,
              declared_mime_type, file_extension, declared_byte_size,
              upload_expires_at, finalization_nonce, created_by_actor_id
            )
            VALUES (
              $1, $2, $3, 'inline', 1, 'pending',
              's3', 'tmp/invalid/provider', 'image.png',
              'image/png', 'png', 8,
              NOW() + INTERVAL '10 minutes', 'nonce_nonce_nonce_nonce', 'actor_a'
            )
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23514"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assets (
              id, org_id, content_id, asset_role, version, upload_state,
              storage_provider, temporary_object_key, original_filename,
              declared_mime_type, file_extension, declared_byte_size,
              upload_expires_at, finalization_nonce, is_current, created_by_actor_id
            )
            VALUES (
              $1, $2, $3, 'inline', 1, 'pending',
              'r2', 'tmp/current/pending', 'image.png',
              'image/png', 'png', 8,
              NOW() + INTERVAL '10 minutes', 'nonce_nonce_nonce_nonce', TRUE, 'actor_a'
            )
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23514"
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_assets (
              id, org_id, content_id, asset_role, version, upload_state,
              storage_provider, final_object_key, detected_mime_type, byte_size,
              finalized_at, is_current, created_by_actor_id
            )
            VALUES (
              $1, $2, $3, 'inline', 1, 'superseded',
              'r2', 'objects/org/content/inline/1/superseded', 'image/png', 8,
              NOW(), FALSE, 'actor_a'
            )
          `,
          [randomUUID(), orgA, contentA]
        ),
        "23514"
      );

      const constraintResult = await client.query<{ conname: string }>(
        `
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'org_content_assets'::regclass
            AND conname IN (
              'org_content_assets_pending_state_check',
              'org_content_assets_ready_state_check',
              'org_content_assets_replacement_for_asset_fkey'
            )
          ORDER BY conname
        `
      );
      assert.deepEqual(constraintResult.rows.map((row) => row.conname), [
        "org_content_assets_pending_state_check",
        "org_content_assets_ready_state_check",
        "org_content_assets_replacement_for_asset_fkey",
      ]);
      const indexResult = await client.query<{ indexname: string }>(
        `
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = $1
            AND indexname IN (
              'org_content_assets_active_upload_unique_idx',
              'org_content_assets_current_role_unique_idx',
              'org_content_assignments_active_subject_unique_idx',
              'org_content_scenario_links_active_unique_idx'
            )
          ORDER BY indexname
        `,
        [schema]
      );
      assert.deepEqual(indexResult.rows.map((row) => row.indexname), [
        "org_content_assets_active_upload_unique_idx",
        "org_content_assets_current_role_unique_idx",
        "org_content_assignments_active_subject_unique_idx",
        "org_content_scenario_links_active_unique_idx",
      ]);

      await client.query(`
        CREATE TABLE audit_events (
          id TEXT PRIMARY KEY,
          actor_type TEXT NOT NULL,
          actor_id TEXT NULL,
          action TEXT NOT NULL,
          org_id TEXT NULL,
          user_id TEXT NULL,
          message TEXT NOT NULL,
          metadata JSONB NULL,
          created_at TIMESTAMPTZ NOT NULL
        )
      `);
      const queryPool = {
        query: client.query.bind(client),
        async connect() {
          return {
            query: client.query.bind(client),
            release() {},
          };
        },
      };
      const store = createTrainingContentAssetStore({
        provider: "postgres",
        databaseUrl,
        pgPoolMax: 1,
        pgConnectTimeoutMs: 15_000,
        pgIdleTimeoutMs: 10_000,
        queryPool: queryPool as any,
      });
      const storeContentId = randomUUID();
      await client.query(
        `
          INSERT INTO org_content_items (
            id, org_id, title, content_type, publication_state,
            created_by_actor_id, updated_by_actor_id
          )
          VALUES ($1, $2, 'Store lifecycle', 'pdf', 'draft', 'actor_a', 'actor_a')
        `,
        [storeContentId, orgA]
      );
      const actor = { actorType: "web_user" as const, actorId: "actor_a" };
      const pending = await store.createPendingAsset({
        orgId: orgA,
        contentId: storeContentId,
        assetRole: "primary",
        originalFilename: "customer-reference.pdf",
        declaredMimeType: "application/pdf",
        fileExtension: "pdf",
        declaredByteSize: 8,
        replacementAssetId: null,
        uploadTtlSeconds: 600,
        maxPendingBytesForOrganization: 1024,
        actor,
        now: new Date("2026-07-28T12:00:00.000Z"),
      });
      assert.equal(pending.asset.uploadState, "pending");
      assert.match(pending.asset.temporaryObjectKey ?? "", /^tmp\//);
      const claimed = await store.claimFinalization({
        orgId: orgA,
        contentId: storeContentId,
        assetId: pending.asset.id,
        actualByteSize: 8,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "\"etag-1\"",
        leaseSeconds: 300,
        actor,
        now: new Date("2026-07-28T12:01:00.000Z"),
      });
      assert.equal(claimed.status, "claimed");
      assert.equal(claimed.asset.uploadState, "processing");
      assert.match(claimed.asset.finalObjectKey ?? "", /^objects\//);
      const finalized = await store.completeFinalization({
        orgId: orgA,
        contentId: storeContentId,
        assetId: pending.asset.id,
        finalObjectKey: claimed.asset.finalObjectKey!,
        actualByteSize: 8,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "\"etag-1\"",
        actor,
        now: new Date("2026-07-28T12:02:00.000Z"),
      });
      assert.equal(finalized.asset.uploadState, "ready");
      assert.equal(finalized.asset.isCurrent, true);

      const replacement = await store.createPendingAsset({
        orgId: orgA,
        contentId: storeContentId,
        assetRole: "primary",
        originalFilename: "customer-reference-v2.pdf",
        declaredMimeType: "application/pdf",
        fileExtension: "pdf",
        declaredByteSize: 8,
        replacementAssetId: finalized.asset.id,
        uploadTtlSeconds: 600,
        maxPendingBytesForOrganization: 1024,
        actor,
        now: new Date("2026-07-28T12:03:00.000Z"),
      });
      assert.equal(replacement.asset.version, 2);
      const replacementClaim = await store.claimFinalization({
        orgId: orgA,
        contentId: storeContentId,
        assetId: replacement.asset.id,
        actualByteSize: 8,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "\"etag-2\"",
        leaseSeconds: 300,
        actor,
        now: new Date("2026-07-28T12:04:00.000Z"),
      });
      const replacementFinalized = await store.completeFinalization({
        orgId: orgA,
        contentId: storeContentId,
        assetId: replacement.asset.id,
        finalObjectKey: replacementClaim.asset.finalObjectKey!,
        actualByteSize: 8,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "\"etag-2\"",
        actor,
        now: new Date("2026-07-28T12:05:00.000Z"),
      });
      assert.equal(replacementFinalized.replacedAsset?.uploadState, "superseded");
      assert.equal(replacementFinalized.asset.isCurrent, true);

      const audits = await client.query<{ action: string; metadata: Record<string, unknown> }>(
        `
          SELECT action, metadata
          FROM audit_events
          ORDER BY created_at, action
        `
      );
      assert.deepEqual(audits.rows.map((row) => row.action), [
        "training_content_upload_initiated",
        "training_content_asset_finalized",
        "training_content_upload_initiated",
        "training_content_asset_finalized",
        "training_content_asset_replaced",
      ]);
      const auditJson = JSON.stringify(audits.rows);
      assert.equal(auditJson.includes("customer-reference"), false);
      assert.equal(auditJson.includes("ObjectKey"), false);
      assert.equal(auditJson.includes("tmp/"), false);
      assert.equal(auditJson.includes("objects/"), false);
      assert.equal(auditJson.includes("https://"), false);
    } finally {
      try {
        await client.query("SET search_path TO public");
        await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      } finally {
        client.release();
        await pool.end();
      }
    }
  }
);
