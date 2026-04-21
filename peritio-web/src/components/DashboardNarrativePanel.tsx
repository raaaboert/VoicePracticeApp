import { DashboardNarrative } from "@/src/lib/dashboardNarratives";

export function DashboardNarrativePanel({
  eyebrow,
  title,
  narrative,
  badges,
}: {
  eyebrow: string;
  title: string;
  narrative: DashboardNarrative;
  badges?: string[];
}) {
  return (
    <section className="section-card dashboard-story-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {badges && badges.length > 0 ? (
          <div className="pill-row">
            {badges.map((badge) => (
              <span key={badge} className="pill">
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className="dashboard-story-lead">{narrative.lead}</p>

      {narrative.support.length > 0 ? (
        <ul className="dashboard-story-list">
          {narrative.support.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {narrative.note ? <p className="dashboard-story-note">{narrative.note}</p> : null}
    </section>
  );
}
