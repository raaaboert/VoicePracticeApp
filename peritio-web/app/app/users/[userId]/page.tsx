import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { DashboardNarrativePanel } from "@/src/components/DashboardNarrativePanel";
import { DashboardProofSection } from "@/src/components/DashboardProofSection";
import { DashboardSupportSignals } from "@/src/components/DashboardSupportSignals";
import { DashboardWhatMattersSection } from "@/src/components/DashboardWhatMattersSection";
import { PageHeader } from "@/src/components/PageHeader";
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

  return (
    <>
      <PageHeader
        eyebrow="User detail"
        title={user.email}
        description="This drilldown shows persisted score-backed attempt history and current assignment progress. Raw transcripts are not stored for normal dashboard review."
      />

      <DashboardNarrativePanel eyebrow="Story" title="What a manager should conclude" narrative={narrative} />

      <DashboardSupportSignals signals={narrative.signals} />

      <DashboardWhatMattersSection
        title="What matters most right now"
        description="This section keeps the read focused on the few implications most likely to matter in a coaching conversation."
        items={narrative.priorities}
      />

      <DashboardProofSection
        title="Proof behind this user view"
        description="Open the full coaching, assignment, and attempt detail when you need the evidence behind the briefing."
      >
        <div className="dashboard-proof-stack">
          <div className="dashboard-proof-block">
            <CoachingInsightsSection
              eyebrow="Coaching themes"
              title="Repeated coaching focus for this user"
              description="These user-level coaching aggregates come only from persisted coaching artifacts on scored attempts in the last 30 days. They highlight repeated themes without storing transcript history."
              insights={payload.coachingInsights}
              emptyMessage="This user does not yet have enough artifact-backed scored attempts in the last 30 days to show aggregate coaching themes."
            />
          </div>

          <div className="dashboard-proof-block">
            <h3>Current training progress</h3>
            <p>Assignment progress is derived from pack-linked persisted activity only. Unattributed historical activity does not count toward completion.</p>

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
              <div className="empty-state-panel">
                <h3>No active assignments</h3>
                <p>This user does not currently have an active training-pack assignment in their visible customer scope.</p>
              </div>
            )}
          </div>

          <div className="dashboard-proof-block">
            <h3>Recent conclusive scored attempts</h3>
            <p>
              These rows come from persisted score records, including saved score summaries and coaching priorities when available. Transcript text is not retained for normal dashboard review.
            </p>

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
              <div className="empty-state-panel">
                <h3>No conclusive scored attempts found</h3>
                <p>No persisted conclusive scored attempts were found for this user in the current dashboard scope.</p>
              </div>
            )}
          </div>
        </div>
      </DashboardProofSection>
    </>
  );
}
