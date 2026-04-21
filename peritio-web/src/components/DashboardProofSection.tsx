"use client";

import { ReactNode, useState } from "react";

export function DashboardProofSection({
  eyebrow = "Details and proof",
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

  return (
    <details
      className="section-card dashboard-proof-section"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="dashboard-proof-summary">
        <div className="dashboard-proof-summary-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="dashboard-proof-preview">{isOpen ? description ?? preview ?? "" : preview ?? description ?? ""}</p>
        </div>
        <span className="dashboard-proof-toggle">{isOpen ? "Hide proof" : "Show proof"}</span>
      </summary>

      <div className="dashboard-proof-body">{children}</div>
    </details>
  );
}
