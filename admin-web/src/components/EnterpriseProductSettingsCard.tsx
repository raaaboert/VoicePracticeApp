"use client";

import React from "react";
import type {
  OrganizationProductSettings,
  OrganizationProductSwitchKey,
} from "@voicepractice/shared";

const SWITCHES: Array<{ key: OrganizationProductSwitchKey; label: string }> = [
  { key: "allowCustomerScenarioCreation", label: "Allow Customer Scenario Creation" },
  { key: "requireOrgAdminScenarioApproval", label: "Require Org Admin Approval Before Publishing" },
  { key: "allowUserAdminFocusTopicManagement", label: "Allow User Admin Focus Topic Management" },
  { key: "allowManagerFocusTopicManagement", label: "Allow Manager Focus Topic Management" },
];

export function EnterpriseProductSettingsCard(props: {
  settings: OrganizationProductSettings | null;
  savingSwitch: OrganizationProductSwitchKey | null;
  onChange: (switchKey: OrganizationProductSwitchKey, enabled: boolean) => void;
}) {
  return (
    <div className="card enterprise-section-card">
      <div className="card-header">
        <div>
          <h3 style={{ marginBottom: 0 }}>Product Controls</h3>
          <p className="small enterprise-note">Peritio-controlled organization product policy.</p>
        </div>
      </div>
      {SWITCHES.map(({ key, label }) => {
        const enabled = props.settings?.[key] === true;
        const unavailable = props.settings === null;
        return (
          <div className="module-entitlement-row" key={key}>
            <div>
              <div className="module-entitlement-name">{label}</div>
              <div className={`module-entitlement-status ${enabled ? "enabled" : "disabled"}`}>
                {unavailable ? "Unavailable" : enabled ? "Enabled" : "Disabled"}
              </div>
            </div>
            <label className="module-entitlement-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-label={label}
                aria-checked={enabled}
                checked={enabled}
                disabled={unavailable || props.savingSwitch !== null}
                onChange={(event) => props.onChange(key, event.target.checked)}
              />
              <span>{props.savingSwitch === key ? "Saving..." : enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}
