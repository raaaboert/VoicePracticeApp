import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  MobilePerformanceCurrentResponse,
  MobilePerformancePlanDetailResponse,
  MobilePerformancePlanHistoryResponse,
  PerformancePlan,
  PerformanceProgress,
} from "@voicepractice/shared";

import {
  cancelPerformancePlan,
  fetchCurrentPerformancePlan,
  fetchPerformancePlanDetail,
  fetchPerformancePlanHistory,
} from "../lib/api";
import { formatPerformanceDate, getRemainingPerformancePlanDays } from "../lib/performanceDateFormatting";

interface PerformanceScreenProps {
  userId: string;
  authToken: string;
  onBack: () => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";

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
  onOpen,
}: {
  plan: PerformancePlan;
  progress: PerformanceProgress | null;
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

export function PerformanceScreen({ userId, authToken, onBack }: PerformanceScreenProps) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [current, setCurrent] = useState<MobilePerformanceCurrentResponse | null>(null);
  const [history, setHistory] = useState<MobilePerformancePlanHistoryResponse | null>(null);
  const [detail, setDetail] = useState<MobilePerformancePlanDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);

  const loadPerformance = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const [currentPayload, historyPayload] = await Promise.all([
        fetchCurrentPerformancePlan(userId, authToken),
        fetchPerformancePlanHistory(userId, authToken),
      ]);
      setCurrent(currentPayload);
      setHistory(historyPayload);
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

  const runCancel = useCallback(async () => {
    const planId = detail?.plan.id ?? current?.plan?.id ?? null;
    if (!planId) {
      return;
    }
    setIsCanceling(true);
    setError(null);
    try {
      await cancelPerformancePlan(userId, planId, { reason: "Cancelled from mobile app." }, authToken);
      await loadPerformance();
    } catch (caught) {
      setError(getErrorMessage(caught, "Could not cancel this Performance plan."));
    } finally {
      setIsCanceling(false);
    }
  }, [authToken, current?.plan?.id, detail?.plan.id, loadPerformance, userId]);

  const confirmCancel = useCallback(() => {
    Alert.alert("Cancel Performance Plan", "Cancel this active plan?", [
      { text: "Keep Plan", style: "cancel" },
      { text: "Cancel Plan", style: "destructive", onPress: () => { void runCancel(); } },
    ]);
  }, [runCancel]);

  const currentPlan = current?.plan ?? null;
  const historyPlans = useMemo(() => history?.plans ?? [], [history]);

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

          {currentPlan && current?.progress ? (
            <PlanSummaryCard plan={currentPlan} progress={current.progress} onOpen={() => { void openPlan(currentPlan.id); }} />
          ) : (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>Current Plan</Text>
              <Text style={styles.title}>No active Performance plan</Text>
              <Text style={styles.body}>Assigned plans will appear here after your manager creates one.</Text>
            </View>
          )}

          {current?.insights.length ? (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>Insights</Text>
              {current.insights.map((insight, index) => (
                <View key={`${insight.status}_${index}`} style={styles.insightRow}>
                  <Text style={styles.metricLabel}>{insight.status.replace(/_/g, " ")}</Text>
                  <Text style={styles.body}>{insight.message}</Text>
                  <Text style={styles.subtle}>{insight.recommendedNextStep}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {detail ? (
            <>
              <PlanSummaryCard plan={detail.plan} progress={detail.progress} />
              <FinalResultBlock plan={detail.plan} />
              {detail.plan.status === "active" ? (
                <Pressable
                  style={[styles.cancelButton, isCanceling ? styles.disabled : null]}
                  disabled={isCanceling}
                  onPress={confirmCancel}
                >
                  <Text style={styles.cancelButtonText}>{isCanceling ? "Cancelling..." : "Cancel Plan"}</Text>
                </Pressable>
              ) : null}
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
  cancelButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#9d4f4f",
    marginBottom: 12,
  },
  cancelButtonText: { color: "#fff7ee", fontWeight: "800" },
  disabled: { opacity: 0.6 },
});
