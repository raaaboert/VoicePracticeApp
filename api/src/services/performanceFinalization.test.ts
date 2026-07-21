import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PerformancePlan, SimulationScoreRecord, UsageSessionRecord } from "@voicepractice/shared";

import { createPerformancePlanStore } from "../storage/performancePlanStore.js";
import { finalizePerformancePlanIfEnded } from "./performanceFinalization.js";

function plan(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  return {
    id: overrides.id ?? "plan_1",
    orgId: "org_1",
    userId: "user_1",
    createdByActorType: "mobile_user",
    createdByActorId: "user_1",
    createdAt: "2026-07-01T06:00:00.000Z",
    submittedAt: "2026-07-01T06:00:00.000Z",
    effectiveAt: "2026-07-01T06:00:00.000Z",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    timeZone: "America/Denver",
    status: "active",
    completedAt: null,
    cancelledAt: null,
    cancelledByActorType: null,
    cancelledByActorId: null,
    cancellationReason: null,
    activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 1 },
    performanceGoal: { enabled: true, metricType: "target_average_score", targetScore: 80, improvementAmount: null, comparisonMonthCount: null },
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
    baseline: null,
    finalResult: null,
    updatedAt: "2026-07-01T06:00:00.000Z",
    ...overrides
  };
}

function usage(): UsageSessionRecord {
  return {
    id: "usage_1",
    userId: "user_1",
    orgId: "org_1",
    divisionId: null,
    segmentId: "manager",
    scenarioId: "scenario_1",
    trainingId: null,
    trainingPackId: null,
    startedAt: "2026-07-01T06:00:00.000Z",
    endedAt: "2026-07-01T06:10:00.000Z",
    rawDurationSeconds: 600,
    createdAt: "2026-07-01T06:11:00.000Z"
  };
}

function score(id: string, endedAt: string, overallScore: number): SimulationScoreRecord {
  return {
    id,
    simulationSessionId: `sim_${id}`,
    userId: "user_1",
    orgId: "org_1",
    divisionId: null,
    segmentId: "manager",
    scenarioId: "scenario_1",
    trainingId: null,
    trainingPackId: null,
    industryId: null,
    startedAt: endedAt,
    endedAt,
    overallScore,
    communicationScore: overallScore,
    outcomeScore: overallScore,
    completionLevel: "complete",
    objectiveAchieved: true,
    persuasion: 8,
    clarity: 8,
    empathy: 8,
    assertiveness: 8,
    summary: "Good",
    coachingArtifact: null,
    normalizedCoachingThemes: null,
    rubricVersion: "rubric",
    model: "model",
    promptVersion: "prompt",
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    createdAt: endedAt
  };
}

test("performance finalization completes ended active plans transactionally and idempotently", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "performance-finalization-"));
  try {
    const store = createPerformancePlanStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1,
      pgIdleTimeoutMs: 1
    });
    await store.createPlan({
      plan: plan(),
      scopeItems: [
        {
          id: "scope_1",
          planId: "plan_1",
          orgId: "org_1",
          userId: "user_1",
          scenarioId: "scenario_1",
          scenarioDisplayName: "Scenario One",
          scenarioSource: "standard",
          segmentId: "manager",
          segmentLabel: "Manager",
          focusTopicId: null,
          focusTopicName: null,
          selectionSources: ["direct"],
          metadataSnapshot: {},
          createdAt: "2026-07-01T06:00:00.000Z"
        }
      ],
      auditEvents: []
    });

    const finalized = await finalizePerformancePlanIfEnded({
      store,
      plan: plan(),
      usageSessions: [usage()],
      scoreRecords: [
        score("score_1", "2026-07-01T07:00:00.000Z", 80),
        score("score_2", "2026-07-01T08:00:00.000Z", 90),
        score("score_3", "2026-07-01T09:00:00.000Z", 85)
      ],
      now: new Date("2026-07-03T06:00:00.000Z")
    });

    assert.equal(finalized?.plan.status, "completed");
    assert.equal(finalized?.plan.finalResult?.overallSucceeded, true);
    assert.equal(finalized?.auditEvents.some((event) => event.action === "completed"), true);

    const replay = await finalizePerformancePlanIfEnded({
      store,
      plan: finalized!.plan,
      usageSessions: [],
      scoreRecords: [],
      now: new Date("2026-07-04T06:00:00.000Z")
    });
    assert.equal(replay?.plan.finalResult?.sessionsCompleted, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("performance finalization leaves active plans open before the end boundary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "performance-finalization-open-"));
  try {
    const store = createPerformancePlanStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1,
      pgIdleTimeoutMs: 1
    });
    await store.createPlan({ plan: plan({ id: "plan_open" }), scopeItems: [], auditEvents: [] });
    const result = await finalizePerformancePlanIfEnded({
      store,
      plan: plan({ id: "plan_open" }),
      usageSessions: [],
      scoreRecords: [],
      now: new Date("2026-07-02T05:59:59.000Z")
    });
    assert.equal(result?.plan.status, "active");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
