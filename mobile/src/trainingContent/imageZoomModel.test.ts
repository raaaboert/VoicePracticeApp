import assert from "node:assert/strict";
import test from "node:test";

import {
  clampImageTranslation,
  clampImageZoomScale,
  fitImageWithinViewport,
  getImageViewerTransform,
} from "./imageZoomModel";

test("image zoom scale stays within the supported pinch range", () => {
  assert.equal(clampImageZoomScale(0.25), 1);
  assert.equal(clampImageZoomScale(2.5), 2.5);
  assert.equal(clampImageZoomScale(8), 4);
});

test("image viewer contains landscape and portrait assets within the viewport", () => {
  assert.deepEqual(fitImageWithinViewport({ width: 1600, height: 900 }, { width: 400, height: 700 }), {
    width: 400,
    height: 225,
  });
  assert.deepEqual(fitImageWithinViewport({ width: 900, height: 1600 }, { width: 400, height: 700 }), {
    width: 393.75,
    height: 700,
  });
  assert.deepEqual(fitImageWithinViewport({ width: 1200, height: 1200 }, { width: 400, height: 700 }), {
    width: 400,
    height: 400,
  });
});

test("panning is bounded by the scaled image edges and resets at minimum zoom", () => {
  const parameters = {
    fittedImage: { width: 400, height: 300 },
    viewport: { width: 400, height: 600 },
  };
  assert.deepEqual(clampImageTranslation({ ...parameters, scale: 1, translation: { x: 50, y: 50 } }), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(clampImageTranslation({ ...parameters, scale: 3, translation: { x: 900, y: -900 } }), {
    x: 400,
    y: -150,
  });
});

test("viewer transform keeps screen-pixel translation outside scaling", () => {
  assert.deepEqual(getImageViewerTransform(3, { x: 40, y: -25 }), [
    { translateX: 40 },
    { translateY: -25 },
    { scale: 3 },
  ]);
});
