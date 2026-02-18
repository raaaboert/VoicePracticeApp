"use client";

import { useEffect, useMemo, useState } from "react";
import { EnterpriseOrg, UserProfile } from "@voicepractice/shared";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";
import { useAdminMode } from "../../src/lib/adminMode";

type AuditActorType = "platform_admin" | "mobile_user" | "system";

interface AuditEventRow {
  id: string;
  actorType: AuditActorType;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  orgId: string | null;
  orgName: string | null;
  userId: string | null;
  userEmail: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditEventsResponse {
  generatedAt: string;
  filters: {
    orgId: string | null;
    actorId: string | null;
    actorType: AuditActorType | null;
    action: string | null;
    from: string;
    to: string;
    limit: number;
  };
  rows: AuditEventRow[];
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString();
}

function toStartOfDayIso(dateString: string): string | null {
  if (!dateString.trim()) {
    return null;
  }

  const parsed = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function toEndOfDayIso(dateString: string): string | null {
  if (!dateString.trim()) {
    return null;
  }

  const parsed = new Date(`${dateString}T23:59:59.999Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function formatMetadata(value: Record<string, unknown> | null): string {
  if (!value) {
    return "-";
  }

  return JSON.stringify(value, null, 2);
}

export default function LogsPage() {
  useRequireAdminToken();
  const mode = useAdminMode();
  const isPersonalMode = mode === "personal";

  const [orgs, setOrgs] = useState<EnterpriseOrg[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [payload, setPayload] = useState<AuditEventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [days, setDays] = useState(14);
  const [orgId, setOrgId] = useState("");
  const [actorId, setActorId] = useState("");
  const [actorType, setActorType] = useState<"" | AuditActorType>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (isPersonalMode) {
      setOrgId("");
    }
  }, [isPersonalMode]);

  const orgOptions = useMemo(() => [...orgs].sort((a, b) => a.name.localeCompare(b.name)), [orgs]);
  const userOptions = useMemo(() => [...users].sort((a, b) => a.email.localeCompare(b.email)), [users]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      query.set("days", String(days));
      query.set("limit", "300");
      if (orgId) {
        query.set("orgId", orgId);
      }
      if (actorId) {
        query.set("actorId", actorId);
      }
      if (actorType) {
        query.set("actorType", actorType);
      }

      const fromIso = toStartOfDayIso(fromDate);
      const toIso = toEndOfDayIso(toDate);
      if (fromIso) {
        query.set("from", fromIso);
      }
      if (toIso) {
        query.set("to", toIso);
      }

      const [orgPayload, userPayload, eventsPayload] = await Promise.all([
        adminFetch<EnterpriseOrg[]>("/orgs"),
        adminFetch<UserProfile[]>("/users"),
        adminFetch<AuditEventsResponse>(`/audit/events?${query.toString()}`)
      ]);

      setOrgs(orgPayload);
      setUsers(userPayload);
      setPayload(eventsPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load audit logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, orgId, actorId, actorType, fromDate, toDate]);

  const rows = useMemo(
    () =>
      (payload?.rows ?? []).filter((row) => (isPersonalMode ? row.orgId === null : true)),
    [isPersonalMode, payload?.rows],
  );

  return (
    <AdminShell title={isPersonalMode ? "Logs (Personal)" : "Logs"}>
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Filters</h3>
        <div className="grid">
          <div>
            <label>Date Range</label>
            <select value={days} onChange={(event) => setDays(Number(event.target.value) || 14)}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>

          {isPersonalMode ? null : (
            <div>
              <label>Enterprise Account</label>
              <select value={orgId} onChange={(event) => setOrgId(event.target.value)}>
                <option value="">All accounts</option>
                {orgOptions.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label>Actor</label>
            <select value={actorId} onChange={(event) => setActorId(event.target.value)}>
              <option value="">All actors</option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.email}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Actor Type</label>
            <select value={actorType} onChange={(event) => setActorType(event.target.value as "" | AuditActorType)}>
              <option value="">All actor types</option>
              <option value="platform_admin">Platform Admin</option>
              <option value="mobile_user">Mobile User</option>
              <option value="system">System</option>
            </select>
          </div>

          <div>
            <label>From</label>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </div>

          <div>
            <label>To</label>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginTop: 12 }}>
          <p className="small" style={{ margin: 0 }}>
            Generated: {payload?.generatedAt ? formatDateTime(payload.generatedAt) : "-"}
          </p>
          <button onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Audit Events ({rows.length})</h3>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Enterprise Account</th>
              <th>Target User</th>
              <th>Message</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="small">
                  No matching events.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{formatDateTime(row.createdAt)}</div>
                    <div className="small">{row.id}</div>
                  </td>
                  <td>
                    <div>{row.actorEmail ?? row.actorId ?? "-"}</div>
                    <div className="small">{row.actorType}</div>
                  </td>
                  <td>
                    <code>{row.action}</code>
                  </td>
                  <td>
                    <div>{row.orgName ?? "-"}</div>
                    <div className="small">{row.orgId ?? ""}</div>
                  </td>
                  <td>
                    <div>{row.userEmail ?? "-"}</div>
                    <div className="small">{row.userId ?? ""}</div>
                  </td>
                  <td style={{ maxWidth: 360 }}>{row.message}</td>
                  <td>
                    {row.metadata ? (
                      <details>
                        <summary>View</summary>
                        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{formatMetadata(row.metadata)}</pre>
                      </details>
                    ) : (
                      <span className="small">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
