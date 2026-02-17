"use client";

import { useEffect, useMemo, useState } from "react";
import { EnterpriseOrg, UserProfile } from "@voicepractice/shared";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";
import { useAdminMode } from "../../src/lib/adminMode";

interface UsageRow {
  userId: string;
  email: string;
  tier: string;
  accountType: string;
  status: string;
  minutesUsedToday: number;
  minutesUsedThisMonth: number;
  dailySecondsRemaining: number | null;
  tokensUsedToday: number;
  tokensUsedThisMonth: number;
}

interface UsageResponse {
  generatedAt: string;
  rows: UsageRow[];
}

export default function UsagePage() {
  useRequireAdminToken();
  const mode = useAdminMode();
  const isPersonalMode = mode === "personal";
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [orgs, setOrgs] = useState<EnterpriseOrg[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [orgFilter, setOrgFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const usagePayload = await adminFetch<UsageResponse>("/usage");
      setUsage(usagePayload);
      if (isPersonalMode) {
        setUsers([]);
        setOrgs([]);
      } else {
        const [usersPayload, orgsPayload] = await Promise.all([
          adminFetch<UserProfile[]>("/users"),
          adminFetch<EnterpriseOrg[]>("/orgs"),
        ]);
        setUsers(usersPayload);
        setOrgs(orgsPayload);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load usage.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isPersonalMode]);

  useEffect(() => {
    if (isPersonalMode) {
      setOrgFilter("");
    }
  }, [isPersonalMode]);

  const selectedOrg = useMemo(() => {
    const query = orgFilter.trim().toLowerCase();
    if (!query) {
      return null;
    }

    return orgs.find((org) => org.name.trim().toLowerCase() === query) ?? null;
  }, [orgFilter, orgs]);

  const filteredRows = useMemo(() => {
    const rows = (usage?.rows ?? []).filter((row) =>
      isPersonalMode ? row.accountType === "individual" : row.accountType === "enterprise"
    );

    if (isPersonalMode || !selectedOrg) {
      return rows;
    }

    const userById = new Map(users.map((user) => [user.id, user]));
    return rows.filter((row) => userById.get(row.userId)?.orgId === selectedOrg.id);
  }, [isPersonalMode, selectedOrg, usage?.rows, users]);

  return (
    <AdminShell title={isPersonalMode ? "Usage (Personal)" : "Usage (Enterprise)"}>
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 520px", minWidth: 280 }}>
            <p className="small" style={{ marginTop: 0 }}>
              Basic monthly usage rollup. Generated:{" "}
              {usage?.generatedAt ? new Date(usage.generatedAt).toLocaleString() : "-"}
            </p>

            {isPersonalMode ? (
              <p className="small" style={{ marginBottom: 0 }}>
                Showing individual/personal accounts only.
              </p>
            ) : (
              <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                  <label>Enterprise Account</label>
                  <input
                    value={orgFilter}
                    onChange={(event) => setOrgFilter(event.target.value)}
                    placeholder="Start typing a company name..."
                    list="enterprise-accounts"
                  />
                  <datalist id="enterprise-accounts">
                    {orgs
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((org) => (
                        <option key={org.id} value={org.name} />
                      ))}
                  </datalist>
                  <div className="small" style={{ marginTop: 4 }}>
                    {selectedOrg ? `Filtering to: ${selectedOrg.name}` : "No filter applied (showing all enterprise users)."}
                  </div>
                </div>
                <div style={{ alignSelf: "end" }}>
                  <button type="button" onClick={() => setOrgFilter("")} disabled={!orgFilter.trim()}>
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          <button onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Tier</th>
              <th>Type</th>
              <th>Status</th>
              <th>Minutes Today</th>
              <th>Minutes This Month</th>
              <th>Tokens Today</th>
              <th>Tokens This Month</th>
              <th>Daily Remaining</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.userId}>
                <td>
                  <div>{row.email}</div>
                  <div className="small">{row.userId}</div>
                </td>
                <td>{row.tier}</td>
                <td>{row.accountType}</td>
                <td>{row.status}</td>
                <td>{row.minutesUsedToday}</td>
                <td>{row.minutesUsedThisMonth}</td>
                <td>{row.tokensUsedToday}</td>
                <td>{row.tokensUsedThisMonth}</td>
                <td>
                  {row.dailySecondsRemaining === null ? "unlimited" : `${Math.floor(row.dailySecondsRemaining / 60)}m`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
