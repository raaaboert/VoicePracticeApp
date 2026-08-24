"use client";

import React from "react";
import { OrgModuleEntitlementState } from "@voicepractice/shared";

interface EnterpriseModuleEntitlementsCardProps {
  trainingContent: OrgModuleEntitlementState | null;
  saving: boolean;
  onTrainingContentChange: (enabled: boolean) => void;
}

export function EnterpriseModuleEntitlementsCard({
  trainingContent,
  saving,
  onTrainingContentChange,
}: EnterpriseModuleEntitlementsCardProps) {
  const enabled = trainingContent?.enabled === true;
  const unavailable = trainingContent === null;

  return (
    <div className="card enterprise-section-card">
      <div className="card-header">
        <h3 style={{ marginBottom: 0 }}>Account Modules</h3>
      </div>
      <div className="module-entitlement-row">
        <div>
          <div className="module-entitlement-name">Learning Resources</div>
          <div className={`module-entitlement-status ${enabled ? "enabled" : "disabled"}`}>
            {unavailable ? "Unavailable" : enabled ? "Enabled" : "Disabled"}
          </div>
        </div>
        <label className="module-entitlement-toggle">
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable Learning Resources"
            aria-checked={enabled}
            checked={enabled}
            disabled={saving || unavailable}
            onChange={(event) => onTrainingContentChange(event.target.checked)}
          />
          <span>{saving ? "Saving..." : enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>
    </div>
  );
}
