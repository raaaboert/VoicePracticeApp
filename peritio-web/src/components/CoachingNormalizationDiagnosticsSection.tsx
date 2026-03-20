import { DashboardCoachingNormalizationDiagnostics } from "@voicepractice/shared";

function formatPhraseDelta(delta: number | null): string {
  if (delta === null) {
    return "No prior comparison";
  }
  if (delta === 0) {
    return "No change vs prior 30 days";
  }
  return `${delta > 0 ? "+" : ""}${delta} vs prior 30 days`;
}

function formatCoverage(diagnostics: {
  mappedPhrasesLast30Days: number;
  totalPhrasesLast30Days: number;
  mappingCoveragePercentLast30Days: number | null;
}): string {
  if (diagnostics.mappingCoveragePercentLast30Days === null) {
    return "No artifact-backed phrases in the last 30 days";
  }

  return `${diagnostics.mappedPhrasesLast30Days}/${diagnostics.totalPhrasesLast30Days} mapped (${diagnostics.mappingCoveragePercentLast30Days}%)`;
}

function DiagnosticsCard({
  title,
  diagnostics,
}: {
  title: string;
  diagnostics: DashboardCoachingNormalizationDiagnostics["strengths"];
}) {
  return (
    <article className="detail-card">
      <h3>{title}</h3>
      <p className="small-copy" style={{ marginTop: 0 }}>
        {formatCoverage(diagnostics)} • {diagnostics.unmappedPhrasesLast30Days} unmapped in the last 30 days
      </p>
      {diagnostics.topUnmappedPhrases.length > 0 ? (
        <ul className="bullet-list">
          {diagnostics.topUnmappedPhrases.map((phrase) => (
            <li key={`${title}:${phrase.phrase}`}>
              <strong>{phrase.phrase}</strong> ({phrase.countLast30Days})
              <div className="table-subcopy">{formatPhraseDelta(phrase.deltaCount)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p>No repeated unmapped phrases are currently surfacing here.</p>
      )}
    </article>
  );
}

export function CoachingNormalizationDiagnosticsSection({
  diagnostics,
}: {
  diagnostics: DashboardCoachingNormalizationDiagnostics;
}) {
  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Internal diagnostics</p>
          <h2>Unmapped coaching phrases</h2>
          <p className="section-copy">
            These internal diagnostics help tune the lightweight canonical mapping set. They show which persisted coaching phrases are still failing to map cleanly, so the highest-value additions can be made safely.
          </p>
        </div>
        <div className="pill-row">
          <span className="pill accent">{diagnostics.canonicalThemeCount} canonical themes</span>
          <span className="pill">Platform-admin only</span>
        </div>
      </div>

      <div className="info-grid">
        <DiagnosticsCard title="Improvement areas" diagnostics={diagnostics.improvementAreas} />
        <DiagnosticsCard title="Strengths" diagnostics={diagnostics.strengths} />
        <DiagnosticsCard title="Coaching priorities" diagnostics={diagnostics.coachingPriorities} />
      </div>
    </section>
  );
}
