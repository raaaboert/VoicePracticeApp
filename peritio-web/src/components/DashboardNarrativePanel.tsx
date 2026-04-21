import { DashboardNarrative } from "@/src/lib/dashboardNarratives";

export function DashboardNarrativePanel({
  eyebrow,
  title,
  narrative,
}: {
  eyebrow: string;
  title: string;
  narrative: DashboardNarrative;
}) {
  return (
    <section className="section-card dashboard-story-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>

      <p className="dashboard-story-summary">{narrative.summary}</p>

      {narrative.note ? <p className="dashboard-story-note">{narrative.note}</p> : null}
    </section>
  );
}
