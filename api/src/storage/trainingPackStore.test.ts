import assert from "node:assert/strict";
import test from "node:test";

import { createTrainingPackStore } from "./trainingPackStore.js";

test("training pack store initializes schema and resolves mapping against a clean postgres database", async () => {
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
    "created_at",
    "updated_at"
  ];

  const queryPool = {
    async query(text: string) {
      queries.push(text);
      if (text.includes("to_regclass('training_packs')")) {
        return { rows: [{ exists: false }], rowCount: 1 };
      }
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

  assert(queries.some((query) => query.includes("CREATE TABLE IF NOT EXISTS training_packs")));
  assert(queries.some((query) => query.includes("CREATE UNIQUE INDEX IF NOT EXISTS training_packs_one_active_per_org_idx")));
  assert(warnings.some((message) => message.includes("[training-pack] resolved schema mapping")));
});
