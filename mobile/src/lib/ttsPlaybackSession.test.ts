import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  advanceTtsPlaybackStatus,
  createPlaybackSession,
  INITIAL_TTS_PLAYBACK_STATUS_STATE,
} from "./ttsPlaybackSession";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const playbackSource = readFileSync(resolve(sourceDirectory, "ttsPlayback.ts"), "utf8");

test("remote playback reconciles current readiness after subscribing while the load gate stays separate from completion", () => {
  assert.match(playbackSource, /sound.addListener\("playbackStatusUpdate"[\s\S]*?sound.currentStatus/);
  assert.match(playbackSource, /playing: false, didJustFinish: false/);
  assert.match(playbackSource, /promise:\s*playbackSession\.audioLoaded/);
  assert.doesNotMatch(
    playbackSource,
    /promise:\s*Promise\.race\([\s\S]*?playbackSession\.playbackFinished/,
  );
});

test("remote TTS keeps provider pacing authoritative and configures playback before play", () => {
  assert.match(playbackSource, /const REMOTE_TTS_PLAYBACK_RATE = 1\.0;/);
  const rateConfiguration = playbackSource.indexOf(
    "playbackSession.sound.setPlaybackRate(remotePlaybackRate);",
  );
  const playbackStart = playbackSource.indexOf("playbackSession.play();", rateConfiguration);

  assert.ok(rateConfiguration >= 0, "remote playback rate configuration is missing");
  assert.ok(playbackStart > rateConfiguration, "remote playback must be configured before play()");
});

test("a cancelled player cannot arm another timeout or run an already-queued timeout callback", (t) => {
  let fire!: () => void;
  let timers = 0; let timeouts = 0;
  t.mock.method(globalThis, "setTimeout", ((callback: () => void) => { timers++; fire = callback; return 1; }) as unknown as typeof setTimeout);
  t.mock.method(globalThis, "clearTimeout", () => {});
  const abort = new AbortController();
  const session = createPlaybackSession({ abortSignal: abort.signal, clearStatusListener: () => {},
    createCancellationError: () => new Error("cancelled"), createTimeoutError: () => new Error("timeout"),
    onTimeout: () => { timeouts++; } });
  session.startPlaybackTimeout(60_000); abort.abort();
  fire(); session.startPlaybackTimeout(60_000);
  assert.equal(timeouts, 0); assert.equal(timers, 1);
});

test("remote playback cleanup and fallback isolation guards remain intact", () => {
  assert.match(playbackSource, /sound\.pause\(\);[\s\S]*?sound\.remove\(\);/);
  assert.match(
    playbackSource,
    /if \(playbackStarted\) \{[\s\S]*?fallbackAttempted: false,[\s\S]*?outcome: "remote_started_then_failed_unblocked"/,
  );
  assert.match(playbackSource, /return await completeRemoteSuccess\(\);/);
});

test("premature cold finish status cannot complete playback before it starts", () => {
  const state = advanceTtsPlaybackStatus(INITIAL_TTS_PLAYBACK_STATUS_STATE, {
    isLoaded: true,
    playing: false,
    didJustFinish: true,
  });

  assert.equal(state.audioLoaded, true);
  assert.equal(state.playbackStarted, false);
  assert.equal(state.playbackCompleted, false);
});

test("didJustFinish remains ignored until playing has been observed", () => {
  const loaded = advanceTtsPlaybackStatus(INITIAL_TTS_PLAYBACK_STATUS_STATE, {
    isLoaded: true,
    playing: false,
    didJustFinish: false,
  });
  const prematureFinish = advanceTtsPlaybackStatus(loaded, {
    isLoaded: true,
    playing: false,
    didJustFinish: true,
  });

  assert.equal(prematureFinish.playbackStarted, false);
  assert.equal(prematureFinish.playbackCompleted, false);
});

test("one status snapshot cannot establish both playback start and completion", () => {
  const simultaneousStartAndFinish = advanceTtsPlaybackStatus(
    INITIAL_TTS_PLAYBACK_STATUS_STATE,
    {
      isLoaded: true,
      playing: true,
      didJustFinish: true,
    },
  );

  assert.equal(simultaneousStartAndFinish.playbackStarted, true);
  assert.equal(simultaneousStartAndFinish.playbackCompleted, false);
});

test("unloaded then loaded status resolves the load state normally", () => {
  const unloaded = advanceTtsPlaybackStatus(INITIAL_TTS_PLAYBACK_STATUS_STATE, {
    isLoaded: false,
    playing: false,
    didJustFinish: false,
  });
  const loaded = advanceTtsPlaybackStatus(unloaded, {
    isLoaded: true,
    playing: false,
    didJustFinish: false,
  });

  assert.equal(unloaded.audioLoaded, false);
  assert.equal(loaded.audioLoaded, true);
  assert.equal(loaded.playbackStarted, false);
});

test("normal playing then didJustFinish completes with positive start evidence", () => {
  const loaded = advanceTtsPlaybackStatus(INITIAL_TTS_PLAYBACK_STATUS_STATE, {
    isLoaded: true,
    playing: false,
    didJustFinish: false,
  });
  const playing = advanceTtsPlaybackStatus(loaded, {
    isLoaded: true,
    playing: true,
    didJustFinish: false,
  });
  const finished = advanceTtsPlaybackStatus(playing, {
    isLoaded: true,
    playing: false,
    didJustFinish: true,
  });

  assert.equal(playing.playbackStarted, true);
  assert.equal(finished.playbackStarted, true);
  assert.equal(finished.playbackCompleted, true);
});

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

test("loaded playback with no start evidence follows the bounded timeout path", async () => {
  const playbackSession = createPlaybackSession({
    clearStatusListener: () => undefined,
    createCancellationError: () => new Error("playback cancelled"),
    createTimeoutError: () => new Error("playback never started"),
  });

  playbackSession.startPlaybackTimeout(1);
  await assert.rejects(playbackSession.playbackFinished, /playback never started/);
});
