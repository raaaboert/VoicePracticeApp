import type { ApiDatabase } from "@voicepractice/shared";
import { Pool } from "pg";

import { loadRuntimeConfig } from "./runtimeConfig.js";
import { runFocusTopicReminderSweep } from "./services/focusTopicReminderWorker.js";
import {
  createFocusTopicAuthorityStore,
  type FocusTopicAuthorityStore,
} from "./storage/focusTopicAuthorityStore.js";
import {
  createUserNotificationStore,
  type UserNotificationStore,
} from "./storage/userNotificationStore.js";

/**
 * One-shot reminder bootstrap.  It deliberately does not import index.ts:
 * importing the API entrypoint is allowed to start the HTTP server.
 */
export async function runFocusTopicReminderWorker(params: {
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
} = {}): Promise<{ considered: number; inserted: number }> {
  const config = loadRuntimeConfig(params.env ?? process.env);
  if (config.storageProvider !== "postgres" || !config.databaseUrl || config.focusTopicAuthority !== "assignments") {
    throw new Error("Focus Topic reminders require PostgreSQL assignment authority.");
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.pgPoolMax,
    connectionTimeoutMillis: config.pgConnectTimeoutMs,
    idleTimeoutMillis: config.pgIdleTimeoutMs,
    keepAlive: true,
  });
  try {
    const authority = createFocusTopicAuthorityStore({
      provider: "postgres",
      databaseUrl: config.databaseUrl,
      pgPoolMax: config.pgPoolMax,
      pgConnectTimeoutMs: config.pgConnectTimeoutMs,
      pgIdleTimeoutMs: config.pgIdleTimeoutMs,
      queryPool: pool,
    });
    const notifications = createUserNotificationStore({
      provider: "postgres",
      databaseUrl: config.databaseUrl,
      pgPoolMax: config.pgPoolMax,
      pgConnectTimeoutMs: config.pgConnectTimeoutMs,
      pgIdleTimeoutMs: config.pgIdleTimeoutMs,
      queryPool: pool,
    });
    return await runFocusTopicReminderWorkerSweep({
      authority,
      notifications,
      loadDatabase: async () => {
        const state = await pool.query<{ state_json: ApiDatabase }>(
          "SELECT state_json FROM app_state WHERE id = $1 LIMIT 1",
          ["primary"],
        );
        if (!state.rows[0]?.state_json) {
          throw new Error("Focus Topic reminder worker requires initialized application state.");
        }
        return state.rows[0].state_json;
      },
      log: params.log,
    });
  } finally {
    await pool.end();
  }
}

export async function runFocusTopicReminderWorkerSweep(params: {
  authority: FocusTopicAuthorityStore;
  notifications: UserNotificationStore;
  loadDatabase: () => Promise<ApiDatabase>;
  log?: (message: string) => void;
}): Promise<{ considered: number; inserted: number }> {
  await Promise.all([params.authority.initialize(), params.notifications.initialize()]);
  await params.authority.assertAssignmentsReady();
  const result = await runFocusTopicReminderSweep({
    db: await params.loadDatabase(),
    authority: await params.authority.listSnapshot(),
    store: params.notifications,
  });
  params.log?.(`[focus-topic-reminders] considered=${result.considered} inserted=${result.inserted}`);
  return result;
}
