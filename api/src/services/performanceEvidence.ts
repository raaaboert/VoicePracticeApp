import type {
  SimulationCompletionLevel,
  SimulationScoreRecord,
  SimulationScoringWeightsApplied,
} from "@voicepractice/shared";

import { SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS } from "./simulationSessionLifecycle.js";

export const LEGACY_UNVERSIONED_SCORING_GENERATION = "legacy_unversioned";
export const UNVERSIONED_OUTCOME_AWARE_SCORING_GENERATION = "unversioned_outcome_aware";

// No repository-wide contract currently bounds how long scoring may be delayed.
// Keep historical backdating unchanged until that product policy is established.
export const PERFORMANCE_EVIDENCE_EXTREME_BACKDATING_TOLERANCE_MS: number | null = null;

export type PerformanceEvidenceRecordEra =
  | "legacy_sparse"
  | "outcome_aware"
  | "modern_contract_violation";

export type PerformanceEvidenceSubjectKind = "user" | "deidentified";
export type PerformanceEvidenceAnomaly =
  | "modern_contract_violation"
  | "timing_anomaly"
  | "duplicate_session_conflict";
export type PerformanceEvidenceAtSource = "endedAt" | "createdAt_clamped";

export interface PerformanceEvidenceMetricAvailability {
  overall: boolean;
  communication: boolean;
  outcome: boolean;
  persuasion: boolean;
  clarity: boolean;
  empathy: boolean;
  assertiveness: boolean;
  completion: boolean;
  objective: boolean;
}

export interface CanonicalPerformanceEvidence {
  evidenceId: string;
  simulationSessionId?: string;
  userId: string;
  orgId: string | null;
  divisionId?: string;
  trainingId?: string;
  trainingPackId?: string;
  segmentId: string;
  scenarioId: string;
  industryId?: string;
  startedAt: string;
  endedAt: string;
  evidenceAt: string;
  scoreCreatedAt: string;
  overallScore: number;
  communicationScore?: number;
  outcomeScore?: number;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
  completionLevel?: SimulationCompletionLevel;
  objectiveAchieved?: boolean;
  rubricVersion?: string;
  promptVersion?: string;
  model?: string;
  scoringWeightsApplied?: SimulationScoringWeightsApplied;
  recordEra: Exclude<PerformanceEvidenceRecordEra, "modern_contract_violation">;
  scoringGeneration: string;
  metricAvailability: PerformanceEvidenceMetricAvailability;
  subjectKind: PerformanceEvidenceSubjectKind;
  anomalies: PerformanceEvidenceAnomaly[];
  evidenceAtSource: PerformanceEvidenceAtSource;
}

export type PerformanceEvidenceRejectionCode =
  | "missing_required_field"
  | "invalid_timestamp"
  | "invalid_timestamp_order"
  | "invalid_metric"
  | "invalid_modern_field"
  | "invalid_scoring_weights"
  | "modern_contract_violation";

export interface PerformanceEvidenceRejection {
  code: PerformanceEvidenceRejectionCode;
  field?: keyof SimulationScoreRecord;
}

export type PerformanceEvidenceNormalizationResult =
  | {
      status: "accepted";
      evidence: CanonicalPerformanceEvidence;
    }
  | {
      status: "rejected";
      recordEra: PerformanceEvidenceRecordEra;
      scoringGeneration: string;
      metricAvailability: PerformanceEvidenceMetricAvailability;
      anomalies: PerformanceEvidenceAnomaly[];
      rejections: PerformanceEvidenceRejection[];
    };

export interface DuplicateSimulationSessionConflict {
  simulationSessionId: string;
  scoreIds: string[];
}

export interface PerformanceEvidenceBatchNormalizationResult {
  results: PerformanceEvidenceNormalizationResult[];
  duplicateSessionConflicts: DuplicateSimulationSessionConflict[];
}

const OUTCOME_AWARE_FIELDS = [
  "communicationScore",
  "outcomeScore",
  "completionLevel",
  "objectiveAchieved",
] as const;

const SHIPPED_PRE_OUTCOME_RUBRIC_VERSIONS = new Set([
  "2026-02-16.v1",
  "2026-03-06.v2",
]);

function normalizeOptionalIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

/**
 * Finds ambiguous simulation sessions in a raw score snapshot. A conflict is
 * defined by distinct authoritative score IDs, independently of whether any
 * individual score can become canonical evidence.
 */
export function detectDuplicateSimulationSessionConflicts(
  scoreRecords: readonly SimulationScoreRecord[],
): DuplicateSimulationSessionConflict[] {
  const scoreIdsBySessionId = new Map<string, Set<string>>();

  for (const record of scoreRecords) {
    const simulationSessionId = normalizeOptionalIdentifier(record.simulationSessionId);
    const scoreId = normalizeOptionalIdentifier(record.id);
    if (!simulationSessionId || !scoreId) {
      continue;
    }

    const scoreIds = scoreIdsBySessionId.get(simulationSessionId) ?? new Set<string>();
    scoreIds.add(scoreId);
    scoreIdsBySessionId.set(simulationSessionId, scoreIds);
  }

  return [...scoreIdsBySessionId.entries()]
    .filter(([, scoreIds]) => scoreIds.size > 1)
    .map(([simulationSessionId, scoreIds]) => ({
      simulationSessionId,
      scoreIds: [...scoreIds].sort(),
    }))
    .sort((left, right) => left.simulationSessionId.localeCompare(right.simulationSessionId));
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function classifyRecordEra(record: SimulationScoreRecord): PerformanceEvidenceRecordEra {
  const presentCount = OUTCOME_AWARE_FIELDS.filter((field) => record[field] !== undefined).length;
  if (presentCount === 0) {
    const rubricVersion = normalizeOptionalIdentifier(record.rubricVersion);
    if (rubricVersion && !SHIPPED_PRE_OUTCOME_RUBRIC_VERSIONS.has(rubricVersion)) {
      return "modern_contract_violation";
    }
    return "legacy_sparse";
  }
  if (presentCount === OUTCOME_AWARE_FIELDS.length) {
    return "outcome_aware";
  }
  return "modern_contract_violation";
}

function resolveScoringGeneration(
  record: SimulationScoreRecord,
  recordEra: PerformanceEvidenceRecordEra,
): string {
  const rubricVersion = normalizeOptionalIdentifier(record.rubricVersion);
  if (rubricVersion) {
    return rubricVersion;
  }
  return recordEra === "legacy_sparse"
    ? LEGACY_UNVERSIONED_SCORING_GENERATION
    : UNVERSIONED_OUTCOME_AWARE_SCORING_GENERATION;
}

function buildMetricAvailability(record: SimulationScoreRecord): PerformanceEvidenceMetricAvailability {
  return {
    overall: record.overallScore !== undefined,
    communication: record.communicationScore !== undefined,
    outcome: record.outcomeScore !== undefined,
    persuasion: record.persuasion !== undefined,
    clarity: record.clarity !== undefined,
    empathy: record.empathy !== undefined,
    assertiveness: record.assertiveness !== undefined,
    completion: record.completionLevel !== undefined,
    objective: record.objectiveAchieved !== undefined,
  };
}

function normalizeScoringWeights(
  value: SimulationScoreRecord["scoringWeightsApplied"],
): SimulationScoringWeightsApplied | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const weights: SimulationScoringWeightsApplied = {
    persuasion: value.persuasion,
    clarity: value.clarity,
    empathy: value.empathy,
    assertiveness: value.assertiveness,
  };
  const values = Object.values(weights);
  if (values.some((weight) => !isNumberInRange(weight, 0, 1))) {
    return null;
  }
  const total = values.reduce((sum, weight) => sum + weight, 0);
  return Math.abs(total - 1) <= 1e-9 ? weights : null;
}

export function normalizePerformanceEvidence(
  record: SimulationScoreRecord,
): PerformanceEvidenceNormalizationResult {
  const recordEra = classifyRecordEra(record);
  const scoringGeneration = resolveScoringGeneration(record, recordEra);
  const metricAvailability = buildMetricAvailability(record);
  const anomalies: PerformanceEvidenceAnomaly[] = [];
  const rejections: PerformanceEvidenceRejection[] = [];

  const evidenceId = normalizeOptionalIdentifier(record.id);
  const userId = normalizeOptionalIdentifier(record.userId);
  const segmentId = normalizeOptionalIdentifier(record.segmentId);
  const scenarioId = normalizeOptionalIdentifier(record.scenarioId);
  for (const [field, value] of [
    ["id", evidenceId],
    ["userId", userId],
    ["segmentId", segmentId],
    ["scenarioId", scenarioId],
  ] as const) {
    if (!value) {
      rejections.push({ code: "missing_required_field", field });
    }
  }

  const startedAt = parseTimestamp(record.startedAt);
  const endedAt = parseTimestamp(record.endedAt);
  const createdAt = parseTimestamp(record.createdAt);
  for (const [field, value] of [
    ["startedAt", startedAt],
    ["endedAt", endedAt],
    ["createdAt", createdAt],
  ] as const) {
    if (!value) {
      rejections.push({ code: "invalid_timestamp", field });
    }
  }
  if (startedAt && endedAt && endedAt.getTime() < startedAt.getTime()) {
    rejections.push({ code: "invalid_timestamp_order", field: "endedAt" });
  }

  for (const [field, value, minimum, maximum] of [
    ["overallScore", record.overallScore, 0, 100],
    ["persuasion", record.persuasion, 1, 10],
    ["clarity", record.clarity, 1, 10],
    ["empathy", record.empathy, 1, 10],
    ["assertiveness", record.assertiveness, 1, 10],
  ] as const) {
    if (!isNumberInRange(value, minimum, maximum)) {
      rejections.push({ code: "invalid_metric", field });
    }
  }

  if (recordEra === "modern_contract_violation") {
    anomalies.push("modern_contract_violation");
    rejections.push({ code: "modern_contract_violation" });
  } else if (recordEra === "outcome_aware") {
    if (!isNumberInRange(record.communicationScore, 0, 100)) {
      rejections.push({ code: "invalid_modern_field", field: "communicationScore" });
    }
    if (!isNumberInRange(record.outcomeScore, 0, 100)) {
      rejections.push({ code: "invalid_modern_field", field: "outcomeScore" });
    }
    if (!record.completionLevel || !["inconclusive", "partial", "complete"].includes(record.completionLevel)) {
      rejections.push({ code: "invalid_modern_field", field: "completionLevel" });
    }
    if (typeof record.objectiveAchieved !== "boolean") {
      rejections.push({ code: "invalid_modern_field", field: "objectiveAchieved" });
    }
  }

  const scoringWeightsApplied = record.scoringWeightsApplied === undefined
    ? undefined
    : normalizeScoringWeights(record.scoringWeightsApplied);
  if (record.scoringWeightsApplied !== undefined && !scoringWeightsApplied) {
    rejections.push({ code: "invalid_scoring_weights", field: "scoringWeightsApplied" });
  }

  let evidenceAt = endedAt;
  let evidenceAtSource: PerformanceEvidenceAtSource = "endedAt";
  if (
    endedAt
    && createdAt
    && endedAt.getTime() > createdAt.getTime() + SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS
  ) {
    anomalies.push("timing_anomaly");
    evidenceAt = createdAt;
    evidenceAtSource = "createdAt_clamped";
  } else if (
    endedAt
    && createdAt
    && PERFORMANCE_EVIDENCE_EXTREME_BACKDATING_TOLERANCE_MS !== null
    && endedAt.getTime() < createdAt.getTime() - PERFORMANCE_EVIDENCE_EXTREME_BACKDATING_TOLERANCE_MS
  ) {
    anomalies.push("timing_anomaly");
  }

  if (
    rejections.length > 0
    || !evidenceId
    || !userId
    || !segmentId
    || !scenarioId
    || !startedAt
    || !endedAt
    || !createdAt
    || !evidenceAt
    || recordEra === "modern_contract_violation"
  ) {
    return {
      status: "rejected",
      recordEra,
      scoringGeneration,
      metricAvailability,
      anomalies,
      rejections,
    };
  }

  return {
    status: "accepted",
    evidence: {
      evidenceId,
      simulationSessionId: normalizeOptionalIdentifier(record.simulationSessionId),
      userId,
      orgId: normalizeOptionalIdentifier(record.orgId) ?? null,
      divisionId: normalizeOptionalIdentifier(record.divisionId),
      trainingId: normalizeOptionalIdentifier(record.trainingId),
      trainingPackId: normalizeOptionalIdentifier(record.trainingPackId),
      segmentId,
      scenarioId,
      industryId: normalizeOptionalIdentifier(record.industryId),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      evidenceAt: evidenceAt.toISOString(),
      scoreCreatedAt: createdAt.toISOString(),
      overallScore: record.overallScore,
      communicationScore: record.communicationScore,
      outcomeScore: record.outcomeScore,
      persuasion: record.persuasion,
      clarity: record.clarity,
      empathy: record.empathy,
      assertiveness: record.assertiveness,
      completionLevel: record.completionLevel,
      objectiveAchieved: record.objectiveAchieved,
      rubricVersion: normalizeOptionalIdentifier(record.rubricVersion),
      promptVersion: normalizeOptionalIdentifier(record.promptVersion),
      model: normalizeOptionalIdentifier(record.model),
      scoringWeightsApplied: scoringWeightsApplied ?? undefined,
      recordEra,
      scoringGeneration,
      metricAvailability,
      subjectKind: userId === "deleted_user" ? "deidentified" : "user",
      anomalies,
      evidenceAtSource,
    },
  };
}

/**
 * Duplicate-session evidence is retained for diagnostics but quarantined from
 * any future performance aggregation.
 */
export function isPerformanceEvidenceQuarantined(
  evidence: Pick<CanonicalPerformanceEvidence, "anomalies">,
): boolean {
  return evidence.anomalies.includes("duplicate_session_conflict");
}

export function annotateDuplicateSimulationSessionConflict(
  evidence: CanonicalPerformanceEvidence,
): CanonicalPerformanceEvidence {
  const anomalies: PerformanceEvidenceAnomaly[] = evidence.anomalies.includes(
    "duplicate_session_conflict",
  )
    ? [...evidence.anomalies]
    : [...evidence.anomalies, "duplicate_session_conflict"];
  return { ...evidence, anomalies };
}

export function normalizePerformanceEvidenceBatch(
  scoreRecords: readonly SimulationScoreRecord[],
): PerformanceEvidenceBatchNormalizationResult {
  const duplicateSessionConflicts = detectDuplicateSimulationSessionConflicts(scoreRecords);
  const conflictedSessionIds = new Set(
    duplicateSessionConflicts.map((conflict) => conflict.simulationSessionId),
  );

  const results = scoreRecords.map((record) => {
    const result = normalizePerformanceEvidence(record);
    const simulationSessionId = normalizeOptionalIdentifier(record.simulationSessionId);
    if (
      result.status !== "accepted"
      || !simulationSessionId
      || !conflictedSessionIds.has(simulationSessionId)
    ) {
      return result;
    }

    return {
      status: "accepted" as const,
      evidence: annotateDuplicateSimulationSessionConflict(result.evidence),
    };
  });

  return { results, duplicateSessionConflicts };
}
