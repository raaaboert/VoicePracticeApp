import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import { Pool, type PoolClient } from "pg";

import {
  createTrainingContentAssetStore,
  TrainingContentAssetStoreError,
} from "./trainingContentAssetStore.js";
import {
  createTrainingContentStore,
  TrainingContentStoreError,
} from "./trainingContentStore.js";
import {
  createTrainingContentCategoryStore,
  TrainingContentCategoryStoreError,
} from "./trainingContentCategoryStore.js";
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

async function insertContentCategory(
  client: Pick<PoolClient, "query">,
  orgId: string,
  options: { name?: string; isDefault?: boolean } = {}
): Promise<string> {
  const categoryId = randomUUID();
  await client.query(
    `
      INSERT INTO org_content_categories (
        id, org_id, name, description, display_order, is_default,
        created_by_actor_id, updated_by_actor_id
      )
      VALUES ($1, $2, $3, '', 0, $4, 'integration_test', 'integration_test')
    `,
    [categoryId, orgId, options.name ?? "General", options.isDefault ?? true]
  );
  return categoryId;
}

test(
  "migration 010 backfills existing content into one idempotent General category",
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
    const schema = `tc_category_migration_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET search_path TO ${quotedSchema}`);
      const migrations = await loadTrainingContentMigrationSql();
      assert.equal(migrations.length, 3);
      await runMigrations(client, migrations.slice(0, 2));
      const contentId = randomUUID();
      await client.query(
        `
          INSERT INTO org_content_items (
            id, org_id, title, content_type, publication_state,
            created_by_actor_id, updated_by_actor_id, published_at
          )
          VALUES (
            $1, 'org_existing', 'Existing published guide', 'native', 'published',
            'existing_admin', 'existing_admin', NOW()
          )
        `,
        [contentId]
      );

      await runMigrations(client, migrations.slice(2));
      await runMigrations(client, migrations.slice(2));

      const categories = await client.query<{
        id: string;
        name: string;
        is_default: boolean;
      }>(
        `
          SELECT id, name, is_default
          FROM org_content_categories
          WHERE org_id = 'org_existing'
        `
      );
      assert.equal(categories.rows.length, 1);
      assert.equal(categories.rows[0]?.name, "General");
      assert.equal(categories.rows[0]?.is_default, true);
      const content = await client.query<{
        category_id: string;
        publication_state: string;
        published_at: Date | null;
      }>(
        `
          SELECT category_id, publication_state, published_at
          FROM org_content_items
          WHERE org_id = 'org_existing' AND id = $1
        `,
        [contentId]
      );
      assert.equal(content.rows[0]?.category_id, categories.rows[0]?.id);
      assert.equal(content.rows[0]?.publication_state, "published");
      assert.ok(content.rows[0]?.published_at);
      await expectPostgresError(
        () => insertContentCategory(client, "org_existing", { name: "Other default" }),
        "23505"
      );
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
        "org_content_categories",
        "org_content_items",
        "org_content_scenario_links",
        "org_content_usage",
        "org_content_usage_sessions",
      ]);

      const orgA = "org_a";
      const orgB = "org_b";
      const categoryA = await insertContentCategory(client, orgA);
      const categoryB = await insertContentCategory(client, orgB);
      const contentA = randomUUID();
      await client.query(
        `
          INSERT INTO org_content_items (
            id, org_id, category_id, title, content_type, publication_state,
            created_by_actor_id, updated_by_actor_id
          )
          VALUES ($1, $2, $3, 'Org A PDF', 'pdf', 'draft', 'actor_a', 'actor_a')
        `,
        [contentA, orgA, categoryA]
      );
      await expectPostgresError(
        () => client.query(
          `
            INSERT INTO org_content_items (
              id, org_id, category_id, title, content_type, publication_state,
              created_by_actor_id, updated_by_actor_id
            )
            VALUES ($1, $2, $3, 'Cross-org category', 'pdf', 'draft', 'actor_a', 'actor_a')
          `,
          [randomUUID(), orgA, categoryB]
        ),
        "23503"
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
              id, org_id, category_id, title, content_type, publication_state,
              created_by_actor_id, updated_by_actor_id
            )
            VALUES ($1, $2, $3, 'Bad Type', 'executable', 'draft', 'actor_a', 'actor_a')
          `,
          [randomUUID(), orgA, categoryA]
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
              id, org_id, category_id, title, content_type, publication_state,
              created_by_actor_id, updated_by_actor_id
            )
            VALUES ($1, $2, $3, 'Bad State', 'pdf', 'deleted', 'actor_a', 'actor_a')
          `,
          [randomUUID(), orgA, categoryA]
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
            id, org_id, category_id, title, content_type, publication_state,
            created_by_actor_id, updated_by_actor_id
          )
          VALUES ($1, $2, $3, 'Store lifecycle', 'pdf', 'draft', 'actor_a', 'actor_a')
        `,
        [storeContentId, orgA, categoryA]
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

test(
  "real PostgreSQL Training Content management is tenant-scoped, transactional, versioned, and conflict-safe",
  { skip: !databaseUrl },
  async () => {
    assertSafeIntegrationDatabase(databaseUrl);
    const setupPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 10_000,
    });
    const schema = `tc_management_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    let scopedPool: Pool | null = null;
    try {
      await setupPool.query(`CREATE SCHEMA ${quotedSchema}`);
      scopedPool = new Pool({
        connectionString: databaseUrl,
        max: 4,
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 10_000,
        options: `-c search_path=${schema}`,
      });
      await scopedPool.query(`
        CREATE TABLE audit_events (
          id TEXT PRIMARY KEY,
          actor_type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          action TEXT NOT NULL,
          org_id TEXT NULL,
          user_id TEXT NULL,
          message TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL
        )
      `);
      const store = createTrainingContentStore({
        provider: "postgres",
        databaseUrl,
        pgPoolMax: 4,
        pgConnectTimeoutMs: 15_000,
        pgIdleTimeoutMs: 10_000,
        queryPool: scopedPool,
      });
      await store.initialize();
      await store.initialize();
      const categoryStore = createTrainingContentCategoryStore({
        provider: "postgres",
        databaseUrl,
        pgPoolMax: 4,
        pgConnectTimeoutMs: 15_000,
        pgIdleTimeoutMs: 10_000,
        queryPool: scopedPool,
      });

      const actor = { actorType: "web_user" as const, actorId: "admin_a" };
      const orgACategory = await categoryStore.ensureDefaultCategory({
        orgId: "org_a",
        actor,
      });
      const orgBCategory = await categoryStore.ensureDefaultCategory({
        orgId: "org_b",
        actor: { actorType: "web_user", actorId: "admin_b" },
      });
      const repeatedOrgADefault = await categoryStore.ensureDefaultCategory({
        orgId: "org_a",
        actor,
      });
      assert.equal(repeatedOrgADefault.id, orgACategory.id);

      const leadershipCreated = await categoryStore.createCategory({
        orgId: "org_a",
        name: "Leadership",
        description: "Manager resources",
        actor,
      });
      const leadership = leadershipCreated.category;
      const orgBPrivateCreated = await categoryStore.createCategory({
        orgId: "org_b",
        name: "Private",
        description: "",
        actor: { actorType: "web_user", actorId: "admin_b" },
      });
      const orgBPrivate = orgBPrivateCreated.category;
      await assert.rejects(
        categoryStore.updateCategory({
          orgId: "org_a",
          categoryId: orgBPrivate.id,
          expectedUpdatedAt: orgBPrivate.updatedAt,
          name: "Cross tenant",
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_category_not_found"
      );
      await assert.rejects(
        categoryStore.archiveCategory({
          orgId: "org_a",
          categoryId: orgBPrivate.id,
          destinationCategoryId: orgACategory.id,
          expectedUpdatedAt: orgBPrivate.updatedAt,
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_category_not_found"
      );
      await assert.rejects(
        categoryStore.archiveCategory({
          orgId: "org_a",
          categoryId: orgACategory.id,
          destinationCategoryId: leadership.id,
          expectedUpdatedAt: orgACategory.updatedAt,
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_default_category_required"
      );
      const leadershipRenamed = await categoryStore.updateCategory({
        orgId: "org_a",
        categoryId: leadership.id,
        expectedUpdatedAt: leadership.updatedAt,
        name: "Leadership Resources",
        actor,
      });
      await assert.rejects(
        categoryStore.updateCategory({
          orgId: "org_a",
          categoryId: leadership.id,
          expectedUpdatedAt: leadership.updatedAt,
          description: "Stale update",
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_category_conflict"
      );
      const beforeCategoryOrder = await categoryStore.listCategories({ orgId: "org_a" });
      const categoryOrder = await categoryStore.reorderCategories({
        orgId: "org_a",
        categoryIds: [leadership.id, orgACategory.id],
        expectedOrderRevision: beforeCategoryOrder.orderRevision,
        actor,
      });
      assert.deepEqual(
        categoryOrder.categories.map((entry) => entry.id),
        [leadership.id, orgACategory.id]
      );
      await assert.rejects(
        categoryStore.reorderCategories({
          orgId: "org_a",
          categoryIds: [orgACategory.id, leadership.id],
          expectedOrderRevision: beforeCategoryOrder.orderRevision,
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_category_conflict"
      );
      await assert.rejects(
        categoryStore.reorderCategories({
          orgId: "org_a",
          categoryIds: [orgBPrivate.id, orgACategory.id],
          expectedOrderRevision: categoryOrder.orderRevision,
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_category_not_found"
      );

      const native = await store.createContent({
        orgId: "org_a",
        categoryId: orgACategory.id,
        title: "Coaching foundation",
        description: "Initial description",
        focusTopicId: "topic_a",
        focusTopicNameSnapshot: "Coaching",
        contentType: "native",
        nativeBody: "# Foundation",
        externalUrl: null,
        actor,
        now: new Date("2026-07-28T12:00:00.000Z"),
      });
      const otherOrg = await store.createContent({
        orgId: "org_b",
        categoryId: orgBCategory.id,
        title: "Other organization",
        description: "",
        focusTopicId: null,
        focusTopicNameSnapshot: null,
        contentType: "native",
        nativeBody: "# Other",
        externalUrl: null,
        actor: { actorType: "web_user", actorId: "admin_b" },
        now: new Date("2026-07-28T12:00:00.000Z"),
      });
      assert.equal(await store.getContentDetailForOrg("org_b", native.content.id), null);
      assert.equal(await store.getContentDetailForOrg("org_a", otherOrg.content.id), null);
      await assert.rejects(
        store.updateContent({
          orgId: "org_b",
          contentId: native.content.id,
          expectedUpdatedAt: native.content.updatedAt,
          title: "Cross tenant",
          actor: { actorType: "web_user", actorId: "admin_b" },
        }),
        (error: unknown) =>
          error instanceof TrainingContentStoreError
          && error.code === "training_content_not_found"
      );

      const categoryMoveCandidate = await store.createContent({
        orgId: "org_a",
        categoryId: orgACategory.id,
        title: "Published leadership guide",
        description: "",
        focusTopicId: null,
        focusTopicNameSnapshot: null,
        contentType: "native",
        nativeBody: "# Leadership",
        externalUrl: null,
        actor,
      });
      const categoryMoveAssigned = await store.replaceAssignments({
        orgId: "org_a",
        contentId: categoryMoveCandidate.content.id,
        expectedUpdatedAt: categoryMoveCandidate.content.updatedAt,
        assignments: [{ assignmentType: "organization", subjectUserId: null }],
        actor,
      });
      const categoryMovePublished = await store.transitionContent({
        orgId: "org_a",
        contentId: categoryMoveCandidate.content.id,
        expectedUpdatedAt: categoryMoveAssigned.content.updatedAt,
        action: "publish",
        actor,
      });

      const initialContentOrder = await categoryStore.getContentOrder("org_a");
      const reversedGeneralOrder = await categoryStore.reorderContent({
        orgId: "org_a",
        categories: initialContentOrder.groups.map((group) => ({
          categoryId: group.categoryId,
          contentIds: group.categoryId === orgACategory.id
            ? [...group.items.map((item) => item.id)].reverse()
            : group.items.map((item) => item.id),
        })),
        expectedOrderRevision: initialContentOrder.orderRevision,
        actor,
      });
      assert.deepEqual(
        reversedGeneralOrder.groups
          .find((group) => group.categoryId === orgACategory.id)
          ?.items.map((item) => item.id),
        [categoryMoveCandidate.content.id, native.content.id]
      );
      await assert.rejects(
        categoryStore.reorderContent({
          orgId: "org_a",
          categories: reversedGeneralOrder.groups.map((group) => ({
            categoryId: group.categoryId,
            contentIds: group.items.map((item) => item.id),
          })),
          expectedOrderRevision: initialContentOrder.orderRevision,
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_category_conflict"
      );
      await assert.rejects(
        categoryStore.reorderContent({
          orgId: "org_a",
          categories: reversedGeneralOrder.groups.map((group) => ({
            categoryId: group.categoryId,
            contentIds: group.categoryId === orgACategory.id
              ? [...group.items.map((item) => item.id), native.content.id]
              : group.items.map((item) => item.id),
          })),
          expectedOrderRevision: reversedGeneralOrder.orderRevision,
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_reorder_invalid"
      );
      await assert.rejects(
        categoryStore.reorderContent({
          orgId: "org_a",
          categories: [
            {
              categoryId: orgBPrivate.id,
              contentIds: reversedGeneralOrder.groups.flatMap((group) =>
                group.items.map((item) => item.id)
              ),
            },
            { categoryId: orgACategory.id, contentIds: [] },
          ],
          expectedOrderRevision: reversedGeneralOrder.orderRevision,
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentCategoryStoreError
          && error.code === "training_content_category_not_found"
      );

      const movedToLeadership = await categoryStore.reorderContent({
        orgId: "org_a",
        categories: reversedGeneralOrder.groups.map((group) => ({
          categoryId: group.categoryId,
          contentIds: group.categoryId === leadership.id
            ? [categoryMoveCandidate.content.id]
            : group.items
              .map((item) => item.id)
              .filter((contentId) => contentId !== categoryMoveCandidate.content.id),
        })),
        expectedOrderRevision: reversedGeneralOrder.orderRevision,
        actor,
      });
      assert.deepEqual(
        movedToLeadership.groups
          .find((group) => group.categoryId === leadership.id)
          ?.items.map((item) => item.id),
        [categoryMoveCandidate.content.id]
      );

      await scopedPool.query(`
        CREATE FUNCTION reject_category_archive_audit()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.action = 'training_content_category_archived' THEN
            RAISE EXCEPTION 'forced category archive audit failure';
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER reject_category_archive_audit_trigger
        BEFORE INSERT ON audit_events
        FOR EACH ROW
        EXECUTE FUNCTION reject_category_archive_audit()
      `);
      const currentLeadership = (await categoryStore.listCategories({ orgId: "org_a" }))
        .categories.find((entry) => entry.id === leadership.id)!;
      const movedAuditCountBefore = await scopedPool.query<{ count: string }>(
        `
          SELECT COUNT(*) AS count
          FROM audit_events
          WHERE action = 'training_content_category_content_moved'
        `
      );
      await assert.rejects(
        categoryStore.archiveCategory({
          orgId: "org_a",
          categoryId: leadership.id,
          destinationCategoryId: orgACategory.id,
          expectedUpdatedAt: currentLeadership.updatedAt,
          actor,
        }),
        /forced category archive audit failure/
      );
      assert.ok(await categoryStore.getActiveCategoryForOrg("org_a", leadership.id));
      assert.equal(
        (await store.getContentDetailForOrg("org_a", categoryMoveCandidate.content.id))
          ?.content.categoryId,
        leadership.id
      );
      const movedAuditCountAfter = await scopedPool.query<{ count: string }>(
        `
          SELECT COUNT(*) AS count
          FROM audit_events
          WHERE action = 'training_content_category_content_moved'
        `
      );
      assert.equal(
        movedAuditCountAfter.rows[0]?.count,
        movedAuditCountBefore.rows[0]?.count
      );
      await scopedPool.query("DROP TRIGGER reject_category_archive_audit_trigger ON audit_events");
      await scopedPool.query("DROP FUNCTION reject_category_archive_audit()");

      const archivedCategory = await categoryStore.archiveCategory({
        orgId: "org_a",
        categoryId: leadership.id,
        destinationCategoryId: orgACategory.id,
        expectedUpdatedAt: currentLeadership.updatedAt,
        actor,
      });
      assert.equal(archivedCategory.movedItemCount, 1);
      assert.equal(archivedCategory.category.archivedAt !== null, true);
      const movedPublishedContent = await store.getContentDetailForOrg(
        "org_a",
        categoryMoveCandidate.content.id
      );
      assert.equal(movedPublishedContent?.content.categoryId, orgACategory.id);
      assert.equal(
        movedPublishedContent?.content.publicationState,
        categoryMovePublished.content.publicationState
      );

      const nativeAfterCategoryChanges = await store.getContentDetailForOrg(
        "org_a",
        native.content.id
      );
      assert.ok(nativeAfterCategoryChanges);
      const metadataUpdated = await store.updateContent({
        orgId: "org_a",
        contentId: native.content.id,
        expectedUpdatedAt: nativeAfterCategoryChanges.content.updatedAt,
        title: "Coaching foundations",
        actor,
        now: new Date("2026-07-28T12:00:01.000Z"),
      });
      assert.equal(metadataUpdated.content.contentVersion, 1);
      const sourceUpdated = await store.updateContent({
        orgId: "org_a",
        contentId: native.content.id,
        expectedUpdatedAt: metadataUpdated.content.updatedAt,
        nativeBody: "# Revised foundation",
        actor,
        now: new Date("2026-07-28T12:00:02.000Z"),
      });
      assert.equal(sourceUpdated.content.contentVersion, 2);

      const assignments = await store.replaceAssignments({
        orgId: "org_a",
        contentId: native.content.id,
        expectedUpdatedAt: sourceUpdated.content.updatedAt,
        assignments: [
          { assignmentType: "organization", subjectUserId: null },
          { assignmentType: "user", subjectUserId: "learner_a" },
          { assignmentType: "user", subjectUserId: "learner_a" },
          { assignmentType: "manager", subjectUserId: "manager_a" },
          { assignmentType: "manager_team", subjectUserId: "manager_a" },
        ],
        actor,
        now: new Date("2026-07-28T12:00:03.000Z"),
      });
      assert.deepEqual(assignments.assignmentCounts, {
        organization: 1,
        user: 1,
        manager: 1,
        managerTeam: 1,
      });

      await assert.rejects(
        store.updateContent({
          orgId: "org_a",
          contentId: native.content.id,
          expectedUpdatedAt: sourceUpdated.content.updatedAt,
          title: "Stale overwrite",
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentStoreError
          && error.code === "training_content_conflict"
      );

      const currentRevision = assignments.content.updatedAt;
      const concurrentResults = await Promise.allSettled([
        store.updateContent({
          orgId: "org_a",
          contentId: native.content.id,
          expectedUpdatedAt: currentRevision,
          description: "Admin one",
          actor,
          now: new Date("2026-07-28T12:00:04.000Z"),
        }),
        store.updateContent({
          orgId: "org_a",
          contentId: native.content.id,
          expectedUpdatedAt: currentRevision,
          description: "Admin two",
          actor: { actorType: "web_user", actorId: "admin_two" },
          now: new Date("2026-07-28T12:00:04.000Z"),
        }),
      ]);
      assert.equal(
        concurrentResults.filter((result) => result.status === "fulfilled").length,
        1
      );
      assert.equal(
        concurrentResults.filter((result) =>
          result.status === "rejected"
          && result.reason instanceof TrainingContentStoreError
          && result.reason.code === "training_content_conflict"
        ).length,
        1
      );

      let current = await store.getContentDetailForOrg("org_a", native.content.id);
      assert.ok(current);
      const unpublishedAssignments = current.assignments.map((entry) => ({
        assignmentType: entry.assignmentType,
        subjectUserId: entry.subjectUserId,
      }));
      const published = await store.transitionContent({
        orgId: "org_a",
        contentId: native.content.id,
        expectedUpdatedAt: current.content.updatedAt,
        action: "publish",
        actor,
        now: new Date("2026-07-28T12:00:05.000Z"),
      });
      assert.equal(published.content.publicationState, "published");
      const unpublished = await store.transitionContent({
        orgId: "org_a",
        contentId: native.content.id,
        expectedUpdatedAt: published.content.updatedAt,
        action: "unpublish",
        actor,
        now: new Date("2026-07-28T12:00:06.000Z"),
      });
      assert.equal(unpublished.content.publicationState, "draft");
      assert.deepEqual(
        unpublished.assignments.map((entry) => ({
          assignmentType: entry.assignmentType,
          subjectUserId: entry.subjectUserId,
        })),
        unpublishedAssignments
      );
      const archived = await store.transitionContent({
        orgId: "org_a",
        contentId: native.content.id,
        expectedUpdatedAt: unpublished.content.updatedAt,
        action: "archive",
        actor,
        now: new Date("2026-07-28T12:00:07.000Z"),
      });
      assert.equal(archived.content.publicationState, "archived");
      assert.equal(archived.assignments.length, 0);
      const assignmentHistory = await scopedPool.query<{ total: string; revoked: string }>(
        `
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked
          FROM org_content_assignments
          WHERE org_id = $1 AND content_id = $2
        `,
        ["org_a", native.content.id]
      );
      assert.equal(Number(assignmentHistory.rows[0]?.total), 4);
      assert.equal(Number(assignmentHistory.rows[0]?.revoked), 4);

      const unassigned = await store.createContent({
        orgId: "org_a",
        categoryId: orgACategory.id,
        title: "Not ready",
        description: "",
        focusTopicId: null,
        focusTopicNameSnapshot: null,
        contentType: "native",
        nativeBody: "# Ready body",
        externalUrl: null,
        actor,
      });
      await assert.rejects(
        store.transitionContent({
          orgId: "org_a",
          contentId: unassigned.content.id,
          expectedUpdatedAt: unassigned.content.updatedAt,
          action: "publish",
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentStoreError
          && error.code === "training_content_publish_invalid"
          && Array.isArray(error.details?.reasons)
          && error.details.reasons.includes("assignment_required")
      );

      const publishedInvariant = await store.createContent({
        orgId: "org_a",
        categoryId: orgACategory.id,
        title: "Published invariant",
        description: "",
        focusTopicId: null,
        focusTopicNameSnapshot: null,
        contentType: "native",
        nativeBody: "# Required body",
        externalUrl: null,
        actor,
      });
      const assignedInvariant = await store.replaceAssignments({
        orgId: "org_a",
        contentId: publishedInvariant.content.id,
        expectedUpdatedAt: publishedInvariant.content.updatedAt,
        assignments: [{ assignmentType: "organization", subjectUserId: null }],
        actor,
      });
      const activeInvariant = await store.transitionContent({
        orgId: "org_a",
        contentId: publishedInvariant.content.id,
        expectedUpdatedAt: assignedInvariant.content.updatedAt,
        action: "publish",
        actor,
      });
      await assert.rejects(
        store.updateContent({
          orgId: "org_a",
          contentId: activeInvariant.content.id,
          expectedUpdatedAt: activeInvariant.content.updatedAt,
          nativeBody: null,
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentStoreError
          && error.code === "training_content_publish_invalid"
      );
      await assert.rejects(
        store.replaceAssignments({
          orgId: "org_a",
          contentId: activeInvariant.content.id,
          expectedUpdatedAt: activeInvariant.content.updatedAt,
          assignments: [],
          actor,
        }),
        (error: unknown) =>
          error instanceof TrainingContentStoreError
          && error.code === "training_content_publish_invalid"
      );
      const invariantAfterRejectedEdits = await store.getContentDetailForOrg(
        "org_a",
        activeInvariant.content.id
      );
      assert.equal(invariantAfterRejectedEdits?.content.nativeBody, "# Required body");
      assert.equal(invariantAfterRejectedEdits?.content.updatedAt, activeInvariant.content.updatedAt);
      assert.equal(invariantAfterRejectedEdits?.assignments.length, 1);

      const external = await store.createContent({
        orgId: "org_a",
        categoryId: orgACategory.id,
        title: "External reference",
        description: "",
        focusTopicId: null,
        focusTopicNameSnapshot: null,
        contentType: "external_url",
        nativeBody: null,
        externalUrl: "https://example.com/one",
        actor,
      });
      const externalUpdated = await store.updateContent({
        orgId: "org_a",
        contentId: external.content.id,
        expectedUpdatedAt: external.content.updatedAt,
        externalUrl: "https://example.com/two",
        actor,
      });
      assert.equal(externalUpdated.content.contentVersion, 2);

      const uploaded = await store.createContent({
        orgId: "org_a",
        categoryId: orgACategory.id,
        title: "Uploaded PDF",
        description: "",
        focusTopicId: null,
        focusTopicNameSnapshot: null,
        contentType: "pdf",
        nativeBody: null,
        externalUrl: null,
        actor,
      });
      const assetStore = createTrainingContentAssetStore({
        provider: "postgres",
        databaseUrl,
        pgPoolMax: 4,
        pgConnectTimeoutMs: 15_000,
        pgIdleTimeoutMs: 10_000,
        queryPool: scopedPool,
      });
      const firstPending = await assetStore.createPendingAsset({
        orgId: "org_a",
        contentId: uploaded.content.id,
        assetRole: "primary",
        originalFilename: "first.pdf",
        declaredMimeType: "application/pdf",
        fileExtension: "pdf",
        declaredByteSize: 8,
        replacementAssetId: null,
        uploadTtlSeconds: 600,
        maxPendingBytesForOrganization: 1_000_000,
        actor,
        now: new Date("2026-07-28T12:01:00.000Z"),
      });
      const firstClaim = await assetStore.claimFinalization({
        orgId: "org_a",
        contentId: uploaded.content.id,
        assetId: firstPending.asset.id,
        actualByteSize: 8,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "etag-1",
        leaseSeconds: 300,
        actor,
        now: new Date("2026-07-28T12:01:01.000Z"),
      });
      assert.equal(firstClaim.status, "claimed");
      assert.ok(firstClaim.asset.finalObjectKey);
      const firstReady = await assetStore.completeFinalization({
        orgId: "org_a",
        contentId: uploaded.content.id,
        assetId: firstPending.asset.id,
        finalObjectKey: firstClaim.asset.finalObjectKey!,
        actualByteSize: 8,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "etag-1",
        actor,
        now: new Date("2026-07-28T12:01:02.000Z"),
      });
      assert.equal(firstReady.replacedAsset, null);
      assert.equal(
        (await store.getContentDetailForOrg("org_a", uploaded.content.id))?.content.contentVersion,
        1
      );

      const secondPending = await assetStore.createPendingAsset({
        orgId: "org_a",
        contentId: uploaded.content.id,
        assetRole: "primary",
        originalFilename: "second.pdf",
        declaredMimeType: "application/pdf",
        fileExtension: "pdf",
        declaredByteSize: 9,
        replacementAssetId: firstReady.asset.id,
        uploadTtlSeconds: 600,
        maxPendingBytesForOrganization: 1_000_000,
        actor,
        now: new Date("2026-07-28T12:02:00.000Z"),
      });
      const secondClaim = await assetStore.claimFinalization({
        orgId: "org_a",
        contentId: uploaded.content.id,
        assetId: secondPending.asset.id,
        actualByteSize: 9,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "etag-2",
        leaseSeconds: 300,
        actor,
        now: new Date("2026-07-28T12:02:01.000Z"),
      });
      assert.equal(secondClaim.status, "claimed");
      const secondReady = await assetStore.completeFinalization({
        orgId: "org_a",
        contentId: uploaded.content.id,
        assetId: secondPending.asset.id,
        finalObjectKey: secondClaim.asset.finalObjectKey!,
        actualByteSize: 9,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "etag-2",
        actor,
        now: new Date("2026-07-28T12:02:02.000Z"),
      });
      assert.equal(secondReady.replacedAsset?.id, firstReady.asset.id);
      assert.equal(secondReady.replacedAsset?.uploadState, "superseded");
      const uploadedAfterReplacement = await store.getContentDetailForOrg(
        "org_a",
        uploaded.content.id
      );
      assert.equal(uploadedAfterReplacement?.content.contentVersion, 2);
      assert.equal(uploadedAfterReplacement?.currentAsset?.id, secondReady.asset.id);

      const thirdPending = await assetStore.createPendingAsset({
        orgId: "org_a",
        contentId: uploaded.content.id,
        assetRole: "primary",
        originalFilename: "third.pdf",
        declaredMimeType: "application/pdf",
        fileExtension: "pdf",
        declaredByteSize: 10,
        replacementAssetId: secondReady.asset.id,
        uploadTtlSeconds: 600,
        maxPendingBytesForOrganization: 1_000_000,
        actor,
        now: new Date("2026-07-28T12:03:00.000Z"),
      });
      const thirdClaim = await assetStore.claimFinalization({
        orgId: "org_a",
        contentId: uploaded.content.id,
        assetId: thirdPending.asset.id,
        actualByteSize: 10,
        detectedMimeType: "application/pdf",
        checksumOrEtag: "etag-3",
        leaseSeconds: 300,
        actor,
        now: new Date("2026-07-28T12:03:01.000Z"),
      });
      assert.equal(thirdClaim.status, "claimed");
      const archivedUploaded = await store.transitionContent({
        orgId: "org_a",
        contentId: uploaded.content.id,
        expectedUpdatedAt: uploadedAfterReplacement!.content.updatedAt,
        action: "archive",
        actor,
        now: new Date("2026-07-28T12:03:02.000Z"),
      });
      assert.equal(archivedUploaded.content.publicationState, "archived");
      await assert.rejects(
        assetStore.claimFinalization({
          orgId: "org_a",
          contentId: uploaded.content.id,
          assetId: thirdPending.asset.id,
          actualByteSize: 10,
          detectedMimeType: "application/pdf",
          checksumOrEtag: "etag-3",
          leaseSeconds: 300,
          actor,
          now: new Date("2026-07-28T12:03:03.000Z"),
        }),
        (error: unknown) =>
          error instanceof TrainingContentAssetStoreError
          && error.code === "content_archived"
      );
      await assert.rejects(
        assetStore.completeFinalization({
          orgId: "org_a",
          contentId: uploaded.content.id,
          assetId: thirdPending.asset.id,
          finalObjectKey: thirdClaim.asset.finalObjectKey!,
          actualByteSize: 10,
          detectedMimeType: "application/pdf",
          checksumOrEtag: "etag-3",
          actor,
          now: new Date("2026-07-28T12:03:04.000Z"),
        }),
        (error: unknown) =>
          error instanceof TrainingContentAssetStoreError
          && error.code === "content_archived"
      );
      const retainedAfterArchive = await store.getContentDetailForOrg(
        "org_a",
        uploaded.content.id
      );
      assert.equal(retainedAfterArchive?.currentAsset?.id, secondReady.asset.id);

      const beforeRollback = await store.getContentDetailForOrg("org_a", external.content.id);
      assert.ok(beforeRollback);
      await scopedPool.query(`
        CREATE FUNCTION reject_training_content_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'training_content_metadata_updated' THEN
            RAISE EXCEPTION 'simulated audit failure';
          END IF;
          RETURN NEW;
        END
        $$
      `);
      await scopedPool.query(`
        CREATE TRIGGER reject_training_content_audit_trigger
        BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_training_content_audit()
      `);
      await assert.rejects(
        store.updateContent({
          orgId: "org_a",
          contentId: external.content.id,
          expectedUpdatedAt: beforeRollback.content.updatedAt,
          title: "Must roll back",
          actor,
        }),
        /simulated audit failure/
      );
      const afterRollback = await store.getContentDetailForOrg("org_a", external.content.id);
      assert.equal(afterRollback?.content.title, beforeRollback.content.title);
      assert.equal(afterRollback?.content.updatedAt, beforeRollback.content.updatedAt);

      const auditActions = await scopedPool.query<{ action: string }>(
        `
          SELECT action
          FROM audit_events
          WHERE org_id = 'org_a'
          ORDER BY created_at ASC, id ASC
        `
      );
      for (const expectedAction of [
        "training_content_created",
        "training_content_metadata_updated",
        "training_content_native_body_updated",
        "training_content_assignments_changed",
        "training_content_published",
        "training_content_unpublished",
        "training_content_archived",
        "training_content_external_url_updated",
      ]) {
        assert.ok(auditActions.rows.some((row) => row.action === expectedAction));
      }
      const auditJson = JSON.stringify(
        await scopedPool.query<{ metadata: unknown }>("SELECT metadata FROM audit_events")
      );
      assert.equal(auditJson.includes("# Revised foundation"), false);
      assert.equal(auditJson.includes("example.com/two"), false);

      const activeList = await store.listContentForManagement("org_a", {
        page: 1,
        pageSize: 2,
      });
      assert.equal(activeList.items.length, 2);
      assert.equal(activeList.total, 4);
      const beyondLastPage = await store.listContentForManagement("org_a", {
        page: 999,
        pageSize: 2,
      });
      assert.equal(beyondLastPage.items.length, 0);
      assert.equal(beyondLastPage.total, 4);
      assert.equal(
        activeList.items.some((row) => row.content.publicationState === "archived"),
        false
      );
      const archivedList = await store.listContentForManagement("org_a", {
        publicationState: "archived",
      });
      assert.deepEqual(
        archivedList.items.map((row) => row.content.id).sort(),
        [native.content.id, uploaded.content.id].sort()
      );
      const unusualSearch = await store.listContentForManagement("org_a", {
        query: "%_\\'; DROP TABLE org_content_items; --",
      });
      assert.equal(unusualSearch.total, 0);
      assert.equal(
        Number((await scopedPool.query("SELECT COUNT(*) FROM org_content_items")).rows[0]?.count) > 0,
        true
      );
    } finally {
      if (scopedPool) {
        await scopedPool.end();
      }
      await setupPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      await setupPool.end();
    }
  }
);

test(
  "real PostgreSQL mobile reads enforce tenant, publication, category, assignment, asset, and ordering filters",
  { skip: !databaseUrl },
  async () => {
    assertSafeIntegrationDatabase(databaseUrl);
    const setupPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 10_000,
    });
    const schema = `tc_mobile_read_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    let scopedPool: Pool | null = null;
    try {
      await setupPool.query(`CREATE SCHEMA ${quotedSchema}`);
      scopedPool = new Pool({
        connectionString: databaseUrl,
        max: 2,
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 10_000,
        options: `-c search_path=${schema}`,
      });
      const store = createTrainingContentStore({
        provider: "postgres",
        databaseUrl,
        pgPoolMax: 2,
        pgConnectTimeoutMs: 15_000,
        pgIdleTimeoutMs: 10_000,
        queryPool: scopedPool,
      });
      await store.initialize();

      const categoryFirst = randomUUID();
      const categorySecond = randomUUID();
      const categoryArchived = randomUUID();
      await scopedPool.query(
        `
          INSERT INTO org_content_categories (
            id, org_id, name, description, display_order, is_default,
            created_by_actor_id, updated_by_actor_id, archived_at
          )
          VALUES
            ($1, 'org_a', 'First', '', 0, TRUE, 'admin', 'admin', NULL),
            ($2, 'org_a', 'Second', '', 1, FALSE, 'admin', 'admin', NULL),
            ($3, 'org_a', 'Archived', '', 2, FALSE, 'admin', 'admin', NOW()),
            ($4, 'org_b', 'Other tenant', '', 0, TRUE, 'admin', 'admin', NULL)
        `,
        [categoryFirst, categorySecond, categoryArchived, randomUUID()]
      );

      const publishedFirst = randomUUID();
      const publishedSecond = randomUUID();
      const draft = randomUUID();
      const archivedCategoryContent = randomUUID();
      const otherTenantContent = randomUUID();
      await scopedPool.query(
        `
          INSERT INTO org_content_items (
            id, org_id, category_id, title, description, content_type,
            publication_state, native_body, display_order, content_version,
            created_by_actor_id, updated_by_actor_id, published_at
          )
          VALUES
            ($1, 'org_a', $6, 'First item', '', 'native', 'published', '# First', 1, 1, 'admin', 'admin', NOW()),
            ($2, 'org_a', $7, 'Second item', '', 'pdf', 'published', NULL, 0, 1, 'admin', 'admin', NOW()),
            ($3, 'org_a', $6, 'Draft item', '', 'native', 'draft', '# Draft', 0, 1, 'admin', 'admin', NULL),
            ($4, 'org_a', $8, 'Archived category item', '', 'native', 'published', '# Hidden', 0, 1, 'admin', 'admin', NOW()),
            ($5, 'org_b', (
              SELECT id FROM org_content_categories WHERE org_id = 'org_b' LIMIT 1
            ), 'Other tenant item', '', 'native', 'published', '# Other', 0, 1, 'admin', 'admin', NOW())
        `,
        [
          publishedFirst,
          publishedSecond,
          draft,
          archivedCategoryContent,
          otherTenantContent,
          categoryFirst,
          categorySecond,
          categoryArchived,
        ]
      );
      await scopedPool.query(
        `
          INSERT INTO org_content_assignments (
            id, org_id, content_id, assignment_type, subject_user_id,
            created_by_actor_id, revoked_at
          )
          VALUES
            ($1, 'org_a', $4, 'organization', NULL, 'admin', NULL),
            ($2, 'org_a', $5, 'user', 'learner', 'admin', NULL),
            ($3, 'org_a', $5, 'manager_team', 'old_manager', 'admin', NOW())
        `,
        [randomUUID(), randomUUID(), randomUUID(), publishedFirst, publishedSecond]
      );
      const readyAssetId = randomUUID();
      await scopedPool.query(
        `
          INSERT INTO org_content_assets (
            id, org_id, content_id, asset_role, version, upload_state,
            storage_provider, final_object_key, original_filename,
            detected_mime_type, file_extension, byte_size, finalized_at,
            created_by_actor_id, is_current
          )
          VALUES (
            $1, 'org_a', $2, 'primary', 1, 'ready',
            'r2', 'orgs/org_a/content/pdf/current.pdf', 'current.pdf',
            'application/pdf', 'pdf', 100, NOW(), 'admin', TRUE
          )
        `,
        [readyAssetId, publishedSecond]
      );

      const mobile = await store.listPublishedContentForMobile("org_a", 500);
      assert.equal(mobile.truncated, false);
      assert.deepEqual(
        mobile.items.map((entry) => entry.content.id),
        [publishedFirst, publishedSecond]
      );
      assert.deepEqual(
        mobile.items.map((entry) => entry.category.name),
        ["First", "Second"]
      );
      assert.equal(mobile.items[0]?.assignments.length, 1);
      assert.equal(mobile.items[1]?.assignments.length, 1);
      assert.equal(mobile.items[1]?.assignments[0]?.assignmentType, "user");
      assert.equal(mobile.items[1]?.currentAsset?.id, readyAssetId);
      assert.equal(
        mobile.items[1]?.currentAsset?.finalObjectKey,
        "orgs/org_a/content/pdf/current.pdf"
      );
      assert.equal(await store.getPublishedContentForMobile("org_a", draft), null);
      assert.equal(
        await store.getPublishedContentForMobile("org_a", archivedCategoryContent),
        null
      );
      assert.equal(
        await store.getPublishedContentForMobile("org_a", otherTenantContent),
        null
      );
      assert.equal(
        await store.getPublishedContentForMobile("org_b", publishedFirst),
        null
      );

      const bounded = await store.listPublishedContentForMobile("org_a", 1);
      assert.equal(bounded.items.length, 1);
      assert.equal(bounded.truncated, true);
    } finally {
      if (scopedPool) {
        await scopedPool.end();
      }
      try {
        await setupPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      } finally {
        await setupPool.end();
      }
    }
  }
);
