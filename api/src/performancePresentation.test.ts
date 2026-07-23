import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPerformanceActivityLine,
  buildPerformanceDateStatusLabel,
  buildPerformanceOverallLine,
  buildPerformancePlanTitle,
  derivePerformancePlanPresentationStatus,
  groupPerformancePlanSummaries,
  PerformancePlan,
  PerformanceProgress
} from "@voicepractice/shared";

function buildPlan(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  return {
    id: overrides.id ?? "perf_plan",
    orgId: "org_1",
    userId: "user_1",
    createdByActorType: "mobile_user",
    createdByActorId: "user_1",
    createdAt: "2026-07-20T16:00:00.000Z",
    submittedAt: "2026-07-20T16:00:00.000Z",
    effectiveAt: "2026-07-20T16:00:00.000Z",
    startDate: overrides.startDate ?? "2026-07-20",
    endDate: overrides.endDate ?? "2026-08-20",
    timeZone: "America/Denver",
    status: overrides.status ?? "active",
    completedAt: overrides.completedAt ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    cancelledByActorType: null,
    cancelledByActorId: null,
    cancellationReason: null,
    activityGoal: overrides.activityGoal ?? {
      enabled: true,
      metricType: "weekly_session_count",
      targetValue: 2
    },
    performanceGoal: overrides.performanceGoal ?? {
      enabled: true,
      metricType: "target_average_score",
      targetScore: 85,
      improvementAmount: null,
      comparisonMonthCount: null
    },
    scope: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_1"],
      selectedScenarioIds: ["scenario_1"],
      scenarios: [
        {
          scenarioId: "scenario_1",
          displayName: "Solar Door-to-door",
          source: "custom",
          segmentId: "sales",
          segmentLabel: "Sales",
          focusTopics: [{ id: "focus_1", name: "Solar Door-to-door" }],
          selectionSources: ["focus_topic"]
        }
      ]
    },
    baseline: null,
    finalResult: overrides.finalResult ?? null,
    updatedAt: overrides.updatedAt ?? "2026-07-20T16:00:00.000Z"
  };
}

function buildProgress(overrides: Partial<PerformanceProgress> = {}): PerformanceProgress {
  return {
    generatedAt: "2026-07-20T16:00:00.000Z",
    planId: "perf_plan",
    windowStartAt: "2026-07-20T06:00:00.000Z",
    windowEndAt: "2026-08-21T06:00:00.000Z",
    activity: {
      enabled: true,
      metricType: "weekly_session_count",
      targetValue: 2,
      actualValue: 0,
      cumulativeTargetValue: 0,
      succeeded: false,
      weeklyConsistency: { completedWeeks: 0, totalWeeks: 4 }
    },
    performance: {
      enabled: true,
      metricType: "target_average_score",
      targetScore: 85,
      currentAverage: null,
      eligibleScoreCount: 0,
      baselineAverage: null,
      scoreImprovement: null,
      currentlyMeetingTarget: false,
      notEnoughData: true,
      succeeded: false
    },
    overallCurrentlyMeetingTarget: false,
    overallSucceeded: false,
    ...overrides
  };
}

test("Performance presentation groups active, scheduled, and history without leaking active rows into history", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  const active = { plan: buildPlan({ id: "active", startDate: "2026-07-01", endDate: "2026-08-01" }) };
  const scheduled = { plan: buildPlan({ id: "scheduled", startDate: "2026-09-03", endDate: "2026-09-23" }) };
  const completed = { plan: buildPlan({ id: "completed", status: "completed", completedAt: "2026-07-10T12:00:00.000Z" }) };
  const cancelled = { plan: buildPlan({ id: "cancelled", status: "cancelled", cancelledAt: "2026-07-11T12:00:00.000Z" }) };

  const groups = groupPerformancePlanSummaries([active, scheduled, completed, cancelled], now);

  assert.deepEqual(groups.active.map((row) => row.plan.id), ["active"]);
  assert.deepEqual(groups.scheduled.map((row) => row.plan.id), ["scheduled"]);
  assert.deepEqual(groups.history.map((row) => row.plan.id).sort(), ["cancelled", "completed"]);
});

test("Performance presentation uses scheduled language and configured weekly denominators", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  const scheduled = buildPlan({ startDate: "2026-09-03", endDate: "2026-09-23" });
  const active = buildPlan();
  const progress = buildProgress();

  assert.equal(derivePerformancePlanPresentationStatus(scheduled, now), "scheduled");
  assert.equal(buildPerformanceDateStatusLabel(scheduled, now), "Starts Sep 3");
  assert.equal(buildPerformanceOverallLine(scheduled, progress, now), "Scheduled");
  assert.equal(buildPerformanceActivityLine(scheduled, progress, now), "Weekly target: 2 sessions");
  assert(!buildPerformanceDateStatusLabel(scheduled, now).includes("remaining"));
  assert.equal(buildPerformanceActivityLine(active, progress, now), "0 / 2 sessions this week");
});

test("Performance presentation titles are derived from defining goals", () => {
  assert.equal(buildPerformancePlanTitle(buildPlan()), "Target score: 85");
  assert.equal(
    buildPerformancePlanTitle(buildPlan({
      performanceGoal: {
        enabled: true,
        metricType: "improve_by_percent",
        targetScore: null,
        improvementAmount: 10,
        comparisonMonthCount: 3
      }
    })),
    "Improve score by 10%"
  );
  assert.equal(
    buildPerformancePlanTitle(buildPlan({
      performanceGoal: {
        enabled: false,
        metricType: null,
        targetScore: null,
        improvementAmount: null,
        comparisonMonthCount: null
      }
    })),
    "Weekly session goal"
  );
  assert.equal(
    buildPerformancePlanTitle(buildPlan({
      activityGoal: {
        enabled: false,
        metricType: null,
        targetValue: null
      },
      performanceGoal: {
        enabled: false,
        metricType: null,
        targetScore: null,
        improvementAmount: null,
        comparisonMonthCount: null
      }
    })),
    "Performance goal"
  );
});
