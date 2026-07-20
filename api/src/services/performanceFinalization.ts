import { PerformanceAuditEvent, PerformancePlan, SimulationScoreRecord, UsageSessionRecord } from "@voicepractice/shared";
import { randomUUID } from "node:crypto";

import {
  PerformancePlanStore,
  PerformancePlanWithRelations
} from "../storage/performancePlanStore.js";
import { buildPlanWindow } from "./performanceDateWindows.js";
import {
  buildPerformanceFinalResult,
  calculatePerformanceProgress
} from "./performanceProgress.js";

export async function finalizePerformancePlanIfEnded(params: {
  store: PerformancePlanStore;
  plan: PerformancePlan;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
  actorId?: string | null;
}): Promise<PerformancePlanWithRelations | null> {
  if (params.plan.status !== "active") {
    return await params.store.getPlanById(params.plan.id);
  }

  const window = buildPlanWindow({
    startDate: params.plan.startDate,
    endDate: params.plan.endDate,
    timeZone: params.plan.timeZone,
    effectiveAt: params.plan.effectiveAt
  });
  const planEnd = new Date(window.planEndAt);
  if (params.now.getTime() < planEnd.getTime()) {
    return await params.store.getPlanById(params.plan.id);
  }

  const progress = calculatePerformanceProgress({
    plan: params.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now,
    capAt: window.planEndAt
  });
  const finalResult = buildPerformanceFinalResult({
    plan: params.plan,
    progress,
    finalizedAt: params.now.toISOString()
  });
  return await params.store.completePlan({
    planId: params.plan.id,
    completedAt: params.now.toISOString(),
    finalResult,
    auditEvent: buildPerformanceFinalizationAuditEvent({
      plan: params.plan,
      action: "completed",
      actorId: params.actorId ?? null,
      createdAt: params.now.toISOString(),
      finalResult
    })
  });
}

export async function cancelPerformancePlan(params: {
  store: PerformancePlanStore;
  plan: PerformancePlan;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  cancelledAt: Date;
  actorId: string | null;
  reason?: string | null;
}): Promise<PerformancePlanWithRelations | null> {
  if (params.plan.status !== "active") {
    return await params.store.getPlanById(params.plan.id);
  }

  const progress = calculatePerformanceProgress({
    plan: params.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.cancelledAt,
    capAt: params.cancelledAt.toISOString()
  });
  const finalResult = buildPerformanceFinalResult({
    plan: params.plan,
    progress,
    finalizedAt: params.cancelledAt.toISOString()
  });

  return await params.store.cancelPlan({
    planId: params.plan.id,
    cancelledAt: params.cancelledAt.toISOString(),
    cancelledByActorType: "mobile_user",
    cancelledByActorId: params.actorId,
    cancellationReason: params.reason ?? null,
    finalResult,
    auditEvent: buildPerformanceFinalizationAuditEvent({
      plan: params.plan,
      action: "cancelled",
      actorId: params.actorId,
      createdAt: params.cancelledAt.toISOString(),
      finalResult,
      reason: params.reason ?? null
    })
  });
}

export async function finalizeOpenPerformancePlanForUserIfNeeded(params: {
  store: PerformancePlanStore;
  orgId: string;
  userId: string;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
}): Promise<PerformancePlanWithRelations | null> {
  const open = await params.store.getOpenPlanForUser(params.orgId, params.userId);
  if (!open) {
    return null;
  }
  return await finalizePerformancePlanIfEnded({
    store: params.store,
    plan: open.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  });
}

function buildPerformanceFinalizationAuditEvent(params: {
  plan: PerformancePlan;
  action: "completed" | "cancelled";
  actorId: string | null;
  createdAt: string;
  finalResult: unknown;
  reason?: string | null;
}): PerformanceAuditEvent {
  return {
    id: `perf_audit_${randomUUID()}`,
    planId: params.plan.id,
    orgId: params.plan.orgId,
    userId: params.plan.userId,
    actorType: params.action === "completed" ? "system" : "mobile_user",
    actorId: params.actorId,
    action: params.action,
    changedFields: ["status", "finalResult"],
    oldValues: {
      status: params.plan.status,
      finalResult: params.plan.finalResult
    },
    newValues: {
      status: params.action === "completed" ? "completed" : "cancelled",
      finalResult: params.finalResult
    },
    reason: params.reason ?? null,
    createdAt: params.createdAt
  };
}
