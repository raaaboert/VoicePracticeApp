import React from "react";
import { LoaderCircle } from "lucide-react";

import { formatOrganizationPerformanceScore } from "./organizationPerformancePresentation";
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

function formatDirection(direction: TeamPerformanceMovementDirection, delta: number, suffix = ""): string {
  if (direction === "unchanged") return "No change";
  return `${direction === "up" ? "Up" : "Down"} ${formatNumber(Math.abs(delta))}${suffix}`;
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
    <div className="manager-insight-group">
      {showGeneration ? <h3>Scoring generation: {readableGeneration(group.scoringGeneration)}</h3> : null}
      {!group.available ? (
        <div className="manager-insight-neutral">
          <strong>Relative dimension comparison isn&apos;t available yet.</strong>
          <p>More complete scored evidence is needed across all four communication dimensions.</p>
        </div>
      ) : group.relativePosition === "balanced" ? (
        <div className="manager-insight-neutral">
          <strong>Balanced across dimensions</strong>
          <p>The four core dimensions have the same current-member average score.</p>
        </div>
      ) : (
        <div className="manager-relative-grid">
          <div className="manager-relative-column">
            <h3>Highest-scoring dimension{group.highestDimensions.length === 1 ? "" : "s"}</h3>
            {group.highestDimensions.map((dimension) => (
              <p key={dimension}>
                <span>{METRIC_LABELS[dimension]}</span>
                <strong>{formatOrganizationPerformanceScore(dimension, valueFor(dimension)!)}</strong>
              </p>
            ))}
          </div>
          <div className="manager-relative-column">
            <h3>Lowest-scoring dimension{group.lowestDimensions.length === 1 ? "" : "s"}</h3>
            {group.lowestDimensions.map((dimension) => (
              <p key={dimension}>
                <span>{METRIC_LABELS[dimension]}</span>
                <strong>{formatOrganizationPerformanceScore(dimension, valueFor(dimension)!)}</strong>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type TeamPerformanceRelativeDimensionValueName = TeamPerformanceRelativeDimension["dimensions"][number]["dimension"];

function MetricMovementRows({ title, rows }: { title: string; rows: readonly LeadershipMetricMovementRow[] }) {
  if (rows.length === 0) return null;
  const duplicateMetrics = new Set(rows.filter((row, index) =>
    rows.findIndex((candidate) => candidate.metric === row.metric) !== index).map((row) => row.metric));
  return (
    <div className="manager-movement-group">
      <h3>{title}</h3>
      <div className="manager-movement-list">
        {rows.map((row, index) => (
          <div className="manager-movement-row" key={`${row.metric}-${row.scoringGeneration}-${index}`}>
            <div>
              <strong>{row.label}</strong>
              {duplicateMetrics.has(row.metric) ? (
                <span className="manager-movement-context">
                  Scoring generation: {readableGeneration(row.scoringGeneration)}
                  {formatWeighting(row.weightProfile) ? ` · ${formatWeighting(row.weightProfile)}` : ""}
                </span>
              ) : null}
            </div>
            <span className="manager-movement-values">
              {formatOrganizationPerformanceScore(row.metric, row.previous)} → {formatOrganizationPerformanceScore(row.metric, row.current)}
            </span>
            <strong className={`manager-movement-direction manager-movement-direction--${row.direction}`}>
              {formatDirection(row.direction, row.delta)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RateMovementRows({ rows }: { rows: readonly LeadershipRateMovementRow[] }) {
  if (rows.length === 0) return null;
  const showGeneration = new Set(rows.map((row) => row.scoringGeneration)).size > 1;
  return (
    <div className="manager-movement-group">
      <h3>Completion &amp; objective movement</h3>
      <div className="manager-movement-list">
        {rows.map((row, index) => (
          <div className="manager-movement-row" key={`${row.label}-${row.scoringGeneration}-${index}`}>
            <div>
              <strong>{row.label}</strong>
              {showGeneration ? <span className="manager-movement-context">Scoring generation: {readableGeneration(row.scoringGeneration)}</span> : null}
            </div>
            <span className="manager-movement-values">
              {Math.round(row.previous * 100)}% → {Math.round(row.current * 100)}%
            </span>
            <strong className={`manager-movement-direction manager-movement-direction--${row.direction}`}>
              {formatDirection(row.direction, row.delta * 100, " pts")}
            </strong>
          </div>
        ))}
      </div>
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
          <p className="section-copy">Relative score context and month-to-month movement for current organization members.</p>
        </div>
      </div>

      {state.kind === "success" ? (
        <div className="leadership-insights-basis">
          <strong>Current members</strong>
          <p>These insights reflect current organization members, including their qualifying earlier activity in this organization.</p>
          <p>These figures may differ from the Group Summary above, which can include eligible historical contributions.</p>
        </div>
      ) : null}

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
        <h3 id="leadership-movement-title">Movement vs previous month</h3>
        {!data.signals.monthCompleteness.complete ? (
          <div className="manager-insight-neutral manager-movement-empty">
            <p>Month-to-month movement will be available after this month closes.</p>
          </div>
        ) : !hasComparableMovement ? (
          <div className="manager-insight-neutral manager-movement-empty">
            <p>No comparable prior-month performance data is available.</p>
          </div>
        ) : (
          <>
            <MetricMovementRows title="Core dimensions" rows={coreRows} />
            <MetricMovementRows title="Overall performance" rows={performanceRows} />
            <RateMovementRows rows={rateRows} />
          </>
        )}
      </div>
    </div>
  );
}
