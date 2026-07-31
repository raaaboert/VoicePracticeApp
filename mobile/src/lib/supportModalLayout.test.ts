import assert from "node:assert/strict";
import test from "node:test";

import {
  getSupportModalKeyboardDismissMode,
  getSupportModalMaxHeight,
  SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS,
  SUPPORT_MODAL_MAX_HEIGHT_RATIO,
} from "./supportModalLayout";

test("support modal height is constrained to a responsive phone-safe ratio", () => {
  assert.equal(SUPPORT_MODAL_MAX_HEIGHT_RATIO, 0.84);

  const standardPhoneHeight = 844;
  const modalHeight = getSupportModalMaxHeight(standardPhoneHeight);

  assert.equal(modalHeight, 709);
  assert.ok(modalHeight <= standardPhoneHeight * 0.85);
  assert.ok(modalHeight >= standardPhoneHeight * 0.8);
});

test("support modal height falls back deterministically for invalid measurements", () => {
  assert.equal(getSupportModalMaxHeight(0), 538);
  assert.equal(getSupportModalMaxHeight(Number.NaN), 538);
});

test("support modal keyboard interaction props keep controls tappable", () => {
  assert.equal(SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS, "handled");
  assert.equal(getSupportModalKeyboardDismissMode("ios"), "interactive");
  assert.equal(getSupportModalKeyboardDismissMode("android"), "on-drag");
});
