"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DashboardAttemptDetailResponse,
  DashboardAttemptHistoryRow,
  DashboardUserAttemptHistoryResponse,
} from "@voicepractice/shared";

import { formatDateTime, formatRawSeconds, formatScore } from "@/src/lib/formatters";

type AttemptFilters = {
  focusTopicId: string;
  scenario: string;
  startDate: string;
  endDate: string;
};

const EMPTY_FILTERS: AttemptFilters = {
  focusTopicId: "", scenario: "", startDate: "", endDate: "",
};

function historyUrl(userId: string, divisionId: string | null, filters: AttemptFilters, cursor?: string | null): string {
  const query = new URLSearchParams({ limit: "20" });
  if (divisionId) query.set("divisionId", divisionId);
  if (filters.focusTopicId) query.set("focusTopicId", filters.focusTopicId);
  if (filters.scenario.trim()) query.set("scenario", filters.scenario.trim());
  if (filters.startDate) query.set("startDate", filters.startDate);
  if (filters.endDate) query.set("endDate", filters.endDate);
  if (cursor) query.set("cursor", cursor);
  return `/api/dashboard/users/${encodeURIComponent(userId)}/attempts?${query.toString()}`;
}

function AttemptHistoryRow({ attempt, divisionId }: { attempt: DashboardAttemptHistoryRow; divisionId: string | null }) {
  const [detail, setDetail] = useState<DashboardAttemptDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = async () => {
    if (detail || loading) return;
    setLoading(true); setError(null);
    try {
      const query = divisionId ? `?divisionId=${encodeURIComponent(divisionId)}` : "";
      const response = await fetch(`/api/dashboard/attempts/${encodeURIComponent(attempt.activityId)}${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load scoring details.");
      setDetail(await response.json() as DashboardAttemptDetailResponse);
    } catch {
      setError("Could not load scoring details. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const score = detail?.attempt.scoreBreakdown;
  return <details className="user-attempt-history-row" onToggle={(event) => {
    if ((event.currentTarget as HTMLDetailsElement).open) void loadDetail();
  }}>
    <summary>
      <span>{formatDateTime(attempt.endedAt)}</span>
      <span>{attempt.focusTopicTitle ?? "Unattributed"}</span>
      <span>{attempt.scenarioTitle ?? attempt.scenarioId}</span>
      <span>{attempt.overallScore === null ? "-" : formatScore(attempt.overallScore)}</span>
      <span>{formatRawSeconds(attempt.rawDurationSeconds)}</span>
      <span className="user-attempt-history-disclosure">View details</span>
    </summary>
    <div className="user-attempt-history-detail" aria-live="polite">
      {loading ? <p className="muted-copy">Loading scoring details…</p> : null}
      {error ? <p className="notice danger" role="alert">{error}</p> : null}
      {detail ? <>
        <p>{detail.attempt.summary ?? "No saved scoring narrative is available for this attempt."}</p>
        {score ? <dl className="user-attempt-score-breakdown">
          <div><dt>Overall</dt><dd>{formatScore(score.overallScore)}</dd></div>
          <div><dt>Communication</dt><dd>{score.communicationScore === null ? "-" : formatScore(score.communicationScore)}</dd></div>
          <div><dt>Outcome</dt><dd>{score.outcomeScore === null ? "-" : formatScore(score.outcomeScore)}</dd></div>
          <div><dt>Persuasion</dt><dd>{formatScore(score.persuasion)}</dd></div>
          <div><dt>Clarity</dt><dd>{formatScore(score.clarity)}</dd></div>
          <div><dt>Empathy</dt><dd>{formatScore(score.empathy)}</dd></div>
          <div><dt>Assertiveness</dt><dd>{formatScore(score.assertiveness)}</dd></div>
        </dl> : null}
        {detail.attempt.coachingArtifact ? <div className="user-attempt-coaching">
          {detail.attempt.coachingArtifact.strengths.length > 0 ? <p><strong>Strengths:</strong> {detail.attempt.coachingArtifact.strengths.join(" · ")}</p> : null}
          {detail.attempt.coachingArtifact.improvementAreas.length > 0 ? <p><strong>Improvement areas:</strong> {detail.attempt.coachingArtifact.improvementAreas.join(" · ")}</p> : null}
          {detail.attempt.coachingArtifact.coachingPriority ? <p><strong>Coaching priority:</strong> {detail.attempt.coachingArtifact.coachingPriority}</p> : null}
        </div> : null}
      </> : null}
    </div>
  </details>;
}

export function UserAttemptHistory({ userId, divisionId }: { userId: string; divisionId: string | null }) {
  const [draftFilters, setDraftFilters] = useState<AttemptFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AttemptFilters>(EMPTY_FILTERS);
  const [history, setHistory] = useState<DashboardUserAttemptHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filterKey = useMemo(() => JSON.stringify(appliedFilters), [appliedFilters]);

  const load = useCallback(async (cursor: string | null, append: boolean) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const response = await fetch(historyUrl(userId, divisionId, appliedFilters, cursor), { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load scored attempt history.");
      const next = await response.json() as DashboardUserAttemptHistoryResponse;
      setHistory((current) => append && current ? {
        ...next,
        attempts: [...current.attempts, ...next.attempts],
      } : next);
    } catch {
      setError("Could not load scored attempt history. Please try again.");
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, [appliedFilters, divisionId, userId]);

  useEffect(() => { void load(null, false); }, [filterKey, load]);

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);
  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters({ ...draftFilters });
  };
  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  };
  const topics = history?.focusTopics ?? [];

  return <section className="user-attempt-history" aria-label="Scored attempt history">
    <form className="user-attempt-history-filters" onSubmit={applyFilters}>
      <label>Focus Topic
        <select className="text-input" value={draftFilters.focusTopicId}
          onChange={(event) => setDraftFilters((current) => ({ ...current, focusTopicId: event.target.value }))}>
          <option value="">All Focus Topics</option>
          {topics.map((topic) => <option key={topic.topicId} value={topic.topicId}>{topic.topicTitle}</option>)}
        </select>
      </label>
      <label>Scenario
        <input className="text-input" value={draftFilters.scenario} placeholder="Search scenarios"
          onChange={(event) => setDraftFilters((current) => ({ ...current, scenario: event.target.value }))} />
      </label>
      <label>Start date
        <input className="text-input" type="date" value={draftFilters.startDate}
          onChange={(event) => setDraftFilters((current) => ({ ...current, startDate: event.target.value }))} />
      </label>
      <label>End date
        <input className="text-input" type="date" value={draftFilters.endDate}
          onChange={(event) => setDraftFilters((current) => ({ ...current, endDate: event.target.value }))} />
      </label>
      <div className="user-attempt-history-filter-actions">
        <button type="submit" className="primary-button" disabled={loading}>Apply filters</button>
        <button type="button" className="ghost-button" disabled={!hasActiveFilters && !Object.values(draftFilters).some(Boolean)} onClick={clearFilters}>Clear filters</button>
      </div>
    </form>

    {error ? <div className="notice danger" role="alert">{error}</div> : null}
    {loading ? <p className="muted-copy" role="status">Loading scored attempt history…</p> : null}
    {!loading && !error && history?.attempts.length === 0 ? <div className="empty-state-panel">
      <h3>{hasActiveFilters ? "No attempts match these filters" : "No scored attempts found"}</h3>
      <p>{hasActiveFilters ? "Try changing or clearing the current filters." : "Scored attempts will appear here when they are available in this dashboard scope."}</p>
    </div> : null}
    {history && history.attempts.length > 0 ? <div className="user-attempt-history-list">
      <div className="user-attempt-history-header" aria-hidden="true">
        <span>When</span><span>Focus Topic</span><span>Scenario</span><span>Score</span><span>Duration</span><span>Review</span>
      </div>
      {history.attempts.map((attempt) => <AttemptHistoryRow key={attempt.activityId} attempt={attempt} divisionId={divisionId} />)}
    </div> : null}
    {history?.hasMore ? <button type="button" className="ghost-button" disabled={loadingMore}
      onClick={() => { if (history.nextCursor) void load(history.nextCursor, true); }}>
      {loadingMore ? "Loading more…" : "Load more"}
    </button> : null}
  </section>;
}
