import assert from "node:assert/strict";
import test from "node:test";

import { PerformanceBaseline, PerformancePlanScope } from "@voicepractice/shared";

import { deriveTargetScore, validatePerformancePlanInput } from "./performancePlanValidation.js";

const scope: PerformancePlanScope = {
  allAssignedScenarios: false,
  selectedFocusTopicIds: ["focus_1"],
  selectedScenarioIds: ["scenario_1"],
  scenarios: [
    {
      scenarioId: "scenario_1",
      displayName: "Difficult Review",
      source: "custom",
      segmentId: "manager",
      segmentLabel: "Manager",
      focusTopics: [{ id: "focus_1", name: "Coaching" }],
      selectionSources: ["direct"]
    }
  ]
};

const baseline: PerformanceBaseline = {
  baselineStartAt: "2026-04-20T16:00:00.000Z",
  baselineEndAt: "2026-07-20T16:00:00.000Z",
  baselineAverage: 70,
  baselineSessionCount: 3,
  derivedTargetScore: 80
};

test("performance validation accepts each approved activity metric", () => {
  for (const metricType of ["weekly_practice_minutes", "total_practice_minutes", "weekly_session_count", "total_session_count"] as const) {
    const result = validatePerformancePlanInput({
      startDate: "2026-07-20",
      endDate: "2026-08-20",
      timeZone: "America/Denver",
      now: new Date("2026-07-20T15:00:00.000Z"),
      activityGoal: { enabled: true, metricType, targetValue: 10 },
      performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null },
      scope,
      baseline: null
    });
    assert.equal(result.valid, true, result.errors.join(" "));
  }
});

test("performance validation enforces required goal sections, date, timezone, and scope rules", () => {
  const result = validatePerformancePlanInput({
    startDate: "2026-07-19",
    endDate: "2026-07-18",
    timeZone: "Invalid/Zone",
    now: new Date("2026-07-20T15:00:00.000Z"),
    activityGoal: { enabled: false, metricType: null, targetValue: null },
    performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null },
    scope: { ...scope, scenarios: [] },
    baseline: null
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes("At least one goal")));
  assert(result.errors.some((error) => error.includes("IANA timezone")));
  assert(result.errors.some((error) => error.includes("startDate must be on or before endDate")));
  assert(result.errors.some((error) => error.includes("scope must include")));
});

test("performance validation rejects backdated user plans in the submitted timezone", () => {
  const result = validatePerformancePlanInput({
    startDate: "2026-07-19",
    endDate: "2026-08-20",
    timeZone: "America/Denver",
    now: new Date("2026-07-20T15:00:00.000Z"),
    activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 3 },
    performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null },
    scope,
    baseline: null
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes("backdated")));
});

test("performance validation rejects target and improvement goals over 100 without silent capping", () => {
  const explicit = validatePerformancePlanInput({
    startDate: "2026-07-20",
    endDate: "2026-08-20",
    timeZone: "America/Denver",
    now: new Date("2026-07-20T15:00:00.000Z"),
    activityGoal: { enabled: false, metricType: null, targetValue: null },
    performanceGoal: { enabled: true, metricType: "target_average_score", targetScore: 101, improvementAmount: null, comparisonMonthCount: null },
    scope,
    baseline: null
  });
  assert.equal(explicit.valid, false);

  const improvement = validatePerformancePlanInput({
    startDate: "2026-07-20",
    endDate: "2026-08-20",
    timeZone: "America/Denver",
    now: new Date("2026-07-20T15:00:00.000Z"),
    activityGoal: { enabled: false, metricType: null, targetValue: null },
    performanceGoal: { enabled: true, metricType: "improve_by_percent", targetScore: null, improvementAmount: 50, comparisonMonthCount: 3 },
    scope,
    baseline: { ...baseline, baselineAverage: 80, derivedTargetScore: 120 }
  });
  assert.equal(improvement.valid, false);
  assert(improvement.errors.some((error) => error.includes("Derived target score")));
});

test("deriveTargetScore preserves precision for point and percentage improvements", () => {
  assert.equal(
    deriveTargetScore({
      goal: { enabled: true, metricType: "improve_by_points", targetScore: null, improvementAmount: 15, comparisonMonthCount: 3 },
      baselineAverage: 62
    }),
    77
  );
  assert.equal(
    deriveTargetScore({
      goal: { enabled: true, metricType: "improve_by_percent", targetScore: null, improvementAmount: 20, comparisonMonthCount: 3 },
      baselineAverage: 62
    }),
    74.39999999999999
  );
});
