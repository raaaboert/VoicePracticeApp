import { SimulationScorecard, SimulationScoringStatus } from "../types";

export interface ScorecardViewModel {
  showLoading: boolean;
  showVerifiedScore: boolean;
  showScoreUnavailable: boolean;
  showScoreWarning: boolean;
  showLegacyRubric: boolean;
  showTranscriptActions: boolean;
  showSupportActions: boolean;
  showRunAnother: boolean;
  scoreUnavailableTitle: string | null;
  scoreUnavailableBody: string | null;
  scoreWarning: string | null;
  transcriptPrivacyCopy: string;
  supportButtonLabel: string;
  supportCopy: string;
}

export function buildScorecardViewModel(params: {
  scoringStatus: SimulationScoringStatus;
  scorecard: SimulationScorecard | null;
  error: string | null;
}): ScorecardViewModel {
  const showLoading = params.scoringStatus === "scoring_in_progress";
  const showVerifiedScore = params.scoringStatus === "scored" && params.scorecard !== null && !showLoading;
  const showNotScored = params.scoringStatus === "not_scored";
  const showScoreUnavailable =
    !showLoading
    && (
      params.scoringStatus === "score_unavailable"
      || showNotScored
      || (params.scoringStatus === "scored" && params.scorecard === null)
    );
  const unavailableFallback =
    showNotScored
      ? "This session ended before there were enough user responses to generate a verified scorecard. Complete at least 3 user responses before ending the session."
      : "Your simulation completed, but the scoring service failed before a verified score could be created. No score was saved or reported.";
  const supportButtonLabel = showNotScored
    ? "Share feedback about this session"
    : showScoreUnavailable
      ? "Report an issue with this session"
      : "Concerns with this session or score?";
  const supportCopy = showNotScored
    ? "You can send a note to support if something felt off. You can optionally consent to share a transcript so we can investigate."
    : showScoreUnavailable
      ? "If something went wrong, you can send a note to support. You can optionally consent to share a transcript so we can investigate."
      : "If something felt off, you can send a note to support. You can optionally consent to share a transcript so we can investigate.";

  return {
    showLoading,
    showVerifiedScore,
    showScoreUnavailable,
    showScoreWarning: showVerifiedScore && Boolean(params.error),
    showLegacyRubric: showVerifiedScore,
    showTranscriptActions: !showLoading,
    showSupportActions: !showLoading,
    showRunAnother: true,
    scoreUnavailableTitle:
      showScoreUnavailable
        ? showNotScored
          ? "No scorecard created"
          : "We couldn't generate a score for this session."
        : null,
    scoreUnavailableBody: showScoreUnavailable ? params.error ?? unavailableFallback : null,
    scoreWarning: showVerifiedScore ? params.error : null,
    transcriptPrivacyCopy: showVerifiedScore
      ? "Peritio does not keep the transcript from this session after you leave this screen. Only score and usage data remain in the product unless you choose to share a transcript with support."
      : "Peritio does not keep the transcript from this session after you leave this screen. Only usage data remains in the product unless you choose to share a transcript with support.",
    supportButtonLabel,
    supportCopy,
  };
}
