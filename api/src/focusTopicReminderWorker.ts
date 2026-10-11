import dotenv from "dotenv";

import { runFocusTopicReminderWorker } from "./focusTopicReminderWorkerBootstrap.js";

dotenv.config();

runFocusTopicReminderWorker({ log: console.log }).catch((error: unknown) => {
  console.error("[focus-topic-reminders] failed", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
