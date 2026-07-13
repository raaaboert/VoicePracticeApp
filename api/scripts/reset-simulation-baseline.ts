import "dotenv/config";

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { Pool } from "pg";

import type { ApiDatabase } from "@voicepractice/shared";

import { createAiUsageEventAccess } from "../src/services/aiUsageEvents.js";
import {
  inspectDisposableSimulationHistory,
  resetDisposablePreTesterHistory
} from "../src/services/integrityMaintenance.js";
import {
  assertProductionWriteAllowed,
  inferDatabaseTargetEnvironment,
  parseScriptTarget,
  type ScriptTargetEnvironment
} from "../src/productionSafety.js";
import { createScoreRecordAccess } from "../src/services/scoreRecordAccess.js";
import { createUsageSessionAccess } from "../src/services/usageSessionAccess.js";
import type { StorageProvider } from "../src/runtimeConfig.js";
import { createAiUsageEventStore } from "../src/storage/aiUsageEventStore.js";
import { createScoreRecordStore } from "../src/storage/scoreRecordStore.js";
import { createSimulationSessionStore } from "../src/storage/simulationSessionStore.js";
import { createSupportCaseStore } from "../src/storage/supportCaseStore.js";
import { createTrainingPackStore } from "../src/storage/trainingPackStore.js";
import { createUsageSessionStore } from "../src/storage/usageSessionStore.js";

const APP_STATE_ROW_ID = "primary";

interface ScriptStorageTarget {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface PreservedStateSummary {
  users: number;
  orgs: number;
  industries: number;
  standardScenarios: number;
  customScenarios: number;
  trainingPacks: number | null;
  orgTrainings: number;
  trainingPackAssignments: number;
  orgTrainingPackAttachments: number;
  orgTrainingScenarioAttachments: number;
  mobileAuthTokens: number;
  emailVerifications: number;
  webAuthChallenges: number;
  legacyWebAuthSessions: number;
  enterpriseJoinRequests: number;
  adminActiveSessions: number;
}

interface ScriptRuntimeConfig {
  storageProvider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface ScriptCliOptions {
  target: ScriptTargetEnvironment | null;
  confirmProduction: string | null;
  dryRun: boolean;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildSidecarPath(dbPath: string, suffix: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.${suffix}${extension}`);
}

async function readJsonArrayCount(params: {
  filePath: string;
  key: string;
}): Promise<number> {
  try {
    const raw = await readFile(params.filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return countArray(parsed[params.key]);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function countPostgresRowsIfTableExists(pool: Pool, tableName: string): Promise<number> {
  const existsResult = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [tableName]
  );
  if (!existsResult.rows[0]?.exists) {
    return 0;
  }

  const result = await pool.query<{ row_count: string }>(
    `SELECT COUNT(*)::text AS row_count FROM ${tableName}`
  );
  return Number(result.rows[0]?.row_count ?? 0) || 0;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function readArgValue(name: string): string | null {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }

  return value;
}

function loadScriptCliOptions(): ScriptCliOptions {
  return {
    target: parseScriptTarget(readArgValue("target")),
    confirmProduction: readArgValue("confirm-production"),
    dryRun: process.argv.includes("--dry-run")
  };
}

function loadScriptRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ScriptRuntimeConfig {
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const candidate = env.STORAGE_PROVIDER?.trim().toLowerCase();
  const storageProvider: StorageProvider =
    candidate === "postgres"
      ? "postgres"
      : candidate === "file"
        ? "file"
        : databaseUrl
          ? "postgres"
          : "file";

  return {
    storageProvider,
    dbPath: path.resolve(process.cwd(), env.DB_PATH ?? "./db.local.json"),
    databaseUrl,
    pgPoolMax: parsePositiveInt(env.PG_POOL_MAX, 5),
    pgConnectTimeoutMs: parsePositiveInt(env.PG_CONNECT_TIMEOUT_MS, 8000),
    pgIdleTimeoutMs: parsePositiveInt(env.PG_IDLE_TIMEOUT_MS, 30000)
  };
}

function resolveStorageTarget(runtimeConfig: ScriptRuntimeConfig): ScriptStorageTarget {
  const forceLocalFile = process.argv.includes("--local-file");
  const allowPostgres = process.argv.includes("--allow-postgres");

  if (forceLocalFile) {
    return {
      provider: "file",
      dbPath: path.resolve(process.cwd(), process.env.DB_PATH ?? "./db.local.json"),
      databaseUrl: null,
      pgPoolMax: runtimeConfig.pgPoolMax,
      pgConnectTimeoutMs: runtimeConfig.pgConnectTimeoutMs,
      pgIdleTimeoutMs: runtimeConfig.pgIdleTimeoutMs
    };
  }

  if (runtimeConfig.storageProvider === "postgres" && !allowPostgres) {
    throw new Error(
      "reset-simulation-baseline detected STORAGE_PROVIDER=postgres. Re-run with --allow-postgres after confirming you intend to clear simulation-derived history in the active database."
    );
  }

  return {
    provider: runtimeConfig.storageProvider,
    dbPath: runtimeConfig.dbPath,
    databaseUrl: runtimeConfig.databaseUrl,
    pgPoolMax: runtimeConfig.pgPoolMax,
    pgConnectTimeoutMs: runtimeConfig.pgConnectTimeoutMs,
    pgIdleTimeoutMs: runtimeConfig.pgIdleTimeoutMs
  };
}

function assertResetTargetSafety(target: ScriptStorageTarget, cliOptions: ScriptCliOptions): void {
  if (cliOptions.dryRun || target.provider !== "postgres") {
    return;
  }

  assertProductionWriteAllowed({
    operationName: "reset-simulation-baseline",
    explicitTarget: cliOptions.target,
    inferredTarget: inferDatabaseTargetEnvironment(target.databaseUrl),
    confirmProduction: cliOptions.confirmProduction
  });
}

async function loadPersistedAppState(target: ScriptStorageTarget): Promise<ApiDatabase> {
  if (target.provider === "file") {
    const raw = await readFile(target.dbPath, "utf8");
    const parsed = JSON.parse(raw) as ApiDatabase;
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.orgs)) {
      throw new Error(`Database at ${target.dbPath} is missing required users/orgs arrays.`);
    }
    if (!Array.isArray(parsed.trainingPackAssignments)) {
      parsed.trainingPackAssignments = [];
    }
    return parsed;
  }

  if (!target.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }

  const pool = new Pool({
    connectionString: target.databaseUrl,
    max: target.pgPoolMax,
    connectionTimeoutMillis: target.pgConnectTimeoutMs,
    idleTimeoutMillis: target.pgIdleTimeoutMs,
    keepAlive: true
  });

  try {
    const result = await pool.query<{ state_json: unknown }>(
      "SELECT state_json FROM app_state WHERE id = $1 LIMIT 1",
      [APP_STATE_ROW_ID]
    );
    if (result.rows.length === 0) {
      throw new Error("app_state primary row was not found.");
    }

    const parsed = result.rows[0]?.state_json as ApiDatabase;
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.orgs)) {
      throw new Error("Persisted app_state is missing required users/orgs arrays.");
    }
    if (!Array.isArray(parsed.trainingPackAssignments)) {
      parsed.trainingPackAssignments = [];
    }
    return parsed;
  } finally {
    await pool.end();
  }
}

async function savePersistedAppState(target: ScriptStorageTarget, db: ApiDatabase): Promise<void> {
  if (target.provider === "file") {
    await writeFile(target.dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
    return;
  }

  if (!target.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }

  const pool = new Pool({
    connectionString: target.databaseUrl,
    max: target.pgPoolMax,
    connectionTimeoutMillis: target.pgConnectTimeoutMs,
    idleTimeoutMillis: target.pgIdleTimeoutMs,
    keepAlive: true
  });

  try {
    const result = await pool.query(
      `
        UPDATE app_state
        SET state_json = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [APP_STATE_ROW_ID, JSON.stringify(db)]
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error("app_state primary row was not updated.");
    }
  } finally {
    await pool.end();
  }
}

function countStandardScenarios(db: ApiDatabase): number {
  const segments = Array.isArray(db.config?.segments) ? db.config.segments : [];
  return segments.reduce((total, segment) => total + countArray(segment.scenarios), 0);
}

function countCustomScenarios(db: ApiDatabase): number {
  const topLevel = countArray((db as ApiDatabase & { orgCustomScenarios?: unknown[] }).orgCustomScenarios);
  if (topLevel > 0) {
    return topLevel;
  }

  return (Array.isArray(db.orgs) ? db.orgs : []).reduce(
    (total, org) => total + countArray((org as typeof org & { customScenarios?: unknown[] }).customScenarios),
    0
  );
}

async function countTrainingPacks(target: ScriptStorageTarget, db: ApiDatabase): Promise<number | null> {
  const trainingPackStore = createTrainingPackStore({
    provider: target.provider,
    databaseUrl: target.databaseUrl,
    pgPoolMax: target.pgPoolMax,
    pgConnectTimeoutMs: target.pgConnectTimeoutMs,
    pgIdleTimeoutMs: target.pgIdleTimeoutMs
  });

  try {
    await trainingPackStore.initialize();
    if (target.provider !== "postgres") {
      return 0;
    }

    let total = 0;
    for (const org of Array.isArray(db.orgs) ? db.orgs : []) {
      total += (await trainingPackStore.listTrainingPacksForOrg(org.id)).length;
    }
    return total;
  } catch {
    return null;
  }
}

async function collectPreservedStateSummary(target: ScriptStorageTarget, db: ApiDatabase): Promise<PreservedStateSummary> {
  return {
    users: countArray(db.users),
    orgs: countArray(db.orgs),
    industries: countArray(db.config?.industries),
    standardScenarios: countStandardScenarios(db),
    customScenarios: countCustomScenarios(db),
    trainingPacks: await countTrainingPacks(target, db),
    orgTrainings: countArray((db as ApiDatabase & { orgTrainings?: unknown[] }).orgTrainings),
    trainingPackAssignments: countArray(db.trainingPackAssignments),
    orgTrainingPackAttachments: countArray((db as ApiDatabase & { orgTrainingPackAttachments?: unknown[] }).orgTrainingPackAttachments),
    orgTrainingScenarioAttachments: countArray((db as ApiDatabase & { orgTrainingScenarioAttachments?: unknown[] }).orgTrainingScenarioAttachments),
    mobileAuthTokens: countArray(db.mobileAuthTokens),
    emailVerifications: countArray(db.emailVerifications),
    webAuthChallenges: countArray((db as ApiDatabase & { webAuthChallenges?: unknown[] }).webAuthChallenges),
    legacyWebAuthSessions: countArray((db as ApiDatabase & { webAuthSessions?: unknown[] }).webAuthSessions),
    enterpriseJoinRequests: countArray(db.enterpriseJoinRequests),
    adminActiveSessions: countArray(db.admin?.activeSessionIds)
  };
}

async function collectReadOnlyPurgeInventory(target: ScriptStorageTarget, db: ApiDatabase): Promise<{
  usageSessions: number;
  recognizedSimulationSessions: number;
  scoreRecords: number;
  aiUsageEvents: number;
  supportCases: number;
  assignmentProgressRows: number;
}> {
  if (target.provider === "file") {
    const legacyUsageSessions = countArray((db as ApiDatabase & { usageSessions?: unknown[] }).usageSessions);
    const legacyScoreRecords = countArray((db as ApiDatabase & { scoreRecords?: unknown[] }).scoreRecords);
    const legacyAiUsageEvents = countArray((db as ApiDatabase & { aiUsageEvents?: unknown[] }).aiUsageEvents);
    const legacySupportCases = countArray((db as ApiDatabase & { supportCases?: unknown[] }).supportCases);

    return {
      usageSessions: Math.max(
        await readJsonArrayCount({
          filePath: buildSidecarPath(target.dbPath, "usage-sessions"),
          key: "records"
        }),
        legacyUsageSessions
      ),
      recognizedSimulationSessions: await readJsonArrayCount({
        filePath: buildSidecarPath(target.dbPath, "simulation-sessions"),
        key: "records"
      }),
      scoreRecords: Math.max(
        await readJsonArrayCount({
          filePath: buildSidecarPath(target.dbPath, "score-records"),
          key: "records"
        }),
        legacyScoreRecords
      ),
      aiUsageEvents: Math.max(
        await readJsonArrayCount({
          filePath: buildSidecarPath(target.dbPath, "ai-usage-events"),
          key: "events"
        }),
        legacyAiUsageEvents
      ),
      supportCases: Math.max(
        await readJsonArrayCount({
          filePath: buildSidecarPath(target.dbPath, "support-cases"),
          key: "cases"
        }),
        legacySupportCases
      ),
      assignmentProgressRows: db.trainingPackAssignments.filter(
        (assignment) => assignment.startedAt !== null || assignment.completedAt !== null
      ).length
    };
  }

  if (!target.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }

  const pool = new Pool({
    connectionString: target.databaseUrl,
    max: target.pgPoolMax,
    connectionTimeoutMillis: target.pgConnectTimeoutMs,
    idleTimeoutMillis: target.pgIdleTimeoutMs,
    keepAlive: true
  });

  try {
    return {
      usageSessions: Math.max(
        await countPostgresRowsIfTableExists(pool, "usage_sessions"),
        countArray((db as ApiDatabase & { usageSessions?: unknown[] }).usageSessions)
      ),
      recognizedSimulationSessions: await countPostgresRowsIfTableExists(pool, "simulation_sessions"),
      scoreRecords: Math.max(
        await countPostgresRowsIfTableExists(pool, "score_records"),
        countArray((db as ApiDatabase & { scoreRecords?: unknown[] }).scoreRecords)
      ),
      aiUsageEvents: Math.max(
        await countPostgresRowsIfTableExists(pool, "ai_usage_events"),
        countArray((db as ApiDatabase & { aiUsageEvents?: unknown[] }).aiUsageEvents)
      ),
      supportCases: Math.max(
        await countPostgresRowsIfTableExists(pool, "support_cases"),
        countArray((db as ApiDatabase & { supportCases?: unknown[] }).supportCases)
      ),
      assignmentProgressRows: db.trainingPackAssignments.filter(
        (assignment) => assignment.startedAt !== null || assignment.completedAt !== null
      ).length
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const runtimeConfig = loadScriptRuntimeConfig();
  const cliOptions = loadScriptCliOptions();
  const target = resolveStorageTarget(runtimeConfig);
  assertResetTargetSafety(target, cliOptions);
  const dryRun = cliOptions.dryRun;
  const now = new Date();
  const db = await loadPersistedAppState(target);
  const before = await collectReadOnlyPurgeInventory(target, db);
  const preservedBefore = await collectPreservedStateSummary(target, db);
  const hasAnythingToReset = Object.values(before).some((value) => value > 0);

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      mode: "dry_run",
      target,
      purgeCandidates: before,
      preserved: preservedBefore
    }, null, 2));
    return;
  }

  if (!hasAnythingToReset) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      mode: "noop",
      target,
      purgeCandidatesBefore: before,
      preservedBefore
    }, null, 2));
    return;
  }

  const usageSessionStore = createUsageSessionStore(target);
  const simulationSessionStore = createSimulationSessionStore(target);
  const scoreRecordStore = createScoreRecordStore(target);
  const aiUsageEventStore = createAiUsageEventStore(target);
  const supportCaseStore = createSupportCaseStore(target);

  await usageSessionStore.initialize();
  await simulationSessionStore.initialize();
  await scoreRecordStore.initialize();
  await aiUsageEventStore.initialize();
  await supportCaseStore.initialize({ now });

  const usageSessionAccess = createUsageSessionAccess(usageSessionStore);
  const scoreRecordAccess = createScoreRecordAccess(scoreRecordStore);
  const aiUsageEventAccess = createAiUsageEventAccess(aiUsageEventStore);

  const reset = await resetDisposablePreTesterHistory({
    db,
    usageSessionAccess,
    simulationSessionStore,
    scoreRecordAccess,
    aiUsageEventAccess,
    supportCaseStore,
    now
  });

  await savePersistedAppState(target, db);

  const after = await inspectDisposableSimulationHistory({
    db,
    usageSessionAccess,
    simulationSessionStore,
    scoreRecordAccess,
    aiUsageEventAccess,
    supportCaseStore,
    now
  });
  const preservedAfter = await collectPreservedStateSummary(target, db);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    mode: "applied",
    target,
    purgeCandidatesBefore: before,
    purgeCandidatesAfter: after,
    preservedBefore,
    preservedAfter,
    reset
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[reset-simulation-baseline] failed: ${message}`);
  process.exit(1);
});
