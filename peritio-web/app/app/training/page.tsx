import Link from "next/link";

import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { getDashboardTrainingReport, getDashboardViewer } from "@/src/lib/auth";
import { formatDateTime, formatScore, formatSignedPercent } from "@/src/lib/formatters";

export default async function TrainingPage() {
  const viewer = await getDashboardViewer();
  const report = await getDashboardTrainingReport();
  const trainingPacks = report?.trainingPacks ?? [];
  const summary = report?.summary;
  const attribution = report?.trainingPackAttribution;

  return (
    <>
      <PageHeader
        eyebrow="Training"
        title="Training program reporting"
        description={
          viewer?.accessType === "platform_admin"
            ? "This route now reports real scoped training packs, assignments, and completion progress across your accessible customers. Completion is forward-only."
            : "This route now reports real training pack assignments and completion progress for your customer account."
        }
      />

      <section className="metric-grid">
        <MetricCard
          label="Visible packs"
          value={`${summary?.visibleTrainingPackCount ?? trainingPacks.length}`}
          meta={`${summary?.activeTrainingPackCount ?? trainingPacks.filter((pack) => pack.active).length} active in scope`}
        />
        <MetricCard
          label="Assignments"
          value={`${summary?.assignmentCount ?? trainingPacks.reduce((total, pack) => total + pack.assignedLearnerCount, 0)}`}
          meta={`${summary?.notStartedAssignmentCount ?? trainingPacks.reduce((total, pack) => total + pack.notStartedLearnerCount, 0)} not started`}
        />
        <MetricCard
          label="In progress"
          value={`${summary?.inProgressAssignmentCount ?? trainingPacks.reduce((total, pack) => total + pack.inProgressLearnerCount, 0)}`}
          meta={`${summary?.startedAssignmentCount ?? trainingPacks.reduce((total, pack) => total + pack.startedLearnerCount, 0)} started overall`}
          tone="accent"
        />
        <MetricCard
          label="Completed"
          value={`${summary?.completedAssignmentCount ?? trainingPacks.reduce((total, pack) => total + pack.completedLearnerCount, 0)}`}
          meta={
            summary?.averageScoreLast30Days !== null && summary?.averageScoreLast30Days !== undefined
              ? `Avg score ${formatScore(summary.averageScoreLast30Days)} on pack-linked scored attempts`
              : "No scored pack-linked attempts yet"
          }
          tone="positive"
        />
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Lifecycle model</p>
            <h2>What completion means in V1</h2>
            <p className="section-copy">
              A learner is counted as completed when they have at least one scored attempt for every required scenario snapshot captured at assignment time.
            </p>
          </div>
        </div>
        <ul className="bullet-list">
          <li>Assignments are durable records tied to a user, a training pack, and the required scenario snapshot captured when that user was assigned.</li>
          <li>Started means the learner has pack-linked activity on or after the assignment timestamp.</li>
          <li>Completion is forward-only. Older unattributed activity is not backfilled into assignment progress.</li>
          <li>{attribution?.attributedScoresLast30Days ?? 0} scored attempts in the current 30-day window are pack-linked, while {attribution?.unattributedScoresLast30Days ?? 0} remain unattributed.</li>
        </ul>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Programs</p>
            <h2>Packs in scope</h2>
            <p className="section-copy">
              These rows combine real training-pack records with real assignment lifecycle progress and pack-linked activity.
            </p>
          </div>
        </div>

        {trainingPacks.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Training pack</th>
                  <th>Customer</th>
                  <th>Required scenarios</th>
                  <th>Assigned</th>
                  <th>Started</th>
                  <th>In progress</th>
                  <th>Completed</th>
                  <th>Not started</th>
                  <th>Attempts</th>
                  <th>Scored attempts</th>
                  <th>Latest activity</th>
                </tr>
              </thead>
              <tbody>
                {trainingPacks.map((pack) => (
                  <tr key={`${pack.orgId}:${pack.trainingPackId}`}>
                    <td>
                      <Link className="inline-link subtle" href={`/app/training/${pack.trainingPackId}`}>
                        <strong>{pack.title}</strong>
                      </Link>
                      <div className="table-subcopy">
                        {pack.active ? "Active" : "Inactive"} | {pack.scenarioSelectionLabel}
                      </div>
                      <div className="table-subcopy">
                        {pack.completionSupported
                          ? `${pack.requiredScenarioCount} required scenarios in current pack definition`
                          : "Completion unavailable until required scenarios are mapped"}
                      </div>
                    </td>
                    <td>
                      <Link className="inline-link subtle" href={`/app/customers/${pack.orgId}`}>
                        {pack.orgName}
                      </Link>
                    </td>
                    <td>{pack.requiredScenarioCount}</td>
                    <td>{pack.assignedLearnerCount}</td>
                    <td>{pack.startedLearnerCount}</td>
                    <td>{pack.inProgressLearnerCount}</td>
                    <td>{pack.completedLearnerCount}</td>
                    <td>{pack.notStartedLearnerCount}</td>
                    <td>{pack.attemptsLast30Days}</td>
                    <td>
                      {pack.scoredAttemptsLast30Days}
                      <div className="table-subcopy">
                        Avg {pack.averageScoreLast30Days !== null ? formatScore(pack.averageScoreLast30Days) : "-"} |{" "}
                        {pack.scoreDeltaLast30Days !== null ? formatSignedPercent(pack.scoreDeltaLast30Days) : "No prior window"}
                      </div>
                    </td>
                    <td>{formatDateTime(pack.latestActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <article className="detail-card">
            <h3>No training packs in scope</h3>
            <p>No training-pack rows were returned from the active backend storage provider for the customers in your current scope.</p>
          </article>
        )}
      </section>
    </>
  );
}
