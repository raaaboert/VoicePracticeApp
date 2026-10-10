import dotenv from "dotenv";

import { runFocusTopicReminderSweep } from "./services/focusTopicReminderWorker.js";
import { createDatabaseStorage } from "./storage.js";
import { createFocusTopicAuthorityStore } from "./storage/focusTopicAuthorityStore.js";
import { createUserNotificationStore } from "./storage/userNotificationStore.js";
import { loadRuntimeConfig } from "./runtimeConfig.js";
import { createDefaultDatabase, ensureDatabaseShape } from "./index.js";

dotenv.config();

async function run(): Promise<void> {
  const config = loadRuntimeConfig(process.env);
  if (config.storageProvider !== "postgres" || !config.databaseUrl || config.focusTopicAuthority !== "assignments") {
    throw new Error("Focus Topic reminders require PostgreSQL assignment authority.");
  }
  const database = createDatabaseStorage({ provider: "postgres", dbPath: config.dbPath, databaseUrl: config.databaseUrl,
    pgPoolMax: config.pgPoolMax, pgConnectTimeoutMs: config.pgConnectTimeoutMs, pgIdleTimeoutMs: config.pgIdleTimeoutMs,
    ensureDatabaseShape, createDefaultDatabase });
  const authority = createFocusTopicAuthorityStore({ provider: "postgres", databaseUrl: config.databaseUrl,
    pgPoolMax: config.pgPoolMax, pgConnectTimeoutMs: config.pgConnectTimeoutMs, pgIdleTimeoutMs: config.pgIdleTimeoutMs });
  const notifications = createUserNotificationStore({ provider: "postgres", databaseUrl: config.databaseUrl,
    pgPoolMax: config.pgPoolMax, pgConnectTimeoutMs: config.pgConnectTimeoutMs, pgIdleTimeoutMs: config.pgIdleTimeoutMs });
  await Promise.all([authority.initialize(), notifications.initialize()]);
  await authority.assertAssignmentsReady();
  const result = await runFocusTopicReminderSweep({ db: await database.load(), authority: await authority.listSnapshot(), store: notifications });
  console.log(`[focus-topic-reminders] considered=${result.considered} inserted=${result.inserted}`);
}

run().catch((error: unknown) => {
  console.error("[focus-topic-reminders] failed", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
