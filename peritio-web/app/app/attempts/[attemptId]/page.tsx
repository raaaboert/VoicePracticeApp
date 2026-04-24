import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { buildDashboardScopedTrainingPackHref } from "@/src/components/dashboardDivisionFilterState";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getDashboardAttemptDetail } from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDateTime, formatRawSeconds, formatScore } from "@/src/lib/formatters";

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

function formatCompletionLevel(value: string | null): string {
  if (value === "complete") {
    return "Complete";
  }
  if (value === "partial") {
    return "Partial";
  }
  if (value === "inconclusive") {
    return "Inconclusive";
  }
  return "Not recorded";
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Attempt Detail",
  };
}

export default async function AttemptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ divisionId?: string }>;
}) {
  const { attemptId } = await params;
  const rawDivisionId = (await searchParams).divisionId?.trim();
  const divisionId = rawDivisionId ? rawDivisionId : null;
  let payload;
  try {
    payload = await getDashboardAttemptDetail(attemptId, divisionId);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }

    if (error instanceof DashboardAccessDeniedError) {
      redirect("/app/access-denied?reason=attempt-scope");
    }
    throw error;
  }

  if (!payload) {
    notFound();
  }

  const { attempt } = payload;

  return (
    <>
      <PageHeader
        eyebrow="Attempt detail"
        title={attempt.scenarioTitle ?? attempt.scenarioId}
        description="This detail view shows the saved score result for one attempt. Standard dashboard review keeps the scored result, not the full conversation transcript."
        actions={
          <div className="pill-row">
            <span className="pill">{attempt.trainingPackTitle ?? "No pack linked"}</span>
            <span className="pill accent">{attempt.packAttributed ? "Linked to pack" : "Not linked to a pack"}</span>
          </div>
        }
      />

      <section className="metric-grid">
        <MetricCard
          label="Overall score"
          value={attempt.scoreBreakdown ? formatScore(attempt.scoreBreakdown.overallScore) : "-"}
          meta={formatAssignmentContextStatus(attempt.assignmentContextStatus)}
          tone="positive"
        />
        <MetricCard
          label="When"
          value={formatDateTime(attempt.endedAt)}
          meta={`${formatRawSeconds(attempt.rawDurationSeconds)} duration`}
        />
        <MetricCard
          label="User"
          value={attempt.userEmail}
          meta={attempt.orgName ?? "No organization"}
          tone="accent"
        />
        <MetricCard
          label="Scoring model"
          value={attempt.model ?? "-"}
          meta={attempt.rubricVersion ?? attempt.promptVersion ?? "No saved scoring metadata"}
        />
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Context</p>
            <h2>Attempt scope</h2>
          </div>
        </div>
        <ul className="bullet-list">
          <li>
            Scenario: {attempt.scenarioTitle ?? attempt.scenarioId} ({attempt.segmentLabel ?? attempt.segmentId})
          </li>
          <li>
            Training pack: {attempt.trainingPackId ? (
              <Link className="inline-link subtle" href={buildDashboardScopedTrainingPackHref(attempt.trainingPackId, divisionId)}>
                {attempt.trainingPackTitle ?? attempt.trainingPackId}
              </Link>
            ) : "No pack link recorded"}
          </li>
          <li>
            Assignment relation: {formatAssignmentContextStatus(attempt.assignmentContextStatus)}
          </li>
          <li>Transcript available: No. Standard dashboard review keeps the scored result, not the full conversation history.</li>
        </ul>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Scorecard</p>
            <h2>Saved scoring detail</h2>
            <p className="section-copy">
              This view shows the score breakdown and coaching fields that were saved with the original scoring event. Newer attempts may include outcome-aware fields, while older records may still show only the earlier rubric categories. Standard dashboard review does not keep the full conversation transcript.
            </p>
          </div>
        </div>

        {attempt.scoreBreakdown ? (
          <div className="info-grid">
            <article className="detail-card">
              <h3>Outcome-aware scores</h3>
              {(attempt.scoreBreakdown.communicationScore !== null || attempt.scoreBreakdown.outcomeScore !== null) ? (
                <dl className="inline-stats">
                  <div>
                    <dt>Communication</dt>
                    <dd>{attempt.scoreBreakdown.communicationScore ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Outcome</dt>
                    <dd>{attempt.scoreBreakdown.outcomeScore ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Completion</dt>
                    <dd>{formatCompletionLevel(attempt.scoreBreakdown.completionLevel)}</dd>
                  </div>
                  <div>
                    <dt>Objective achieved</dt>
                    <dd>
                      {attempt.scoreBreakdown.objectiveAchieved === null
                        ? "Not recorded"
                        : attempt.scoreBreakdown.objectiveAchieved
                          ? "Yes"
                          : "No"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p>This historical score record predates the newer outcome-aware score fields.</p>
              )}
            </article>
            <article className="detail-card">
              <h3>Legacy rubric categories</h3>
              <dl className="inline-stats">
                <div>
                  <dt>Persuasion</dt>
                  <dd>{attempt.scoreBreakdown.persuasion}/10</dd>
                </div>
                <div>
                  <dt>Clarity</dt>
                  <dd>{attempt.scoreBreakdown.clarity}/10</dd>
                </div>
                <div>
                  <dt>Empathy</dt>
                  <dd>{attempt.scoreBreakdown.empathy}/10</dd>
                </div>
                <div>
                  <dt>Assertiveness</dt>
                  <dd>{attempt.scoreBreakdown.assertiveness}/10</dd>
                </div>
              </dl>
            </article>
            <article className="detail-card">
              <h3>Saved summary</h3>
              <p>{attempt.summary ?? "No saved score summary was recorded for this attempt."}</p>
            </article>
            <article className="detail-card">
              <h3>Coaching priority</h3>
              <p>{attempt.coachingArtifact?.coachingPriority ?? "No saved coaching priority was recorded for this attempt."}</p>
            </article>
            <article className="detail-card">
              <h3>Strengths</h3>
              {attempt.coachingArtifact?.strengths?.length ? (
                <ul className="bullet-list">
                  {attempt.coachingArtifact.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>This older score record does not include saved strengths.</p>
              )}
            </article>
            <article className="detail-card">
              <h3>Improvement areas</h3>
              {attempt.coachingArtifact?.improvementAreas?.length ? (
                <ul className="bullet-list">
                  {attempt.coachingArtifact.improvementAreas.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>This older score record does not include saved improvement areas.</p>
              )}
            </article>
            <article className="detail-card">
              <h3>Derived coaching signals</h3>
              <ul className="bullet-list">
                <li>Highest legacy category: {attempt.derivedSignals.strongestCategory ?? "-"}</li>
                <li>Lowest legacy category: {attempt.derivedSignals.weakestCategory ?? "-"}</li>
                <li>Recommended focus: {attempt.derivedSignals.coachingFocus ?? "-"}</li>
              </ul>
            </article>
          </div>
        ) : (
          <article className="detail-card">
            <h3>No saved score breakdown</h3>
            <p>This activity does not have a saved score breakdown available for dashboard review.</p>
          </article>
        )}
      </section>
    </>
  );
}
