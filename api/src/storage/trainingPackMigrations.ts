import { readFile } from "node:fs/promises";

import type { Pool, PoolClient } from "pg";

export const TRAINING_PACK_SCHEMA_LOCK_TIMEOUT_MS = 15_000;
export const TRAINING_PACK_DISPLAY_ORDER_CONSTRAINT =
  "training_packs_display_order_nonnegative";
export const TRAINING_PACK_DISPLAY_ORDER_INDEX =
  "training_packs_org_display_order_idx";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type MigrationPool = Pick<Pool, "connect">;

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface ConstraintRow {
  constraint_name: string;
  definition: string;
  validated: boolean;
}

interface IndexRow {
  index_name: string;
  definition: string;
}

export interface TrainingPackSchemaStatus {
  tableExists: boolean;
  displayOrderExists: boolean;
  displayOrderIsInteger: boolean;
  displayOrderNotNull: boolean;
  displayOrderDefaultZero: boolean;
  nonnegativeConstraintName: string | null;
  nonnegativeConstraintValidated: boolean;
  displayOrderIndexExists: boolean;
  current: boolean;
}

export interface TrainingPackSchemaMigrationResult {
  before: TrainingPackSchemaStatus;
  after: TrainingPackSchemaStatus;
  appliedChanges: string[];
}

export async function inspectTrainingPackSchema(
  queryable: Queryable
): Promise<TrainingPackSchemaStatus> {
  const tableResult = await queryable.query<{ exists: boolean }>(
    "SELECT to_regclass('training_packs') IS NOT NULL AS exists"
  );
  const tableExists = tableResult.rows[0]?.exists === true;
  if (!tableExists) {
    return emptyStatus();
  }

  const [columnsResult, constraintsResult, indexesResult] = await Promise.all([
    queryable.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = ANY(current_schemas(false))
         AND table_name = 'training_packs'`
    ),
    queryable.query<ConstraintRow>(
      `SELECT conname AS constraint_name,
              pg_get_constraintdef(oid, true) AS definition,
              convalidated AS validated
       FROM pg_constraint
       WHERE conrelid = 'training_packs'::regclass
         AND contype = 'c'`
    ),
    queryable.query<IndexRow>(
      `SELECT indexname AS index_name, indexdef AS definition
       FROM pg_indexes
       WHERE schemaname = ANY(current_schemas(false))
         AND tablename = 'training_packs'`
    ),
  ]);

  const displayOrder = columnsResult.rows.find(
    (row) => row.column_name === "display_order"
  );
  const constraint = constraintsResult.rows.find((row) =>
    isDisplayOrderNonnegativeCheck(row.definition)
  );
  const index = indexesResult.rows.find(
    (row) =>
      row.index_name === TRAINING_PACK_DISPLAY_ORDER_INDEX &&
      isDisplayOrderIndex(row.definition)
  );
  const status: TrainingPackSchemaStatus = {
    tableExists: true,
    displayOrderExists: Boolean(displayOrder),
    displayOrderIsInteger: displayOrder?.data_type === "integer",
    displayOrderNotNull: displayOrder?.is_nullable === "NO",
    displayOrderDefaultZero: hasZeroDefault(displayOrder?.column_default ?? null),
    nonnegativeConstraintName: constraint?.constraint_name ?? null,
    nonnegativeConstraintValidated: constraint?.validated === true,
    displayOrderIndexExists: Boolean(index),
    current: false,
  };
  status.current = isCurrentTrainingPackSchema(status);
  return status;
}

export async function assertTrainingPackSchemaReady(
  queryable: Queryable
): Promise<void> {
  const status = await inspectTrainingPackSchema(queryable);
  if (status.current) {
    return;
  }
  throw new Error(
    "training_packs schema is not ready. Run the explicit db:migrate-training-packs command before starting the API."
  );
}

export async function migrateTrainingPackSchema(
  pool: MigrationPool
): Promise<TrainingPackSchemaMigrationResult> {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      `SET LOCAL lock_timeout = '${TRAINING_PACK_SCHEMA_LOCK_TIMEOUT_MS}ms'`
    );
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('peritio_training_pack_schema_v1', 0)) AS acquired"
    );
    if (lockResult.rows[0]?.acquired !== true) {
      throw new Error(
        "Another Training Pack schema migration is already running. Retry after it completes."
      );
    }

    const before = await inspectTrainingPackSchema(client);
    const appliedChanges: string[] = [];
    if (!before.tableExists) {
      await client.query(await loadTrainingPackSchemaSql());
      appliedChanges.push("created training_packs target schema");
    } else if (!before.current) {
      await migrateExistingTable(client, before, appliedChanges);
    }

    const after = await inspectTrainingPackSchema(client);
    if (!after.current) {
      throw new Error(
        "Training Pack schema verification failed after migration; the transaction will be rolled back."
      );
    }
    await client.query("COMMIT");
    return { before, after, appliedChanges };
  } catch (error) {
    if (transactionStarted) {
      await rollbackQuietly(client);
    }
    throw migrationError(error);
  } finally {
    client.release();
  }
}

async function migrateExistingTable(
  client: Pick<PoolClient, "query">,
  initialStatus: TrainingPackSchemaStatus,
  appliedChanges: string[]
): Promise<void> {
  const columns = await loadColumnNames(client);
  const idColumn = pickMigrationColumn(columns, ["id"], "id");
  const orgColumn = pickMigrationColumn(
    columns,
    ["organization_id", "org_id"],
    "organization id"
  );
  const createdColumn = pickOptionalMigrationColumn(columns, [
    "created_at",
    "createdat",
  ]);

  let status = initialStatus;
  if (!status.displayOrderExists) {
    await client.query(
      "ALTER TABLE training_packs ADD COLUMN display_order INTEGER"
    );
    appliedChanges.push("added display_order column");
    status = {
      ...status,
      displayOrderExists: true,
      displayOrderIsInteger: true,
    };
  } else if (!status.displayOrderIsInteger) {
    throw new Error(
      "training_packs.display_order exists but is not an integer column; manual review is required."
    );
  }

  const negativeResult = await client.query<{ negative_count: string | number }>(
    "SELECT COUNT(*) AS negative_count FROM training_packs WHERE display_order < 0"
  );
  if (Number(negativeResult.rows[0]?.negative_count ?? 0) > 0) {
    throw new Error(
      "training_packs contains negative display_order values; correct them explicitly before retrying the migration."
    );
  }

  if (!status.displayOrderNotNull) {
    const stableOrder = createdColumn
      ? `${quoteIdentifier(createdColumn)} ASC, ${quoteIdentifier(idColumn)} ASC`
      : `${quoteIdentifier(idColumn)} ASC`;
    await client.query(`
      WITH existing_max AS (
        SELECT ${quoteIdentifier(orgColumn)} AS organization_key,
               COALESCE(MAX(display_order) FILTER (WHERE display_order IS NOT NULL), -1) AS max_order
        FROM training_packs
        GROUP BY ${quoteIdentifier(orgColumn)}
      ), ranked AS (
        SELECT packs.${quoteIdentifier(idColumn)} AS pack_id,
               existing_max.max_order + ROW_NUMBER() OVER (
                 PARTITION BY packs.${quoteIdentifier(orgColumn)}
                 ORDER BY ${stableOrder}
               ) AS next_order
        FROM training_packs AS packs
        JOIN existing_max
          ON existing_max.organization_key = packs.${quoteIdentifier(orgColumn)}
        WHERE packs.display_order IS NULL
      )
      UPDATE training_packs AS packs
      SET display_order = ranked.next_order
      FROM ranked
      WHERE packs.${quoteIdentifier(idColumn)} = ranked.pack_id
    `);
    appliedChanges.push("backfilled null display_order values");
  }

  if (!status.displayOrderDefaultZero) {
    await client.query(
      "ALTER TABLE training_packs ALTER COLUMN display_order SET DEFAULT 0"
    );
    appliedChanges.push("set display_order default");
  }
  if (!status.displayOrderNotNull) {
    await client.query(
      "ALTER TABLE training_packs ALTER COLUMN display_order SET NOT NULL"
    );
    appliedChanges.push("set display_order not null");
  }

  if (!status.nonnegativeConstraintName) {
    await client.query(
      `ALTER TABLE training_packs
       ADD CONSTRAINT ${quoteIdentifier(TRAINING_PACK_DISPLAY_ORDER_CONSTRAINT)}
       CHECK (display_order >= 0) NOT VALID`
    );
    appliedChanges.push("added display_order nonnegative constraint");
    await client.query(
      `ALTER TABLE training_packs
       VALIDATE CONSTRAINT ${quoteIdentifier(TRAINING_PACK_DISPLAY_ORDER_CONSTRAINT)}`
    );
    appliedChanges.push("validated display_order nonnegative constraint");
  } else if (!status.nonnegativeConstraintValidated) {
    await client.query(
      `ALTER TABLE training_packs
       VALIDATE CONSTRAINT ${quoteIdentifier(status.nonnegativeConstraintName)}`
    );
    appliedChanges.push("validated display_order nonnegative constraint");
  }

  if (!status.displayOrderIndexExists) {
    await client.query(
      `CREATE INDEX ${quoteIdentifier(TRAINING_PACK_DISPLAY_ORDER_INDEX)}
       ON training_packs (${quoteIdentifier(orgColumn)}, display_order, ${quoteIdentifier(idColumn)})`
    );
    appliedChanges.push("created display_order index");
  }
}

async function loadColumnNames(
  queryable: Queryable
): Promise<Set<string>> {
  const result = await queryable.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = ANY(current_schemas(false))
       AND table_name = 'training_packs'`
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function loadTrainingPackSchemaSql(): Promise<string> {
  const candidates = [
    new URL("../../sql/002_training_packs.sql", import.meta.url),
    new URL("../sql/002_training_packs.sql", import.meta.url),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    "Training Pack schema migration SQL is missing from the runtime artifact.",
    { cause: lastError }
  );
}

function emptyStatus(): TrainingPackSchemaStatus {
  return {
    tableExists: false,
    displayOrderExists: false,
    displayOrderIsInteger: false,
    displayOrderNotNull: false,
    displayOrderDefaultZero: false,
    nonnegativeConstraintName: null,
    nonnegativeConstraintValidated: false,
    displayOrderIndexExists: false,
    current: false,
  };
}

function isCurrentTrainingPackSchema(
  status: TrainingPackSchemaStatus
): boolean {
  return (
    status.tableExists &&
    status.displayOrderExists &&
    status.displayOrderIsInteger &&
    status.displayOrderNotNull &&
    status.displayOrderDefaultZero &&
    Boolean(status.nonnegativeConstraintName) &&
    status.nonnegativeConstraintValidated &&
    status.displayOrderIndexExists
  );
}

function hasZeroDefault(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return /^(?:0|0::integer|'0'::integer)$/.test(
    value.replace(/[\s()]/g, "").toLowerCase()
  );
}

function isDisplayOrderNonnegativeCheck(definition: string): boolean {
  const normalized = definition
    .replace(/[\s"()]/g, "")
    .toLowerCase();
  return normalized === "checkdisplay_order>=0";
}

function isDisplayOrderIndex(definition: string): boolean {
  const normalized = definition.replace(/[\s"]/g, "").toLowerCase();
  return (
    normalized.includes("training_packs") &&
    (normalized.endsWith(
      "usingbtree(organization_id,display_order,id)"
    ) ||
      normalized.endsWith("usingbtree(org_id,display_order,id)"))
  );
}

function pickMigrationColumn(
  columns: Set<string>,
  candidates: string[],
  label: string
): string {
  const matches = candidates.filter((candidate) => columns.has(candidate));
  if (matches.length !== 1) {
    throw new Error(
      `training_packs schema requires exactly one ${label} column before migration.`
    );
  }
  return matches[0]!;
}

function pickOptionalMigrationColumn(
  columns: Set<string>,
  candidates: string[]
): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Invalid SQL identifier "${value}".`);
  }
  return `"${value}"`;
}

function migrationError(error: unknown): Error {
  const code = (error as { code?: string } | null)?.code;
  if (code === "55P03") {
    return new Error(
      `Training Pack schema migration exceeded the ${TRAINING_PACK_SCHEMA_LOCK_TIMEOUT_MS}ms lock timeout; no schema changes were committed.`,
      { cause: error }
    );
  }
  if (error instanceof Error) {
    return new Error(
      `Training Pack schema migration failed: ${error.message}`,
      { cause: error }
    );
  }
  return new Error("Training Pack schema migration failed.", { cause: error });
}

async function rollbackQuietly(
  client: Pick<PoolClient, "query">
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the migration error that caused the rollback.
  }
}
