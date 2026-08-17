export interface SimulationMessageWidthConstraints {
  bubbleMaxWidth: number;
  textMaxWidth: number;
}

export function getSimulationMessageWidthConstraints(params: {
  viewportWidth: number;
  compact: boolean;
}): SimulationMessageWidthConstraints | null {
  if (!Number.isFinite(params.viewportWidth) || params.viewportWidth <= 0) {
    return null;
  }
  const contentHorizontalPadding = params.compact ? 13 : 16;
  const bubbleHorizontalPadding = params.compact ? 11 : 13;
  const bubbleBorderWidth = 1;
  const contentWidth = Math.max(0, params.viewportWidth - contentHorizontalPadding * 2);
  const bubbleMaxWidth = Math.floor(contentWidth * 0.92);
  const bubbleHorizontalInsets = (bubbleHorizontalPadding + bubbleBorderWidth) * 2;
  if (bubbleMaxWidth <= bubbleHorizontalInsets) {
    return null;
  }
  return {
    bubbleMaxWidth,
    textMaxWidth: bubbleMaxWidth - bubbleHorizontalInsets,
  };
}
