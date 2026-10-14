import assert from "node:assert/strict";
import test from "node:test";
import { startNotificationPolling } from "./notificationPolling";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(initial: DocumentVisibilityState = "visible") {
  const visibility = Object.assign(new EventTarget(), { visibilityState: initial });
  const timers = new Map<number, () => void>();
  let id = 0;
  const scheduler = {
    setInterval(callback: TimerHandler, delay?: number) {
      assert.equal(delay, 60_000);
      assert.equal(typeof callback, "function");
      timers.set(++id, callback as () => void);
      return id;
    },
    clearInterval(timer?: number) { if (timer !== undefined) timers.delete(timer); },
  };
  return {
    visibility, scheduler, timers,
    change(state: DocumentVisibilityState) {
      visibility.visibilityState = state;
      visibility.dispatchEvent(new Event("visibilitychange"));
    },
    tick() { for (const callback of timers.values()) callback(); },
  };
}

test("inbox polls every 60 seconds only while visible and refreshes on tab return", async () => {
  const h = harness();
  let reads = 0;
  const polling = startNotificationPolling({ ...h, intervalMs: 60_000, load: async () => { reads++; } });
  await settle();
  assert.equal(reads, 1);
  assert.equal(h.timers.size, 1);
  h.tick(); await settle();
  assert.equal(reads, 2);
  h.change("hidden");
  h.tick(); polling.refresh(); await settle();
  assert.equal(reads, 2);
  assert.equal(h.timers.size, 0);
  h.change("visible"); await settle();
  assert.equal(reads, 3);
  h.change("visible"); await settle();
  assert.equal(h.timers.size, 1);
  polling.refresh(); await settle(); // Opening the panel requests a fresh read.
  assert.equal(reads, 5);
  polling.stop(); h.change("visible"); polling.refresh();
  assert.equal(h.timers.size, 0);
  assert.equal(reads, 5);
});

test("hidden initial tabs do not fetch or schedule until visible", async () => {
  const h = harness("hidden");
  let reads = 0;
  const polling = startNotificationPolling({ ...h, intervalMs: 60_000, load: async () => { reads++; } });
  polling.refresh(); await settle();
  assert.equal(reads, 0);
  assert.equal(h.timers.size, 0);
  h.change("visible"); await settle();
  assert.equal(reads, 1);
  polling.stop();
});

test("panel, timer and visibility refreshes coalesce without overlapping reads; cleanup aborts", async () => {
  const h = harness();
  const reads: { signal: AbortSignal; resolve: () => void }[] = [];
  const polling = startNotificationPolling({ ...h, intervalMs: 60_000,
    load: (signal) => new Promise<void>((resolve) => { reads.push({ signal, resolve }); }),
  });
  h.tick(); polling.refresh(); polling.refresh(); h.change("hidden"); h.change("visible");
  assert.equal(reads.length, 1);
  assert.equal(h.timers.size, 1);
  reads[0]!.resolve(); await settle();
  assert.equal(reads.length, 2);
  polling.stop();
  assert.equal(reads[1]!.signal.aborted, true);
  reads[1]!.resolve(); await settle();
  assert.equal(reads.length, 2);
  assert.equal(h.timers.size, 0);
});

test("a failed inbox read does not stop later refreshes", async () => {
  const h = harness();
  let reads = 0;
  const polling = startNotificationPolling({ ...h, intervalMs: 60_000,
    load: async () => { reads++; throw new Error("offline"); },
  });
  await settle(); h.tick(); await settle();
  assert.equal(reads, 2);
  polling.stop();
});
