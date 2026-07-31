import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  assertProductionWriteAllowed,
  inferDatabaseTargetEnvironment,
  parseScriptTarget,
  PRODUCTION_WRITE_CONFIRMATION,
  ScriptTargetEnvironment,
} from "../src/productionSafety.js";
import { loadRuntimeConfig } from "../src/runtimeConfig.js";
import { TrainingContentCleanupService } from "../src/services/trainingContentCleanup.js";
import { TrainingContentStorageReadinessService } from "../src/services/trainingContentStorageReadiness.js";
import { createTrainingContentAssetStore } from "../src/storage/trainingContentAssetStore.js";
import { createTrainingContentObjectStorage } from "../src/storage/trainingContentObjectStorage.js";

export function assertTrainingContentCleanupTarget(params: {
  target: ScriptTargetEnvironment | null;
  deploymentEnvironment: string;
  storageEnvironment: string | null;
  databaseUrl: string | null;
  apply: boolean;
  confirmProduction: string | null;
}): "staging" | "production" {
  const inferredDatabaseTarget = inferDatabaseTargetEnvironment(params.databaseUrl);
  if (!params.target || (params.target !== "staging" && params.target !== "production")) {
    throw new Error('--target staging or --target production is required.');
  }
  if (
    params.target !== params.deploymentEnvironment
    || params.target !== params.storageEnvironment
    || params.target !== inferredDatabaseTarget
  ) {
    throw new Error(
      "Training Content cleanup target must match PERITIO_ENV, R2 environment, and DATABASE_URL."
    );
  }
  if (params.apply && params.target === "production") {
    assertProductionWriteAllowed({
      operationName: "cleanup-training-content-storage",
      explicitTarget: params.target,
      inferredTarget: inferredDatabaseTarget,
      confirmProduction: params.confirmProduction,
    });
  } else if (params.confirmProduction === PRODUCTION_WRITE_CONFIRMATION) {
    throw new Error("Production confirmation is only valid for an applied production cleanup.");
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

async function main(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig();
  const target = parseScriptTarget(readArgValue("target"));
  const apply = process.argv.includes("--apply");
  const confirmProduction = readArgValue("confirm-production");
  const resolvedTarget = assertTrainingContentCleanupTarget({
    target,
    deploymentEnvironment: runtimeConfig.deploymentEnvironment,
    storageEnvironment: runtimeConfig.trainingContentStorage.r2?.environment ?? null,
    databaseUrl: runtimeConfig.databaseUrl,
    apply,
    confirmProduction,
  });
  if (!runtimeConfig.databaseUrl || runtimeConfig.storageProvider !== "postgres") {
    throw new Error("Training Content cleanup requires PostgreSQL storage.");
  }
  if (runtimeConfig.trainingContentStorage.provider !== "r2") {
    throw new Error("Training Content cleanup requires configured R2 storage.");
  }

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
    const objectStorage = createTrainingContentObjectStorage(
      runtimeConfig.trainingContentStorage
    );
    const readiness = new TrainingContentStorageReadinessService(
      runtimeConfig.trainingContentStorage,
      objectStorage
    );
    const cleanup = new TrainingContentCleanupService({
      config: runtimeConfig.trainingContentStorage,
      assetStore,
      objectStorage,
      readiness,
    });
    const report = await cleanup.run({ apply });
    console.log(JSON.stringify({
      target: resolvedTarget,
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
