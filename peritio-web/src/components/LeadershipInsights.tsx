import React from "react";
import { LoaderCircle } from "lucide-react";

import type {
  TeamPerformanceCompletionComparison,
  TeamPerformanceCompletionMovement,
  TeamPerformanceMetricComparison,
  TeamPerformanceMetricMovement,
  TeamPerformanceMovementDirection,
  TeamPerformanceQualifiers,
  TeamPerformanceRelativeDimension,
  TeamPerformanceWeightProfile,
} from "@/src/lib/teamPerformanceIntelligence";
import type { OrganizationPerformanceIntelligenceResponse } from "@/src/lib/organizationPerformanceIntelligence";
import type { OrganizationPerformanceMetric } from "@/src/lib/organizationPerformance";

const METRIC_LABELS: Record<OrganizationPerformanceMetric, string> = {
  persuasion: "Persuasion",
  clarity: "Clarity",
  empathy: "Empathy",
  assertiveness: "Assertiveness",
  communication: "Communication",
  outcome: "Outcome",
  overall: "Overall",
};

const CORE_METRICS = new Set<OrganizationPerformanceMetric>([
  "persuasion", "clarity", "empathy", "assertiveness",
]);

export type LeadershipInsightsState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "success"; readonly data: OrganizationPerformanceIntelligenceResponse };

export interface LeadershipMetricMovementRow {
  readonly metric: OrganizationPerformanceMetric;
  readonly label: string;
  readonly scoringGeneration: string;
  readonly weightProfile?: TeamPerformanceWeightProfile;
  readonly previous: number;
  readonly current: number;
  readonly delta: number;
  readonly direction: TeamPerformanceMovementDirection;
}

interface LeadershipRateMovementRow {
  readonly label: string;
  readonly scoringGeneration: string;
  readonly previous: number;
  readonly current: number;
  readonly delta: number;
  readonly direction: TeamPerformanceMovementDirection;
}

function sameWeightProfile(
  left: TeamPerformanceWeightProfile | undefined,
  right: TeamPerformanceWeightProfile | undefined,
): boolean {
  if (left?.kind !== right?.kind) return false;
  if (!left || left.kind === "unknown" || !right || right.kind === "unknown") return true;
  return Object.keys(left.weights).every((key) =>
    left.weights[key as keyof typeof left.weights] === right.weights[key as keyof typeof right.weights]);
}

function findMetricComparison(
  comparisons: readonly TeamPerformanceMetricComparison[],
  movement: TeamPerformanceMetricMovement,
): TeamPerformanceMetricComparison | undefined {
  return comparisons.find((comparison) =>
    comparison.metric === movement.metric
    && comparison.scoringGeneration === movement.scoringGeneration
    && sameWeightProfile(comparison.weightProfile, movement.weightProfile));
}

export function buildLeadershipMetricMovementRows(
  data: OrganizationPerformanceIntelligenceResponse,
): readonly LeadershipMetricMovementRow[] {
  if (!data.signals.monthCompleteness.complete) return [];
  return data.signals.metricMovement.flatMap((movement) => {
    if (!movement.movement.available) return [];
    const comparison = findMetricComparison(data.facts.metricComparisons, movement);
    if (!comparison?.current || !comparison.previous || comparison.delta === null) return [];
    return [{
      metric: movement.metric,
      label: METRIC_LABELS[movement.metric],
      scoringGeneration: movement.scoringGeneration,
      ...(movement.weightProfile ? { weightProfile: movement.weightProfile } : {}),
      previous: comparison.previous.mean,
      current: comparison.current.mean,
      delta: comparison.delta,
      direction: movement.movement.direction,
    }];
  });
}

function findCompletionComparison(
  comparisons: readonly TeamPerformanceCompletionComparison[],
  movement: TeamPerformanceCompletionMovement,
): TeamPerformanceCompletionComparison | undefined {
  return comparisons.find((comparison) => comparison.scoringGeneration === movement.scoringGeneration);
}

function buildRateMovementRows(data: OrganizationPerformanceIntelligenceResponse): readonly LeadershipRateMovementRow[] {
  if (!data.signals.monthCompleteness.complete) return [];
  return data.signals.completionMovement.flatMap((movement) => {
    const comparison = findCompletionComparison(data.facts.completionComparisons, movement);
    if (!comparison) return [];
    const rows: LeadershipRateMovementRow[] = [];
    if (
      movement.completion.movement.available
      && comparison.completion.current
      && comparison.completion.previous
      && comparison.completion.delta !== null
    ) {
      rows.push({
        label: "Completion rate",
        scoringGeneration: movement.scoringGeneration,
        previous: comparison.completion.previous.completionRate,
        current: comparison.completion.current.completionRate,
        delta: comparison.completion.delta,
        direction: movement.completion.movement.direction,
      });
    }
    if (
      movement.objective.movement.available
      && comparison.objective.current
      && comparison.objective.previous
      && comparison.objective.delta !== null
    ) {
      rows.push({
        label: "Objective achievement",
        scoringGeneration: movement.scoringGeneration,
        previous: comparison.objective.previous.objectiveAchievementRate,
        current: comparison.objective.current.objectiveAchievementRate,
        delta: comparison.objective.delta,
        direction: movement.objective.movement.direction,
      });
    }
    return rows;
  });
}

function hasUsableCurrentEvidence(data: OrganizationPerformanceIntelligenceResponse): boolean {
  return data.facts.metricComparisons.some((comparison) => comparison.current !== null)
    || data.facts.completionComparisons.some((comparison) =>
      comparison.completion.current !== null || comparison.objective.current !== null);
}

function collectCurrentQualifiers(data: OrganizationPerformanceIntelligenceResponse): TeamPerformanceQualifiers {
  const qualifiers: TeamPerformanceQualifiers[] = [
    ...(data.facts.activity.current.attemptCount > 0 ? [{
      limitedEvidence: data.facts.activity.current.evidenceStrength.limitedEvidence,
      concentrationWarning: data.facts.activity.current.concentrationWarning,
    }] : []),
    ...data.facts.metricComparisons.flatMap((comparison) => comparison.current?.observationCount
      ? [{
          limitedEvidence: comparison.current.evidenceStrength.limitedEvidence,
          concentrationWarning: comparison.current.concentrationWarning,
        }]
      : []),
    ...data.facts.completionComparisons.flatMap((comparison) => [
      comparison.completion.current,
      comparison.objective.current,
    ].flatMap((period) => period?.availableObservationCount
      ? [{
          limitedEvidence: period.evidenceStrength.limitedEvidence,
          concentrationWarning: period.concentrationWarning,
        }]
      : [])),
  ];
  return {
    limitedEvidence: qualifiers.some((entry) => entry.limitedEvidence),
    concentrationWarning: qualifiers.some((entry) => entry.concentrationWarning),
  };
}

function readableGeneration(value: string): string {
  return value.replaceAll("_", " ");
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatCoreScore(value: number): string {
  return `${value.toFixed(1)} / 10`;
}

function formatMovementScore(metric: OrganizationPerformanceMetric, value: number): string {
  return CORE_METRICS.has(metric) ? value.toFixed(1) : formatNumber(value);
}

function scoreScale(metric: OrganizationPerformanceMetric): string {
  return CORE_METRICS.has(metric) ? "/ 10" : "/ 100";
}

function formatDirection(direction: TeamPerformanceMovementDirection, delta: number, suffix = ""): string {
  if (direction === "unchanged") return "No change";
  const magnitude = Math.abs(delta);
  const displayedMagnitude = Math.round(magnitude * 10) / 10;
  const value = displayedMagnitude === 0 ? "<0.1" : formatNumber(magnitude);
  return `${direction === "up" ? "Up" : "Down"} ${value}${suffix}`;
}

function monthName(month: OrganizationPerformanceIntelligenceResponse["currentMonth"]): string {
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(month.year, month.month - 1, 1)));
}

function formatWeighting(profile: TeamPerformanceWeightProfile | undefined): string | null {
  if (profile?.kind !== "known") return null;
  const { weights } = profile;
  return `Weighting: Persuasion ${formatNumber(weights.persuasion * 100)}% · Clarity ${formatNumber(weights.clarity * 100)}% · Empathy ${formatNumber(weights.empathy * 100)}% · Assertiveness ${formatNumber(weights.assertiveness * 100)}%`;
}

function RelativeDimensionGroup({ group, showGeneration }: {
  group: TeamPerformanceRelativeDimension;
  showGeneration: boolean;
}) {
  const valueFor = (dimension: TeamPerformanceRelativeDimensionValueName) =>
    group.dimensions.find((entry) => entry.dimension === dimension)?.mean;
  return (
    <div className="leadership-relative-group">
      {showGeneration ? <h3>Scoring generation: {readableGeneration(group.scoringGeneration)}</h3> : null}
      {!group.available ? (
        <div className="manager-insight-neutral">
          <strong>Relative dimension comparison isn&apos;t available yet.</strong>
          <p>More complete scored evidence is needed across all four communication dimensions.</p>
        </div>
      ) : group.relativePosition === "balanced" ? (
        <div className="leadership-relative-balanced">
          <strong>Balanced across dimensions</strong>
          <strong className="leadership-balanced-score">{formatCoreScore(group.dimensions[0]!.mean)}</strong>
          <p>The four core dimensions have the same current-member average score.</p>
        </div>
      ) : (
        <div className="manager-relative-grid">
          <div className="leadership-relative-column">
            <h3>Highest-scoring dimension{group.highestDimensions.length === 1 ? "" : "s"}</h3>
            {group.highestDimensions.map((dimension) => (
              <div className="leadership-relative-item" key={dimension}>
                <span>{METRIC_LABELS[dimension]}</span>
                <strong>{formatCoreScore(valueFor(dimension)!)}</strong>
              </div>
            ))}
          </div>
          <div className="leadership-relative-column">
            <h3>Lowest-scoring dimension{group.lowestDimensions.length === 1 ? "" : "s"}</h3>
            {group.lowestDimensions.map((dimension) => (
              <div className="leadership-relative-item" key={dimension}>
                <span>{METRIC_LABELS[dimension]}</span>
                <strong>{formatCoreScore(valueFor(dimension)!)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type TeamPerformanceRelativeDimensionValueName = TeamPerformanceRelativeDimension["dimensions"][number]["dimension"];

function MetricMovementRows({ rows }: { rows: readonly LeadershipMetricMovementRow[] }) {
  if (rows.length === 0) return null;
  const duplicateMetrics = new Set(rows.filter((row, index) =>
    rows.findIndex((candidate) => candidate.metric === row.metric) !== index).map((row) => row.metric));
  return (
    <div className="leadership-movement-list">
      {rows.map((row, index) => (
        <div className="leadership-movement-row" key={`${row.metric}-${row.scoringGeneration}-${index}`}>
          <strong>{row.label}</strong>
          {duplicateMetrics.has(row.metric) ? (
            <span className="manager-movement-context">
              Scoring generation: {readableGeneration(row.scoringGeneration)}
              {formatWeighting(row.weightProfile) ? ` · ${formatWeighting(row.weightProfile)}` : ""}
            </span>
          ) : null}
          <div className="leadership-movement-flow">
            <span className="leadership-movement-previous">{formatMovementScore(row.metric, row.previous)}</span>
            <span className="leadership-movement-arrow" aria-hidden="true">→</span>
            <strong className="leadership-movement-current">
              {formatMovementScore(row.metric, row.current)} {scoreScale(row.metric)}
            </strong>
          </div>
          <span className="leadership-movement-direction">{formatDirection(row.direction, row.delta)}</span>
        </div>
      ))}
    </div>
  );
}

function RateMovementRows({ rows }: { rows: readonly LeadershipRateMovementRow[] }) {
  if (rows.length === 0) return null;
  const showGeneration = new Set(rows.map((row) => row.scoringGeneration)).size > 1;
  return (
    <div className="leadership-movement-list">
      {rows.map((row, index) => (
        <div className="leadership-movement-row" key={`${row.label}-${row.scoringGeneration}-${index}`}>
          <strong>{row.label}</strong>
          {showGeneration ? <span className="manager-movement-context">Scoring generation: {readableGeneration(row.scoringGeneration)}</span> : null}
          <div className="leadership-movement-flow">
            <span className="leadership-movement-previous">{Math.round(row.previous * 100)}%</span>
            <span className="leadership-movement-arrow" aria-hidden="true">→</span>
            <strong className="leadership-movement-current">{Math.round(row.current * 100)}%</strong>
          </div>
          <span className="leadership-movement-direction">{formatDirection(row.direction, row.delta * 100, " pts")}</span>
        </div>
      ))}
    </div>
  );
}

export function LeadershipInsights({ state }: { state: LeadershipInsightsState }) {
  return (
    <section className="section-card manager-insights leadership-insights" aria-labelledby="leadership-insights-title">
      <div className="section-header manager-insights-header">
        <div>
          <p className="eyebrow">Organization intelligence</p>
          <h2 id="leadership-insights-title">Leadership insights</h2>
          {state.kind === "success" ? (
            <p className="leadership-insights-basis-copy">
              Based on current members, including their qualifying earlier activity in this organization. Figures may differ from Group Summary because that view can include eligible historical contributions.
            </p>
          ) : (
            <p className="section-copy">Relative score context and month-to-month movement for current organization members.</p>
          )}
        </div>
      </div>

      {state.kind === "loading" ? (
        <div className="manager-insights-status" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <p>Loading leadership insights…</p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="manager-insight-neutral" role="status">
          <strong>Leadership insights are temporarily unavailable.</strong>
          <p>The Organization Group Summary above is still available.</p>
        </div>
      ) : null}

      {state.kind === "success" && !state.data.population.hasCurrentMembers ? (
        <div className="manager-insight-neutral">
          <strong>No current organization members are in scope.</strong>
          <p>Leadership insights will appear when current organization members are available.</p>
        </div>
      ) : null}

      {state.kind === "success"
        && state.data.population.hasCurrentMembers
        && !hasUsableCurrentEvidence(state.data) ? (
          <div className="manager-insight-neutral">
            <strong>No leadership performance insights for this month yet.</strong>
            <p>Insights will appear as current members complete scored practice.</p>
          </div>
        ) : null}

      {state.kind === "success"
        && state.data.population.hasCurrentMembers
        && hasUsableCurrentEvidence(state.data) ? (
          <LeadershipInsightsContent data={state.data} />
        ) : null}
    </section>
  );
}

function LeadershipInsightsContent({ data }: { data: OrganizationPerformanceIntelligenceResponse }) {
  const metricRows = buildLeadershipMetricMovementRows(data);
  const coreRows = metricRows.filter((row) => CORE_METRICS.has(row.metric));
  const performanceRows = metricRows.filter((row) => !CORE_METRICS.has(row.metric));
  const rateRows = buildRateMovementRows(data);
  const qualifiers = collectCurrentQualifiers(data);
  const hasComparableMovement = metricRows.length > 0 || rateRows.length > 0;
  const previousMonth = monthName(data.comparisonMonth);
  const currentMonth = monthName(data.currentMonth);
  return (
    <div className="manager-insights-content">
      {qualifiers.limitedEvidence || qualifiers.concentrationWarning ? (
        <div className="manager-insight-qualifiers" aria-label="Evidence qualifiers">
          {qualifiers.limitedEvidence ? <span>Limited evidence</span> : null}
          {qualifiers.concentrationWarning ? <span>Activity concentration</span> : null}
        </div>
      ) : null}

      <div className="manager-relative-stack" aria-label="Relative core dimensions">
        {data.signals.relativeDimensions.length > 0 ? data.signals.relativeDimensions.map((group, index) => (
          <RelativeDimensionGroup
            group={group}
            showGeneration={data.signals.relativeDimensions.length > 1}
            key={`${group.scoringGeneration}-${index}`}
          />
        )) : (
          <div className="manager-insight-neutral">
            <strong>Relative dimension comparison isn&apos;t available yet.</strong>
            <p>More complete scored evidence is needed across all four communication dimensions.</p>
          </div>
        )}
      </div>

      <div className="manager-movement" aria-labelledby="leadership-movement-title">
        <h3 id="leadership-movement-title">Movement vs {previousMonth}</h3>
        {!data.signals.monthCompleteness.complete ? (
          <div className="manager-insight-neutral manager-movement-empty">
            <p>Available after {currentMonth} closes.</p>
          </div>
        ) : !hasComparableMovement ? (
          <div className="manager-insight-neutral manager-movement-empty">
            <p>No comparable prior-month performance data is available.</p>
          </div>
        ) : (
          <div className="leadership-movement-stories">
            {coreRows.length > 0 ? (
              <div className="leadership-movement-group">
                <h4>Core dimensions</h4>
                <MetricMovementRows rows={coreRows} />
              </div>
            ) : null}
            {performanceRows.length > 0 || rateRows.length > 0 ? (
              <div className="leadership-movement-group">
                <h4>Outcomes</h4>
                <MetricMovementRows rows={performanceRows} />
                <RateMovementRows rows={rateRows} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
