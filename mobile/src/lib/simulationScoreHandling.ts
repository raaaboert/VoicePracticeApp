import { SimulationEvaluationResult, SimulationScorecard } from "../types";

const REMOTE_SCORE_FALLBACK_ALLOWLIST = [
  "request timed out",
  "request failed (429)",
  "request failed (500)",
  "request failed (502)",
  "request failed (503)",
  "request failed (504)",
  "openai responses request failed",
  "openai chat request failed",
  "openai returned an empty",
  "score was generated but could not be saved",
  "score generation failed",
];

const REMOTE_SCORE_FALLBACK_BLOCKLIST = [
  "missing mobile auth context",
  "missing mobile token",
  "invalid mobile token",
  "scoring is currently disabled",
  "invalid scenario",
  "user not found",
  "no transcribed user text received",
  "placeholder",
  "simulation unavailable",
];

export interface ResolvedSimulationScoreOutcome {
  kind: "scored" | "not_scored";
  scorecard: SimulationScorecard | null;
  message: string | null;
}

export function shouldUsePracticeOnlyFallbackScore(params: {
  scoringEnabled: boolean;
  usedMockMode: boolean;
  apiConfigured: boolean;
}): boolean {
  if (!params.scoringEnabled) {
    return false;
  }

  return params.usedMockMode || !params.apiConfigured;
}

export function resolveSimulationScoreOutcome(result: SimulationEvaluationResult): ResolvedSimulationScoreOutcome {
  if (result.status === "not_scored") {
    return {
      kind: "not_scored",
      scorecard: null,
      message: result.message
    };
  }

  return {
    kind: "scored",
    scorecard: result.scorecard,
    message: null
  };
}

export function shouldUsePracticeFallbackAfterRemoteScoreFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  if (!message) {
    return false;
  }

  if (REMOTE_SCORE_FALLBACK_BLOCKLIST.some((pattern) => message.includes(pattern))) {
    return false;
  }

  return REMOTE_SCORE_FALLBACK_ALLOWLIST.some((pattern) => message.includes(pattern));
}
