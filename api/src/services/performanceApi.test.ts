import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PerformancePlan,
  PerformancePlanScopeItem,
  SimulationScoreRecord,
  UsageSessionRecord
} from "@voicepractice/shared";

import { createPerformancePlanStore } from "../storage/performancePlanStore.js";
import {
  buildMobilePerformanceCurrentResponse,
  cancelPerformancePlanWithBoundaryRule,
  createPerformancePlanFromInput,
  PerformancePlanInputError,
  previewPerformancePlan
} from "./performanceApi.js";
import { PerformanceScopeCandidate } from "./performanceScope.js";

const NOW = new Date("2026-07-20T16:00:00.000Z");

function buildPlan(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  const planId = overrides.id ?? "perf_plan_1";
  const userId = overrides.userId ?? "user_1";
  const orgId = overrides.orgId ?? "org_1";
  return {
    id: planId,
    orgId,
    userId,
    createdByActorType: "mobile_user",
    createdByActorId: userId,
    createdAt: overrides.createdAt ?? "2026-07-01T06:00:00.000Z",
    submittedAt: overrides.submittedAt ?? "2026-07-01T06:00:00.000Z",
    effectiveAt: overrides.effectiveAt ?? "2026-07-01T06:00:00.000Z",
    startDate: overrides.startDate ?? "2026-07-01",
    endDate: overrides.endDate ?? "2099-12-31",
    timeZone: overrides.timeZone ?? "America/Denver",
    status: overrides.status ?? "active",
    completedAt: overrides.completedAt ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    cancelledByActorType: overrides.cancelledByActorType ?? null,
    cancelledByActorId: overrides.cancelledByActorId ?? null,
    cancellationReason: overrides.cancellationReason ?? null,
    activityGoal: overrides.activityGoal ?? {
      enabled: true,
      metricType: "total_session_count",
      targetValue: 1
    },
    performanceGoal: overrides.performanceGoal ?? {
      enabled: true,
      metricType: "target_average_score",
      targetScore: 80,
      improvementAmount: null,
      comparisonMonthCount: null
    },
    scope: overrides.scope ?? {
      allAssignedScenarios: false,
      selectedFocusTopicIds: [],
      selectedScenarioIds: ["scenario_1"],
      scenarios: [
        {
          scenarioId: "scenario_1",
          displayName: "Difficult Performance Review",
          source: "standard",
          segmentId: "manager",
          segmentLabel: "Manager",
          focusTopics: [],
          selectionSources: ["direct"]
        }
      ]
    },
    baseline: overrides.baseline ?? null,
    finalResult: overrides.finalResult ?? null,
    updatedAt: overrides.updatedAt ?? "2026-07-01T06:00:00.000Z"
  };
}

function buildScopeItem(overrides: Partial<PerformancePlanScopeItem> = {}): PerformancePlanScopeItem {
  return {
    id: overrides.id ?? "perf_scope_1",
    planId: overrides.planId ?? "perf_plan_1",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    scenarioDisplayName: overrides.scenarioDisplayName ?? "Difficult Performance Review",
    scenarioSource: overrides.scenarioSource ?? "standard",
    segmentId: overrides.segmentId ?? "manager",
    segmentLabel: overrides.segmentLabel ?? "Manager",
    focusTopicId: overrides.focusTopicId ?? null,
    focusTopicName: overrides.focusTopicName ?? null,
    selectionSources: overrides.selectionSources ?? ["direct"],
    metadataSnapshot: overrides.metadataSnapshot ?? {},
    createdAt: overrides.createdAt ?? "2026-07-01T06:00:00.000Z"
  };
}

function buildUsage(overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    id: overrides.id ?? "usage_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    divisionId: overrides.divisionId ?? null,
    segmentId: overrides.segmentId ?? "manager",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    startedAt: overrides.startedAt ?? "2026-07-10T15:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-07-10T15:10:00.000Z",
    rawDurationSeconds: overrides.rawDurationSeconds ?? 600,
    billedSecondsAdded: overrides.billedSecondsAdded,
    createdAt: overrides.createdAt ?? "2026-07-10T15:10:00.000Z"
  };
}

function buildScore(id: string, overallScore: number, overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  const endedAt = overrides.endedAt ?? `2026-07-10T1${id.slice(-1)}:00:00.000Z`;
  return {
    id,
    simulationSessionId: overrides.simulationSessionId ?? `sim_${id}`,
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    divisionId: overrides.divisionId ?? null,
    segmentId: overrides.segmentId ?? "manager",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    industryId: overrides.industryId ?? null,
    startedAt: overrides.startedAt ?? endedAt,
    endedAt,
    communicationScore: overrides.communicationScore ?? overallScore,
    outcomeScore: overrides.outcomeScore ?? overallScore,
    overallScore,
    completionLevel: overrides.completionLevel ?? "complete",
    objectiveAchieved: overrides.objectiveAchieved ?? true,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 8,
    empathy: overrides.empathy ?? 8,
    assertiveness: overrides.assertiveness ?? 8,
    summary: overrides.summary ?? "Good attempt",
    coachingArtifact: overrides.coachingArtifact ?? null,
    normalizedCoachingThemes: overrides.normalizedCoachingThemes ?? null,
    rubricVersion: overrides.rubricVersion ?? "rubric",
    model: overrides.model ?? "model",
    promptVersion: overrides.promptVersion ?? "prompt",
    inputTokens: overrides.inputTokens ?? 1,
    outputTokens: overrides.outputTokens ?? 1,
    totalTokens: overrides.totalTokens ?? 2,
    createdAt: overrides.createdAt ?? endedAt
  };
}

const candidates: PerformanceScopeCandidate[] = [
  {
    scenarioId: "scenario_1",
    displayName: "Difficult Performance Review",
    source: "standard",
    segmentId: "manager",
    segmentLabel: "Manager",
    focusTopics: [{ id: "focus_1", name: "Coaching" }]
  }
];

function buildPlanInput() {
  return {
    userId: "user_1",
    orgId: "org_1",
    startDate: "2026-07-20",
    endDate: "2026-08-20",
    timeZone: "America/Denver",
    activityGoal: {
      enabled: true,
      metricType: "total_session_count" as const,
      targetValue: 1
    },
    performanceGoal: {
      enabled: false,
      metricType: null,
      targetScore: null,
      improvementAmount: null,
      comparisonMonthCount: null
    },
    scopeSelection: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_1"],
      selectedScenarioIds: []
    }
  };
}

async function withTempStore<T>(runner: (store: ReturnType<typeof createPerformancePlanStore>) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "performance-api-"));
  try {
    const store = createPerformancePlanStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1,
      pgIdleTimeoutMs: 1
    });
    await store.initialize();
    return await runner(store);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("mobile performance current response is successful and empty when no active plan exists", async () => {
  await withTempStore(async (store) => {
    const response = await buildMobilePerformanceCurrentResponse({
      store,
      orgId: "org_1",
      userId: "user_1",
      usageSessions: [],
      scoreRecords: [],
      now: NOW
    });

    assert.equal(response.generatedAt, NOW.toISOString());
    assert.deepEqual(response.activePlans, []);
    assert.equal(response.displayState.state, "no_active_plans");
  });
});

test("mobile performance current response returns active progress and deterministic insights", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan(),
      scopeItems: [buildScopeItem()],
      auditEvents: []
    });

    const response = await buildMobilePerformanceCurrentResponse({
      store,
      orgId: "org_1",
      userId: "user_1",
      usageSessions: [buildUsage({ endedAt: "2026-07-20T15:10:00.000Z" })],
      scoreRecords: [
        buildScore("score_1", 80),
        buildScore("score_2", 90),
        buildScore("score_3", 85)
      ],
      now: NOW
    });

    assert.equal(response.activePlans.length, 1);
    assert.equal(response.activePlans[0].plan.id, "perf_plan_1");
    assert.equal(response.activePlans[0].progress?.activity.actualValue, 1);
    assert.equal(response.activePlans[0].progress?.performance.eligibleScoreCount, 3);
    assert.equal(response.activePlans[0].progress?.performance.currentAverage, 85);
    assert.equal(response.activePlans[0].insights.some((insight) => insight.status === "goal_met"), true);
    assert.equal(response.displayState.state, "active_plans_on_track");
    assert.equal(response.displayState.activePlanCount, 1);
  });
});

test("mobile performance current response returns multiple active plans independently", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan({ id: "perf_plan_1", endDate: "2026-08-01" }),
      scopeItems: [buildScopeItem({ planId: "perf_plan_1" })],
      auditEvents: []
    });
    await store.createPlan({
      plan: buildPlan({
        id: "perf_plan_2",
        endDate: "2026-08-15",
        activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 2 }
      }),
      scopeItems: [buildScopeItem({ id: "perf_scope_2", planId: "perf_plan_2" })],
      auditEvents: []
    });

    const response = await buildMobilePerformanceCurrentResponse({
      store,
      orgId: "org_1",
      userId: "user_1",
      usageSessions: [buildUsage({ id: "usage_1" }), buildUsage({ id: "usage_2" })],
      scoreRecords: [buildScore("score_1", 80), buildScore("score_2", 90), buildScore("score_3", 85)],
      now: NOW
    });

    assert.deepEqual(response.activePlans.map((summary) => summary.plan.id), ["perf_plan_1", "perf_plan_2"]);
    assert.equal(response.activePlans[0].progress?.planId, "perf_plan_1");
    assert.equal(response.activePlans[1].progress?.planId, "perf_plan_2");
    assert.equal(response.activePlans[0].progress?.activity.actualValue, 2);
    assert.equal(response.activePlans[1].progress?.activity.actualValue, 2);
    assert.equal(response.activePlans[0].progress?.performance.eligibleScoreCount, 3);
    assert.equal(response.activePlans[1].progress?.performance.eligibleScoreCount, 3);
    assert.equal(response.displayState.activePlanCount, 2);
  });
});

test("mobile performance current response lazily finalizes expired plans once", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan({
        id: "perf_plan_expired",
        startDate: "2026-07-01",
        endDate: "2026-07-02"
      }),
      scopeItems: [buildScopeItem({ id: "perf_scope_expired", planId: "perf_plan_expired" })],
      auditEvents: []
    });

    const params = {
      store,
      orgId: "org_1",
      userId: "user_1",
      usageSessions: [buildUsage({ endedAt: "2026-07-01T15:10:00.000Z" })],
      scoreRecords: [
        buildScore("score_1", 80, { endedAt: "2026-07-01T15:00:00.000Z" }),
        buildScore("score_2", 90, { endedAt: "2026-07-01T16:00:00.000Z" }),
        buildScore("score_3", 85, { endedAt: "2026-07-01T17:00:00.000Z" })
      ],
      now: new Date("2026-07-03T06:00:00.000Z")
    };

    const [first, second] = await Promise.all([
      buildMobilePerformanceCurrentResponse(params),
      buildMobilePerformanceCurrentResponse(params)
    ]);

    assert.deepEqual(first.activePlans, []);
    assert.deepEqual(second.activePlans, []);
    const finalized = await store.getPlanById("perf_plan_expired");
    assert.equal(finalized?.plan.status, "completed");
    assert.equal(finalized?.plan.finalResult?.sessionsCompleted, 1);
    assert.equal(finalized?.auditEvents.filter((event) => event.action === "completed").length, 1);
  });
});

test("performance calculation errors do not mutate simulation or usage evidence", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan(),
      scopeItems: [buildScopeItem()],
      auditEvents: []
    });
    const usageSessions = [buildUsage()];
    const scoreRecords = [buildScore("score_1", 80), buildScore("score_2", 90), buildScore("score_3", 85)];
    const originalUsageSessions = structuredClone(usageSessions);
    const originalScoreRecords = structuredClone(scoreRecords);

    await assert.rejects(
      () =>
        buildMobilePerformanceCurrentResponse({
          store,
          orgId: "org_1",
          userId: "user_1",
          usageSessions,
          scoreRecords,
          now: NOW,
          calculateProgress: () => {
            throw new Error("Performance calculation failed.");
          }
        }),
      /Performance calculation failed/
    );

    assert.deepEqual(usageSessions, originalUsageSessions);
    assert.deepEqual(scoreRecords, originalScoreRecords);
    const plan = await store.getPlanById("perf_plan_1");
    assert.equal(plan?.plan.status, "active");
    assert.equal(plan?.auditEvents.length, 0);
  });
});

test("performance plan preview freezes Focus Topic scope and validates before creation", async () => {
  const response = previewPerformancePlan({
    orgId: "org_1",
    userId: "user_1",
    input: buildPlanInput(),
    candidates,
    usageSessions: [],
    scoreRecords: [],
    now: NOW
  });

  assert.equal(response.valid, true);
  assert.equal(response.scope?.scenarios.length, 1);
  assert.equal(response.scope?.selectedFocusTopicIds[0], "focus_1");
  assert.equal(response.availableFocusTopics[0]?.name, "Coaching");
  assert.equal(response.availableScenarios[0]?.scenarioId, "scenario_1");
});

test("performance plan preview rejects malformed request shape before nested fields are read", () => {
  assert.throws(
    () =>
      previewPerformancePlan({
        orgId: "org_1",
        userId: "user_1",
        input: { ...buildPlanInput(), scopeSelection: undefined } as never,
        candidates,
        usageSessions: [],
        scoreRecords: [],
        now: NOW
      }),
    PerformancePlanInputError
  );

  assert.throws(
    () =>
      previewPerformancePlan({
        orgId: "org_1",
        userId: "user_1",
        input: { ...buildPlanInput(), startDate: "2026-02-31" } as never,
        candidates,
        usageSessions: [],
        scoreRecords: [],
        now: NOW
      }),
    /valid calendar date/
  );
});

test("performance plan create stores active plans with frozen scope and audit event", async () => {
  await withTempStore(async (store) => {
    const response = await createPerformancePlanFromInput({
      store,
      orgId: "org_1",
      userId: "user_1",
      input: buildPlanInput(),
      candidates,
      usageSessions: [buildUsage()],
      scoreRecords: [],
      now: NOW,
      actorType: "web_user",
      actorId: "dashboard_user",
      createPlanId: () => "perf_created",
      createScopeItemId: (scenarioId) => `scope_${scenarioId}`,
      createAuditEventId: () => "audit_created"
    });

    assert.equal(response.created, true);
    assert.equal(response.plan.id, "perf_created");
    assert.equal(response.plan.createdByActorType, "web_user");
    assert.equal(response.plan.scope.scenarios[0]?.focusTopics[0]?.name, "Coaching");
    assert.equal(response.progress?.activity.actualValue, 0);

    const stored = await store.getPlanById("perf_created");
    assert.equal(stored?.scopeItems.length, 1);
    assert.equal(stored?.auditEvents[0]?.action, "created");
  });
});

test("performance plan create normalizes service validation failures to input errors", async () => {
  await withTempStore(async (store) => {
    await assert.rejects(
      () =>
        createPerformancePlanFromInput({
          store,
          orgId: "org_1",
          userId: "user_1",
          input: {
            ...buildPlanInput(),
            scopeSelection: {
              allAssignedScenarios: false,
              selectedFocusTopicIds: [],
              selectedScenarioIds: ["missing_scenario"]
            }
          },
          candidates,
          usageSessions: [],
          scoreRecords: [],
          now: NOW,
          actorType: "web_user",
          actorId: "dashboard_user"
        }),
      PerformancePlanInputError
    );

    await assert.rejects(
      () =>
        createPerformancePlanFromInput({
          store,
          orgId: "org_1",
          userId: "user_1",
          input: {
            ...buildPlanInput(),
            activityGoal: { enabled: false, metricType: null, targetValue: null },
            performanceGoal: {
              enabled: true,
              metricType: "improve_by_points",
              targetScore: null,
              improvementAmount: 10,
              comparisonMonthCount: 3
            }
          },
          candidates,
          usageSessions: [],
          scoreRecords: [],
          now: NOW,
          actorType: "web_user",
          actorId: "dashboard_user"
        }),
      /Improvement goals require a baseline/
    );
  });
});

test("performance plan cancel route service finalizes expired plans instead of cancelling", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan({
        id: "perf_expired",
        startDate: "2026-07-01",
        endDate: "2026-07-02"
      }),
      scopeItems: [buildScopeItem({ id: "scope_expired", planId: "perf_expired" })],
      auditEvents: []
    });

    const response = await cancelPerformancePlanWithBoundaryRule({
      store,
      planId: "perf_expired",
      usageSessions: [buildUsage({ endedAt: "2026-07-01T15:10:00.000Z" })],
      scoreRecords: [
        buildScore("score_1", 80, { endedAt: "2026-07-01T15:00:00.000Z" }),
        buildScore("score_2", 90, { endedAt: "2026-07-01T16:00:00.000Z" }),
        buildScore("score_3", 85, { endedAt: "2026-07-01T17:00:00.000Z" })
      ],
      now: new Date("2026-07-03T06:00:00.000Z"),
      actorType: "web_user",
      actorId: "dashboard_user",
      reason: "too late"
    });

    assert.equal(response?.cancelled, false);
    assert.equal(response?.finalizedInstead, true);
    assert.equal(response?.plan?.status, "completed");
    const stored = await store.getPlanById("perf_expired");
    assert.equal(stored?.auditEvents.filter((event) => event.action === "completed").length, 1);
  });
});
