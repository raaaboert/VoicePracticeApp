import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PerformanceAuditEvent,
  PerformanceFinalResult,
  PerformancePlan,
  PerformancePlanScopeItem
} from "@voicepractice/shared";

import { createPerformancePlanStore } from "./performancePlanStore.js";

const NOW = "2026-07-20T16:00:00.000Z";

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

test("performance plan store enforces one active plan per org and user", async () => {
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
      /active Performance plan already exists/
    );

    await store.createPlan({
      plan: buildPlan({ id: "perf_plan_other_user", userId: "user_2" }),
      scopeItems: [buildScopeItem({ id: "scope_other_user", planId: "perf_plan_other_user", userId: "user_2" })],
      auditEvents: []
    });

    const open = await store.getOpenPlanForUser("org_1", "user_1");
    assert.equal(open?.plan.id, "perf_plan_1");
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
      plan: buildPlan({ id: "perf_plan_2", startDate: "2026-08-22", endDate: "2026-09-22" }),
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
  });
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
  assert(queries.some((query) => query.includes("performance_plans_one_active_per_user_idx")));
  assert(queries.some((query) => query.includes("CREATE TABLE IF NOT EXISTS performance_plan_scope_items")));
  assert(queries.some((query) => query.includes("CREATE TABLE IF NOT EXISTS performance_plan_audit_events")));
});
