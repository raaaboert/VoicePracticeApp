import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PerformanceAuditEvent,
  PerformanceFinalResult,
  PerformancePlan,
  PerformancePlanScopeItem
} from "@voicepractice/shared";

import { createPerformancePlanStore } from "./performancePlanStore.js";

const NOW = "2026-07-20T16:00:00.000Z";
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

function buildPlan(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  const scope = overrides.scope ?? {
    allAssignedScenarios: false,
    selectedFocusTopicIds: ["focus_1"],
    selectedScenarioIds: ["scenario_1"],
    scenarios: [
      {
        scenarioId: "scenario_1",
        displayName: "Difficult Performance Review",
        source: "custom",
        segmentId: "manager",
        segmentLabel: "Manager",
        focusTopics: [{ id: "focus_1", name: "Coaching and Feedback" }],
        selectionSources: ["focus_topic", "direct"],
        metadata: { frozen: true }
      }
    ]
  };

  return {
    id: overrides.id ?? "perf_plan_1",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_1",
    createdByActorType: overrides.createdByActorType ?? "mobile_user",
    createdByActorId: overrides.createdByActorId ?? "user_1",
    createdAt: overrides.createdAt ?? NOW,
    submittedAt: overrides.submittedAt ?? NOW,
    effectiveAt: overrides.effectiveAt ?? NOW,
    startDate: overrides.startDate ?? "2026-07-20",
    endDate: overrides.endDate ?? "2026-08-20",
    timeZone: overrides.timeZone ?? "America/Denver",
    status: overrides.status ?? "active",
    completedAt: overrides.completedAt ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    cancelledByActorType: overrides.cancelledByActorType ?? null,
    cancelledByActorId: overrides.cancelledByActorId ?? null,
    cancellationReason: overrides.cancellationReason ?? null,
    activityGoal: overrides.activityGoal ?? {
      enabled: true,
      metricType: "weekly_practice_minutes",
      targetValue: 30
    },
    performanceGoal: overrides.performanceGoal ?? {
      enabled: true,
      metricType: "improve_by_points",
      targetScore: null,
      improvementAmount: 10,
      comparisonMonthCount: 3
    },
    scope,
    baseline: overrides.baseline ?? {
      baselineStartAt: "2026-04-20T16:00:00.000Z",
      baselineEndAt: NOW,
      baselineAverage: 70,
      baselineSessionCount: 3,
      derivedTargetScore: 80
    },
    finalResult: overrides.finalResult ?? null,
    updatedAt: overrides.updatedAt ?? NOW
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
    scenarioSource: overrides.scenarioSource ?? "custom",
    segmentId: overrides.segmentId ?? "manager",
    segmentLabel: overrides.segmentLabel ?? "Manager",
    focusTopicId: overrides.focusTopicId ?? "focus_1",
    focusTopicName: overrides.focusTopicName ?? "Coaching and Feedback",
    selectionSources: overrides.selectionSources ?? ["focus_topic", "direct"],
    metadataSnapshot: overrides.metadataSnapshot ?? { frozen: true },
    createdAt: overrides.createdAt ?? NOW
  };
}

function buildAuditEvent(overrides: Partial<PerformanceAuditEvent> = {}): PerformanceAuditEvent {
  return {
    id: overrides.id ?? "perf_audit_1",
    planId: overrides.planId ?? "perf_plan_1",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_1",
    actorType: overrides.actorType ?? "mobile_user",
    actorId: overrides.actorId ?? "user_1",
    action: overrides.action ?? "created",
    changedFields: overrides.changedFields ?? ["status"],
    oldValues: overrides.oldValues ?? null,
    newValues: overrides.newValues ?? { status: "active" },
    reason: overrides.reason ?? null,
    createdAt: overrides.createdAt ?? NOW
  };
}

function buildFinalResult(overrides: Partial<PerformanceFinalResult> = {}): PerformanceFinalResult {
  return {
    finalizedAt: overrides.finalizedAt ?? "2026-08-21T06:00:00.000Z",
    windowStartAt: overrides.windowStartAt ?? NOW,
    windowEndAt: overrides.windowEndAt ?? "2026-08-21T06:00:00.000Z",
    activitySucceeded: overrides.activitySucceeded ?? true,
    performanceSucceeded: overrides.performanceSucceeded ?? true,
    overallSucceeded: overrides.overallSucceeded ?? true,
    performanceInsufficientEvidence: overrides.performanceInsufficientEvidence ?? false,
    finalAverageScore: overrides.finalAverageScore ?? 82,
    scoreImprovement: overrides.scoreImprovement ?? 12,
    totalPracticeSeconds: overrides.totalPracticeSeconds ?? 7200,
    sessionsCompleted: overrides.sessionsCompleted ?? 12,
    weeklyConsistency: overrides.weeklyConsistency ?? { completedWeeks: 4, totalWeeks: 5 },
    scope: overrides.scope ?? buildPlan().scope
  };
}

function buildPostgresPlanRow(plan: PerformancePlan): Record<string, unknown> {
  return {
    id: plan.id,
    org_id: plan.orgId,
    user_id: plan.userId,
    created_by_actor_type: plan.createdByActorType,
    created_by_actor_id: plan.createdByActorId,
    created_at: plan.createdAt,
    submitted_at: plan.submittedAt,
    effective_at: plan.effectiveAt,
    start_date: plan.startDate,
    end_date: plan.endDate,
    time_zone: plan.timeZone,
    status: plan.status,
    completed_at: plan.completedAt,
    cancelled_at: plan.cancelledAt,
    cancelled_by_actor_type: plan.cancelledByActorType,
    cancelled_by_actor_id: plan.cancelledByActorId,
    cancellation_reason: plan.cancellationReason,
    activity_goal_enabled: plan.activityGoal.enabled,
    activity_metric_type: plan.activityGoal.metricType,
    activity_target_value: plan.activityGoal.targetValue,
    performance_goal_enabled: plan.performanceGoal.enabled,
    performance_metric_type: plan.performanceGoal.metricType,
    target_score: plan.performanceGoal.targetScore,
    improvement_amount: plan.performanceGoal.improvementAmount,
    comparison_month_count: plan.performanceGoal.comparisonMonthCount,
    baseline_start_at: plan.baseline?.baselineStartAt ?? null,
    baseline_end_at: plan.baseline?.baselineEndAt ?? null,
    baseline_average: plan.baseline?.baselineAverage ?? null,
    baseline_session_count: plan.baseline?.baselineSessionCount ?? null,
    derived_target_score: plan.baseline?.derivedTargetScore ?? null,
    all_assigned_scenarios: plan.scope.allAssignedScenarios,
    selected_focus_topic_ids: plan.scope.selectedFocusTopicIds,
    selected_scenario_ids: plan.scope.selectedScenarioIds,
    scope_snapshot: plan.scope,
    baseline_snapshot: plan.baseline,
    final_result_snapshot: plan.finalResult,
    definition_signature: "signature",
    updated_at: plan.updatedAt
  };
}

function assertTerminalPlanFieldsUnchanged(actual: PerformancePlan, expected: PerformancePlan): void {
  assert.equal(actual.createdAt, expected.createdAt);
  assert.equal(actual.submittedAt, expected.submittedAt);
  assert.equal(actual.effectiveAt, expected.effectiveAt);
  assert.equal(actual.startDate, expected.startDate);
  assert.equal(actual.endDate, expected.endDate);
  assert.equal(actual.completedAt, expected.completedAt);
  assert.equal(actual.cancelledAt, expected.cancelledAt);
  assert.equal(actual.updatedAt, expected.updatedAt);
  assert.deepEqual(actual.activityGoal, expected.activityGoal);
  assert.deepEqual(actual.performanceGoal, expected.performanceGoal);
  assert.equal(actual.performanceGoal.targetScore, expected.performanceGoal.targetScore);
  assert.equal(actual.baseline?.derivedTargetScore, expected.baseline?.derivedTargetScore);
  assert.deepEqual(actual.baseline, expected.baseline);
  assert.deepEqual(actual.scope, expected.scope);
  assert.equal(actual.status, expected.status);
  assert.deepEqual(actual.finalResult, expected.finalResult);
}

async function withTempStore<T>(runner: (store: ReturnType<typeof createPerformancePlanStore>) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "performance-plan-store-"));
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

test("performance plan store creates and reads a plan with scope and audit rows", async () => {
  await withTempStore(async (store) => {
    const created = await store.createPlan({
      plan: buildPlan(),
      scopeItems: [buildScopeItem()],
      auditEvents: [buildAuditEvent()]
    });

    assert.equal(created.plan.id, "perf_plan_1");
    assert.equal(created.scopeItems.length, 1);
    assert.equal(created.scopeItems[0].scenarioDisplayName, "Difficult Performance Review");
    assert.equal(created.auditEvents.length, 1);

    const loaded = await store.getPlanById("perf_plan_1");
    assert.equal(loaded?.plan.baseline?.derivedTargetScore, 80);
    assert.deepEqual(loaded?.plan.scope.selectedFocusTopicIds, ["focus_1"]);
  });
});

test("performance plan store allows distinct active plans and rejects exact active duplicates", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan({ id: "perf_plan_1" }),
      scopeItems: [buildScopeItem({ id: "scope_1", planId: "perf_plan_1" })],
      auditEvents: []
    });

    await assert.rejects(
      () =>
        store.createPlan({
          plan: buildPlan({ id: "perf_plan_2" }),
          scopeItems: [buildScopeItem({ id: "scope_2", planId: "perf_plan_2" })],
          auditEvents: []
        }),
      /identical active Performance plan already exists/
    );

    await store.createPlan({
      plan: buildPlan({
        id: "perf_plan_distinct",
        activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 3 }
      }),
      scopeItems: [buildScopeItem({ id: "scope_distinct", planId: "perf_plan_distinct" })],
      auditEvents: []
    });

    const userPlans = await store.listPlansForUser("org_1", "user_1");
    assert.equal(userPlans.filter((entry) => entry.plan.status === "active").length, 2);

    const buildTwoScenarioScope = (reversed: boolean): PerformancePlan["scope"] => {
      const scenarios: PerformancePlan["scope"]["scenarios"] = [
        {
          scenarioId: "scenario_1",
          displayName: "Difficult Performance Review",
          source: "custom",
          segmentId: "manager",
          segmentLabel: "Manager",
          focusTopics: [{ id: "focus_1", name: "Coaching and Feedback" }],
          selectionSources: ["focus_topic", "direct"],
          metadata: { frozen: true }
        },
        {
          scenarioId: "scenario_2",
          displayName: "Discovery Call",
          source: "custom",
          segmentId: "sales",
          segmentLabel: "Sales",
          focusTopics: [{ id: "focus_2", name: "Discovery" }],
          selectionSources: ["focus_topic", "direct"],
          metadata: { frozen: true }
        }
      ];
      return {
        allAssignedScenarios: false,
        selectedFocusTopicIds: reversed ? ["focus_2", "focus_1"] : ["focus_1", "focus_2"],
        selectedScenarioIds: reversed ? ["scenario_2", "scenario_1"] : ["scenario_1", "scenario_2"],
        scenarios: reversed ? scenarios.slice().reverse() : scenarios
      };
    };

    await store.createPlan({
      plan: buildPlan({
        id: "perf_plan_ordered",
        activityGoal: { enabled: true, metricType: "weekly_practice_minutes", targetValue: 45 },
        scope: buildTwoScenarioScope(false)
      }),
      scopeItems: [
        buildScopeItem({ id: "scope_ordered_1", planId: "perf_plan_ordered", scenarioId: "scenario_1" }),
        buildScopeItem({ id: "scope_ordered_2", planId: "perf_plan_ordered", scenarioId: "scenario_2" })
      ],
      auditEvents: []
    });
    await assert.rejects(
      () =>
        store.createPlan({
          plan: buildPlan({
            id: "perf_plan_reordered",
            activityGoal: { enabled: true, metricType: "weekly_practice_minutes", targetValue: 45 },
            scope: buildTwoScenarioScope(true)
          }),
          scopeItems: [
            buildScopeItem({ id: "scope_reordered_2", planId: "perf_plan_reordered", scenarioId: "scenario_2" }),
            buildScopeItem({ id: "scope_reordered_1", planId: "perf_plan_reordered", scenarioId: "scenario_1" })
          ],
          auditEvents: []
        }),
      /identical active Performance plan already exists/
    );

    await store.createPlan({
      plan: buildPlan({ id: "perf_plan_other_user", userId: "user_2" }),
      scopeItems: [buildScopeItem({ id: "scope_other_user", planId: "perf_plan_other_user", userId: "user_2" })],
      auditEvents: []
    });

    const open = await store.getOpenPlanForUser("org_1", "user_1");
    assert.ok(open?.plan.id);
  });
});

test("performance plan store serializes concurrent active creates by normalized definition", async () => {
  await withTempStore(async (store) => {
    const duplicateResults = await Promise.allSettled([
      store.createPlan({
        plan: buildPlan({ id: "perf_concurrent_duplicate_a" }),
        scopeItems: [buildScopeItem({ id: "scope_concurrent_duplicate_a", planId: "perf_concurrent_duplicate_a" })],
        auditEvents: []
      }),
      store.createPlan({
        plan: buildPlan({ id: "perf_concurrent_duplicate_b" }),
        scopeItems: [buildScopeItem({ id: "scope_concurrent_duplicate_b", planId: "perf_concurrent_duplicate_b" })],
        auditEvents: []
      })
    ]);
    assert.equal(duplicateResults.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = duplicateResults.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    assert.match(String(rejected?.reason?.message ?? rejected?.reason), /identical active Performance plan already exists/);
    assert.equal((await store.listPlansForUser("org_1", "user_1")).filter((entry) => entry.plan.status === "active").length, 1);
  });

  await withTempStore(async (store) => {
    await Promise.all([
      store.createPlan({
        plan: buildPlan({ id: "perf_concurrent_distinct_a" }),
        scopeItems: [buildScopeItem({ id: "scope_concurrent_distinct_a", planId: "perf_concurrent_distinct_a" })],
        auditEvents: []
      }),
      store.createPlan({
        plan: buildPlan({
          id: "perf_concurrent_distinct_b",
          activityGoal: { enabled: true, metricType: "weekly_practice_minutes", targetValue: 45 }
        }),
        scopeItems: [buildScopeItem({ id: "scope_concurrent_distinct_b", planId: "perf_concurrent_distinct_b" })],
        auditEvents: []
      })
    ]);
    assert.equal((await store.listPlansForUser("org_1", "user_1")).filter((entry) => entry.plan.status === "active").length, 2);
  });
});

test("performance plan store updates only active plans and records edited scope/audit rows", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan(),
      scopeItems: [buildScopeItem()],
      auditEvents: []
    });

    const updatedPlan = buildPlan({
      startDate: "2026-07-22",
      endDate: "2026-08-22",
      activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 5 },
      performanceGoal: {
        enabled: true,
        metricType: "target_average_score",
        targetScore: 91,
        improvementAmount: null,
        comparisonMonthCount: null
      },
      baseline: null,
      scope: {
        allAssignedScenarios: false,
        selectedFocusTopicIds: [],
        selectedScenarioIds: ["scenario_2"],
        scenarios: [
          {
            scenarioId: "scenario_2",
            displayName: "Updated Scenario",
            source: "custom",
            segmentId: "manager",
            segmentLabel: "Manager",
            focusTopics: [],
            selectionSources: ["direct"],
            metadata: {}
          }
        ]
      },
      updatedAt: "2026-07-22T16:00:00.000Z"
    });

    const updated = await store.updatePlan({
      plan: updatedPlan,
      scopeItems: [
        buildScopeItem({
          id: "scope_updated",
          scenarioId: "scenario_2",
          scenarioDisplayName: "Updated Scenario",
          focusTopicId: null,
          focusTopicName: null,
          selectionSources: ["direct"],
          createdAt: "2026-07-22T16:00:00.000Z"
        })
      ],
      auditEvent: buildAuditEvent({ id: "audit_updated", action: "updated", createdAt: "2026-07-22T16:00:00.000Z" })
    });

    assert.equal(updated?.plan.startDate, "2026-07-22");
    assert.equal(updated?.plan.activityGoal.targetValue, 5);
    assert.deepEqual(updated?.plan.scope.selectedScenarioIds, ["scenario_2"]);
    assert.equal(updated?.scopeItems.length, 1);
    assert.equal(updated?.scopeItems[0].scenarioId, "scenario_2");
    assert.deepEqual(updated?.auditEvents.map((event) => event.id), ["audit_updated"]);

    await store.createPlan({
      plan: buildPlan({
        id: "perf_plan_duplicate_target",
        startDate: "2026-09-01",
        endDate: "2026-10-01",
        activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 8 }
      }),
      scopeItems: [buildScopeItem({ id: "scope_duplicate_target", planId: "perf_plan_duplicate_target" })],
      auditEvents: []
    });

    await assert.rejects(
      () =>
        store.updatePlan({
          plan: {
            ...updatedPlan,
            id: "perf_plan_duplicate_target",
            createdAt: "2026-07-10T16:00:00.000Z",
            submittedAt: "2026-07-10T16:00:00.000Z",
            effectiveAt: "2026-07-10T16:00:00.000Z"
          },
          scopeItems: [buildScopeItem({ id: "scope_duplicate_update", planId: "perf_plan_duplicate_target", scenarioId: "scenario_2" })],
          auditEvent: buildAuditEvent({ id: "audit_duplicate_update", planId: "perf_plan_duplicate_target", action: "updated" })
        }),
      /identical active Performance plan already exists/
    );

    const cancelled = await store.cancelPlan({
      planId: "perf_plan_1",
      cancelledAt: "2026-07-25T18:00:00.000Z",
      cancelledByActorType: "mobile_user",
      cancelledByActorId: "user_1",
      cancellationReason: "done editing",
      finalResult: buildFinalResult({ finalizedAt: "2026-07-25T18:00:00.000Z" }),
      auditEvent: buildAuditEvent({ id: "audit_cancel_after_update", action: "cancelled" })
    });
    assert(cancelled);

    const terminalEdit = await store.updatePlan({
      plan: { ...updatedPlan, startDate: "2026-07-23", updatedAt: "2026-07-23T16:00:00.000Z" },
      scopeItems: [buildScopeItem({ id: "scope_terminal", scenarioId: "scenario_terminal" })],
      auditEvent: buildAuditEvent({ id: "audit_terminal_update", action: "updated" })
    });
    assert.equal(terminalEdit, null);
    assertTerminalPlanFieldsUnchanged((await store.getPlanById("perf_plan_1"))!.plan, cancelled.plan);
  });
});

test("performance plan store finalizes active plans idempotently and releases the active slot", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan(),
      scopeItems: [buildScopeItem()],
      auditEvents: []
    });

    const completed = await store.completePlan({
      planId: "perf_plan_1",
      completedAt: "2026-08-21T06:00:00.000Z",
      finalResult: buildFinalResult(),
      auditEvent: buildAuditEvent({ id: "audit_completed", action: "completed" })
    });
    assert.equal(completed?.plan.status, "completed");
    assert.equal(completed?.plan.finalResult?.overallSucceeded, true);

    const replay = await store.completePlan({
      planId: "perf_plan_1",
      completedAt: "2026-08-21T06:00:00.000Z",
      finalResult: buildFinalResult({ overallSucceeded: false }),
      auditEvent: buildAuditEvent({ id: "audit_completed_replay", action: "completed" })
    });
    assert.equal(replay?.plan.finalResult?.overallSucceeded, true);

    await store.createPlan({
      plan: buildPlan({ id: "perf_plan_2" }),
      scopeItems: [buildScopeItem({ id: "scope_2", planId: "perf_plan_2" })],
      auditEvents: []
    });
    assert.equal((await store.getOpenPlanForUser("org_1", "user_1"))?.plan.id, "perf_plan_2");
  });
});

test("performance plan store cancels active plans and keeps completed/cancelled plans immutable", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan(),
      scopeItems: [buildScopeItem()],
      auditEvents: []
    });

    const cancelled = await store.cancelPlan({
      planId: "perf_plan_1",
      cancelledAt: "2026-07-25T18:00:00.000Z",
      cancelledByActorType: "mobile_user",
      cancelledByActorId: "user_1",
      cancellationReason: null,
      finalResult: buildFinalResult({ finalizedAt: "2026-07-25T18:00:00.000Z", overallSucceeded: false }),
      auditEvent: buildAuditEvent({ id: "audit_cancelled", action: "cancelled" })
    });
    assert.equal(cancelled?.plan.status, "cancelled");
    assert.equal(cancelled?.plan.cancelledByActorId, "user_1");

    const completedAfterCancel = await store.completePlan({
      planId: "perf_plan_1",
      completedAt: "2026-08-21T06:00:00.000Z",
      finalResult: buildFinalResult(),
      auditEvent: buildAuditEvent({ id: "audit_invalid_complete", action: "completed" })
    });
    assert.equal(completedAfterCancel, null);

    const replay = await store.cancelPlan({
      planId: "perf_plan_1",
      cancelledAt: "2026-07-26T18:00:00.000Z",
      cancelledByActorType: "mobile_user",
      cancelledByActorId: "user_1",
      cancellationReason: "changed mind",
      finalResult: buildFinalResult({ overallSucceeded: true }),
      auditEvent: buildAuditEvent({ id: "audit_cancelled_replay", action: "cancelled" })
    });
    assert.equal(replay?.plan.cancellationReason, null);

    await store.createPlan({
      plan: buildPlan({ id: "perf_plan_after_cancel" }),
      scopeItems: [buildScopeItem({ id: "scope_after_cancel", planId: "perf_plan_after_cancel" })],
      auditEvents: []
    });
    assert.equal((await store.getPlanById("perf_plan_after_cancel"))?.plan.status, "active");
  });
});

test("performance plan store refuses opposite terminal transitions", async () => {
  await withTempStore(async (store) => {
    await store.createPlan({
      plan: buildPlan({ id: "perf_completed" }),
      scopeItems: [buildScopeItem({ id: "scope_completed", planId: "perf_completed" })],
      auditEvents: []
    });

    const completed = await store.completePlan({
      planId: "perf_completed",
      completedAt: "2026-08-21T06:00:00.000Z",
      finalResult: buildFinalResult(),
      auditEvent: buildAuditEvent({ id: "audit_completed", planId: "perf_completed", action: "completed" })
    });
    assert(completed);

    const cancelledAfterComplete = await store.cancelPlan({
      planId: "perf_completed",
      cancelledAt: "2026-08-22T06:00:00.000Z",
      cancelledByActorType: "mobile_user",
      cancelledByActorId: "user_1",
      cancellationReason: "late cancel",
      finalResult: buildFinalResult({ overallSucceeded: false }),
      auditEvent: buildAuditEvent({ id: "audit_cancel_after_complete", planId: "perf_completed", action: "cancelled" })
    });
    assert.equal(cancelledAfterComplete, null);
    assertTerminalPlanFieldsUnchanged((await store.getPlanById("perf_completed"))!.plan, completed.plan);

    await store.createPlan({
      plan: buildPlan({ id: "perf_cancelled", startDate: "2026-08-22", endDate: "2026-09-22" }),
      scopeItems: [buildScopeItem({ id: "scope_cancelled", planId: "perf_cancelled" })],
      auditEvents: []
    });

    const cancelled = await store.cancelPlan({
      planId: "perf_cancelled",
      cancelledAt: "2026-08-25T06:00:00.000Z",
      cancelledByActorType: "mobile_user",
      cancelledByActorId: "user_1",
      cancellationReason: "initial cancel",
      finalResult: buildFinalResult({ finalizedAt: "2026-08-25T06:00:00.000Z", overallSucceeded: false }),
      auditEvent: buildAuditEvent({ id: "audit_cancelled", planId: "perf_cancelled", action: "cancelled" })
    });
    assert(cancelled);

    const completedAfterCancel = await store.completePlan({
      planId: "perf_cancelled",
      completedAt: "2026-09-23T06:00:00.000Z",
      finalResult: buildFinalResult({ finalizedAt: "2026-09-23T06:00:00.000Z", overallSucceeded: true }),
      auditEvent: buildAuditEvent({ id: "audit_complete_after_cancel", planId: "perf_cancelled", action: "completed" })
    });
    assert.equal(completedAfterCancel, null);
    assertTerminalPlanFieldsUnchanged((await store.getPlanById("perf_cancelled"))!.plan, cancelled.plan);
  });
});

test("performance plan store completion replay cannot change immutable plan snapshots", async () => {
  await withTempStore(async (store) => {
    const frozenScope = {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_completion"],
      selectedScenarioIds: ["scenario_completion"],
      scenarios: [
        {
          scenarioId: "scenario_completion",
          displayName: "Completion Snapshot Scenario",
          source: "custom" as const,
          segmentId: "manager",
          segmentLabel: "Manager",
          focusTopics: [{ id: "focus_completion", name: "Completion Focus" }],
          selectionSources: ["focus_topic" as const, "direct" as const],
          metadata: { frozen: "completion" }
        }
      ]
    };
    const plan = buildPlan({
      id: "perf_completion_snapshot",
      createdAt: "2026-07-20T16:00:00.000Z",
      submittedAt: "2026-07-20T17:00:00.000Z",
      effectiveAt: "2026-07-21T06:00:00.000Z",
      startDate: "2026-07-21",
      endDate: "2026-08-21",
      activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 9 },
      performanceGoal: {
        enabled: true,
        metricType: "target_average_score",
        targetScore: 87.5,
        improvementAmount: null,
        comparisonMonthCount: null
      },
      baseline: {
        baselineStartAt: "2026-04-21T06:00:00.000Z",
        baselineEndAt: "2026-07-21T06:00:00.000Z",
        baselineAverage: 76.25,
        baselineSessionCount: 5,
        derivedTargetScore: 87.5
      },
      scope: frozenScope
    });
    const firstFinalResult = buildFinalResult({
      finalizedAt: "2026-08-22T06:00:00.000Z",
      windowStartAt: "2026-07-21T06:00:00.000Z",
      windowEndAt: "2026-08-22T06:00:00.000Z",
      finalAverageScore: 88,
      scoreImprovement: 11.75,
      sessionsCompleted: 10,
      scope: frozenScope
    });

    await store.createPlan({
      plan,
      scopeItems: [
        buildScopeItem({
          id: "scope_completion",
          planId: plan.id,
          scenarioId: "scenario_completion",
          scenarioDisplayName: "Completion Snapshot Scenario",
          focusTopicId: "focus_completion",
          focusTopicName: "Completion Focus",
          metadataSnapshot: { frozen: "completion" }
        })
      ],
      auditEvents: []
    });

    const completed = await store.completePlan({
      planId: plan.id,
      completedAt: "2026-08-22T06:00:00.000Z",
      finalResult: firstFinalResult,
      auditEvent: buildAuditEvent({ id: "audit_completion_first", planId: plan.id, action: "completed" })
    });
    assert(completed);

    const replay = await store.completePlan({
      planId: plan.id,
      completedAt: "2026-08-23T06:00:00.000Z",
      finalResult: buildFinalResult({
        finalizedAt: "2026-08-23T06:00:00.000Z",
        overallSucceeded: false,
        finalAverageScore: 50,
        scoreImprovement: -26.25,
        sessionsCompleted: 0,
        totalPracticeSeconds: 0,
        scope: buildPlan({ id: "different_scope" }).scope
      }),
      auditEvent: buildAuditEvent({ id: "audit_completion_replay", planId: plan.id, action: "completed" })
    });
    assert(replay);

    assertTerminalPlanFieldsUnchanged(replay.plan, completed.plan);
    assert.deepEqual(replay.auditEvents.map((event) => event.id), ["audit_completion_first"]);
  });
});

test("performance plan store cancellation replay cannot change immutable plan snapshots", async () => {
  await withTempStore(async (store) => {
    const frozenScope = {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_cancel"],
      selectedScenarioIds: ["scenario_cancel"],
      scenarios: [
        {
          scenarioId: "scenario_cancel",
          displayName: "Cancellation Snapshot Scenario",
          source: "standard" as const,
          segmentId: "manager",
          segmentLabel: "Manager",
          focusTopics: [{ id: "focus_cancel", name: "Cancellation Focus" }],
          selectionSources: ["direct" as const],
          metadata: { frozen: "cancel" }
        }
      ]
    };
    const plan = buildPlan({
      id: "perf_cancellation_snapshot",
      createdAt: "2026-07-25T16:00:00.000Z",
      submittedAt: "2026-07-25T17:00:00.000Z",
      effectiveAt: "2026-07-26T06:00:00.000Z",
      startDate: "2026-07-26",
      endDate: "2026-08-26",
      activityGoal: { enabled: true, metricType: "weekly_practice_minutes", targetValue: 45 },
      performanceGoal: {
        enabled: true,
        metricType: "improve_by_points",
        targetScore: null,
        improvementAmount: 8,
        comparisonMonthCount: 6
      },
      baseline: {
        baselineStartAt: "2026-01-26T06:00:00.000Z",
        baselineEndAt: "2026-07-26T06:00:00.000Z",
        baselineAverage: 71,
        baselineSessionCount: 7,
        derivedTargetScore: 79
      },
      scope: frozenScope
    });
    const firstFinalResult = buildFinalResult({
      finalizedAt: "2026-08-01T06:00:00.000Z",
      windowStartAt: "2026-07-26T06:00:00.000Z",
      windowEndAt: "2026-08-01T06:00:00.000Z",
      overallSucceeded: false,
      performanceSucceeded: false,
      finalAverageScore: 72,
      scoreImprovement: 1,
      sessionsCompleted: 2,
      scope: frozenScope
    });

    await store.createPlan({
      plan,
      scopeItems: [
        buildScopeItem({
          id: "scope_cancel",
          planId: plan.id,
          scenarioId: "scenario_cancel",
          scenarioDisplayName: "Cancellation Snapshot Scenario",
          scenarioSource: "standard",
          focusTopicId: "focus_cancel",
          focusTopicName: "Cancellation Focus",
          selectionSources: ["direct"],
          metadataSnapshot: { frozen: "cancel" }
        })
      ],
      auditEvents: []
    });

    const cancelled = await store.cancelPlan({
      planId: plan.id,
      cancelledAt: "2026-08-01T06:00:00.000Z",
      cancelledByActorType: "mobile_user",
      cancelledByActorId: "user_1",
      cancellationReason: "initial reason",
      finalResult: firstFinalResult,
      auditEvent: buildAuditEvent({ id: "audit_cancel_first", planId: plan.id, action: "cancelled" })
    });
    assert(cancelled);

    const replay = await store.cancelPlan({
      planId: plan.id,
      cancelledAt: "2026-08-02T06:00:00.000Z",
      cancelledByActorType: "mobile_user",
      cancelledByActorId: "different_user",
      cancellationReason: "changed reason",
      finalResult: buildFinalResult({
        finalizedAt: "2026-08-02T06:00:00.000Z",
        overallSucceeded: true,
        performanceSucceeded: true,
        finalAverageScore: 90,
        scoreImprovement: 19,
        sessionsCompleted: 12,
        scope: buildPlan({ id: "different_cancel_scope" }).scope
      }),
      auditEvent: buildAuditEvent({ id: "audit_cancel_replay", planId: plan.id, action: "cancelled" })
    });
    assert(replay);

    assertTerminalPlanFieldsUnchanged(replay.plan, cancelled.plan);
    assert.equal(replay.plan.cancellationReason, "initial reason");
    assert.deepEqual(replay.auditEvents.map((event) => event.id), ["audit_cancel_first"]);
  });
});

test("performance plan postgres terminal updates are guarded to active rows", async () => {
  const activePlan = buildPlan({ id: "perf_pg_guard" });
  const clientQueries: string[] = [];
  const queryPool = {
    async query(text: string) {
      if (text.includes("CREATE TABLE IF NOT EXISTS performance_plans")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("SELECT * FROM performance_plans WHERE definition_signature IS NULL")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("CREATE UNIQUE INDEX IF NOT EXISTS performance_plans_one_active_definition_idx")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("SELECT * FROM performance_plans WHERE id = $1")) {
        return { rows: [buildPostgresPlanRow(activePlan)], rowCount: 1 };
      }
      if (text.includes("FROM performance_plan_scope_items") || text.includes("FROM performance_plan_audit_events")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected pool query: ${text}`);
    },
    async connect() {
      return {
        async query(text: string) {
          clientQueries.push(text);
          if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          if (text.includes("UPDATE performance_plans")) {
            return { rows: [buildPostgresPlanRow(activePlan)], rowCount: 1 };
          }
          if (text.includes("DELETE FROM performance_plan_scope_items")) {
            return { rows: [], rowCount: 1 };
          }
          if (text.includes("INSERT INTO performance_plan_scope_items")) {
            return { rows: [], rowCount: 1 };
          }
          if (text.includes("INSERT INTO performance_plan_audit_events")) {
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected client query: ${text}`);
        },
        release() {}
      };
    }
  };

  const store = createPerformancePlanStore({
    provider: "postgres",
    dbPath: "unused.json",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any
  });

  await store.completePlan({
    planId: activePlan.id,
    completedAt: "2026-08-21T06:00:00.000Z",
    finalResult: buildFinalResult(),
    auditEvent: buildAuditEvent({ id: "audit_pg_complete", planId: activePlan.id, action: "completed" })
  });
  await store.cancelPlan({
    planId: activePlan.id,
    cancelledAt: "2026-08-22T06:00:00.000Z",
    cancelledByActorType: "mobile_user",
    cancelledByActorId: "user_1",
    cancellationReason: "cancel",
    finalResult: buildFinalResult({ finalizedAt: "2026-08-22T06:00:00.000Z", overallSucceeded: false }),
    auditEvent: buildAuditEvent({ id: "audit_pg_cancel", planId: activePlan.id, action: "cancelled" })
  });
  await store.updatePlan({
    plan: buildPlan({ id: activePlan.id, startDate: "2026-07-21", updatedAt: "2026-07-21T16:00:00.000Z" }),
    scopeItems: [buildScopeItem({ planId: activePlan.id })],
    auditEvent: buildAuditEvent({ id: "audit_pg_update", planId: activePlan.id, action: "updated" })
  });

  const updateQueries = clientQueries.filter((query) => query.includes("UPDATE performance_plans"));
  assert.equal(updateQueries.length, 3);
  for (const query of updateQueries) {
    assert.match(query, /WHERE id = \$1 AND status = 'active'/);
  }
});

test("performance plan postgres store initializes the extracted schema and indexes", async () => {
  const queries: string[] = [];
  const queryPool = {
    async query(text: string) {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      throw new Error("connect should not be used during initialize.");
    }
  };

  const store = createPerformancePlanStore({
    provider: "postgres",
    dbPath: "unused.json",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any
  });

  await store.initialize();

  assert(queries.some((query) => query.includes("CREATE TABLE IF NOT EXISTS performance_plans")));
  assert(queries.some((query) => query.includes("DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx")));
  assert(queries.some((query) => query.includes("performance_plans_one_active_definition_idx")));
  assert(queries.some((query) => query.includes("definition_signature")));
  const backfillIndex = queries.findIndex((query) => query.includes("SELECT * FROM performance_plans WHERE definition_signature IS NULL"));
  const newUniqueIndex = queries.findIndex((query) => query.includes("performance_plans_one_active_definition_idx"));
  const oldUniqueDropIndex = queries.findIndex((query) => query.includes("DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx"));
  assert(backfillIndex >= 0);
  assert(newUniqueIndex > backfillIndex);
  assert(oldUniqueDropIndex > newUniqueIndex);
  assert(queries.some((query) => query.includes("CREATE TABLE IF NOT EXISTS performance_plan_scope_items")));
  assert(queries.some((query) => query.includes("CREATE TABLE IF NOT EXISTS performance_plan_audit_events")));
  assert(queries.some((query) => query.includes("idx_usage_sessions_org_user_ended_at")));
  assert(queries.some((query) => query.includes("idx_usage_sessions_org_user_scenario_ended_at")));
  assert(queries.some((query) => query.includes("idx_score_records_org_user_ended_at")));
  assert(queries.some((query) => query.includes("idx_score_records_org_user_scenario_ended_at")));
});

test("performance plan postgres startup backfills signatures before replacing the active-plan index", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const queryPool = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("SELECT * FROM performance_plans WHERE definition_signature IS NULL")) {
        return {
          rows: [{ ...buildPostgresPlanRow(buildPlan({ id: "perf_existing_active" })), definition_signature: null }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      throw new Error("connect should not be used during initialize.");
    }
  };

  const store = createPerformancePlanStore({
    provider: "postgres",
    dbPath: "unused.json",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any
  });

  await store.initialize();

  const backfillUpdateIndex = queries.findIndex((query) =>
    query.text.includes("UPDATE performance_plans SET definition_signature = $2")
  );
  const newUniqueIndex = queries.findIndex((query) =>
    query.text.includes("CREATE UNIQUE INDEX IF NOT EXISTS performance_plans_one_active_definition_idx")
  );
  const oldUniqueDropIndex = queries.findIndex((query) =>
    query.text.includes("DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx")
  );
  assert(backfillUpdateIndex >= 0);
  assert(newUniqueIndex > backfillUpdateIndex);
  assert(oldUniqueDropIndex > newUniqueIndex);
  assert.equal(queries[backfillUpdateIndex].values?.[0], "perf_existing_active");
  assert.match(String(queries[backfillUpdateIndex].values?.[1]), /^[a-f0-9]{64}$/);
});

test("performance plan postgres startup fails closed when an existing row cannot be signed", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const invalidRow = {
    ...buildPostgresPlanRow(buildPlan({ id: "perf_invalid_existing" })),
    definition_signature: null,
    start_date: null
  };
  const queryPool = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("SELECT * FROM performance_plans WHERE definition_signature IS NULL")) {
        return { rows: [invalidRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      throw new Error("connect should not be used during initialize.");
    }
  };

  const store = createPerformancePlanStore({
    provider: "postgres",
    dbPath: "unused.json",
    databaseUrl: "postgres://user:pass@example.com/db",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any
  });

  await assert.rejects(
    () => store.initialize(),
    /Unable to backfill Performance plan definition signature/
  );

  assert(
    !queries.some((query) =>
      query.text.includes("CREATE UNIQUE INDEX IF NOT EXISTS performance_plans_one_active_definition_idx")
    )
  );
  assert(
    !queries.some((query) => query.text.includes("DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx"))
  );
});

test("performance multiple-active SQL migration is retry-safe for existing databases", async () => {
  const sql = await readFile(
    path.resolve(TEST_DIR, "../../sql/004_performance_multiple_active_plans.sql"),
    "utf8"
  );

  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS definition_signature TEXT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS performance_plans_one_active_definition_idx/);
  assert.match(sql, /WHERE status = ''active'' AND definition_signature IS NOT NULL/);
  assert.match(sql, /WHERE status = 'active'\s+AND definition_signature IS NULL/);
  assert.match(sql, /DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx/);
  assert(
    sql.indexOf("definition_signature IS NULL") < sql.indexOf("DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx")
  );
});
