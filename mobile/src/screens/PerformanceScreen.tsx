import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
  buildPerformanceActivityLine,
  buildPerformanceDateRangeLabel,
  buildPerformanceDateStatusLabel,
  buildPerformanceOverallLine,
  buildPerformancePerformanceLine,
  buildPerformancePlanTitle,
  buildPerformanceScopeLabel,
  buildPerformanceStatusBadgeLabel,
  derivePerformancePlanPresentationStatus,
  formatPerformanceDateKey,
  groupPerformancePlanSummaries,
} from "@voicepractice/shared";

import {
  createPerformancePlan,
  fetchCurrentPerformancePlan,
  fetchPerformancePlanOptions,
  fetchPerformancePlanDetail,
  fetchPerformancePlanHistory,
  postPerformancePlanUpdate,
  previewPerformancePlan,
} from "../lib/api";
import { formatPerformanceDate } from "../lib/performanceDateFormatting";
import { SafeAreaView } from "react-native-safe-area-context";

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

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth ? { year, month, day } : null;
}

function dateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function compareDateKeys(left: string, right: string): number {
  return left.localeCompare(right);
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

function formatGoalCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
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
  const Wrapper = onOpen ? Pressable : View;
  const status = derivePerformancePlanPresentationStatus(plan);
  const activityLine = buildPerformanceActivityLine(plan, progress);
  const performanceLine = buildPerformancePerformanceLine(plan, progress);
  const overallLine = buildPerformanceOverallLine(plan, progress);

  return (
    <Wrapper style={styles.planCard} onPress={onOpen}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>Performance Goal</Text>
          <Text style={styles.title}>{buildPerformancePlanTitle(plan)}</Text>
        </View>
        <View style={[styles.statusPill, status === "active" ? styles.statusActive : status === "scheduled" ? styles.statusScheduled : styles.statusMuted]}>
          <Text style={styles.statusText}>{buildPerformanceStatusBadgeLabel(plan)}</Text>
        </View>
      </View>

      <Text style={styles.body}>{buildPerformanceScopeLabel(plan)}</Text>
      <Text style={styles.subtle}>{buildPerformanceDateRangeLabel(plan)} | {buildPerformanceDateStatusLabel(plan)}</Text>
      {attribution ? <Text style={styles.subtle}>{attribution}</Text> : null}

      <View style={styles.statusSummary}>
        <Text style={styles.metricLabel}>Overall</Text>
        <Text style={styles.body}>{overallLine}</Text>
      </View>

      {activityLine ? (
        <View style={styles.metricBlock}>
          <Text style={styles.metricLabel}>Activity</Text>
          <Text style={styles.body}>{activityLine}</Text>
          {status === "active" && progress?.activity.enabled ? (
            <ProgressBar ratio={progressRatio(progress.activity.actualValue, plan.activityGoal.targetValue ?? progress.activity.cumulativeTargetValue)} />
          ) : null}
        </View>
      ) : null}

      {performanceLine ? (
        <View style={styles.metricBlock}>
          <Text style={styles.metricLabel}>Performance</Text>
          <Text style={styles.body}>{performanceLine}</Text>
          {status === "active" && progress?.performance.enabled && !progress.performance.notEnoughData ? (
            <ProgressBar ratio={progressRatio(progress.performance.currentAverage ?? 0, progress.performance.targetScore ?? 100)} />
          ) : null}
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

function PlanDetailModal({
  detail,
  userId,
  authToken,
  onClose,
  onUpdated,
}: {
  detail: MobilePerformancePlanDetailResponse | null;
  userId: string;
  authToken: string;
  onClose: () => void;
  onUpdated: (detail: MobilePerformancePlanDetailResponse) => void;
}) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  if (!detail) {
    return null;
  }
  const canPostUpdate = detail.plan.status === "active" && derivePerformancePlanPresentationStatus(detail.plan) !== "completed" && derivePerformancePlanPresentationStatus(detail.plan) !== "cancelled";

  const submitUpdate = async () => {
    setPosting(true);
    setPostError(null);
    try {
      const payload = await postPerformancePlanUpdate(userId, detail.plan.id, body, authToken);
      onUpdated({ ...detail, updates: [...detail.updates, payload.update] });
      setBody("");
    } catch (caught) {
      setPostError(getErrorMessage(caught, "Could not post this update."));
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.modalScreen}>
          <View style={styles.topRow}>
            <Pressable style={styles.backButton} onPress={onClose}>
              <Text style={styles.backButtonText}>Close</Text>
            </Pressable>
            <Text style={styles.topTitle}>Goal Detail</Text>
            <View style={styles.headerSpacer} />
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <PlanSummaryCard plan={detail.plan} progress={detail.progress} attribution={getMobilePlanAttribution(detail.plan, userId)} />

            {detail.insights.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.eyebrow}>Insights</Text>
                {detail.insights.map((insight, index) => (
                  <View key={`${insight.status}_${index}`} style={styles.insightRow}>
                    <Text style={styles.body}>{insight.message}</Text>
                    <Text style={styles.subtle}>{insight.recommendedNextStep}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.eyebrow}>Goal Updates</Text>
              {canPostUpdate ? (
                <>
                  <TextInput
                    style={[styles.textInput, styles.multilineInput]}
                    value={body}
                    onChangeText={setBody}
                    placeholder="Write an update..."
                    placeholderTextColor="#7d877a"
                    multiline
                    maxLength={2000}
                  />
                  {postError ? <Text style={styles.errorText}>{postError}</Text> : null}
                  <Pressable
                    style={[styles.primaryButton, posting || !body.trim() ? styles.disabled : null]}
                    disabled={posting || !body.trim()}
                    onPress={() => { void submitUpdate(); }}
                  >
                    <Text style={styles.primaryButtonText}>{posting ? "Posting..." : "Post Update"}</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.subtle}>Updates are read-only after a goal moves to Goal History.</Text>
              )}
              {detail.updates.length === 0 ? (
                <Text style={styles.body}>No updates yet.</Text>
              ) : (
                detail.updates.map((update) => (
                  <View key={update.id} style={styles.updateItem}>
                    <Text style={styles.metricLabel}>{update.authorDisplayName}</Text>
                    <Text style={styles.body}>{update.body}</Text>
                    <Text style={styles.subtle}>{new Date(update.createdAt).toLocaleString()}</Text>
                  </View>
                ))
              )}
            </View>

            <FinalResultBlock plan={detail.plan} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

function CalendarDateField({
  label,
  value,
  minimumDate,
  onChange,
}: {
  label: string;
  value: string;
  minimumDate?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.formField}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Pressable style={styles.dateButton} onPress={() => setOpen(true)}>
        <Text style={styles.dateButtonText}>{formatPerformanceDateKey(value)}</Text>
      </Pressable>
      <CalendarDatePicker
        visible={open}
        value={value}
        minimumDate={minimumDate}
        onClose={() => setOpen(false)}
        onSelect={(nextValue) => {
          onChange(nextValue);
          setOpen(false);
        }}
      />
    </View>
  );
}

function CalendarDatePicker({
  visible,
  value,
  minimumDate,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: string;
  minimumDate?: string;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const selected = parseDateKey(value) ?? parseDateKey(todayDateKey())!;
  const [monthCursor, setMonthCursor] = useState(dateKeyFromParts(selected.year, selected.month, 1));
  const cursor = parseDateKey(monthCursor) ?? selected;
  const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month, 0)).getUTCDate();
  const firstDay = new Date(cursor.year, cursor.month - 1, 1).getDay();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, index) => index < firstDay ? null : index - firstDay + 1);

  const moveMonth = (delta: number) => {
    const date = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setMonthCursor(dateKeyFromParts(date.getFullYear(), date.getMonth() + 1, 1));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.calendarPanel}>
          <View style={styles.row}>
            <Pressable style={styles.smallButton} onPress={() => moveMonth(-1)}>
              <Text style={styles.smallButtonText}>Prev</Text>
            </Pressable>
            <Text style={styles.title}>{formatPerformanceDateKey(monthCursor)}</Text>
            <Pressable style={styles.smallButton} onPress={() => moveMonth(1)}>
              <Text style={styles.smallButtonText}>Next</Text>
            </Pressable>
          </View>
          <View style={styles.calendarGrid}>
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <Text key={`${day}_${index}`} style={styles.calendarHeader}>{day}</Text>
            ))}
            {cells.map((day, index) => {
              if (day === null) {
                return <View key={`empty_${index}`} style={styles.calendarCell} />;
              }
              const dateKey = dateKeyFromParts(cursor.year, cursor.month, day);
              const disabled = Boolean(minimumDate && compareDateKeys(dateKey, minimumDate) < 0);
              const selectedDay = dateKey === value;
              return (
                <Pressable
                  key={dateKey}
                  style={[styles.calendarCell, selectedDay ? styles.calendarCellSelected : null, disabled ? styles.disabled : null]}
                  disabled={disabled}
                  onPress={() => onSelect(dateKey)}
                >
                  <Text style={[styles.calendarCellText, selectedDay ? styles.calendarCellTextSelected : null]}>{day}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={styles.secondaryButton} onPress={onClose}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function PerformanceCreateForm({
  userId,
  options,
  authToken,
  onCreated,
}: {
  userId: string;
  options: MobilePerformancePlanOptionsResponse | null;
  authToken: string;
  onCreated: () => Promise<void>;
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
  const [step, setStep] = useState<"form" | "review">("form");

  const defaultTimeZone = options?.defaultTimeZone ?? "UTC";
  const hasOptions = Boolean((options?.availableFocusTopics.length ?? 0) > 0 || (options?.availableScenarios.length ?? 0) > 0);

  const clearPreview = () => {
    setPreview(null);
    setFormError(null);
    setStep("form");
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
      if (compareDateKeys(endDate, startDate) < 0) {
        setFormError("End date cannot be before start date.");
        setPreview(null);
        return;
      }
      const payload = await previewPerformancePlan(userId, buildRequest(), authToken);
      setPreview(payload);
      if (payload.valid) {
        setStep("review");
      }
    } catch (caught) {
      setFormError(getErrorMessage(caught, "Could not preview this Performance goal."));
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
      setFormError(getErrorMessage(caught, "Could not create this Performance goal."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.createFormBody}>
      {!hasOptions ? (
        <Text style={styles.body}>No eligible Focus Topics are assigned to your account yet.</Text>
      ) : step === "review" && preview?.valid ? (
        <>
          <View style={styles.previewBox}>
            <Text style={styles.metricLabel}>Dates</Text>
            <Text style={styles.body}>{formatPerformanceDateKey(startDate)} to {formatPerformanceDateKey(endDate)}</Text>
            <Text style={styles.metricLabel}>Goal</Text>
            <Text style={styles.body}>
              {goalMode !== "performance" ? `${ACTIVITY_METRICS.find((metric) => metric.value === activityMetric)?.label}: ${activityTarget}` : ""}
              {goalMode === "both" ? " | " : ""}
              {goalMode !== "activity" ? `${PERFORMANCE_METRICS.find((metric) => metric.value === performanceMetric)?.label}: ${performanceMetric === "target_average_score" ? targetScore : improvementAmount}` : ""}
            </Text>
            <Text style={styles.metricLabel}>Focus Topic and scenarios</Text>
            <Text style={styles.body}>{preview.scope?.scenarios.map((scenario) => scenario.displayName).join(", ") || "-"}</Text>
            {preview.baselinePreview ? (
              <Text style={styles.subtle}>
                Baseline {formatNumber(preview.baselinePreview.baselineAverage)} from {preview.baselinePreview.eligibleScoreCount} attempts.
              </Text>
            ) : null}
          </View>
          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
          <View style={styles.formRow}>
            <Pressable style={styles.secondaryButton} onPress={() => setStep("form")} disabled={isSaving}>
              <Text style={styles.secondaryButtonText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, isSaving ? styles.disabled : null]}
              disabled={isSaving}
              onPress={() => { void runCreate(); }}
            >
              <Text style={styles.primaryButtonText}>{isSaving ? "Creating..." : "Create Goal"}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={styles.formRow}>
            <CalendarDateField
              label="Start date"
              value={startDate}
              onChange={(value) => {
                clearPreview();
                setStartDate(value);
                if (compareDateKeys(endDate, value) < 0) {
                  setEndDate(value);
                  setFormError("End date was adjusted to match the new start date.");
                }
              }}
            />
            <CalendarDateField
              label="End date"
              value={endDate}
              minimumDate={startDate}
              onChange={(value) => {
                setEndDate(value);
                clearPreview();
              }}
            />
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
              style={[styles.primaryButton, isPreviewing || isSaving ? styles.disabled : null]}
              disabled={isPreviewing || isSaving}
              onPress={() => { void runPreview(); }}
            >
              <Text style={styles.primaryButtonText}>{isPreviewing ? "Reviewing..." : "Continue"}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function GoalSection({
  title,
  countLabel,
  emptyMessage,
  action,
  children,
}: {
  title: string;
  countLabel: string;
  emptyMessage: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const childArray = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <View style={styles.goalSection}>
      <View style={styles.goalSectionHeader}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{title}</Text>
          <Text style={styles.title}>{countLabel}</Text>
        </View>
        {action}
      </View>
      <View style={styles.goalSectionBody}>
        {childArray.length === 0 ? (
          <Text style={styles.body}>{emptyMessage}</Text>
        ) : (
          childArray
        )}
      </View>
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
      setError(getErrorMessage(caught, "Could not load Performance goals."));
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
        setError(getErrorMessage(caught, "Could not load Performance goal detail."));
      }
    },
    [authToken, userId],
  );

  const allPlanRows = useMemo(() => {
    const byId = new Map<string, MobilePerformancePlanHistoryResponse["plans"][number]>();
    for (const row of history?.plans ?? []) {
      byId.set(row.plan.id, row);
    }
    for (const row of current?.activePlans ?? []) {
      byId.set(row.plan.id, row);
    }
    return Array.from(byId.values());
  }, [current, history]);
  const groupedPlans = useMemo(
    () => groupPerformancePlanSummaries(allPlanRows, new Date(current?.generatedAt ?? history?.generatedAt ?? Date.now())),
    [allPlanRows, current?.generatedAt, history?.generatedAt],
  );
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
          <Text style={styles.body}>Loading Performance goals...</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <GoalSection
            title="Active Goals"
            countLabel={formatGoalCount(groupedPlans.active.length, "active goal")}
            emptyMessage="No active goals"
            action={(
              <Pressable style={styles.sectionActionButton} onPress={() => setShowCreateForm(true)}>
                <Text style={styles.sectionActionButtonText}>Create Goal</Text>
              </Pressable>
            )}
          >
            {groupedPlans.active.map((summary) => (
              <PlanSummaryCard
                key={summary.plan.id}
                plan={summary.plan}
                progress={summary.progress}
                attribution={getMobilePlanAttribution(summary.plan, userId)}
                onOpen={() => { void openPlan(summary.plan.id); }}
              />
            ))}
          </GoalSection>

          <GoalSection
            title="Scheduled Goals"
            countLabel={formatGoalCount(groupedPlans.scheduled.length, "scheduled goal")}
            emptyMessage="No scheduled goals"
          >
            {groupedPlans.scheduled.map((summary) => (
              <PlanSummaryCard
                key={summary.plan.id}
                plan={summary.plan}
                progress={summary.progress}
                attribution={getMobilePlanAttribution(summary.plan, userId)}
                onOpen={() => { void openPlan(summary.plan.id); }}
              />
            ))}
          </GoalSection>

          <GoalSection
            title="Goal History"
            countLabel={formatGoalCount(groupedPlans.history.length, "historical goal")}
            emptyMessage="No completed or cancelled goals yet"
          >
            {groupedPlans.history.map((row) => (
              <PlanSummaryCard
                key={row.plan.id}
                plan={row.plan}
                progress={row.progress}
                attribution={getMobilePlanAttribution(row.plan, userId)}
                onOpen={() => { void openPlan(row.plan.id); }}
              />
            ))}
          </GoalSection>
        </ScrollView>
      )}
      <Modal visible={showCreateForm} animationType="slide" onRequestClose={() => setShowCreateForm(false)}>
        <SafeAreaView style={styles.modalSafeArea} edges={["top", "bottom"]}>
          <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={styles.createModalHeader}>
              <View style={styles.flex}>
                <Text style={styles.topTitle}>Create Performance Goal</Text>
                <Text style={styles.subtle}>Set your next Focus Topic</Text>
              </View>
              <Pressable style={styles.smallButton} onPress={() => setShowCreateForm(false)}>
                <Text style={styles.smallButtonText}>Cancel</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.createFormContent}
              keyboardShouldPersistTaps="handled"
            >
              <PerformanceCreateForm
                userId={userId}
                options={options}
                authToken={authToken}
                onCreated={handleCreated}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
      <PlanDetailModal
        detail={detail}
        userId={userId}
        authToken={authToken}
        onClose={() => setDetail(null)}
        onUpdated={setDetail}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingBottom: 24 },
  createFormContent: { padding: 14, paddingBottom: 36 },
  createFormBody: { gap: 12 },
  modalSafeArea: { flex: 1, backgroundColor: "#101711" },
  modalScreen: { flex: 1, backgroundColor: "#101711", padding: 14 },
  createModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(246,240,223,0.12)",
    backgroundColor: "#101711",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  topTitle: { color: "#f6f0df", fontSize: 19, fontWeight: "700" },
  headerSpacer: { minWidth: 78 },
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
  goalSection: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.16)",
    backgroundColor: "rgba(19,27,22,0.72)",
    marginBottom: 14,
    overflow: "hidden",
  },
  goalSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(246,240,223,0.1)",
  },
  goalSectionBody: {
    padding: 10,
    gap: 10,
  },
  planCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(143,184,141,0.34)",
    backgroundColor: "rgba(15,24,18,0.92)",
    padding: 14,
    gap: 8,
  },
  modalSheet: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.18)",
    backgroundColor: "rgba(19,27,22,0.96)",
    padding: 14,
    gap: 12,
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
  statusScheduled: { backgroundColor: "rgba(201,184,143,0.24)" },
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
  sectionActionButton: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#8fb88d",
    paddingHorizontal: 12,
  },
  sectionActionButtonText: { color: "#102017", fontWeight: "900" },
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
  multilineInput: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  dateButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.18)",
    backgroundColor: "rgba(8,13,10,0.42)",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  dateButtonText: { color: "#f6f0df", fontSize: 15, fontWeight: "700" },
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
  statusSummary: { gap: 3, marginTop: 4 },
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
  updateItem: { gap: 4, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  calendarPanel: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(246,240,223,0.18)",
    backgroundColor: "#152017",
    padding: 14,
    gap: 12,
  },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  calendarHeader: {
    width: "13.5%",
    color: "#aeb8a8",
    textAlign: "center",
    fontSize: 12,
    fontWeight: "800",
  },
  calendarCell: {
    width: "13.5%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  calendarCellSelected: { backgroundColor: "#8fb88d" },
  calendarCellText: { color: "#d8ddcf", fontWeight: "800" },
  calendarCellTextSelected: { color: "#102017" },
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
