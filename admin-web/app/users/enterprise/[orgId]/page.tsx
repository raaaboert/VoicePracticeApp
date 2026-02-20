"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AppConfig,
  ORG_USER_ROLE_LABELS,
  ORG_USER_ROLES,
  OrgUserRole,
  EnterpriseOrg,
  UserProfile,
  UserStatus,
  formatSecondsAsClock,
} from "@voicepractice/shared";
import { AdminShell } from "../../../../src/components/AdminShell";
import { useRequireAdminToken } from "../../../../src/components/useRequireAdminToken";
import { adminFetch } from "../../../../src/lib/api";
import { withAdminMode } from "../../../../src/lib/adminMode";

interface OrgDashboardUserRow {
  userId: string;
  email: string;
  status: UserStatus;
  orgRole: OrgUserRole;
  rawSecondsThisPeriod: number;
  billedSecondsThisPeriod: number;
}

interface OrgDashboardResponse {
  generatedAt: string;
  org: EnterpriseOrg;
  billingPeriod: {
    periodStartAt: string;
    periodEndAt: string;
    nextRenewalAt: string;
  };
  users: OrgDashboardUserRow[];
}

interface OrgJoinRequestRow {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
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
    orgRole: string | null;
  } | null;
  org: {
    id: string;
    name: string;
    emailDomain: string | null;
    joinCode: string;
    status: string;
  } | null;
}

interface OrgJoinRequestsResponse {
  generatedAt: string;
  rows: OrgJoinRequestRow[];
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EnterpriseOrgPage() {
  useRequireAdminToken();
  const mode = "enterprise";
  const params = useParams();
  const orgId = useMemo(() => {
    const raw = params?.orgId;
    return Array.isArray(raw) ? raw[0] : (raw as string | undefined) ?? "";
  }, [params]);

  const [dashboard, setDashboard] = useState<OrgDashboardResponse | null>(null);
  const [industries, setIndustries] = useState<AppConfig["industries"]>([]);
  const [selectedIndustryId, setSelectedIndustryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingIndustries, setSavingIndustries] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [savingOrgIdentity, setSavingOrgIdentity] = useState(false);
  const [orgDomainInput, setOrgDomainInput] = useState("");
  const [orgJoinCodeInput, setOrgJoinCodeInput] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [joinRequests, setJoinRequests] = useState<OrgJoinRequestRow[]>([]);
  const [joinRequestsGeneratedAt, setJoinRequestsGeneratedAt] = useState<string | null>(null);
  const [actingJoinRequestId, setActingJoinRequestId] = useState<string | null>(null);

  const load = async () => {
    if (!orgId) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const [payload, configPayload, joinRequestsPayload] = await Promise.all([
        adminFetch<OrgDashboardResponse>(`/orgs/${orgId}/dashboard`),
        adminFetch<AppConfig>("/config"),
        adminFetch<OrgJoinRequestsResponse>("/org-join-requests?status=pending"),
      ]);
      setDashboard(payload);
      setIndustries(configPayload.industries ?? []);
      setOrgDomainInput(payload.org.emailDomain ?? "");
      setOrgJoinCodeInput(payload.org.joinCode ?? "");
      setJoinRequestsGeneratedAt(joinRequestsPayload.generatedAt);
      setJoinRequests(
        (joinRequestsPayload.rows ?? []).filter((row) => row.status === "pending" && row.org?.id === payload.org.id),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load enterprise account.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const activeIndustries = dashboard?.org.activeIndustries ?? [];
  const selectedIndustryActive = activeIndustries.includes(selectedIndustryId);
  const industryLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const industry of industries) {
      map.set(industry.id, industry.label);
    }
    return map;
  }, [industries]);

  const segmentsActiveLabel =
    activeIndustries.length > 0
      ? activeIndustries.map((id) => industryLabelById.get(id) ?? id).join(", ")
      : "-";

  useEffect(() => {
    if (industries.length === 0) {
      setSelectedIndustryId("");
      return;
    }

    if (!industries.some((entry) => entry.id === selectedIndustryId)) {
      setSelectedIndustryId(industries[0].id);
    }
  }, [industries, selectedIndustryId]);

  const setIndustryActive = async (nextActive: boolean) => {
    if (!dashboard) {
      return;
    }
    if (!selectedIndustryId) {
      setError("Select an industry first.");
      return;
    }

    const org = dashboard.org;
    const current = Array.isArray(org.activeIndustries) ? org.activeIndustries : [];
    const isActive = current.includes(selectedIndustryId);
    if (nextActive === isActive) {
      return;
    }

    const nextIndustries = nextActive
      ? Array.from(new Set([...current, selectedIndustryId]))
      : current.filter((id) => id !== selectedIndustryId);

    if (nextIndustries.length === 0) {
      setError("At least one industry must remain active.");
      return;
    }

    setSavingIndustries(true);
    setError(null);
    try {
      const updatedOrg = await adminFetch<EnterpriseOrg>(`/orgs/${org.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activeIndustries: nextIndustries }),
      });

      setDashboard((prev) => (prev ? { ...prev, org: updatedOrg } : prev));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update segments.");
    } finally {
      setSavingIndustries(false);
    }
  };

  const patchEnterpriseUser = async (
    userId: string,
    patch: Partial<Pick<UserProfile, "orgRole" | "status">>,
  ) => {
    setSavingUserId(userId);
    setError(null);
    setSuccessMessage(null);

    try {
      const updated = await adminFetch<UserProfile>(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });

      setDashboard((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          users: prev.users.map((row) =>
            row.userId === userId
              ? {
                  ...row,
                  status: updated.status,
                  orgRole: updated.orgRole,
                }
              : row,
          ),
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update user.");
    } finally {
      setSavingUserId(null);
    }
  };

  const saveOrgIdentity = async () => {
    if (!dashboard) {
      return;
    }

    setSavingOrgIdentity(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await adminFetch<EnterpriseOrg>(`/orgs/${dashboard.org.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          emailDomain: orgDomainInput,
          joinCode: orgJoinCodeInput,
        }),
      });
      setDashboard((prev) => (prev ? { ...prev, org: updated } : prev));
      setOrgDomainInput(updated.emailDomain ?? "");
      setOrgJoinCodeInput(updated.joinCode ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update org identity.");
    } finally {
      setSavingOrgIdentity(false);
    }
  };

  const deleteEnterpriseUser = async (userId: string, email: string) => {
    const firstConfirm = window.confirm("Are you sure? This can not be reversed!");
    if (!firstConfirm) {
      return;
    }

    const typed = window.prompt("Please type DELETE and confirm", "");
    if (typed !== "DELETE") {
      setError("Deletion cancelled. Type DELETE exactly to confirm.");
      return;
    }

    setDeletingUserId(userId);
    setError(null);
    setSuccessMessage(null);
    try {
      await adminFetch<{ deleted: boolean; userId: string; email: string }>(`/users/${userId}`, {
        method: "DELETE",
      });
      setDashboard((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          users: prev.users.filter((row) => row.userId !== userId),
        };
      });
      setSuccessMessage(`Deleted ${email}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete user.");
    } finally {
      setDeletingUserId(null);
    }
  };

  const decideJoinRequest = async (
    requestId: string,
    action: "approve" | "reject",
    options?: { assignOrgAdmin?: boolean },
  ) => {
    const payload: {
      action: "approve" | "reject";
      assignOrgAdmin?: boolean;
      reason?: string;
    } = { action };

    if (action === "reject") {
      const reasonInput = window.prompt("Optional rejection reason (leave blank for default):", "");
      if (reasonInput === null) {
        return;
      }

      const normalizedReason = reasonInput.trim();
      if (normalizedReason) {
        payload.reason = normalizedReason;
      }
    }

    if (options?.assignOrgAdmin) {
      payload.assignOrgAdmin = true;
    }

    setActingJoinRequestId(requestId);
    setError(null);
    setSuccessMessage(null);
    try {
      await adminFetch<{ ok: boolean }>(`/org-join-requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setSuccessMessage(
        action === "approve"
          ? options?.assignOrgAdmin
            ? "Request approved as org admin."
            : "Request approved."
          : "Request rejected.",
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update request.");
    } finally {
      setActingJoinRequestId(null);
    }
  };

  return (
    <AdminShell title={dashboard?.org.name ? `Enterprise: ${dashboard.org.name}` : "Enterprise Account"}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>{dashboard?.org.name ?? (loading ? "Loading..." : "Enterprise Account")}</h3>
            <div className="small">{dashboard?.org.id ?? ""}</div>
          </div>
          <div className="card-actions">
            <Link className="button" href={withAdminMode("/users", mode)}>
              Back to Accounts
            </Link>
            <Link className="button" href={withAdminMode(`/users/enterprise/${orgId}/billing`, mode)}>
              Usage/Billing
            </Link>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {successMessage ? <p className="success">{successMessage}</p> : null}

        {dashboard ? (
          <>
            <div className="grid" style={{ marginTop: 10 }}>
              <div>
                <label>Date Established</label>
                <div>{formatDate(dashboard.org.createdAt)}</div>
              </div>
              <div>
                <label>Next Renewal Date</label>
                <div>{formatDate(dashboard.billingPeriod.nextRenewalAt)}</div>
              </div>
              <div>
                <label>Company Contact</label>
                <div>{dashboard.org.contactName}</div>
              </div>
              <div>
                <label>Contact Email</label>
                <div>{dashboard.org.contactEmail}</div>
              </div>
              <div>
                <label>Email Domain</label>
                <input value={orgDomainInput} onChange={(event) => setOrgDomainInput(event.target.value)} />
              </div>
              <div>
                <label>Join Code</label>
                <input value={orgJoinCodeInput} onChange={(event) => setOrgJoinCodeInput(event.target.value)} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label>Segments Active</label>
                <div>{segmentsActiveLabel}</div>
                <div className="small">
                  Billing period: {formatDate(dashboard.billingPeriod.periodStartAt)} to{" "}
                  {formatDate(dashboard.billingPeriod.periodEndAt)}
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button className="primary" disabled={savingOrgIdentity} onClick={() => void saveOrgIdentity()}>
                {savingOrgIdentity ? "Saving..." : "Save Domain / Join Code"}
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>Org Access Requests</h3>
            <div className="small">
              Pending requests for this account: {joinRequests.length}
              {joinRequestsGeneratedAt ? ` | Refreshed ${formatDateTime(joinRequestsGeneratedAt)}` : ""}
            </div>
          </div>
          <div className="card-actions">
            <button type="button" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email Domain</th>
                <th>Submitted</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {joinRequests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="small">
                    {loading ? "Loading..." : "No pending requests for this enterprise account."}
                  </td>
                </tr>
              ) : (
                joinRequests.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>{row.email}</div>
                      <div className="small">{row.user?.id ?? row.id}</div>
                    </td>
                    <td>{row.emailDomain}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{formatDateTime(row.expiresAt)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="primary"
                          disabled={actingJoinRequestId === row.id}
                          onClick={() => void decideJoinRequest(row.id, "approve")}
                        >
                          {actingJoinRequestId === row.id ? "Saving..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={actingJoinRequestId === row.id}
                          onClick={() => void decideJoinRequest(row.id, "approve", { assignOrgAdmin: true })}
                        >
                          Approve as Org Admin
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={actingJoinRequestId === row.id}
                          onClick={() => void decideJoinRequest(row.id, "reject")}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Segment Selection</h3>
        <p className="small" style={{ marginTop: 0 }}>
          Select an industry and toggle whether it is active for this company.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 260, flex: "1 1 260px" }}>
            <label>Industry</label>
            <select
              value={selectedIndustryId}
              onChange={(event) => setSelectedIndustryId(event.target.value)}
            >
              {industries.map((industry) => (
                <option key={industry.id} value={industry.id}>
                  {industry.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className={selectedIndustryActive ? "primary" : undefined}
              disabled={savingIndustries || !selectedIndustryId}
              onClick={() => void setIndustryActive(true)}
            >
              Active
            </button>
            <button
              type="button"
              className={!selectedIndustryActive ? "primary" : undefined}
              disabled={savingIndustries || !selectedIndustryId}
              onClick={() => void setIndustryActive(false)}
            >
              Inactive
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Users</h3>
        <p className="small" style={{ marginTop: 0 }}>
          Usage shown is billed time within the current monthly billing period.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Locked Out</th>
                <th>Usage This Billing Period</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard?.users ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="small">
                    {loading ? "Loading..." : "No users found for this enterprise account."}
                  </td>
                </tr>
              ) : (
                (dashboard?.users ?? []).map((user) => (
                  <tr key={user.userId}>
                    <td>
                      <div>{user.email}</div>
                      <div className="small">{user.userId}</div>
                    </td>
                    <td>
                      <select
                        value={user.orgRole}
                        disabled={savingUserId === user.userId || deletingUserId === user.userId}
                        onChange={(event) => {
                          void patchEnterpriseUser(user.userId, { orgRole: event.target.value as OrgUserRole });
                        }}
                      >
                        {ORG_USER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ORG_USER_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={user.status}
                        disabled={savingUserId === user.userId || deletingUserId === user.userId}
                        onChange={(event) => {
                          void patchEnterpriseUser(user.userId, { status: event.target.value as UserStatus });
                        }}
                      >
                        <option value="active">Active</option>
                        <option value="disabled">Locked</option>
                      </select>
                    </td>
                    <td>{formatSecondsAsClock(user.billedSecondsThisPeriod)}</td>
                    <td>
                      <button
                        type="button"
                        className="danger"
                        disabled={savingUserId === user.userId || deletingUserId === user.userId}
                        onClick={() => void deleteEnterpriseUser(user.userId, user.email)}
                      >
                        {deletingUserId === user.userId ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
