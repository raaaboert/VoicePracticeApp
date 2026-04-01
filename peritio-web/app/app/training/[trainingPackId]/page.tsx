import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getDashboardTrainingPackDetail } from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDateTime, formatScore } from "@/src/lib/formatters";

function formatAssignmentStatus(status: string): string {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "in_progress") {
    return "In Progress";
  }
  return "Not Started";
}

function formatUserStatus(status: string): string {
  return status === "active" ? "Active" : "Disabled";
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Training Pack",
  };
}

export default async function TrainingPackDetailPage({
  params,
}: {
  params: Promise<{ trainingPackId: string }>;
}) {
  const { trainingPackId } = await params;
  let payload;
  try {
    payload = await getDashboardTrainingPackDetail(trainingPackId);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }

    if (error instanceof DashboardAccessDeniedError) {
      redirect("/app/access-denied?reason=training-scope");
    }
    throw error;
  }

  if (!payload) {
    notFound();
  }

  const { pack } = payload;

  return (
    <>
      <PageHeader
        eyebrow="Training pack detail"
        title={pack.title}
        description="This drilldown shows assignment-based progress, required scenarios, pack-linked attempts, and forward-only completion for this training program."
        actions={
          <div className="pill-row">
            <span className="pill">{pack.active ? "Active" : "Inactive"}</span>
            <span className="pill accent">{pack.orgName}</span>
          </div>
        }
      />

      <section className="metric-grid">
        <MetricCard
          label="Assigned"
          value={`${pack.assignedLearnerCount}`}
          meta={`${pack.notStartedLearnerCount} not started`}
        />
        <MetricCard
          label="In progress"
          value={`${pack.inProgressLearnerCount}`}
          meta={`${pack.startedLearnerCount} started overall`}
          tone="accent"
        />
        <MetricCard
          label="Completed"
          value={`${pack.completedLearnerCount}`}
          meta={
            pack.completionSupported
              ? `${pack.requiredScenarioCount} required scenarios in the current pack definition`
              : "Completion unavailable until required scenarios are mapped"
          }
          tone="positive"
        />
        <MetricCard
          label="Attempts"
          value={`${pack.attemptsLast30Days}`}
          meta={
            pack.averageScoreLast30Days !== null
              ? `${pack.scoredAttemptsLast30Days} scored | Avg ${formatScore(pack.averageScoreLast30Days)}`
              : `${pack.scoredAttemptsLast30Days} scored`
          }
        />
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Program state</p>
            <h2>Pack metadata</h2>
            <p className="section-copy">
              Completion uses the required scenario snapshot stored at assignment time. If the pack definition changes later, existing assignments keep their original snapshot.
            </p>
          </div>
        </div>
        <ul className="bullet-list">
          <li>
            Customer: <Link className="inline-link subtle" href={`/app/customers/${pack.orgId}`}>{pack.orgName}</Link>
          </li>
          <li>
            Topic: {pack.trainingTopic || "No training topic recorded."}
          </li>
          <li>
            Scenario mapping: {pack.scenarioSelectionLabel}. Required behaviors: {pack.requiredBehaviorCount}. Objectives: {pack.objectiveCount}.
          </li>
          <li>
            Forward-only attribution: {pack.trainingPackAttribution.attributedScoresLast30Days} scored attempts in the current 30-day window are linked to this pack; {pack.trainingPackAttribution.unattributedScoresLast30Days} are not backfilled.
          </li>
        </ul>
      </section>

      <CoachingInsightsSection
        eyebrow="Coaching themes"
        title="Most common coaching signals in this pack"
        description="These pack-level coaching aggregates use only pack-attributed score records that persisted a coaching artifact. They help explain the repeated coaching needs emerging inside this training program."
        insights={pack.coachingInsights}
        emptyMessage="This pack does not yet have enough artifact-backed scored attempts to produce coaching-theme aggregates."
      />

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Trend</p>
            <h2>Recent pack activity</h2>
          </div>
        </div>
        <div className="trend-grid">
          {pack.trend.map((point) => (
            <article key={point.label} className="trend-card">
              <div className="trend-label-row">
                <strong>{point.label}</strong>
                <span>{point.attempts} attempts</span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${Math.min(100, point.attempts * 8)}%` }} />
              </div>
              <p className="small-copy">
                Avg score {point.averageScore !== null ? formatScore(point.averageScore) : "-"}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Required scenarios</p>
            <h2>Scenario progress</h2>
          </div>
        </div>
        {pack.scenarios.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Assigned</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Attempts</th>
                  <th>Scored attempts</th>
                  <th>Average score</th>
                  <th>Latest activity</th>
                </tr>
              </thead>
              <tbody>
                {pack.scenarios.map((scenario) => (
                  <tr key={scenario.scenarioId}>
                    <td>
                      <strong>{scenario.title}</strong>
                      <div className="table-subcopy">
                        {scenario.segmentLabel} | {scenario.source === "custom" ? "Custom" : "Standard"}
                      </div>
                    </td>
                    <td>{scenario.assignedLearnerCount}</td>
                    <td>{scenario.startedLearnerCount}</td>
                    <td>{scenario.completedLearnerCount}</td>
                    <td>{scenario.attemptsLast30Days}</td>
                    <td>{scenario.scoredAttemptsLast30Days}</td>
                    <td>{scenario.averageScoreLast30Days !== null ? formatScore(scenario.averageScoreLast30Days) : "-"}</td>
                    <td>{formatDateTime(scenario.latestActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <article className="detail-card">
            <h3>No required scenarios mapped</h3>
            <p>This pack does not currently have required scenario mapping, so completion cannot be computed yet.</p>
          </article>
        )}
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Assignments</p>
            <h2>Per-user progress</h2>
          </div>
        </div>
        {pack.assignments.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Assigned</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Scenario progress</th>
                  <th>Scored attempts</th>
                  <th>Average score</th>
                  <th>Recent activity</th>
                </tr>
              </thead>
              <tbody>
                {pack.assignments.map((assignment) => (
                  <tr key={assignment.assignmentId}>
                    <td>
                      <Link className="inline-link subtle" href={`/app/training/${pack.trainingPackId}/assignments/${assignment.assignmentId}`}>
                        <strong>{assignment.email}</strong>
                      </Link>
                      <div className="table-subcopy">{formatUserStatus(assignment.userStatus)}</div>
                    </td>
                    <td>{formatAssignmentStatus(assignment.status)}</td>
                    <td>{formatDateTime(assignment.assignedAt)}</td>
                    <td>{formatDateTime(assignment.startedAt)}</td>
                    <td>{formatDateTime(assignment.completedAt)}</td>
                    <td>
                      {assignment.completedScenarioCount}/{assignment.requiredScenarioCount}
                    </td>
                    <td>
                      {assignment.scoredAttemptsLast30Days}
                      <div className="table-subcopy">{assignment.attemptsLast30Days} attempts total in last 30 days</div>
                    </td>
                    <td>{assignment.averageScoreLast30Days !== null ? formatScore(assignment.averageScoreLast30Days) : "-"}</td>
                    <td>
                      <div>{formatDateTime(assignment.latestActivityAt)}</div>
                      <div className="table-subcopy">
                        {assignment.latestScenarioTitle ?? "No recent scenario"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <article className="detail-card">
            <h3>No assigned users yet</h3>
            <p>Assignments are the durable lifecycle record for this training pack. Once users are assigned, their start and completion status will appear here.</p>
          </article>
        )}
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Notes</p>
            <h2>Current limitations</h2>
          </div>
        </div>
        <ul className="bullet-list">
          <li>Completion is only accurate for pack-linked scored activity recorded after `trainingPackId` linkage was added.</li>
          <li>Older unattributed activity is not backfilled into assignment progress.</li>
          <li>Assignments use the required scenario snapshot captured when each user was assigned.</li>
        </ul>
      </section>
    </>
  );
}
