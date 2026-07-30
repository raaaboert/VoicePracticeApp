import assert from "node:assert/strict";
import test from "node:test";

import {
  getValidatedVideoAspectRatio,
  resolveVideoAspectRatio,
  VIDEO_ASPECT_RATIO_FALLBACK,
} from "./videoLayout";

test("video layout uses 16:9 before metadata is available", () => {
  assert.equal(resolveVideoAspectRatio(null), VIDEO_ASPECT_RATIO_FALLBACK);
});

test("video layout accepts landscape metadata", () => {
  assert.equal(resolveVideoAspectRatio({ width: 1920, height: 1080 }), 16 / 9);
});

test("video layout accepts portrait metadata without blindly inverting it", () => {
  assert.equal(resolveVideoAspectRatio({ width: 1080, height: 1920 }), 9 / 16);
});

test("video layout accepts nonstandard aspect ratios", () => {
  assert.equal(resolveVideoAspectRatio({ width: 1600, height: 1200 }), 4 / 3);
});

test("video layout rejects invalid dimensions and retains the fallback", () => {
  for (const dimensions of [
    { width: 0, height: 1080 },
    { width: 1920, height: 0 },
    { width: -1920, height: 1080 },
    { width: Number.NaN, height: 1080 },
    { width: Number.POSITIVE_INFINITY, height: 1080 },
  ]) {
    assert.equal(getValidatedVideoAspectRatio(dimensions), null);
    assert.equal(
      resolveVideoAspectRatio(dimensions),
      VIDEO_ASPECT_RATIO_FALLBACK
    );
  }
});
