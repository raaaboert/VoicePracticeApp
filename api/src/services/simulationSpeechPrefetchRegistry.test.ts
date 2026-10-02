import assert from "node:assert/strict";
import test from "node:test";

import { SimulationSpeechPrefetchRegistry } from "./simulationSpeechPrefetchRegistry.js";

test("matching foreground TTS consumes an in-flight prefetch exactly once", async () => {
  const registry = new SimulationSpeechPrefetchRegistry<{ audio: string }>();
  let resolvePrefetch!: (value: { audio: string }) => void;
  const promise = new Promise<{ audio: string }>((resolve) => {
    resolvePrefetch = resolve;
  });
  registry.register({
    correlationId: "turn-1",
    userId: "user-a",
    preset: "female-bright",
    text: "Hello   there",
    promise,
    nowMs: 100,
  });

  const consumed = registry.consume({
    correlationId: "turn-1",
    userId: "user-a",
    preset: "female-bright",
    text: "Hello there",
    nowMs: 200,
  });
  resolvePrefetch({ audio: "prefetched" });
  assert.deepEqual(await consumed, { status: "hit", value: { audio: "prefetched" } });
  assert.deepEqual(await registry.consume({
    correlationId: "turn-1",
    userId: "user-a",
    preset: "female-bright",
    text: "Hello there",
    nowMs: 300,
  }), { status: "miss", reason: "not_found" });
});

test("resolved and nearly-ready prefetches win inside the bounded reuse window", async () => {
  const resolved = new SimulationSpeechPrefetchRegistry<string>();
  resolved.register({
    correlationId: "ready",
    userId: "user-a",
    preset: "female-bright",
    text: "Ready",
    promise: Promise.resolve("ready-audio"),
  });
  assert.deepEqual(await resolved.consume({
    correlationId: "ready",
    userId: "user-a",
    preset: "female-bright",
    text: "Ready",
    waitMs: 20,
  }), { status: "hit", value: "ready-audio" });

  const nearlyReady = new SimulationSpeechPrefetchRegistry<string>();
  let resolvePrefetch!: (value: string) => void;
  nearlyReady.register({
    correlationId: "nearly-ready",
    userId: "user-a",
    preset: "female-bright",
    text: "Soon",
    promise: new Promise<string>((resolve) => {
      resolvePrefetch = resolve;
    }),
  });
  setTimeout(() => resolvePrefetch("late-audio"), 5);
  assert.deepEqual(await nearlyReady.consume({
    correlationId: "nearly-ready",
    userId: "user-a",
    preset: "female-bright",
    text: "Soon",
    waitMs: 50,
  }), { status: "hit", value: "late-audio" });
});

test("slow prefetch releases the caller after the bounded wait and cannot be consumed twice", async () => {
  const registry = new SimulationSpeechPrefetchRegistry<string>();
  let resolvePrefetch!: (value: string) => void;
  const promise = new Promise<string>((resolve) => {
    resolvePrefetch = resolve;
  });
  registry.register({
    correlationId: "slow",
    userId: "user-a",
    preset: "female-bright",
    text: "Slow",
    promise,
  });

  const startedAtMs = Date.now();
  assert.deepEqual(await registry.consume({
    correlationId: "slow",
    userId: "user-a",
    preset: "female-bright",
    text: "Slow",
    waitMs: 10,
  }), { status: "timeout" });
  assert.ok(Date.now() - startedAtMs < 200, "bounded reuse wait did not release promptly");

  resolvePrefetch("too-late-audio");
  await promise;
  assert.deepEqual(await registry.consume({
    correlationId: "slow",
    userId: "user-a",
    preset: "female-bright",
    text: "Slow",
  }), { status: "miss", reason: "not_found" });
});

test("a late rejected prefetch is handled after timeout without changing the consumed result", async () => {
  const registry = new SimulationSpeechPrefetchRegistry<string>();
  let rejectPrefetch!: (error: Error) => void;
  const promise = new Promise<string>((_resolve, reject) => {
    rejectPrefetch = reject;
  });
  registry.register({
    correlationId: "late-failure",
    userId: "user-a",
    preset: "female-bright",
    text: "Late failure",
    promise,
  });
  assert.deepEqual(await registry.consume({
    correlationId: "late-failure",
    userId: "user-a",
    preset: "female-bright",
    text: "Late failure",
    waitMs: 1,
  }), { status: "timeout" });
  rejectPrefetch(new Error("late provider failure"));
  await assert.rejects(promise, /late provider failure/);
});

test("identity, preset, and text mismatches fail closed without exposing cached audio", async () => {
  for (const mismatch of [
    { userId: "user-b", preset: "female-bright", text: "Expected", reason: "user_mismatch" },
    { userId: "user-a", preset: "female-warm", text: "Expected", reason: "preset_mismatch" },
    { userId: "user-a", preset: "female-bright", text: "Different", reason: "text_mismatch" },
  ] as const) {
    const registry = new SimulationSpeechPrefetchRegistry<{ audio: string }>();
    registry.register({
      correlationId: "turn-1",
      userId: "user-a",
      preset: "female-bright",
      text: "Expected",
      promise: Promise.resolve({ audio: "private" }),
      nowMs: 100,
    });
    assert.deepEqual(await registry.consume({
      correlationId: "turn-1",
      userId: mismatch.userId,
      preset: mismatch.preset,
      text: mismatch.text,
      nowMs: 200,
    }), { status: "miss", reason: mismatch.reason });
  }
});

test("expired, failed, and empty prefetches have deterministic outcomes", async () => {
  const expired = new SimulationSpeechPrefetchRegistry<string>(100);
  expired.register({
    correlationId: "expired",
    userId: "user-a",
    preset: "female-bright",
    text: "Text",
    promise: Promise.resolve("audio"),
    nowMs: 0,
  });
  assert.deepEqual(await expired.consume({
    correlationId: "expired",
    userId: "user-a",
    preset: "female-bright",
    text: "Text",
    nowMs: 101,
  }), { status: "miss", reason: "expired" });

  for (const promise of [Promise.resolve(null), Promise.reject(new Error("failed"))]) {
    const registry = new SimulationSpeechPrefetchRegistry<string>();
    registry.register({
      correlationId: "empty",
      userId: "user-a",
      preset: "female-bright",
      text: "Text",
      promise,
      nowMs: 0,
    });
    assert.deepEqual(await registry.consume({
      correlationId: "empty",
      userId: "user-a",
      preset: "female-bright",
      text: "Text",
      nowMs: 1,
    }), { status: "hit", value: null });
  }
});
