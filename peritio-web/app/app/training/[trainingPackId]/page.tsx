import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { DashboardNarrativePanel } from "@/src/components/DashboardNarrativePanel";
import { DashboardProofSection } from "@/src/components/DashboardProofSection";
import { DashboardSupportSignals } from "@/src/components/DashboardSupportSignals";
import { DashboardWhatMattersSection } from "@/src/components/DashboardWhatMattersSection";
import { PageHeader } from "@/src/components/PageHeader";
import {
  buildDashboardScopedCustomerDetailHref,
  buildDashboardScopedTrainingPackAssignmentHref,
} from "@/src/components/dashboardDivisionFilterState";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getDashboardTrainingPackDetail } from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { buildTrainingPackNarrative } from "@/src/lib/dashboardNarratives";
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
  searchParams,
}: {
  params: Promise<{ trainingPackId: string }>;
  searchParams: Promise<{ divisionId?: string }>;
}) {
  const { trainingPackId } = await params;
  const rawDivisionId = (await searchParams).divisionId?.trim();
  const divisionId = rawDivisionId ? rawDivisionId : null;
  let payload;
  try {
    payload = await getDashboardTrainingPackDetail(trainingPackId, divisionId);
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
  const narrative = buildTrainingPackNarrative(payload);
  const isDivisionScopedView = Boolean(divisionId);
  const hasScopedPackEvidence =
    pack.assignments.length > 0 ||
    pack.attemptsLast30Days > 0 ||
    pack.scoredAttemptsLast30Days > 0 ||
    pack.startedLearnerCount > 0 ||
    pack.completedLearnerCount > 0 ||
    pack.inProgressLearnerCount > 0;

  return (
    <>
      <PageHeader
        eyebrow="Training pack detail"
        title={pack.title}
        description="This drilldown shows learner progress, required scenarios, and recent attempts that were recorded with this training pack already attached."
        actions={
          <div className="pill-row">
            <span className="pill">{pack.active ? "Active" : "Inactive"}</span>
            <span className="pill accent">{pack.orgName}</span>
          </div>
        }
      />

      <DashboardNarrativePanel eyebrow="Story" title="What this training pack is doing now" narrative={narrative} />

      <DashboardSupportSignals title="Training pack support signals" signals={narrative.signals} />

      <DashboardWhatMattersSection items={narrative.priorities} />

      <DashboardProofSection
        title="Training pack detail"
        description="Open metadata, coaching, trend, and progress detail."
        preview="Metadata, coaching, trend, and progress detail"
      >
        <div className="dashboard-proof-stack">
          <div className="dashboard-proof-block">
            <h3>Pack metadata</h3>
            <p>Each assignment keeps the required-scenario list that was in place when the learner was assigned. Later pack edits do not rewrite earlier assignment progress.</p>
            <ul className="bullet-list">
              <li>
                Customer: <Link className="inline-link subtle" href={buildDashboardScopedCustomerDetailHref(pack.orgId, divisionId)}>{pack.orgName}</Link>
              </li>
              <li>Topic: {pack.trainingTopic || "No training topic recorded."}</li>
              <li>Scenario mapping: {pack.scenarioSelectionLabel}. Required behaviors: {pack.requiredBehaviorCount}. Objectives: {pack.objectiveCount}.</li>
              <li>
                Scope policy: {isDivisionScopedView
                  ? "This drilldown is pinned to the selected division. Empty tables stay empty instead of widening back to company totals."
                  : "This page is currently showing company-total evidence for the customer."}
              </li>
              <li>Recorded pack activity: {pack.trainingPackAttribution.attributedScoresLast30Days} scored attempts in the current 30-day window were already linked to this pack when they were recorded. {pack.trainingPackAttribution.unattributedScoresLast30Days} other scored attempts stay outside this pack view.</li>
              <li>Score averages here are based on conclusive scored attempts. They summarize completed scoring events, not guaranteed objective achievement.</li>
            </ul>
          </div>

          {isDivisionScopedView && !hasScopedPackEvidence ? (
            <div className="dashboard-proof-block">
              <div className="empty-state-panel">
                <h3>No visible pack evidence in this division</h3>
                <p>This training pack still belongs to {pack.orgName}, but the selected division does not currently have visible assignments or attributed attempts for it. Peritio keeps the pack metadata in view and does not widen this drilldown back to company totals.</p>
              </div>
            </div>
          ) : null}

          <div className="dashboard-proof-block">
            <CoachingInsightsSection
              eyebrow="Coaching themes"
              title="Most common coaching signals in this pack"
              description="These themes come from recent scored attempts that were linked to this pack and included coaching detail."
              insights={pack.coachingInsights}
              emptyMessage="This pack does not yet have enough recent scored attempts with coaching detail to show coaching themes."
              embedded
            />
          </div>

          <div className="dashboard-proof-block">
            <h3>Recent pack activity</h3>
            <p>Review recent activity and scoring volume by period{isDivisionScopedView ? " for the selected division" : ""}.</p>
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
                    Avg conclusive score {point.averageScore !== null ? formatScore(point.averageScore) : "-"}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="dashboard-proof-block">
            <h3>Scenario progress</h3>
            <p>Scenario rows show assignment coverage, recent usage, scoring, and latest activity.</p>
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
              <div className="empty-state-panel">
                <h3>No required scenarios mapped</h3>
                <p>This pack does not currently have required scenario mapping, so completion cannot be computed yet.</p>
              </div>
            )}
          </div>

          <div className="dashboard-proof-block">
            <h3>Per-user progress</h3>
            <p>{isDivisionScopedView ? "Assignment detail remains limited to the selected division. Out-of-scope learners are excluded rather than widened into company totals." : "Use assignment detail here for exact learner follow-up."}</p>
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
                          <Link
                            className="inline-link subtle"
                            href={buildDashboardScopedTrainingPackAssignmentHref(
                              pack.trainingPackId,
                              assignment.assignmentId,
                              divisionId
                            )}
                          >
                            <strong>{assignment.email}</strong>
                          </Link>
                          <div className="table-subcopy">{formatUserStatus(assignment.userStatus)}</div>
                        </td>
                        <td>{formatAssignmentStatus(assignment.status)}</td>
                        <td>{formatDateTime(assignment.assignedAt)}</td>
                        <td>{formatDateTime(assignment.startedAt)}</td>
                        <td>{formatDateTime(assignment.completedAt)}</td>
                        <td>{assignment.completedScenarioCount}/{assignment.requiredScenarioCount}</td>
                        <td>
                          {assignment.scoredAttemptsLast30Days}
                          <div className="table-subcopy">{assignment.attemptsLast30Days} attempts total in last 30 days</div>
                        </td>
                        <td>{assignment.averageScoreLast30Days !== null ? formatScore(assignment.averageScoreLast30Days) : "-"}</td>
                        <td>
                          <div>{formatDateTime(assignment.latestActivityAt)}</div>
                          <div className="table-subcopy">{assignment.latestScenarioTitle ?? "No recent scenario"}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-panel">
                <h3>{isDivisionScopedView ? "No visible learners in this division" : "No assigned users yet"}</h3>
                <p>{isDivisionScopedView ? "This pack remains valid, but the current division filter leaves no in-scope assignments or linked learner activity to show here. Peritio intentionally keeps this empty instead of widening the view." : "Assignments are the official roster for this training pack. Once users are assigned, their start and completion status will appear here."}</p>
              </div>
            )}
          </div>

          <div className="dashboard-proof-block">
            <h3>Current limitations</h3>
            <ul className="bullet-list">
              <li>Completion is only reliable for scored activity that was recorded with this pack already attached.</li>
              <li>Older activity without that pack link stays outside assignment progress.</li>
              <li>Each assignment keeps the required-scenario list that was active on the day the learner was assigned.</li>
            </ul>
          </div>
        </div>
      </DashboardProofSection>
    </>
  );
}
