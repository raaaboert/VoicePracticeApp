import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { DashboardNarrativePanel } from "@/src/components/DashboardNarrativePanel";
import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getDashboardUserDetail } from "@/src/lib/auth";
import { buildUserDetailNarrative } from "@/src/lib/dashboardNarratives";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDateTime, formatRawSeconds, formatScore, formatUsageMinutes } from "@/src/lib/formatters";

function formatAssignmentStatus(status: string): string {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "in_progress") {
    return "In Progress";
  }
  return "Not Started";
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "User Detail",
  };
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  let payload;
  try {
    payload = await getDashboardUserDetail(userId);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }

    if (error instanceof DashboardAccessDeniedError) {
      redirect("/app/access-denied?reason=user-scope");
    }
    throw error;
  }

  if (!payload) {
    notFound();
  }

  const { user, assignments, attempts } = payload;
  const narrative = buildUserDetailNarrative(payload);
  const recentAttempts = attempts.filter((attempt) => {
    const endedAtMs = new Date(attempt.endedAt).getTime();
    const now = Date.now();
    const last30DaysThreshold = now - 30 * 24 * 60 * 60 * 1000;
    return Number.isFinite(endedAtMs) && endedAtMs >= last30DaysThreshold && endedAtMs < now;
  });
  const trainingCounts = new Map<string, number>();
  const scenarioCounts = new Map<string, number>();
  for (const attempt of recentAttempts) {
    if (attempt.trainingPackTitle) {
      trainingCounts.set(attempt.trainingPackTitle, (trainingCounts.get(attempt.trainingPackTitle) ?? 0) + 1);
    }
    const scenarioLabel = attempt.scenarioTitle ?? attempt.scenarioId;
    if (scenarioLabel) {
      scenarioCounts.set(scenarioLabel, (scenarioCounts.get(scenarioLabel) ?? 0) + 1);
    }
  }
  const dominantTraining =
    [...trainingCounts.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })[0] ?? null;
  const dominantScenario =
    [...scenarioCounts.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })[0] ?? null;

  return (
    <>
      <PageHeader
        eyebrow="User detail"
        title={user.email}
        description="This drilldown shows persisted score-backed attempt history and current assignment progress. Raw transcripts are not stored for normal dashboard review."
      />

      <DashboardNarrativePanel
        eyebrow="Quick read"
        title="What a manager should conclude"
        narrative={narrative}
        badges={[
          `${user.simulationsLast30Days} simulations`,
          `${user.scoredAttemptsLast30Days} scored attempts`,
        ]}
      />

      <section className="metric-grid metric-grid-primary">
        <MetricCard
          label="Simulations"
          value={`${user.simulationsLast30Days}`}
          meta={`${user.uniqueScenariosLast30Days} scenarios in the last 30 days`}
        />
        <MetricCard
          label="Usage"
          value={formatUsageMinutes(user.usedMinutesLast30Days)}
          meta={`${user.trainingPackAttemptsLast30Days} pack-linked attempts`}
          tone="accent"
        />
        <MetricCard
          label="Average score"
          value={user.averageScoreLast30Days !== null ? formatScore(user.averageScoreLast30Days) : "-"}
          meta={`${user.scoredAttemptsLast30Days} conclusive scored attempts in the last 30 days`}
          tone="positive"
        />
        <MetricCard
          label="Latest activity"
          value={formatDateTime(user.latestActivityAt)}
          meta={user.latestScenarioTitle ?? "No recent scenario"}
        />
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Movement and focus</p>
            <h2>Where to coach next</h2>
            <p className="section-copy">
              These cards separate effort, dominant practice areas, and repeated coaching signals before you open the raw attempt history.
            </p>
          </div>
        </div>

        <div className="info-grid">
          <article className="detail-card">
            <p className="metric-label">Dominant training</p>
            <strong className="metric-value dashboard-insight-value">{dominantTraining?.[0] ?? "No recent pack focus"}</strong>
            <p className="metric-meta">
              {dominantTraining ? `${dominantTraining[1]} scored attempts in the last 30 days` : "This fills in when scored attempts cluster around a pack."}
            </p>
          </article>
          <article className="detail-card">
            <p className="metric-label">Dominant scenario</p>
            <strong className="metric-value dashboard-insight-value">{dominantScenario?.[0] ?? "No recent scenario focus"}</strong>
            <p className="metric-meta">
              {dominantScenario ? `${dominantScenario[1]} scored attempts in the last 30 days` : "This fills in when scored attempts cluster around a scenario."}
            </p>
          </article>
          <article className="detail-card">
            <p className="metric-label">Repeated strength</p>
            <strong className="metric-value dashboard-insight-value">{payload.coachingInsights.topStrengths[0]?.theme ?? "Not enough coverage"}</strong>
            <p className="metric-meta">
              {payload.coachingInsights.topStrengths[0]
                ? `${payload.coachingInsights.topStrengths[0].countLast30Days} artifact-backed mentions in the last 30 days`
                : "Strength themes appear once artifact-backed scoring coverage is sufficient."}
            </p>
          </article>
          <article className="detail-card">
            <p className="metric-label">Coaching priority</p>
            <strong className="metric-value dashboard-insight-value">
              {payload.coachingInsights.topCoachingPriorities[0]?.theme ?? payload.coachingInsights.repeatedFocusArea ?? "Not enough coverage"}
            </strong>
            <p className="metric-meta">
              {payload.coachingInsights.topCoachingPriorities[0]
                ? `${payload.coachingInsights.topCoachingPriorities[0].countLast30Days} artifact-backed mentions in the last 30 days`
                : "Priority themes appear once artifact-backed scoring coverage is sufficient."}
            </p>
          </article>
        </div>
      </section>

      <CoachingInsightsSection
        eyebrow="Coaching themes"
        title="Repeated coaching focus for this user"
        description="These user-level coaching aggregates come only from persisted coaching artifacts on scored attempts in the last 30 days. They highlight repeated themes without storing transcript history."
        insights={payload.coachingInsights}
        emptyMessage="This user does not yet have enough artifact-backed scored attempts in the last 30 days to show aggregate coaching themes."
      />

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Details</p>
            <h2>Current training progress</h2>
            <p className="section-copy">
              Assignment progress is derived from pack-linked persisted activity only. Unattributed historical activity does not count toward completion.
            </p>
          </div>
        </div>
        {assignments.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Training pack</th>
                  <th>Status</th>
                  <th>Assigned</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Scenario progress</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.assignmentId}>
                    <td>
                      <Link className="inline-link subtle" href={`/app/training/${assignment.trainingPackId}/assignments/${assignment.assignmentId}`}>
                        {assignment.trainingPackTitle}
                      </Link>
                    </td>
                    <td>{formatAssignmentStatus(assignment.status)}</td>
                    <td>{formatDateTime(assignment.assignedAt)}</td>
                    <td>{formatDateTime(assignment.startedAt)}</td>
                    <td>{formatDateTime(assignment.completedAt)}</td>
                    <td>{assignment.completedScenarioCount}/{assignment.requiredScenarioCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <article className="detail-card">
            <h3>No active assignments</h3>
            <p>This user does not currently have an active training-pack assignment in their visible customer scope.</p>
          </article>
        )}
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Details</p>
            <h2>Recent conclusive scored attempts</h2>
            <p className="section-copy">
              These rows come from persisted score records, including saved score summaries and coaching priorities when available. Transcript text is not retained for normal dashboard review. Score averages here reflect conclusive scored attempts, not guaranteed objective achievement.
            </p>
          </div>
        </div>
        {attempts.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Scenario</th>
                  <th>Training pack</th>
                  <th>Assignment context</th>
                  <th>Score</th>
                  <th>Duration</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.activityId}>
                    <td>{formatDateTime(attempt.endedAt)}</td>
                    <td>
                      <Link className="inline-link subtle" href={`/app/attempts/${attempt.activityId}`}>
                        {attempt.scenarioTitle ?? attempt.scenarioId}
                      </Link>
                    </td>
                    <td>{attempt.trainingPackTitle ?? "Unattributed"}</td>
                    <td>{attempt.assignmentContextStatus.replaceAll("_", " ")}</td>
                    <td>{attempt.overallScore !== null ? formatScore(attempt.overallScore) : "-"}</td>
                    <td>{formatRawSeconds(attempt.rawDurationSeconds)}</td>
                    <td>
                      <div>{attempt.summary ?? "No persisted score summary."}</div>
                      <div className="table-subcopy">
                        {attempt.coachingPriority ? `Coaching priority: ${attempt.coachingPriority}` : "No persisted coaching priority"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <article className="detail-card">
            <h3>No conclusive scored attempts found</h3>
            <p>No persisted conclusive scored attempts were found for this user in the current dashboard scope.</p>
          </article>
        )}
      </section>
    </>
  );
}
