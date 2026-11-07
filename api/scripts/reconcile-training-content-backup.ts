import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  assertProductionWriteAllowed,
  inferDatabaseTargetEnvironment,
  parseScriptTarget,
  PRODUCTION_WRITE_CONFIRMATION,
  type ScriptTargetEnvironment,
} from "../src/productionSafety.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../src/runtimeConfig.js";
import { assertBackupObjectMatches, createTrainingContentBackupService } from "../src/services/trainingContentBackup.js";
import { createTrainingContentAssetStore, type TrainingContentAssetRecord } from "../src/storage/trainingContentAssetStore.js";
import { createTrainingContentBackupStorage, type TrainingContentBackupObjectStorage } from "../src/storage/trainingContentBackupStorage.js";

export function assertTrainingContentBackupReconciliationTarget(params: {
  target: ScriptTargetEnvironment | null;
  deploymentEnvironment: string;
  liveStorageEnvironment: string | null;
  databaseUrl: string | null;
  apply: boolean;
  confirmProduction: string | null;
}): "staging" | "production" {
  const inferredDatabaseTarget = inferDatabaseTargetEnvironment(params.databaseUrl);
  if (!params.target || (params.target !== "staging" && params.target !== "production")) {
    throw new Error("--target staging or --target production is required.");
  }
  if (
    params.target !== params.deploymentEnvironment
    || params.target !== params.liveStorageEnvironment
    || params.target !== inferredDatabaseTarget
  ) {
    throw new Error(
      "Training Content backup reconciliation target must match PERITIO_ENV, live R2 environment, and DATABASE_URL."
    );
  }
  if (params.apply && params.target === "production") {
    assertProductionWriteAllowed({
      operationName: "reconcile-training-content-backup",
      explicitTarget: params.target,
      inferredTarget: inferredDatabaseTarget,
      confirmProduction: params.confirmProduction,
    });
  } else if (params.confirmProduction === PRODUCTION_WRITE_CONFIRMATION) {
    throw new Error(
      "Production confirmation is only valid for an applied production backup reconciliation."
    );
  }
  return params.target;
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

function readLimit(): number {
  const raw = readArgValue("limit");
  const limit = raw ? Number(raw) : 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("--limit must be an integer between 1 and 1000.");
  }
  return limit;
}

// Injectable boundary for offline tests. No dotenv loading or application startup.
export async function runBackupReconciliation(params: {
  runtimeConfig: RuntimeConfig;
  pool: Pick<Pool, "query" | "connect">;
  apply: boolean;
  limit: number;
  verification?: { afterId: string | null };
  storageFactory?: () => TrainingContentBackupObjectStorage;
}): Promise<Record<string, unknown>> {
  const { runtimeConfig, apply, limit, verification } = params;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid backup scan limit.");
  const createStore = (queryPool: Pick<Pool, "query" | "connect">) => createTrainingContentAssetStore({
      provider: "postgres", databaseUrl: runtimeConfig.databaseUrl,
      pgPoolMax: 2, pgConnectTimeoutMs: runtimeConfig.pgConnectTimeoutMs,
      pgIdleTimeoutMs: runtimeConfig.pgIdleTimeoutMs, queryPool,
      schemaInitialization: "existing",
  });
  if (!apply) {
    const client = await params.pool.connect();
    type VerificationAsset = Pick<TrainingContentAssetRecord,
      "id" | "finalObjectKey" | "byteSize" | "detectedMimeType" | "checksumOrEtag">;
    let page: { pending: number; assets: VerificationAsset[] };
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const assetStore = createStore({
        query: client.query.bind(client),
        connect: async () => { throw new Error("Dry-run cannot acquire a write connection."); },
      });
      const pending = await assetStore.countAssetsPendingBackup();
      const assets = (await assetStore.listAssetsPendingBackup(limit, verification)).map(asset => ({
        id: asset.id, finalObjectKey: asset.finalObjectKey, byteSize: asset.byteSize,
        detectedMimeType: asset.detectedMimeType, checksumOrEtag: asset.checksumOrEtag,
      }));
      page = { pending, assets };
    } finally {
      let rollbackFailed = true;
      try {
        await client.query("ROLLBACK");
        rollbackFailed = false;
      } finally { client.release(rollbackFailed); }
    }
    // No database connection or transaction is held during provider I/O.
    const { pending, assets } = page;
    if (!verification) {
      return { apply: false, pending, scanned: assets.length, assetIds: assets.map(a => a.id), objectVerification: "not_requested" };
    }
    const backupStorage = params.storageFactory?.() ?? createTrainingContentBackupStorage(runtimeConfig.trainingContentStorage);
    let alreadyPresent = 0, failed = 0, missing = 0;
    for (const asset of assets) {
      try {
        const stored = await backupStorage.headObject(asset.finalObjectKey!, AbortSignal.timeout(30_000));
        if (!stored) missing++;
        assertBackupObjectMatches(asset, stored);
        alreadyPresent++;
      } catch { failed++; }
    }
    return { apply: false, verify: true, scanned: assets.length, backedUp: 0, alreadyPresent, failed, missing,
      stillPending: pending,
      nextAfter: assets.length === limit ? assets.at(-1)!.id : null };
  }
  const assetStore = createStore(params.pool);
  const pending = await assetStore.countAssetsPendingBackup();
  const backupStorage = params.storageFactory?.() ?? createTrainingContentBackupStorage(runtimeConfig.trainingContentStorage);
  const backup = createTrainingContentBackupService({ config: runtimeConfig.trainingContentStorage, assetStore, backupStorage });
  if (!verification) return { apply, pendingBefore: pending, ...await backup.reconcilePendingBackups(limit) };
  const assets = await assetStore.listAssetsPendingBackup(limit, verification);
  let backedUp = 0, alreadyPresent = 0, failed = 0;
  for (const asset of assets) {
    const outcome = await backup.backupFinalizedAsset(asset, true);
    if (outcome === "copied") backedUp++;
    else if (outcome === "already_present") alreadyPresent++;
    else failed++;
  }
  return { apply, verify: true, scanned: assets.length, backedUp, alreadyPresent, failed, missing: 0,
    stillPending: await assetStore.countAssetsPendingBackup(),
    nextAfter: assets.length === limit ? assets.at(-1)!.id : null };
}

export function backupReconciliationExitCode(report: Record<string, unknown>): number {
  return Number(report.failed ?? 0) > 0 || Number(report.stillPending ?? report.pending ?? 0) > 0 ? 2 : 0;
}

async function main(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig();
  const apply = process.argv.includes("--apply");
  const verify = process.argv.includes("--verify");
  const afterId = readArgValue("after-id");
  if (afterId && (!verify || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(afterId))) {
    throw new Error("--after-id requires --verify and an asset UUID.");
  }
  const target = assertTrainingContentBackupReconciliationTarget({
    target: parseScriptTarget(readArgValue("target")),
    deploymentEnvironment: runtimeConfig.deploymentEnvironment,
    liveStorageEnvironment: runtimeConfig.trainingContentStorage.r2?.environment ?? null,
    databaseUrl: runtimeConfig.databaseUrl,
    apply,
    confirmProduction: readArgValue("confirm-production"),
  });
  if (!runtimeConfig.databaseUrl || runtimeConfig.storageProvider !== "postgres") {
    throw new Error("Training Content backup reconciliation requires PostgreSQL storage.");
  }
  if (runtimeConfig.trainingContentStorage.provider !== "r2") {
    throw new Error("Training Content backup reconciliation requires configured live R2 storage.");
  }
  if ((apply || verify) && !runtimeConfig.trainingContentStorage.backup.enabled) {
    throw new Error("TRAINING_CONTENT_BACKUP_ENABLED=true is required with --apply or --verify.");
  }

  const limit = readLimit();
  const pool = new Pool({
    connectionString: runtimeConfig.databaseUrl,
    max: 2,
    connectionTimeoutMillis: runtimeConfig.pgConnectTimeoutMs,
    idleTimeoutMillis: runtimeConfig.pgIdleTimeoutMs,
    keepAlive: true,
  });
  try {
    const report = await runBackupReconciliation({ runtimeConfig, pool, apply, limit,
      verification: verify ? { afterId } : undefined });
    console.log(JSON.stringify({ target, ...report }, null, 2));
    process.exitCode = backupReconciliationExitCode(report);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
