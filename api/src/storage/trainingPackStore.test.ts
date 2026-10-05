import assert from "node:assert/strict";
import test from "node:test";

import {
  createTrainingPackStore,
  getTrainingPackOrderRevision,
  TrainingPackOrderError,
  validateTrainingPackOrder,
} from "./trainingPackStore.js";

function currentSchemaInspectionResult(text: string, columns: string[]) {
  if (text.includes("to_regclass('training_packs')")) {
    return { rows: [{ exists: true }], rowCount: 1 };
  }
  if (text.includes("information_schema.columns") && text.includes("data_type")) {
    const rows = columns.map((column_name) => ({
      column_name,
      data_type: column_name === "display_order" ? "integer" : "text",
      is_nullable: "NO",
      column_default: column_name === "display_order" ? "0" : null,
    }));
    return { rows, rowCount: rows.length };
  }
  if (text.includes("FROM pg_constraint")) {
    return {
      rows: [{
        constraint_name: "training_packs_display_order_nonnegative",
        definition: "CHECK ((display_order >= 0))",
        validated: true,
      }],
      rowCount: 1,
    };
  }
  if (text.includes("FROM pg_indexes")) {
    return {
      rows: [{
        index_name: "training_packs_org_display_order_idx",
        definition:
          "CREATE INDEX training_packs_org_display_order_idx ON training_packs USING btree (organization_id, display_order, id)",
      }],
      rowCount: 1,
    };
  }
  return null;
}

test("training pack store verifies a current schema without executing migration DDL", async () => {
  const queries: string[] = [];
  const columns = [
    "id",
    "organization_id",
    "title",
    "training_topic",
    "learning_objectives",
    "success_behaviors",
    "failure_patterns",
    "required_behavioral_triggers",
    "scoring_weight_overrides",
    "compliance_constraints",
    "audience_level",
    "active",
    "display_order",
    "created_at",
    "updated_at"
  ];

  const queryPool = {
    async query(text: string) {
      queries.push(text);
      const schemaResult = currentSchemaInspectionResult(text, columns);
      if (schemaResult) return schemaResult;
      if (text.includes("information_schema.columns")) {
        return { rows: columns.map((column_name) => ({ column_name })), rowCount: columns.length };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      throw new Error("connect should not be used during initialize.");
    }
  };

  const warnings: string[] = [];
  const store = createTrainingPackStore({
    provider: "postgres",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
    logWarn: (message) => warnings.push(message)
  });

  await store.initialize();

  assert.equal(queries.some((query) => /\b(?:ALTER|CREATE|UPDATE)\b/.test(query)), false);
  assert(warnings.some((message) => message.includes("[training-pack] resolved schema mapping")));
});

test("training pack store fails startup explicitly when the schema migration is missing", async () => {
  const queries: string[] = [];
  const store = createTrainingPackStore({
    provider: "postgres",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: {
      async query(text: string) {
        queries.push(text);
        return { rows: [{ exists: false }], rowCount: 1 };
      },
      async connect() { throw new Error("connect should not be used during initialize."); },
    } as any,
  });

  await assert.rejects(() => store.initialize(), /db:migrate-training-packs/);
  assert.equal(queries.some((query) => /\b(?:ALTER|CREATE|UPDATE)\b/.test(query)), false);
});

test("training pack order requires the complete same-organization list and a current revision", () => {
  const current = [
    { id: "pack-a", displayOrder: 0 },
    { id: "pack-b", displayOrder: 1 },
    { id: "pack-c", displayOrder: 2 },
  ];
  const revision = getTrainingPackOrderRevision(current);

  assert.deepEqual(validateTrainingPackOrder(current, ["pack-c", "pack-a", "pack-b"], revision), [
    "pack-c",
    "pack-a",
    "pack-b",
  ]);
  for (const invalid of [
    ["pack-a", "pack-a", "pack-c"],
    ["pack-a", "pack-b"],
    ["pack-a", "pack-b", "other"],
  ]) {
    assert.throws(
      () => validateTrainingPackOrder(current, invalid, revision),
      (error: unknown) => error instanceof TrainingPackOrderError && error.code === "training_pack_order_invalid"
    );
  }
  assert.throws(
    () => validateTrainingPackOrder(current, ["pack-a", "pack-b", "pack-c"], "stale"),
    (error: unknown) => error instanceof TrainingPackOrderError && error.code === "training_pack_order_conflict"
  );
});

test("authoritative Training Pack reads retain internal configuration fields", async () => {
  const columns = [
    "id", "organization_id", "title", "training_topic", "learning_objectives",
    "success_behaviors", "failure_patterns", "required_behavioral_triggers",
    "scoring_weight_overrides", "compliance_constraints", "audience_level",
    "active", "display_order", "created_at", "updated_at",
  ];
  const row = {
    id: "pack-internal",
    organization_id: "org-a",
    title: "Internal Pack",
    training_topic: "Internal topic",
    learning_objectives: ["Internal objective"],
    success_behaviors: ["Internal success"],
    failure_patterns: ["Internal failure"],
    required_behavioral_triggers: ["scenario:internal"],
    scoring_weight_overrides: { persuasion: 0.7 },
    compliance_constraints: "Internal compliance rule",
    audience_level: "Internal audience",
    active: true,
    display_order: 2,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
  };
  const queryPool = {
    async query(text: string) {
      const schemaResult = currentSchemaInspectionResult(text, columns);
      if (schemaResult) return schemaResult;
      if (text.includes("information_schema.columns")) {
        return { rows: columns.map((column_name) => ({ column_name })), rowCount: columns.length };
      }
      if (text.includes("SELECT * FROM training_packs")) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    async connect() { throw new Error("connect should not be used for reads."); },
  };
  const store = createTrainingPackStore({
    provider: "postgres", databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1, pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });

  const [pack] = await store.listTrainingPacksForOrgInCompanyOrder("org-a");

  assert.deepEqual(pack, {
    id: "pack-internal",
    organizationId: "org-a",
    title: "Internal Pack",
    trainingTopic: "Internal topic",
    learningObjectives: ["Internal objective"],
    successBehaviors: ["Internal success"],
    failurePatterns: ["Internal failure"],
    requiredBehavioralTriggers: ["scenario:internal"],
    scoringWeightOverrides: { persuasion: 0.7 },
    complianceConstraints: "Internal compliance rule",
    audienceLevel: "Internal audience",
    active: true,
    displayOrder: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  });
});

test("current training pack schema initialization is inspection-only", async () => {
  const queries: string[] = [];
  const columns = [
    "id", "organization_id", "title", "training_topic", "required_behavioral_triggers",
    "active", "display_order", "created_at", "updated_at",
  ];
  const queryPool = {
    async query(text: string) {
      queries.push(text);
      const schemaResult = currentSchemaInspectionResult(text, columns);
      if (schemaResult) return schemaResult;
      if (text.includes("information_schema.columns")) {
        return { rows: columns.map((column_name) => ({ column_name })), rowCount: columns.length };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() { throw new Error("connect should not be used during initialize."); },
  };
  const store = createTrainingPackStore({
    provider: "postgres",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });

  await store.initialize();

  assert.equal(queries.some((query) => /\b(?:ALTER|CREATE|UPDATE)\b/.test(query)), false);
});

test("new Training Packs append under the organization lock without changing delivery semantics", async () => {
  const poolQueries: string[] = [];
  const transactionQueries: string[] = [];
  const columns = [
    "id", "organization_id", "title", "training_topic", "required_behavioral_triggers",
    "active", "display_order",
  ];
  const client = {
    async query(text: string, values: unknown[] = []) {
      transactionQueries.push(text);
      if (text.includes("COALESCE(MAX")) return { rows: [{ next_order: 4 }], rowCount: 1 };
      if (text.includes("INSERT INTO training_packs")) {
        return {
          rows: [{
            id: values[0], organization_id: values[1], title: values[2], training_topic: values[3],
            required_behavioral_triggers: values[4], active: values[5], display_order: values[6],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const queryPool = {
    async query(text: string) {
      poolQueries.push(text);
      const schemaResult = currentSchemaInspectionResult(text, columns);
      if (schemaResult) return schemaResult;
      if (text.includes("information_schema.columns")) {
        return { rows: columns.map((column_name) => ({ column_name })), rowCount: columns.length };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() { return client; },
  };
  const store = createTrainingPackStore({
    provider: "postgres", databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1, pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });

  const created = await store.createTrainingPackForOrg("org-a", {
    title: "Pack E", trainingTopic: "Topic", requiredBehavioralTriggers: [], active: false,
  });

  assert.equal(created.displayOrder, 4);
  assert(transactionQueries.some((query) => query.includes("pg_advisory_xact_lock")));
  assert(transactionQueries.some((query) => query.includes("COALESCE(MAX")));
  assert.equal(transactionQueries.at(0), "BEGIN");
  assert.equal(transactionQueries.at(-1), "COMMIT");
  assert.equal(poolQueries.some((query) => /\b(?:ALTER|CREATE|UPDATE)\b/.test(query)), false);
});

test("Training Pack reorder persists one complete revision-guarded transaction", async () => {
  const columns = [
    "id", "organization_id", "title", "training_topic", "required_behavioral_triggers",
    "active", "display_order",
  ];
  let rows = [
    { id: "pack-a", organization_id: "org-a", title: "A", training_topic: "A", required_behavioral_triggers: [], active: true, display_order: 0 },
    { id: "pack-b", organization_id: "org-a", title: "B", training_topic: "B", required_behavioral_triggers: [], active: false, display_order: 1 },
    { id: "pack-c", organization_id: "org-a", title: "C", training_topic: "C", required_behavioral_triggers: [], active: false, display_order: 2 },
  ];
  const transactionQueries: string[] = [];
  let snapshot = rows.map((row) => ({ ...row }));
  const client = {
    async query(text: string, values: unknown[] = []) {
      transactionQueries.push(text);
      if (text === "BEGIN") snapshot = rows.map((row) => ({ ...row }));
      if (text === "ROLLBACK") rows = snapshot.map((row) => ({ ...row }));
      if (text.includes("SELECT * FROM training_packs")) {
        return { rows: rows.slice().sort((a, b) => a.display_order - b.display_order), rowCount: rows.length };
      }
      if (text.includes("UPDATE training_packs SET \"display_order\"")) {
        const row = rows.find((entry) => entry.organization_id === values[1] && entry.id === values[2]);
        if (row) row.display_order = Number(values[0]);
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const queryPool = {
    async query(text: string) {
      const schemaResult = currentSchemaInspectionResult(text, columns);
      if (schemaResult) return schemaResult;
      if (text.includes("information_schema.columns")) {
        return { rows: columns.map((column_name) => ({ column_name })), rowCount: columns.length };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() { return client; },
  };
  const store = createTrainingPackStore({
    provider: "postgres", databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1, pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });
  const revision = getTrainingPackOrderRevision([
    { id: "pack-a", displayOrder: 0 }, { id: "pack-b", displayOrder: 1 }, { id: "pack-c", displayOrder: 2 },
  ]);

  const result = await store.reorderTrainingPacksForOrg("org-a", ["pack-c", "pack-a", "pack-b"], revision);

  assert.deepEqual(result.trainingPacks.map((pack) => pack.id), ["pack-c", "pack-a", "pack-b"]);
  assert.deepEqual(rows.slice().sort((a, b) => a.display_order - b.display_order).map((row) => row.id), ["pack-c", "pack-a", "pack-b"]);
  assert.equal(transactionQueries.filter((query) => query.includes("UPDATE training_packs SET")).length, 3);
  assert(transactionQueries.some((query) => query.includes("FOR UPDATE")));
  assert(transactionQueries.some((query) => query.includes("pg_advisory_xact_lock")));
  assert.equal(transactionQueries.at(-1), "COMMIT");
});
