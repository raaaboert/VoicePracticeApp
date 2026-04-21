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

  const [primary, ...secondary] = items;

  return (
    <section className="section-card dashboard-priority-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          {description ? <p className="section-copy">{description}</p> : null}
        </div>
      </div>

      <div className="dashboard-priority-stack">
        <article
          className={`dashboard-priority-primary dashboard-priority-tone-${primary.tone}`}
          key={`${primary.title}-${primary.detail}`}
        >
          <p className="dashboard-priority-kicker">{primary.label}</p>
          <h3>{primary.title}</h3>
          <p>{primary.detail}</p>
        </article>

        {secondary.length > 0 ? (
          <div className="dashboard-priority-secondary-list">
            {secondary.map((item) => (
              <article
                key={`${item.title}-${item.detail}`}
                className={`dashboard-priority-secondary dashboard-priority-tone-${item.tone}`}
              >
                <p className="dashboard-priority-kicker">{item.label}</p>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
