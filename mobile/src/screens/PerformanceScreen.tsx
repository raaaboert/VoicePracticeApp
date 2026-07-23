import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  CreatePerformancePlanRequest,
  MobilePerformanceCurrentResponse,
  MobilePerformancePlanOptionsResponse,
  MobilePerformancePlanDetailResponse,
  MobilePerformancePlanHistoryResponse,
  PerformanceActivityMetricType,
  PerformanceGoalMetricType,
  PerformancePlan,
  PerformancePlanPreviewResponse,
  PerformanceProgress,
} from "@voicepractice/shared";

import {
  createPerformancePlan,
  fetchCurrentPerformancePlan,
  fetchPerformancePlanOptions,
  fetchPerformancePlanDetail,
  fetchPerformancePlanHistory,
  previewPerformancePlan,
} from "../lib/api";
import { formatPerformanceDate, getRemainingPerformancePlanDays } from "../lib/performanceDateFormatting";

interface PerformanceScreenProps {
  userId: string;
  authToken: string;
  onBack: () => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";
type GoalMode = "activity" | "performance" | "both";

const ACTIVITY_METRICS: Array<{ value: PerformanceActivityMetricType; label: string }> = [
  { value: "weekly_practice_minutes", label: "Weekly minutes" },
  { value: "total_practice_minutes", label: "Total minutes" },
  { value: "weekly_session_count", label: "Weekly sessions" },
  { value: "total_session_count", label: "Total sessions" },
];

const PERFORMANCE_METRICS: Array<{ value: PerformanceGoalMetricType; label: string }> = [
  { value: "target_average_score", label: "Target score" },
  { value: "improve_by_percent", label: "Percent improvement" },
  { value: "improve_by_points", label: "Point improvement" },
];

function dateKeyFromLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayDateKey(): string {
  return dateKeyFromLocalDate(new Date());
}

function addDaysDateKey(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateKeyFromLocalDate(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function formatNumber(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value * 10) / 10}${suffix}`;
}

function formatActivityMetric(metric: PerformancePlan["activityGoal"]["metricType"]): string {
  switch (metric) {
    case "weekly_practice_minutes":
      return "Weekly practice minutes";
    case "total_practice_minutes":
      return "Total practice minutes";
    case "weekly_session_count":
      return "Weekly sessions";
    case "total_session_count":
      return "Total sessions";
    default:
      return "Activity";
  }
}

function formatPerformanceMetric(metric: PerformancePlan["performanceGoal"]["metricType"]): string {
  switch (metric) {
    case "target_average_score":
      return "Target average score";
    case "improve_by_points":
      return "Score-point improvement";
    case "improve_by_percent":
      return "Percentage improvement";
    default:
      return "Performance";
  }
}

function formatPlanStatus(status: PerformancePlan["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "completed":
      return "Finalized";
    case "cancelled":
      return "Cancelled";
  }
}

function getFocusTopicNames(plan: PerformancePlan): string[] {
  const names = new Set<string>();
  for (const scenario of plan.scope.scenarios) {
    for (const topic of scenario.focusTopics) {
      names.add(topic.name);
    }
  }
  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function getRemainingDays(plan: PerformancePlan): number | null {
  return getRemainingPerformancePlanDays(plan.endDate);
}

function getMobilePlanAttribution(plan: PerformancePlan, userId: string): string {
  return plan.createdByActorType === "mobile_user" && plan.createdByActorId === userId
    ? "Created by you"
    : "Assigned by your manager";
}

function progressRatio(actual: number, target: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, actual / target));
}

function ProgressBar({ ratio }: { ratio: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
    </View>
  );
}

function PlanSummaryCard({
  plan,
  progress,
  attribution,
  onOpen,
}: {
  plan: PerformancePlan;
  progress: PerformanceProgress | null;
  attribution?: string;
  onOpen?: () => void;
}) {
  const focusTopics = getFocusTopicNames(plan);
  const remainingDays = plan.status === "active" ? getRemainingDays(plan) : null;
  const Wrapper = onOpen ? Pressable : View;

  return (
    <Wrapper style={styles.card} onPress={onOpen}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>Performance Plan</Text>
          <Text style={styles.title}>{focusTopics.join(", ") || "Assigned Focus Topic"}</Text>
        </View>
        <View style={[styles.statusPill, plan.status === "active" ? styles.statusActive : styles.statusMuted]}>
          <Text style={styles.statusText}>{formatPlanStatus(plan.status)}</Text>
        </View>
      </View>

      <Text style={styles.body}>
        {formatPerformanceDate(plan.startDate)} to {formatPerformanceDate(plan.endDate)}
        {remainingDays !== null ? ` | ${remainingDays} day${remainingDays === 1 ? "" : "s"} left` : ""}
      </Text>

      <Text style={styles.body}>
        Scope: {plan.scope.scenarios.map((scenario) => scenario.displayName).join(", ")}
      </Text>
      {attribution ? <Text style={styles.subtle}>{attribution}</Text> : null}

      {plan.baseline ? (
        <Text style={styles.body}>
          Baseline: {formatNumber(plan.baseline.baselineAverage)} average from {plan.baseline.baselineSessionCount} scored attempts; target {formatNumber(plan.baseline.derivedTargetScore)}.
        </Text>
      ) : null}

      {progress?.activity.enabled ? (
        <View style={styles.metricBlock}>
          <Text style={styles.metricLabel}>{formatActivityMetric(progress.activity.metricType)}</Text>
          <Text style={styles.metricValue}>
            {formatNumber(progress.activity.actualValue)} / {formatNumber(progress.activity.cumulativeTargetValue)}
          </Text>
          <ProgressBar ratio={progressRatio(progress.activity.actualValue, progress.activity.cumulativeTargetValue)} />
        </View>
      ) : null}

      {progress?.performance.enabled ? (
        <View style={styles.metricBlock}>
          <Text style={styles.metricLabel}>{formatPerformanceMetric(progress.performance.metricType)}</Text>
          <Text style={styles.metricValue}>
            {formatNumber(progress.performance.currentAverage)} / {formatNumber(progress.performance.targetScore)}
          </Text>
          <ProgressBar ratio={progressRatio(progress.performance.currentAverage ?? 0, progress.performance.targetScore ?? 100)} />
        </View>
      ) : null}
    </Wrapper>
  );
}

function FinalResultBlock({ plan }: { plan: PerformancePlan }) {
  if (!plan.finalResult) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Final Result</Text>
      <Text style={styles.title}>{plan.finalResult.overallSucceeded ? "Goal met" : "Goal not met"}</Text>
      <Text style={styles.body}>Finalized {formatPerformanceDate(plan.finalResult.finalizedAt)}</Text>
      <View style={styles.statGrid}>
        <View style={styles.statBox}>
          <Text style={styles.metricLabel}>Average</Text>
          <Text style={styles.metricValue}>{formatNumber(plan.finalResult.finalAverageScore)}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.metricLabel}>Sessions</Text>
          <Text style={styles.metricValue}>{plan.finalResult.sessionsCompleted}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.metricLabel}>Minutes</Text>
          <Text style={styles.metricValue}>{formatNumber(plan.finalResult.totalPracticeSeconds / 60)}</Text>
        </View>
      </View>
    </View>
  );
}

function OptionChip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.chip, selected ? styles.chipSelected : null, disabled ? styles.disabled : null]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

function PerformanceCreateForm({
  userId,
  options,
  authToken,
  onCreated,
  onCancel,
}: {
  userId: string;
  options: MobilePerformancePlanOptionsResponse | null;
  authToken: string;
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const [goalMode, setGoalMode] = useState<GoalMode>("both");
  const [startDate, setStartDate] = useState(todayDateKey());
  const [endDate, setEndDate] = useState(addDaysDateKey(30));
  const [activityMetric, setActivityMetric] = useState<PerformanceActivityMetricType>("weekly_session_count");
  const [activityTarget, setActivityTarget] = useState("2");
  const [performanceMetric, setPerformanceMetric] = useState<PerformanceGoalMetricType>("target_average_score");
  const [targetScore, setTargetScore] = useState("85");
  const [improvementAmount, setImprovementAmount] = useState("10");
  const [comparisonMonths, setComparisonMonths] = useState<"1" | "2" | "3" | "6">("3");
  const [selectedFocusTopicIds, setSelectedFocusTopicIds] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<PerformancePlanPreviewResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const defaultTimeZone = options?.defaultTimeZone ?? "UTC";
  const hasOptions = Boolean((options?.availableFocusTopics.length ?? 0) > 0 || (options?.availableScenarios.length ?? 0) > 0);

  const clearPreview = () => {
    setPreview(null);
    setFormError(null);
  };

  const toggle = (value: string, values: string[], setValues: (next: string[]) => void) => {
    setValues(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
    clearPreview();
  };

  const buildRequest = (): CreatePerformancePlanRequest => {
    const activityEnabled = goalMode === "activity" || goalMode === "both";
    const performanceEnabled = goalMode === "performance" || goalMode === "both";
    return {
      userId,
      orgId: null,
      startDate,
      endDate,
      timeZone: defaultTimeZone,
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

  const runPreview = async () => {
    setIsPreviewing(true);
    setFormError(null);
    try {
      const payload = await previewPerformancePlan(userId, buildRequest(), authToken);
      setPreview(payload);
    } catch (caught) {
      setFormError(getErrorMessage(caught, "Could not preview this Performance plan."));
      setPreview(null);
    } finally {
      setIsPreviewing(false);
    }
  };

  const runCreate = async () => {
    setIsSaving(true);
    setFormError(null);
    try {
      await createPerformancePlan(userId, buildRequest(), authToken);
      await onCreated();
    } catch (caught) {
      setFormError(getErrorMessage(caught, "Could not create this Performance plan."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>Create Plan</Text>
          <Text style={styles.title}>Set your next Focus Topic</Text>
        </View>
        <Pressable style={styles.smallButton} onPress={onCancel}>
          <Text style={styles.smallButtonText}>Close</Text>
        </Pressable>
      </View>

      {!hasOptions ? (
        <Text style={styles.body}>No eligible Focus Topics are assigned to your account yet.</Text>
      ) : (
        <>
          <View style={styles.formRow}>
            <View style={styles.formField}>
              <Text style={styles.metricLabel}>Start date</Text>
              <TextInput
                style={styles.textInput}
                value={startDate}
                onChangeText={(value) => {
                  setStartDate(value);
                  clearPreview();
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#7d877a"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.metricLabel}>End date</Text>
              <TextInput
                style={styles.textInput}
                value={endDate}
                onChangeText={(value) => {
                  setEndDate(value);
                  clearPreview();
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#7d877a"
                autoCapitalize="none"
              />
            </View>
          </View>

          <Text style={styles.metricLabel}>Goal type</Text>
          <View style={styles.chipRow}>
            <OptionChip label="Both" selected={goalMode === "both"} onPress={() => { setGoalMode("both"); clearPreview(); }} />
            <OptionChip label="Performance" selected={goalMode === "performance"} onPress={() => { setGoalMode("performance"); clearPreview(); }} />
            <OptionChip label="Activity" selected={goalMode === "activity"} onPress={() => { setGoalMode("activity"); clearPreview(); }} />
          </View>

          {goalMode !== "performance" ? (
            <>
              <Text style={styles.metricLabel}>Activity goal</Text>
              <View style={styles.chipRow}>
                {ACTIVITY_METRICS.map((metric) => (
                  <OptionChip
                    key={metric.value}
                    label={metric.label}
                    selected={activityMetric === metric.value}
                    onPress={() => { setActivityMetric(metric.value); clearPreview(); }}
                  />
                ))}
              </View>
              <TextInput
                style={styles.textInput}
                value={activityTarget}
                onChangeText={(value) => {
                  setActivityTarget(value);
                  clearPreview();
                }}
                keyboardType="decimal-pad"
                placeholder="Activity target"
                placeholderTextColor="#7d877a"
              />
            </>
          ) : null}

          {goalMode !== "activity" ? (
            <>
              <Text style={styles.metricLabel}>Performance goal</Text>
              <View style={styles.chipRow}>
                {PERFORMANCE_METRICS.map((metric) => (
                  <OptionChip
                    key={metric.value}
                    label={metric.label}
                    selected={performanceMetric === metric.value}
                    onPress={() => { setPerformanceMetric(metric.value); clearPreview(); }}
                  />
                ))}
              </View>
              {performanceMetric === "target_average_score" ? (
                <TextInput
                  style={styles.textInput}
                  value={targetScore}
                  onChangeText={(value) => {
                    setTargetScore(value);
                    clearPreview();
                  }}
                  keyboardType="decimal-pad"
                  placeholder="Target score"
                  placeholderTextColor="#7d877a"
                />
              ) : (
                <>
                  <TextInput
                    style={styles.textInput}
                    value={improvementAmount}
                    onChangeText={(value) => {
                      setImprovementAmount(value);
                      clearPreview();
                    }}
                    keyboardType="decimal-pad"
                    placeholder="Improvement amount"
                    placeholderTextColor="#7d877a"
                  />
                  <Text style={styles.metricLabel}>Comparison window</Text>
                  <View style={styles.chipRow}>
                    {(["1", "2", "3", "6"] as const).map((monthCount) => (
                      <OptionChip
                        key={monthCount}
                        label={`${monthCount} mo`}
                        selected={comparisonMonths === monthCount}
                        onPress={() => { setComparisonMonths(monthCount); clearPreview(); }}
                      />
                    ))}
                  </View>
                </>
              )}
            </>
          ) : null}

          <Text style={styles.metricLabel}>Focus Topics</Text>
          <View style={styles.chipRow}>
            {(options?.availableFocusTopics ?? []).map((topic) => (
              <OptionChip
                key={topic.id}
                label={`${topic.name} (${topic.scenarioCount})`}
                selected={selectedFocusTopicIds.includes(topic.id)}
                onPress={() => toggle(topic.id, selectedFocusTopicIds, setSelectedFocusTopicIds)}
              />
            ))}
          </View>

          <Text style={styles.metricLabel}>Scenarios</Text>
          <View style={styles.chipColumn}>
            {(options?.availableScenarios ?? []).map((scenario) => (
              <OptionChip
                key={scenario.scenarioId}
                label={`${scenario.displayName} - ${scenario.segmentLabel ?? "Role"}`}
                selected={selectedScenarioIds.includes(scenario.scenarioId)}
                onPress={() => toggle(scenario.scenarioId, selectedScenarioIds, setSelectedScenarioIds)}
              />
            ))}
          </View>

          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
          {preview ? (
            <View style={styles.previewBox}>
              <Text style={styles.metricLabel}>{preview.valid ? "Preview valid" : "Needs changes"}</Text>
              {preview.errors.length > 0 ? (
                <Text style={styles.body}>{preview.errors.join(" ")}</Text>
              ) : (
                <Text style={styles.body}>
                  Scope: {preview.scope?.scenarios.map((scenario) => scenario.displayName).join(", ") || "-"}
                </Text>
              )}
              {preview.baselinePreview ? (
                <Text style={styles.subtle}>
                  Baseline {formatNumber(preview.baselinePreview.baselineAverage)} from {preview.baselinePreview.eligibleScoreCount} attempts.
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.formRow}>
            <Pressable
              style={[styles.secondaryButton, isPreviewing || isSaving ? styles.disabled : null]}
              disabled={isPreviewing || isSaving}
              onPress={() => { void runPreview(); }}
            >
              <Text style={styles.secondaryButtonText}>{isPreviewing ? "Previewing..." : "Preview"}</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, isSaving || isPreviewing ? styles.disabled : null]}
              disabled={isSaving || isPreviewing}
              onPress={() => { void runCreate(); }}
            >
              <Text style={styles.primaryButtonText}>{isSaving ? "Creating..." : "Create Plan"}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

export function PerformanceScreen({ userId, authToken, onBack }: PerformanceScreenProps) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [current, setCurrent] = useState<MobilePerformanceCurrentResponse | null>(null);
  const [options, setOptions] = useState<MobilePerformancePlanOptionsResponse | null>(null);
  const [history, setHistory] = useState<MobilePerformancePlanHistoryResponse | null>(null);
  const [detail, setDetail] = useState<MobilePerformancePlanDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const loadPerformance = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const [currentPayload, historyPayload, optionsPayload] = await Promise.all([
        fetchCurrentPerformancePlan(userId, authToken),
        fetchPerformancePlanHistory(userId, authToken),
        fetchPerformancePlanOptions(userId, authToken),
      ]);
      setCurrent(currentPayload);
      setHistory(historyPayload);
      setOptions(optionsPayload);
      setDetail(null);
      setLoadState("ready");
    } catch (caught) {
      setError(getErrorMessage(caught, "Could not load Performance plans."));
      setLoadState("error");
    }
  }, [authToken, userId]);

  useEffect(() => {
    void loadPerformance();
  }, [loadPerformance]);

  const openPlan = useCallback(
    async (planId: string) => {
      setError(null);
      try {
        const payload = await fetchPerformancePlanDetail(userId, planId, authToken);
        setDetail(payload);
      } catch (caught) {
        setError(getErrorMessage(caught, "Could not load Performance plan detail."));
      }
    },
    [authToken, userId],
  );

  const activePlans = current?.activePlans ?? [];
  const historyPlans = useMemo(() => history?.plans ?? [], [history]);
  const handleCreated = useCallback(async () => {
    setShowCreateForm(false);
    await loadPerformance();
  }, [loadPerformance]);

  return (
    <View style={styles.fill}>
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Performance</Text>
        <Pressable style={styles.backButton} onPress={() => { void loadPerformance(); }}>
          <Text style={styles.backButtonText}>Refresh</Text>
        </Pressable>
      </View>

      {loadState === "loading" ? (
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.body}>Loading Performance plans...</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.eyebrow}>Active Plans</Text>
            <Text style={styles.title}>{activePlans.length === 0 ? "No active Performance plans" : `${activePlans.length} active plan${activePlans.length === 1 ? "" : "s"}`}</Text>
            <Text style={styles.body}>Create a plan for your next Focus Topic when you are ready.</Text>
            <Pressable style={styles.primaryButton} onPress={() => setShowCreateForm(true)}>
              <Text style={styles.primaryButtonText}>Create Performance Plan</Text>
            </Pressable>
          </View>

          {activePlans.map((summary) => (
            <PlanSummaryCard
              key={summary.plan.id}
              plan={summary.plan}
              progress={summary.progress}
              attribution={getMobilePlanAttribution(summary.plan, userId)}
              onOpen={() => { void openPlan(summary.plan.id); }}
            />
          ))}

          {showCreateForm ? (
            <PerformanceCreateForm
              userId={userId}
              options={options}
              authToken={authToken}
              onCreated={handleCreated}
              onCancel={() => setShowCreateForm(false)}
            />
          ) : null}

          {detail ? (
            <>
              <PlanSummaryCard
                plan={detail.plan}
                progress={detail.progress}
                attribution={getMobilePlanAttribution(detail.plan, userId)}
              />
              {detail.auditEvents.length > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.eyebrow}>Activity</Text>
                  {detail.auditEvents.slice(-3).map((event) => (
                    <Text key={event.id} style={styles.body}>
                      {event.actionLabel} by {event.actorLabel}
                    </Text>
                  ))}
                </View>
              ) : null}
              <FinalResultBlock plan={detail.plan} />
            </>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.eyebrow}>History</Text>
            {historyPlans.length === 0 ? (
              <Text style={styles.body}>No Performance plan history yet.</Text>
            ) : (
              historyPlans.map((row) => (
                <PlanSummaryCard
                  key={row.plan.id}
                  plan={row.plan}
                  progress={row.progress}
                  attribution={getMobilePlanAttribution(row.plan, userId)}
                  onOpen={() => { void openPlan(row.plan.id); }}
                />
              ))
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingBottom: 24 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  topTitle: { color: "#f6f0df", fontSize: 19, fontWeight: "700" },
  backButton: {
    minWidth: 78,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.2)",
    backgroundColor: "rgba(20,28,22,0.68)",
  },
  backButtonText: { color: "#f6f0df", fontWeight: "700" },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.18)",
    backgroundColor: "rgba(19,27,22,0.78)",
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  flex: { flex: 1 },
  eyebrow: {
    color: "#c9b88f",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: { color: "#f6f0df", fontSize: 18, fontWeight: "800" },
  body: { color: "#d8ddcf", fontSize: 14, lineHeight: 20 },
  subtle: { color: "#aeb8a8", fontSize: 13, lineHeight: 18 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  statusActive: { backgroundColor: "rgba(114,157,116,0.28)" },
  statusMuted: { backgroundColor: "rgba(255,255,255,0.1)" },
  statusText: { color: "#f6f0df", fontSize: 12, fontWeight: "800" },
  smallButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  smallButtonText: { color: "#f6f0df", fontWeight: "800" },
  formRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  formField: { flex: 1, minWidth: 130, gap: 6 },
  textInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.18)",
    backgroundColor: "rgba(8,13,10,0.42)",
    color: "#f6f0df",
    paddingHorizontal: 12,
    fontSize: 15,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipColumn: { gap: 8 },
  chip: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  chipSelected: {
    borderColor: "rgba(143,184,141,0.82)",
    backgroundColor: "rgba(143,184,141,0.2)",
  },
  chipText: { color: "#d8ddcf", fontSize: 13, fontWeight: "700" },
  chipTextSelected: { color: "#f6f0df" },
  metricBlock: { gap: 6, marginTop: 4 },
  metricLabel: { color: "#aeb8a8", fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  metricValue: { color: "#f6f0df", fontSize: 20, fontWeight: "800" },
  progressTrack: { height: 9, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" },
  progressFill: { height: 9, borderRadius: 999, backgroundColor: "#8fb88d" },
  statGrid: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statBox: {
    flex: 1,
    minWidth: 90,
    borderRadius: 14,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  insightRow: { gap: 4, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  errorCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(240,138,138,0.36)",
    backgroundColor: "rgba(91,35,35,0.34)",
    padding: 14,
    marginBottom: 12,
  },
  errorText: { color: "#ffd6d6", lineHeight: 20 },
  previewBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(143,184,141,0.28)",
    backgroundColor: "rgba(143,184,141,0.08)",
    padding: 12,
    gap: 6,
  },
  primaryButton: {
    minHeight: 46,
    flex: 1,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#8fb88d",
  },
  primaryButtonText: { color: "#102017", fontWeight: "900" },
  secondaryButton: {
    minHeight: 46,
    flex: 1,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.2)",
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  secondaryButtonText: { color: "#f6f0df", fontWeight: "800" },
  disabled: { opacity: 0.6 },
});
