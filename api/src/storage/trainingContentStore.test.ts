import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createTrainingContentStore } from "./trainingContentStore.js";

const CONTENT_ROW = {
  id: "7d8ac3f7-7596-4c64-83f3-3a38f2118fc2",
  org_id: "org_1",
  category_id: "2d8ac3f7-7596-4c64-83f3-3a38f2118fc2",
  title: "Coaching foundation",
  description: "Foundation content",
  focus_topic_id: "training_1",
  focus_topic_name_snapshot: "Coaching",
  content_type: "native",
  publication_state: "draft",
  native_body: "# Foundation",
  external_url: null,
  display_order: 0,
  content_version: 1,
  created_by_actor_id: "admin_1",
  updated_by_actor_id: "admin_1",
  created_at: new Date("2026-07-28T12:00:00.000Z"),
  updated_at: new Date("2026-07-28T12:00:00.000Z"),
  published_at: null,
  archived_at: null,
};

test("Training Content migration is idempotent, relational, and tenant-constrained", async () => {
  const migrationUrl = new URL("../../sql/008_training_content.sql", import.meta.url);
  const sql = await readFile(migrationUrl, "utf8");

  for (const table of [
    "org_module_entitlements",
    "org_content_items",
    "org_content_assets",
    "org_content_assignments",
    "org_content_scenario_links",
    "org_content_usage",
    "org_content_usage_sessions",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.equal((sql.match(/FOREIGN KEY \(org_id, content_id\)/g) ?? []).length, 5);
  assert.equal((sql.match(/REFERENCES org_content_items \(org_id, id\) ON DELETE RESTRICT/g) ?? []).length, 5);
  assert.match(sql, /org_content_assignments_active_org_unique_idx/);
  assert.match(sql, /org_content_assignments_active_subject_unique_idx/);
  assert.match(sql, /WHERE revoked_at IS NULL AND assignment_type = 'organization'/);
  assert.match(sql, /org_content_scenario_links_active_unique_idx/);
  assert.match(sql, /PRIMARY KEY \(org_id, content_id, user_id\)/);
  assert.doesNotMatch(sql, /INSERT INTO/i);
  assert.doesNotMatch(sql, /app_state/i);
});

test("Training Content store initializes once and scopes every content read by organization", async () => {
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const queryPool = {
    async query(text: string, values?: readonly unknown[]) {
      queries.push({ text, values });
      if (text.includes("WHERE org_id = $1 AND id = $2")) {
        return {
          rows: values?.[0] === "org_1" && values?.[1] === CONTENT_ROW.id ? [CONTENT_ROW] : [],
          rowCount: 1,
        };
      }
      if (text.includes("WHERE org_id = $1")) {
        return { rows: values?.[0] === "org_1" ? [CONTENT_ROW] : [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    async connect() {
      return {
        async query(text: string) {
          queries.push({ text });
          if (
            text.trim() === "BEGIN"
            || text.trim() === "COMMIT"
            || text.trim() === "ROLLBACK"
            || text.includes("pg_advisory_xact_lock")
            || text.includes("CREATE TABLE IF NOT EXISTS org_content_items")
            || text.includes("ALTER TABLE org_content_assets")
            || text.includes("CREATE TABLE IF NOT EXISTS org_content_categories")
          ) {
            return { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected client query: ${text}`);
        },
        release() {
          // No-op for the deterministic query pool.
        },
      };
    },
  };
  const store = createTrainingContentStore({
    provider: "postgres",
    databaseUrl: "postgres://example.invalid/peritio",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });

  await store.initialize();
  await store.initialize();
  const orgOne = await store.listContentItemsForOrg("org_1");
  const orgTwo = await store.listContentItemsForOrg("org_2");
  const scoped = await store.getContentItemForOrg("org_1", CONTENT_ROW.id);
  const crossTenant = await store.getContentItemForOrg("org_2", CONTENT_ROW.id);

  assert.equal(queries.filter((query) =>
    query.text.includes("CREATE TABLE IF NOT EXISTS")
    || query.text.includes("ALTER TABLE org_content_assets")
  ).length, 5);
  assert.ok(queries.some((query) => query.text.includes("pg_advisory_xact_lock")));
  assert.equal(orgOne.length, 1);
  assert.equal(orgTwo.length, 0);
  assert.equal(scoped?.orgId, "org_1");
  assert.equal(crossTenant, null);
  assert.deepEqual(
    queries
      .filter((query) => query.text.includes("FROM org_content_items") && query.values)
      .map((query) => query.values),
    [["org_1"], ["org_2"], ["org_1", CONTENT_ROW.id], ["org_2", CONTENT_ROW.id]]
  );
});

test("Training Content detail exposes a newer active video replacement for editor restoration", async () => {
  const currentAsset = {
    id: "1d8ac3f7-7596-4c64-83f3-3a38f2118fc2",
    org_id: "org_1",
    content_id: CONTENT_ROW.id,
    asset_role: "primary",
    version: 1,
    upload_state: "ready",
    original_filename: "current.mp4",
    declared_mime_type: "video/mp4",
    detected_mime_type: "video/mp4",
    file_extension: "mp4",
    declared_byte_size: 100,
    byte_size: 100,
    upload_expires_at: null,
    processing_attempt_count: 0,
    processing_next_attempt_at: null,
    processing_error_category: null,
    rejection_reason_category: null,
    finalized_at: new Date("2026-07-28T12:00:00.000Z"),
    superseded_at: null,
    replacement_for_asset_id: null,
    is_current: true,
    cleanup_pending: false,
    created_at: new Date("2026-07-28T12:00:00.000Z"),
    updated_at: new Date("2026-07-28T12:00:00.000Z"),
  };
  const processingAsset = {
    ...currentAsset,
    id: "3d8ac3f7-7596-4c64-83f3-3a38f2118fc2",
    version: 2,
    upload_state: "processing",
    original_filename: "replacement.mp4",
    processing_next_attempt_at: new Date("2026-07-28T12:01:00.000Z"),
    finalized_at: null,
    replacement_for_asset_id: currentAsset.id,
    is_current: false,
  };
  const queries: string[] = [];
  const queryPool = {
    async query(text: string) {
      queries.push(text);
      if (text.includes("FROM org_content_items")) {
        return {
          rows: [{ ...CONTENT_ROW, content_type: "video", native_body: null }],
          rowCount: 1,
        };
      }
      if (text.includes("FROM org_content_categories")) {
        return { rows: [{ name: "General" }], rowCount: 1 };
      }
      if (text.includes("FROM org_content_assets candidate")) {
        return { rows: [processingAsset], rowCount: 1 };
      }
      if (text.includes("FROM org_content_assets")) {
        return { rows: [currentAsset], rowCount: 1 };
      }
      if (text.includes("FROM org_content_assignments")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  };
  const store = createTrainingContentStore({
    provider: "postgres",
    databaseUrl: "postgres://example.invalid/peritio",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });

  const loaded = await store.getContentDetailForOrg("org_1", CONTENT_ROW.id);

  assert.equal(loaded?.currentAsset?.id, currentAsset.id);
  assert.equal(loaded?.latestVideoUploadAsset?.id, processingAsset.id);
  assert.equal(loaded?.latestVideoUploadAsset?.uploadState, "processing");
  assert.equal(loaded?.hasActiveVideoProcessing, true);
  const activeAssetQuery = queries.find((text) =>
    text.includes("FROM org_content_assets candidate")
  );
  assert.ok(activeAssetQuery);
  assert.match(activeAssetQuery, /upload_state IN \('processing', 'rejected'\)/);
  assert.match(activeAssetQuery, /candidate\.version > COALESCE/);
});

test("mobile Training Content reads are bounded, published-only, ordered, and tenant-scoped", async () => {
  const publishedRow = {
    ...CONTENT_ROW,
    publication_state: "published",
    published_at: new Date("2026-07-28T12:01:00.000Z"),
    category_name: "General",
    category_description: "General resources",
    category_display_order: 0,
    category_is_default: true,
    category_created_by_actor_id: "admin_1",
    category_updated_by_actor_id: "admin_1",
    category_created_at: new Date("2026-07-28T12:00:00.000Z"),
    category_updated_at: new Date("2026-07-28T12:00:00.000Z"),
    category_archived_at: null,
    current_asset_id: null,
    current_asset_org_id: null,
    current_asset_content_id: null,
    current_asset_upload_state: null,
    current_asset_original_filename: null,
    current_asset_detected_mime_type: null,
    current_asset_file_extension: null,
    current_asset_byte_size: null,
    current_asset_is_current: null,
    current_asset_final_object_key: null,
    current_asset_object_deleted_at: null,
  };
  const assignmentRow = {
    id: "4d8ac3f7-7596-4c64-83f3-3a38f2118fc2",
    org_id: "org_1",
    content_id: CONTENT_ROW.id,
    assignment_type: "organization",
    subject_user_id: null,
    created_by_actor_id: "admin_1",
    created_at: new Date("2026-07-28T12:00:00.000Z"),
    revoked_by_actor_id: null,
    revoked_at: null,
  };
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const queryPool = {
    async query(text: string, values?: readonly unknown[]) {
      queries.push({ text, values });
      if (text.includes("FROM org_content_items c") && text.includes("category.archived_at IS NULL")) {
        const correctOrg = values?.[0] === "org_1";
        const correctContent =
          values?.length !== 2
          || typeof values?.[1] === "number"
          || values?.[1] === CONTENT_ROW.id;
        return { rows: correctOrg && correctContent ? [publishedRow] : [], rowCount: 1 };
      }
      if (text.includes("FROM org_content_assignments")) {
        return { rows: values?.[0] === "org_1" ? [assignmentRow] : [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  };
  const store = createTrainingContentStore({
    provider: "postgres",
    databaseUrl: "postgres://example.invalid/peritio",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });

  const library = await store.listPublishedContentForMobile("org_1", 25);
  const detail = await store.getPublishedContentForMobile("org_1", CONTENT_ROW.id);
  const crossTenant = await store.getPublishedContentForMobile("org_2", CONTENT_ROW.id);

  assert.equal(library.items.length, 1);
  assert.equal(library.items[0]?.content.publicationState, "published");
  assert.equal(library.items[0]?.category.name, "General");
  assert.equal(library.items[0]?.assignments[0]?.assignmentType, "organization");
  assert.equal(detail?.content.id, CONTENT_ROW.id);
  assert.equal(crossTenant, null);
  const listQuery = queries.find(
    (query) => query.text.includes("FROM org_content_items c") && query.values?.[1] === 26
  );
  assert.ok(listQuery);
  assert.match(listQuery.text, /c\.publication_state = 'published'/);
  assert.match(listQuery.text, /category\.archived_at IS NULL/);
  assert.match(listQuery.text, /ORDER BY\s+category\.display_order ASC,\s+c\.display_order ASC/s);
  assert.match(listQuery.text, /upload_state = 'ready'/);
  assert.match(listQuery.text, /object_deleted_at IS NULL/);
  assert.ok(queries.some((query) =>
    query.text.includes("content_id = ANY($2::uuid[])")
    && query.values?.[0] === "org_1"
  ));
});
