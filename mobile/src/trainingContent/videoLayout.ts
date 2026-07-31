export const VIDEO_ASPECT_RATIO_FALLBACK = 16 / 9;

export interface VideoDimensions {
  width: number;
  height: number;
}

export function getValidatedVideoAspectRatio(
  dimensions: VideoDimensions | null | undefined
): number | null {
  if (
    !dimensions ||
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    return null;
  }
  const aspectRatio = dimensions.width / dimensions.height;
  return Number.isFinite(aspectRatio) && aspectRatio > 0
    ? aspectRatio
    : null;
}

export function resolveVideoAspectRatio(
  dimensions: VideoDimensions | null | undefined
): number {
  return (
    getValidatedVideoAspectRatio(dimensions) ?? VIDEO_ASPECT_RATIO_FALLBACK
  );
}
