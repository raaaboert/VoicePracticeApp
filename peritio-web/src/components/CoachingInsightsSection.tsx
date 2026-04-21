import { DashboardCoachingInsights } from "@voicepractice/shared";

function formatThemeDelta(delta: number | null): string {
  if (delta === null) {
    return "No prior comparison";
  }
  if (delta === 0) {
    return "No change vs prior 30 days";
  }
  return `${delta > 0 ? "+" : ""}${delta} vs prior 30 days`;
}

function ThemeList({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: DashboardCoachingInsights["topImprovementAreas"];
  emptyMessage: string;
}) {
  return (
    <article className="detail-card">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul className="bullet-list">
          {items.map((item) => (
            <li key={`${title}:${item.themeId}`}>
              <strong>{item.theme}</strong> ({item.countLast30Days})
              <div className="table-subcopy">{formatThemeDelta(item.deltaCount)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </article>
  );
}

export function CoachingInsightsSection({
  eyebrow,
  title,
  description,
  insights,
  emptyMessage,
  embedded = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  insights: DashboardCoachingInsights;
  emptyMessage: string;
  embedded?: boolean;
}) {
  const hasArtifactData = insights.artifactBackedScoresLast30Days > 0;

  return (
    <section className={embedded ? "dashboard-embedded-section" : "section-card"}>
      <div className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="section-copy">{description}</p>
        </div>
        <div className="pill-row">
          <span className="pill accent">{insights.artifactBackedScoresLast30Days} artifact-backed</span>
          <span className="pill">{insights.totalScoredAttemptsLast30Days} scored attempts</span>
          {insights.repeatedFocusArea ? <span className="pill">{insights.repeatedFocusArea}</span> : null}
        </div>
      </div>

      <p className="small-copy" style={{ marginTop: 0 }}>
        Only persisted coaching artifact data is included here. Artifact coverage in the last 30 days is{" "}
        {insights.artifactBackedScoresLast30Days}/{insights.totalScoredAttemptsLast30Days} scored attempts
        {insights.artifactCoveragePercentLast30Days !== null ? ` (${insights.artifactCoveragePercentLast30Days}%)` : ""}.
        {insights.artifactBackedScoresLast30Days < insights.totalScoredAttemptsLast30Days
          ? " Older score records without persisted coaching artifacts are excluded."
          : ""}
        {" "}Normalized theme coverage is {insights.normalizedThemeScoresLast30Days}/{insights.totalScoredAttemptsLast30Days}
        {insights.normalizedThemeCoveragePercentLast30Days !== null
          ? ` (${insights.normalizedThemeCoveragePercentLast30Days}%)`
          : ""}.
        {insights.normalizedThemeScoresLast30Days < insights.artifactBackedScoresLast30Days
          ? " Some artifact-backed records did not map cleanly to the lightweight canonical theme set."
          : ""}
      </p>

      {hasArtifactData ? (
        <div className="info-grid">
          <ThemeList
            title="Top improvement themes"
            items={insights.topImprovementAreas}
            emptyMessage="No persisted improvement themes were found in this scope."
          />
          <ThemeList
            title="Top strengths"
            items={insights.topStrengths}
            emptyMessage="No persisted strengths were found in this scope."
          />
          <ThemeList
            title="Top coaching priorities"
            items={insights.topCoachingPriorities}
            emptyMessage="No persisted coaching priorities were found in this scope."
          />
        </div>
      ) : (
        <article className="detail-card">
          <h3>No coaching aggregate coverage yet</h3>
          <p>{emptyMessage}</p>
        </article>
      )}
    </section>
  );
}
