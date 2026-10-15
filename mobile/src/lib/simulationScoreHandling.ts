import { DialogueMessage, SimulationEvaluationResult, SimulationScorecard } from "../types";
import { MobileApiError } from "./apiError";

export const MIN_USER_RESPONSES_FOR_VERIFIED_SCORECARD = 3;

export type ScoringFailureCategory =
  | "auth_or_config"
  | "invalid_input"
  | "network_timeout"
  | "rate_limited"
  | "upstream_scoring_failure"
  | "persistence_failure"
  | "score_recovery_miss"
  | "local_mode"
  | "api_unconfigured"
  | "scoring_disabled"
  | "unknown";

export interface ResolvedSimulationScoreOutcome {
  kind: "scored" | "not_scored";
  scorecard: SimulationScorecard | null;
  message: string | null;
}

export function countUserResponsesForVerifiedScorecard(history: readonly DialogueMessage[]): number {
  return history.filter((message) => message.role === "user" && message.content.trim().length > 0).length;
}

export function buildInsufficientEvidenceMessage(
  minimumUserTurns = MIN_USER_RESPONSES_FOR_VERIFIED_SCORECARD,
): string {
  return `This session ended before there were enough user responses to generate a verified scorecard. Complete at least ${minimumUserTurns} user responses before ending the session.`;
}

export function resolveSimulationScoreOutcome(result: SimulationEvaluationResult): ResolvedSimulationScoreOutcome {
  if (result.status === "not_scored") {
    return {
      kind: "not_scored",
      scorecard: null,
      message: buildInsufficientEvidenceMessage(result.minimumUserTurns)
    };
  }

  return {
    kind: "scored",
    scorecard: result.scorecard,
    message: null
  };
}

export function classifySimulationScoreFailure(error: unknown): ScoringFailureCategory {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  if (error instanceof MobileApiError) {
    switch (error.code) {
      case "ai_timeout": return "network_timeout";
      case "ai_budget_limit": return "rate_limited";
      case "ai_unavailable":
      case "score_generation_failed": return "upstream_scoring_failure";
    }
  }

  const message = error.message.trim().toLowerCase();

  if (
    message.includes("missing mobile auth context")
    || message.includes("missing mobile token")
    || message.includes("invalid mobile token")
    || message.includes("scoring is currently disabled")
    || message.includes("simulation unavailable")
  ) {
    return "auth_or_config";
  }

  if (
    message.includes("invalid scenario")
    || message.includes("user not found")
    || message.includes("no transcribed user text received")
    || message.includes("placeholder")
    || message.includes("evaluator returned invalid json")
    || message.includes("evaluator returned incomplete")
    || message.includes("evaluator returned invalid")
  ) {
    return "invalid_input";
  }

  if (message.includes("score was generated but could not be saved")) {
    return "persistence_failure";
  }

  if (error instanceof MobileApiError) {
    if ([401, 403].includes(error.status)) return "auth_or_config";
    if ([400, 404, 422].includes(error.status)) return "invalid_input";
    if ([408, 504].includes(error.status)) return "network_timeout";
    if (error.status === 429) return "rate_limited";
    if ([500, 502, 503].includes(error.status)) return "upstream_scoring_failure";
  }

  if (["request timed out", "network request failed", "failed to fetch", "networkerror"].some((pattern) => message.includes(pattern))) {
    return "network_timeout";
  }

  if (message.includes("request failed (429)") || message.includes("rate limit")) {
    return "rate_limited";
  }

  if (
    message.includes("request failed (500)")
    || message.includes("request failed (502)")
    || message.includes("request failed (503)")
    || message.includes("request failed (504)")
    || message.includes("openai responses request failed")
    || message.includes("openai chat request failed")
    || message.includes("openai returned an empty")
    || message.includes("score generation failed")
  ) {
    return "upstream_scoring_failure";
  }

  return "unknown";
}

export function buildScoreUnavailableMessage(category: ScoringFailureCategory): string {
  if (category === "scoring_disabled") {
    return "Scoring is currently disabled for your account. This session was not scored or reported.";
  }

  if (category === "local_mode") {
    return "This session used local simulation mode, so Peritio could not create a verified score. No score was saved or reported.";
  }

  if (category === "api_unconfigured") {
    return "Remote scoring is not available in this build, so Peritio could not create a verified score. No score was saved or reported.";
  }

  return "Your simulation completed, but the scoring service failed before a verified score could be created. No score was saved or reported.";
}
