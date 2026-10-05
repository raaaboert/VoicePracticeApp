import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  migrateTrainingPackSchema,
  TRAINING_PACK_DISPLAY_ORDER_CONSTRAINT,
  TRAINING_PACK_SCHEMA_LOCK_TIMEOUT_MS,
} from "./trainingPackMigrations.js";

interface FakeSchemaState {
  tableExists: boolean;
  displayOrderExists: boolean;
  displayOrderNotNull: boolean;
  displayOrderDefaultZero: boolean;
  constraintName: string | null;
  constraintValidated: boolean;
  indexExists: boolean;
  negativeCount: number;
}

function currentState(
  overrides: Partial<FakeSchemaState> = {}
): FakeSchemaState {
  return {
    tableExists: true,
    displayOrderExists: true,
    displayOrderNotNull: true,
    displayOrderDefaultZero: true,
    constraintName: TRAINING_PACK_DISPLAY_ORDER_CONSTRAINT,
    constraintValidated: true,
    indexExists: true,
    negativeCount: 0,
    ...overrides,
  };
}

function createMigrationHarness(
  initial: FakeSchemaState,
  options: { failOn?: RegExp; failCode?: string; advisoryLock?: boolean } = {}
) {
  let state = { ...initial };
  let transactionSnapshot = { ...state };
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      const normalized = text.trim();
      queries.push(normalized);
      if (options.failOn?.test(normalized)) {
        const error = new Error("injected migration failure") as Error & {
          code?: string;
        };
        error.code = options.failCode;
        throw error;
      }
      if (normalized === "BEGIN") {
        transactionSnapshot = { ...state };
        return { rows: [], rowCount: 0 };
      }
      if (normalized === "ROLLBACK") {
        state = { ...transactionSnapshot };
        return { rows: [], rowCount: 0 };
      }
      if (normalized === "COMMIT") {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("pg_try_advisory_xact_lock")) {
        return {
          rows: [{ acquired: options.advisoryLock !== false }],
          rowCount: 1,
        };
      }
      if (normalized.includes("to_regclass('training_packs')")) {
        return { rows: [{ exists: state.tableExists }], rowCount: 1 };
      }
      if (
        normalized.includes("information_schema.columns") &&
        normalized.includes("data_type")
      ) {
        if (!state.tableExists) return { rows: [], rowCount: 0 };
        const rows: Record<string, unknown>[] = [
          column("id", "uuid", true, null),
          column("organization_id", "text", true, null),
          column("created_at", "timestamp with time zone", true, "now()"),
        ];
        if (state.displayOrderExists) {
          rows.push(
            column(
              "display_order",
              "integer",
              state.displayOrderNotNull,
              state.displayOrderDefaultZero ? "0" : null
            )
          );
        }
        return { rows, rowCount: rows.length };
      }
      if (normalized.includes("FROM pg_constraint")) {
        const rows = state.constraintName
          ? [
              {
                constraint_name: state.constraintName,
                definition: "CHECK ((display_order >= 0))",
                validated: state.constraintValidated,
              },
            ]
          : [];
        return { rows, rowCount: rows.length };
      }
      if (normalized.includes("FROM pg_indexes")) {
        const rows = state.indexExists
          ? [
              {
                index_name: "training_packs_org_display_order_idx",
                definition:
                  "CREATE INDEX training_packs_org_display_order_idx ON public.training_packs USING btree (organization_id, display_order, id)",
              },
            ]
          : [];
        return { rows, rowCount: rows.length };
      }
      if (normalized.includes("information_schema.columns")) {
        const names = ["id", "organization_id", "created_at"];
        if (state.displayOrderExists) names.push("display_order");
        return {
          rows: names.map((column_name) => ({ column_name })),
          rowCount: names.length,
        };
      }
      if (normalized.includes("CREATE TABLE IF NOT EXISTS training_packs")) {
        state = currentState();
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("ADD COLUMN display_order INTEGER")) {
        state.displayOrderExists = true;
        state.displayOrderNotNull = false;
        state.displayOrderDefaultZero = false;
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("negative_count")) {
        return {
          rows: [{ negative_count: state.negativeCount }],
          rowCount: 1,
        };
      }
      if (normalized.includes("SET DEFAULT 0")) {
        state.displayOrderDefaultZero = true;
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("SET NOT NULL")) {
        state.displayOrderNotNull = true;
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("ADD CONSTRAINT")) {
        state.constraintName = TRAINING_PACK_DISPLAY_ORDER_CONSTRAINT;
        state.constraintValidated = false;
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("VALIDATE CONSTRAINT")) {
        state.constraintValidated = true;
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("CREATE INDEX")) {
        state.indexExists = true;
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  return {
    pool: pool as any,
    queries,
    state: () => ({ ...state }),
  };
}

function column(
  column_name: string,
  data_type: string,
  notNull: boolean,
  column_default: string | null
) {
  return {
    column_name,
    data_type,
    is_nullable: notNull ? "NO" : "YES",
    column_default,
  };
}

test("fresh Training Pack SQL defines the complete display_order contract", async () => {
  const sql = await readFile(
    new URL("../../sql/002_training_packs.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /display_order INTEGER NOT NULL DEFAULT 0/);
  assert.match(
    sql,
    /CONSTRAINT training_packs_display_order_nonnegative CHECK \(display_order >= 0\)/
  );
  assert.match(
    sql,
    /training_packs_org_display_order_idx[\s\S]*organization_id, display_order, id/
  );
});

test("fresh database migration creates and verifies the target Training Pack schema", async () => {
  const harness = createMigrationHarness(
    currentState({
      tableExists: false,
      displayOrderExists: false,
      displayOrderNotNull: false,
      displayOrderDefaultZero: false,
      constraintName: null,
      constraintValidated: false,
      indexExists: false,
    })
  );

  const result = await migrateTrainingPackSchema(harness.pool);

  assert.equal(result.before.tableExists, false);
  assert.equal(result.after.current, true);
  assert.deepEqual(result.appliedChanges, [
    "created training_packs target schema",
  ]);
  assert(harness.queries.some((query) => query.includes("CREATE TABLE")));
});

test("existing schema without display_order receives a deterministic per-organization backfill", async () => {
  const harness = createMigrationHarness(
    currentState({
      displayOrderExists: false,
      displayOrderNotNull: false,
      displayOrderDefaultZero: false,
      constraintName: null,
      constraintValidated: false,
      indexExists: false,
    })
  );

  const result = await migrateTrainingPackSchema(harness.pool);

  assert.equal(result.after.current, true);
  const backfill = harness.queries.find((query) =>
    query.includes("WITH existing_max")
  );
  assert.match(backfill ?? "", /PARTITION BY packs\."organization_id"/);
  assert.match(backfill ?? "", /ORDER BY "created_at" ASC, "id" ASC/);
  assert.match(backfill ?? "", /WHERE packs\.display_order IS NULL/);
  assert(harness.queries.some((query) => query.includes("SET DEFAULT 0")));
  assert(harness.queries.some((query) => query.includes("SET NOT NULL")));
});

test("existing display_order without its CHECK receives and validates the constraint", async () => {
  const harness = createMigrationHarness(
    currentState({ constraintName: null, constraintValidated: false })
  );

  const result = await migrateTrainingPackSchema(harness.pool);

  assert.equal(result.after.current, true);
  assert(harness.queries.some((query) => query.includes("CHECK (display_order >= 0) NOT VALID")));
  assert(harness.queries.some((query) => query.includes("VALIDATE CONSTRAINT")));
});

test("fully migrated database performs inspection only and executes no migration DDL", async () => {
  const harness = createMigrationHarness(currentState());

  const result = await migrateTrainingPackSchema(harness.pool);

  assert.equal(result.after.current, true);
  assert.deepEqual(result.appliedChanges, []);
  assert.equal(
    harness.queries.some((query) => /^(ALTER|CREATE|UPDATE)/i.test(query)),
    false
  );
});

test("negative existing display_order values fail explicitly and roll back", async () => {
  const initial = currentState({
    constraintName: null,
    constraintValidated: false,
    negativeCount: 1,
  });
  const harness = createMigrationHarness(initial);

  await assert.rejects(
    () => migrateTrainingPackSchema(harness.pool),
    /negative display_order values/
  );

  assert.equal(harness.queries.at(-1), "ROLLBACK");
  assert.deepEqual(harness.state(), initial);
});

test("lock timeout fails explicitly and leaves no half-applied schema state", async () => {
  const initial = currentState({
    displayOrderExists: false,
    displayOrderNotNull: false,
    displayOrderDefaultZero: false,
    constraintName: null,
    constraintValidated: false,
    indexExists: false,
  });
  const harness = createMigrationHarness(initial, {
    failOn: /ADD COLUMN display_order/,
    failCode: "55P03",
  });

  await assert.rejects(
    () => migrateTrainingPackSchema(harness.pool),
    new RegExp(`${TRAINING_PACK_SCHEMA_LOCK_TIMEOUT_MS}ms lock timeout`)
  );

  assert(harness.queries.some((query) => query.includes("SET LOCAL lock_timeout")));
  assert.equal(harness.queries.at(-1), "ROLLBACK");
  assert.deepEqual(harness.state(), initial);
});

test("concurrent explicit migration fails without waiting on an advisory lock", async () => {
  const harness = createMigrationHarness(currentState(), {
    advisoryLock: false,
  });

  await assert.rejects(
    () => migrateTrainingPackSchema(harness.pool),
    /already running/
  );
  assert.equal(harness.queries.at(-1), "ROLLBACK");
});
