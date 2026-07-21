import {
  PerformanceBaseline,
  PerformanceGoal,
  PerformancePlanScope,
  SimulationScoreRecord
} from "@voicepractice/shared";

import { buildBaselineWindow } from "./performanceDateWindows.js";
import { getFrozenScenarioIdSet } from "./performanceScope.js";
import { deriveTargetScore } from "./performancePlanValidation.js";

export interface PerformanceBaselinePreview {
  baseline: PerformanceBaseline | null;
  baselineStartAt: string;
  baselineEndAt: string;
  eligibleScoreCount: number;
  baselineAverage: number | null;
  derivedTargetScore: number | null;
  insufficientData: boolean;
}

export function calculatePerformanceBaseline(params: {
  orgId: string;
  userId: string;
  scope: PerformancePlanScope;
  goal: PerformanceGoal;
  effectiveAt: string;
  timeZone: string;
  scoreRecords: SimulationScoreRecord[];
  minimumScoreCount?: number;
}): PerformanceBaselinePreview {
  if (!params.goal.enabled || params.goal.metricType === "target_average_score") {
    throw new Error("Baseline is only required for improvement performance goals.");
  }
  if (params.goal.comparisonMonthCount !== 1 && params.goal.comparisonMonthCount !== 2 && params.goal.comparisonMonthCount !== 3 && params.goal.comparisonMonthCount !== 6) {
    throw new Error("Comparison month count must be 1, 2, 3, or 6.");
  }

  const window = buildBaselineWindow({
    effectiveAt: params.effectiveAt,
    timeZone: params.timeZone,
    comparisonMonthCount: params.goal.comparisonMonthCount
  });
  const eligibleScores = listEligiblePerformanceScores({
    scoreRecords: params.scoreRecords,
    orgId: params.orgId,
    userId: params.userId,
    scope: params.scope,
    fromAt: window.startAt,
    beforeAt: window.endAt
  });
  const baselineAverage = eligibleScores.length > 0
    ? eligibleScores.reduce((total, record) => total + record.overallScore, 0) / eligibleScores.length
    : null;
  const derivedTargetScore = baselineAverage === null ? null : deriveTargetScore({
    goal: params.goal,
    baselineAverage
  });
  const minimumScoreCount = params.minimumScoreCount ?? 3;
  const insufficientData = eligibleScores.length < minimumScoreCount;
  return {
    baseline: !insufficientData && baselineAverage !== null && derivedTargetScore !== null
      ? {
          baselineStartAt: window.startAt,
          baselineEndAt: window.endAt,
          baselineAverage,
          baselineSessionCount: eligibleScores.length,
          derivedTargetScore
        }
      : null,
    baselineStartAt: window.startAt,
    baselineEndAt: window.endAt,
    eligibleScoreCount: eligibleScores.length,
    baselineAverage,
    derivedTargetScore,
    insufficientData
  };
}

export function listEligiblePerformanceScores(params: {
  scoreRecords: SimulationScoreRecord[];
  orgId: string;
  userId: string;
  scope: PerformancePlanScope;
  fromAt: string;
  beforeAt: string;
}): SimulationScoreRecord[] {
  const scenarioIds = getFrozenScenarioIdSet(params.scope);
  const fromMs = new Date(params.fromAt).getTime();
  const beforeMs = new Date(params.beforeAt).getTime();
  return params.scoreRecords
    .filter((record) => {
      if (record.orgId !== params.orgId || record.userId !== params.userId) {
        return false;
      }
      if (!scenarioIds.has(record.scenarioId)) {
        return false;
      }
      if (!isConclusiveScore(record)) {
        return false;
      }
      if (!Number.isFinite(record.overallScore) || record.overallScore < 0 || record.overallScore > 100) {
        return false;
      }
      const endedAtMs = new Date(record.endedAt).getTime();
      return Number.isFinite(endedAtMs) && endedAtMs >= fromMs && endedAtMs < beforeMs;
    })
    .sort((left, right) => left.endedAt.localeCompare(right.endedAt) || left.id.localeCompare(right.id));
}

export function isConclusiveScore(record: Pick<SimulationScoreRecord, "completionLevel">): boolean {
  return !record.completionLevel || record.completionLevel === "complete";
}
