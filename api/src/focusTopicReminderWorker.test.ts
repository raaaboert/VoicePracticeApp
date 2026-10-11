import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runFocusTopicReminderWorkerSweep } from "./focusTopicReminderWorkerBootstrap.js";
import { createMemoryUserNotificationStoreForTest } from "./storage/userNotificationStore.js";

test("Focus Topic reminder executable uses the side-effect-free worker bootstrap", async () => {
  const source = await readFile(new URL("./focusTopicReminderWorker.ts", import.meta.url), "utf8");
  assert.match(source, /focusTopicReminderWorkerBootstrap/);
  assert.doesNotMatch(source, /from "\.\/index\.js"/);
  assert.doesNotMatch(source, /startApiServer/);
});

test("Focus Topic reminder worker completes one sweep without starting an API listener", async () => {
  let initialized = 0;
  let asserted = 0;
  const result = await runFocusTopicReminderWorkerSweep({
    authority: {
      async initialize() { initialized += 1; },
      async assertAssignmentsReady() { asserted += 1; },
      async listSnapshot() { return { assignments: [], scenarioAttachments: [], contentAttachments: [] }; },
    } as any,
    notifications: createMemoryUserNotificationStoreForTest(),
    async loadDatabase() { return { orgs: [], orgTrainings: [], users: [] } as any; },
  });
  assert.deepEqual(result, { considered: 0, inserted: 0 });
  assert.equal(initialized, 1);
  assert.equal(asserted, 1);
});
