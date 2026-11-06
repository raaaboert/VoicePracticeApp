import assert from "node:assert/strict";
import test from "node:test";
import { AnonymousAbuseGuard } from "./anonymousAbuseGuard.js";

test("anonymous guard has a fixed global burst and recovers without a shared-IP lockout window", () => {
  let now = 1000;
  const guard = new AnonymousAbuseGuard(3, 2, 4, () => now);
  for (let i = 0; i < 3; i++) { const release = guard.acquire(); assert.ok(release); release(); }
  assert.equal(guard.acquire(), null);
  now += 500;
  const release = guard.acquire(); assert.ok(release); release();
  assert.equal(guard.acquire(), null);
});

test("anonymous concurrency admission is bounded and release is idempotent", () => {
  const guard = new AnonymousAbuseGuard(20, 10, 2, () => 1000);
  const first = guard.acquire(), second = guard.acquire();
  assert.ok(first); assert.ok(second); assert.equal(guard.acquire(), null);
  first(); first();
  const third = guard.acquire(); assert.ok(third);
  assert.equal(guard.acquire(), null);
  second(); third();
});
