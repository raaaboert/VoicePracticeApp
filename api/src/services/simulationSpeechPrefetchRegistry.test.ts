import assert from "node:assert/strict";
import test from "node:test";

import { SimulationSpeechPrefetchRegistry } from "./simulationSpeechPrefetchRegistry.js";

test("legacy reuse matches authenticated user/org and exact speech while bound clients still require their session identity", async () => {
  const registry = new SimulationSpeechPrefetchRegistry<string>();
  const identity = { correlationId: "shared-correlation", userId: "learner", orgId: "org", preset: "female-bright", text: "Server response" };
  registry.register({ ...identity, userId: "other", sessionId: "foreign", promise: Promise.resolve("foreign audio") });
  registry.register({ ...identity, sessionId: "registered", promise: Promise.resolve("authorized audio") });
  assert.deepEqual(await registry.consume(identity), { status: "hit", value: "authorized audio" });
  assert.deepEqual(await registry.consume({ ...identity, sessionId: "registered" }), { status: "hit", value: "authorized audio" });
  for (const other of [{ ...identity, userId: "unknown" }, { ...identity, orgId: "unrelated" },
    { ...identity, preset: "male-warm" }, { ...identity, text: "Different response" },
    { ...identity, correlationId: "forged-correlation" }, { ...identity, sessionId: "another-session" }]) {
    assert.equal((await registry.consume(other)).status, "miss");
  }
});

test("concurrent foreground retries share one synthesis and failures release it for a fresh retry", async () => {
  const registry = new SimulationSpeechPrefetchRegistry<string>();
  const identity = { correlationId: "response", userId: "u", orgId: "org", sessionId: "session", preset: "female-bright", text: "Real response" };
  let calls = 0, release!: (value: string) => void;
  const synthesize = () => { calls++; return new Promise<string>((resolve) => { release = resolve; }); };
  const first = registry.getOrStart(identity, synthesize), second = registry.getOrStart(identity, synthesize);
  await Promise.resolve(); assert.equal(calls, 1); release("audio");
  assert.deepEqual(await Promise.all([first, second]), ["audio", "audio"]);
  assert.equal(await registry.getOrStart(identity, synthesize), "audio"); assert.equal(calls, 1);
  const failed = { ...identity, correlationId: "failure" };
  await assert.rejects(registry.getOrStart(failed, async () => { throw Error("provider failed"); }));
  assert.equal(await registry.getOrStart(failed, async () => "recovered"), "recovered");
  for (const other of [{ ...identity, orgId: "other" }, { ...identity, sessionId: "other" }, { ...identity, preset: "male-warm" }]) {
    assert.equal(await registry.getOrStart(other, async () => "different audio"), "different audio");
  }
});

test("cache capacity disables new prefetch without evicting existing in-flight work, and TTL permits recovery", async () => {
  const registry = new SimulationSpeechPrefetchRegistry<string>(10, 1);
  const identity = { correlationId: "bounded", userId: "u", preset: "female-bright", text: "Response" };
  registry.register({ ...identity, promise: Promise.resolve("audio"), nowMs: Date.now() });
  assert.equal(registry.hasCapacity(), false);
  assert.deepEqual(await registry.consume({ ...identity, nowMs: Date.now() + 11 }), { status: "miss", reason: "expired" });
  assert.equal(registry.hasCapacity(), true);
});

test("matching foreground TTS and legitimate retry reuse one in-flight or completed prefetch", async () => {
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
  }), { status: "hit", value: { audio: "prefetched" } });
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

test("slow prefetch releases the waiter without losing in-flight work or starting another synthesis", async () => {
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
  }), { status: "hit", value: "too-late-audio" });
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
