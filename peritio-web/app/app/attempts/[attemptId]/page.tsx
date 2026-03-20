import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { DashboardAccessDeniedError, getDashboardAttemptDetail } from "@/src/lib/auth";
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

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Attempt Detail",
  };
}

export default async function AttemptDetailPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  let payload;
  try {
    payload = await getDashboardAttemptDetail(attemptId);
  } catch (error) {
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
        description="This detail view uses persisted scorecard metadata only. Raw simulation transcripts are not stored for normal dashboard review."
        actions={
          <div className="pill-row">
            <span className="pill">{attempt.trainingPackTitle ?? "Unattributed attempt"}</span>
            <span className="pill accent">{attempt.packAttributed ? "Pack-attributed" : "Not pack-attributed"}</span>
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
          label="Model metadata"
          value={attempt.model ?? "-"}
          meta={attempt.rubricVersion ?? attempt.promptVersion ?? "No persisted model metadata"}
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
            Training pack: {attempt.trainingPackId ? <Link className="inline-link subtle" href={`/app/training/${attempt.trainingPackId}`}>{attempt.trainingPackTitle ?? attempt.trainingPackId}</Link> : "No persisted training pack attribution"}
          </li>
          <li>
            Assignment relation: {formatAssignmentContextStatus(attempt.assignmentContextStatus)}
          </li>
          <li>Transcript available: No. Normal dashboard review does not retain raw conversation history.</li>
        </ul>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Scorecard</p>
            <h2>Persisted scoring detail</h2>
            <p className="section-copy">
              This view shows only persisted score breakdown and saved coaching fields from the original scoring event. Raw simulation transcripts are not retained for normal dashboard review.
            </p>
          </div>
        </div>

        {attempt.scoreBreakdown ? (
          <div className="info-grid">
            <article className="detail-card">
              <h3>Score breakdown</h3>
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
              <h3>Persisted summary</h3>
              <p>{attempt.summary ?? "No persisted score summary was saved for this attempt."}</p>
            </article>
            <article className="detail-card">
              <h3>Coaching priority</h3>
              <p>{attempt.coachingArtifact?.coachingPriority ?? "No persisted coaching priority was saved for this attempt."}</p>
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
                <p>This historical score record does not include persisted strengths.</p>
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
                <p>This historical score record does not include persisted improvement areas.</p>
              )}
            </article>
            <article className="detail-card">
              <h3>Derived coaching signals</h3>
              <ul className="bullet-list">
                <li>Strongest category: {attempt.derivedSignals.strongestCategory ?? "-"}</li>
                <li>Weakest category: {attempt.derivedSignals.weakestCategory ?? "-"}</li>
                <li>Recommended focus: {attempt.derivedSignals.coachingFocus ?? "-"}</li>
              </ul>
            </article>
          </div>
        ) : (
          <article className="detail-card">
            <h3>No persisted score breakdown</h3>
            <p>This activity does not have a saved score breakdown available for dashboard review.</p>
          </article>
        )}
      </section>
    </>
  );
}
