"use client";

import { useEffect, useMemo, useState } from "react";
import { AppConfig, EnterpriseOrg, formatSecondsAsClock } from "@voicepractice/shared";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";

interface StatsRow {
  sessions: number;
  billedSeconds: number;
  avgOverallScore: number | null;
}

interface StatsByOrgRow extends StatsRow {
  orgId: string;
  orgName: string;
}

interface StatsBySegmentRow extends StatsRow {
  segmentId: string;
  segmentLabel: string;
}

interface StatsByDayRow extends StatsRow {
  dayKey: string;
}

interface StatsTopUserRow {
  userId: string;
  email: string;
  orgId: string | null;
  orgName: string | null;
  sessions: number;
  avgOverallScore: number | null;
}

interface StatsResponse {
  generatedAt: string;
  period: { startAt: string; endAt: string; days: number };
  filters: { orgId: string | null; segmentId: string | null };
  totals: StatsRow;
  byOrg: StatsByOrgRow[];
  bySegment: StatsBySegmentRow[];
  trendByDay: StatsByDayRow[];
  topUsers: StatsTopUserRow[];
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(1);
}

export default function StatsPage() {
  useRequireAdminToken();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [orgs, setOrgs] = useState<EnterpriseOrg[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [rangeDays, setRangeDays] = useState(30);
  const [orgId, setOrgId] = useState("");
  const [segmentId, setSegmentId] = useState("");

  const segmentOptions = useMemo(() => {
    const enabled = config?.segments?.filter((segment) => segment.enabled) ?? [];
    return enabled.slice().sort((a, b) => a.label.localeCompare(b.label));
  }, [config?.segments]);

  const orgOptions = useMemo(() => [...orgs].sort((a, b) => a.name.localeCompare(b.name)), [orgs]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const qs = new URLSearchParams();
      qs.set("days", String(rangeDays));
      if (orgId) {
        qs.set("orgId", orgId);
      }
      if (segmentId) {
        qs.set("segmentId", segmentId);
      }

      const [configPayload, orgsPayload, statsPayload] = await Promise.all([
        adminFetch<AppConfig>("/config"),
        adminFetch<EnterpriseOrg[]>("/orgs"),
        adminFetch<StatsResponse>(`/stats?${qs.toString()}`),
      ]);

      setConfig(configPayload);
      setOrgs(orgsPayload);
      setStats(statsPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load stats.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDays, orgId, segmentId]);

  return (
    <AdminShell title="Stats">
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Filters</h3>
        <div className="grid">
          <div>
            <label>Date Range</label>
            <select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value) || 30)}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last 365 days</option>
            </select>
          </div>
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
          <div>
            <label>Segment</label>
            <select value={segmentId} onChange={(event) => setSegmentId(event.target.value)}>
              <option value="">All segments</option>
              {segmentOptions.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 10 }}>
          <p className="small" style={{ margin: 0 }}>
            Generated: {stats?.generatedAt ? formatDateTime(stats.generatedAt) : "-"}
          </p>
          <button onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Overview</h3>
        <div className="grid">
          <div>
            <label>Sessions</label>
            <div>{stats?.totals.sessions ?? "-"}</div>
          </div>
          <div>
            <label>Billed Usage</label>
            <div>{stats ? formatSecondsAsClock(stats.totals.billedSeconds) : "-"}</div>
          </div>
          <div>
            <label>Avg Score</label>
            <div>{formatScore(stats?.totals.avgOverallScore ?? null)}</div>
          </div>
          <div>
            <label>Period</label>
            <div className="small">
              {stats?.period ? `${formatDateTime(stats.period.startAt)} to ${formatDateTime(stats.period.endAt)}` : "-"}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Trend (Daily)</h3>
        <p className="small" style={{ marginTop: 0 }}>
          Shows sessions, billed usage, and average score by day.
        </p>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Sessions</th>
              <th>Billed</th>
              <th>Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.trendByDay ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="small">
                  No data in this period.
                </td>
              </tr>
            ) : (
              (stats?.trendByDay ?? []).map((row) => (
                <tr key={row.dayKey}>
                  <td>{row.dayKey}</td>
                  <td>{row.sessions}</td>
                  <td>{formatSecondsAsClock(row.billedSeconds)}</td>
                  <td>{formatScore(row.avgOverallScore)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>By Enterprise Account</h3>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Sessions</th>
              <th>Billed</th>
              <th>Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.byOrg ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="small">
                  No data in this period.
                </td>
              </tr>
            ) : (
              (stats?.byOrg ?? []).map((row) => (
                <tr key={row.orgId}>
                  <td>
                    <div>{row.orgName}</div>
                    <div className="small">{row.orgId}</div>
                  </td>
                  <td>{row.sessions}</td>
                  <td>{formatSecondsAsClock(row.billedSeconds)}</td>
                  <td>{formatScore(row.avgOverallScore)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>By Segment</h3>
        <table>
          <thead>
            <tr>
              <th>Segment</th>
              <th>Sessions</th>
              <th>Billed</th>
              <th>Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.bySegment ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="small">
                  No data in this period.
                </td>
              </tr>
            ) : (
              (stats?.bySegment ?? []).map((row) => (
                <tr key={row.segmentId}>
                  <td>
                    <div>{row.segmentLabel}</div>
                    <div className="small">{row.segmentId}</div>
                  </td>
                  <td>{row.sessions}</td>
                  <td>{formatSecondsAsClock(row.billedSeconds)}</td>
                  <td>{formatScore(row.avgOverallScore)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Top Users (By Avg Score)</h3>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Enterprise Account</th>
              <th>Sessions</th>
              <th>Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.topUsers ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="small">
                  No score data in this period.
                </td>
              </tr>
            ) : (
              (stats?.topUsers ?? []).map((row) => (
                <tr key={row.userId}>
                  <td>
                    <div>{row.email}</div>
                    <div className="small">{row.userId}</div>
                  </td>
                  <td>
                    <div>{row.orgName ?? "-"}</div>
                    <div className="small">{row.orgId ?? ""}</div>
                  </td>
                  <td>{row.sessions}</td>
                  <td>{formatScore(row.avgOverallScore)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

