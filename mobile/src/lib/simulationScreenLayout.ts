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
  actionDockBottomPadding: number;
  compactSingleActionDockBottomPadding: number;
  actionDockHorizontalPadding: number;
  compactSingleActionScrollBottomPadding: number;
  compactTwoActionScrollBottomPadding: number;
  regularScrollBottomPadding: number;
}

const COMPACT_SCREEN_HEIGHT = 760;
const TIGHT_SCREEN_HEIGHT = 720;
const COMPACT_SCREEN_WIDTH = 390;
const TIGHT_SCREEN_WIDTH = 350;
const REGULAR_DOCK_BOTTOM_PADDING = 10;
const COMPACT_DOCK_BOTTOM_PADDING = 4;
const REGULAR_DOCK_INSET_OFFSET = 6;
const COMPACT_DOCK_INSET_OFFSET = 4;
const COMPACT_SINGLE_ACTION_DOCK_BOTTOM_PADDING_RATIO = 0.5;
const COMPACT_SINGLE_ACTION_DOCK_BOTTOM_PADDING_FLOOR = 2;
const COMPACT_SINGLE_ACTION_FALLBACK_SCROLL_PADDING = 18;
const COMPACT_TWO_ACTION_FALLBACK_SCROLL_PADDING = 28;
const REGULAR_FALLBACK_SCROLL_PADDING = 32;
const COMPACT_SINGLE_ACTION_SCROLL_DOCK_HEIGHT_CAP = 12;
const COMPACT_TWO_ACTION_SCROLL_DOCK_HEIGHT_CAP = 20;
const REGULAR_SCROLL_DOCK_HEIGHT_CAP = 24;
const COMPACT_SINGLE_ACTION_SCROLL_CLEARANCE = 8;
const COMPACT_TWO_ACTION_SCROLL_CLEARANCE = 12;
const REGULAR_SCROLL_CLEARANCE = 14;

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
  const actionDockBottomPadding = Math.max(
    compactVerticalLayout ? COMPACT_DOCK_BOTTOM_PADDING : REGULAR_DOCK_BOTTOM_PADDING,
    params.bottomInset + (compactVerticalLayout ? COMPACT_DOCK_INSET_OFFSET : REGULAR_DOCK_INSET_OFFSET),
  );
  const compactSingleActionDockBottomPadding = compactVerticalLayout
    ? Math.max(
        COMPACT_SINGLE_ACTION_DOCK_BOTTOM_PADDING_FLOOR,
        Math.ceil(actionDockBottomPadding * COMPACT_SINGLE_ACTION_DOCK_BOTTOM_PADDING_RATIO),
      )
    : actionDockBottomPadding;
  const actionDockHorizontalPadding = compactVerticalLayout ? 14 : 16;
  const compactSingleActionScrollBottomPadding = COMPACT_SINGLE_ACTION_FALLBACK_SCROLL_PADDING;
  const compactTwoActionScrollBottomPadding = COMPACT_TWO_ACTION_FALLBACK_SCROLL_PADDING;
  const regularScrollBottomPadding = REGULAR_FALLBACK_SCROLL_PADDING;

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
    actionDockBottomPadding,
    compactSingleActionDockBottomPadding,
    actionDockHorizontalPadding,
    compactSingleActionScrollBottomPadding,
    compactTwoActionScrollBottomPadding,
    regularScrollBottomPadding,
  };
}

export function getSimulationActionDockBottomPadding(params: {
  layout: SimulationScreenLayout;
  hasSecondaryAction: boolean;
}): number {
  if (params.layout.compactVerticalLayout && !params.hasSecondaryAction) {
    return params.layout.compactSingleActionDockBottomPadding;
  }

  return params.layout.actionDockBottomPadding;
}

export function getSimulationScrollBottomPadding(params: {
  layout: SimulationScreenLayout;
  measuredDockHeight: number;
  hasSecondaryAction: boolean;
}): number {
  const compactSingleAction = params.layout.compactVerticalLayout && !params.hasSecondaryAction;

  if (compactSingleAction) {
    const measuredContribution =
      params.measuredDockHeight > 0
        ? Math.min(params.measuredDockHeight, COMPACT_SINGLE_ACTION_SCROLL_DOCK_HEIGHT_CAP)
            + COMPACT_SINGLE_ACTION_SCROLL_CLEARANCE
        : params.layout.compactSingleActionScrollBottomPadding;
    return Math.max(params.layout.compactSingleActionScrollBottomPadding, measuredContribution);
  }

  if (params.layout.compactVerticalLayout) {
    const measuredContribution =
      params.measuredDockHeight > 0
        ? Math.min(params.measuredDockHeight, COMPACT_TWO_ACTION_SCROLL_DOCK_HEIGHT_CAP)
            + COMPACT_TWO_ACTION_SCROLL_CLEARANCE
        : params.layout.compactTwoActionScrollBottomPadding;
    return Math.max(params.layout.compactTwoActionScrollBottomPadding, measuredContribution);
  }

  const measuredContribution =
    params.measuredDockHeight > 0
      ? Math.min(params.measuredDockHeight, REGULAR_SCROLL_DOCK_HEIGHT_CAP) + REGULAR_SCROLL_CLEARANCE
      : params.layout.regularScrollBottomPadding;
  return Math.max(params.layout.regularScrollBottomPadding, measuredContribution);
}
