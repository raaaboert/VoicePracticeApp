export const TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX = 48;

export interface TranscriptScrollMetrics {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
}

export function isTranscriptNearBottom(
  metrics: TranscriptScrollMetrics,
  thresholdPx = TRANSCRIPT_NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  const remaining = Math.max(
    0,
    metrics.contentHeight - Math.max(0, metrics.viewportHeight) - Math.max(0, metrics.offsetY),
  );
  return remaining <= Math.max(0, thresholdPx);
}

export function shouldFollowTranscriptAfterMessage(isNearBottom: boolean): boolean {
  return isNearBottom;
}
