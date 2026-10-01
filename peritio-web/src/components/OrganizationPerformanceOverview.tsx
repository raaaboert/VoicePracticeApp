"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";

import { ManagerInsights, type ManagerInsightsState } from "./ManagerInsights";
import { LeadershipInsights, type LeadershipInsightsState } from "./LeadershipInsights";

import {
  type OrganizationPerformanceCalendarMonth,
  type OrganizationPerformanceClientResult,
  type OrganizationPerformanceMetric,
  type OrganizationPerformanceMetricGroup,
  type OrganizationPerformanceResponse,
  type PerformanceGroupScope,
  getPerformanceGroupSummary,
} from "@/src/lib/organizationPerformance";
import {
  calendarMonthFromLocalDate,
  canNavigateToNextMonth,
  collectOrganizationPerformanceEvidenceNotices,
  formatCalendarMonth,
  formatOrganizationPerformanceScore,
  formatOrganizationPerformanceWeighting,
  getHistoricalContextCopy,
  groupMetricsByScoringGeneration,
  isOrganizationPerformanceRequestCurrent,
  isOrganizationPerformanceEmpty,
  shiftCalendarMonth,
} from "@/src/components/organizationPerformancePresentation";
import {
  getTeamPerformanceIntelligence,
  isTeamPerformanceIntelligenceRequestCurrent,
} from "../lib/teamPerformanceIntelligence";
import {
  getOrganizationPerformanceIntelligence,
  isOrganizationPerformanceIntelligenceRequestCurrent,
} from "../lib/organizationPerformanceIntelligence";

const METRIC_LABELS: Record<OrganizationPerformanceMetric, string> = {
  persuasion: "Persuasion",
  clarity: "Clarity",
  empathy: "Empathy",
  assertiveness: "Assertiveness",
  communication: "Communication",
  outcome: "Outcome",
  overall: "Overall",
};

const METRIC_SECTIONS: readonly {
  kind: "core" | "composite";
  title: string;
  metrics: readonly OrganizationPerformanceMetric[];
}[] = [
  { kind: "core", title: "Core dimensions", metrics: ["persuasion", "clarity", "empathy", "assertiveness"] },
  { kind: "composite", title: "Composite / outcome metrics", metrics: ["communication", "outcome", "overall"] },
];

function formatRate(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function readableGeneration(value: string): string {
  return value.replaceAll("_", " ");
}

export function PerformanceDimensionGroups({ metrics }: { metrics: readonly OrganizationPerformanceMetricGroup[] }) {
  return (
    <div className="performance-dimension-groups">
      {METRIC_SECTIONS.map((section) => {
        const sectionMetrics = metrics
          .filter((metric) => section.metrics.includes(metric.metric))
          .sort((left, right) => section.metrics.indexOf(left.metric) - section.metrics.indexOf(right.metric));
        return sectionMetrics.length > 0 ? (
          <section className="performance-dimension-section" aria-label={section.title} key={section.kind}>
            <h4>{section.title}</h4>
            <div className={`performance-dimension-grid performance-dimension-grid--${section.kind}`}>
              {sectionMetrics.map((metric, index) => (
                <article className="performance-dimension-card" key={`${metric.metric}-${index}`}>
                  <p className="metric-label">{METRIC_LABELS[metric.metric]}</p>
                  <strong className="performance-dimension-value">
                    {formatOrganizationPerformanceScore(metric.metric, metric.mean)}
                  </strong>
                  <div className="performance-dimension-meta">
                    <span>{metric.qualifyingObservationCount} qualifying observation{metric.qualifyingObservationCount === 1 ? "" : "s"}</span>
                    {metric.metric === "communication" || metric.metric === "overall" ? (
                      <span>{formatOrganizationPerformanceWeighting(metric.weightProfile)}</span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null;
      })}
    </div>
  );
}

export function PerformanceGroupSummary({
  scope,
  orgId,
  orgName,
}: {
  scope: PerformanceGroupScope;
  orgId: string;
  orgName: string | null;
}) {
  const [currentMonth, setCurrentMonth] = useState<OrganizationPerformanceCalendarMonth | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<OrganizationPerformanceCalendarMonth | null>(null);
  const [result, setResult] = useState<OrganizationPerformanceClientResult | null>(null);
  const [intelligenceState, setIntelligenceState] = useState<ManagerInsightsState | null>(null);
  const [leadershipInsightsState, setLeadershipInsightsState] = useState<LeadershipInsightsState | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const localMonth = calendarMonthFromLocalDate(new Date());
    setCurrentMonth(localMonth);
    setSelectedMonth(localMonth);
  }, []);

  useEffect(() => {
    if (!selectedMonth) {
      return;
    }
    const controller = new AbortController();
    setResult(null);
    void getPerformanceGroupSummary({
      scope,
      orgId,
      year: selectedMonth.year,
      month: selectedMonth.month,
      signal: controller.signal,
    }).then((nextResult) => {
      if (isOrganizationPerformanceRequestCurrent(controller.signal)) {
        setResult(nextResult);
      }
    }).catch(() => {
      if (isOrganizationPerformanceRequestCurrent(controller.signal)) {
        setResult({ kind: "error", message: "Performance data could not be loaded. Please retry." });
      }
    });
    return () => controller.abort();
  }, [orgId, requestVersion, scope, selectedMonth]);

  useEffect(() => {
    if (scope !== "organization" || !selectedMonth) {
      setLeadershipInsightsState(null);
      return;
    }
    const controller = new AbortController();
    setLeadershipInsightsState({ kind: "loading" });
    void getOrganizationPerformanceIntelligence({
      orgId,
      year: selectedMonth.year,
      month: selectedMonth.month,
      signal: controller.signal,
    }).then((nextResult) => {
      if (!isOrganizationPerformanceIntelligenceRequestCurrent(controller.signal)) return;
      setLeadershipInsightsState(nextResult.kind === "success"
        ? { kind: "success", data: nextResult.data }
        : { kind: "error" });
    }).catch(() => {
      if (isOrganizationPerformanceIntelligenceRequestCurrent(controller.signal)) {
        setLeadershipInsightsState({ kind: "error" });
      }
    });
    return () => controller.abort();
  }, [orgId, requestVersion, scope, selectedMonth]);

  useEffect(() => {
    if (scope !== "team" || !selectedMonth) {
      setIntelligenceState(null);
      return;
    }
    const controller = new AbortController();
    setIntelligenceState({ kind: "loading" });
    void getTeamPerformanceIntelligence({
      orgId,
      year: selectedMonth.year,
      month: selectedMonth.month,
      signal: controller.signal,
    }).then((nextResult) => {
      if (!isTeamPerformanceIntelligenceRequestCurrent(controller.signal)) return;
      setIntelligenceState(nextResult.kind === "success"
        ? { kind: "success", data: nextResult.data }
        : { kind: "error" });
    }).catch(() => {
      if (isTeamPerformanceIntelligenceRequestCurrent(controller.signal)) {
        setIntelligenceState({ kind: "error" });
      }
    });
    return () => controller.abort();
  }, [orgId, requestVersion, scope, selectedMonth]);

  const data = result?.kind === "success" ? result.data : null;
  const evidenceNotices = useMemo(
    () => data ? collectOrganizationPerformanceEvidenceNotices(data) : null,
    [data]
  );
  const metricGenerations = useMemo(
    () => data ? groupMetricsByScoringGeneration(data.metricGroups) : [],
    [data]
  );

  const moveMonth = (offset: -1 | 1) => {
    setResult(null);
    setIntelligenceState(scope === "team" ? { kind: "loading" } : null);
    setLeadershipInsightsState(scope === "organization" ? { kind: "loading" } : null);
    setSelectedMonth((value) => value ? shiftCalendarMonth(value, offset) : value);
  };

  const retry = () => {
    setResult(null);
    setRequestVersion((value) => value + 1);
  };

  return (
    <div className="performance-stack organization-performance-overview">
      <header className="organization-performance-toolbar" aria-label="Performance period">
        <PerformanceGroupSummaryHeader scope={scope} orgName={orgName} />
        <div className="month-selector" role="group" aria-label="Calendar month selector">
          <button className="ghost-button month-button" type="button" onClick={() => moveMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <strong className="month-label" aria-live="polite">
            {selectedMonth ? formatCalendarMonth(selectedMonth) : "Current month"}
          </strong>
          <button
            className="ghost-button month-button"
            type="button"
            onClick={() => moveMonth(1)}
            disabled={!selectedMonth || !currentMonth || !canNavigateToNextMonth(selectedMonth, currentMonth)}
            aria-label="Next month"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {!selectedMonth || result === null ? <PerformanceLoadingState /> : null}

      {result?.kind === "access_denied" ? (
        <PerformanceStatePanel
          title={`You don’t have ${scope} performance access.`}
          copy={scope === "team"
            ? "Your dashboard access does not include team performance results."
            : "Your dashboard access does not include organization-wide performance results."}
        />
      ) : null}

      {result?.kind === "not_found" ? (
        <PerformanceStatePanel
          title="Performance view unavailable"
          copy={`This ${scope} performance view is unavailable or outside your dashboard scope.`}
        />
      ) : null}

      {result?.kind === "error" ? (
        <section className="section-card" role="alert">
          <div className="empty-state-panel">
            <h2>Performance data could not be loaded</h2>
            <p>{result.message}</p>
            <button className="primary-button" type="button" onClick={retry}>
              Retry
            </button>
          </div>
        </section>
      ) : null}

      {data ? (
        <>
          {isOrganizationPerformanceEmpty(data) ? (
            <PerformanceStatePanel
              title={scope === "team"
                ? "No team performance data for this month yet."
                : "No performance data for this month yet."}
              copy={scope === "team"
                ? "Results will appear as current direct reports complete scored practice."
                : "Organization results will appear after scored practice sessions are available for this month."}
            />
          ) : (
            <>
              {data.activity ? (
                <section aria-labelledby="activity-summary-title">
                  <div className="section-header compact-section-header">
                    <div>
                      <p className="eyebrow">Activity</p>
                      <h2 id="activity-summary-title">Practice this month</h2>
                    </div>
                  </div>
                  <div className="metric-grid organization-activity-grid">
                    <article className="performance-activity-kpi">
                      <p className="metric-label">Attempts</p>
                      <strong className="metric-value">{data.activity.attemptCount}</strong>
                      <p className="metric-meta">Scored practice attempts</p>
                    </article>
                    <article className="performance-activity-kpi">
                      <p className="metric-label">Conclusive attempts</p>
                      <strong className="metric-value">{data.activity.conclusiveAttemptCount}</strong>
                      <p className="metric-meta">Attempts with a conclusive result</p>
                    </article>
                  </div>
                </section>
              ) : null}

              {data.completionGroups.length > 0 ? (
                <section className="section-card" aria-labelledby="completion-title">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">Outcomes</p>
                      <h2 id="completion-title">Completion and objectives</h2>
                      <p className="section-copy">Results stay separated by scoring generation.</p>
                    </div>
                  </div>
                  <div className="generation-stack">
                    {data.completionGroups.map((group) => (
                      <div className="generation-group" key={group.scoringGeneration}>
                        <h3>Scoring generation: {readableGeneration(group.scoringGeneration)}</h3>
                        <div className="metric-grid organization-outcome-grid">
                          {group.completion ? (
                            <article className="metric-card">
                              <p className="metric-label">Completion</p>
                              <strong className="metric-value">{formatRate(group.completion.completionRate)}</strong>
                              <p className="metric-meta">
                                {group.completion.completeCount} complete of {group.completion.availableObservationCount} available observations
                              </p>
                            </article>
                          ) : null}
                          {group.objective ? (
                            <article className="metric-card warm">
                              <p className="metric-label">Objective achievement</p>
                              <strong className="metric-value">{formatRate(group.objective.objectiveAchievementRate)}</strong>
                              <p className="metric-meta">
                                {group.objective.achievedCount} achieved of {group.objective.availableObservationCount} available observations
                              </p>
                            </article>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {metricGenerations.length > 0 ? (
                <section className="section-card" aria-labelledby="dimensions-title">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">Scores</p>
                      <h2 id="dimensions-title">Performance dimensions</h2>
                      <p className="section-copy">Each score is shown in its original scoring generation and weight profile.</p>
                    </div>
                  </div>
                  <div className="generation-stack">
                    {metricGenerations.map((generation) => (
                      <div className="generation-group" key={generation.scoringGeneration}>
                        <h3>Scoring generation: {readableGeneration(generation.scoringGeneration)}</h3>
                        <PerformanceDimensionGroups metrics={generation.metrics} />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
          {scope === "team" && intelligenceState ? <ManagerInsights state={intelligenceState} /> : null}
          {scope === "organization" && leadershipInsightsState ? (
            <LeadershipInsights state={leadershipInsightsState} />
          ) : null}
          <PerformanceNotices scope={scope} data={data} evidenceNotices={evidenceNotices!} />
        </>
      ) : null}

    </div>
  );
}

export function PerformanceGroupSummaryHeader({
  scope,
  orgName,
}: {
  scope: PerformanceGroupScope;
  orgName: string | null;
}) {
  if (scope === "team") {
    return (
      <div>
        <p className="eyebrow">Team scope</p>
        <h2>Your team</h2>
        <p className="section-copy">
          Current direct reports{orgName ? ` in ${orgName}` : ""} · Scored practice for the selected UTC calendar month.
        </p>
      </div>
    );
  }
  return (
    <div>
      <h2>{orgName ?? "Organization performance"}</h2>
      <p className="section-copy">Organization scope · Scored practice for the selected UTC calendar month.</p>
    </div>
  );
}

function PerformanceLoadingState() {
  return (
    <section className="section-card performance-loading-state" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={26} aria-hidden="true" />
      <div>
        <h2>Loading performance data…</h2>
        <p className="section-copy">Preparing organization results for the selected month.</p>
      </div>
    </section>
  );
}

function PerformanceStatePanel({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="section-card">
      <div className="empty-state-panel">
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
    </section>
  );
}

export function PerformanceNotices({
  scope = "organization",
  data,
  evidenceNotices,
}: {
  scope?: PerformanceGroupScope;
  data: OrganizationPerformanceResponse;
  evidenceNotices: { limitedEvidence: boolean; concentrationWarning: boolean };
}) {
  const historicalCopy = scope === "team" ? [] : getHistoricalContextCopy(data);
  if (!evidenceNotices.limitedEvidence && !evidenceNotices.concentrationWarning && historicalCopy.length === 0) {
    return null;
  }
  return (
    <section className="performance-summary-notes" aria-labelledby="performance-summary-notes-title">
      <h2 id="performance-summary-notes-title">Important notes about this summary</h2>
      <div className="performance-summary-notes-list">
        {evidenceNotices.limitedEvidence ? (
          <div className="performance-summary-note">
            <strong>Limited evidence</strong>
            <p>Results are based on a small amount of practice and may change as more sessions are completed.</p>
          </div>
        ) : null}
        {evidenceNotices.concentrationWarning ? (
          <div className="performance-summary-note">
            <strong>Activity concentration</strong>
            <p>A small number of highly active participants account for a large share of this activity.</p>
          </div>
        ) : null}
        {historicalCopy.length > 0 ? (
          <div className="performance-summary-note">
            <strong>Historical data included</strong>
            <p>{historicalCopy[0]}</p>
          </div>
        ) : null}
        {historicalCopy.length > 1 ? (
          <div className="performance-summary-note">
            <strong>Historical privacy adjustment</strong>
            <p>{historicalCopy[1]}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
