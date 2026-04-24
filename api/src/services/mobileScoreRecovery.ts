import type { SimulationScoreRecord } from "@voicepractice/shared";

import {
  normalizeSimulationCompletionLevel,
  type SimulationScorecard,
} from "./simulationScoring.js";

function clampInteger(value: number | null | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(value as number)));
}

function normalizeCoachingItems(
  value: readonly string[] | null | undefined,
  fallback: string,
): string[] {
  const items = (value ?? [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);

  return items.length > 0 ? items : [fallback];
}

export function buildRecoveredSimulationScorecard(
  record: SimulationScoreRecord,
): SimulationScorecard {
  const communicationFallback = clampInteger(record.overallScore, 0, 100, 50);
  const legacyRubricFallback = Math.max(1, Math.min(10, Math.round(communicationFallback / 10)));

  return {
    communicationScore: clampInteger(record.communicationScore, 0, 100, communicationFallback),
    outcomeScore: clampInteger(record.outcomeScore, 0, 100, communicationFallback),
    overallScore: clampInteger(record.overallScore, 0, 100, communicationFallback),
    completionLevel: normalizeSimulationCompletionLevel(record.completionLevel, "partial"),
    objectiveAchieved: record.objectiveAchieved === true,
    persuasion: clampInteger(record.persuasion, 1, 10, legacyRubricFallback),
    clarity: clampInteger(record.clarity, 1, 10, legacyRubricFallback),
    empathy: clampInteger(record.empathy, 1, 10, legacyRubricFallback),
    assertiveness: clampInteger(record.assertiveness, 1, 10, legacyRubricFallback),
    strengths: normalizeCoachingItems(
      record.coachingArtifact?.strengths,
      "Stayed engaged throughout the conversation.",
    ),
    improvements: normalizeCoachingItems(
      record.coachingArtifact?.improvementAreas,
      "Use clearer structure and stronger evidence.",
    ),
    summary:
      typeof record.summary === "string" && record.summary.trim()
        ? record.summary.trim()
        : "Good effort. Keep improving clarity, evidence, and objection handling.",
  };
}

export function buildRecoveredSimulationEvaluationResult(record: SimulationScoreRecord): {
  status: "scored";
  scorecard: SimulationScorecard;
  record: {
    id: string;
    createdAt: string;
    trainingPackId?: string | null;
    model: string | null;
    promptVersion: string | null;
    rubricVersion: string | null;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
} {
  return {
    status: "scored",
    scorecard: buildRecoveredSimulationScorecard(record),
    record: {
      id: record.id,
      createdAt: record.createdAt,
      trainingPackId: record.trainingPackId ?? null,
      model: record.model ?? null,
      promptVersion: record.promptVersion ?? null,
      rubricVersion: record.rubricVersion ?? null,
      usage: {
        inputTokens: Math.max(0, record.inputTokens ?? 0),
        outputTokens: Math.max(0, record.outputTokens ?? 0),
        totalTokens: Math.max(0, record.totalTokens ?? 0),
      },
    },
  };
}
