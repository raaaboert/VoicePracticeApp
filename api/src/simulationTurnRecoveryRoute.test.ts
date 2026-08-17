import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "index.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

const awaitRouteStart = source.indexOf(
  'app.get("/mobile/users/:userId/ai/submit-turn-await/:correlationId"',
);
const nextRouteStart = source.indexOf('app.post("/mobile/users/:userId/ai/tts"', awaitRouteStart);
assert.ok(awaitRouteStart >= 0 && nextRouteStart > awaitRouteStart, "Could not locate submit-turn-await route.");
const awaitRoute = source.slice(awaitRouteStart, nextRouteStart);

test("resolved unified turn results remain replayable beyond await time plus mobile background grace", () => {
  assert.match(source, /const PENDING_UNIFIED_TURN_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(awaitRoute, /response\.json\(result\)/);
  assert.match(awaitRoute, /stage: "pending_turn_retained_for_recovery"/);
  assert.doesNotMatch(
    awaitRoute,
    /cleanupPendingUnifiedSubmitTurn\(\{[\s\S]*?reason: "after_resolve"/,
  );
});

test("failed unified turn results still use the existing bounded cleanup path", () => {
  assert.match(
    awaitRoute,
    /cleanupPendingUnifiedSubmitTurn\(\{[\s\S]*?reason: "after_reject"/,
  );
});
