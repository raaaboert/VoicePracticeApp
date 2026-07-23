import type {
  PerformancePlan,
  PerformanceProgress
} from "./contracts.js";

export type PerformancePlanPresentationStatus = "scheduled" | "active" | "completed" | "cancelled";

export interface PerformancePlanGroups<T extends { plan: PerformancePlan }> {
  active: T[];
  scheduled: T[];
  history: T[];
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function derivePerformancePlanPresentationStatus(
  plan: PerformancePlan,
  now: Date = new Date()
): PerformancePlanPresentationStatus {
  if (plan.status === "completed") {
    return "completed";
  }
  if (plan.status === "cancelled") {
    return "cancelled";
  }
  const today = getDateKeyForTimeZone(now, plan.timeZone);
  if (plan.startDate > today) {
    return "scheduled";
  }
  return "active";
}

export function groupPerformancePlanSummaries<T extends { plan: PerformancePlan }>(
  rows: T[],
  now: Date = new Date()
): PerformancePlanGroups<T> {
  const groups: PerformancePlanGroups<T> = { active: [], scheduled: [], history: [] };
  for (const row of rows) {
    const status = derivePerformancePlanPresentationStatus(row.plan, now);
    if (status === "scheduled") {
      groups.scheduled.push(row);
    } else if (status === "active") {
      groups.active.push(row);
    } else {
      groups.history.push(row);
    }
  }
  groups.active.sort(comparePlanRowsByDate);
  groups.scheduled.sort(comparePlanRowsByDate);
  groups.history.sort((left, right) => right.plan.updatedAt.localeCompare(left.plan.updatedAt) || right.plan.id.localeCompare(left.plan.id));
  return groups;
}

export function buildPerformancePlanTitle(plan: PerformancePlan): string {
  if (plan.performanceGoal.enabled && plan.performanceGoal.metricType === "target_average_score") {
    return `Target score: ${formatCompactNumber(plan.performanceGoal.targetScore)}`;
  }
  if (plan.performanceGoal.enabled && plan.performanceGoal.metricType === "improve_by_percent") {
    return `Improve score by ${formatCompactNumber(plan.performanceGoal.improvementAmount)}%`;
  }
  if (plan.performanceGoal.enabled && plan.performanceGoal.metricType === "improve_by_points") {
    return `Improve score by ${formatCompactNumber(plan.performanceGoal.improvementAmount)} points`;
  }
  if (plan.activityGoal.metricType === "weekly_session_count") {
    return "Weekly session goal";
  }
  if (plan.activityGoal.metricType === "weekly_practice_minutes") {
    return "Weekly practice minutes";
  }
  if (plan.activityGoal.metricType === "total_session_count") {
    return "Total session goal";
  }
  if (plan.activityGoal.metricType === "total_practice_minutes") {
    return "Total practice minutes";
  }
  return "Performance goal";
}

export function buildPerformanceScopeLabel(plan: PerformancePlan): string {
  const topics = new Set<string>();
  for (const scenario of plan.scope.scenarios) {
    for (const topic of scenario.focusTopics) {
      topics.add(topic.name);
    }
  }
  const topicLabel = Array.from(topics).sort((left, right) => left.localeCompare(right)).join(" + ");
  if (topicLabel) {
    return topicLabel;
  }
  return plan.scope.scenarios.map((scenario) => scenario.displayName).join(" + ") || "Assigned scenarios";
}

export function buildPerformanceDateRangeLabel(plan: PerformancePlan): string {
  return `${formatPerformanceDateKey(plan.startDate)}-${formatPerformanceDateKey(plan.endDate)}`;
}

export function buildPerformanceStatusBadgeLabel(
  plan: PerformancePlan,
  now: Date = new Date()
): string {
  const status = derivePerformancePlanPresentationStatus(plan, now);
  if (status === "completed") {
    return "Completed";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (status === "scheduled") {
    return "Scheduled";
  }
  return "Active";
}

export function buildPerformanceDateStatusLabel(
  plan: PerformancePlan,
  now: Date = new Date()
): string {
  const status = derivePerformancePlanPresentationStatus(plan, now);
  if (status === "scheduled") {
    return `Starts ${formatPerformanceDateKeyWithoutYear(plan.startDate)}`;
  }
  if (status === "completed") {
    return `Completed ${formatPerformanceDateKeyWithoutYear(dateKeyFromIso(plan.completedAt ?? plan.finalResult?.finalizedAt) ?? plan.endDate)}`;
  }
  if (status === "cancelled") {
    return `Cancelled ${formatPerformanceDateKeyWithoutYear(dateKeyFromIso(plan.cancelledAt) ?? plan.endDate)}`;
  }
  const remaining = getRemainingDateKeyDays(plan.endDate, getDateKeyForTimeZone(now, plan.timeZone));
  return `${remaining} day${remaining === 1 ? "" : "s"} remaining`;
}

export function buildPerformanceActivityLine(
  plan: PerformancePlan,
  progress: PerformanceProgress | null,
  now: Date = new Date()
): string | null {
  if (!plan.activityGoal.enabled || !plan.activityGoal.metricType) {
    return null;
  }
  const target = plan.activityGoal.targetValue ?? progress?.activity.targetValue ?? progress?.activity.cumulativeTargetValue ?? null;
  const unit = getActivityUnitLabel(plan.activityGoal.metricType, target);
  if (derivePerformancePlanPresentationStatus(plan, now) === "scheduled") {
    return `${plan.activityGoal.metricType.startsWith("weekly_") ? "Weekly target" : "Target"}: ${formatCompactNumber(target)} ${unit}`;
  }
  if (!progress?.activity.enabled) {
    return `Activity target: ${formatCompactNumber(target)} ${unit}`;
  }
  if (plan.activityGoal.metricType === "weekly_session_count" || plan.activityGoal.metricType === "weekly_practice_minutes") {
    return `${formatCompactNumber(progress.activity.actualValue)} / ${formatCompactNumber(target)} ${unit} this week`;
  }
  return `${formatCompactNumber(progress.activity.actualValue)} / ${formatCompactNumber(target)} ${unit}`;
}

export function buildPerformancePerformanceLine(
  plan: PerformancePlan,
  progress: PerformanceProgress | null,
  now: Date = new Date()
): string | null {
  if (!plan.performanceGoal.enabled || !plan.performanceGoal.metricType) {
    return null;
  }
  if (derivePerformancePlanPresentationStatus(plan, now) === "scheduled") {
    if (plan.performanceGoal.metricType === "target_average_score") {
      return `Target score: ${formatCompactNumber(plan.performanceGoal.targetScore)}`;
    }
    return `Performance target: ${buildPerformancePlanTitle(plan)}`;
  }
  if (!progress?.performance.enabled) {
    return `Performance target: ${buildPerformancePlanTitle(plan)}`;
  }
  if (progress.performance.notEnoughData) {
    return "Not enough scored sessions yet";
  }
  return `Average score ${formatCompactNumber(progress.performance.currentAverage)} / target ${formatCompactNumber(progress.performance.targetScore)}`;
}

export function buildPerformanceOverallLine(
  plan: PerformancePlan,
  progress: PerformanceProgress | null,
  now: Date = new Date()
): string {
  const status = derivePerformancePlanPresentationStatus(plan, now);
  if (status === "scheduled") {
    return "Scheduled";
  }
  if (status === "completed") {
    return plan.finalResult?.overallSucceeded ? "Goal met" : "Finalized";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (!progress) {
    return "Collecting evidence";
  }
  if (progress.performance.enabled && progress.performance.notEnoughData && !progress.activity.enabled) {
    return "Collecting scored sessions";
  }
  return progress.overallCurrentlyMeetingTarget ? "On track" : "Needs attention";
}

export function getDateKeyForTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fall through to local date formatting.
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatPerformanceDateKey(value: string): string {
  const parts = parseDateKey(value);
  if (!parts) {
    return value;
  }
  return `${SHORT_MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function formatPerformanceDateKeyWithoutYear(value: string): string {
  const parts = parseDateKey(value);
  if (!parts) {
    return value;
  }
  return `${SHORT_MONTHS[parts.month - 1]} ${parts.day}`;
}

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_KEY_PATTERN.exec(value);
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
  if (day > daysInMonth) {
    return null;
  }
  return { year, month, day };
}

function dateKeyFromIso(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = DATE_KEY_PATTERN.exec(value.slice(0, 10));
  return match ? value.slice(0, 10) : null;
}

function getRemainingDateKeyDays(endDate: string, today: string): number {
  const end = parseDateKey(endDate);
  const current = parseDateKey(today);
  if (!end || !current) {
    return 0;
  }
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  const currentMs = Date.UTC(current.year, current.month - 1, current.day);
  return Math.max(0, Math.floor((endMs - currentMs) / 86_400_000) + 1);
}

function comparePlanRowsByDate<T extends { plan: PerformancePlan }>(left: T, right: T): number {
  return left.plan.startDate.localeCompare(right.plan.startDate) || left.plan.endDate.localeCompare(right.plan.endDate) || left.plan.id.localeCompare(right.plan.id);
}

function getActivityUnitLabel(metric: PerformancePlan["activityGoal"]["metricType"], value: number | null | undefined): string {
  const plural = value === 1 ? "" : "s";
  if (metric === "weekly_practice_minutes" || metric === "total_practice_minutes") {
    return `minute${plural}`;
  }
  if (metric === "weekly_session_count" || metric === "total_session_count") {
    return `session${plural}`;
  }
  return "units";
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value * 10) / 10}`.replace(/\.0$/, "");
}
