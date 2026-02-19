"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OrgUsageBillingResponse } from "@voicepractice/shared";
import { AdminShell } from "../../../../../src/components/AdminShell";
import { useRequireAdminToken } from "../../../../../src/components/useRequireAdminToken";
import { adminFetch } from "../../../../../src/lib/api";
import { withAdminMode } from "../../../../../src/lib/adminMode";

function toDateInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function toIsoFromDateInput(value: string, fallbackIso: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallbackIso;
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackIso;
  }

  return parsed.toISOString();
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function formatMinutes(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatCurrency(usd: number): string {
  const safe = Number.isFinite(usd) ? usd : 0;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(safe);
}

export default function EnterpriseUsageBillingPage() {
  useRequireAdminToken();
  const mode = "enterprise";
  const params = useParams();
  const orgId = useMemo(() => {
    const raw = params?.orgId;
    return Array.isArray(raw) ? raw[0] : (raw as string | undefined) ?? "";
  }, [params]);

  const [payload, setPayload] = useState<OrgUsageBillingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [contractSignedAtInput, setContractSignedAtInput] = useState("");
  const [monthlyMinutesInput, setMonthlyMinutesInput] = useState("0");
  const [renewalTotalInput, setRenewalTotalInput] = useState("0");
  const [softLimitOneInput, setSoftLimitOneInput] = useState("");
  const [softLimitTwoInput, setSoftLimitTwoInput] = useState("");

  const load = async () => {
    if (!orgId) {
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const nextPayload = await adminFetch<OrgUsageBillingResponse>(`/orgs/${orgId}/usage-billing`);
      setPayload(nextPayload);
      setContractSignedAtInput(toDateInputValue(nextPayload.org.contractSignedAt));
      setMonthlyMinutesInput(String(nextPayload.org.monthlyMinutesAllotted ?? 0));
      setRenewalTotalInput(String(nextPayload.org.renewalTotalUsd ?? 0));
      const triggers = [...(nextPayload.org.softLimitPercentTriggers ?? [])].sort((a, b) => a - b);
      setSoftLimitOneInput(triggers[0] !== undefined ? String(triggers[0]) : "");
      setSoftLimitTwoInput(triggers[1] !== undefined ? String(triggers[1]) : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load usage and billing details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const saveContractDetails = async () => {
    if (!payload) {
      return;
    }

    const monthlyMinutes = Math.max(0, Math.floor(Number(monthlyMinutesInput) || 0));
    const renewalTotalUsd = Math.max(0, Number(renewalTotalInput) || 0);
    const softLimitCandidates = [softLimitOneInput, softLimitTwoInput]
      .map((entry) => Math.round(Number(entry)))
      .filter((entry) => Number.isFinite(entry) && entry >= 1 && entry <= 100);
    const softLimitPercentTriggers = Array.from(new Set(softLimitCandidates)).sort((a, b) => a - b).slice(0, 2);

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/orgs/${orgId}`, {
        method: "PATCH",
        body: JSON.stringify({
          contractSignedAt: toIsoFromDateInput(contractSignedAtInput, payload.org.contractSignedAt),
          monthlyMinutesAllotted: monthlyMinutes,
          renewalTotalUsd,
          softLimitPercentTriggers
        })
      });
      setNotice("Usage/Billing contract settings saved.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save usage/billing settings.");
    } finally {
      setSaving(false);
    }
  };

  const orgAdminsLabel = payload?.orgAdmins.length
    ? payload.orgAdmins.map((admin) => admin.email).join(", ")
    : "(no org admin assigned)";

  return (
    <AdminShell title={payload?.org.name ? `Usage/Billing: ${payload.org.name}` : "Usage/Billing"}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>{payload?.org.name ?? (loading ? "Loading..." : "Enterprise Account")}</h3>
            <div className="small">{payload?.org.id ?? ""}</div>
          </div>
          <div className="card-actions">
            <Link className="button" href={withAdminMode(`/users/enterprise/${orgId}`, mode)}>
              Back to Enterprise
            </Link>
            <Link className="button" href={withAdminMode("/users", mode)}>
              Back to Accounts
            </Link>
          </div>
        </div>
        {loading ? <p className="small">Loading usage and billing...</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {notice ? <p className="success">{notice}</p> : null}
      </div>

      {payload ? (
        <>
          <div className="card">
            <h3>Contract Details</h3>
            <div className="grid">
              <div>
                <label>Date Signed</label>
                <div>{formatDate(payload.org.contractSignedAt)}</div>
              </div>
              <div>
                <label>Monthly Renewal Date</label>
                <div>{formatDate(payload.billingPeriod.nextRenewalAt)}</div>
              </div>
              <div>
                <label>Allotted Monthly Minutes</label>
                <div>{formatMinutes(payload.usage.allottedMinutes)}</div>
              </div>
              <div>
                <label>Used Minutes (Current Cycle)</label>
                <div>{formatMinutes(payload.usage.usedMinutes)}</div>
              </div>
              <div>
                <label>Usage Period</label>
                <div>
                  {formatDate(payload.billingPeriod.periodStartAt)} to {formatDate(payload.billingPeriod.periodEndAt)}
                </div>
              </div>
              <div>
                <label>Renewal Total</label>
                <div>{formatCurrency(payload.org.renewalTotalUsd)}</div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label>Org Admin Notification Target</label>
                <div>{orgAdminsLabel}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Soft Limits</h3>
            <p className="small" style={{ marginTop: 0 }}>
              Configure up to two usage-percentage triggers. When a threshold is reached, an org-admin notification event is logged.
            </p>
            <div className="small" style={{ marginBottom: 8 }}>
              Current usage: <strong>{payload.usage.usagePercent.toFixed(1)}%</strong> (
              {formatMinutes(payload.usage.usedMinutes)} / {formatMinutes(payload.usage.allottedMinutes)} minutes)
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Threshold</th>
                    <th>Reached</th>
                    <th>Notified At</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.softLimits.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="small">
                        No soft-limit thresholds configured.
                      </td>
                    </tr>
                  ) : (
                    payload.softLimits.map((limit) => (
                      <tr key={limit.thresholdPercent}>
                        <td>{limit.thresholdPercent}%</td>
                        <td>{limit.reached ? "Yes" : "No"}</td>
                        <td>{formatDateTime(limit.notifiedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Edit Contract (Manual Fields)</h3>
            <div className="grid">
              <div>
                <label>Date Signed</label>
                <input
                  type="date"
                  value={contractSignedAtInput}
                  onChange={(event) => setContractSignedAtInput(event.target.value)}
                />
              </div>
              <div>
                <label>Allotted Monthly Minutes</label>
                <input
                  type="number"
                  min={0}
                  value={monthlyMinutesInput}
                  onChange={(event) => setMonthlyMinutesInput(event.target.value)}
                />
              </div>
              <div>
                <label>Renewal Total (USD)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={renewalTotalInput}
                  onChange={(event) => setRenewalTotalInput(event.target.value)}
                />
              </div>
              <div>
                <label>Soft Limit Trigger 1 (%)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={softLimitOneInput}
                  onChange={(event) => setSoftLimitOneInput(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label>Soft Limit Trigger 2 (%)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={softLimitTwoInput}
                  onChange={(event) => setSoftLimitTwoInput(event.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="small" style={{ marginTop: 8 }}>
              Usage is auto-generated and cannot be manually edited.
            </div>
            <div className="form-actions">
              <button className="primary" disabled={saving} onClick={() => void saveContractDetails()}>
                {saving ? "Saving..." : "Save Usage/Billing Settings"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </AdminShell>
  );
}
