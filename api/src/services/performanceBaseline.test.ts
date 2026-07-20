import assert from "node:assert/strict";
import test from "node:test";

import { PerformancePlanScope, SimulationScoreRecord } from "@voicepractice/shared";

import { calculatePerformanceBaseline } from "./performanceBaseline.js";

const scope: PerformancePlanScope = {
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
};

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
    startedAt: overrides.startedAt ?? "2026-05-01T16:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-05-01T16:10:00.000Z",
    overallScore: overrides.overallScore ?? 70,
    communicationScore: overrides.communicationScore ?? 70,
    outcomeScore: overrides.outcomeScore ?? 70,
    completionLevel: overrides.completionLevel,
    objectiveAchieved: overrides.objectiveAchieved ?? true,
    persuasion: overrides.persuasion ?? 7,
    clarity: overrides.clarity ?? 7,
    empathy: overrides.empathy ?? 7,
    assertiveness: overrides.assertiveness ?? 7,
    summary: overrides.summary ?? "Good",
    coachingArtifact: overrides.coachingArtifact ?? null,
    normalizedCoachingThemes: overrides.normalizedCoachingThemes ?? null,
    rubricVersion: overrides.rubricVersion ?? "rubric",
    model: overrides.model ?? "model",
    promptVersion: overrides.promptVersion ?? "prompt",
    inputTokens: overrides.inputTokens ?? 1,
    outputTokens: overrides.outputTokens ?? 1,
    totalTokens: overrides.totalTokens ?? 2,
    createdAt: overrides.createdAt ?? "2026-05-01T16:11:00.000Z"
  };
}

test("performance baseline uses fixed month windows, same frozen scope, and minimum 3 conclusive scores", () => {
  const preview = calculatePerformanceBaseline({
    orgId: "org_1",
    userId: "user_1",
    scope,
    goal: { enabled: true, metricType: "improve_by_points", targetScore: null, improvementAmount: 10, comparisonMonthCount: 3 },
    effectiveAt: "2026-07-20T16:00:00.000Z",
    timeZone: "America/Denver",
    scoreRecords: [
      score({ id: "score_start", endedAt: "2026-04-20T16:00:00.000Z", overallScore: 0 }),
      score({ id: "score_mid", endedAt: "2026-05-20T16:00:00.000Z", overallScore: 60 }),
      score({ id: "score_late", endedAt: "2026-07-19T16:00:00.000Z", overallScore: 90 }),
      score({ id: "score_end_boundary", endedAt: "2026-07-20T16:00:00.000Z", overallScore: 100 }),
      score({ id: "score_partial", endedAt: "2026-06-01T16:00:00.000Z", overallScore: 100, completionLevel: "partial" }),
      score({ id: "score_other_scenario", endedAt: "2026-06-01T16:00:00.000Z", scenarioId: "scenario_2", overallScore: 100 }),
      score({ id: "score_other_org", endedAt: "2026-06-01T16:00:00.000Z", orgId: "org_2", overallScore: 100 })
    ]
  });

  assert.equal(preview.baselineStartAt, "2026-04-20T16:00:00.000Z");
  assert.equal(preview.baselineEndAt, "2026-07-20T16:00:00.000Z");
  assert.equal(preview.eligibleScoreCount, 3);
  assert.equal(preview.baselineAverage, 50);
  assert.equal(preview.baseline?.derivedTargetScore, 60);
});

test("performance baseline reports insufficiency without silently broadening scope", () => {
  const preview = calculatePerformanceBaseline({
    orgId: "org_1",
    userId: "user_1",
    scope,
    goal: { enabled: true, metricType: "improve_by_percent", targetScore: null, improvementAmount: 20, comparisonMonthCount: 1 },
    effectiveAt: "2026-07-20T16:00:00.000Z",
    timeZone: "America/Denver",
    scoreRecords: [
      score({ id: "score_1", endedAt: "2026-07-01T16:00:00.000Z", overallScore: 50 }),
      score({ id: "score_2", endedAt: "2026-07-02T16:00:00.000Z", overallScore: 60 })
    ]
  });

  assert.equal(preview.insufficientData, true);
  assert.equal(preview.baseline, null);
  assert.equal(preview.eligibleScoreCount, 2);
});
