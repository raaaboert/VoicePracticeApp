import { SimulationEvaluationResult, SimulationScorecard } from "../types";

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
