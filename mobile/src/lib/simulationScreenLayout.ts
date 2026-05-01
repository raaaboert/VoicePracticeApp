export interface SimulationScreenLayout {
  compactVerticalLayout: boolean;
  tightVerticalLayout: boolean;
  useCompactScenarioCard: boolean;
  useCompactEnginePresentation: boolean;
  useCompactEngineStatus: boolean;
  useCompactTranscript: boolean;
  useCompactTimerSummary: boolean;
  useCondensedResponseMode: boolean;
  showScenarioDescription: boolean;
  showExtendedScenarioMeta: boolean;
  stackStatusPanels: boolean;
  chatCardHeight: number;
  scrollDockSafetyGap: number;
  fallbackScrollDockPadding: number;
  actionDockBottomPadding: number;
  actionDockHorizontalPadding: number;
}

const COMPACT_SCREEN_HEIGHT = 760;
const TIGHT_SCREEN_HEIGHT = 720;
const COMPACT_SCREEN_WIDTH = 390;
const TIGHT_SCREEN_WIDTH = 350;

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
  const useCompactScenarioCard = compactVerticalLayout;
  const useCompactEnginePresentation = compactVerticalLayout;
  const useCompactEngineStatus = compactVerticalLayout;
  const useCompactTranscript = compactVerticalLayout;
  const useCompactTimerSummary = compactVerticalLayout;
  const useCondensedResponseMode = compactVerticalLayout;
  const showScenarioDescription = !useCompactScenarioCard;
  const showExtendedScenarioMeta = !useCompactScenarioCard;
  const stackStatusPanels = width < 340;
  const boundedChatHeight = clamp(Math.round(height * (tightVerticalLayout ? 0.43 : compactVerticalLayout ? 0.41 : 0.35)), 272, 360);
  const chatCardHeight = tightVerticalLayout
    ? Math.min(332, boundedChatHeight)
    : compactVerticalLayout
      ? Math.min(352, boundedChatHeight)
      : Math.max(312, boundedChatHeight);
  const scrollDockSafetyGap = compactVerticalLayout ? 24 : 18;
  const actionDockBottomPadding = Math.max(compactVerticalLayout ? 8 : 10, params.bottomInset + 6);
  const actionDockHorizontalPadding = compactVerticalLayout ? 14 : 16;
  const fallbackMeasuredDockHeight = compactVerticalLayout ? 120 : 132;
  const fallbackScrollDockPadding = fallbackMeasuredDockHeight + actionDockBottomPadding + scrollDockSafetyGap;

  return {
    compactVerticalLayout,
    tightVerticalLayout,
    useCompactScenarioCard,
    useCompactEnginePresentation,
    useCompactEngineStatus,
    useCompactTranscript,
    useCompactTimerSummary,
    useCondensedResponseMode,
    showScenarioDescription,
    showExtendedScenarioMeta,
    stackStatusPanels,
    chatCardHeight,
    scrollDockSafetyGap,
    fallbackScrollDockPadding,
    actionDockBottomPadding,
    actionDockHorizontalPadding,
  };
}
