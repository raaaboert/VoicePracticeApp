import {
  AuditActorType,
  CancelPerformancePlanResponse,
  CreatePerformancePlanResponse,
  DashboardPerformancePlanDetailResponse,
  DashboardPerformancePlanRow,
  DashboardPerformanceSummary,
  DashboardPerformanceUserOption,
  DashboardPerformanceWorkspaceResponse,
  DashboardViewer,
  MobilePerformanceCurrentDisplayState,
  MobilePerformanceCurrentResponse,
  MobilePerformancePlanOptionsResponse,
  MobilePerformancePlanDetailResponse,
  MobilePerformancePlanHistoryResponse,
  PERFORMANCE_ACTIVITY_METRIC_TYPES,
  PERFORMANCE_GOAL_METRIC_TYPES,
  PerformanceAssignableFocusTopic,
  PerformanceAssignableScenario,
  PerformanceActivityGoal,
  PerformanceAuditDisplayEvent,
  PerformanceAuditEvent,
  PerformanceBaseline,
  PerformanceGoal,
  PerformanceInsight,
  PerformancePlan,
  PerformancePlanInput,
  PerformancePlanPreviewResponse,
  PerformancePlanScopeItem,
  PerformancePlanSummary,
  PerformanceProgress,
  PerformanceScopeSelectionRequest,
  SimulationScoreRecord,
  UpdatePerformancePlanResponse,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";
import { randomUUID } from "node:crypto";

import {
  PerformancePlanStore,
  PerformancePlanWithRelations
} from "../storage/performancePlanStore.js";
import { buildPlanWindow, compareDateKeys, isDateKey, isValidIanaTimeZone } from "./performanceDateWindows.js";
import { calculatePerformanceBaseline, PerformanceBaselinePreview } from "./performanceBaseline.js";
import { cancelPerformancePlan, finalizePerformancePlanIfEnded } from "./performanceFinalization.js";
import {
  calculatePerformanceProgress
} from "./performanceProgress.js";
import { buildPerformanceInsights } from "./performanceInsights.js";
import { freezePerformancePlanScope, PerformanceScopeCandidate } from "./performanceScope.js";
import { validatePerformancePlanInput } from "./performancePlanValidation.js";

export interface BuildMobilePerformanceCurrentResponseParams {
  store: PerformancePlanStore;
  orgId: string | null;
  userId: string;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
  calculateProgress?: typeof calculatePerformanceProgress;
  buildInsights?: typeof buildPerformanceInsights;
  finalizeEndedPlan?: typeof finalizePerformancePlanIfEnded;
}

export interface PerformancePlanRequestContext {
  store: PerformancePlanStore;
  orgId: string;
  userId: string;
  input: PerformancePlanInput;
  candidates: PerformanceScopeCandidate[];
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
  actorType: AuditActorType;
  actorId: string | null;
  createPlanId?: () => string;
  createScopeItemId?: (scenarioId: string) => string;
  createAuditEventId?: () => string;
}

export interface UpdatePerformancePlanRequestContext extends PerformancePlanRequestContext {
  existingPlan: PerformancePlan;
}

export interface PerformancePlanUserContext {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  timeZone: string;
  divisionId: string | null;
  divisionName: string | null;
  status: DashboardPerformanceUserOption["status"];
  orgRole: DashboardPerformanceUserOption["orgRole"];
  candidates: PerformanceScopeCandidate[];
}

export interface BuildDashboardPerformanceWorkspaceParams {
  store: PerformancePlanStore;
  viewer: DashboardViewer;
  users: PerformancePlanUserContext[];
  organizationSummaries?: BuildDashboardPerformanceWorkspaceOrganizationSummary[];
  selectedOrg?: { orgId: string; orgName: string } | null;
  scopeMode?: DashboardPerformanceWorkspaceResponse["scopeMode"];
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
  divisionScope?: DashboardPerformanceWorkspaceResponse["divisionScope"];
  canManageUser?: (user: PerformancePlanUserContext) => boolean;
}

export interface BuildDashboardPerformanceWorkspaceOrganizationSummary {
  orgId: string;
  orgName: string;
  activePlanCount: number;
  activeNeedsAttentionCount: number;
  visibleUserCount: number;
}

export interface BuildPerformancePlanDetailParams {
  store: PerformancePlanStore;
  planId: string;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
  auditDisplayContext?: PerformanceAuditDisplayContext;
}

export interface PerformanceAuditDisplayContext {
  viewer: "mobile_user" | "tenant_manager" | "platform_admin";
  currentUserId: string;
  planOrgId: string;
  users: UserProfile[];
}

export function buildMobilePerformancePlanOptionsResponse(params: {
  candidates: PerformanceScopeCandidate[];
  defaultTimeZone: string;
  now: Date;
}): MobilePerformancePlanOptionsResponse {
  return {
    generatedAt: params.now.toISOString(),
    defaultTimeZone: params.defaultTimeZone,
    availableFocusTopics: buildPerformanceAssignableFocusTopics(params.candidates),
    availableScenarios: buildPerformanceAssignableScenarios(params.candidates)
  };
}

export interface CancelPerformancePlanWithRuleParams extends BuildPerformancePlanDetailParams {
  actorType: AuditActorType;
  actorId: string | null;
  reason?: string | null;
}

export async function buildMobilePerformanceCurrentResponse(
  params: BuildMobilePerformanceCurrentResponseParams
): Promise<MobilePerformanceCurrentResponse> {
  const generatedAt = params.now.toISOString();
  if (!params.orgId) {
    return buildEmptyMobilePerformanceCurrentResponse(generatedAt);
  }

  const userPlans = await params.store.listPlansForUser(params.orgId, params.userId);
  const activePlans = userPlans.filter((entry) => entry.plan.status === "active");
  if (activePlans.length === 0) {
    return buildEmptyMobilePerformanceCurrentResponse(generatedAt);
  }

  const finalizeEndedPlan = params.finalizeEndedPlan ?? finalizePerformancePlanIfEnded;
  const materializedPlans: PerformancePlanWithRelations[] = [];
  for (const activePlan of activePlans) {
    const materialized = await finalizeEndedPlan({
      store: params.store,
      plan: activePlan.plan,
      usageSessions: params.usageSessions,
      scoreRecords: params.scoreRecords,
      now: params.now
    });
    if (materialized?.plan.status === "active") {
      materializedPlans.push(materialized);
    }
  }
  if (materializedPlans.length === 0) {
    return buildEmptyMobilePerformanceCurrentResponse(generatedAt);
  }

  const summaries = materializedPlans
    .map((plan) => summarizePlan({
      plan: plan.plan,
      usageSessions: params.usageSessions,
      scoreRecords: params.scoreRecords,
      now: params.now,
      calculateProgress: params.calculateProgress,
      buildInsights: params.buildInsights
    }))
    .sort((left, right) => left.plan.endDate.localeCompare(right.plan.endDate) || left.plan.createdAt.localeCompare(right.plan.createdAt));

  return {
    generatedAt,
    activePlans: summaries,
    displayState: deriveMobilePerformanceDisplayState(summaries)
  };
}

export function buildEmptyMobilePerformanceCurrentResponse(generatedAt: string): MobilePerformanceCurrentResponse {
  return {
    generatedAt,
    activePlans: [],
    displayState: {
      state: "no_active_plans",
      activePlanCount: 0,
      activeNeedsAttentionCount: 0,
      activeCollectingEvidenceCount: 0
    }
  };
}

export function buildPerformanceAssignableFocusTopics(
  candidates: PerformanceScopeCandidate[]
): PerformanceAssignableFocusTopic[] {
  const counts = new Map<string, { id: string; name: string; scenarioIds: Set<string> }>();
  for (const candidate of candidates) {
    for (const topic of candidate.focusTopics) {
      const current = counts.get(topic.id) ?? { id: topic.id, name: topic.name, scenarioIds: new Set<string>() };
      current.scenarioIds.add(candidate.scenarioId);
      counts.set(topic.id, current);
    }
  }

  return Array.from(counts.values())
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      scenarioCount: entry.scenarioIds.size
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function buildPerformanceAssignableScenarios(
  candidates: PerformanceScopeCandidate[]
): PerformanceAssignableScenario[] {
  return candidates
    .map((candidate) => ({
      scenarioId: candidate.scenarioId,
      displayName: candidate.displayName,
      source: candidate.source,
      segmentId: candidate.segmentId,
      segmentLabel: candidate.segmentLabel,
      focusTopics: candidate.focusTopics
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.scenarioId.localeCompare(right.scenarioId));
}

export function previewPerformancePlan(
  params: Omit<PerformancePlanRequestContext, "store" | "actorType" | "actorId">
): PerformancePlanPreviewResponse {
  const input = normalizePerformancePlanInputOrThrow(params.input);
  const generatedAt = params.now.toISOString();
  const errors: string[] = [];
  let scope: PerformancePlan["scope"] | null = null;
  let baseline: PerformanceBaseline | null = null;
  let baselinePreview: PerformancePlanPreviewResponse["baselinePreview"] = null;

  try {
    scope = freezePerformancePlanScope({
      selection: normalizeScopeSelection(input.scopeSelection),
      candidates: params.candidates,
      planId: "preview",
      orgId: params.orgId,
      userId: params.userId,
      createdAt: generatedAt,
      createScopeItemId: (scenarioId) => `preview_${scenarioId}`
    }).scope;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Performance plan scope is invalid.");
  }

  if (scope && needsPerformanceBaseline(input.performanceGoal)) {
    try {
      const preview = calculatePerformanceBaseline({
        orgId: params.orgId,
        userId: params.userId,
        scope,
        goal: input.performanceGoal,
        effectiveAt: generatedAt,
        timeZone: input.timeZone,
        scoreRecords: params.scoreRecords
      });
      baseline = preview.baseline;
      baselinePreview = toBaselinePreviewPayload(preview);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Performance baseline could not be calculated.");
    }
  }

  if (scope) {
    const validation = validatePerformancePlanInput({
      startDate: input.startDate,
      endDate: input.endDate,
      timeZone: input.timeZone,
      now: params.now,
      activityGoal: input.activityGoal,
      performanceGoal: input.performanceGoal,
      scope,
      baseline
    });
    errors.push(...validation.errors);
  }

  return {
    generatedAt,
    valid: errors.length === 0,
    errors: uniqueErrors(errors),
    scope,
    baseline,
    baselinePreview,
    availableFocusTopics: buildPerformanceAssignableFocusTopics(params.candidates),
    availableScenarios: buildPerformanceAssignableScenarios(params.candidates)
  };
}

export async function createPerformancePlanFromInput(
  params: PerformancePlanRequestContext
): Promise<CreatePerformancePlanResponse> {
  const input = normalizePerformancePlanInputOrThrow(params.input);
  const planId = params.createPlanId?.() ?? `perf_plan_${randomUUID()}`;
  const createdAt = params.now.toISOString();
  let frozen: ReturnType<typeof freezePerformancePlanScope>;
  let baseline: PerformanceBaseline | null = null;
  try {
    frozen = freezePerformancePlanScope({
      selection: normalizeScopeSelection(input.scopeSelection),
      candidates: params.candidates,
      planId,
      orgId: params.orgId,
      userId: params.userId,
      createdAt,
      createScopeItemId: params.createScopeItemId
    });
  } catch (error) {
    throw new PerformancePlanInputError([toInputErrorMessage(error, "Performance plan scope is invalid.")]);
  }
  if (needsPerformanceBaseline(input.performanceGoal)) {
    try {
      baseline = calculatePerformanceBaseline({
        orgId: params.orgId,
        userId: params.userId,
        scope: frozen.scope,
        goal: input.performanceGoal,
        effectiveAt: createdAt,
        timeZone: input.timeZone,
        scoreRecords: params.scoreRecords
      }).baseline;
    } catch (error) {
      throw new PerformancePlanInputError([toInputErrorMessage(error, "Performance baseline could not be calculated.")]);
    }
  }
  const validation = validatePerformancePlanInput({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
    now: params.now,
    activityGoal: input.activityGoal,
    performanceGoal: input.performanceGoal,
    scope: frozen.scope,
    baseline
  });
  if (!validation.valid) {
    throw new PerformancePlanInputError(validation.errors);
  }

  const plan: PerformancePlan = {
    id: planId,
    orgId: params.orgId,
    userId: params.userId,
    createdByActorType: params.actorType,
    createdByActorId: params.actorId,
    createdAt,
    submittedAt: createdAt,
    effectiveAt: createdAt,
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
    status: "active",
    completedAt: null,
    cancelledAt: null,
    cancelledByActorType: null,
    cancelledByActorId: null,
    cancellationReason: null,
    activityGoal: input.activityGoal,
    performanceGoal: input.performanceGoal,
    scope: frozen.scope,
    baseline,
    finalResult: null,
    updatedAt: createdAt
  };

  const created = await params.store.createPlan({
    plan,
    scopeItems: frozen.scopeItems,
    auditEvents: [
      buildAuditEvent({
        id: params.createAuditEventId?.() ?? `perf_audit_${randomUUID()}`,
        plan,
        actorType: params.actorType,
        actorId: params.actorId,
        action: "created",
        createdAt,
        newValues: { plan }
      })
    ]
  });
  const progress = calculatePerformanceProgress({
    plan: created.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  }).progress;

  return {
    created: true,
    plan: created.plan,
    progress,
    insights: buildPerformanceInsights(progress)
  };
}

export async function updatePerformancePlanFromInput(
  params: UpdatePerformancePlanRequestContext
): Promise<UpdatePerformancePlanResponse> {
  const input = normalizePerformancePlanInputOrThrow(params.input);
  if (params.existingPlan.status !== "active") {
    throw new PerformancePlanInputError(["Only active Performance plans can be edited."]);
  }
  if (input.userId !== params.existingPlan.userId || params.userId !== params.existingPlan.userId) {
    throw new PerformancePlanInputError(["Performance plan target user cannot be changed."]);
  }
  if ((input.orgId && input.orgId !== params.existingPlan.orgId) || params.orgId !== params.existingPlan.orgId) {
    throw new PerformancePlanInputError(["Performance plan organization cannot be changed."]);
  }

  const updatedAt = params.now.toISOString();
  let frozen: ReturnType<typeof freezePerformancePlanScope>;
  let baseline: PerformanceBaseline | null = null;
  try {
    frozen = freezePerformancePlanScope({
      selection: normalizeScopeSelection(input.scopeSelection),
      candidates: params.candidates,
      planId: params.existingPlan.id,
      orgId: params.orgId,
      userId: params.userId,
      createdAt: updatedAt,
      createScopeItemId: params.createScopeItemId
    });
  } catch (error) {
    throw new PerformancePlanInputError([toInputErrorMessage(error, "Performance plan scope is invalid.")]);
  }
  if (needsPerformanceBaseline(input.performanceGoal)) {
    try {
      baseline = calculatePerformanceBaseline({
        orgId: params.orgId,
        userId: params.userId,
        scope: frozen.scope,
        goal: input.performanceGoal,
        effectiveAt: updatedAt,
        timeZone: input.timeZone,
        scoreRecords: params.scoreRecords
      }).baseline;
    } catch (error) {
      throw new PerformancePlanInputError([toInputErrorMessage(error, "Performance baseline could not be calculated.")]);
    }
  }
  const validation = validatePerformancePlanInput({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
    now: params.now,
    activityGoal: input.activityGoal,
    performanceGoal: input.performanceGoal,
    scope: frozen.scope,
    baseline
  });
  const validationErrors = input.startDate === params.existingPlan.startDate
    ? validation.errors.filter((error) => error !== BACKDATED_PLAN_ERROR)
    : validation.errors;
  if (validationErrors.length > 0) {
    throw new PerformancePlanInputError(validationErrors);
  }

  const updatedPlan: PerformancePlan = {
    ...params.existingPlan,
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
    activityGoal: input.activityGoal,
    performanceGoal: input.performanceGoal,
    scope: frozen.scope,
    baseline,
    updatedAt
  };

  const updated = await params.store.updatePlan({
    plan: updatedPlan,
    scopeItems: frozen.scopeItems,
    auditEvent: buildAuditEvent({
      id: params.createAuditEventId?.() ?? `perf_audit_${randomUUID()}`,
      plan: updatedPlan,
      actorType: params.actorType,
      actorId: params.actorId,
      action: "updated",
      createdAt: updatedAt,
      oldValues: {
        startDate: params.existingPlan.startDate,
        endDate: params.existingPlan.endDate,
        timeZone: params.existingPlan.timeZone,
        activityGoal: params.existingPlan.activityGoal,
        performanceGoal: params.existingPlan.performanceGoal,
        scope: params.existingPlan.scope,
        baseline: params.existingPlan.baseline
      },
      newValues: {
        startDate: updatedPlan.startDate,
        endDate: updatedPlan.endDate,
        timeZone: updatedPlan.timeZone,
        activityGoal: updatedPlan.activityGoal,
        performanceGoal: updatedPlan.performanceGoal,
        scope: updatedPlan.scope,
        baseline: updatedPlan.baseline
      }
    })
  });
  if (!updated || updated.plan.status !== "active") {
    throw new PerformancePlanInputError(["Only active Performance plans can be edited."]);
  }

  const progress = calculatePerformanceProgress({
    plan: updated.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  }).progress;

  return {
    updated: true,
    plan: updated.plan,
    progress,
    insights: buildPerformanceInsights(progress)
  };
}

export async function buildMobilePerformancePlanHistoryResponse(params: {
  store: PerformancePlanStore;
  orgId: string | null;
  userId: string;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
}): Promise<MobilePerformancePlanHistoryResponse> {
  const generatedAt = params.now.toISOString();
  if (!params.orgId) {
    return { generatedAt, plans: [] };
  }
  const plans = await params.store.listPlansForUser(params.orgId, params.userId);
  const summaries = await summarizePlans({
    store: params.store,
    plans,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  });
  return { generatedAt, plans: summaries };
}

export async function buildPerformancePlanDetailResponse(
  params: BuildPerformancePlanDetailParams
): Promise<MobilePerformancePlanDetailResponse | null> {
  const loaded = await materializePlanIfEnded(params);
  if (!loaded) {
    return null;
  }
  const summary = summarizePlan({
    plan: loaded.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  });
  return {
    generatedAt: params.now.toISOString(),
    plan: summary.plan,
    progress: summary.progress,
    insights: summary.insights,
    auditEvents: buildPerformanceAuditDisplayEvents({
      events: loaded.auditEvents,
      context: params.auditDisplayContext ?? {
        viewer: "mobile_user",
        currentUserId: loaded.plan.userId,
        planOrgId: loaded.plan.orgId,
        users: []
      }
    })
  };
}

export async function cancelPerformancePlanWithBoundaryRule(
  params: CancelPerformancePlanWithRuleParams
): Promise<CancelPerformancePlanResponse | null> {
  const loaded = await params.store.getPlanById(params.planId);
  if (!loaded) {
    return null;
  }

  if (loaded.plan.status !== "active") {
    return {
      plan: loaded.plan,
      cancelled: false,
      finalizedInstead: false,
      progress: null,
      insights: []
    };
  }

  if (hasPlanEndBoundaryPassed(loaded.plan, params.now)) {
    const finalized = await finalizePerformancePlanIfEnded({
      store: params.store,
      plan: loaded.plan,
      usageSessions: params.usageSessions,
      scoreRecords: params.scoreRecords,
      now: params.now,
      actorId: params.actorId
    });
    return {
      plan: finalized?.plan ?? null,
      cancelled: false,
      finalizedInstead: true,
      progress: null,
      insights: []
    };
  }

  const cancelled = await cancelPerformancePlan({
    store: params.store,
    plan: loaded.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    cancelledAt: params.now,
    actorType: params.actorType,
    actorId: params.actorId,
    reason: params.reason ?? null
  });

  return {
    plan: cancelled?.plan ?? null,
    cancelled: cancelled?.plan.status === "cancelled",
    finalizedInstead: false,
    progress: null,
    insights: []
  };
}

export async function buildDashboardPerformanceWorkspaceResponse(
  params: BuildDashboardPerformanceWorkspaceParams
): Promise<DashboardPerformanceWorkspaceResponse> {
  const canManageByUserId = new Map(
    params.users.map((user) => [user.userId, params.canManageUser ? params.canManageUser(user) : true])
  );
  const plans = (
    await Promise.all(
      params.users.map(async (user) => {
        const userPlans = await params.store.listPlansForUser(user.orgId, user.userId);
        const summaries = await summarizePlans({
          store: params.store,
          plans: userPlans,
          usageSessions: params.usageSessions.filter((session) => session.orgId === user.orgId && session.userId === user.userId),
          scoreRecords: params.scoreRecords.filter((record) => record.orgId === user.orgId && record.userId === user.userId),
          now: params.now
        });
        return summaries.map(
          (summary): DashboardPerformancePlanRow => ({
            ...summary,
            userEmail: user.email,
            orgName: user.orgName,
            divisionId: user.divisionId,
            divisionName: user.divisionName,
            canCancel: summary.plan.status === "active" && (canManageByUserId.get(user.userId) ?? false),
            canEdit: summary.plan.status === "active" && (canManageByUserId.get(user.userId) ?? false)
          })
        );
      })
    )
  ).flat();

  const userOptions = params.users.map(
    (user): DashboardPerformanceUserOption => ({
      userId: user.userId,
      email: user.email,
      orgId: user.orgId,
      orgName: user.orgName,
      timeZone: user.timeZone,
      divisionId: user.divisionId,
      divisionName: user.divisionName,
      status: user.status,
      orgRole: user.orgRole,
      activePlanCount: plans.filter((row) => row.plan.userId === user.userId && row.plan.status === "active").length,
      canManagePerformancePlans: canManageByUserId.get(user.userId) ?? false,
      assignableFocusTopics: buildPerformanceAssignableFocusTopics(user.candidates),
      assignableScenarios: buildPerformanceAssignableScenarios(user.candidates)
    })
  );

  const summary = params.scopeMode === "portfolio"
    ? buildDashboardPerformancePortfolioSummary(params.organizationSummaries ?? [])
    : buildDashboardPerformanceSummary(plans);
  return {
    viewer: params.viewer,
    generatedAt: params.now.toISOString(),
    scopeMode: params.scopeMode ?? "organization",
    selectedOrg: params.selectedOrg ?? null,
    organizationSummaries: params.organizationSummaries ?? [],
    defaultTimeZone: "UTC",
    summary: {
      ...summary,
      visibleUserCount: params.scopeMode === "portfolio" ? summary.visibleUserCount : userOptions.length
    },
    users: userOptions,
    plans: plans.sort((left, right) => right.plan.createdAt.localeCompare(left.plan.createdAt) || right.plan.id.localeCompare(left.plan.id)),
    divisionScope: params.divisionScope
  };
}

function buildDashboardPerformancePortfolioSummary(
  rows: BuildDashboardPerformanceWorkspaceOrganizationSummary[]
): DashboardPerformanceSummary {
  return {
    visibleUserCount: rows.reduce((total, row) => total + row.visibleUserCount, 0),
    activePlanCount: rows.reduce((total, row) => total + row.activePlanCount, 0),
    completedPlanCount: 0,
    cancelledPlanCount: 0,
    activeOnTrackCount: rows.reduce((total, row) => total + Math.max(0, row.activePlanCount - row.activeNeedsAttentionCount), 0),
    activeNeedsAttentionCount: rows.reduce((total, row) => total + row.activeNeedsAttentionCount, 0)
  };
}

export function buildDashboardPerformancePlanDetailResponse(params: {
  viewer: DashboardViewer;
  detail: MobilePerformancePlanDetailResponse;
  canCancel: boolean;
  rowContext: {
    userEmail: string;
    orgName: string;
    divisionId: string | null;
    divisionName: string | null;
  };
}): DashboardPerformancePlanDetailResponse {
  return {
    viewer: params.viewer,
    generatedAt: params.detail.generatedAt,
    plan: {
      plan: params.detail.plan,
      progress: params.detail.progress,
      insights: params.detail.insights,
      userEmail: params.rowContext.userEmail,
      orgName: params.rowContext.orgName,
      divisionId: params.rowContext.divisionId,
      divisionName: params.rowContext.divisionName,
      canCancel: params.canCancel,
      canEdit: params.canCancel
    },
    auditEvents: params.detail.auditEvents
  };
}

export class PerformancePlanInputError extends Error {
  errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "PerformancePlanInputError";
    this.errors = errors;
  }
}

const ACTIVITY_METRICS = new Set<string>(PERFORMANCE_ACTIVITY_METRIC_TYPES);
const PERFORMANCE_METRICS = new Set<string>(PERFORMANCE_GOAL_METRIC_TYPES);
const BACKDATED_PLAN_ERROR = "Users cannot create a backdated Performance plan.";

function normalizePerformancePlanInputOrThrow(input: PerformancePlanInput): PerformancePlanInput {
  const errors: string[] = [];
  if (!isRecord(input)) {
    throw new PerformancePlanInputError(["Performance plan request body is required."]);
  }

  const userId = normalizeRequiredText(input.userId, "userId", errors);
  const orgId = normalizeOptionalText(input.orgId, "orgId", errors);
  const startDate = normalizeDateKeyInput(input.startDate, "startDate", errors);
  const endDate = normalizeDateKeyInput(input.endDate, "endDate", errors);
  const timeZone = normalizeTimeZoneInput(input.timeZone, errors);
  const activityGoal = normalizeActivityGoalInput(input.activityGoal, errors);
  const performanceGoal = normalizePerformanceGoalInput(input.performanceGoal, errors);
  const scopeSelection = normalizeScopeSelectionInput(input.scopeSelection, errors);

  if (isDateKey(startDate) && isDateKey(endDate) && compareDateKeys(startDate, endDate) > 0) {
    errors.push("startDate must be on or before endDate.");
  }

  if (errors.length > 0) {
    throw new PerformancePlanInputError(uniqueErrors(errors));
  }

  return {
    userId,
    orgId,
    startDate,
    endDate,
    timeZone,
    activityGoal,
    performanceGoal,
    scopeSelection
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRequiredText(value: unknown, fieldName: string, errors: string[]): string {
  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a non-empty string.`);
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    errors.push(`${fieldName} must be a non-empty string.`);
  }
  return trimmed;
}

function normalizeOptionalText(value: unknown, fieldName: string, errors: string[]): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string when provided.`);
    return null;
  }
  return value.trim() || null;
}

function normalizeDateKeyInput(value: unknown, fieldName: string, errors: string[]): string {
  if (typeof value !== "string") {
    errors.push(`${fieldName} must use YYYY-MM-DD format.`);
    return "";
  }
  const trimmed = value.trim();
  if (!isDateKey(trimmed)) {
    errors.push(`${fieldName} must be a valid calendar date in YYYY-MM-DD format.`);
  }
  return trimmed;
}

function normalizeTimeZoneInput(value: unknown, errors: string[]): string {
  if (typeof value !== "string" || !value.trim()) {
    errors.push("A valid IANA timezone is required.");
    return "UTC";
  }
  const trimmed = value.trim();
  if (!isValidIanaTimeZone(trimmed)) {
    errors.push("A valid IANA timezone is required.");
  }
  return trimmed;
}

function normalizeActivityGoalInput(value: unknown, errors: string[]): PerformanceActivityGoal {
  if (!isRecord(value)) {
    errors.push("activityGoal is required.");
    return { enabled: false, metricType: null, targetValue: null };
  }

  if (typeof value.enabled !== "boolean") {
    errors.push("activityGoal.enabled must be a boolean.");
  }
  const enabled = value.enabled === true;
  const metricType = normalizeActivityMetricTypeInput(value.metricType, errors);
  const targetValue = normalizeNullableNumberInput(value.targetValue, "activityGoal.targetValue", errors);
  return { enabled, metricType, targetValue };
}

function normalizeActivityMetricTypeInput(value: unknown, errors: string[]): PerformanceActivityGoal["metricType"] {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    errors.push("activityGoal.metricType must be a supported string or null.");
    return null;
  }
  const trimmed = value.trim();
  if (!ACTIVITY_METRICS.has(trimmed)) {
    errors.push("Activity metric type is required.");
  }
  return trimmed as PerformanceActivityGoal["metricType"];
}

function normalizePerformanceGoalInput(value: unknown, errors: string[]): PerformanceGoal {
  if (!isRecord(value)) {
    errors.push("performanceGoal is required.");
    return { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null };
  }

  if (typeof value.enabled !== "boolean") {
    errors.push("performanceGoal.enabled must be a boolean.");
  }
  const enabled = value.enabled === true;
  const metricType = normalizePerformanceMetricTypeInput(value.metricType, errors);
  const comparisonMonthCount = normalizeComparisonMonthCountInput(value.comparisonMonthCount, errors);
  return {
    enabled,
    metricType,
    targetScore: normalizeNullableNumberInput(value.targetScore, "performanceGoal.targetScore", errors),
    improvementAmount: normalizeNullableNumberInput(value.improvementAmount, "performanceGoal.improvementAmount", errors),
    comparisonMonthCount
  };
}

function normalizePerformanceMetricTypeInput(value: unknown, errors: string[]): PerformanceGoal["metricType"] {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    errors.push("performanceGoal.metricType must be a supported string or null.");
    return null;
  }
  const trimmed = value.trim();
  if (!PERFORMANCE_METRICS.has(trimmed)) {
    errors.push("Performance metric type is required.");
  }
  return trimmed as PerformanceGoal["metricType"];
}

function normalizeNullableNumberInput(value: unknown, fieldName: string, errors: string[]): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${fieldName} must be a finite number when provided.`);
    return null;
  }
  return value;
}

function normalizeComparisonMonthCountInput(value: unknown, errors: string[]): 1 | 2 | 3 | 6 | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value !== 1 && value !== 2 && value !== 3 && value !== 6) {
    errors.push("Comparison month count must be 1, 2, 3, or 6.");
    return null;
  }
  return value;
}

function normalizeScopeSelectionInput(value: unknown, errors: string[]): PerformanceScopeSelectionRequest {
  if (!isRecord(value)) {
    errors.push("scopeSelection is required.");
    return { allAssignedScenarios: false, selectedFocusTopicIds: [], selectedScenarioIds: [] };
  }

  if (typeof value.allAssignedScenarios !== "boolean") {
    errors.push("scopeSelection.allAssignedScenarios must be a boolean.");
  }
  const allAssignedScenarios = value.allAssignedScenarios === true;
  const selectedFocusTopicIds = normalizeStringListInput(
    value.selectedFocusTopicIds,
    "scopeSelection.selectedFocusTopicIds",
    errors
  );
  const selectedScenarioIds = normalizeStringListInput(
    value.selectedScenarioIds,
    "scopeSelection.selectedScenarioIds",
    errors
  );

  pushDuplicateErrors(selectedFocusTopicIds, "scopeSelection.selectedFocusTopicIds", errors);
  pushDuplicateErrors(selectedScenarioIds, "scopeSelection.selectedScenarioIds", errors);
  if (!allAssignedScenarios && selectedFocusTopicIds.length === 0 && selectedScenarioIds.length === 0) {
    errors.push("Performance plan scope must include at least one selected Focus Topic or scenario.");
  }

  return { allAssignedScenarios, selectedFocusTopicIds, selectedScenarioIds };
}

function normalizeStringListInput(value: unknown, fieldName: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array of strings.`);
    return [];
  }
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      errors.push(`${fieldName} must contain only non-empty strings.`);
      continue;
    }
    normalized.push(entry.trim());
  }
  return normalized;
}

function pushDuplicateErrors(values: string[], fieldName: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`${fieldName} must not contain duplicate ids.`);
      return;
    }
    seen.add(value);
  }
}

function toInputErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function deriveMobilePerformanceDisplayState(summaries: PerformancePlanSummary[]): MobilePerformanceCurrentDisplayState {
  const activeSummaries = summaries.filter((summary) => summary.plan.status === "active");
  if (activeSummaries.length === 0) {
    return {
      state: "no_active_plans",
      activePlanCount: 0,
      activeNeedsAttentionCount: 0,
      activeCollectingEvidenceCount: 0
    };
  }
  const activeCollectingEvidenceCount = activeSummaries.filter(
    (summary) => summary.progress?.performance.enabled === true && summary.progress.performance.notEnoughData === true
  ).length;
  const activeNeedsAttentionCount = activeSummaries.filter(
    (summary) => summary.progress?.overallCurrentlyMeetingTarget === false
  ).length;
  return {
    state:
      activeNeedsAttentionCount > 0
        ? "active_plans_need_attention"
        : activeCollectingEvidenceCount > 0
          ? "active_plans_collecting_evidence"
          : "active_plans_on_track",
    activePlanCount: activeSummaries.length,
    activeNeedsAttentionCount,
    activeCollectingEvidenceCount
  };
}

async function summarizePlans(params: {
  store: PerformancePlanStore;
  plans: PerformancePlanWithRelations[];
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
}): Promise<PerformancePlanSummary[]> {
  const summaries: PerformancePlanSummary[] = [];
  for (const plan of params.plans) {
    const materialized = plan.plan.status === "active"
      ? await finalizePerformancePlanIfEnded({
          store: params.store,
          plan: plan.plan,
          usageSessions: params.usageSessions,
          scoreRecords: params.scoreRecords,
          now: params.now
        })
      : plan;
    if (!materialized) {
      continue;
    }
    summaries.push(
      summarizePlan({
        plan: materialized.plan,
        usageSessions: params.usageSessions,
        scoreRecords: params.scoreRecords,
        now: params.now
      })
    );
  }
  return summaries;
}

function summarizePlan(params: {
  plan: PerformancePlan;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
  calculateProgress?: typeof calculatePerformanceProgress;
  buildInsights?: typeof buildPerformanceInsights;
}): PerformancePlanSummary {
  if (params.plan.status !== "active") {
    return {
      plan: params.plan,
      progress: null,
      insights: buildTerminalPlanInsights(params.plan)
    };
  }
  const calculateProgress = params.calculateProgress ?? calculatePerformanceProgress;
  const buildInsights = params.buildInsights ?? buildPerformanceInsights;
  const progress = calculateProgress({
    plan: params.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  }).progress;
  return {
    plan: params.plan,
    progress,
    insights: buildInsights(progress)
  };
}

async function materializePlanIfEnded(params: BuildPerformancePlanDetailParams): Promise<PerformancePlanWithRelations | null> {
  const loaded = await params.store.getPlanById(params.planId);
  if (!loaded) {
    return null;
  }
  if (loaded.plan.status !== "active") {
    return loaded;
  }
  return await finalizePerformancePlanIfEnded({
    store: params.store,
    plan: loaded.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  });
}

function hasPlanEndBoundaryPassed(plan: PerformancePlan, now: Date): boolean {
  const window = buildPlanWindow({
    startDate: plan.startDate,
    endDate: plan.endDate,
    timeZone: plan.timeZone,
    effectiveAt: plan.effectiveAt
  });
  return now.getTime() >= new Date(window.planEndAt).getTime();
}

function normalizeScopeSelection(selection: PerformanceScopeSelectionRequest): PerformanceScopeSelectionRequest {
  return {
    allAssignedScenarios: selection.allAssignedScenarios === true,
    selectedFocusTopicIds: Array.isArray(selection.selectedFocusTopicIds) ? selection.selectedFocusTopicIds : [],
    selectedScenarioIds: Array.isArray(selection.selectedScenarioIds) ? selection.selectedScenarioIds : []
  };
}

function needsPerformanceBaseline(goal: PerformanceGoal): boolean {
  return goal.enabled === true && goal.metricType !== null && goal.metricType !== "target_average_score";
}

function toBaselinePreviewPayload(
  preview: PerformanceBaselinePreview
): PerformancePlanPreviewResponse["baselinePreview"] {
  return {
    baselineStartAt: preview.baselineStartAt,
    baselineEndAt: preview.baselineEndAt,
    eligibleScoreCount: preview.eligibleScoreCount,
    baselineAverage: preview.baselineAverage,
    derivedTargetScore: preview.derivedTargetScore,
    insufficientData: preview.insufficientData
  };
}

function buildAuditEvent(params: {
  id: string;
  plan: PerformancePlan;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  createdAt: string;
  oldValues?: Record<string, unknown> | null;
  newValues: Record<string, unknown>;
}): PerformanceAuditEvent {
  return {
    id: params.id,
    planId: params.plan.id,
    orgId: params.plan.orgId,
    userId: params.plan.userId,
    actorType: params.actorType,
    actorId: params.actorId,
    action: params.action,
    changedFields: ["plan"],
    oldValues: params.oldValues ?? null,
    newValues: params.newValues,
    reason: null,
    createdAt: params.createdAt
  };
}

function buildPerformanceAuditDisplayEvents(params: {
  events: PerformanceAuditEvent[];
  context: PerformanceAuditDisplayContext;
}): PerformanceAuditDisplayEvent[] {
  const userById = new Map(params.context.users.map((user) => [user.id, user]));
  return params.events.map((event) => {
    const actor = event.actorId ? userById.get(event.actorId) ?? null : null;
    const actorInfo = resolvePerformanceAuditActorLabel({
      event,
      actor,
      context: params.context
    });
    return {
      id: event.id,
      action: event.action,
      actionLabel: formatAuditActionLabel(event.action),
      actorLabel: actorInfo.actorLabel,
      actorRoleLabel: actorInfo.actorRoleLabel,
      actorEmail: actorInfo.actorEmail,
      occurredAt: event.createdAt,
      reason: event.reason
    };
  });
}

function resolvePerformanceAuditActorLabel(params: {
  event: PerformanceAuditEvent;
  actor: UserProfile | null;
  context: PerformanceAuditDisplayContext;
}): { actorLabel: string; actorRoleLabel: string; actorEmail: string | null } {
  const { event, actor, context } = params;
  if (event.actorType === "system") {
    return { actorLabel: "Peritio system", actorRoleLabel: "System", actorEmail: null };
  }

  if (context.viewer === "mobile_user") {
    if (event.actorType === "mobile_user" && event.actorId === context.currentUserId) {
      return { actorLabel: "you", actorRoleLabel: "Plan owner", actorEmail: null };
    }
    if (event.actorType === "platform_admin") {
      return { actorLabel: "Peritio administrator", actorRoleLabel: "Peritio administrator", actorEmail: null };
    }
    return { actorLabel: "your manager", actorRoleLabel: "Company manager", actorEmail: null };
  }

  if (!actor) {
    if (event.actorType === "platform_admin") {
      return { actorLabel: "Peritio administrator", actorRoleLabel: "Peritio administrator", actorEmail: null };
    }
    if (event.actorType === "mobile_user") {
      return { actorLabel: "Former user", actorRoleLabel: "Plan owner", actorEmail: null };
    }
    return { actorLabel: "Former account administrator", actorRoleLabel: "Company manager", actorEmail: null };
  }

  if (actor.isSuperUser === true || event.actorType === "platform_admin") {
    return {
      actorLabel: context.viewer === "platform_admin" ? actor.email : "Peritio administrator",
      actorRoleLabel: "Peritio administrator",
      actorEmail: context.viewer === "platform_admin" ? actor.email : null
    };
  }

  const sameOrg = actor.orgId === context.planOrgId;
  if (!sameOrg) {
    return { actorLabel: "Former account administrator", actorRoleLabel: "Company manager", actorEmail: null };
  }

  if (event.actorId === context.currentUserId) {
    return {
      actorLabel: "you",
      actorRoleLabel: formatAuditActorRoleLabel(actor),
      actorEmail: actor.email
    };
  }

  return {
    actorLabel: actor.email,
    actorRoleLabel: formatAuditActorRoleLabel(actor),
    actorEmail: actor.email
  };
}

function formatAuditActorRoleLabel(user: UserProfile): string {
  if (user.orgRole === "org_admin") {
    return "Company administrator";
  }
  if (user.orgRole === "user_admin") {
    return "User administrator";
  }
  return "Company user";
}

function formatAuditActionLabel(action: string): string {
  switch (action) {
    case "created":
      return "Created";
    case "updated":
      return "Updated";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Finalized";
    default:
      return action.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function uniqueErrors(errors: string[]): string[] {
  return Array.from(new Set(errors.map((error) => error.trim()).filter(Boolean)));
}

function buildTerminalPlanInsights(plan: PerformancePlan): PerformanceInsight[] {
  if (!plan.finalResult) {
    return [];
  }
  return [
    {
      status: "goal_ended",
      message:
        plan.status === "completed"
          ? "This Performance plan has been finalized."
          : "This Performance plan has been cancelled.",
      recommendedNextStep:
        plan.status === "completed"
          ? "Review the final result snapshot before assigning the next Focus Topic."
          : "Use the final snapshot to decide whether a new plan is needed.",
      metadata: {
        overallSucceeded: plan.finalResult.overallSucceeded,
        finalizedAt: plan.finalResult.finalizedAt
      }
    }
  ];
}

function buildDashboardPerformanceSummary(rows: DashboardPerformancePlanRow[]): DashboardPerformanceSummary {
  return {
    visibleUserCount: 0,
    activePlanCount: rows.filter((row) => row.plan.status === "active").length,
    completedPlanCount: rows.filter((row) => row.plan.status === "completed").length,
    cancelledPlanCount: rows.filter((row) => row.plan.status === "cancelled").length,
    activeOnTrackCount: rows.filter((row) => row.plan.status === "active" && row.progress?.overallCurrentlyMeetingTarget === true).length,
    activeNeedsAttentionCount: rows.filter((row) => row.plan.status === "active" && row.progress?.overallCurrentlyMeetingTarget === false).length
  };
}
