interface MetricCardProps {
  label: string;
  value: string;
  meta?: string;
  tone?: "default" | "positive" | "accent" | "warm";
}

export function MetricCard({ label, value, meta, tone = "default" }: MetricCardProps) {
  return (
    <article className={`metric-card ${tone}`}>
      <p className="metric-label">{label}</p>
      <strong className="metric-value">{value}</strong>
      {meta ? <p className="metric-meta">{meta}</p> : null}
    </article>
  );
}
