export interface SimulationScreenLayout {
  compactVerticalLayout: boolean;
  tightVerticalLayout: boolean;
  useCompactScenarioCard: boolean;
  useCompactEnginePresentation: boolean;
  useCompactEngineStatus: boolean;
  useCompactTranscript: boolean;
  useCompactTimerSummary: boolean;
  showResponseModeCard: boolean;
  showScenarioDescription: boolean;
  showExtendedScenarioMeta: boolean;
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
const REGULAR_DOCK_SAFETY_GAP = 18;
const COMPACT_DOCK_SAFETY_GAP = 24;
const REGULAR_DOCK_BOTTOM_PADDING = 10;
const COMPACT_DOCK_BOTTOM_PADDING = 4;
const REGULAR_DOCK_INSET_OFFSET = 6;
const COMPACT_DOCK_INSET_OFFSET = 4;
const REGULAR_DOCK_FALLBACK_HEIGHT = 132;
const COMPACT_DOCK_FALLBACK_HEIGHT = 108;

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
  const showResponseModeCard = !compactVerticalLayout;
  const showScenarioDescription = !useCompactScenarioCard;
  const showExtendedScenarioMeta = !useCompactScenarioCard;
  const boundedChatHeight = clamp(Math.round(height * (tightVerticalLayout ? 0.43 : compactVerticalLayout ? 0.41 : 0.35)), 272, 360);
  const compactTranscriptBoost = compactVerticalLayout ? (tightVerticalLayout ? 20 : 28) : 0;
  const chatCardHeight = tightVerticalLayout
    ? Math.min(352, boundedChatHeight + compactTranscriptBoost)
    : compactVerticalLayout
      ? Math.min(372, boundedChatHeight + compactTranscriptBoost)
      : Math.max(312, boundedChatHeight);
  const scrollDockSafetyGap = compactVerticalLayout ? COMPACT_DOCK_SAFETY_GAP : REGULAR_DOCK_SAFETY_GAP;
  const actionDockBottomPadding = Math.max(
    compactVerticalLayout ? COMPACT_DOCK_BOTTOM_PADDING : REGULAR_DOCK_BOTTOM_PADDING,
    params.bottomInset + (compactVerticalLayout ? COMPACT_DOCK_INSET_OFFSET : REGULAR_DOCK_INSET_OFFSET),
  );
  const actionDockHorizontalPadding = compactVerticalLayout ? 14 : 16;
  const fallbackMeasuredDockHeight = compactVerticalLayout
    ? COMPACT_DOCK_FALLBACK_HEIGHT
    : REGULAR_DOCK_FALLBACK_HEIGHT;
  const fallbackScrollDockPadding = fallbackMeasuredDockHeight + actionDockBottomPadding + scrollDockSafetyGap;

  return {
    compactVerticalLayout,
    tightVerticalLayout,
    useCompactScenarioCard,
    useCompactEnginePresentation,
    useCompactEngineStatus,
    useCompactTranscript,
    useCompactTimerSummary,
    showResponseModeCard,
    showScenarioDescription,
    showExtendedScenarioMeta,
    chatCardHeight,
    scrollDockSafetyGap,
    fallbackScrollDockPadding,
    actionDockBottomPadding,
    actionDockHorizontalPadding,
  };
}
