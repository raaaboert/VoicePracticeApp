import "dotenv/config";

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import type { ApiDatabase } from "@voicepractice/shared";

import { createAiUsageEventAccess } from "../src/services/aiUsageEvents.js";
import { resetDisposablePreTesterHistory } from "../src/services/integrityMaintenance.js";
import { createScoreRecordAccess } from "../src/services/scoreRecordAccess.js";
import { createUsageSessionAccess } from "../src/services/usageSessionAccess.js";
import { createAiUsageEventStore } from "../src/storage/aiUsageEventStore.js";
import { createScoreRecordStore } from "../src/storage/scoreRecordStore.js";
import { createSimulationSessionStore } from "../src/storage/simulationSessionStore.js";
import { createSupportCaseStore } from "../src/storage/supportCaseStore.js";
import { createUsageSessionStore } from "../src/storage/usageSessionStore.js";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

async function main(): Promise<void> {
  const storageProvider = process.env.STORAGE_PROVIDER?.trim().toLowerCase() || "file";
  const forceLocalFile = process.argv.includes("--local-file");
  if (storageProvider !== "file" && !forceLocalFile) {
    throw new Error(
      "reset-pretester-history is intentionally limited to local file-backed data. Re-run with --local-file to reset the workspace db.local* files without touching hosted postgres data."
    );
  }
  const dbPath = path.resolve(process.cwd(), process.env.DB_PATH ?? "./db.local.json");
  const pgPoolMax = parsePositiveInt(process.env.PG_POOL_MAX, 5);
  const pgConnectTimeoutMs = parsePositiveInt(process.env.PG_CONNECT_TIMEOUT_MS, 8000);
  const pgIdleTimeoutMs = parsePositiveInt(process.env.PG_IDLE_TIMEOUT_MS, 30000);

  const raw = await readFile(dbPath, "utf8");
  const db = JSON.parse(raw) as ApiDatabase;
  if (!Array.isArray(db.users) || !Array.isArray(db.orgs)) {
    throw new Error(`Database at ${dbPath} is missing required users/orgs arrays.`);
  }

  if (!Array.isArray(db.trainingPackAssignments)) {
    (db as ApiDatabase & { trainingPackAssignments: ApiDatabase["trainingPackAssignments"] }).trainingPackAssignments = [];
  }

  const common = {
    provider: "file" as const,
    dbPath,
    databaseUrl: null,
    pgPoolMax,
    pgConnectTimeoutMs,
    pgIdleTimeoutMs
  };
  const usageSessionStore = createUsageSessionStore(common);
  const simulationSessionStore = createSimulationSessionStore(common);
  const scoreRecordStore = createScoreRecordStore(common);
  const aiUsageEventStore = createAiUsageEventStore(common);
  const supportCaseStore = createSupportCaseStore(common);
  await usageSessionStore.initialize();
  await simulationSessionStore.initialize();
  await scoreRecordStore.initialize();
  await aiUsageEventStore.initialize();
  await supportCaseStore.initialize({ now: new Date() });

  const summary = await resetDisposablePreTesterHistory({
    db,
    usageSessionAccess: createUsageSessionAccess(usageSessionStore),
    simulationSessionStore,
    scoreRecordAccess: createScoreRecordAccess(scoreRecordStore),
    aiUsageEventAccess: createAiUsageEventAccess(aiUsageEventStore),
    supportCaseStore,
    now: new Date()
  });

  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    dbPath,
    storageProvider: forceLocalFile ? `${storageProvider} (local-file override)` : storageProvider,
    ...summary
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[reset-pretester-history] failed: ${message}`);
  process.exit(1);
});
