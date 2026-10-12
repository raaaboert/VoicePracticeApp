import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { DashboardDivisionFilter } from "@/src/components/DashboardDivisionFilter";
import { DashboardNarrativePanel } from "@/src/components/DashboardNarrativePanel";
import { DashboardProofSection } from "@/src/components/DashboardProofSection";
import { DashboardSupportSignals } from "@/src/components/DashboardSupportSignals";
import { DashboardWhatMattersSection } from "@/src/components/DashboardWhatMattersSection";
import { PageHeader } from "@/src/components/PageHeader";
import { PerformanceNavigation } from "@/src/components/PerformanceNavigation";
import { UserAttemptHistory } from "@/src/components/UserAttemptHistory";
import { buildPerformanceViewHref } from "@/src/components/performanceViewRoutes";
import { buildDashboardScopedTrainingPackAssignmentHref } from "@/src/components/dashboardDivisionFilterState";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getDashboardUserDetail } from "@/src/lib/auth";
import { buildUserDetailNarrative } from "@/src/lib/dashboardNarratives";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDateTime } from "@/src/lib/formatters";

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
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ divisionId?: string; performanceOrigin?: string }>;
}) {
  const { userId } = await params;
  const query = await searchParams;
  const rawDivisionId = query.divisionId?.trim();
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

  const { user, assignments } = payload;
  const narrative = buildUserDetailNarrative(payload);
  const fromPerformance = query.performanceOrigin === "individuals";
  const appliedDivisionId = payload.divisionScope?.appliedDivisionId ?? null;

  return (
    <>
      <PageHeader
        eyebrow="User detail"
        title={user.email}
        description="Review recent performance signals, coaching themes, and active assignment progress for this user."
      />

      {fromPerformance ? (
        <PerformanceNavigation activeView="individuals" orgId={user.orgId} divisionId={appliedDivisionId} />
      ) : null}

      {fromPerformance ? (
        <div className="performance-detail-back-row">
          <Link
            className="training-content-back-link"
            href={buildPerformanceViewHref("individuals", { orgId: user.orgId, divisionId: appliedDivisionId })}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            Back to Individuals
          </Link>
        </div>
      ) : null}

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
            {payload.learningAccessMode === "focus_topic_assignments" ? <>
              <p>Current learning access reflects active Focus Topic assignments. Historical Training Pack links do not determine this access.</p>
              {(payload.currentFocusTopics ?? []).length > 0 ? <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Focus Topic</th><th>Current access</th></tr></thead>
                  <tbody>{payload.currentFocusTopics?.map((topic) => <tr key={topic.topicId}>
                    <td>{topic.topicTitle}</td><td>Active learner access</td>
                  </tr>)}</tbody>
                </table>
              </div> : <div className="empty-state-panel">
                <h3>No current Focus Topic access</h3>
                <p>This user has no active learner access through current Focus Topic assignments.</p>
              </div>}
            </> : <>
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
                              divisionId,
                              user.orgId
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
            </>}
          </div>

          <div className="dashboard-proof-block">
            <details className="dashboard-history-disclosure" open>
              <summary>
                <span>Scored attempt history</span>
                <span className="dashboard-history-disclosure-summary">Browse score records and expand feedback when needed.</span>
              </summary>
              <div className="dashboard-history-disclosure-body">
                <p>Browse compact scored attempts in this dashboard scope. Expand a row to load its saved scoring narrative and details.</p>
                <UserAttemptHistory userId={user.userId} divisionId={divisionId} />
              </div>
            </details>
          </div>
        </div>
      </DashboardProofSection>
    </>
  );
}
