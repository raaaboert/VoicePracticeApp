import "dotenv/config";

import { Pool, PoolClient } from "pg";

import type { ApiDatabase } from "@voicepractice/shared";
import {
  databaseUrlLooksProduction,
  databaseUrlLooksStaging,
  describeDatabaseUrl,
  OPERATIONAL_TABLES,
  parseSanitizerProfile,
  sanitizeAppState,
  type SanitizerProfile
} from "../src/dbSanitizer.js";

const APP_STATE_ROW_ID = "primary";

interface ParsedArgs {
  databaseUrl: string;
  profile: SanitizerProfile;
  apply: boolean;
}

interface TableCountReport {
  exists: boolean;
  before: number;
  after: number;
  deleted: number;
  orgColumn?: string;
}

interface SanitizerCliReport {
  mode: "dry-run" | "apply";
  target: ReturnType<typeof describeDatabaseUrl>;
  profile: SanitizerProfile;
  appState: ReturnType<typeof sanitizeAppState>["report"];
  tables: Record<string, TableCountReport>;
  warnings: string[];
}

function printHelp(): void {
  console.log(`
Usage:
  npm run db:sanitize-bootstrap -- --database-url "<database-url>" --profile prod-bootstrap
  npm run db:sanitize-bootstrap -- --database-url "<database-url>" --profile staging-refresh

Options:
  --database-url <url>   Required. Explicit target database URL.
  --profile <profile>    Required. prod-bootstrap or staging-refresh.
  --apply                Optional. Defaults to dry-run when omitted.
  --help                 Print this help.
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
      continue;
    }

    values.set(key, next);
    index += 1;
  }

  const databaseUrl = String(values.get("database-url") ?? "").trim();
  if (!databaseUrl) {
    throw new Error("Missing required --database-url.");
  }

  return {
    databaseUrl,
    profile: parseSanitizerProfile(String(values.get("profile") ?? "")),
    apply: values.get("apply") === true
  };
}

function assertProfileTargetSafety(args: ParsedArgs): void {
  if (args.profile === "prod-bootstrap" && databaseUrlLooksStaging(args.databaseUrl)) {
    throw new Error(
      "Refusing prod-bootstrap directly against the known staging database. Restore staging to a scratch/prod target first."
    );
  }

  if (args.profile === "staging-refresh" && databaseUrlLooksProduction(args.databaseUrl)) {
    throw new Error("Refusing staging-refresh against the known production database.");
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Invalid SQL identifier "${value}".`);
  }
  return `"${value}"`;
}

async function tableExists(client: Pick<Pool, "query"> | Pick<PoolClient, "query">, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [tableName]
  );
  return result.rows[0]?.exists === true;
}

async function countRows(client: Pick<Pool, "query"> | Pick<PoolClient, "query">, tableName: string): Promise<number> {
  const result = await client.query<{ row_count: string }>(
    `SELECT COUNT(*)::text AS row_count FROM ${quoteIdentifier(tableName)}`
  );
  return Number(result.rows[0]?.row_count ?? 0) || 0;
}

async function countRowsForRemovedOrgs(params: {
  client: Pick<Pool, "query"> | Pick<PoolClient, "query">;
  tableName: string;
  orgColumn: string;
  removedOrgIds: string[];
}): Promise<number> {
  if (params.removedOrgIds.length === 0) {
    return 0;
  }

  const result = await params.client.query<{ row_count: string }>(
    `
      SELECT COUNT(*)::text AS row_count
      FROM ${quoteIdentifier(params.tableName)}
      WHERE ${quoteIdentifier(params.orgColumn)} = ANY($1::text[])
    `,
    [params.removedOrgIds]
  );
  return Number(result.rows[0]?.row_count ?? 0) || 0;
}

async function resolveTrainingPackOrgColumn(
  client: Pick<Pool, "query"> | Pick<PoolClient, "query">
): Promise<string | null> {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ANY(current_schemas(false))
        AND table_name = 'training_packs'
        AND column_name = ANY($1::text[])
    `,
    [["organization_id", "org_id"]]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  if (columns.has("organization_id")) {
    return "organization_id";
  }
  if (columns.has("org_id")) {
    return "org_id";
  }
  return null;
}

async function loadAppState(pool: Pool): Promise<ApiDatabase> {
  const result = await pool.query<{ state_json: unknown }>(
    "SELECT state_json FROM app_state WHERE id = $1 LIMIT 1",
    [APP_STATE_ROW_ID]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("app_state primary row was not found. Restore or initialize app_state before sanitizing.");
  }

  return row.state_json as ApiDatabase;
}

async function buildTableReport(params: {
  pool: Pool;
  removedOrgIds: string[];
}): Promise<Record<string, TableCountReport>> {
  const report: Record<string, TableCountReport> = {};

  for (const tableName of OPERATIONAL_TABLES) {
    const exists = await tableExists(params.pool, tableName);
    const before = exists ? await countRows(params.pool, tableName) : 0;
    report[tableName] = {
      exists,
      before,
      after: exists ? 0 : 0,
      deleted: before
    };
  }

  const trainingPacksExists = await tableExists(params.pool, "training_packs");
  const trainingPackCount = trainingPacksExists ? await countRows(params.pool, "training_packs") : 0;
  const trainingPackOrgColumn = trainingPacksExists ? await resolveTrainingPackOrgColumn(params.pool) : null;
  const removedTrainingPackCount = trainingPacksExists && trainingPackOrgColumn
    ? await countRowsForRemovedOrgs({
        client: params.pool,
        tableName: "training_packs",
        orgColumn: trainingPackOrgColumn,
        removedOrgIds: params.removedOrgIds
      })
    : 0;

  report.training_packs = {
    exists: trainingPacksExists,
    before: trainingPackCount,
    after: Math.max(0, trainingPackCount - removedTrainingPackCount),
    deleted: removedTrainingPackCount,
    orgColumn: trainingPackOrgColumn ?? undefined
  };

  return report;
}

async function applySanitization(params: {
  pool: Pool;
  sanitizedAppState: ApiDatabase;
  tables: Record<string, TableCountReport>;
  removedOrgIds: string[];
}): Promise<void> {
  const client = await params.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE app_state
        SET state_json = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [APP_STATE_ROW_ID, JSON.stringify(params.sanitizedAppState)]
    );

    for (const tableName of OPERATIONAL_TABLES) {
      const tableReport = params.tables[tableName];
      if (!tableReport?.exists || tableReport.before === 0) {
        continue;
      }
      await client.query(`DELETE FROM ${quoteIdentifier(tableName)}`);
    }

    const trainingPacksReport = params.tables.training_packs;
    if (trainingPacksReport?.exists && trainingPacksReport.orgColumn && params.removedOrgIds.length > 0) {
      await client.query(
        `
          DELETE FROM training_packs
          WHERE ${quoteIdentifier(trainingPacksReport.orgColumn)} = ANY($1::text[])
        `,
        [params.removedOrgIds]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  assertProfileTargetSafety(args);

  const pool = new Pool({ connectionString: args.databaseUrl });
  try {
    const appState = await loadAppState(pool);
    const { sanitized, report: appStateReport } = sanitizeAppState(appState, args.profile);
    const tables = await buildTableReport({
      pool,
      removedOrgIds: appStateReport.removedOrgIds
    });
    const warnings = [
      ...appStateReport.warnings,
      ...(tables.training_packs?.exists && appStateReport.removedOrgIds.length > 0 && !tables.training_packs.orgColumn
        ? ["training_packs exists but no organization_id/org_id column was found; demo-org training packs require manual review."]
        : []),
      ...(args.apply
        ? []
        : ["Dry-run only. Re-run with --apply after reviewing this inventory report to make changes."])
    ];
    const report: SanitizerCliReport = {
      mode: args.apply ? "apply" : "dry-run",
      target: describeDatabaseUrl(args.databaseUrl),
      profile: args.profile,
      appState: appStateReport,
      tables,
      warnings
    };

    console.log(JSON.stringify(report, null, 2));

    if (args.apply) {
      await applySanitization({
        pool,
        sanitizedAppState: sanitized,
        tables,
        removedOrgIds: appStateReport.removedOrgIds
      });
      console.log("[db:sanitize-bootstrap] applied successfully");
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[db:sanitize-bootstrap] failed: ${message}`);
  process.exitCode = 1;
});
