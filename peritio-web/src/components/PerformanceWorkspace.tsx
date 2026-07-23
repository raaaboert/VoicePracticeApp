"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  DashboardPerformancePlanDetailResponse,
  DashboardPerformancePlanRow,
  DashboardPerformanceUserOption,
  DashboardPerformanceWorkspaceResponse,
  CreatePerformancePlanUpdateResponse,
  PerformanceActivityMetricType,
  PerformanceGoalMetricType,
  PerformancePlan,
  PerformancePlanPreviewResponse,
} from "@voicepractice/shared";
import {
  buildPerformanceActivityLine,
  buildPerformanceDateRangeLabel,
  buildPerformanceDateStatusLabel,
  buildPerformanceOverallLine,
  buildPerformancePerformanceLine,
  buildPerformancePlanTitle,
  buildPerformanceScopeLabel,
  buildPerformanceStatusBadgeLabel,
  derivePerformancePlanPresentationStatus,
  groupPerformancePlanSummaries,
} from "@voicepractice/shared";

import { formatDate, formatDateTime } from "@/src/lib/formatters";

interface PerformanceWorkspaceProps {
  workspace: DashboardPerformanceWorkspaceResponse;
  divisionId: string | null;
}

type GoalMode = "activity" | "performance" | "both";

const ACTIVITY_METRICS: Array<{ value: PerformanceActivityMetricType; label: string }> = [
  { value: "weekly_practice_minutes", label: "Weekly practice minutes" },
  { value: "total_practice_minutes", label: "Total practice minutes" },
  { value: "weekly_session_count", label: "Weekly sessions" },
  { value: "total_session_count", label: "Total sessions" },
];

const PERFORMANCE_METRICS: Array<{ value: PerformanceGoalMetricType; label: string }> = [
  { value: "target_average_score", label: "Specific target average score" },
  { value: "improve_by_percent", label: "Percentage improvement" },
  { value: "improve_by_points", label: "Numeric score improvement" },
];

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysDateKey(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatNumber(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value * 10) / 10}${suffix}`;
}

function formatStatus(status: PerformancePlan["status"]): string {
  if (status === "completed") {
    return "Finalized";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getFocusTopicLabel(plan: PerformancePlan): string {
  const names = new Set<string>();
  for (const scenario of plan.scope.scenarios) {
    for (const topic of scenario.focusTopics) {
      names.add(topic.name);
    }
  }
  return Array.from(names).sort().join(", ") || "Assigned Focus Topic";
}

function formatActivityMetricLabel(metricType: PerformanceActivityMetricType | null): string {
  return ACTIVITY_METRICS.find((metric) => metric.value === metricType)?.label ?? "Activity";
}

function formatPerformanceMetricLabel(metricType: PerformanceGoalMetricType | null): string {
  return PERFORMANCE_METRICS.find((metric) => metric.value === metricType)?.label ?? "Performance";
}

async function postJson<T>(pathname: string, body: unknown): Promise<T> {
  const response = await fetch(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; errors?: string[] } | null;
    throw new Error(payload?.errors?.join(" ") || payload?.error || `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

async function patchJson<T>(pathname: string, body: unknown): Promise<T> {
  const response = await fetch(pathname, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; errors?: string[] } | null;
    throw new Error(payload?.errors?.join(" ") || payload?.error || `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

async function getJson<T>(pathname: string): Promise<T> {
  const response = await fetch(pathname, { method: "GET" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export function PerformanceWorkspace({ workspace, divisionId }: PerformanceWorkspaceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedUserId, setSelectedUserId] = useState(workspace.users[0]?.userId ?? "");
  const [goalMode, setGoalMode] = useState<GoalMode>("both");
  const [startDate, setStartDate] = useState(todayDateKey());
  const [endDate, setEndDate] = useState(addDaysDateKey(30));
  const [timeZone, setTimeZone] = useState(workspace.users[0]?.timeZone ?? workspace.defaultTimeZone);
  const [activityMetric, setActivityMetric] = useState<PerformanceActivityMetricType>("weekly_session_count");
  const [activityTarget, setActivityTarget] = useState("2");
  const [performanceMetric, setPerformanceMetric] = useState<PerformanceGoalMetricType>("target_average_score");
  const [targetScore, setTargetScore] = useState("85");
  const [improvementAmount, setImprovementAmount] = useState("10");
  const [comparisonMonths, setComparisonMonths] = useState<"1" | "2" | "3" | "6">("3");
  const [selectedFocusTopicIds, setSelectedFocusTopicIds] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [preview, setPreview] = useState<PerformancePlanPreviewResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [showPlanComposer, setShowPlanComposer] = useState(false);
  const [cancelingPlanId, setCancelingPlanId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DashboardPerformancePlanDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetailPlanId, setLoadingDetailPlanId] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => workspace.users.find((user) => user.userId === selectedUserId) ?? null,
    [selectedUserId, workspace.users],
  );
  const filteredScenarios = useMemo(() => {
    const query = scenarioSearch.trim().toLowerCase();
    const scenarios = selectedUser?.assignableScenarios ?? [];
    if (!query) {
      return scenarios;
    }
    return scenarios.filter(
      (scenario) =>
        scenario.displayName.toLowerCase().includes(query) ||
        scenario.segmentLabel?.toLowerCase().includes(query) ||
        scenario.focusTopics.some((topic) => topic.name.toLowerCase().includes(query)),
    );
  }, [scenarioSearch, selectedUser]);

  const groupedPlanRows = useMemo(
    () => groupPerformancePlanSummaries(workspace.plans, new Date(workspace.generatedAt)),
    [workspace.generatedAt, workspace.plans],
  );
  const canManageSelectedUser = selectedUser?.canManagePerformancePlans === true;
  const isEditing = editingPlanId !== null;

  if (workspace.scopeMode === "portfolio") {
    return (
      <div className="performance-stack">
        <section className="metric-grid">
          <div className="metric-card">
            <p className="metric-label">Visible users</p>
            <strong className="metric-value">{workspace.summary.visibleUserCount}</strong>
            <p className="metric-meta">Across customer accounts</p>
          </div>
          <div className="metric-card accent">
            <p className="metric-label">Active plans</p>
            <strong className="metric-value">{workspace.summary.activePlanCount}</strong>
            <p className="metric-meta">Across customer accounts</p>
          </div>
          <div className="metric-card warm">
            <p className="metric-label">Needs attention</p>
            <strong className="metric-value">{workspace.summary.activeNeedsAttentionCount}</strong>
            <p className="metric-meta">Open the company workspace to review details</p>
          </div>
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Portfolio</p>
              <h2>Customer Performance workspaces</h2>
              <p className="section-copy">Choose a company before creating, editing, or reviewing detailed Performance plans.</p>
            </div>
          </div>
          <div className="info-grid">
            {workspace.organizationSummaries.map((org) => (
              <article key={org.orgId} className="detail-card">
                <h3>{org.orgName}</h3>
                <dl className="inline-stats">
                  <div>
                    <dt>Active plans</dt>
                    <dd>{org.activePlanCount}</dd>
                  </div>
                  <div>
                    <dt>Needs attention</dt>
                    <dd>{org.activeNeedsAttentionCount}</dd>
                  </div>
                  <div>
                    <dt>Visible users</dt>
                    <dd>{org.visibleUserCount}</dd>
                  </div>
                </dl>
                <Link className="inline-link" href={`/app/customers/${encodeURIComponent(org.orgId)}/performance`}>
                  View company performance
                </Link>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  const clearPreview = () => {
    setPreview(null);
    setActionNotice(null);
  };

  const buildRequest = () => {
    const activityEnabled = goalMode === "activity" || goalMode === "both";
    const performanceEnabled = goalMode === "performance" || goalMode === "both";
    return {
      userId: selectedUserId,
      orgId: selectedUser?.orgId ?? null,
      startDate,
      endDate,
      timeZone,
      activityGoal: {
        enabled: activityEnabled,
        metricType: activityEnabled ? activityMetric : null,
        targetValue: activityEnabled ? Number(activityTarget) : null,
      },
      performanceGoal: {
        enabled: performanceEnabled,
        metricType: performanceEnabled ? performanceMetric : null,
        targetScore: performanceEnabled && performanceMetric === "target_average_score" ? Number(targetScore) : null,
        improvementAmount:
          performanceEnabled && performanceMetric !== "target_average_score" ? Number(improvementAmount) : null,
        comparisonMonthCount:
          performanceEnabled && performanceMetric !== "target_average_score" ? Number(comparisonMonths) as 1 | 2 | 3 | 6 : null,
      },
      scopeSelection: {
        allAssignedScenarios: false,
        selectedFocusTopicIds,
        selectedScenarioIds,
      },
    };
  };

  const querySuffix = divisionId ? `?divisionId=${encodeURIComponent(divisionId)}` : "";

  const runPreview = async () => {
    setIsPreviewing(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const payload = await postJson<PerformancePlanPreviewResponse>(`/api/performance/preview${querySuffix}`, buildRequest());
      setPreview(payload);
      setActionNotice(payload.valid ? "Preview is valid." : null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not preview Performance plan.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const savePlan = async () => {
    setIsSaving(true);
    setActionError(null);
    setActionNotice(null);
    try {
      if (editingPlanId) {
        await patchJson(`/api/performance/plans/${encodeURIComponent(editingPlanId)}${querySuffix}`, buildRequest());
        setActionNotice("Performance plan updated.");
        setEditingPlanId(null);
      } else {
        await postJson(`/api/performance/plans${querySuffix}`, buildRequest());
        setActionNotice("Performance plan created.");
      }
      setShowPlanComposer(false);
      startTransition(() => router.refresh());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save Performance plan.");
    } finally {
      setIsSaving(false);
    }
  };

  const editPlan = (row: DashboardPerformancePlanRow) => {
    const plan = row.plan;
    setEditingPlanId(plan.id);
    setSelectedUserId(plan.userId);
    setStartDate(plan.startDate);
    setEndDate(plan.endDate);
    setTimeZone(plan.timeZone);
    setGoalMode(plan.activityGoal.enabled && plan.performanceGoal.enabled ? "both" : plan.activityGoal.enabled ? "activity" : "performance");
    setActivityMetric(plan.activityGoal.metricType ?? "weekly_session_count");
    setActivityTarget(plan.activityGoal.targetValue === null ? "" : String(plan.activityGoal.targetValue));
    setPerformanceMetric(plan.performanceGoal.metricType ?? "target_average_score");
    setTargetScore(plan.performanceGoal.targetScore === null ? "" : String(plan.performanceGoal.targetScore));
    setImprovementAmount(plan.performanceGoal.improvementAmount === null ? "" : String(plan.performanceGoal.improvementAmount));
    setComparisonMonths(String(plan.performanceGoal.comparisonMonthCount ?? 3) as "1" | "2" | "3" | "6");
    setSelectedFocusTopicIds(plan.scope.selectedFocusTopicIds);
    setSelectedScenarioIds(plan.scope.selectedScenarioIds);
    setScenarioSearch("");
    setPreview(null);
    setActionError(null);
    setActionNotice("Editing active Performance plan.");
    setShowPlanComposer(true);
  };

  const cancelEdit = () => {
    setEditingPlanId(null);
    setPreview(null);
    setActionError(null);
    setActionNotice(null);
    setShowPlanComposer(false);
  };

  const cancelPlan = async (planId: string) => {
    const confirmed = window.confirm("Cancel this Performance plan? It will move to History, and progress, Updates, and plan activity will be retained.");
    if (!confirmed) {
      return;
    }
    setCancelingPlanId(planId);
    setActionError(null);
    setActionNotice(null);
    try {
      const payload = await postJson<{ cancelled: boolean; finalizedInstead: boolean }>(
        `/api/performance/plans/${encodeURIComponent(planId)}/cancel${querySuffix}`,
        { reason: "Cancelled from dashboard." },
      );
      setActionNotice(payload.finalizedInstead ? "Performance plan finalized." : "Performance plan cancelled.");
      startTransition(() => router.refresh());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not cancel Performance plan.");
    } finally {
      setCancelingPlanId(null);
    }
  };

  const openPlanDetail = async (planId: string) => {
    setDetailError(null);
    setLoadingDetailPlanId(planId);
    try {
      const payload = await getJson<DashboardPerformancePlanDetailResponse>(
        `/api/performance/plans/${encodeURIComponent(planId)}${querySuffix}`,
      );
      setDetail(payload);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not load Performance plan detail.");
    } finally {
      setLoadingDetailPlanId(null);
    }
  };

  const toggle = (value: string, values: string[], setValues: (next: string[]) => void) => {
    setValues(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
    clearPreview();
  };

  return (
    <div className="performance-stack">
      <section className="metric-grid">
        <div className="metric-card">
          <p className="metric-label">Visible users</p>
          <strong className="metric-value">{workspace.summary.visibleUserCount}</strong>
          <p className="metric-meta">Users in the current dashboard scope</p>
        </div>
        <div className="metric-card accent">
          <p className="metric-label">Active plans</p>
          <strong className="metric-value">{workspace.summary.activePlanCount}</strong>
          <p className="metric-meta">{workspace.summary.activeOnTrackCount} currently on track</p>
        </div>
        <div className="metric-card positive">
          <p className="metric-label">Finalized</p>
          <strong className="metric-value">{workspace.summary.completedPlanCount}</strong>
          <p className="metric-meta">Completed final snapshots</p>
        </div>
        <div className="metric-card warm">
          <p className="metric-label">Needs attention</p>
          <strong className="metric-value">{workspace.summary.activeNeedsAttentionCount}</strong>
          <p className="metric-meta">Active plans below current target</p>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Performance plans</p>
            <h2>Create or edit a plan</h2>
            <p className="section-copy">Use a focused composer when assigning or updating a Performance plan.</p>
          </div>
          <button type="button" className="primary-button" onClick={() => {
            setEditingPlanId(null);
            setPreview(null);
            setActionError(null);
            setActionNotice(null);
            setShowPlanComposer(true);
          }}>
            Create plan
          </button>
        </div>
        {actionNotice ? <p className="small-copy">{actionNotice}</p> : null}
      </section>

      {showPlanComposer ? (
        <div className="performance-modal-backdrop" role="presentation">
          <section className="section-card performance-composer-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">{isEditing ? "Edit" : "Create"}</p>
            <h2>{isEditing ? "Edit active Performance plan" : "Assign a Performance plan"}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={cancelEdit}>Close</button>
        </div>

        {workspace.users.length === 0 ? (
          <div className="empty-state-panel">
            <h3>No users in scope</h3>
            <p>Performance plans can be assigned after users are available in this dashboard scope.</p>
          </div>
        ) : (
          <div className="performance-form-grid">
            <label className="field-label">
              User
              <select className="text-input" value={selectedUserId} onChange={(event) => {
                const nextUserId = event.target.value;
                const nextUser = workspace.users.find((user) => user.userId === nextUserId) ?? null;
                setSelectedUserId(nextUserId);
                setTimeZone(nextUser?.timeZone ?? workspace.defaultTimeZone);
                setSelectedFocusTopicIds([]);
                setSelectedScenarioIds([]);
                setEditingPlanId(null);
                clearPreview();
              }}>
                {workspace.users.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.email} - {user.orgName} ({user.activePlanCount} active)
                  </option>
                ))}
              </select>
            </label>

            <label className="field-label">
              Start date
              <input className="text-input" type="date" value={startDate} onChange={(event) => {
                setStartDate(event.target.value);
                clearPreview();
              }} />
            </label>

            <label className="field-label">
              End date
              <input className="text-input" type="date" value={endDate} onChange={(event) => {
                setEndDate(event.target.value);
                clearPreview();
              }} />
            </label>

            <label className="field-label">
              Timezone
              <input className="text-input" value={timeZone} onChange={(event) => {
                setTimeZone(event.target.value);
                clearPreview();
              }} />
            </label>

            <label className="field-label">
              Goal type
              <select className="text-input" value={goalMode} onChange={(event) => {
                setGoalMode(event.target.value as GoalMode);
                clearPreview();
              }}>
                <option value="both">Performance and activity</option>
                <option value="performance">Performance only</option>
                <option value="activity">Activity only</option>
              </select>
            </label>

            {goalMode !== "performance" ? (
              <>
                <label className="field-label">
                  Activity goal
                  <select className="text-input" value={activityMetric} onChange={(event) => {
                    setActivityMetric(event.target.value as PerformanceActivityMetricType);
                    clearPreview();
                  }}>
                    {ACTIVITY_METRICS.map((metric) => (
                      <option key={metric.value} value={metric.value}>{metric.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Activity target
                  <input className="text-input" inputMode="decimal" value={activityTarget} onChange={(event) => {
                    setActivityTarget(event.target.value);
                    clearPreview();
                  }} />
                </label>
              </>
            ) : null}

            {goalMode !== "activity" ? (
              <>
                <label className="field-label">
                  Performance target
                  <select className="text-input" value={performanceMetric} onChange={(event) => {
                    setPerformanceMetric(event.target.value as PerformanceGoalMetricType);
                    clearPreview();
                  }}>
                    {PERFORMANCE_METRICS.map((metric) => (
                      <option key={metric.value} value={metric.value}>{metric.label}</option>
                    ))}
                  </select>
                </label>
                {performanceMetric === "target_average_score" ? (
                  <label className="field-label">
                    Target score
                    <input className="text-input" inputMode="decimal" value={targetScore} onChange={(event) => {
                      setTargetScore(event.target.value);
                      clearPreview();
                    }} />
                  </label>
                ) : (
                  <>
                    <label className="field-label">
                      Improvement amount
                      <input className="text-input" inputMode="decimal" value={improvementAmount} onChange={(event) => {
                        setImprovementAmount(event.target.value);
                        clearPreview();
                      }} />
                    </label>
                    <label className="field-label">
                      Compare against
                      <select className="text-input" value={comparisonMonths} onChange={(event) => {
                        setComparisonMonths(event.target.value as "1" | "2" | "3" | "6");
                        clearPreview();
                      }}>
                        <option value="1">Previous 1 month</option>
                        <option value="2">Previous 2 months</option>
                        <option value="3">Previous 3 months</option>
                        <option value="6">Previous 6 months</option>
                      </select>
                    </label>
                  </>
                )}
              </>
            ) : null}

            <div className="performance-wide-field">
              <p className="field-label">Focus Topics</p>
              <div className="checkbox-grid">
                {(selectedUser?.assignableFocusTopics ?? []).map((topic) => (
                  <label key={topic.id} className="checkbox-card">
                    <input
                      type="checkbox"
                      checked={selectedFocusTopicIds.includes(topic.id)}
                      onChange={() => toggle(topic.id, selectedFocusTopicIds, setSelectedFocusTopicIds)}
                    />
                    <span>{topic.name}</span>
                    <small>{topic.scenarioCount} scenario{topic.scenarioCount === 1 ? "" : "s"}</small>
                  </label>
                ))}
              </div>
            </div>

            <div className="performance-wide-field">
              <label className="field-label">
                Scenario search
                <input className="text-input" value={scenarioSearch} onChange={(event) => setScenarioSearch(event.target.value)} />
              </label>
              <div className="checkbox-grid">
                {filteredScenarios.map((scenario) => (
                  <label key={scenario.scenarioId} className="checkbox-card">
                    <input
                      type="checkbox"
                      checked={selectedScenarioIds.includes(scenario.scenarioId)}
                      onChange={() => toggle(scenario.scenarioId, selectedScenarioIds, setSelectedScenarioIds)}
                    />
                    <span>{scenario.displayName}</span>
                    <small>{scenario.segmentLabel ?? "Role"} | {scenario.focusTopics.map((topic) => topic.name).join(", ")}</small>
                  </label>
                ))}
              </div>
            </div>

            <div className="performance-wide-field action-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void runPreview(); }}
                disabled={isPreviewing || isSaving || !canManageSelectedUser}
              >
                {isPreviewing ? "Previewing..." : "Preview"}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => { void savePlan(); }}
                disabled={isSaving || isPreviewing || !canManageSelectedUser}
              >
                {isSaving ? "Saving..." : isEditing ? "Save Changes" : "Create Plan"}
              </button>
              {isEditing ? (
                <button type="button" className="ghost-button" onClick={cancelEdit} disabled={isSaving || isPreviewing}>
                  Cancel Edit
                </button>
              ) : null}
              {selectedUser && !canManageSelectedUser ? <span className="pill">Management access required</span> : null}
            </div>
          </div>
        )}

        {actionError ? <p className="form-error">{actionError}</p> : null}
        {actionNotice ? <p className="small-copy">{actionNotice}</p> : null}
        {preview ? (
          <div className="preview-panel">
            <span className={preview.valid ? "pill accent" : "pill"}>{preview.valid ? "Valid preview" : "Needs changes"}</span>
            {preview.errors.length > 0 ? (
              <ul className="bullet-list">
                {preview.errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            ) : null}
            <p className="small-copy">
              Scope: {preview.scope?.scenarios.map((scenario) => scenario.displayName).join(", ") || "-"}
            </p>
            {preview.baselinePreview ? (
              <p className="small-copy">
                Baseline: {formatNumber(preview.baselinePreview.baselineAverage)} from {preview.baselinePreview.eligibleScoreCount} scored attempts;
                target {formatNumber(preview.baselinePreview.derivedTargetScore)}.
              </p>
            ) : null}
          </div>
        ) : null}
          </section>
        </div>
      ) : null}

      {detailError ? <p className="form-error">{detailError}</p> : null}
      {detail ? <PlanDetailPanel detail={detail} querySuffix={querySuffix} onDetailChange={setDetail} /> : null}

      <PlanTable
        title="Active plans"
        rows={groupedPlanRows.active}
        emptyMessage="No active Performance plans in this scope."
        cancelingPlanId={cancelingPlanId}
        isPending={isPending}
        onCancel={cancelPlan}
        loadingDetailPlanId={loadingDetailPlanId}
        onOpenDetail={openPlanDetail}
        onEdit={editPlan}
      />
      <PlanTable
        title="Scheduled plans"
        rows={groupedPlanRows.scheduled}
        emptyMessage="No scheduled Performance plans in this scope."
        cancelingPlanId={cancelingPlanId}
        isPending={isPending}
        onCancel={cancelPlan}
        loadingDetailPlanId={loadingDetailPlanId}
        onOpenDetail={openPlanDetail}
        onEdit={editPlan}
      />
      <PlanTable
        title="History"
        rows={groupedPlanRows.history}
        emptyMessage="No finalized or cancelled Performance plans in this scope."
        cancelingPlanId={cancelingPlanId}
        isPending={isPending}
        onCancel={cancelPlan}
        loadingDetailPlanId={loadingDetailPlanId}
        onOpenDetail={openPlanDetail}
        onEdit={editPlan}
      />
    </div>
  );
}

function PlanDetailPanel({
  detail,
  querySuffix,
  onDetailChange,
}: {
  detail: DashboardPerformancePlanDetailResponse;
  querySuffix: string;
  onDetailChange: (detail: DashboardPerformancePlanDetailResponse) => void;
}) {
  const row = detail.plan;
  const plan = row.plan;
  const [updateBody, setUpdateBody] = useState("");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isPostingUpdate, setIsPostingUpdate] = useState(false);
  const presentationStatus = derivePerformancePlanPresentationStatus(plan);
  const canPostUpdate = presentationStatus === "active" || presentationStatus === "scheduled";

  const postUpdate = async () => {
    setIsPostingUpdate(true);
    setUpdateError(null);
    try {
      const payload = await postJson<CreatePerformancePlanUpdateResponse>(
        `/api/performance/plans/${encodeURIComponent(plan.id)}/updates${querySuffix}`,
        { body: updateBody },
      );
      onDetailChange({ ...detail, updates: [...detail.updates, payload.update] });
      setUpdateBody("");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Could not post update.");
    } finally {
      setIsPostingUpdate(false);
    }
  };

  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Plan detail</p>
          <h2>{buildPerformancePlanTitle(plan)}</h2>
          <p className="small-copy">
            {row.userEmail} | {buildPerformanceScopeLabel(plan)} | {buildPerformanceDateRangeLabel(plan)}
          </p>
        </div>
        <span className="pill">{buildPerformanceStatusBadgeLabel(plan)}</span>
      </div>

      <div className="preview-panel">
        <p className="small-copy">
          <strong>Overall:</strong> {buildPerformanceOverallLine(plan, row.progress)}
        </p>
        <p className="small-copy">
          Scope: {plan.scope.scenarios.map((scenario) => scenario.displayName).join(", ")}
        </p>
        <p className="small-copy">
          Activity: {buildPerformanceActivityLine(plan, row.progress) ?? "None"}
        </p>
        <p className="small-copy">
          Performance: {buildPerformancePerformanceLine(plan, row.progress) ?? "None"}
        </p>
        {plan.baseline ? (
          <p className="small-copy">
            Baseline: {formatNumber(plan.baseline.baselineAverage)} from {plan.baseline.baselineSessionCount} scored attempts.
          </p>
        ) : null}
        {row.progress ? (
          <p className="small-copy">
            Current progress: {row.progress.overallCurrentlyMeetingTarget ? "On track" : "Needs attention"}.
          </p>
        ) : null}
        {plan.finalResult ? (
          <p className="small-copy">
            Final result: {plan.finalResult.overallSucceeded ? "met" : "not met"} with {plan.finalResult.sessionsCompleted} sessions and {formatNumber(plan.finalResult.finalAverageScore)} average score.
          </p>
        ) : null}
      </div>

      {row.insights.length > 0 ? (
        <ul className="bullet-list">
          {row.insights.map((insight, index) => (
            <li key={`${insight.status}_${index}`}>
              <strong>{insight.status.replace(/_/g, " ")}:</strong> {insight.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="preview-panel">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Updates</p>
            <h3>Plan discussion</h3>
          </div>
        </div>
        {canPostUpdate ? (
          <div className="performance-update-form">
            <textarea
              className="text-input"
              value={updateBody}
              onChange={(event) => setUpdateBody(event.target.value)}
              placeholder="Write an update..."
              maxLength={2000}
              rows={4}
            />
            {updateError ? <p className="form-error">{updateError}</p> : null}
            <button
              type="button"
              className="primary-button"
              disabled={isPostingUpdate || !updateBody.trim()}
              onClick={() => { void postUpdate(); }}
            >
              {isPostingUpdate ? "Posting..." : "Post Update"}
            </button>
          </div>
        ) : (
          <p className="small-copy">Updates are read-only after a plan moves to History.</p>
        )}
        {detail.updates.length === 0 ? (
          <p className="small-copy">No updates yet.</p>
        ) : (
          <div className="performance-update-list">
            {detail.updates.map((update) => (
              <article key={update.id} className="detail-card">
                <h3>{update.authorDisplayName}</h3>
                <p>{update.body}</p>
                <p className="small-copy">{formatDateTime(update.createdAt)}</p>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Audit action</th>
              <th>Actor</th>
              <th>Role</th>
              <th>Reason</th>
              <th>At</th>
            </tr>
          </thead>
          <tbody>
            {detail.auditEvents.map((event) => (
              <tr key={event.id}>
                <td>{event.actionLabel}</td>
                <td>{event.actorLabel}</td>
                <td>{event.actorRoleLabel}</td>
                <td>{event.reason ?? "-"}</td>
                <td>{formatDate(event.occurredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlanTable({
  title,
  rows,
  emptyMessage,
  cancelingPlanId,
  isPending,
  onCancel,
  loadingDetailPlanId,
  onOpenDetail,
  onEdit,
}: {
  title: string;
  rows: DashboardPerformancePlanRow[];
  emptyMessage: string;
  cancelingPlanId: string | null;
  isPending: boolean;
  onCancel: (planId: string) => Promise<void>;
  loadingDetailPlanId: string | null;
  onOpenDetail: (planId: string) => Promise<void>;
  onEdit: (row: DashboardPerformancePlanRow) => void;
}) {
  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Plans</p>
          <h2>{title}</h2>
        </div>
        <span className="pill">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state-panel">
          <h3>{emptyMessage}</h3>
          <p>Performance plan rows appear here when they exist in the selected dashboard scope.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Focus Topic</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Final Result</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.plan.id}>
                  <td>
                    <strong>{row.userEmail}</strong>
                    <p className="table-subcopy">{row.orgName}{row.divisionName ? ` | ${row.divisionName}` : ""}</p>
                  </td>
                  <td>
                    {buildPerformancePlanTitle(row.plan)}
                    <p className="table-subcopy">{buildPerformanceScopeLabel(row.plan)}</p>
                    <p className="table-subcopy">{row.plan.scope.scenarios.length} scenario{row.plan.scope.scenarios.length === 1 ? "" : "s"}</p>
                  </td>
                  <td>
                    {buildPerformanceDateRangeLabel(row.plan)}
                    <p className="table-subcopy">{buildPerformanceDateStatusLabel(row.plan)}</p>
                  </td>
                  <td><span className="pill">{buildPerformanceStatusBadgeLabel(row.plan)}</span></td>
                  <td>
                    {row.progress ? (
                      <>
                        <strong>{buildPerformanceOverallLine(row.plan, row.progress)}</strong>
                        <p className="table-subcopy">{buildPerformanceActivityLine(row.plan, row.progress) ?? "No activity goal"}</p>
                        <p className="table-subcopy">{buildPerformancePerformanceLine(row.plan, row.progress) ?? "No performance goal"}</p>
                      </>
                    ) : "-"}
                  </td>
                  <td>
                    {row.plan.finalResult ? (
                      <>
                        <strong>{row.plan.finalResult.overallSucceeded ? "Met" : "Not met"}</strong>
                        <p className="table-subcopy">
                          {row.plan.finalResult.sessionsCompleted} sessions | {formatNumber(row.plan.finalResult.finalAverageScore)} avg
                        </p>
                      </>
                    ) : "-"}
                  </td>
                  <td>
                    <div className="action-row">
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={loadingDetailPlanId === row.plan.id}
                        onClick={() => { void onOpenDetail(row.plan.id); }}
                      >
                        {loadingDetailPlanId === row.plan.id ? "Loading..." : "View"}
                      </button>
                      {row.canCancel ? (
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={isPending || cancelingPlanId === row.plan.id}
                          onClick={() => { void onCancel(row.plan.id); }}
                        >
                          {cancelingPlanId === row.plan.id ? "Cancelling..." : "Cancel plan"}
                        </button>
                      ) : row.plan.status === "active" ? (
                        <span className="pill">Read only</span>
                      ) : null}
                      {row.canEdit ? (
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={isPending}
                          onClick={() => onEdit(row)}
                        >
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
