import { SIMULATION_COMPLETION_LEVELS, SimulationCompletionLevel, SimulationScoreRecord } from "@voicepractice/shared";

import { computeWeightedOverallScore, NormalizedScoringWeights } from "./trainingPackRuntime.js";

export interface SimulationScorecard {
  communicationScore: number;
  outcomeScore: number;
  overallScore: number;
  completionLevel: SimulationCompletionLevel;
  objectiveAchieved: boolean;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
  strengths: string[];
  improvements: string[];
  summary: string;
}

export interface SimulationDialogueTurn {
  role: "user" | "assistant";
  content: string;
}

export const MIN_USER_TURNS_FOR_SCORE = 3;
export const UNRESOLVED_OVERALL_SCORE_CAP = 65;
export const COMMUNICATION_SCORE_WEIGHT = 0.65;
export const OUTCOME_SCORE_WEIGHT = 0.35;
export const OBJECTIVE_ACHIEVED_MIN_OUTCOME_SCORE = 70;
export const MAX_UNACHIEVED_OUTCOME_SCORE = OBJECTIVE_ACHIEVED_MIN_OUTCOME_SCORE - 1;

const MAX_PERSISTED_COACHING_ITEMS = 3;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function parseOptionalNumber(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : null;
}

function fallbackLegacySubscore(communicationScore: number | null, overallScore: number | null): number {
  const source = communicationScore ?? overallScore ?? 50;
  return clamp(Math.round(source / 10), 1, 10);
}

function normalizeStringArray(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) {
    return [fallback];
  }

  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_PERSISTED_COACHING_ITEMS);

  return items.length > 0 ? items : [fallback];
}

export function normalizeSimulationCompletionLevel(
  value: unknown,
  fallback: SimulationCompletionLevel = "partial"
): SimulationCompletionLevel {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().toLowerCase();
  return (SIMULATION_COMPLETION_LEVELS as readonly string[]).includes(trimmed)
    ? (trimmed as SimulationCompletionLevel)
    : fallback;
}

export function countUserTurnsForScoring(history: readonly SimulationDialogueTurn[]): number {
  return history.filter((message) => message.role === "user" && message.content.trim().length > 0).length;
}

export function buildAdditiveEvaluationScoringGuidance(params: {
  standardGuidance?: string | null;
  customGuidance?: string | null;
}): string | null {
  const standardGuidance = params.standardGuidance?.trim() ?? "";
  const customGuidance = params.customGuidance?.trim() ?? "";
  const sections: string[] = [];

  if (standardGuidance) {
    sections.push(`INDUSTRY STANDARD SCENARIO SCORING GUIDANCE:\n${standardGuidance}`);
  }

  if (customGuidance) {
    sections.push(`CUSTOM SCENARIO SCORING GUIDANCE:\n${customGuidance}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

export function deriveOverallScore(params: {
  communicationScore: number;
  outcomeScore: number;
  completionLevel: SimulationCompletionLevel;
  objectiveAchieved: boolean;
}): number {
  const blended = Math.round(
    clamp(params.communicationScore, 0, 100) * COMMUNICATION_SCORE_WEIGHT +
      clamp(params.outcomeScore, 0, 100) * OUTCOME_SCORE_WEIGHT
  );

  if (params.completionLevel !== "complete" || params.objectiveAchieved === false) {
    return Math.min(blended, UNRESOLVED_OVERALL_SCORE_CAP);
  }

  return clamp(blended, 0, 100);
}

function harmonizeOutcomeState(params: {
  completionLevel: SimulationCompletionLevel;
  objectiveAchieved: boolean;
  outcomeScore: number;
}): {
  completionLevel: SimulationCompletionLevel;
  objectiveAchieved: boolean;
  outcomeScore: number;
} {
  let { completionLevel, objectiveAchieved } = params;
  let outcomeScore = clamp(params.outcomeScore, 0, 100);

  // We preserve completion as an end-state signal, but objective achievement only remains true
  // when the record is complete and outcome evidence clears the success threshold.
  if (completionLevel !== "complete") {
    objectiveAchieved = false;
  }

  if (objectiveAchieved && outcomeScore < OBJECTIVE_ACHIEVED_MIN_OUTCOME_SCORE) {
    objectiveAchieved = false;
  }

  if (!objectiveAchieved) {
    outcomeScore = Math.min(outcomeScore, MAX_UNACHIEVED_OUTCOME_SCORE);
  }

  return {
    completionLevel,
    objectiveAchieved,
    outcomeScore
  };
}

export function hasOutcomeAwareSimulationScoreRecord(
  record: Pick<SimulationScoreRecord, "communicationScore" | "outcomeScore" | "completionLevel" | "objectiveAchieved">
): boolean {
  return (
    typeof record.communicationScore === "number"
    || typeof record.outcomeScore === "number"
    || typeof record.completionLevel === "string"
    || typeof record.objectiveAchieved === "boolean"
  );
}

export function isSuccessfulSimulationScoreRecord(
  record: Pick<SimulationScoreRecord, "completionLevel" | "objectiveAchieved">
): boolean {
  return record.completionLevel === "complete" && record.objectiveAchieved === true;
}

export function normalizeSimulationScorecard(
  raw: unknown,
  scoringWeights: NormalizedScoringWeights
): SimulationScorecard {
  const candidate = (raw ?? {}) as Partial<SimulationScorecard> & {
    overallScore?: unknown;
    communicationScore?: unknown;
    outcomeScore?: unknown;
    completionLevel?: unknown;
    objectiveAchieved?: unknown;
    persuasion?: unknown;
    clarity?: unknown;
    empathy?: unknown;
    assertiveness?: unknown;
    strengths?: unknown;
    improvements?: unknown;
    summary?: unknown;
  };

  const providedCommunicationScore = parseOptionalNumber(candidate.communicationScore, 0, 100);
  const providedOverallScore = parseOptionalNumber(candidate.overallScore, 0, 100);
  const providedPersuasion = parseOptionalNumber(candidate.persuasion, 1, 10);
  const providedClarity = parseOptionalNumber(candidate.clarity, 1, 10);
  const providedEmpathy = parseOptionalNumber(candidate.empathy, 1, 10);
  const providedAssertiveness = parseOptionalNumber(candidate.assertiveness, 1, 10);
  const legacySubscoreFallback = fallbackLegacySubscore(providedCommunicationScore, providedOverallScore);

  const persuasion = providedPersuasion ?? legacySubscoreFallback;
  const clarity = providedClarity ?? legacySubscoreFallback;
  const empathy = providedEmpathy ?? legacySubscoreFallback;
  const assertiveness = providedAssertiveness ?? legacySubscoreFallback;
  const weightedCommunicationScore = computeWeightedOverallScore(
    {
      persuasion,
      clarity,
      empathy,
      assertiveness
    },
    scoringWeights
  );
  const communicationScore =
    (providedPersuasion !== null
    && providedClarity !== null
    && providedEmpathy !== null
    && providedAssertiveness !== null)
      ? weightedCommunicationScore
      : providedCommunicationScore ?? weightedCommunicationScore;
  const preliminaryOutcomeScore = parseOptionalNumber(candidate.outcomeScore, 0, 100)
    ?? providedOverallScore
    ?? providedCommunicationScore
    ?? communicationScore;
  const explicitObjectiveAchieved =
    typeof candidate.objectiveAchieved === "boolean" ? candidate.objectiveAchieved : null;
  const preliminaryCompletionLevel = normalizeSimulationCompletionLevel(
    candidate.completionLevel,
    explicitObjectiveAchieved === true ? "complete" : "partial"
  );
  const preliminaryObjectiveAchieved =
    explicitObjectiveAchieved
      ?? (preliminaryCompletionLevel === "complete" && preliminaryOutcomeScore >= OBJECTIVE_ACHIEVED_MIN_OUTCOME_SCORE);
  const {
    completionLevel,
    objectiveAchieved,
    outcomeScore
  } = harmonizeOutcomeState({
    completionLevel: preliminaryCompletionLevel,
    objectiveAchieved: preliminaryObjectiveAchieved,
    outcomeScore: preliminaryOutcomeScore
  });
  const overallScore = deriveOverallScore({
    communicationScore,
    outcomeScore,
    completionLevel,
    objectiveAchieved
  });

  return {
    communicationScore,
    outcomeScore,
    overallScore,
    completionLevel,
    objectiveAchieved,
    persuasion,
    clarity,
    empathy,
    assertiveness,
    strengths: normalizeStringArray(candidate.strengths, "Stayed engaged throughout the conversation."),
    improvements: normalizeStringArray(candidate.improvements, "Use clearer structure and stronger evidence."),
    summary:
      typeof candidate.summary === "string" && candidate.summary.trim()
        ? candidate.summary.trim()
        : "Good effort. Keep improving clarity, evidence, and objection handling."
  };
}

// "Conclusive" is intentionally completion-based for reporting compatibility. It does not imply
// success or desired-outcome achievement. Use `isSuccessfulSimulationScoreRecord` when success
// semantics matter.
export function isConclusiveSimulationScoreRecord(record: Pick<SimulationScoreRecord, "completionLevel">): boolean {
  return !record.completionLevel || record.completionLevel === "complete";
}
