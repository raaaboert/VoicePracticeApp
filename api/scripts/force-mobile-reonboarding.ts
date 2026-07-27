import "dotenv/config";

import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import type { ApiDatabase, AuditEvent, UserProfile } from "@voicepractice/shared";

import {
  assertProductionWriteAllowed,
  inferDatabaseTargetEnvironment,
  parseScriptTarget,
  PRODUCTION_WRITE_CONFIRMATION,
  type ScriptTargetEnvironment
} from "../src/productionSafety.js";
import type { StorageProvider } from "../src/runtimeConfig.js";

const APP_STATE_ROW_ID = "primary";
const MAX_AUDIT_EVENTS = 10000;

interface RuntimeConfig {
  storageProvider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface StorageTarget extends RuntimeConfig {}

interface CliOptions {
  apply: boolean;
  target: ScriptTargetEnvironment | null;
  confirmProduction: string | null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readArgValue(name: string): string | null {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function loadCliOptions(): CliOptions {
  return {
    apply: process.argv.includes("--apply"),
    target: parseScriptTarget(readArgValue("target")),
    confirmProduction: readArgValue("confirm-production"),
  };
}

function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const explicitDatabaseUrl = readArgValue("database-url")?.trim() || null;
  const databaseUrl = explicitDatabaseUrl || env.DATABASE_URL?.trim() || null;
  const providerCandidate = env.STORAGE_PROVIDER?.trim().toLowerCase();
  const storageProvider: StorageProvider =
    providerCandidate === "postgres"
      ? "postgres"
      : providerCandidate === "file"
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
    pgIdleTimeoutMs: parsePositiveInt(env.PG_IDLE_TIMEOUT_MS, 30000),
  };
}

function resolveStorageTarget(runtimeConfig: RuntimeConfig): StorageTarget {
  if (process.argv.includes("--local-file")) {
    return {
      ...runtimeConfig,
      storageProvider: "file",
      databaseUrl: null,
      dbPath: path.resolve(process.cwd(), process.env.DB_PATH ?? "./db.local.json"),
    };
  }
  return runtimeConfig;
}

export function assertTargetSafety(target: StorageTarget, options: CliOptions): ScriptTargetEnvironment | null {
  if (!options.target) {
    throw new Error('--target staging or --target production is required.');
  }
  if (options.target !== "staging" && options.target !== "production") {
    throw new Error('--target must be "staging" or "production" for force-mobile-reonboarding.');
  }

  const inferredTarget = inferDatabaseTargetEnvironment(target.databaseUrl);
  if (inferredTarget !== options.target) {
    throw new Error(
      `force-mobile-reonboarding target mismatch: --target ${options.target} does not match detected ${inferredTarget ?? "unknown"} target.`
    );
  }

  if (options.target === "production") {
    return assertProductionWriteAllowed({
      operationName: "force-mobile-reonboarding",
      explicitTarget: options.target,
      inferredTarget,
      confirmProduction: options.confirmProduction,
    });
  }

  if (options.confirmProduction === PRODUCTION_WRITE_CONFIRMATION) {
    throw new Error("Production confirmation is only valid with --target production.");
  }

  return "staging";
}

async function loadAppState(target: StorageTarget): Promise<ApiDatabase> {
  if (target.storageProvider === "file") {
    const raw = await readFile(target.dbPath, "utf8");
    return JSON.parse(raw) as ApiDatabase;
  }

  if (!target.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }
  const pool = new Pool({
    connectionString: target.databaseUrl,
    max: target.pgPoolMax,
    connectionTimeoutMillis: target.pgConnectTimeoutMs,
    idleTimeoutMillis: target.pgIdleTimeoutMs,
    keepAlive: true,
  });
  try {
    const result = await pool.query<{ state_json: unknown }>(
      "SELECT state_json FROM app_state WHERE id = $1 LIMIT 1",
      [APP_STATE_ROW_ID]
    );
    if (result.rows.length === 0) {
      throw new Error("app_state primary row was not found.");
    }
    return result.rows[0]!.state_json as ApiDatabase;
  } finally {
    await pool.end();
  }
}

async function saveAppState(target: StorageTarget, db: ApiDatabase): Promise<void> {
  if (target.storageProvider === "file") {
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
    keepAlive: true,
  });
  try {
    await pool.query(
      `
        UPDATE app_state
        SET state_json = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [APP_STATE_ROW_ID, JSON.stringify(db)]
    );
  } finally {
    await pool.end();
  }
}

export function isActiveEnterpriseMobileUser(user: UserProfile): boolean {
  return user.accountType === "enterprise" && user.status === "active" && user.isSuperUser !== true;
}

export function applyReset(db: ApiDatabase, nowIso: string): {
  activeEnterpriseUserCount: number;
  alreadyFlaggedUserCount: number;
  newlyFlaggedUserCount: number;
  revokedMobileTokenCount: number;
} {
  const activeUsers = db.users.filter(isActiveEnterpriseMobileUser);
  const activeUserIds = new Set(activeUsers.map((user) => user.id));
  let alreadyFlaggedUserCount = 0;
  let newlyFlaggedUserCount = 0;

  for (const user of activeUsers) {
    if (user.mobileProfileReonboardingRequired === true) {
      alreadyFlaggedUserCount += 1;
      continue;
    }
    user.mobileProfileReonboardingRequired = true;
    user.updatedAt = nowIso;
    newlyFlaggedUserCount += 1;
  }

  const beforeTokenCount = Array.isArray(db.mobileAuthTokens) ? db.mobileAuthTokens.length : 0;
  db.mobileAuthTokens = (db.mobileAuthTokens ?? []).filter((token) => !activeUserIds.has(token.userId));

  return {
    activeEnterpriseUserCount: activeUsers.length,
    alreadyFlaggedUserCount,
    newlyFlaggedUserCount,
    revokedMobileTokenCount: beforeTokenCount - db.mobileAuthTokens.length,
  };
}

export function buildResetAuditEvent(
  report: ReturnType<typeof applyReset>,
  resolvedTarget: string | null,
  nowIso = new Date().toISOString()
): AuditEvent {
  return {
    id: `audit_${randomUUID()}`,
    actorType: "system",
    actorId: null,
    action: "mobile.profile_reonboarding_reset.applied",
    orgId: null,
    userId: null,
    message: "Forced mobile profile re-onboarding for active enterprise mobile users.",
    metadata: {
      target: resolvedTarget,
      activeEnterpriseUserCount: report.activeEnterpriseUserCount,
      alreadyFlaggedUserCount: report.alreadyFlaggedUserCount,
      newlyFlaggedUserCount: report.newlyFlaggedUserCount,
      revokedMobileTokenCount: report.revokedMobileTokenCount,
    },
    createdAt: nowIso,
  };
}

export function appendResetAudit(
  db: ApiDatabase,
  report: ReturnType<typeof applyReset>,
  resolvedTarget: string | null,
  nowIso = new Date().toISOString()
): AuditEvent {
  const event = buildResetAuditEvent(report, resolvedTarget, nowIso);
  db.auditEvents = [...(db.auditEvents ?? []), event].slice(-MAX_AUDIT_EVENTS);
  return event;
}

async function main(): Promise<void> {
  const options = loadCliOptions();
  const target = resolveStorageTarget(loadRuntimeConfig());
  const resolvedTarget = assertTargetSafety(target, options);
  const db = await loadAppState(target);
  const now = new Date().toISOString();
  const report = applyReset(db, now);

  if (options.apply) {
    appendResetAudit(db, report, resolvedTarget, now);
    await saveAppState(target, db);
  }

  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    target: resolvedTarget,
    storageProvider: target.storageProvider,
    activeEnterpriseUserCount: report.activeEnterpriseUserCount,
    alreadyFlaggedUserCount: report.alreadyFlaggedUserCount,
    newlyFlaggedUserCount: report.newlyFlaggedUserCount,
    revokedMobileTokenCount: report.revokedMobileTokenCount,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
