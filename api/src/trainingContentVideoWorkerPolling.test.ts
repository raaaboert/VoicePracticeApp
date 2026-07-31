import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";

import {
  waitForTrainingContentVideoPoll,
} from "./trainingContentVideoWorkerPolling.js";

test("completed idle polls remove their shutdown abort listener", async () => {
  const controller = new AbortController();
  for (let index = 0; index < 15; index += 1) {
    await waitForTrainingContentVideoPoll(1, controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("shutdown settles an active idle poll and removes its listener", async () => {
  const controller = new AbortController();
  const waiting = waitForTrainingContentVideoPoll(60_000, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  controller.abort();
  await waiting;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
