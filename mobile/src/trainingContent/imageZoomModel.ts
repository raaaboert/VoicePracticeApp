export const MIN_IMAGE_ZOOM_SCALE = 1;
export const MAX_IMAGE_ZOOM_SCALE = 4;

export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageTranslation {
  x: number;
  y: number;
}

export interface ImageTouchPoint {
  pageX: number;
  pageY: number;
}

export interface ImageGestureBaseline {
  scale: number;
  translation: ImageTranslation;
  distance: number | null;
  midpoint: ImageTranslation | null;
  gestureDx: number;
  gestureDy: number;
}

export interface ImageGestureTransform {
  scale: number;
  translation: ImageTranslation;
}

export function clampImageZoomScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return MIN_IMAGE_ZOOM_SCALE;
  }
  return Math.min(MAX_IMAGE_ZOOM_SCALE, Math.max(MIN_IMAGE_ZOOM_SCALE, scale));
}

export function fitImageWithinViewport(image: ImageSize, viewport: ImageSize): ImageSize {
  if (
    !Number.isFinite(image.width)
    || !Number.isFinite(image.height)
    || !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || image.width <= 0
    || image.height <= 0
    || viewport.width <= 0
    || viewport.height <= 0
  ) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  return {
    width: image.width * scale,
    height: image.height * scale,
  };
}

export function clampImageTranslation(params: {
  translation: ImageTranslation;
  fittedImage: ImageSize;
  viewport: ImageSize;
  scale: number;
}): ImageTranslation {
  const scale = clampImageZoomScale(params.scale);
  if (scale === MIN_IMAGE_ZOOM_SCALE) {
    return { x: 0, y: 0 };
  }
  const maximumX = Math.max(0, (params.fittedImage.width * scale - params.viewport.width) / 2);
  const maximumY = Math.max(0, (params.fittedImage.height * scale - params.viewport.height) / 2);
  return {
    x: Math.min(maximumX, Math.max(-maximumX, params.translation.x)),
    y: Math.min(maximumY, Math.max(-maximumY, params.translation.y)),
  };
}

export function getTouchDistance(
  first: ImageTouchPoint,
  second: ImageTouchPoint,
): number {
  return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
}

export function createImageGestureBaseline(params: {
  scale: number;
  translation: ImageTranslation;
  touches: readonly ImageTouchPoint[];
  gestureDx?: number;
  gestureDy?: number;
}): ImageGestureBaseline {
  const first = params.touches[0];
  const second = params.touches[1];
  return {
    scale: params.scale,
    translation: params.translation,
    distance: first && second ? getTouchDistance(first, second) : null,
    midpoint: first && second
      ? { x: (first.pageX + second.pageX) / 2, y: (first.pageY + second.pageY) / 2 }
      : null,
    gestureDx: params.gestureDx ?? 0,
    gestureDy: params.gestureDy ?? 0,
  };
}

export function updateImageGesture(params: {
  baseline: ImageGestureBaseline;
  currentScale: number;
  currentTranslation: ImageTranslation;
  touches: readonly ImageTouchPoint[];
  gestureDx: number;
  gestureDy: number;
}): { baseline: ImageGestureBaseline; transform: ImageGestureTransform | null } {
  const first = params.touches[0];
  const second = params.touches[1];
  if (first && second) {
    const distance = getTouchDistance(first, second);
    const midpoint = {
      x: (first.pageX + second.pageX) / 2,
      y: (first.pageY + second.pageY) / 2,
    };
    if (params.baseline.distance === null || params.baseline.distance <= 0) {
      return {
        baseline: createImageGestureBaseline({
          scale: params.currentScale,
          translation: params.currentTranslation,
          touches: params.touches,
          gestureDx: params.gestureDx,
          gestureDy: params.gestureDy,
        }),
        transform: null,
      };
    }
    return {
      baseline: params.baseline,
      transform: {
        scale: params.baseline.scale * (distance / params.baseline.distance),
        translation: {
          x: params.baseline.translation.x + (midpoint.x - (params.baseline.midpoint?.x ?? midpoint.x)),
          y: params.baseline.translation.y + (midpoint.y - (params.baseline.midpoint?.y ?? midpoint.y)),
        },
      },
    };
  }

  if (params.baseline.distance !== null) {
    return {
      baseline: createImageGestureBaseline({
        scale: params.currentScale,
        translation: params.currentTranslation,
        touches: params.touches,
        gestureDx: params.gestureDx,
        gestureDy: params.gestureDy,
      }),
      transform: null,
    };
  }

  if (params.currentScale <= MIN_IMAGE_ZOOM_SCALE) {
    return { baseline: params.baseline, transform: null };
  }
  return {
    baseline: params.baseline,
    transform: {
      scale: params.baseline.scale,
      translation: {
        x: params.baseline.translation.x + (params.gestureDx - params.baseline.gestureDx),
        y: params.baseline.translation.y + (params.gestureDy - params.baseline.gestureDy),
      },
    },
  };
}

export function getImageViewerTransform(
  scale: number,
  translation: ImageTranslation,
): Array<{ translateX: number } | { translateY: number } | { scale: number }> {
  return [
    { translateX: translation.x },
    { translateY: translation.y },
    { scale },
  ];
}
