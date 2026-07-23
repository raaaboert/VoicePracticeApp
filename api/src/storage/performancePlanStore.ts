import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { Pool, PoolClient } from "pg";

import {
  AUDIT_ACTOR_TYPES,
  AuditActorType,
  PERFORMANCE_ACTIVITY_METRIC_TYPES,
  PERFORMANCE_GOAL_METRIC_TYPES,
  PERFORMANCE_PLAN_STATUSES,
  PERFORMANCE_SCENARIO_SOURCES,
  PERFORMANCE_SCOPE_SELECTION_SOURCES,
  PerformanceActivityGoal,
  PerformanceActivityMetricType,
  PerformanceAuditEvent,
  PerformanceBaseline,
  PerformanceFinalResult,
  PerformanceGoal,
  PerformanceGoalMetricType,
  PerformancePlan,
  PerformancePlanScope,
  PerformancePlanScopeItem,
  PerformancePlanStatus,
  PerformanceScenarioSource,
  PerformanceScopeSelectionSource
} from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

export interface PerformancePlanWithRelations {
  plan: PerformancePlan;
  scopeItems: PerformancePlanScopeItem[];
  auditEvents: PerformanceAuditEvent[];
}

export interface PerformancePlanCreateInput {
  plan: PerformancePlan;
  scopeItems: PerformancePlanScopeItem[];
  auditEvents?: PerformanceAuditEvent[];
}

export interface PerformancePlanUpdateInput {
  plan: PerformancePlan;
  scopeItems: PerformancePlanScopeItem[];
  auditEvent: PerformanceAuditEvent;
}

export interface PerformancePlanCompleteInput {
  planId: string;
  completedAt: string;
  finalResult: PerformanceFinalResult;
  auditEvent: PerformanceAuditEvent;
}

export interface PerformancePlanCancelInput {
  planId: string;
  cancelledAt: string;
  cancelledByActorType: AuditActorType;
  cancelledByActorId: string | null;
  cancellationReason: string | null;
  finalResult: PerformanceFinalResult;
  auditEvent: PerformanceAuditEvent;
}

export interface PerformancePlanUpdateRecord {
  id: string;
  planId: string;
  orgId: string;
  userId: string;
  authorActorType: AuditActorType;
  authorActorId: string | null;
  body: string;
  createdAt: string;
}

export interface PerformancePlanAppendUpdateInput {
  update: PerformancePlanUpdateRecord;
}

export interface PerformancePlanStore {
  initialize(): Promise<void>;
  createPlan(input: PerformancePlanCreateInput): Promise<PerformancePlanWithRelations>;
  updatePlan(input: PerformancePlanUpdateInput): Promise<PerformancePlanWithRelations | null>;
  getPlanById(planId: string): Promise<PerformancePlanWithRelations | null>;
  getOpenPlanForUser(orgId: string, userId: string): Promise<PerformancePlanWithRelations | null>;
  listPlansForUser(orgId: string, userId: string): Promise<PerformancePlanWithRelations[]>;
  completePlan(input: PerformancePlanCompleteInput): Promise<PerformancePlanWithRelations | null>;
  cancelPlan(input: PerformancePlanCancelInput): Promise<PerformancePlanWithRelations | null>;
  appendAuditEvent(event: PerformanceAuditEvent): Promise<void>;
  listAuditEvents(planId: string): Promise<PerformanceAuditEvent[]>;
  appendPlanUpdate(input: PerformancePlanAppendUpdateInput): Promise<PerformancePlanUpdateRecord>;
  listPlanUpdates(planId: string, limit?: number): Promise<PerformancePlanUpdateRecord[]>;
}

interface CreatePerformancePlanStoreParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: PerformancePlanQueryPool;
}

type PerformancePlanQueryPool = Pick<Pool, "query" | "connect">;

interface PerformancePlanFilePayload {
  plans: PerformancePlan[];
  scopeItems: PerformancePlanScopeItem[];
  auditEvents: PerformanceAuditEvent[];
  updates: PerformancePlanUpdateRecord[];
}

interface PerformancePlanRow {
  id: string;
  org_id: string;
  user_id: string;
  created_by_actor_type: string;
  created_by_actor_id: string | null;
  created_at: string | Date;
  submitted_at: string | Date;
  effective_at: string | Date;
  start_date: string | Date;
  end_date: string | Date;
  time_zone: string;
  status: string;
  completed_at: string | Date | null;
  cancelled_at: string | Date | null;
  cancelled_by_actor_type: string | null;
  cancelled_by_actor_id: string | null;
  cancellation_reason: string | null;
  activity_goal_enabled: boolean;
  activity_metric_type: string | null;
  activity_target_value: number | string | null;
  performance_goal_enabled: boolean;
  performance_metric_type: string | null;
  target_score: number | string | null;
  improvement_amount: number | string | null;
  comparison_month_count: number | string | null;
  baseline_start_at: string | Date | null;
  baseline_end_at: string | Date | null;
  baseline_average: number | string | null;
  baseline_session_count: number | string | null;
  derived_target_score: number | string | null;
  all_assigned_scenarios: boolean;
  selected_focus_topic_ids: unknown;
  selected_scenario_ids: unknown;
  scope_snapshot: unknown;
  baseline_snapshot: unknown;
  final_result_snapshot: unknown;
  definition_signature: string | null;
  updated_at: string | Date;
}

interface PerformancePlanScopeItemRow {
  id: string;
  plan_id: string;
  org_id: string;
  user_id: string;
  scenario_id: string;
  scenario_display_name: string;
  scenario_source: string;
  segment_id: string | null;
  segment_label: string | null;
  focus_topic_id: string | null;
  focus_topic_name: string | null;
  selection_sources: unknown;
  metadata_snapshot: unknown;
  created_at: string | Date;
}

interface PerformancePlanAuditEventRow {
  id: string;
  plan_id: string;
  org_id: string;
  user_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  changed_fields: unknown;
  old_values: unknown;
  new_values: unknown;
  reason: string | null;
  created_at: string | Date;
}

interface PerformancePlanUpdateRow {
  id: string;
  plan_id: string;
  org_id: string;
  user_id: string;
  author_actor_type: string;
  author_actor_id: string | null;
  body: string;
  created_at: string | Date;
}

const ACTOR_TYPE_SET = new Set<AuditActorType>(AUDIT_ACTOR_TYPES);
const PLAN_STATUS_SET = new Set<PerformancePlanStatus>(PERFORMANCE_PLAN_STATUSES);
const ACTIVITY_METRIC_SET = new Set<PerformanceActivityMetricType>(PERFORMANCE_ACTIVITY_METRIC_TYPES);
const PERFORMANCE_METRIC_SET = new Set<PerformanceGoalMetricType>(PERFORMANCE_GOAL_METRIC_TYPES);
const SCENARIO_SOURCE_SET = new Set<PerformanceScenarioSource>(PERFORMANCE_SCENARIO_SOURCES);
const SCOPE_SELECTION_SOURCE_SET = new Set<PerformanceScopeSelectionSource>(PERFORMANCE_SCOPE_SELECTION_SOURCES);
const DUPLICATE_ACTIVE_PLAN_MESSAGE = "An identical active Performance plan already exists for this user.";

function buildPerformancePlanFilePath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.performance-plans${extension}`);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildPerformancePlanDefinitionSignature(plan: PerformancePlan): string {
  const definition = {
    orgId: plan.orgId,
    userId: plan.userId,
    startDate: plan.startDate,
    endDate: plan.endDate,
    timeZone: plan.timeZone,
    activityGoal: {
      enabled: plan.activityGoal.enabled === true,
      metricType: plan.activityGoal.metricType ?? null,
      targetValue: normalizeSignatureNumber(plan.activityGoal.targetValue)
    },
    performanceGoal: {
      enabled: plan.performanceGoal.enabled === true,
      metricType: plan.performanceGoal.metricType ?? null,
      targetScore: normalizeSignatureNumber(plan.performanceGoal.targetScore),
      improvementAmount: normalizeSignatureNumber(plan.performanceGoal.improvementAmount),
      comparisonMonthCount: normalizeSignatureNumber(plan.performanceGoal.comparisonMonthCount)
    },
    scope: {
      allAssignedScenarios: plan.scope.allAssignedScenarios === true,
      selectedFocusTopicIds: [...plan.scope.selectedFocusTopicIds].sort(),
      selectedScenarioIds: [...plan.scope.selectedScenarioIds].sort(),
      scenarioIds: plan.scope.scenarios.map((scenario) => scenario.scenarioId).sort()
    }
  };
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

function normalizeSignatureNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(6));
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeString(value: unknown): string | null {
  return normalizeNullableString(value);
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

function normalizeDateKey(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeInteger(value: unknown): number | null {
  const parsed = normalizeNumber(value);
  return parsed === null ? null : Math.floor(parsed);
}

function normalizeActorType(value: unknown): AuditActorType | null {
  const normalized = normalizeNullableString(value);
  return normalized && ACTOR_TYPE_SET.has(normalized as AuditActorType) ? (normalized as AuditActorType) : null;
}

function normalizePlanStatus(value: unknown): PerformancePlanStatus | null {
  const normalized = normalizeNullableString(value);
  return normalized && PLAN_STATUS_SET.has(normalized as PerformancePlanStatus)
    ? (normalized as PerformancePlanStatus)
    : null;
}

function normalizeActivityMetricType(value: unknown): PerformanceActivityMetricType | null {
  const normalized = normalizeNullableString(value);
  return normalized && ACTIVITY_METRIC_SET.has(normalized as PerformanceActivityMetricType)
    ? (normalized as PerformanceActivityMetricType)
    : null;
}

function normalizePerformanceMetricType(value: unknown): PerformanceGoalMetricType | null {
  const normalized = normalizeNullableString(value);
  return normalized && PERFORMANCE_METRIC_SET.has(normalized as PerformanceGoalMetricType)
    ? (normalized as PerformanceGoalMetricType)
    : null;
}

function normalizeScenarioSource(value: unknown): PerformanceScenarioSource {
  const normalized = normalizeNullableString(value);
  return normalized && SCENARIO_SOURCE_SET.has(normalized as PerformanceScenarioSource)
    ? (normalized as PerformanceScenarioSource)
    : "unknown";
}

function normalizeSelectionSource(value: unknown): PerformanceScopeSelectionSource | null {
  const normalized = normalizeNullableString(value);
  return normalized && SCOPE_SELECTION_SOURCE_SET.has(normalized as PerformanceScopeSelectionSource)
    ? (normalized as PerformanceScopeSelectionSource)
    : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeNullableString(entry))
        .filter((entry): entry is string => Boolean(entry))
    )
  );
}

function normalizeSelectionSources(value: unknown): PerformanceScopeSelectionSource[] {
  const normalized = Array.isArray(value)
    ? value.map((entry) => normalizeSelectionSource(entry)).filter((entry): entry is PerformanceScopeSelectionSource => Boolean(entry))
    : [];
  return Array.from(new Set(normalized));
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? cloneJson(value as Record<string, unknown>) : {};
}

function normalizeActivityGoal(value: unknown): PerformanceActivityGoal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return {
    enabled: (value as { enabled?: unknown }).enabled === true,
    metricType: normalizeActivityMetricType((value as { metricType?: unknown }).metricType),
    targetValue: normalizeNumber((value as { targetValue?: unknown }).targetValue)
  };
}

function normalizePerformanceGoal(value: unknown): PerformanceGoal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const comparisonMonthCount = normalizeInteger((value as { comparisonMonthCount?: unknown }).comparisonMonthCount);
  return {
    enabled: (value as { enabled?: unknown }).enabled === true,
    metricType: normalizePerformanceMetricType((value as { metricType?: unknown }).metricType),
    targetScore: normalizeNumber((value as { targetScore?: unknown }).targetScore),
    improvementAmount: normalizeNumber((value as { improvementAmount?: unknown }).improvementAmount),
    comparisonMonthCount:
      comparisonMonthCount === 1 || comparisonMonthCount === 2 || comparisonMonthCount === 3 || comparisonMonthCount === 6
        ? comparisonMonthCount
        : null
  };
}

function normalizeBaseline(value: unknown): PerformanceBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const baselineStartAt = normalizeIsoString((value as { baselineStartAt?: unknown }).baselineStartAt);
  const baselineEndAt = normalizeIsoString((value as { baselineEndAt?: unknown }).baselineEndAt);
  const baselineAverage = normalizeNumber((value as { baselineAverage?: unknown }).baselineAverage);
  const baselineSessionCount = normalizeInteger((value as { baselineSessionCount?: unknown }).baselineSessionCount);
  const derivedTargetScore = normalizeNumber((value as { derivedTargetScore?: unknown }).derivedTargetScore);
  if (!baselineStartAt || !baselineEndAt || baselineAverage === null || baselineSessionCount === null || derivedTargetScore === null) {
    return null;
  }
  return { baselineStartAt, baselineEndAt, baselineAverage, baselineSessionCount, derivedTargetScore };
}

function normalizePlanScope(value: unknown): PerformancePlanScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rawScenarios = (value as { scenarios?: unknown }).scenarios;
  if (!Array.isArray(rawScenarios)) {
    return null;
  }
  const scenarios = rawScenarios
    .map((entry): PerformancePlanScope["scenarios"][number] | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const scenarioId = normalizeString((entry as { scenarioId?: unknown }).scenarioId);
      const displayName = normalizeString((entry as { displayName?: unknown }).displayName);
      if (!scenarioId || !displayName) {
        return null;
      }
      const focusTopics = Array.isArray((entry as { focusTopics?: unknown }).focusTopics)
        ? ((entry as { focusTopics: unknown[] }).focusTopics)
            .map((topic) => {
              if (!topic || typeof topic !== "object" || Array.isArray(topic)) {
                return null;
              }
              const id = normalizeString((topic as { id?: unknown }).id);
              const name = normalizeString((topic as { name?: unknown }).name);
              return id && name ? { id, name } : null;
            })
            .filter((topic): topic is { id: string; name: string } => Boolean(topic))
        : [];
      return {
        scenarioId,
        displayName,
        source: normalizeScenarioSource((entry as { source?: unknown }).source),
        segmentId: normalizeNullableString((entry as { segmentId?: unknown }).segmentId),
        segmentLabel: normalizeNullableString((entry as { segmentLabel?: unknown }).segmentLabel),
        focusTopics,
        selectionSources: normalizeSelectionSources((entry as { selectionSources?: unknown }).selectionSources),
        metadata: normalizeJsonRecord((entry as { metadata?: unknown }).metadata)
      };
    })
    .filter((entry): entry is PerformancePlanScope["scenarios"][number] => entry !== null);
  return {
    allAssignedScenarios: (value as { allAssignedScenarios?: unknown }).allAssignedScenarios === true,
    selectedFocusTopicIds: normalizeStringArray((value as { selectedFocusTopicIds?: unknown }).selectedFocusTopicIds),
    selectedScenarioIds: normalizeStringArray((value as { selectedScenarioIds?: unknown }).selectedScenarioIds),
    scenarios
  };
}

function normalizeFinalResult(value: unknown): PerformanceFinalResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const finalizedAt = normalizeIsoString((value as { finalizedAt?: unknown }).finalizedAt);
  const windowStartAt = normalizeIsoString((value as { windowStartAt?: unknown }).windowStartAt);
  const windowEndAt = normalizeIsoString((value as { windowEndAt?: unknown }).windowEndAt);
  const totalPracticeSeconds = normalizeNumber((value as { totalPracticeSeconds?: unknown }).totalPracticeSeconds);
  const sessionsCompleted = normalizeInteger((value as { sessionsCompleted?: unknown }).sessionsCompleted);
  const scope = normalizePlanScope((value as { scope?: unknown }).scope);
  if (!finalizedAt || !windowStartAt || !windowEndAt || totalPracticeSeconds === null || sessionsCompleted === null || !scope) {
    return null;
  }
  const weeklyConsistencyValue = (value as { weeklyConsistency?: unknown }).weeklyConsistency;
  const weeklyConsistency =
    weeklyConsistencyValue && typeof weeklyConsistencyValue === "object" && !Array.isArray(weeklyConsistencyValue)
      ? {
          completedWeeks: normalizeInteger((weeklyConsistencyValue as { completedWeeks?: unknown }).completedWeeks) ?? 0,
          totalWeeks: normalizeInteger((weeklyConsistencyValue as { totalWeeks?: unknown }).totalWeeks) ?? 0
        }
      : null;
  return {
    finalizedAt,
    windowStartAt,
    windowEndAt,
    activitySucceeded: (value as { activitySucceeded?: unknown }).activitySucceeded === true,
    performanceSucceeded: (value as { performanceSucceeded?: unknown }).performanceSucceeded === true,
    overallSucceeded: (value as { overallSucceeded?: unknown }).overallSucceeded === true,
    performanceInsufficientEvidence: (value as { performanceInsufficientEvidence?: unknown }).performanceInsufficientEvidence === true,
    finalAverageScore: normalizeNumber((value as { finalAverageScore?: unknown }).finalAverageScore),
    scoreImprovement: normalizeNumber((value as { scoreImprovement?: unknown }).scoreImprovement),
    totalPracticeSeconds,
    sessionsCompleted,
    weeklyConsistency,
    scope
  };
}

function normalizePlan(candidate: unknown): PerformancePlan | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const id = normalizeString((candidate as { id?: unknown }).id);
  const orgId = normalizeString((candidate as { orgId?: unknown }).orgId);
  const userId = normalizeString((candidate as { userId?: unknown }).userId);
  const createdByActorType = normalizeActorType((candidate as { createdByActorType?: unknown }).createdByActorType);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);
  const submittedAt = normalizeIsoString((candidate as { submittedAt?: unknown }).submittedAt);
  const effectiveAt = normalizeIsoString((candidate as { effectiveAt?: unknown }).effectiveAt);
  const startDate = normalizeDateKey((candidate as { startDate?: unknown }).startDate);
  const endDate = normalizeDateKey((candidate as { endDate?: unknown }).endDate);
  const timeZone = normalizeString((candidate as { timeZone?: unknown }).timeZone);
  const status = normalizePlanStatus((candidate as { status?: unknown }).status);
  const activityGoal = normalizeActivityGoal((candidate as { activityGoal?: unknown }).activityGoal);
  const performanceGoal = normalizePerformanceGoal((candidate as { performanceGoal?: unknown }).performanceGoal);
  const scope = normalizePlanScope((candidate as { scope?: unknown }).scope);
  const updatedAt = normalizeIsoString((candidate as { updatedAt?: unknown }).updatedAt);
  if (
    !id ||
    !orgId ||
    !userId ||
    !createdByActorType ||
    !createdAt ||
    !submittedAt ||
    !effectiveAt ||
    !startDate ||
    !endDate ||
    !timeZone ||
    !status ||
    !activityGoal ||
    !performanceGoal ||
    !scope ||
    !updatedAt
  ) {
    return null;
  }
  return {
    id,
    orgId,
    userId,
    createdByActorType,
    createdByActorId: normalizeNullableString((candidate as { createdByActorId?: unknown }).createdByActorId),
    createdAt,
    submittedAt,
    effectiveAt,
    startDate,
    endDate,
    timeZone,
    status,
    completedAt: normalizeIsoString((candidate as { completedAt?: unknown }).completedAt),
    cancelledAt: normalizeIsoString((candidate as { cancelledAt?: unknown }).cancelledAt),
    cancelledByActorType: normalizeActorType((candidate as { cancelledByActorType?: unknown }).cancelledByActorType),
    cancelledByActorId: normalizeNullableString((candidate as { cancelledByActorId?: unknown }).cancelledByActorId),
    cancellationReason: normalizeNullableString((candidate as { cancellationReason?: unknown }).cancellationReason),
    activityGoal,
    performanceGoal,
    scope,
    baseline: normalizeBaseline((candidate as { baseline?: unknown }).baseline),
    finalResult: normalizeFinalResult((candidate as { finalResult?: unknown }).finalResult),
    updatedAt
  };
}

function normalizeScopeItem(candidate: unknown): PerformancePlanScopeItem | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const id = normalizeString((candidate as { id?: unknown }).id);
  const planId = normalizeString((candidate as { planId?: unknown }).planId);
  const orgId = normalizeString((candidate as { orgId?: unknown }).orgId);
  const userId = normalizeString((candidate as { userId?: unknown }).userId);
  const scenarioId = normalizeString((candidate as { scenarioId?: unknown }).scenarioId);
  const scenarioDisplayName = normalizeString((candidate as { scenarioDisplayName?: unknown }).scenarioDisplayName);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);
  if (!id || !planId || !orgId || !userId || !scenarioId || !scenarioDisplayName || !createdAt) {
    return null;
  }
  return {
    id,
    planId,
    orgId,
    userId,
    scenarioId,
    scenarioDisplayName,
    scenarioSource: normalizeScenarioSource((candidate as { scenarioSource?: unknown }).scenarioSource),
    segmentId: normalizeNullableString((candidate as { segmentId?: unknown }).segmentId),
    segmentLabel: normalizeNullableString((candidate as { segmentLabel?: unknown }).segmentLabel),
    focusTopicId: normalizeNullableString((candidate as { focusTopicId?: unknown }).focusTopicId),
    focusTopicName: normalizeNullableString((candidate as { focusTopicName?: unknown }).focusTopicName),
    selectionSources: normalizeSelectionSources((candidate as { selectionSources?: unknown }).selectionSources),
    metadataSnapshot: normalizeJsonRecord((candidate as { metadataSnapshot?: unknown }).metadataSnapshot),
    createdAt
  };
}

function normalizeAuditEvent(candidate: unknown): PerformanceAuditEvent | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const id = normalizeString((candidate as { id?: unknown }).id);
  const planId = normalizeString((candidate as { planId?: unknown }).planId);
  const orgId = normalizeString((candidate as { orgId?: unknown }).orgId);
  const userId = normalizeString((candidate as { userId?: unknown }).userId);
  const actorType = normalizeActorType((candidate as { actorType?: unknown }).actorType);
  const action = normalizeString((candidate as { action?: unknown }).action);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);
  if (!id || !planId || !orgId || !userId || !actorType || !action || !createdAt) {
    return null;
  }
  return {
    id,
    planId,
    orgId,
    userId,
    actorType,
    actorId: normalizeNullableString((candidate as { actorId?: unknown }).actorId),
    action,
    changedFields: normalizeStringArray((candidate as { changedFields?: unknown }).changedFields),
    oldValues: (candidate as { oldValues?: unknown }).oldValues === null
      ? null
      : normalizeJsonRecord((candidate as { oldValues?: unknown }).oldValues),
    newValues: (candidate as { newValues?: unknown }).newValues === null
      ? null
      : normalizeJsonRecord((candidate as { newValues?: unknown }).newValues),
    reason: normalizeNullableString((candidate as { reason?: unknown }).reason),
    createdAt
  };
}

function normalizePlanUpdateRecord(candidate: unknown): PerformancePlanUpdateRecord | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const id = normalizeString((candidate as { id?: unknown }).id);
  const planId = normalizeString((candidate as { planId?: unknown }).planId);
  const orgId = normalizeString((candidate as { orgId?: unknown }).orgId);
  const userId = normalizeString((candidate as { userId?: unknown }).userId);
  const authorActorType = normalizeActorType((candidate as { authorActorType?: unknown }).authorActorType);
  const body = normalizeString((candidate as { body?: unknown }).body);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);
  if (!id || !planId || !orgId || !userId || !authorActorType || !body || !createdAt) {
    return null;
  }
  return {
    id,
    planId,
    orgId,
    userId,
    authorActorType,
    authorActorId: normalizeNullableString((candidate as { authorActorId?: unknown }).authorActorId),
    body,
    createdAt
  };
}

function normalizePayload(candidate: unknown): PerformancePlanFilePayload {
  const plans = Array.isArray((candidate as { plans?: unknown } | null)?.plans)
    ? ((candidate as { plans: unknown[] }).plans).map(normalizePlan).filter((entry): entry is PerformancePlan => Boolean(entry))
    : [];
  const scopeItems = Array.isArray((candidate as { scopeItems?: unknown } | null)?.scopeItems)
    ? ((candidate as { scopeItems: unknown[] }).scopeItems)
        .map(normalizeScopeItem)
        .filter((entry): entry is PerformancePlanScopeItem => Boolean(entry))
    : [];
  const auditEvents = Array.isArray((candidate as { auditEvents?: unknown } | null)?.auditEvents)
    ? ((candidate as { auditEvents: unknown[] }).auditEvents)
        .map(normalizeAuditEvent)
        .filter((entry): entry is PerformanceAuditEvent => Boolean(entry))
    : [];
  const updates = Array.isArray((candidate as { updates?: unknown } | null)?.updates)
    ? ((candidate as { updates: unknown[] }).updates)
        .map(normalizePlanUpdateRecord)
        .filter((entry): entry is PerformancePlanUpdateRecord => Boolean(entry))
    : [];

  return {
    plans: sortPlans(plans),
    scopeItems: sortScopeItems(scopeItems),
    auditEvents: sortAuditEvents(auditEvents),
    updates: sortPlanUpdates(updates)
  };
}

function sortPlans(plans: PerformancePlan[]): PerformancePlan[] {
  return plans.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

function sortScopeItems(scopeItems: PerformancePlanScopeItem[]): PerformancePlanScopeItem[] {
  return scopeItems
    .slice()
    .sort((left, right) => left.planId.localeCompare(right.planId) || left.scenarioId.localeCompare(right.scenarioId));
}

function sortAuditEvents(events: PerformanceAuditEvent[]): PerformanceAuditEvent[] {
  return events.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function sortPlanUpdates(updates: PerformancePlanUpdateRecord[]): PerformancePlanUpdateRecord[] {
  return updates.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function assertPlanUpdateInput(input: PerformancePlanAppendUpdateInput): PerformancePlanUpdateRecord {
  const update = normalizePlanUpdateRecord(input.update);
  if (!update) {
    throw new Error("Performance plan update is invalid.");
  }
  return update;
}

function assertCreateInput(input: PerformancePlanCreateInput): PerformancePlanCreateInput {
  const plan = normalizePlan(input.plan);
  if (!plan) {
    throw new Error("Performance plan is invalid.");
  }
  if (plan.status !== "active") {
    throw new Error("New Performance plans must be active.");
  }
  const scopeItems = input.scopeItems.map(normalizeScopeItem).filter((entry): entry is PerformancePlanScopeItem => Boolean(entry));
  if (scopeItems.length !== input.scopeItems.length) {
    throw new Error("Performance plan scope items are invalid.");
  }
  for (const scopeItem of scopeItems) {
    if (scopeItem.planId !== plan.id || scopeItem.orgId !== plan.orgId || scopeItem.userId !== plan.userId) {
      throw new Error("Performance plan scope item does not match the plan identity.");
    }
  }
  const auditEvents = (input.auditEvents ?? [])
    .map(normalizeAuditEvent)
    .filter((entry): entry is PerformanceAuditEvent => Boolean(entry));
  if (auditEvents.length !== (input.auditEvents ?? []).length) {
    throw new Error("Performance plan audit events are invalid.");
  }
  for (const auditEvent of auditEvents) {
    if (auditEvent.planId !== plan.id || auditEvent.orgId !== plan.orgId || auditEvent.userId !== plan.userId) {
      throw new Error("Performance plan audit event does not match the plan identity.");
    }
  }
  return { plan, scopeItems, auditEvents };
}

function assertUpdateInput(input: PerformancePlanUpdateInput): PerformancePlanUpdateInput {
  const plan = normalizePlan(input.plan);
  if (!plan) {
    throw new Error("Performance plan is invalid.");
  }
  if (plan.status !== "active") {
    throw new Error("Only active Performance plans can be updated.");
  }
  const scopeItems = input.scopeItems.map(normalizeScopeItem).filter((entry): entry is PerformancePlanScopeItem => Boolean(entry));
  if (scopeItems.length !== input.scopeItems.length) {
    throw new Error("Performance plan scope items are invalid.");
  }
  for (const scopeItem of scopeItems) {
    if (scopeItem.planId !== plan.id || scopeItem.orgId !== plan.orgId || scopeItem.userId !== plan.userId) {
      throw new Error("Performance plan scope item does not match the plan identity.");
    }
  }
  const auditEvent = normalizeAuditEvent(input.auditEvent);
  if (!auditEvent) {
    throw new Error("Performance plan audit event is invalid.");
  }
  if (auditEvent.planId !== plan.id || auditEvent.orgId !== plan.orgId || auditEvent.userId !== plan.userId) {
    throw new Error("Performance plan audit event does not match the plan identity.");
  }
  return { plan, scopeItems, auditEvent };
}

function relationFor(payload: PerformancePlanFilePayload, plan: PerformancePlan): PerformancePlanWithRelations {
  return {
    plan,
    scopeItems: sortScopeItems(payload.scopeItems.filter((entry) => entry.planId === plan.id)),
    auditEvents: sortAuditEvents(payload.auditEvents.filter((entry) => entry.planId === plan.id))
  };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

abstract class BasePerformancePlanStore implements PerformancePlanStore {
  abstract initialize(): Promise<void>;
  abstract createPlan(input: PerformancePlanCreateInput): Promise<PerformancePlanWithRelations>;
  abstract updatePlan(input: PerformancePlanUpdateInput): Promise<PerformancePlanWithRelations | null>;
  abstract getPlanById(planId: string): Promise<PerformancePlanWithRelations | null>;
  abstract getOpenPlanForUser(orgId: string, userId: string): Promise<PerformancePlanWithRelations | null>;
  abstract listPlansForUser(orgId: string, userId: string): Promise<PerformancePlanWithRelations[]>;
  abstract completePlan(input: PerformancePlanCompleteInput): Promise<PerformancePlanWithRelations | null>;
  abstract cancelPlan(input: PerformancePlanCancelInput): Promise<PerformancePlanWithRelations | null>;
  abstract appendAuditEvent(event: PerformanceAuditEvent): Promise<void>;
  abstract listAuditEvents(planId: string): Promise<PerformanceAuditEvent[]>;
  abstract appendPlanUpdate(input: PerformancePlanAppendUpdateInput): Promise<PerformancePlanUpdateRecord>;
  abstract listPlanUpdates(planId: string, limit?: number): Promise<PerformancePlanUpdateRecord[]>;
}

class FilePerformancePlanStore extends BasePerformancePlanStore {
  private readonly filePath: string;
  private operationQueue = Promise.resolve();

  constructor(dbPath: string) {
    super();
    this.filePath = buildPerformancePlanFilePath(dbPath);
  }

  async initialize(): Promise<void> {
    await this.withLock(async () => {
      await this.loadPayload();
    });
  }

  async createPlan(input: PerformancePlanCreateInput): Promise<PerformancePlanWithRelations> {
    const normalized = assertCreateInput(input);
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      if (payload.plans.some((plan) => plan.id === normalized.plan.id)) {
        throw new Error("Performance plan already exists.");
      }
      const signature = buildPerformancePlanDefinitionSignature(normalized.plan);
      if (payload.plans.some((plan) =>
        plan.orgId === normalized.plan.orgId &&
        plan.userId === normalized.plan.userId &&
        plan.status === "active" &&
        buildPerformancePlanDefinitionSignature(plan) === signature
      )) {
        throw new Error(DUPLICATE_ACTIVE_PLAN_MESSAGE);
      }

      const next = normalizePayload({
        plans: [...payload.plans, normalized.plan],
        scopeItems: [...payload.scopeItems, ...normalized.scopeItems],
        auditEvents: [...payload.auditEvents, ...(normalized.auditEvents ?? [])],
        updates: payload.updates
      });
      await this.savePayload(next);
      return relationFor(next, normalized.plan);
    });
  }

  async updatePlan(input: PerformancePlanUpdateInput): Promise<PerformancePlanWithRelations | null> {
    const normalized = assertUpdateInput(input);
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const existing = payload.plans.find((entry) => entry.id === normalized.plan.id);
      if (!existing) {
        return null;
      }
      if (existing.status !== "active") {
        return null;
      }
      if (existing.orgId !== normalized.plan.orgId || existing.userId !== normalized.plan.userId) {
        throw new Error("Performance plan identity cannot be changed.");
      }
      const signature = buildPerformancePlanDefinitionSignature(normalized.plan);
      if (payload.plans.some((plan) =>
        plan.id !== existing.id &&
        plan.orgId === normalized.plan.orgId &&
        plan.userId === normalized.plan.userId &&
        plan.status === "active" &&
        buildPerformancePlanDefinitionSignature(plan) === signature
      )) {
        throw new Error(DUPLICATE_ACTIVE_PLAN_MESSAGE);
      }

      const next = normalizePayload({
        plans: payload.plans.map((plan) => (plan.id === existing.id ? normalized.plan : plan)),
        scopeItems: [
          ...payload.scopeItems.filter((scopeItem) => scopeItem.planId !== existing.id),
          ...normalized.scopeItems
        ],
        auditEvents: [...payload.auditEvents, normalized.auditEvent],
        updates: payload.updates
      });
      await this.savePayload(next);
      return relationFor(next, normalized.plan);
    });
  }

  async getPlanById(planId: string): Promise<PerformancePlanWithRelations | null> {
    const normalizedPlanId = normalizeNullableString(planId);
    if (!normalizedPlanId) {
      return null;
    }
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const plan = payload.plans.find((entry) => entry.id === normalizedPlanId);
      return plan ? relationFor(payload, plan) : null;
    });
  }

  async getOpenPlanForUser(orgId: string, userId: string): Promise<PerformancePlanWithRelations | null> {
    const normalizedOrgId = normalizeNullableString(orgId);
    const normalizedUserId = normalizeNullableString(userId);
    if (!normalizedOrgId || !normalizedUserId) {
      return null;
    }
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const plan = payload.plans.find(
        (entry) => entry.orgId === normalizedOrgId && entry.userId === normalizedUserId && entry.status === "active"
      );
      return plan ? relationFor(payload, plan) : null;
    });
  }

  async listPlansForUser(orgId: string, userId: string): Promise<PerformancePlanWithRelations[]> {
    const normalizedOrgId = normalizeNullableString(orgId);
    const normalizedUserId = normalizeNullableString(userId);
    if (!normalizedOrgId || !normalizedUserId) {
      return [];
    }
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      return payload.plans
        .filter((entry) => entry.orgId === normalizedOrgId && entry.userId === normalizedUserId)
        .map((plan) => relationFor(payload, plan));
    });
  }

  async completePlan(input: PerformancePlanCompleteInput): Promise<PerformancePlanWithRelations | null> {
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const existing = payload.plans.find((entry) => entry.id === input.planId);
      if (!existing) {
        return null;
      }
      if (existing.status === "completed") {
        return relationFor(payload, existing);
      }
      if (existing.status !== "active") {
        return null;
      }
      const completedAt = normalizeIsoString(input.completedAt);
      const finalResult = normalizeFinalResult(input.finalResult);
      const auditEvent = normalizeAuditEvent(input.auditEvent);
      if (!completedAt || !finalResult || !auditEvent) {
        throw new Error("Performance plan completion payload is invalid.");
      }
      const updated: PerformancePlan = {
        ...existing,
        status: "completed",
        completedAt,
        finalResult,
        updatedAt: completedAt
      };
      const next = normalizePayload({
        plans: payload.plans.map((plan) => (plan.id === existing.id ? updated : plan)),
        scopeItems: payload.scopeItems,
        auditEvents: [...payload.auditEvents, auditEvent],
        updates: payload.updates
      });
      await this.savePayload(next);
      return relationFor(next, updated);
    });
  }

  async cancelPlan(input: PerformancePlanCancelInput): Promise<PerformancePlanWithRelations | null> {
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const existing = payload.plans.find((entry) => entry.id === input.planId);
      if (!existing) {
        return null;
      }
      if (existing.status === "cancelled") {
        return relationFor(payload, existing);
      }
      if (existing.status !== "active") {
        return null;
      }
      const cancelledAt = normalizeIsoString(input.cancelledAt);
      const finalResult = normalizeFinalResult(input.finalResult);
      const auditEvent = normalizeAuditEvent(input.auditEvent);
      if (!cancelledAt || !finalResult || !auditEvent) {
        throw new Error("Performance plan cancellation payload is invalid.");
      }
      const updated: PerformancePlan = {
        ...existing,
        status: "cancelled",
        cancelledAt,
        cancelledByActorType: input.cancelledByActorType,
        cancelledByActorId: input.cancelledByActorId,
        cancellationReason: input.cancellationReason,
        finalResult,
        updatedAt: cancelledAt
      };
      const next = normalizePayload({
        plans: payload.plans.map((plan) => (plan.id === existing.id ? updated : plan)),
        scopeItems: payload.scopeItems,
        auditEvents: [...payload.auditEvents, auditEvent],
        updates: payload.updates
      });
      await this.savePayload(next);
      return relationFor(next, updated);
    });
  }

  async appendAuditEvent(event: PerformanceAuditEvent): Promise<void> {
    const normalized = normalizeAuditEvent(event);
    if (!normalized) {
      throw new Error("Performance audit event is invalid.");
    }
    await this.withLock(async () => {
      const payload = await this.loadPayload();
      await this.savePayload(
        normalizePayload({
          ...payload,
          auditEvents: [...payload.auditEvents.filter((entry) => entry.id !== normalized.id), normalized]
        })
      );
    });
  }

  async listAuditEvents(planId: string): Promise<PerformanceAuditEvent[]> {
    const normalizedPlanId = normalizeNullableString(planId);
    if (!normalizedPlanId) {
      return [];
    }
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      return sortAuditEvents(payload.auditEvents.filter((entry) => entry.planId === normalizedPlanId));
    });
  }

  async appendPlanUpdate(input: PerformancePlanAppendUpdateInput): Promise<PerformancePlanUpdateRecord> {
    const normalized = assertPlanUpdateInput(input);
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const plan = payload.plans.find((entry) => entry.id === normalized.planId);
      if (!plan || plan.orgId !== normalized.orgId || plan.userId !== normalized.userId) {
        throw new Error("Performance plan update does not match an existing plan.");
      }
      await this.savePayload(
        normalizePayload({
          ...payload,
          updates: [...payload.updates.filter((entry) => entry.id !== normalized.id), normalized]
        })
      );
      return normalized;
    });
  }

  async listPlanUpdates(planId: string, limit = 100): Promise<PerformancePlanUpdateRecord[]> {
    const normalizedPlanId = normalizeNullableString(planId);
    if (!normalizedPlanId) {
      return [];
    }
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      return sortPlanUpdates(payload.updates.filter((entry) => entry.planId === normalizedPlanId)).slice(0, Math.max(0, limit));
    });
  }

  private async loadPayload(): Promise<PerformancePlanFilePayload> {
    await ensureParentDirectory(this.filePath);
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return normalizePayload(JSON.parse(raw));
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "ENOENT") {
        const payload = { plans: [], scopeItems: [], auditEvents: [], updates: [] };
        await this.savePayload(payload);
        return payload;
      }
      throw error;
    }
  }

  private async savePayload(payload: PerformancePlanFilePayload): Promise<void> {
    await ensureParentDirectory(this.filePath);
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private async withLock<T>(runner: () => Promise<T>): Promise<T> {
    let releaseLock: () => void = () => {};
    const waitForTurn = this.operationQueue;
    this.operationQueue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await waitForTurn;
    try {
      return await runner();
    } finally {
      releaseLock();
    }
  }
}

class PostgresPerformancePlanStore extends BasePerformancePlanStore {
  private readonly pool: PerformancePlanQueryPool;
  private ensureTablePromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    queryPool?: PerformancePlanQueryPool
  ) {
    super();
    this.pool =
      queryPool ??
      new Pool({
        connectionString: databaseUrl,
        max: options.pgPoolMax,
        connectionTimeoutMillis: options.pgConnectTimeoutMs,
        idleTimeoutMillis: options.pgIdleTimeoutMs,
        keepAlive: true
      });
  }

  async initialize(): Promise<void> {
    await this.ensureTable();
  }

  async createPlan(input: PerformancePlanCreateInput): Promise<PerformancePlanWithRelations> {
    const normalized = assertCreateInput(input);
    await this.ensureTable();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await insertPlanRow(client, normalized.plan);
      for (const scopeItem of normalized.scopeItems) {
        await insertScopeItemRow(client, scopeItem);
      }
      for (const auditEvent of normalized.auditEvents ?? []) {
        await insertAuditEventRow(client, auditEvent);
      }
      await client.query("COMMIT");
      return (await this.getPlanById(normalized.plan.id)) ?? {
        plan: normalized.plan,
        scopeItems: normalized.scopeItems,
        auditEvents: normalized.auditEvents ?? []
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string } | null)?.code === "23505") {
        throw new Error(DUPLICATE_ACTIVE_PLAN_MESSAGE);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePlan(input: PerformancePlanUpdateInput): Promise<PerformancePlanWithRelations | null> {
    const normalized = assertUpdateInput(input);
    await this.ensureTable();
    const existing = await this.getPlanById(normalized.plan.id);
    if (!existing) {
      return null;
    }
    if (existing.plan.status !== "active") {
      return null;
    }
    if (existing.plan.orgId !== normalized.plan.orgId || existing.plan.userId !== normalized.plan.userId) {
      throw new Error("Performance plan identity cannot be changed.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PerformancePlanRow>(
        `
          UPDATE performance_plans
          SET start_date = $2::date,
              end_date = $3::date,
              time_zone = $4,
              activity_goal_enabled = $5,
              activity_metric_type = $6,
              activity_target_value = $7,
              performance_goal_enabled = $8,
              performance_metric_type = $9,
              target_score = $10,
              improvement_amount = $11,
              comparison_month_count = $12,
              baseline_start_at = $13::timestamptz,
              baseline_end_at = $14::timestamptz,
              baseline_average = $15,
              baseline_session_count = $16,
              derived_target_score = $17,
              all_assigned_scenarios = $18,
              selected_focus_topic_ids = $19::jsonb,
              selected_scenario_ids = $20::jsonb,
              scope_snapshot = $21::jsonb,
              baseline_snapshot = $22::jsonb,
              definition_signature = $23,
              updated_at = $24::timestamptz
          WHERE id = $1 AND status = 'active'
          RETURNING *
        `,
        [
          normalized.plan.id,
          normalized.plan.startDate,
          normalized.plan.endDate,
          normalized.plan.timeZone,
          normalized.plan.activityGoal.enabled,
          normalized.plan.activityGoal.metricType,
          normalized.plan.activityGoal.targetValue,
          normalized.plan.performanceGoal.enabled,
          normalized.plan.performanceGoal.metricType,
          normalized.plan.performanceGoal.targetScore,
          normalized.plan.performanceGoal.improvementAmount,
          normalized.plan.performanceGoal.comparisonMonthCount,
          normalized.plan.baseline?.baselineStartAt ?? null,
          normalized.plan.baseline?.baselineEndAt ?? null,
          normalized.plan.baseline?.baselineAverage ?? null,
          normalized.plan.baseline?.baselineSessionCount ?? null,
          normalized.plan.baseline?.derivedTargetScore ?? null,
          normalized.plan.scope.allAssignedScenarios,
          JSON.stringify(normalized.plan.scope.selectedFocusTopicIds),
          JSON.stringify(normalized.plan.scope.selectedScenarioIds),
          JSON.stringify(normalized.plan.scope),
          JSON.stringify(normalized.plan.baseline),
          buildPerformancePlanDefinitionSignature(normalized.plan),
          normalized.plan.updatedAt
        ]
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return await this.getPlanById(normalized.plan.id);
      }
      await client.query("DELETE FROM performance_plan_scope_items WHERE plan_id = $1", [normalized.plan.id]);
      for (const scopeItem of normalized.scopeItems) {
        await insertScopeItemRow(client, scopeItem);
      }
      await insertAuditEventRow(client, normalized.auditEvent);
      await client.query("COMMIT");
      return await this.getPlanById(normalized.plan.id);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string } | null)?.code === "23505") {
        throw new Error(DUPLICATE_ACTIVE_PLAN_MESSAGE);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getPlanById(planId: string): Promise<PerformancePlanWithRelations | null> {
    const normalizedPlanId = normalizeNullableString(planId);
    if (!normalizedPlanId) {
      return null;
    }
    await this.ensureTable();
    const result = await this.pool.query<PerformancePlanRow>("SELECT * FROM performance_plans WHERE id = $1", [normalizedPlanId]);
    const plan = result.rows[0] ? mapPlanRow(result.rows[0]) : null;
    return plan ? await this.loadRelations(plan) : null;
  }

  async getOpenPlanForUser(orgId: string, userId: string): Promise<PerformancePlanWithRelations | null> {
    const normalizedOrgId = normalizeNullableString(orgId);
    const normalizedUserId = normalizeNullableString(userId);
    if (!normalizedOrgId || !normalizedUserId) {
      return null;
    }
    await this.ensureTable();
    const result = await this.pool.query<PerformancePlanRow>(
      `
        SELECT *
        FROM performance_plans
        WHERE org_id = $1 AND user_id = $2 AND status = 'active'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [normalizedOrgId, normalizedUserId]
    );
    const plan = result.rows[0] ? mapPlanRow(result.rows[0]) : null;
    return plan ? await this.loadRelations(plan) : null;
  }

  async listPlansForUser(orgId: string, userId: string): Promise<PerformancePlanWithRelations[]> {
    const normalizedOrgId = normalizeNullableString(orgId);
    const normalizedUserId = normalizeNullableString(userId);
    if (!normalizedOrgId || !normalizedUserId) {
      return [];
    }
    await this.ensureTable();
    const result = await this.pool.query<PerformancePlanRow>(
      `
        SELECT *
        FROM performance_plans
        WHERE org_id = $1 AND user_id = $2
        ORDER BY created_at DESC, id DESC
      `,
      [normalizedOrgId, normalizedUserId]
    );
    const plans = result.rows.map(mapPlanRow).filter((entry): entry is PerformancePlan => Boolean(entry));
    return await Promise.all(plans.map((plan) => this.loadRelations(plan)));
  }

  async completePlan(input: PerformancePlanCompleteInput): Promise<PerformancePlanWithRelations | null> {
    const completedAt = normalizeIsoString(input.completedAt);
    const finalResult = normalizeFinalResult(input.finalResult);
    const auditEvent = normalizeAuditEvent(input.auditEvent);
    if (!completedAt || !finalResult || !auditEvent) {
      throw new Error("Performance plan completion payload is invalid.");
    }
    await this.ensureTable();
    const existing = await this.getPlanById(input.planId);
    if (!existing) {
      return null;
    }
    if (existing.plan.status === "completed") {
      return existing;
    }
    if (existing.plan.status !== "active") {
      return null;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PerformancePlanRow>(
        `
          UPDATE performance_plans
          SET status = 'completed',
              completed_at = $2::timestamptz,
              final_result_snapshot = $3::jsonb,
              updated_at = $2::timestamptz
          WHERE id = $1 AND status = 'active'
          RETURNING *
        `,
        [input.planId, completedAt, JSON.stringify(finalResult)]
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return await this.getPlanById(input.planId);
      }
      await insertAuditEventRow(client, auditEvent);
      await client.query("COMMIT");
      return await this.getPlanById(input.planId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelPlan(input: PerformancePlanCancelInput): Promise<PerformancePlanWithRelations | null> {
    const cancelledAt = normalizeIsoString(input.cancelledAt);
    const finalResult = normalizeFinalResult(input.finalResult);
    const auditEvent = normalizeAuditEvent(input.auditEvent);
    if (!cancelledAt || !finalResult || !auditEvent) {
      throw new Error("Performance plan cancellation payload is invalid.");
    }
    await this.ensureTable();
    const existing = await this.getPlanById(input.planId);
    if (!existing) {
      return null;
    }
    if (existing.plan.status === "cancelled") {
      return existing;
    }
    if (existing.plan.status !== "active") {
      return null;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PerformancePlanRow>(
        `
          UPDATE performance_plans
          SET status = 'cancelled',
              cancelled_at = $2::timestamptz,
              cancelled_by_actor_type = $3,
              cancelled_by_actor_id = $4,
              cancellation_reason = $5,
              final_result_snapshot = $6::jsonb,
              updated_at = $2::timestamptz
          WHERE id = $1 AND status = 'active'
          RETURNING *
        `,
        [
          input.planId,
          cancelledAt,
          input.cancelledByActorType,
          input.cancelledByActorId,
          input.cancellationReason,
          JSON.stringify(finalResult)
        ]
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return await this.getPlanById(input.planId);
      }
      await insertAuditEventRow(client, auditEvent);
      await client.query("COMMIT");
      return await this.getPlanById(input.planId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendAuditEvent(event: PerformanceAuditEvent): Promise<void> {
    const normalized = normalizeAuditEvent(event);
    if (!normalized) {
      throw new Error("Performance audit event is invalid.");
    }
    await this.ensureTable();
    await insertAuditEventRow(this.pool, normalized);
  }

  async listAuditEvents(planId: string): Promise<PerformanceAuditEvent[]> {
    const normalizedPlanId = normalizeNullableString(planId);
    if (!normalizedPlanId) {
      return [];
    }
    await this.ensureTable();
    return await loadAuditEvents(this.pool, normalizedPlanId);
  }

  async appendPlanUpdate(input: PerformancePlanAppendUpdateInput): Promise<PerformancePlanUpdateRecord> {
    const normalized = assertPlanUpdateInput(input);
    await this.ensureTable();
    const result = await this.pool.query<PerformancePlanUpdateRow>(
      `
        INSERT INTO performance_plan_updates (
          id,
          plan_id,
          org_id,
          user_id,
          author_actor_type,
          author_actor_id,
          body,
          created_at
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8::timestamptz
        WHERE EXISTS (
          SELECT 1
          FROM performance_plans
          WHERE id = $2 AND org_id = $3 AND user_id = $4
        )
        RETURNING *
      `,
      [
        normalized.id,
        normalized.planId,
        normalized.orgId,
        normalized.userId,
        normalized.authorActorType,
        normalized.authorActorId,
        normalized.body,
        normalized.createdAt
      ]
    );
    const update = result.rows[0] ? mapPlanUpdateRow(result.rows[0]) : null;
    if (!update) {
      throw new Error("Performance plan update does not match an existing plan.");
    }
    return update;
  }

  async listPlanUpdates(planId: string, limit = 100): Promise<PerformancePlanUpdateRecord[]> {
    const normalizedPlanId = normalizeNullableString(planId);
    if (!normalizedPlanId) {
      return [];
    }
    await this.ensureTable();
    return await loadPlanUpdates(this.pool, normalizedPlanId, limit);
  }

  private async loadRelations(plan: PerformancePlan): Promise<PerformancePlanWithRelations> {
    const [scopeItems, auditEvents] = await Promise.all([
      loadScopeItems(this.pool, plan.id),
      loadAuditEvents(this.pool, plan.id)
    ]);
    return { plan, scopeItems, auditEvents };
  }

  private async ensureTable(): Promise<void> {
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = this.pool
        .query(
          `
            CREATE TABLE IF NOT EXISTS performance_plans (
              id TEXT PRIMARY KEY,
              org_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              created_by_actor_type TEXT NOT NULL,
              created_by_actor_id TEXT NULL,
              created_at TIMESTAMPTZ NOT NULL,
              submitted_at TIMESTAMPTZ NOT NULL,
              effective_at TIMESTAMPTZ NOT NULL,
              start_date DATE NOT NULL,
              end_date DATE NOT NULL,
              time_zone TEXT NOT NULL,
              status TEXT NOT NULL,
              completed_at TIMESTAMPTZ NULL,
              cancelled_at TIMESTAMPTZ NULL,
              cancelled_by_actor_type TEXT NULL,
              cancelled_by_actor_id TEXT NULL,
              cancellation_reason TEXT NULL,
              activity_goal_enabled BOOLEAN NOT NULL,
              activity_metric_type TEXT NULL,
              activity_target_value DOUBLE PRECISION NULL,
              performance_goal_enabled BOOLEAN NOT NULL,
              performance_metric_type TEXT NULL,
              target_score DOUBLE PRECISION NULL,
              improvement_amount DOUBLE PRECISION NULL,
              comparison_month_count INTEGER NULL,
              baseline_start_at TIMESTAMPTZ NULL,
              baseline_end_at TIMESTAMPTZ NULL,
              baseline_average DOUBLE PRECISION NULL,
              baseline_session_count INTEGER NULL,
              derived_target_score DOUBLE PRECISION NULL,
              all_assigned_scenarios BOOLEAN NOT NULL,
              selected_focus_topic_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
              selected_scenario_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
              scope_snapshot JSONB NOT NULL,
              baseline_snapshot JSONB NULL,
              final_result_snapshot JSONB NULL,
              definition_signature TEXT NULL,
              updated_at TIMESTAMPTZ NOT NULL
            );

            ALTER TABLE performance_plans
              ADD COLUMN IF NOT EXISTS definition_signature TEXT NULL;

            CREATE INDEX IF NOT EXISTS performance_plans_org_user_status_idx
              ON performance_plans (org_id, user_id, status);
            CREATE INDEX IF NOT EXISTS performance_plans_user_dates_idx
              ON performance_plans (org_id, user_id, start_date, end_date);
            CREATE INDEX IF NOT EXISTS performance_plans_org_status_dates_idx
              ON performance_plans (org_id, status, start_date, end_date);

            CREATE TABLE IF NOT EXISTS performance_plan_scope_items (
              id TEXT PRIMARY KEY,
              plan_id TEXT NOT NULL REFERENCES performance_plans(id) ON DELETE CASCADE,
              org_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              scenario_id TEXT NOT NULL,
              scenario_display_name TEXT NOT NULL,
              scenario_source TEXT NOT NULL,
              segment_id TEXT NULL,
              segment_label TEXT NULL,
              focus_topic_id TEXT NULL,
              focus_topic_name TEXT NULL,
              selection_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
              metadata_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS performance_plan_scope_items_plan_scenario_idx
              ON performance_plan_scope_items (plan_id, scenario_id);
            CREATE INDEX IF NOT EXISTS performance_plan_scope_items_org_user_scenario_idx
              ON performance_plan_scope_items (org_id, user_id, scenario_id);
            CREATE INDEX IF NOT EXISTS performance_plan_scope_items_plan_idx
              ON performance_plan_scope_items (plan_id);

            CREATE TABLE IF NOT EXISTS performance_plan_audit_events (
              id TEXT PRIMARY KEY,
              plan_id TEXT NOT NULL REFERENCES performance_plans(id) ON DELETE CASCADE,
              org_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              actor_type TEXT NOT NULL,
              actor_id TEXT NULL,
              action TEXT NOT NULL,
              changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
              old_values JSONB NULL,
              new_values JSONB NULL,
              reason TEXT NULL,
              created_at TIMESTAMPTZ NOT NULL
            );
            CREATE INDEX IF NOT EXISTS performance_plan_audit_events_plan_created_idx
              ON performance_plan_audit_events (plan_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS performance_plan_audit_events_org_created_idx
              ON performance_plan_audit_events (org_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS performance_plan_updates (
              id TEXT PRIMARY KEY,
              plan_id TEXT NOT NULL REFERENCES performance_plans(id) ON DELETE CASCADE,
              org_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              author_actor_type TEXT NOT NULL,
              author_actor_id TEXT NULL,
              body TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL
            );
            CREATE INDEX IF NOT EXISTS performance_plan_updates_plan_created_idx
              ON performance_plan_updates (plan_id, created_at ASC, id ASC);
            CREATE INDEX IF NOT EXISTS performance_plan_updates_org_created_idx
              ON performance_plan_updates (org_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_usage_sessions_org_user_ended_at
              ON usage_sessions (org_id, user_id, ended_at DESC);
            CREATE INDEX IF NOT EXISTS idx_usage_sessions_org_user_scenario_ended_at
              ON usage_sessions (org_id, user_id, scenario_id, ended_at DESC);
            CREATE INDEX IF NOT EXISTS idx_score_records_org_user_ended_at
              ON score_records (org_id, user_id, ended_at DESC);
            CREATE INDEX IF NOT EXISTS idx_score_records_org_user_scenario_ended_at
              ON score_records (org_id, user_id, scenario_id, ended_at DESC);
          `
        )
        .then(async () => {
          await this.backfillDefinitionSignatures();
          await this.pool.query(
            `
              CREATE UNIQUE INDEX IF NOT EXISTS performance_plans_one_active_definition_idx
                ON performance_plans (org_id, user_id, definition_signature)
                WHERE status = 'active' AND definition_signature IS NOT NULL
            `
          );
          await this.pool.query("DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx");
        })
        .then(() => undefined);
    }
    await this.ensureTablePromise;
  }

  private async backfillDefinitionSignatures(): Promise<void> {
    const result = await this.pool.query<PerformancePlanRow>(
      "SELECT * FROM performance_plans WHERE definition_signature IS NULL"
    );
    for (const row of result.rows) {
      const plan = mapPlanRow(row);
      if (!plan) {
        throw new Error("Unable to backfill Performance plan definition signature.");
      }
      await this.pool.query(
        "UPDATE performance_plans SET definition_signature = $2 WHERE id = $1 AND definition_signature IS NULL",
        [plan.id, buildPerformancePlanDefinitionSignature(plan)]
      );
    }
  }
}

function mapPlanRow(row: PerformancePlanRow): PerformancePlan | null {
  return normalizePlan({
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    createdByActorType: row.created_by_actor_type,
    createdByActorId: row.created_by_actor_id,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    effectiveAt: row.effective_at,
    startDate: row.start_date,
    endDate: row.end_date,
    timeZone: row.time_zone,
    status: row.status,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelledByActorType: row.cancelled_by_actor_type,
    cancelledByActorId: row.cancelled_by_actor_id,
    cancellationReason: row.cancellation_reason,
    activityGoal: {
      enabled: row.activity_goal_enabled,
      metricType: row.activity_metric_type,
      targetValue: row.activity_target_value
    },
    performanceGoal: {
      enabled: row.performance_goal_enabled,
      metricType: row.performance_metric_type,
      targetScore: row.target_score,
      improvementAmount: row.improvement_amount,
      comparisonMonthCount: row.comparison_month_count
    },
    scope: {
      allAssignedScenarios: row.all_assigned_scenarios,
      selectedFocusTopicIds: row.selected_focus_topic_ids,
      selectedScenarioIds: row.selected_scenario_ids,
      scenarios: (row.scope_snapshot as { scenarios?: unknown[] } | null)?.scenarios ?? []
    },
    baseline: row.baseline_snapshot,
    finalResult: row.final_result_snapshot,
    updatedAt: row.updated_at
  });
}

function mapScopeItemRow(row: PerformancePlanScopeItemRow): PerformancePlanScopeItem | null {
  return normalizeScopeItem({
    id: row.id,
    planId: row.plan_id,
    orgId: row.org_id,
    userId: row.user_id,
    scenarioId: row.scenario_id,
    scenarioDisplayName: row.scenario_display_name,
    scenarioSource: row.scenario_source,
    segmentId: row.segment_id,
    segmentLabel: row.segment_label,
    focusTopicId: row.focus_topic_id,
    focusTopicName: row.focus_topic_name,
    selectionSources: row.selection_sources,
    metadataSnapshot: row.metadata_snapshot,
    createdAt: row.created_at
  });
}

function mapAuditEventRow(row: PerformancePlanAuditEventRow): PerformanceAuditEvent | null {
  return normalizeAuditEvent({
    id: row.id,
    planId: row.plan_id,
    orgId: row.org_id,
    userId: row.user_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    changedFields: row.changed_fields,
    oldValues: row.old_values,
    newValues: row.new_values,
    reason: row.reason,
    createdAt: row.created_at
  });
}

function mapPlanUpdateRow(row: PerformancePlanUpdateRow): PerformancePlanUpdateRecord | null {
  return normalizePlanUpdateRecord({
    id: row.id,
    planId: row.plan_id,
    orgId: row.org_id,
    userId: row.user_id,
    authorActorType: row.author_actor_type,
    authorActorId: row.author_actor_id,
    body: row.body,
    createdAt: row.created_at
  });
}

async function insertPlanRow(client: Pick<PoolClient, "query"> | Pick<Pool, "query">, plan: PerformancePlan): Promise<void> {
  await client.query(
    `
      INSERT INTO performance_plans (
        id,
        org_id,
        user_id,
        created_by_actor_type,
        created_by_actor_id,
        created_at,
        submitted_at,
        effective_at,
        start_date,
        end_date,
        time_zone,
        status,
        completed_at,
        cancelled_at,
        cancelled_by_actor_type,
        cancelled_by_actor_id,
        cancellation_reason,
        activity_goal_enabled,
        activity_metric_type,
        activity_target_value,
        performance_goal_enabled,
        performance_metric_type,
        target_score,
        improvement_amount,
        comparison_month_count,
        baseline_start_at,
        baseline_end_at,
        baseline_average,
        baseline_session_count,
        derived_target_score,
        all_assigned_scenarios,
        selected_focus_topic_ids,
        selected_scenario_ids,
        scope_snapshot,
        baseline_snapshot,
        final_result_snapshot,
        definition_signature,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz,
        $9::date, $10::date, $11, $12, $13::timestamptz, $14::timestamptz, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26::timestamptz, $27::timestamptz,
        $28, $29, $30, $31, $32::jsonb, $33::jsonb, $34::jsonb, $35::jsonb, $36::jsonb,
        $37, $38::timestamptz
      )
    `,
    [
      plan.id,
      plan.orgId,
      plan.userId,
      plan.createdByActorType,
      plan.createdByActorId,
      plan.createdAt,
      plan.submittedAt,
      plan.effectiveAt,
      plan.startDate,
      plan.endDate,
      plan.timeZone,
      plan.status,
      plan.completedAt,
      plan.cancelledAt,
      plan.cancelledByActorType,
      plan.cancelledByActorId,
      plan.cancellationReason,
      plan.activityGoal.enabled,
      plan.activityGoal.metricType,
      plan.activityGoal.targetValue,
      plan.performanceGoal.enabled,
      plan.performanceGoal.metricType,
      plan.performanceGoal.targetScore,
      plan.performanceGoal.improvementAmount,
      plan.performanceGoal.comparisonMonthCount,
      plan.baseline?.baselineStartAt ?? null,
      plan.baseline?.baselineEndAt ?? null,
      plan.baseline?.baselineAverage ?? null,
      plan.baseline?.baselineSessionCount ?? null,
      plan.baseline?.derivedTargetScore ?? null,
      plan.scope.allAssignedScenarios,
      JSON.stringify(plan.scope.selectedFocusTopicIds),
      JSON.stringify(plan.scope.selectedScenarioIds),
      JSON.stringify(plan.scope),
      JSON.stringify(plan.baseline),
      JSON.stringify(plan.finalResult),
      buildPerformancePlanDefinitionSignature(plan),
      plan.updatedAt
    ]
  );
}

async function insertScopeItemRow(
  client: Pick<PoolClient, "query"> | Pick<Pool, "query">,
  scopeItem: PerformancePlanScopeItem
): Promise<void> {
  await client.query(
    `
      INSERT INTO performance_plan_scope_items (
        id,
        plan_id,
        org_id,
        user_id,
        scenario_id,
        scenario_display_name,
        scenario_source,
        segment_id,
        segment_label,
        focus_topic_id,
        focus_topic_name,
        selection_sources,
        metadata_snapshot,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::timestamptz)
    `,
    [
      scopeItem.id,
      scopeItem.planId,
      scopeItem.orgId,
      scopeItem.userId,
      scopeItem.scenarioId,
      scopeItem.scenarioDisplayName,
      scopeItem.scenarioSource,
      scopeItem.segmentId,
      scopeItem.segmentLabel,
      scopeItem.focusTopicId,
      scopeItem.focusTopicName,
      JSON.stringify(scopeItem.selectionSources),
      JSON.stringify(scopeItem.metadataSnapshot),
      scopeItem.createdAt
    ]
  );
}

async function insertAuditEventRow(
  client: Pick<PoolClient, "query"> | Pick<Pool, "query">,
  event: PerformanceAuditEvent
): Promise<void> {
  await client.query(
    `
      INSERT INTO performance_plan_audit_events (
        id,
        plan_id,
        org_id,
        user_id,
        actor_type,
        actor_id,
        action,
        changed_fields,
        old_values,
        new_values,
        reason,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      event.id,
      event.planId,
      event.orgId,
      event.userId,
      event.actorType,
      event.actorId,
      event.action,
      JSON.stringify(event.changedFields),
      JSON.stringify(event.oldValues),
      JSON.stringify(event.newValues),
      event.reason,
      event.createdAt
    ]
  );
}

async function loadScopeItems(pool: Pick<Pool, "query">, planId: string): Promise<PerformancePlanScopeItem[]> {
  const result = await pool.query<PerformancePlanScopeItemRow>(
    `
      SELECT *
      FROM performance_plan_scope_items
      WHERE plan_id = $1
      ORDER BY scenario_display_name ASC, scenario_id ASC
    `,
    [planId]
  );
  return result.rows.map(mapScopeItemRow).filter((entry): entry is PerformancePlanScopeItem => Boolean(entry));
}

async function loadAuditEvents(pool: Pick<Pool, "query">, planId: string): Promise<PerformanceAuditEvent[]> {
  const result = await pool.query<PerformancePlanAuditEventRow>(
    `
      SELECT *
      FROM performance_plan_audit_events
      WHERE plan_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [planId]
  );
  return result.rows.map(mapAuditEventRow).filter((entry): entry is PerformanceAuditEvent => Boolean(entry));
}

async function loadPlanUpdates(
  pool: Pick<Pool, "query">,
  planId: string,
  limit: number
): Promise<PerformancePlanUpdateRecord[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number.isFinite(limit) ? limit : 100)));
  const result = await pool.query<PerformancePlanUpdateRow>(
    `
      SELECT *
      FROM performance_plan_updates
      WHERE plan_id = $1
      ORDER BY created_at ASC, id ASC
      LIMIT $2
    `,
    [planId, boundedLimit]
  );
  return result.rows.map(mapPlanUpdateRow).filter((entry): entry is PerformancePlanUpdateRecord => Boolean(entry));
}

export function createPerformancePlanStore(params: CreatePerformancePlanStoreParams): PerformancePlanStore {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }
    return new PostgresPerformancePlanStore(
      params.databaseUrl,
      {
        pgPoolMax: params.pgPoolMax,
        pgConnectTimeoutMs: params.pgConnectTimeoutMs,
        pgIdleTimeoutMs: params.pgIdleTimeoutMs
      },
      params.queryPool
    );
  }

  return new FilePerformancePlanStore(params.dbPath);
}
