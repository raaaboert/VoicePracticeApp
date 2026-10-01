import type {
  OrganizationPerformanceCalendarMonth,
  OrganizationPerformanceMetric,
  OrganizationPerformanceMetricGroup,
  OrganizationPerformanceResponse,
  OrganizationPerformanceWeightProfile,
} from "@/src/lib/organizationPerformance";

export interface OrganizationPerformanceEvidenceNotices {
  readonly limitedEvidence: boolean;
  readonly concentrationWarning: boolean;
}

export interface OrganizationPerformanceMetricGeneration {
  readonly scoringGeneration: string;
  readonly metrics: readonly OrganizationPerformanceMetricGroup[];
}

const PRIMARY_DIMENSION_METRICS = new Set<OrganizationPerformanceMetric>([
  "persuasion",
  "clarity",
  "empathy",
  "assertiveness",
]);

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatWeightPercentage(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

export function calendarMonthFromLocalDate(date: Date): OrganizationPerformanceCalendarMonth {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function shiftCalendarMonth(
  value: OrganizationPerformanceCalendarMonth,
  offset: -1 | 1
): OrganizationPerformanceCalendarMonth {
  const date = new Date(value.year, value.month - 1 + offset, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function canNavigateToNextMonth(
  selected: OrganizationPerformanceCalendarMonth,
  current: OrganizationPerformanceCalendarMonth
): boolean {
  return selected.year < current.year || (selected.year === current.year && selected.month < current.month);
}

export function formatCalendarMonth(value: OrganizationPerformanceCalendarMonth): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(value.year, value.month - 1, 1)));
}

export function formatOrganizationPerformanceScore(metric: OrganizationPerformanceMetric, value: number): string {
  return `${formatNumber(value)} / ${PRIMARY_DIMENSION_METRICS.has(metric) ? 10 : 100}`;
}

export function formatOrganizationPerformanceWeighting(
  weightProfile: OrganizationPerformanceWeightProfile | undefined
): string {
  if (
    weightProfile?.kind !== "known"
    || !Object.values(weightProfile.weights).every((weight) => Number.isFinite(weight))
  ) {
    return "Weighting not recorded";
  }

  const { weights } = weightProfile;
  return [
    `Weighting: Persuasion ${formatWeightPercentage(weights.persuasion)}`,
    `Clarity ${formatWeightPercentage(weights.clarity)}`,
    `Empathy ${formatWeightPercentage(weights.empathy)}`,
    `Assertiveness ${formatWeightPercentage(weights.assertiveness)}`,
  ].join(" · ");
}

export function isOrganizationPerformanceRequestCurrent(signal: AbortSignal): boolean {
  return !signal.aborted;
}

export function isOrganizationPerformanceEmpty(data: OrganizationPerformanceResponse): boolean {
  return (data.activity?.attemptCount ?? 0) === 0
    && data.completionGroups.length === 0
    && data.metricGroups.length === 0;
}

export function collectOrganizationPerformanceEvidenceNotices(
  data: OrganizationPerformanceResponse
): OrganizationPerformanceEvidenceNotices {
  const evidence = [
    ...(data.activity ? [{ value: data.activity, observationCount: data.activity.attemptCount }] : []),
    ...data.completionGroups.flatMap((group) => [
      ...(group.completion ? [{
        value: group.completion,
        observationCount: group.completion.availableObservationCount,
      }] : []),
      ...(group.objective ? [{
        value: group.objective,
        observationCount: group.objective.availableObservationCount,
      }] : []),
    ]),
    ...data.metricGroups.map((metric) => ({
      value: metric,
      observationCount: metric.qualifyingObservationCount,
    })),
  ];
  return {
    limitedEvidence: evidence.some(({ value, observationCount }) =>
      observationCount > 0 && value.evidenceStrength.limitedEvidence === true),
    concentrationWarning: evidence.some(({ value }) => value.concentration.concentrationWarning === true),
  };
}

export function groupMetricsByScoringGeneration(
  metrics: readonly OrganizationPerformanceMetricGroup[]
): readonly OrganizationPerformanceMetricGeneration[] {
  const groups = new Map<string, OrganizationPerformanceMetricGroup[]>();
  for (const metric of metrics) {
    const current = groups.get(metric.scoringGeneration) ?? [];
    current.push(metric);
    groups.set(metric.scoringGeneration, current);
  }
  return [...groups].map(([scoringGeneration, groupedMetrics]) => ({
    scoringGeneration,
    metrics: groupedMetrics,
  }));
}

export function getHistoricalContextCopy(data: OrganizationPerformanceResponse): readonly string[] {
  if (data.historicalScope !== "organization_history") {
    return [];
  }
  const copy: string[] = [];
  copy.push("This organization view can include eligible historical performance contributions.");
  if (data.historicalPrivacyAdjustmentApplied) {
    copy.push("Some historical contributions are excluded from this view to protect participant privacy.");
  }
  return copy;
}
