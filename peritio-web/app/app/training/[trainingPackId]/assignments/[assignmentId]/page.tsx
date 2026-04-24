import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import {
  buildDashboardScopedAttemptDetailHref,
  buildDashboardScopedCustomerDetailHref,
  buildDashboardScopedTrainingPackHref,
} from "@/src/components/dashboardDivisionFilterState";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getDashboardTrainingPackAssignmentDetail } from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDateTime, formatRawSeconds, formatScore } from "@/src/lib/formatters";

function formatAssignmentStatus(status: string): string {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "in_progress") {
    return "In Progress";
  }
  return "Not Started";
}

function formatAssignmentContextStatus(status: string): string {
  if (status === "counts_toward_completion") {
    return "Counts Toward Completion";
  }
  if (status === "within_assignment_window") {
    return "Within Assignment Window";
  }
  if (status === "outside_assignment_window") {
    return "Outside Assignment Window";
  }
  return "Not Assignment Scoped";
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Assignment Detail",
  };
}

export default async function TrainingPackAssignmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ trainingPackId: string; assignmentId: string }>;
  searchParams: Promise<{ divisionId?: string }>;
}) {
  const { trainingPackId, assignmentId } = await params;
  const rawDivisionId = (await searchParams).divisionId?.trim();
  const divisionId = rawDivisionId ? rawDivisionId : null;
  let payload;
  try {
    payload = await getDashboardTrainingPackAssignmentDetail(trainingPackId, assignmentId, divisionId);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }

    if (error instanceof DashboardAccessDeniedError) {
      redirect("/app/access-denied?reason=assignment-scope");
    }
    throw error;
  }

  if (!payload) {
    notFound();
  }

  const { pack, assignment, attempts } = payload;

  return (
    <>
      <PageHeader
        eyebrow="Assignment detail"
        title={assignment.email}
        description="This drilldown shows the recorded activity behind one assignment. Only activity already linked to this pack appears here, and rows outside the assignment window are labeled clearly."
        actions={
          <div className="pill-row">
            <span className="pill">{pack.title}</span>
            <span className="pill accent">{formatAssignmentStatus(assignment.status)}</span>
          </div>
        }
      />

      <section className="metric-grid">
        <MetricCard
          label="Assigned"
          value={formatDateTime(assignment.assignedAt)}
          meta="Completion rule: one scored attempt for each required scenario"
        />
        <MetricCard
          label="Started"
          value={formatDateTime(assignment.startedAt)}
          meta={`${assignment.attemptsLast30Days} attempts in the last 30 days`}
          tone="accent"
        />
        <MetricCard
          label="Completed"
          value={formatDateTime(assignment.completedAt)}
          meta={`${assignment.completedScenarioCount}/${assignment.requiredScenarioCount} required scenarios`}
          tone="positive"
        />
        <MetricCard
          label="Average score"
          value={assignment.averageScoreLast30Days !== null ? formatScore(assignment.averageScoreLast30Days) : "-"}
          meta={`${assignment.scoredAttemptsLast30Days} conclusive scored attempts in the last 30 days`}
        />
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Context</p>
            <h2>Assignment scope</h2>
            <p className="section-copy">
              Only attempts that were recorded with this pack already attached appear here. Other activity stays out of this assignment view because it cannot be tied back to this assignment with confidence.
            </p>
          </div>
        </div>
        <ul className="bullet-list">
          <li>
            Pack: <Link className="inline-link subtle" href={buildDashboardScopedTrainingPackHref(pack.trainingPackId, divisionId)}>{pack.title}</Link> for{" "}
            <Link className="inline-link subtle" href={buildDashboardScopedCustomerDetailHref(pack.orgId, divisionId)}>{pack.orgName}</Link>.
          </li>
          <li>
            Required scenarios at assignment time: {assignment.requiredScenarios.length > 0 ? assignment.requiredScenarios.map((scenario) => scenario.title ?? scenario.scenarioId).join(", ") : "None mapped"}.
          </li>
          <li>Conversation transcripts are not kept in normal dashboard review, so this page uses the saved timing, score, summary, and coaching details instead.</li>
        </ul>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Activity history</p>
            <h2>Attempts behind this assignment</h2>
          </div>
        </div>
        {attempts.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Scenario</th>
                  <th>Assignment relation</th>
                  <th>Score</th>
                  <th>Duration</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.activityId}>
                    <td>{formatDateTime(attempt.endedAt)}</td>
                    <td>{attempt.activityKind === "scored_attempt" ? "Scored Attempt" : "Usage Only"}</td>
                    <td>
                      {attempt.activityKind === "scored_attempt" ? (
                        <Link className="inline-link subtle" href={buildDashboardScopedAttemptDetailHref(attempt.activityId, divisionId)}>
                          {attempt.scenarioTitle ?? attempt.scenarioId}
                        </Link>
                      ) : (
                        attempt.scenarioTitle ?? attempt.scenarioId
                      )}
                    </td>
                    <td>{formatAssignmentContextStatus(attempt.assignmentContextStatus)}</td>
                    <td>{attempt.overallScore !== null ? formatScore(attempt.overallScore) : "-"}</td>
                    <td>{formatRawSeconds(attempt.rawDurationSeconds)}</td>
                    <td>
                      <div>{attempt.summary ?? "No saved score summary."}</div>
                      <div className="table-subcopy">
                        {attempt.coachingPriority ? `Coaching priority: ${attempt.coachingPriority}` : "No saved coaching priority"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <article className="detail-card">
            <h3>No pack-linked activity yet</h3>
            <p>No recorded pack-linked usage or scored attempts were found for this assignment yet.</p>
          </article>
        )}
      </section>
    </>
  );
}
