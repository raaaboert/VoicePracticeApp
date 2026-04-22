import { DashboardNarrativeSignal } from "@/src/lib/dashboardNarratives";

export function DashboardSupportSignals({
  title = "Support signals",
  signals,
}: {
  title?: string;
  signals: DashboardNarrativeSignal[];
}) {
  if (signals.length === 0) {
    return null;
  }

  return (
    <section className="dashboard-support-section" aria-label={title}>
      <div className="dashboard-support-row">
        {signals.map((signal, index) => (
          <article
            key={`${signal.label}-${signal.value}`}
            className={`dashboard-support-signal${index === 0 ? " dashboard-support-signal-primary" : ""}`}
          >
            <p className="dashboard-support-label">{signal.label}</p>
            <strong className="dashboard-support-value">{signal.value}</strong>
            {signal.context ? <p className="dashboard-support-context">{signal.context}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
