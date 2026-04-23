import { DashboardCoachingInsights } from "@voicepractice/shared";

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

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
              <strong>{item.theme}</strong> ({formatCount(item.countLast30Days, "mention")})
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
  const coverageSummary =
    insights.totalScoredAttemptsLast30Days === 0
      ? "No scored attempts in the last 30 days."
      : insights.artifactBackedScoresLast30Days === insights.totalScoredAttemptsLast30Days
        ? `Coaching detail is available for all ${formatCount(insights.totalScoredAttemptsLast30Days, "scored attempt")} in the last 30 days.`
        : `Coaching detail is available for ${insights.artifactBackedScoresLast30Days} of ${insights.totalScoredAttemptsLast30Days} scored attempts in the last 30 days.`;
  const themeCoverageSummary =
    hasArtifactData && insights.normalizedThemeScoresLast30Days < insights.artifactBackedScoresLast30Days
      ? `${insights.normalizedThemeScoresLast30Days} of those attempts mapped cleanly to the shared theme set.`
      : null;

  return (
    <section className={embedded ? "dashboard-embedded-section" : "section-card"}>
      <div className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="section-copy">{description}</p>
        </div>
        <div className="pill-row">
          <span className="pill accent">{insights.artifactBackedScoresLast30Days} with coaching detail</span>
          <span className="pill">{insights.totalScoredAttemptsLast30Days} scored attempts</span>
        </div>
      </div>

      <p className="small-copy dashboard-coaching-meta" style={{ marginTop: 0 }}>
        {coverageSummary}
        {themeCoverageSummary ? ` ${themeCoverageSummary}` : ""}
      </p>

      {hasArtifactData ? (
        <div className="info-grid">
          <ThemeList
            title="Improvement themes"
            items={insights.topImprovementAreas}
            emptyMessage="No recurring improvement themes were found in this scope."
          />
          <ThemeList
            title="Strength themes"
            items={insights.topStrengths}
            emptyMessage="No recurring strength themes were found in this scope."
          />
          <ThemeList
            title="Coaching priorities"
            items={insights.topCoachingPriorities}
            emptyMessage="No recurring coaching priorities were found in this scope."
          />
        </div>
      ) : (
        <article className="detail-card">
          <h3>No coaching detail yet</h3>
          <p>{emptyMessage}</p>
        </article>
      )}
    </section>
  );
}
