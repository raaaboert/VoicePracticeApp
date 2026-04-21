import { DashboardNarrativePriority } from "@/src/lib/dashboardNarratives";

export function DashboardWhatMattersSection({
  eyebrow = "What matters most",
  title = "Where attention should go",
  description,
  items,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  items: DashboardNarrativePriority[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="section-card dashboard-priority-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          {description ? <p className="section-copy">{description}</p> : null}
        </div>
      </div>

      <div className="dashboard-priority-list">
        {items.map((item) => (
          <article key={`${item.title}-${item.detail}`} className="dashboard-priority-item">
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
