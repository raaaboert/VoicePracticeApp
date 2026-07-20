import assert from "node:assert/strict";
import test from "node:test";

import { PerformancePlan, SimulationScoreRecord, UsageSessionRecord } from "@voicepractice/shared";

import { calculatePerformanceProgress } from "./performanceProgress.js";

function plan(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  return {
    id: overrides.id ?? "plan_1",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_1",
    createdByActorType: "mobile_user",
    createdByActorId: "user_1",
    createdAt: "2026-07-01T06:00:00.000Z",
    submittedAt: "2026-07-01T06:00:00.000Z",
    effectiveAt: overrides.effectiveAt ?? "2026-07-01T06:00:00.000Z",
    startDate: overrides.startDate ?? "2026-07-01",
    endDate: overrides.endDate ?? "2026-07-10",
    timeZone: "America/Denver",
    status: "active",
    completedAt: null,
    cancelledAt: null,
    cancelledByActorType: null,
    cancelledByActorId: null,
    cancellationReason: null,
    activityGoal: overrides.activityGoal ?? { enabled: true, metricType: "weekly_practice_minutes", targetValue: 70 },
    performanceGoal: overrides.performanceGoal ?? { enabled: true, metricType: "target_average_score", targetScore: 80, improvementAmount: null, comparisonMonthCount: null },
    scope: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: [],
      selectedScenarioIds: ["scenario_1"],
      scenarios: [
        {
          scenarioId: "scenario_1",
          displayName: "Scenario One",
          source: "standard",
          segmentId: "manager",
          segmentLabel: "Manager",
          focusTopics: [],
          selectionSources: ["direct"]
        }
      ]
    },
    baseline: overrides.baseline ?? { baselineStartAt: "2026-04-01T06:00:00.000Z", baselineEndAt: "2026-07-01T06:00:00.000Z", baselineAverage: 70, baselineSessionCount: 3, derivedTargetScore: 80 },
    finalResult: null,
    updatedAt: "2026-07-01T06:00:00.000Z"
  };
}

function usage(overrides: Partial<UsageSessionRecord>): UsageSessionRecord {
  return {
    id: overrides.id ?? "usage_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    divisionId: overrides.divisionId ?? null,
    segmentId: overrides.segmentId ?? "manager",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    startedAt: overrides.startedAt ?? "2026-07-01T06:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-07-01T06:10:00.000Z",
    rawDurationSeconds: overrides.rawDurationSeconds ?? 600,
    billedSecondsAdded: overrides.billedSecondsAdded,
    createdAt: overrides.createdAt ?? "2026-07-01T06:11:00.000Z"
  };
}

function score(overrides: Partial<SimulationScoreRecord>): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_1",
    simulationSessionId: overrides.simulationSessionId ?? "sim_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    divisionId: overrides.divisionId ?? null,
    segmentId: overrides.segmentId ?? "manager",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    industryId: overrides.industryId ?? null,
    startedAt: overrides.startedAt ?? "2026-07-01T06:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-07-01T06:10:00.000Z",
    overallScore: overrides.overallScore ?? 80,
    communicationScore: overrides.communicationScore ?? 80,
    outcomeScore: overrides.outcomeScore ?? 80,
    completionLevel: overrides.completionLevel,
    objectiveAchieved: overrides.objectiveAchieved ?? true,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 8,
    empathy: overrides.empathy ?? 8,
    assertiveness: overrides.assertiveness ?? 8,
    summary: overrides.summary ?? "Good",
    coachingArtifact: overrides.coachingArtifact ?? null,
    normalizedCoachingThemes: overrides.normalizedCoachingThemes ?? null,
    rubricVersion: overrides.rubricVersion ?? "rubric",
    model: overrides.model ?? "model",
    promptVersion: overrides.promptVersion ?? "prompt",
    inputTokens: overrides.inputTokens ?? 1,
    outputTokens: overrides.outputTokens ?? 1,
    totalTokens: overrides.totalTokens ?? 2,
    createdAt: overrides.createdAt ?? "2026-07-01T06:11:00.000Z"
  };
}

test("performance progress uses raw duration and seven-day plan-week proration for weekly activity", () => {
  const result = calculatePerformanceProgress({
    plan: plan(),
    usageSessions: [
      usage({ id: "u1", endedAt: "2026-07-02T06:00:00.000Z", rawDurationSeconds: 4200 }),
      usage({ id: "u2", endedAt: "2026-07-09T06:00:00.000Z", rawDurationSeconds: 1800 }),
      usage({ id: "billed_ignored", endedAt: "2026-07-09T07:00:00.000Z", rawDurationSeconds: 0, billedSecondsAdded: 3600 }),
      usage({ id: "other_scenario", scenarioId: "scenario_2", endedAt: "2026-07-09T08:00:00.000Z", rawDurationSeconds: 3600 })
    ],
    scoreRecords: [
      score({ id: "s1", endedAt: "2026-07-02T06:00:00.000Z", overallScore: 80 }),
      score({ id: "s2", endedAt: "2026-07-03T06:00:00.000Z", overallScore: 85 }),
      score({ id: "s3", endedAt: "2026-07-04T06:00:00.000Z", overallScore: 90 })
    ],
    now: new Date("2026-07-11T06:00:00.000Z"),
    capAt: "2026-07-11T06:00:00.000Z"
  });

  assert.equal(result.progress.activity.actualValue, 100);
  assert.equal(result.progress.activity.cumulativeTargetValue, 100);
  assert.equal(result.progress.activity.succeeded, true);
  assert.deepEqual(result.progress.activity.weeklyConsistency, { completedWeeks: 2, totalWeeks: 2 });
});

test("performance progress supports total practice time and session-count activity metrics", () => {
  const totalMinutes = calculatePerformanceProgress({
    plan: plan({ activityGoal: { enabled: true, metricType: "total_practice_minutes", targetValue: 20 }, performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null } }),
    usageSessions: [usage({ rawDurationSeconds: 1200 })],
    scoreRecords: [],
    now: new Date("2026-07-02T06:00:00.000Z")
  });
  assert.equal(totalMinutes.progress.activity.succeeded, true);

  const weeklyCount = calculatePerformanceProgress({
    plan: plan({ activityGoal: { enabled: true, metricType: "weekly_session_count", targetValue: 2 }, performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null } }),
    usageSessions: [usage({ id: "u1" }), usage({ id: "u2", endedAt: "2026-07-02T06:10:00.000Z" })],
    scoreRecords: [],
    now: new Date("2026-07-08T06:00:00.000Z")
  });
  assert.equal(weeklyCount.progress.activity.succeeded, true);

  const totalCount = calculatePerformanceProgress({
    plan: plan({ activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 2 }, performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null } }),
    usageSessions: [usage({ id: "u1" }), usage({ id: "u2", endedAt: "2026-07-02T06:10:00.000Z" })],
    scoreRecords: [],
    now: new Date("2026-07-02T06:30:00.000Z")
  });
  assert.equal(totalCount.progress.activity.succeeded, true);
});

test("performance progress requires three in-plan conclusive scores before meeting target", () => {
  const twoScores = calculatePerformanceProgress({
    plan: plan(),
    usageSessions: [],
    scoreRecords: [
      score({ id: "s1", overallScore: 100 }),
      score({ id: "s2", endedAt: "2026-07-02T06:00:00.000Z", overallScore: 100 })
    ],
    now: new Date("2026-07-03T06:00:00.000Z")
  });
  assert.equal(twoScores.progress.performance.notEnoughData, true);
  assert.equal(twoScores.progress.performance.currentlyMeetingTarget, false);

  const threeScores = calculatePerformanceProgress({
    plan: plan(),
    usageSessions: [],
    scoreRecords: [
      score({ id: "s1", overallScore: 0 }),
      score({ id: "s2", endedAt: "2026-07-02T06:00:00.000Z", overallScore: 100 }),
      score({ id: "s3", endedAt: "2026-07-03T06:00:00.000Z", overallScore: 100 }),
      score({ id: "partial", endedAt: "2026-07-04T06:00:00.000Z", overallScore: 100, completionLevel: "inconclusive" })
    ],
    now: new Date("2026-07-05T06:00:00.000Z")
  });
  assert.equal(threeScores.progress.performance.eligibleScoreCount, 3);
  assert.equal(Math.round((threeScores.progress.performance.currentAverage ?? 0) * 10) / 10, 66.7);
  assert.equal(threeScores.progress.performance.currentlyMeetingTarget, false);
});

test("performance progress combines activity and performance success when both are enabled", () => {
  const result = calculatePerformanceProgress({
    plan: plan({ performanceGoal: { enabled: true, metricType: "improve_by_points", targetScore: null, improvementAmount: 10, comparisonMonthCount: 3 } }),
    usageSessions: [usage({ rawDurationSeconds: 6000 })],
    scoreRecords: [
      score({ id: "s1", overallScore: 80 }),
      score({ id: "s2", endedAt: "2026-07-02T06:00:00.000Z", overallScore: 85 }),
      score({ id: "s3", endedAt: "2026-07-03T06:00:00.000Z", overallScore: 90 })
    ],
    now: new Date("2026-07-11T06:00:00.000Z"),
    capAt: "2026-07-11T06:00:00.000Z"
  });

  assert.equal(result.progress.activity.succeeded, true);
  assert.equal(result.progress.performance.targetScore, 80);
  assert.equal(result.progress.performance.succeeded, true);
  assert.equal(result.progress.overallSucceeded, true);
});
