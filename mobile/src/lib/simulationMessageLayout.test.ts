import assert from "node:assert/strict";
import test from "node:test";

import { getSimulationMessageWidthConstraints } from "./simulationMessageLayout";

test("standard transcript width resolves to finite integer bubble and text constraints", () => {
  assert.deepEqual(getSimulationMessageWidthConstraints({ viewportWidth: 390, compact: false }), {
    bubbleMaxWidth: 329,
    textMaxWidth: 301,
  });
});

test("compact transcript width uses the matching content and bubble padding", () => {
  assert.deepEqual(getSimulationMessageWidthConstraints({ viewportWidth: 320, compact: true }), {
    bubbleMaxWidth: 270,
    textMaxWidth: 246,
  });
});

test("invalid or unusably small measurements do not produce unsafe widths", () => {
  assert.equal(getSimulationMessageWidthConstraints({ viewportWidth: 0, compact: false }), null);
  assert.equal(getSimulationMessageWidthConstraints({ viewportWidth: Number.NaN, compact: false }), null);
  assert.equal(getSimulationMessageWidthConstraints({ viewportWidth: 30, compact: false }), null);
});
