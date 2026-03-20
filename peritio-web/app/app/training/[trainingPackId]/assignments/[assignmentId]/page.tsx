import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { DashboardAccessDeniedError, getDashboardTrainingPackAssignmentDetail } from "@/src/lib/auth";
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
}: {
  params: Promise<{ trainingPackId: string; assignmentId: string }>;
}) {
  const { trainingPackId, assignmentId } = await params;
  let payload;
  try {
    payload = await getDashboardTrainingPackAssignmentDetail(trainingPackId, assignmentId);
  } catch (error) {
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
        description="This drilldown shows the persisted activity behind one assignment. Only pack-attributed activity for this pack is shown, and rows outside the assignment window are labeled explicitly."
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
          meta={`Completion rule: ${assignment.completionRule}`}
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
          meta={`${assignment.scoredAttemptsLast30Days} scored attempts in the last 30 days`}
        />
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Context</p>
            <h2>Assignment scope</h2>
            <p className="section-copy">
              Only activity with this pack&apos;s `trainingPackId` is shown here. Unattributed activity is not included because it cannot be tied honestly to this assignment.
            </p>
          </div>
        </div>
        <ul className="bullet-list">
          <li>
            Pack: <Link className="inline-link subtle" href={`/app/training/${pack.trainingPackId}`}>{pack.title}</Link> for{" "}
            <Link className="inline-link subtle" href={`/app/customers/${pack.orgId}`}>{pack.orgName}</Link>.
          </li>
          <li>
            Required scenarios at assignment time: {assignment.requiredScenarios.length > 0 ? assignment.requiredScenarios.map((scenario) => scenario.title ?? scenario.scenarioId).join(", ") : "None mapped"}.
          </li>
          <li>Raw transcripts are not stored for normal dashboard reporting, so this view uses persisted timing, scoring, summary, and coaching metadata only.</li>
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
                        <Link className="inline-link subtle" href={`/app/attempts/${attempt.activityId}`}>
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
            <h3>No pack-attributed activity yet</h3>
            <p>No persisted pack-attributed usage or scored attempts were found for this assignment yet.</p>
          </article>
        )}
      </section>
    </>
  );
}
