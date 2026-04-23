import { DashboardNarrativePriority } from "@/src/lib/dashboardNarratives";

export function DashboardWhatMattersSection({
  eyebrow = "Priorities",
  title = "What matters most",
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
    <section className="dashboard-priority-section">
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
          <div className="dashboard-priority-heading">
            <div>
              <p className="dashboard-priority-kicker">{primary.label}</p>
              <h3>{primary.title}</h3>
            </div>
          </div>
          <p>{primary.detail}</p>
        </article>

        {secondary.length > 0 ? (
          <div className="dashboard-priority-secondary-list">
            {secondary.map((item, index) => (
              <article
                key={`${item.title}-${item.detail}`}
                className={`dashboard-priority-secondary dashboard-priority-tone-${item.tone}`}
              >
                <div className="dashboard-priority-heading">
                  <div>
                    <p className="dashboard-priority-kicker">{item.label}</p>
                    <h3>{item.title}</h3>
                  </div>
                </div>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
