import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createTrainingContentStore } from "./trainingContentStore.js";

const CONTENT_ROW = {
  id: "7d8ac3f7-7596-4c64-83f3-3a38f2118fc2",
  org_id: "org_1",
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

  assert.equal(queries.filter((query) => query.text.includes("CREATE TABLE IF NOT EXISTS")).length, 1);
  assert.ok(queries.some((query) => query.text.includes("pg_advisory_xact_lock")));
  assert.equal(orgOne.length, 1);
  assert.equal(orgTwo.length, 0);
  assert.equal(scoped?.orgId, "org_1");
  assert.equal(crossTenant, null);
  assert.deepEqual(
    queries.filter((query) => query.text.includes("FROM org_content_items")).map((query) => query.values),
    [["org_1"], ["org_2"], ["org_1", CONTENT_ROW.id], ["org_2", CONTENT_ROW.id]]
  );
});
