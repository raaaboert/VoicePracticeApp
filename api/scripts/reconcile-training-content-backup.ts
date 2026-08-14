import "dotenv/config";

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
import { loadRuntimeConfig } from "../src/runtimeConfig.js";
import { createTrainingContentBackupService } from "../src/services/trainingContentBackup.js";
import { createTrainingContentAssetStore } from "../src/storage/trainingContentAssetStore.js";
import { createTrainingContentBackupStorage } from "../src/storage/trainingContentBackupStorage.js";

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

async function main(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig();
  const apply = process.argv.includes("--apply");
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
  if (apply && !runtimeConfig.trainingContentStorage.backup.enabled) {
    throw new Error("TRAINING_CONTENT_BACKUP_ENABLED=true is required with --apply.");
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
    const assetStore = createTrainingContentAssetStore({
      provider: "postgres",
      databaseUrl: runtimeConfig.databaseUrl,
      pgPoolMax: 2,
      pgConnectTimeoutMs: runtimeConfig.pgConnectTimeoutMs,
      pgIdleTimeoutMs: runtimeConfig.pgIdleTimeoutMs,
      queryPool: pool,
    });
    const pendingCount = await assetStore.countAssetsPendingBackup();
    if (!apply) {
      const pending = await assetStore.listAssetsPendingBackup(limit);
      console.log(JSON.stringify({
        target,
        apply: false,
        pending: pendingCount,
        scanned: pending.length,
        assetIds: pending.map((asset) => asset.id),
      }, null, 2));
      return;
    }

    const backup = createTrainingContentBackupService({
      config: runtimeConfig.trainingContentStorage,
      assetStore,
      backupStorage: createTrainingContentBackupStorage(runtimeConfig.trainingContentStorage),
    });
    const report = await backup.reconcilePendingBackups(limit);
    console.log(JSON.stringify({
      target,
      apply: true,
      pendingBefore: pendingCount,
      ...report,
    }, null, 2));
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
