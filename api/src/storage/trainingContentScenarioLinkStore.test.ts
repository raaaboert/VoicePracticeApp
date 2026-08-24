import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createTrainingContentStore,
  TrainingContentStoreError,
  type TrainingContentScenarioLink,
} from "./trainingContentStore.js";
import { loadTrainingContentMigrationSql } from "./trainingContentMigrations.js";

const CONTENT_ID = "20000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-24T12:30:00.000Z");

function row(scenarioId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `10000000-0000-4000-8000-${scenarioId.charCodeAt(0).toString().padStart(12, "0")}`,
    org_id: "org_1",
    content_id: CONTENT_ID,
    focus_topic_id: null,
    scenario_id: scenarioId,
    created_by_actor_id: "admin_original",
    created_at: new Date("2026-08-24T12:00:00.000Z"),
    removed_by_actor_id: null,
    removed_at: null,
    ...overrides,
  };
}

interface QueryRecord {
  text: string;
  values?: readonly unknown[];
}

function createHarness(options: {
  active?: ReturnType<typeof row>[];
  final?: ReturnType<typeof row>[];
  restored?: ReadonlySet<string>;
  contentExists?: boolean;
} = {}) {
  const poolQueries: QueryRecord[] = [];
  const transactionQueries: QueryRecord[] = [];
  let initialized = false;
  const active = options.active ?? [];
  const final = options.final ?? active;

  const client = {
    async query(text: string, values?: readonly unknown[]) {
      transactionQueries.push({ text, values });
      const normalized = text.trim();
      if (!initialized) {
        if (normalized === "COMMIT") {
          initialized = true;
        }
        return { rows: [], rowCount: 0 };
      }
      if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("SELECT id") && text.includes("FROM org_content_items")) {
        return { rows: options.contentExists === false ? [] : [{ id: CONTENT_ID }], rowCount: 1 };
      }
      if (text.includes("SET removed_by_actor_id = $4")) {
        return { rows: [], rowCount: Array.isArray(values?.[2]) ? values![2].length : 0 };
      }
      if (text.includes("SET focus_topic_id = NULL")) {
        const scenarioId = String(values?.[2] ?? "");
        return options.restored?.has(scenarioId)
          ? { rows: [row(scenarioId, { created_by_actor_id: values?.[3], created_at: values?.[4] })], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO org_content_scenario_links")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("FROM org_content_scenario_links") && text.includes("FOR UPDATE")) {
        return { rows: active, rowCount: active.length };
      }
      if (text.includes("FROM org_content_scenario_links")) {
        return { rows: final, rowCount: final.length };
      }
      throw new Error(`Unexpected transaction query: ${text}`);
    },
    release() {},
  };

  const queryPool = {
    async query(text: string, values?: readonly unknown[]) {
      poolQueries.push({ text, values });
      if (text.includes("FROM org_content_scenario_links")) {
        return { rows: final, rowCount: final.length };
      }
      throw new Error(`Unexpected pool query: ${text}`);
    },
    async connect() {
      return client;
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
  return { store, poolQueries, transactionQueries };
}

test("migration 013 only makes scenario-link focus_topic_id nullable", async () => {
  const sql = await readFile(new URL("../../sql/013_training_content_scenario_links.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE org_content_scenario_links\s+ALTER COLUMN focus_topic_id DROP NOT NULL;/);
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|DROP TABLE|DROP INDEX|CREATE TABLE/i);
});

test("migration loader includes 013 after the existing five migrations", async () => {
  const migrations = await loadTrainingContentMigrationSql();
  assert.equal(migrations.length, 6);
  assert.match(migrations.at(-1) ?? "", /ALTER COLUMN focus_topic_id DROP NOT NULL/);
});

test("active link reads return zero links and always scope by organization", async () => {
  const harness = createHarness({ final: [] });
  assert.deepEqual(await harness.store.listActiveScenarioLinksForContent("org_1", CONTENT_ID), []);
  assert.deepEqual(await harness.store.listActiveScenarioLinksForScenario("org_1", "scenario_a"), []);
  assert.deepEqual(harness.poolQueries.map((query) => query.values), [
    ["org_1", CONTENT_ID],
    ["org_1", "scenario_a"],
  ]);
  for (const query of harness.poolQueries) {
    assert.match(query.text, /org_id = \$1/);
    assert.match(query.text, /removed_at IS NULL/);
  }
});

test("active link reads map nullable Focus Topic and support both directions", async () => {
  const rows = [row("scenario_a"), row("scenario_b")];
  const harness = createHarness({ final: rows });
  const byContent = await harness.store.listActiveScenarioLinksForContent("org_1", CONTENT_ID);
  const byScenario = await harness.store.listActiveScenarioLinksForScenario("org_1", "scenario_a");
  assert.deepEqual(byContent.map((link) => link.scenarioId), ["scenario_a", "scenario_b"]);
  assert.deepEqual(byScenario.map((link) => link.scenarioId), ["scenario_a", "scenario_b"]);
  assert.equal(byContent[0]?.focusTopicId, null);
  assert.match(harness.poolQueries[1]!.text, /scenario_id = \$2/);
});

test("replace [A, B] with [B, C] soft-removes A, leaves B untouched, and restores C", async () => {
  const active = [row("A"), row("B")];
  const final = [row("B"), row("C", { created_by_actor_id: "admin_1", created_at: NOW })];
  const harness = createHarness({ active, final, restored: new Set(["C"]) });
  const result = await harness.store.replaceActiveScenarioLinksForContent({
    orgId: "org_1",
    contentId: CONTENT_ID,
    scenarioIds: ["B", "C"],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
    now: NOW,
  });

  const removal = harness.transactionQueries.find((query) => query.text.includes("SET removed_by_actor_id = $4"));
  assert.deepEqual(removal?.values, ["org_1", CONTENT_ID, [active[0]!.id], "admin_1", NOW]);
  const restoration = harness.transactionQueries.find((query) => query.text.includes("SET focus_topic_id = NULL"));
  assert.deepEqual(restoration?.values, ["org_1", CONTENT_ID, "C", "admin_1", NOW]);
  assert.equal(harness.transactionQueries.some((query) => query.values?.includes("B") && query.text.startsWith("UPDATE")), false);
  assert.deepEqual(result.map((link) => link.scenarioId), ["B", "C"]);
});

test("replace with an empty set soft-removes every active link with actor and timestamp metadata", async () => {
  const active = [row("A"), row("B")];
  const harness = createHarness({ active, final: [] });
  const result = await harness.store.replaceActiveScenarioLinksForContent({
    orgId: "org_1",
    contentId: CONTENT_ID,
    scenarioIds: [],
    actor: { actorType: "platform_admin", actorId: "admin_remove" },
    now: NOW,
  });
  const removal = harness.transactionQueries.find((query) => query.text.includes("SET removed_by_actor_id = $4"));
  assert.deepEqual(removal?.values, ["org_1", CONTENT_ID, active.map((entry) => entry.id), "admin_remove", NOW]);
  assert.deepEqual(result, []);
});

test("creating one direct scenario link inserts NULL focus_topic_id", async () => {
  const harness = createHarness({ final: [row("A")] });
  await harness.store.replaceActiveScenarioLinksForContent({
    orgId: "org_1",
    contentId: CONTENT_ID,
    scenarioIds: ["A"],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
    now: NOW,
  });
  const insertion = harness.transactionQueries.find((query) => query.text.includes("INSERT INTO org_content_scenario_links"));
  assert.ok(insertion);
  assert.match(insertion.text, /VALUES \(\$1, \$2, \$3, NULL, \$4, \$5, \$6\)/);
  assert.deepEqual(insertion.values?.slice(1), ["org_1", CONTENT_ID, "A", "admin_1", NOW]);
});

test("creating many direct links inserts each distinct scenario once", async () => {
  const harness = createHarness({ final: [row("A"), row("B")] });
  await harness.store.replaceActiveScenarioLinksForContent({
    orgId: "org_1",
    contentId: CONTENT_ID,
    scenarioIds: ["A", "B"],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  });
  const inserts = harness.transactionQueries.filter((query) => query.text.includes("INSERT INTO org_content_scenario_links"));
  assert.deepEqual(inserts.map((query) => query.values?.[3]), ["A", "B"]);
});

test("duplicate requested IDs cannot create duplicate active links", async () => {
  const harness = createHarness({ final: [row("A")] });
  await harness.store.replaceActiveScenarioLinksForContent({
    orgId: "org_1",
    contentId: CONTENT_ID,
    scenarioIds: ["A", " A ", "A"],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  });
  assert.equal(
    harness.transactionQueries.filter((query) => query.text.includes("INSERT INTO org_content_scenario_links")).length,
    1
  );
});

test("re-adding a soft-removed link restores history instead of inserting another row", async () => {
  const harness = createHarness({ final: [row("A")], restored: new Set(["A"]) });
  await harness.store.replaceActiveScenarioLinksForContent({
    orgId: "org_1",
    contentId: CONTENT_ID,
    scenarioIds: ["A"],
    actor: { actorType: "platform_admin", actorId: "admin_restore" },
    now: NOW,
  });
  assert.ok(harness.transactionQueries.some((query) => query.text.includes("SET focus_topic_id = NULL")));
  assert.equal(harness.transactionQueries.some((query) => query.text.includes("INSERT INTO org_content_scenario_links")), false);
});

test("replacement rolls back when the organization-scoped Learning Resource does not exist", async () => {
  const harness = createHarness({ contentExists: false });
  await assert.rejects(
    harness.store.replaceActiveScenarioLinksForContent({
      orgId: "org_1",
      contentId: CONTENT_ID,
      scenarioIds: ["A"],
      actor: { actorType: "platform_admin", actorId: "admin_1" },
    }),
    (error: unknown) => error instanceof TrainingContentStoreError
      && error.code === "training_content_not_found"
  );
  assert.ok(harness.transactionQueries.some((query) => query.text.trim() === "ROLLBACK"));
  assert.equal(harness.transactionQueries.some((query) => query.text.includes("INSERT INTO org_content_scenario_links")), false);
});

test("store rejects blank scenario IDs before opening a replacement transaction", async () => {
  const harness = createHarness();
  await assert.rejects(harness.store.replaceActiveScenarioLinksForContent({
    orgId: "org_1",
    contentId: CONTENT_ID,
    scenarioIds: [" "],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  }), /Scenario id is required/);
  assert.equal(harness.transactionQueries.filter((query) => query.text.trim() === "BEGIN").length, 1);
});

test("active link rows expose nullable Focus Topic without changing Learning Resource data", async () => {
  const harness = createHarness({ final: [row("A", { focus_topic_id: null })] });
  const links: TrainingContentScenarioLink[] = await harness.store.listActiveScenarioLinksForContent("org_1", CONTENT_ID);
  assert.equal(links[0]?.focusTopicId, null);
  assert.equal(links[0]?.contentId, CONTENT_ID);
});
