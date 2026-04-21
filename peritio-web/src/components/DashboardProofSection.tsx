import { ReactNode } from "react";

export function DashboardProofSection({
  eyebrow = "Details and proof",
  title,
  description,
  children,
  defaultOpen = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="section-card dashboard-proof-section" open={defaultOpen}>
      <summary className="dashboard-proof-summary">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          {description ? <p className="section-copy">{description}</p> : null}
        </div>
        <span className="dashboard-proof-toggle">Expand</span>
      </summary>

      <div className="dashboard-proof-body">{children}</div>
    </details>
  );
}
