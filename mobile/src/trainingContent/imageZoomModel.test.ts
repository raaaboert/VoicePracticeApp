import assert from "node:assert/strict";
import test from "node:test";

import {
  clampImageTranslation,
  clampImageZoomScale,
  createImageGestureBaseline,
  fitImageWithinViewport,
  getImageViewerTransform,
  getTouchDistance,
  updateImageGesture,
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

test("pinch distance uses both native touch coordinates", () => {
  assert.equal(getTouchDistance({ pageX: 10, pageY: 10 }, { pageX: 40, pageY: 50 }), 50);
});

test("viewer transform keeps screen-pixel translation outside scaling", () => {
  assert.deepEqual(getImageViewerTransform(3, { x: 40, y: -25 }), [
    { translateX: 40 },
    { translateY: -25 },
    { scale: 3 },
  ]);
});

test("a second finger establishes a fresh pinch baseline without jumping", () => {
  const oneFingerBaseline = createImageGestureBaseline({
    scale: 2,
    translation: { x: 35, y: -20 },
    touches: [{ pageX: 100, pageY: 100 }],
  });
  const transition = updateImageGesture({
    baseline: oneFingerBaseline,
    currentScale: 2,
    currentTranslation: { x: 35, y: -20 },
    touches: [{ pageX: 80, pageY: 100 }, { pageX: 120, pageY: 100 }],
    gestureDx: 12,
    gestureDy: 4,
  });

  assert.equal(transition.transform, null);
  assert.equal(transition.baseline.distance, 40);
  const pinch = updateImageGesture({
    baseline: transition.baseline,
    currentScale: 2,
    currentTranslation: { x: 35, y: -20 },
    touches: [{ pageX: 60, pageY: 100 }, { pageX: 140, pageY: 100 }],
    gestureDx: 12,
    gestureDy: 4,
  });
  assert.deepEqual(pinch.transform, {
    scale: 4,
    translation: { x: 35, y: -20 },
  });
});

test("lifting a pinch finger establishes a fresh pan baseline without scale or position jumps", () => {
  const pinchBaseline = createImageGestureBaseline({
    scale: 2.5,
    translation: { x: 45, y: -30 },
    touches: [{ pageX: 50, pageY: 70 }, { pageX: 150, pageY: 70 }],
  });
  const transition = updateImageGesture({
    baseline: pinchBaseline,
    currentScale: 3,
    currentTranslation: { x: 55, y: -35 },
    touches: [{ pageX: 150, pageY: 70 }],
    gestureDx: 20,
    gestureDy: 10,
  });
  assert.equal(transition.transform, null);

  const pan = updateImageGesture({
    baseline: transition.baseline,
    currentScale: 3,
    currentTranslation: { x: 55, y: -35 },
    touches: [{ pageX: 165, pageY: 75 }],
    gestureDx: 35,
    gestureDy: 15,
  });
  assert.deepEqual(pan.transform, {
    scale: 3,
    translation: { x: 70, y: -30 },
  });
});
