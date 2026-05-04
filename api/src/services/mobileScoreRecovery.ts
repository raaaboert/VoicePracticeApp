import {
  SIMULATION_COMPLETION_LEVELS,
  type SimulationScoreRecord,
} from "@voicepractice/shared";

import {
  normalizeSimulationCompletionLevel,
  type SimulationScorecard,
} from "./simulationScoring.js";

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function clampPersistedInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function isRecoverableSimulationScoreRecord(record: SimulationScoreRecord): boolean {
  return (
    isFiniteNumberInRange(record.communicationScore, 0, 100)
    && isFiniteNumberInRange(record.outcomeScore, 0, 100)
    && isFiniteNumberInRange(record.overallScore, 0, 100)
    && typeof record.completionLevel === "string"
    && (SIMULATION_COMPLETION_LEVELS as readonly string[]).includes(record.completionLevel)
    && typeof record.objectiveAchieved === "boolean"
    && isFiniteNumberInRange(record.persuasion, 1, 10)
    && isFiniteNumberInRange(record.clarity, 1, 10)
    && isFiniteNumberInRange(record.empathy, 1, 10)
    && isFiniteNumberInRange(record.assertiveness, 1, 10)
  );
}

function requireRecoverableSimulationScoreRecord(record: SimulationScoreRecord): void {
  if (!isRecoverableSimulationScoreRecord(record)) {
    throw new Error("Recovered score record is incomplete.");
  }
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
  requireRecoverableSimulationScoreRecord(record);

  return {
    communicationScore: clampPersistedInteger(record.communicationScore as number, 0, 100),
    outcomeScore: clampPersistedInteger(record.outcomeScore as number, 0, 100),
    overallScore: clampPersistedInteger(record.overallScore, 0, 100),
    completionLevel: normalizeSimulationCompletionLevel(record.completionLevel, "partial"),
    objectiveAchieved: record.objectiveAchieved as boolean,
    persuasion: clampPersistedInteger(record.persuasion, 1, 10),
    clarity: clampPersistedInteger(record.clarity, 1, 10),
    empathy: clampPersistedInteger(record.empathy, 1, 10),
    assertiveness: clampPersistedInteger(record.assertiveness, 1, 10),
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
