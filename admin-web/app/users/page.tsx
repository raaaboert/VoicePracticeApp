"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AppConfig,
  EnterpriseOrg,
  UserProfile,
  computeNextAnnualRenewalAt,
} from "@voicepractice/shared";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";
import { useAdminMode, withAdminMode } from "../../src/lib/adminMode";

interface OrgJoinRequestRow {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  email: string;
  emailDomain: string;
  user: {
    id: string;
    email: string;
    accountType: string;
    tier: string;
    status: string;
    orgId: string | null;
    orgRole: string;
  } | null;
  org: {
    id: string;
    name: string;
    emailDomain: string | null;
    joinCode: string;
    status: string;
  } | null;
}

type OrgJoinAction = "approve" | "reject";

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

export default function UsersPage() {
  useRequireAdminToken();
  const mode = useAdminMode();
  const isPersonalMode = mode === "personal";
  const [orgs, setOrgs] = useState<EnterpriseOrg[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [joinRequests, setJoinRequests] = useState<OrgJoinRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [contentIndustries, setContentIndustries] = useState<AppConfig["industries"]>([]);
  const [creating, setCreating] = useState(false);
  const [actingJoinRequestId, setActingJoinRequestId] = useState<string | null>(null);
  const [orgForm, setOrgForm] = useState<{ name: string; contactName: string; contactEmail: string; emailDomain: string }>({
    name: "",
    contactName: "",
    contactEmail: "",
    emailDomain: "",
  });

  const enterpriseOrgsSorted = useMemo(() => [...orgs].sort((a, b) => a.name.localeCompare(b.name)), [orgs]);
  const personalUsers = useMemo(
    () =>
      users
        .filter((user) => user.accountType === "individual")
        .slice()
        .sort((a, b) => a.email.localeCompare(b.email)),
    [users],
  );
  const defaultIndustryId = useMemo(() => {
    const enabled = contentIndustries.find((industry) => industry.enabled);
    return (enabled ?? contentIndustries[0])?.id ?? "";
  }, [contentIndustries]);
  const defaultIndustryLabel = useMemo(() => {
    const enabled = contentIndustries.find((industry) => industry.enabled);
    return (enabled ?? contentIndustries[0])?.label ?? "-";
  }, [contentIndustries]);
  const industryLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const industry of contentIndustries) {
      map.set(industry.id, industry.label);
    }
    return map;
  }, [contentIndustries]);

  const load = async () => {
    setLoading(true);
    try {
      setError(null);
      const userPayload = await adminFetch<UserProfile[]>("/users");
      setUsers(userPayload);
      if (isPersonalMode) {
        setOrgs([]);
        setJoinRequests([]);
        setContentIndustries([]);
        return;
      }

      const [orgPayload, requestPayload, configPayload] = await Promise.all([
        adminFetch<EnterpriseOrg[]>("/orgs"),
        adminFetch<{ rows: OrgJoinRequestRow[] }>("/org-join-requests"),
        adminFetch<AppConfig>("/config"),
      ]);
      setOrgs(orgPayload);
      setJoinRequests(requestPayload.rows ?? []);
      setContentIndustries(configPayload.industries ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load account data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isPersonalMode]);

  const onCreateEnterpriseOrg = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);

    try {
      const name = orgForm.name.trim();
      if (!name) {
        throw new Error("Company name is required.");
      }

      await adminFetch<EnterpriseOrg>("/orgs", {
        method: "POST",
        body: JSON.stringify({
          name,
          contactName: orgForm.contactName,
          contactEmail: orgForm.contactEmail,
          emailDomain: orgForm.emailDomain,
          activeIndustries: defaultIndustryId ? [defaultIndustryId] : undefined,
        }),
      });

      setOrgForm({ name: "", contactName: "", contactEmail: "", emailDomain: "" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create enterprise account.");
    } finally {
      setCreating(false);
    }
  };

  const decideJoinRequest = async (
    row: OrgJoinRequestRow,
    action: OrgJoinAction,
    options?: { assignOrgAdmin?: boolean }
  ) => {
    if (row.status !== "pending") {
      return;
    }

    const assignOrgAdmin = Boolean(options?.assignOrgAdmin);
    const confirmMessage =
      action === "approve"
        ? assignOrgAdmin
          ? `Approve ${row.email} and set org role to Org Admin?`
          : `Approve ${row.email} into ${row.org?.name ?? "this org"}?`
        : `Reject access request for ${row.email}?`;
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }

    const reasonInput = window.prompt("Optional reason (leave blank for default):", "");
    if (reasonInput === null) {
      return;
    }

    setActingJoinRequestId(row.id);
    setError(null);
    setNotice(null);
    try {
      await adminFetch<{ ok: true }>("/org-join-requests/" + row.id, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          reason: reasonInput.trim() || undefined,
          assignOrgAdmin: action === "approve" ? assignOrgAdmin : undefined
        })
      });
      setNotice(
        action === "approve"
          ? assignOrgAdmin
            ? `Approved ${row.email} as org admin.`
            : `Approved ${row.email}.`
          : `Rejected ${row.email}.`
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update request.");
    } finally {
      setActingJoinRequestId(null);
    }
  };

  return (
    <AdminShell title="Accounts">
      {isPersonalMode ? null : (
        <div className="card">
          <h3>Create Enterprise Account</h3>
          <form onSubmit={onCreateEnterpriseOrg} className="grid">
            <div>
              <label>Company Name</label>
              <input
                value={orgForm.name}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </div>
            <div>
              <label>Company Contact</label>
              <input
                value={orgForm.contactName}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, contactName: event.target.value }))}
              />
            </div>
            <div>
              <label>Contact Email</label>
              <input
                value={orgForm.contactEmail}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
              />
            </div>
            <div>
              <label>Org Email Domain</label>
              <input
                value={orgForm.emailDomain}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, emailDomain: event.target.value }))}
                placeholder="example.com"
              />
            </div>
            <div style={{ alignSelf: "end" }}>
              <button className="primary" disabled={creating}>
                {creating ? "Creating..." : "Create Enterprise Account"}
              </button>
            </div>
          </form>
          <p className="small" style={{ marginBottom: 0 }}>
            Default industry enabled: {defaultIndustryLabel}. Configure more on the account detail screen.
          </p>
          {error ? (
            <p className="error" style={{ marginBottom: 0 }}>
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="success" style={{ marginBottom: 0 }}>
              {notice}
            </p>
          ) : null}
        </div>
      )}

      {isPersonalMode ? null : (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <h3 style={{ marginBottom: 0 }}>Enterprise Accounts ({orgs.length})</h3>
            <button onClick={() => void load()}>Refresh</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Company Name</th>
                <th>Date Established</th>
                <th>Next Renewal Date</th>
                <th>Company Contact</th>
                <th>Contact Email</th>
                <th>Domain</th>
                <th>Join Code</th>
                <th>Segments Active</th>
              </tr>
            </thead>
            <tbody>
              {enterpriseOrgsSorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="small">
                    No enterprise accounts yet.
                  </td>
                </tr>
              ) : (
                enterpriseOrgsSorted.map((org) => {
                  const nextRenewalAt = computeNextAnnualRenewalAt(org.createdAt, new Date());
                  const segmentsActive =
                    Array.isArray(org.activeIndustries) && org.activeIndustries.length > 0
                      ? org.activeIndustries.map((id) => industryLabelById.get(id) ?? id).join(", ")
                      : "-";

                  return (
                    <tr key={org.id}>
                      <td>
                        <Link href={withAdminMode(`/users/enterprise/${org.id}`, mode)} style={{ textDecoration: "underline" }}>
                          {org.name}
                        </Link>
                        <div className="small">{org.id}</div>
                      </td>
                      <td>{formatDate(org.createdAt)}</td>
                      <td>{formatDate(nextRenewalAt)}</td>
                      <td>{org.contactName}</td>
                      <td>{org.contactEmail}</td>
                      <td>{org.emailDomain ?? "-"}</td>
                      <td>
                        <code>{org.joinCode}</code>
                      </td>
                      <td>{segmentsActive}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {isPersonalMode ? (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <h3 style={{ marginBottom: 10 }}>Personal Users ({personalUsers.length})</h3>
            <button onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Verified</th>
                <th>Created</th>
                <th>User Id</th>
              </tr>
            </thead>
            <tbody>
              {personalUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="small">
                    No individual users yet.
                  </td>
                </tr>
              ) : (
                personalUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.tier}</td>
                    <td>{user.status}</td>
                    <td>{user.emailVerifiedAt ? "Yes" : "No"}</td>
                    <td>{formatDateTime(user.createdAt)}</td>
                    <td>
                      <span className="small">{user.id}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {isPersonalMode ? null : (
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Org Access Requests ({joinRequests.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Email</th>
                <th>Org</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Decision</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {joinRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="small">
                    No org access requests yet.
                  </td>
                </tr>
              ) : (
                joinRequests.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>{formatDateTime(row.createdAt)}</div>
                      <div className="small">{row.id}</div>
                    </td>
                    <td>
                      <div>{row.email}</div>
                      <div className="small">{row.emailDomain}</div>
                    </td>
                    <td>
                      <div>{row.org?.name ?? row.org?.id ?? "-"}</div>
                      <div className="small">{row.org?.joinCode ?? "-"}</div>
                    </td>
                    <td>{row.status}</td>
                    <td>{formatDateTime(row.expiresAt)}</td>
                    <td>
                      <div>{formatDateTime(row.decidedAt)}</div>
                      <div className="small">{row.decisionReason ?? "-"}</div>
                    </td>
                    <td>
                      {row.status === "pending" ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            className="primary"
                            disabled={actingJoinRequestId === row.id}
                            onClick={() => void decideJoinRequest(row, "approve")}
                          >
                            Approve
                          </button>
                          <button
                            className="primary"
                            disabled={actingJoinRequestId === row.id}
                            onClick={() => void decideJoinRequest(row, "approve", { assignOrgAdmin: true })}
                          >
                            Approve as Org Admin
                          </button>
                          <button
                            className="danger"
                            disabled={actingJoinRequestId === row.id}
                            onClick={() => void decideJoinRequest(row, "reject")}
                          >
                            Reject
                          </button>
                        </div>
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
      )}
    </AdminShell>
  );
}
