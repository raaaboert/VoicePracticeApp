import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { DashboardDivisionFilter } from "@/src/components/DashboardDivisionFilter";
import { DashboardNarrativePanel } from "@/src/components/DashboardNarrativePanel";
import { DashboardProofSection } from "@/src/components/DashboardProofSection";
import { DashboardSupportSignals } from "@/src/components/DashboardSupportSignals";
import { DashboardWhatMattersSection } from "@/src/components/DashboardWhatMattersSection";
import { PageHeader } from "@/src/components/PageHeader";
import {
  buildDashboardScopedAttemptDetailHref,
  buildDashboardScopedTrainingPackAssignmentHref,
} from "@/src/components/dashboardDivisionFilterState";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getDashboardUserDetail } from "@/src/lib/auth";
import { buildUserDetailNarrative } from "@/src/lib/dashboardNarratives";
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
    title: "User Detail",
  };
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ divisionId?: string }>;
}) {
  const { userId } = await params;
  const rawDivisionId = (await searchParams).divisionId?.trim();
  const divisionId = rawDivisionId ? rawDivisionId : null;
  let payload;
  try {
    payload = await getDashboardUserDetail(userId, divisionId);
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

  return (
    <>
      <PageHeader
        eyebrow="User detail"
        title={user.email}
        description="Review recent performance signals, coaching themes, and active assignment progress for this user."
      />

      <DashboardDivisionFilter
        divisionScope={payload.divisionScope}
        title="User detail reporting lens"
        description="Company Total shows the full account view. Division filters keep this drilldown aligned with the attributed activity behind the aggregate dashboard."
      />

      <DashboardNarrativePanel eyebrow="Story" title="Manager summary" narrative={narrative} />

      <DashboardSupportSignals title="User detail support signals" signals={narrative.signals} />

      <DashboardWhatMattersSection items={narrative.priorities} />

      <DashboardProofSection
        title="Supporting detail"
        description="Open coaching themes, assignments, and scored-attempt history."
        preview="Coaching themes, assignments, and scored-attempt history"
      >
        <div className="dashboard-proof-stack">
          <div className="dashboard-proof-block">
            <CoachingInsightsSection
              eyebrow="Coaching themes"
              title="Recurring coaching themes"
              description="These themes come from scored attempts in the last 30 days that saved coaching detail."
              insights={payload.coachingInsights}
              emptyMessage="This user does not yet have enough recent scored attempts with coaching detail to show coaching themes."
              embedded
            />
          </div>

          <div className="dashboard-proof-block">
            <h3>Current training progress</h3>
            <p>Progress reflects activity linked to each training pack. Older unattributed activity does not count toward completion.</p>

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
                          <Link
                            className="inline-link subtle"
                            href={buildDashboardScopedTrainingPackAssignmentHref(
                              assignment.trainingPackId,
                              assignment.assignmentId,
                              divisionId
                            )}
                          >
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
              <div className="empty-state-panel">
                <h3>No active assignments</h3>
                <p>This user does not currently have an active training-pack assignment in the current dashboard scope.</p>
              </div>
            )}
          </div>

          <div className="dashboard-proof-block">
            <h3>Scored attempt history</h3>
            <p>These rows show scored attempts in this dashboard scope, newest first. Saved score notes appear when available.</p>

            {attempts.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Scenario</th>
                      <th>Training pack</th>
                      <th>Assignment status</th>
                      <th>Score</th>
                      <th>Duration</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((attempt) => (
                      <tr key={attempt.activityId}>
                        <td>{formatDateTime(attempt.endedAt)}</td>
                        <td>
                          <Link className="inline-link subtle" href={buildDashboardScopedAttemptDetailHref(attempt.activityId, divisionId)}>
                            {attempt.scenarioTitle ?? attempt.scenarioId}
                          </Link>
                        </td>
                        <td>{attempt.trainingPackTitle ?? "Unattributed"}</td>
                        <td>{formatAssignmentContextStatus(attempt.assignmentContextStatus)}</td>
                        <td>{attempt.overallScore !== null ? formatScore(attempt.overallScore) : "-"}</td>
                        <td>{formatRawSeconds(attempt.rawDurationSeconds)}</td>
                        <td className="attempt-history-notes">
                          <div className={`attempt-history-summary${attempt.summary ? "" : " empty"}`}>
                            {attempt.summary ?? "No saved summary."}
                          </div>
                          {attempt.coachingPriority ? (
                            <div className="attempt-history-priority">Priority: {attempt.coachingPriority}</div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-panel">
                <h3>No scored attempts found</h3>
                <p>No scored attempts were found for this user in the current dashboard scope.</p>
              </div>
            )}
          </div>
        </div>
      </DashboardProofSection>
    </>
  );
}
