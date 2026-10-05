import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  assertProductionWriteAllowed,
  inferDatabaseTargetEnvironment,
  parseScriptTarget,
  PRODUCTION_WRITE_CONFIRMATION,
  resolveGuardedTargetEnvironment,
  type ScriptTargetEnvironment,
} from "../src/productionSafety.js";
import {
  inspectTrainingPackSchema,
  migrateTrainingPackSchema,
} from "../src/storage/trainingPackMigrations.js";

interface MigrationCliOptions {
  apply: boolean;
  target: ScriptTargetEnvironment | null;
  confirmProduction: string | null;
}

function readArgValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(`--${name}`);
  if (index < 0) {
    return null;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

export function parseMigrationCliOptions(
  args: readonly string[]
): MigrationCliOptions {
  return {
    apply: args.includes("--apply"),
    target: parseScriptTarget(readArgValue(args, "target")),
    confirmProduction: readArgValue(args, "confirm-production"),
  };
}

export function assertMigrationTargetSafety(params: {
  options: MigrationCliOptions;
  databaseUrl: string;
}): ScriptTargetEnvironment {
  if (!params.options.target) {
    throw new Error(
      '--target development, --target staging, or --target production is required.'
    );
  }
  const inferredTarget = inferDatabaseTargetEnvironment(params.databaseUrl);
  if (!params.options.apply) {
    return (
      resolveGuardedTargetEnvironment({
        operationName: "migrate-training-pack-schema",
        explicitTarget: params.options.target,
        inferredTarget,
      }) ?? params.options.target
    );
  }
  return (
    assertProductionWriteAllowed({
      operationName: "migrate-training-pack-schema",
      explicitTarget: params.options.target,
      inferredTarget,
      confirmProduction: params.options.confirmProduction,
    }) ?? params.options.target
  );
}

async function main(): Promise<void> {
  const options = parseMigrationCliOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  const target = assertMigrationTargetSafety({ options, databaseUrl });
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
  });
  try {
    if (!options.apply) {
      const status = await inspectTrainingPackSchema(pool);
      console.log(JSON.stringify({ mode: "check", target, status }, null, 2));
      if (!status.current) {
        console.log("Schema migration is required. Re-run with --apply after review.");
      }
      return;
    }
    const result = await migrateTrainingPackSchema(pool);
    console.log(JSON.stringify({ mode: "apply", target, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (process.env.NODE_ENV !== "test") {
      console.error(
        `Production writes require --target production --confirm-production "${PRODUCTION_WRITE_CONFIRMATION}".`
      );
    }
    process.exitCode = 1;
  });
}
