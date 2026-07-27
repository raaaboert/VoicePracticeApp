"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  DashboardAdminAccessRequestRow,
  DashboardAdminAccessRequestsResponse,
  DashboardAdminUserRow,
  DashboardAdminUsersResponse,
  UserStatus,
} from "@voicepractice/shared";

import {
  assertAdminApiOk,
  fetchAdminApiJson,
  fetchAdminApiResponse,
  getDownloadFilenameFromContentDisposition,
} from "@/src/lib/adminApiClient";
import { formatDateTime } from "@/src/lib/formatters";

type AdminTab = "users" | "access";

function encodeOrgQuery(orgId: string | null): string {
  return orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function roleLabel(role: string): string {
  if (role === "org_admin") {
    return "Org Admin";
  }
  if (role === "user_admin") {
    return "User Admin";
  }
  return "User";
}

async function patchAdminUser(
  userId: string,
  body: { employeeId?: string | null; status?: UserStatus },
  orgId: string | null
): Promise<DashboardAdminUserRow> {
  const url = `/api/admin/users/${encodeURIComponent(userId)}${encodeOrgQuery(orgId)}`;
  const payload = await fetchAdminApiJson<{ user: DashboardAdminUserRow }>(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return payload.user;
}

async function decideAccessRequest(
  requestId: string,
  action: "approve" | "reject",
  orgId: string | null
): Promise<DashboardAdminAccessRequestRow> {
  const url = `/api/admin/access-requests/${encodeURIComponent(requestId)}${encodeOrgQuery(orgId)}`;
  const payload = await fetchAdminApiJson<{ request: DashboardAdminAccessRequestRow }>(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return payload.request;
}

export function AdminWorkspace({
  usersPayload,
  accessRequestsPayload,
  orgId,
}: {
  usersPayload: DashboardAdminUsersResponse;
  accessRequestsPayload: DashboardAdminAccessRequestsResponse;
  orgId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState(usersPayload.users);
  const [requests, setRequests] = useState(accessRequestsPayload.requests);
  const [search, setSearch] = useState("");
  const [editingEmployeeIds, setEditingEmployeeIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(usersPayload.users.map((user) => [user.userId, user.employeeId ?? ""]))
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [savingRequestId, setSavingRequestId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return users;
    }
    return users.filter((user) =>
      [user.displayName, user.email, user.employeeId ?? ""].some((value) => value.toLowerCase().includes(query))
    );
  }, [search, users]);

  const updateUserRow = (next: DashboardAdminUserRow) => {
    setUsers((current) => current.map((user) => (user.userId === next.userId ? next : user)));
    setEditingEmployeeIds((current) => ({ ...current, [next.userId]: next.employeeId ?? "" }));
  };

  const saveEmployeeId = async (user: DashboardAdminUserRow) => {
    setActionError(null);
    setActionMessage(null);
    setSavingUserId(user.userId);
    try {
      const next = await patchAdminUser(user.userId, { employeeId: editingEmployeeIds[user.userId] ?? "" }, orgId);
      updateUserRow(next);
      setActionMessage("Employee ID saved.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save Employee ID.");
    } finally {
      setSavingUserId(null);
    }
  };

  const changeStatus = async (user: DashboardAdminUserRow, status: UserStatus) => {
    const verb = status === "active" ? "reactivate" : "deactivate";
    if (status === "disabled" && !window.confirm(`Deactivate ${user.email}?`)) {
      return;
    }
    setActionError(null);
    setActionMessage(null);
    setSavingUserId(user.userId);
    try {
      const next = await patchAdminUser(user.userId, { status }, orgId);
      updateUserRow(next);
      setActionMessage(`${status === "active" ? "Reactivated" : "Deactivated"} ${user.email}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not ${verb} user.`);
    } finally {
      setSavingUserId(null);
    }
  };

  const exportUsers = async () => {
    setActionError(null);
    setActionMessage(null);
    setIsExporting(true);
    try {
      const endpointUrl = `/api/admin/users${encodeOrgQuery(orgId)}${orgId ? "&" : "?"}export=csv`;
      const response = await fetchAdminApiResponse(endpointUrl);
      await assertAdminApiOk(response, endpointUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = getDownloadFilenameFromContentDisposition(
        response.headers.get("Content-Disposition"),
        "organization-users.csv"
      );
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      setActionMessage("CSV export generated.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not export users.");
    } finally {
      setIsExporting(false);
    }
  };

  const decideRequest = async (request: DashboardAdminAccessRequestRow, action: "approve" | "reject") => {
    setActionError(null);
    setActionMessage(null);
    setSavingRequestId(request.id);
    try {
      const next = await decideAccessRequest(request.id, action, orgId);
      setRequests((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
      setActionMessage(`${action === "approve" ? "Approved" : "Rejected"} ${request.email}.`);
      startTransition(() => router.refresh());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not ${action} request.`);
    } finally {
      setSavingRequestId(null);
    }
  };

  return (
    <div className="page-stack admin-workspace">
      <div className="tab-row" role="tablist" aria-label="Admin sections">
        <button
          type="button"
          className={`tab-button${activeTab === "users" ? " active" : ""}`}
          onClick={() => setActiveTab("users")}
        >
          Users
        </button>
        <button
          type="button"
          className={`tab-button${activeTab === "access" ? " active" : ""}`}
          onClick={() => setActiveTab("access")}
        >
          Access Requests
        </button>
      </div>

      {actionMessage ? <div className="notice success">{actionMessage}</div> : null}
      {actionError ? <div className="notice danger">{actionError}</div> : null}

      {activeTab === "users" ? (
        <section className="section-card admin-section">
          <div className="section-header">
            <div>
              <p className="eyebrow">Users</p>
              <h2>Organization users</h2>
            </div>
            <div className="page-actions">
              <button type="button" className="ghost-button" onClick={exportUsers} disabled={isExporting}>
                {isExporting ? "Exporting..." : "Export CSV"}
              </button>
            </div>
          </div>

          <input
            className="text-input admin-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, or Employee ID"
          />

          <div className="table-wrap">
            <table className="data-table admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Employee ID</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.userId}>
                    <td>{user.displayName}</td>
                    <td>{user.email}</td>
                    <td>
                      <div className="admin-inline-edit">
                        <input
                          className="text-input compact-input"
                          value={editingEmployeeIds[user.userId] ?? ""}
                          disabled={!user.canEditEmployeeId || savingUserId === user.userId}
                          onChange={(event) =>
                            setEditingEmployeeIds((current) => ({ ...current, [user.userId]: event.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="ghost-button compact-button"
                          disabled={!user.canEditEmployeeId || savingUserId === user.userId}
                          onClick={() => {
                            void saveEmployeeId(user);
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </td>
                    <td>{roleLabel(user.orgRole)}</td>
                    <td>
                      <span className={`pill ${user.status === "active" ? "accent" : "muted"}`}>
                        {statusLabel(user.status)}
                      </span>
                    </td>
                    <td>
                      <div className="pill-row">
                        {user.canDeactivate ? (
                          <button
                            type="button"
                            className="ghost-button compact-button danger-button"
                            disabled={savingUserId === user.userId}
                            onClick={() => {
                              void changeStatus(user, "disabled");
                            }}
                          >
                            Deactivate
                          </button>
                        ) : null}
                        {user.canReactivate ? (
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            disabled={savingUserId === user.userId}
                            onClick={() => {
                              void changeStatus(user, "active");
                            }}
                          >
                            Reactivate
                          </button>
                        ) : null}
                        {!user.canDeactivate && !user.canReactivate ? <span className="table-subcopy">-</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="section-card admin-section">
          <div className="section-header">
            <div>
              <p className="eyebrow">Access</p>
              <h2>Membership requests</h2>
            </div>
            <button
              type="button"
              className="ghost-button"
              disabled={isPending}
              onClick={() => {
                startTransition(() => router.refresh());
              }}
            >
              Refresh
            </button>
          </div>

          <div className="table-wrap">
            <table className="data-table admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Organization</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.displayName}</td>
                    <td>{request.email}</td>
                    <td>{formatDateTime(request.createdAt)}</td>
                    <td>
                      <span className={`pill ${request.status === "pending" ? "accent" : "muted"}`}>
                        {statusLabel(request.status)}
                      </span>
                    </td>
                    <td>{request.orgName}</td>
                    <td>
                      {request.status === "pending" ? (
                        <div className="pill-row">
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            disabled={savingRequestId === request.id}
                            onClick={() => {
                              void decideRequest(request, "approve");
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="ghost-button compact-button danger-button"
                            disabled={savingRequestId === request.id}
                            onClick={() => {
                              void decideRequest(request, "reject");
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="table-subcopy">{request.decidedAt ? formatDateTime(request.decidedAt) : "-"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
