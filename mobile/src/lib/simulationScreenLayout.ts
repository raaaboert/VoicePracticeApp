export interface SimulationScreenLayout {
  compactVerticalLayout: boolean;
  tightVerticalLayout: boolean;
  stackStatusPanels: boolean;
  chatCardHeight: number;
  fallbackScrollDockPadding: number;
  actionDockBottomPadding: number;
  actionDockHorizontalPadding: number;
}

const COMPACT_SCREEN_HEIGHT = 760;
const TIGHT_SCREEN_HEIGHT = 700;
const COMPACT_SCREEN_WIDTH = 390;
const TIGHT_SCREEN_WIDTH = 370;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getSimulationScreenLayout(params: {
  windowWidth: number;
  windowHeight: number;
  bottomInset: number;
}): SimulationScreenLayout {
  const width = Number.isFinite(params.windowWidth) ? params.windowWidth : 0;
  const height = Number.isFinite(params.windowHeight) ? params.windowHeight : 0;
  const compactVerticalLayout = width < COMPACT_SCREEN_WIDTH || height < COMPACT_SCREEN_HEIGHT;
  const tightVerticalLayout = width < TIGHT_SCREEN_WIDTH || height < TIGHT_SCREEN_HEIGHT;
  const stackStatusPanels = compactVerticalLayout;
  const boundedChatHeight = clamp(Math.round(height * 0.34), 212, 340);
  const chatCardHeight = tightVerticalLayout
    ? Math.min(252, boundedChatHeight)
    : compactVerticalLayout
      ? Math.min(284, boundedChatHeight)
      : Math.max(296, boundedChatHeight);
  const actionDockBottomPadding = Math.max(compactVerticalLayout ? 8 : 10, params.bottomInset + 6);
  const actionDockHorizontalPadding = compactVerticalLayout ? 14 : 16;
  const fallbackScrollDockPadding = chatCardHeight >= 300 ? 116 : compactVerticalLayout ? 132 : 120;

  return {
    compactVerticalLayout,
    tightVerticalLayout,
    stackStatusPanels,
    chatCardHeight,
    fallbackScrollDockPadding,
    actionDockBottomPadding,
    actionDockHorizontalPadding,
  };
}
