"use client";

import React, { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function PerformanceCardDisclosure({
  eyebrow,
  title,
  headingId,
  contentId,
  description,
  summary,
  className = "",
  children,
}: {
  eyebrow: string;
  title: string;
  headingId: string;
  contentId: string;
  description: ReactNode;
  summary: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className={`section-card performance-disclosure-card ${className}`.trim()} aria-labelledby={headingId}>
      <div className="section-header performance-disclosure-header">
        <div className="performance-disclosure-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={headingId}>{title}</h2>
          <div className="section-copy">{description}</div>
          <div className="performance-disclosure-summary" aria-label={`${title} summary`}>
            {summary}
          </div>
        </div>
        <button
          className="ghost-button performance-disclosure-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{open ? "Collapse" : "Expand"}</span>
          {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>
      </div>
      <div id={contentId} className="performance-disclosure-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
