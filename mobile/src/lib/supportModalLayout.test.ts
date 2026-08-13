import assert from "node:assert/strict";
import test from "node:test";

import {
  getSupportModalKeyboardDismissMode,
  SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS,
} from "./supportModalLayout";

test("support modal keyboard interaction props keep controls tappable", () => {
  assert.equal(SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS, "handled");
  assert.equal(getSupportModalKeyboardDismissMode("ios"), "interactive");
  assert.equal(getSupportModalKeyboardDismissMode("android"), "on-drag");
});
