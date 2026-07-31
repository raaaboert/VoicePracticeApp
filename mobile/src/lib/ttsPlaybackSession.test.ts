import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackSession } from "./ttsPlaybackSession";

test("active playback cancellation rejects promptly instead of waiting for its long timeout", async () => {
  const abortController = new AbortController();
  let statusListenerCleared = 0;
  let timeoutFired = false;
  const playbackSession = createPlaybackSession({
    abortSignal: abortController.signal,
    clearStatusListener: () => {
      statusListenerCleared += 1;
    },
    createCancellationError: () => new Error("playback cancelled"),
    createTimeoutError: () => new Error("playback timeout"),
    onTimeout: () => {
      timeoutFired = true;
    },
  });
  playbackSession.startPlaybackTimeout(60_000);

  let outcome: "pending" | "resolved" | "rejected" = "pending";
  void playbackSession.playbackFinished.then(
    () => {
      outcome = "resolved";
    },
    () => {
      outcome = "rejected";
    },
  );
  await Promise.resolve();
  assert.equal(outcome, "pending");

  const abortedAtMs = Date.now();
  abortController.abort();
  await assert.rejects(playbackSession.playbackFinished, /playback cancelled/);

  assert.equal(outcome, "rejected");
  assert.ok(Date.now() - abortedAtMs < 500, "abort should settle playback well before the 60-second timeout");
  assert.equal(statusListenerCleared, 1);
  assert.equal(timeoutFired, false);
});

test("an abort during an earlier load phase is handled until the consumer awaits playbackFinished", async () => {
  const abortController = new AbortController();
  const playbackSession = createPlaybackSession({
    abortSignal: abortController.signal,
    clearStatusListener: () => undefined,
    createCancellationError: () => new Error("playback cancelled during load"),
    createTimeoutError: () => new Error("playback timeout"),
  });

  abortController.abort();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

  await assert.rejects(playbackSession.playbackFinished, /cancelled during load/);
});
