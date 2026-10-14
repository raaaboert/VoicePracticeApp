import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { readFileSync } from "node:fs";
import { scheduleSupportTranscriptExpiration, SUPPORT_TRANSCRIPT_CLEANUP_INTERVAL_MS } from "./supportTranscriptExpiration.js";

test("hourly support cleanup invokes the store with current time, unrefs the timer, prevents overlap, and stops on server close", async (t) => {
  let tick: () => void = () => { throw new Error("timer was not registered"); };
  const unref = t.mock.fn();
  const timer = { unref } as unknown as ReturnType<typeof setInterval>;
  t.mock.method(globalThis, "setInterval", ((callback: () => void, interval: number) => {
    tick = callback;
    assert.equal(interval, 60 * 60 * 1000);
    return timer;
  }) as unknown as typeof setInterval);
  const clear = t.mock.method(globalThis, "clearInterval", () => {});
  const calls: Date[] = [];
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const server = new EventEmitter();
  const stop = scheduleSupportTranscriptExpiration({ purgeExpiredTranscripts: async (now) => { calls.push(now); await pending; } }, server);
  assert.equal(SUPPORT_TRANSCRIPT_CLEANUP_INTERVAL_MS, 3_600_000);
  assert.equal(unref.mock.callCount(), 1);
  assert.equal(calls.length, 0);
  const before = Date.now();
  tick(); tick();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].getTime() >= before && calls[0].getTime() <= Date.now());
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  tick();
  assert.equal(calls.length, 2);
  server.emit("close");
  assert.equal(clear.mock.calls[0].arguments[0], timer);
  assert.equal(server.listenerCount("close"), 0);
  stop(); // Lifecycle cleanup is safe to repeat.
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(source, /const server = app\.listen\(PORT/);
  assert.match(source, /scheduleSupportTranscriptExpiration\(supportCaseStore, server\)/);
});

test("failed expiration is logged without sensitive text and the next sweep can retry", async (t) => {
  let tick: () => void = () => {};
  t.mock.method(globalThis, "setInterval", ((callback: () => void) => {
    tick = callback; return { unref() {} };
  }) as unknown as typeof setInterval);
  t.mock.method(globalThis, "clearInterval", () => {});
  const warnings = t.mock.method(console, "warn", () => {});
  let calls = 0;
  const stop = scheduleSupportTranscriptExpiration({ purgeExpiredTranscripts: async () => {
    calls++;
    throw Object.assign(new Error("private transcript sk-secret password C:\\sensitive\\support.json"), { code: "23505" });
  } }, new EventEmitter());
  tick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  tick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(warnings.mock.callCount(), 2);
  const output = JSON.stringify(warnings.mock.calls.map((call) => call.arguments));
  assert.match(output, /purge_failed/);
  assert.match(output, /23505/);
  assert.doesNotMatch(output, /private transcript|sk-secret|password|sensitive|support.json/);
  stop();
});
