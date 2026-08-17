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

export function clampImageZoomScale(scale: number): number {
  "worklet";
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
  "worklet";
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

export function getImageViewerTransform(
  scale: number,
  translation: ImageTranslation,
): Array<{ translateX: number } | { translateY: number } | { scale: number }> {
  "worklet";
  return [
    { translateX: translation.x },
    { translateY: translation.y },
    { scale },
  ];
}
