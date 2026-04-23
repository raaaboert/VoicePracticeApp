"use client";

import { ReactNode, useState } from "react";

export function DashboardProofSection({
  eyebrow = "Supporting evidence",
  title,
  description,
  preview,
  children,
  defaultOpen = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  preview?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const summaryText = isOpen ? description ?? preview ?? null : preview ?? description ?? null;

  return (
    <details
      className="section-card dashboard-proof-section"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="dashboard-proof-summary">
        <div className="dashboard-proof-summary-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          {summaryText ? <p className="dashboard-proof-preview">{summaryText}</p> : null}
        </div>
        <span className="dashboard-proof-toggle">{isOpen ? "Hide evidence" : "Show evidence"}</span>
      </summary>

      <div className="dashboard-proof-body">{children}</div>
    </details>
  );
}
