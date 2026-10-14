"use client";

import React, { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function CurrentTrainingProgressDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const headingId = `${id}-training-progress-heading`;
  const contentId = `${id}-training-progress-content`;

  return <section className="dashboard-proof-block" aria-labelledby={headingId}>
    <div className="section-header performance-disclosure-header">
      <div className="performance-disclosure-heading">
        <h3 id={headingId}>Current training progress</h3>
        <div className="performance-disclosure-summary">{summary}</div>
      </div>
      <button type="button" className="ghost-button performance-disclosure-toggle"
        aria-expanded={open} aria-controls={contentId}
        aria-label={`${open ? "Collapse" : "Expand"} Current training progress`}
        onClick={() => setOpen((current) => !current)}>
        <span>{open ? "Collapse" : "Expand"}</span>
        {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      </button>
    </div>
    <div id={contentId} className="performance-disclosure-body" hidden={!open}>{children}</div>
  </section>;
}
