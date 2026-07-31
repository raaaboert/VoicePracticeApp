import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTrainingContentAssetTransition,
  canTransitionTrainingContentAsset,
} from "./trainingContentAssetStateMachine.js";

test("Training Content asset state machine permits only the documented lifecycle", () => {
  assert.equal(canTransitionTrainingContentAsset("pending", "uploaded"), true);
  assert.equal(canTransitionTrainingContentAsset("pending", "rejected"), true);
  assert.equal(canTransitionTrainingContentAsset("pending", "expired"), true);
  assert.equal(canTransitionTrainingContentAsset("uploaded", "processing"), true);
  assert.equal(canTransitionTrainingContentAsset("processing", "ready"), true);
  assert.equal(canTransitionTrainingContentAsset("ready", "superseded"), true);

  for (const [from, to] of [
    ["pending", "ready"],
    ["ready", "processing"],
    ["rejected", "ready"],
    ["expired", "pending"],
    ["superseded", "ready"],
  ] as const) {
    assert.equal(canTransitionTrainingContentAsset(from, to), false);
    assert.throws(
      () => assertTrainingContentAssetTransition(from, to),
      /cannot transition/
    );
  }
});
