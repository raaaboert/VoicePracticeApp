import {
  PerformanceActivityProgress,
  PerformanceFinalResult,
  PerformancePlan,
  PerformanceProgress,
  PerformanceScoreProgress,
  SimulationScoreRecord,
  UsageSessionRecord
} from "@voicepractice/shared";

import { buildPlanWeekWindows, buildPlanWindow } from "./performanceDateWindows.js";
import { listEligiblePerformanceScores } from "./performanceBaseline.js";
import { getFrozenScenarioIdSet } from "./performanceScope.js";
import { deriveTargetScore } from "./performancePlanValidation.js";

export interface PerformanceProgressCalculation {
  progress: PerformanceProgress;
  eligibleUsageSessions: UsageSessionRecord[];
  eligibleScoreRecords: SimulationScoreRecord[];
  totalPracticeSeconds: number;
}

export function calculatePerformanceProgress(params: {
  plan: PerformancePlan;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
  capAt?: string | null;
}): PerformanceProgressCalculation {
  const capAt = params.capAt ?? params.now.toISOString();
  const window = buildPlanWindow({
    startDate: params.plan.startDate,
    endDate: params.plan.endDate,
    timeZone: params.plan.timeZone,
    effectiveAt: params.plan.effectiveAt,
    capAt
  });
  const eligibleUsageSessions = listEligibleUsageSessions({
    usageSessions: params.usageSessions,
    orgId: params.plan.orgId,
    userId: params.plan.userId,
    scope: params.plan.scope,
    fromAt: window.startAt,
    beforeAt: window.endAt
  });
  const eligibleScoreRecords = listEligiblePerformanceScores({
    scoreRecords: params.scoreRecords,
    orgId: params.plan.orgId,
    userId: params.plan.userId,
    scope: params.plan.scope,
    fromAt: window.startAt,
    beforeAt: window.endAt
  });
  const totalPracticeSeconds = eligibleUsageSessions.reduce((total, session) => total + Math.max(0, session.rawDurationSeconds), 0);
  const activity = calculateActivityProgress({
    plan: params.plan,
    usageSessions: eligibleUsageSessions,
    totalPracticeSeconds,
    windowStartAt: window.startAt,
    windowEndAt: window.endAt
  });
  const performance = calculateScoreProgress({
    plan: params.plan,
    scoreRecords: eligibleScoreRecords
  });
  const overallCurrentlyMeetingTarget =
    (!activity.enabled || activity.succeeded) &&
    (!performance.enabled || performance.currentlyMeetingTarget);
  const overallSucceeded =
    (!activity.enabled || activity.succeeded) &&
    (!performance.enabled || performance.succeeded);

  return {
    progress: {
      generatedAt: params.now.toISOString(),
      planId: params.plan.id,
      windowStartAt: window.startAt,
      windowEndAt: window.endAt,
      activity,
      performance,
      overallCurrentlyMeetingTarget,
      overallSucceeded
    },
    eligibleUsageSessions,
    eligibleScoreRecords,
    totalPracticeSeconds
  };
}

export function buildPerformanceFinalResult(params: {
  plan: PerformancePlan;
  progress: PerformanceProgressCalculation;
  finalizedAt: string;
}): PerformanceFinalResult {
  return {
    finalizedAt: params.finalizedAt,
    windowStartAt: params.progress.progress.windowStartAt,
    windowEndAt: params.progress.progress.windowEndAt,
    activitySucceeded: params.progress.progress.activity.succeeded,
    performanceSucceeded: params.progress.progress.performance.succeeded,
    overallSucceeded: params.progress.progress.overallSucceeded,
    performanceInsufficientEvidence: params.progress.progress.performance.notEnoughData,
    finalAverageScore: params.progress.progress.performance.currentAverage,
    scoreImprovement: params.progress.progress.performance.scoreImprovement,
    totalPracticeSeconds: params.progress.totalPracticeSeconds,
    sessionsCompleted: params.progress.eligibleUsageSessions.length,
    weeklyConsistency: params.progress.progress.activity.weeklyConsistency,
    scope: params.plan.scope
  };
}

export function listEligibleUsageSessions(params: {
  usageSessions: UsageSessionRecord[];
  orgId: string;
  userId: string;
  scope: PerformancePlan["scope"];
  fromAt: string;
  beforeAt: string;
}): UsageSessionRecord[] {
  const scenarioIds = getFrozenScenarioIdSet(params.scope);
  const fromMs = new Date(params.fromAt).getTime();
  const beforeMs = new Date(params.beforeAt).getTime();
  return params.usageSessions
    .filter((session) => {
      if (session.orgId !== params.orgId || session.userId !== params.userId) {
        return false;
      }
      if (!scenarioIds.has(session.scenarioId)) {
        return false;
      }
      if (!Number.isFinite(session.rawDurationSeconds) || session.rawDurationSeconds < 0) {
        return false;
      }
      const endedAtMs = new Date(session.endedAt).getTime();
      return Number.isFinite(endedAtMs) && endedAtMs >= fromMs && endedAtMs < beforeMs;
    })
    .sort((left, right) => left.endedAt.localeCompare(right.endedAt) || left.id.localeCompare(right.id));
}

function calculateActivityProgress(params: {
  plan: PerformancePlan;
  usageSessions: UsageSessionRecord[];
  totalPracticeSeconds: number;
  windowStartAt: string;
  windowEndAt: string;
}): PerformanceActivityProgress {
  const goal = params.plan.activityGoal;
  if (!goal.enabled || !goal.metricType || goal.targetValue === null) {
    return {
      enabled: false,
      metricType: null,
      targetValue: null,
      actualValue: 0,
      cumulativeTargetValue: 0,
      succeeded: true,
      weeklyConsistency: null
    };
  }
  const targetValue = goal.targetValue;

  if (goal.metricType === "total_practice_minutes") {
    const actualValue = params.totalPracticeSeconds / 60;
    return {
      enabled: true,
      metricType: goal.metricType,
      targetValue,
      actualValue,
      cumulativeTargetValue: targetValue,
      succeeded: actualValue >= targetValue,
      weeklyConsistency: null
    };
  }

  if (goal.metricType === "total_session_count") {
    const actualValue = params.usageSessions.length;
    return {
      enabled: true,
      metricType: goal.metricType,
      targetValue,
      actualValue,
      cumulativeTargetValue: targetValue,
      succeeded: actualValue >= targetValue,
      weeklyConsistency: null
    };
  }

  const weeks = buildPlanWeekWindows({
    startDate: params.plan.startDate,
    endDate: params.plan.endDate,
    timeZone: params.plan.timeZone,
    effectiveAt: params.plan.effectiveAt,
    capAt: params.windowEndAt
  });
  const isMinuteMetric = goal.metricType === "weekly_practice_minutes";
  const actualValue = isMinuteMetric ? params.totalPracticeSeconds / 60 : params.usageSessions.length;
  const cumulativeTargetValue = weeks.reduce((total, week) => total + targetValue * week.proratedFraction, 0);
  const completedWeeks = weeks.filter((week) => {
    const weekStartMs = new Date(week.includedStartAt).getTime();
    const weekEndMs = new Date(week.includedEndAt).getTime();
    const weekActual = params.usageSessions
      .filter((session) => {
        const endedAtMs = new Date(session.endedAt).getTime();
        return Number.isFinite(endedAtMs) && endedAtMs >= weekStartMs && endedAtMs < weekEndMs;
      })
      .reduce((total, session) => total + (isMinuteMetric ? session.rawDurationSeconds / 60 : 1), 0);
    return weekActual >= targetValue * week.proratedFraction;
  }).length;

  return {
    enabled: true,
    metricType: goal.metricType,
    targetValue,
    actualValue,
    cumulativeTargetValue,
    succeeded: actualValue >= cumulativeTargetValue,
    weeklyConsistency: {
      completedWeeks,
      totalWeeks: weeks.length
    }
  };
}

function calculateScoreProgress(params: {
  plan: PerformancePlan;
  scoreRecords: SimulationScoreRecord[];
}): PerformanceScoreProgress {
  const goal = params.plan.performanceGoal;
  if (!goal.enabled || !goal.metricType) {
    return {
      enabled: false,
      metricType: null,
      targetScore: null,
      currentAverage: null,
      eligibleScoreCount: 0,
      baselineAverage: null,
      scoreImprovement: null,
      currentlyMeetingTarget: true,
      notEnoughData: false,
      succeeded: true
    };
  }

  const targetScore = goal.metricType === "target_average_score"
    ? goal.targetScore
    : deriveTargetScore({ goal, baselineAverage: params.plan.baseline?.baselineAverage ?? null });
  const currentAverage = params.scoreRecords.length > 0
    ? params.scoreRecords.reduce((total, record) => total + record.overallScore, 0) / params.scoreRecords.length
    : null;
  const notEnoughData = params.scoreRecords.length < 3;
  const currentlyMeetingTarget =
    !notEnoughData &&
    currentAverage !== null &&
    targetScore !== null &&
    currentAverage >= targetScore;
  return {
    enabled: true,
    metricType: goal.metricType,
    targetScore,
    currentAverage,
    eligibleScoreCount: params.scoreRecords.length,
    baselineAverage: params.plan.baseline?.baselineAverage ?? null,
    scoreImprovement:
      currentAverage !== null && params.plan.baseline?.baselineAverage !== undefined
        ? currentAverage - params.plan.baseline.baselineAverage
        : null,
    currentlyMeetingTarget,
    notEnoughData,
    succeeded: currentlyMeetingTarget
  };
}
