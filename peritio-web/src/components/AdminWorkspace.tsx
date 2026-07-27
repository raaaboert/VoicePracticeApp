"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  DashboardAdminAccessRequestRow,
  DashboardAdminAccessRequestsResponse,
  DashboardAdminUpdateUserRequest,
  DashboardAdminUserRow,
  DashboardAdminUsersResponse,
  OrgUserRole,
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

interface UserDraft {
  firstName: string;
  lastName: string;
  employeeId: string;
  orgRole: OrgUserRole;
  managerUserId: string;
}

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

function nameLabel(value: string | null | undefined): string {
  return value?.trim() || "Not provided";
}

function managerLabel(user: DashboardAdminUserRow): string {
  if (!user.managerUserId) {
    return "Unassigned";
  }
  return user.managerDisplayName ?? "Not provided";
}

function createDraft(user: DashboardAdminUserRow): UserDraft {
  return {
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    employeeId: user.employeeId ?? "",
    orgRole: user.orgRole,
    managerUserId: user.managerUserId ?? "",
  };
}

function createDrafts(users: DashboardAdminUserRow[]): Record<string, UserDraft> {
  return Object.fromEntries(users.map((user) => [user.userId, createDraft(user)]));
}

async function patchAdminUser(
  userId: string,
  body: DashboardAdminUpdateUserRequest,
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
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>(() => createDrafts(usersPayload.users));
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [savingRequestId, setSavingRequestId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const canManageAccessRequests = usersPayload.viewer.capabilities.approveRejectAccessRequests;
  const managerOptions = usersPayload.managerOptions ?? [];

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return users;
    }
    return users.filter((user) =>
      [
        user.displayName,
        user.firstName ?? "",
        user.lastName ?? "",
        user.email,
        user.employeeId ?? "",
        user.managerDisplayName ?? "",
        user.managerEmail ?? "",
      ].some((value) => value.toLowerCase().includes(query))
    );
  }, [search, users]);

  const updateUserRow = (next: DashboardAdminUserRow) => {
    setUsers((current) => current.map((user) => (user.userId === next.userId ? next : user)));
    setDrafts((current) => ({ ...current, [next.userId]: createDraft(next) }));
  };

  const updateDraft = (userId: string, patch: Partial<UserDraft>) => {
    setDrafts((current) => {
      const existing = current[userId];
      const user = users.find((entry) => entry.userId === userId);
      if (!existing && !user) {
        return current;
      }
      return {
        ...current,
        [userId]: {
          ...(existing ?? createDraft(user!)),
          ...patch,
        },
      };
    });
  };

  const saveUser = async (user: DashboardAdminUserRow) => {
    const draft = drafts[user.userId] ?? createDraft(user);
    const body: DashboardAdminUpdateUserRequest = {};
    if (user.canEditNames && draft.firstName !== (user.firstName ?? "")) {
      body.firstName = draft.firstName;
    }
    if (user.canEditNames && draft.lastName !== (user.lastName ?? "")) {
      body.lastName = draft.lastName;
    }
    if (user.canEditEmployeeId && draft.employeeId !== (user.employeeId ?? "")) {
      body.employeeId = draft.employeeId;
    }
    if (user.canChangeRole && draft.orgRole !== user.orgRole) {
      body.orgRole = draft.orgRole;
    }
    if (user.canAssignManager && draft.orgRole === "user" && (draft.managerUserId || null) !== (user.managerUserId ?? null)) {
      body.managerUserId = draft.managerUserId || null;
    }

    if (Object.keys(body).length === 0) {
      setActionError(null);
      setActionMessage("No changes to save.");
      setEditingUserId(null);
      return;
    }

    if (
      user.orgRole === "user_admin" &&
      body.orgRole === "user" &&
      !window.confirm(
        `Demote ${user.email} to User? Dashboard access will be removed, sessions revoked, and ${user.assignedReportCount} direct report assignment${user.assignedReportCount === 1 ? "" : "s"} cleared.`
      )
    ) {
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setSavingUserId(user.userId);
    try {
      const next = await patchAdminUser(user.userId, body, orgId);
      updateUserRow(next);
      setEditingUserId(null);
      setActionMessage("User saved.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save user.");
    } finally {
      setSavingUserId(null);
    }
  };

  const changeStatus = async (user: DashboardAdminUserRow, status: UserStatus) => {
    const verb = status === "active" ? "reactivate" : "deactivate";
    const warning =
      status === "disabled" && user.orgRole === "user_admin"
        ? `Deactivate ${user.email}? Their dashboard sessions will be revoked and ${user.assignedReportCount} direct report assignment${user.assignedReportCount === 1 ? "" : "s"} cleared.`
        : `Deactivate ${user.email}?`;
    if (status === "disabled" && !window.confirm(warning)) {
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
        {canManageAccessRequests ? (
          <button
            type="button"
            className={`tab-button${activeTab === "access" ? " active" : ""}`}
            onClick={() => setActiveTab("access")}
          >
            Access Requests
          </button>
        ) : null}
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
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Email</th>
                  <th>Employee ID</th>
                  <th>Role</th>
                  <th>Manager</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const isEditing = editingUserId === user.userId;
                  const draft = drafts[user.userId] ?? createDraft(user);
                  const canEditUser =
                    user.canEditNames ||
                    user.canEditEmployeeId ||
                    user.canChangeRole ||
                    (user.canAssignManager && user.orgRole === "user");

                  return (
                    <tr key={user.userId}>
                      <td>
                        {isEditing && user.canEditNames ? (
                          <input
                            className="text-input compact-input"
                            value={draft.firstName}
                            disabled={savingUserId === user.userId}
                            onChange={(event) => updateDraft(user.userId, { firstName: event.target.value })}
                          />
                        ) : (
                          nameLabel(user.firstName)
                        )}
                      </td>
                      <td>
                        {isEditing && user.canEditNames ? (
                          <input
                            className="text-input compact-input"
                            value={draft.lastName}
                            disabled={savingUserId === user.userId}
                            onChange={(event) => updateDraft(user.userId, { lastName: event.target.value })}
                          />
                        ) : (
                          nameLabel(user.lastName)
                        )}
                      </td>
                      <td>{user.email}</td>
                      <td>
                        {isEditing && user.canEditEmployeeId ? (
                          <input
                            className="text-input compact-input"
                            value={draft.employeeId}
                            disabled={savingUserId === user.userId}
                            onChange={(event) => updateDraft(user.userId, { employeeId: event.target.value })}
                          />
                        ) : (
                          user.employeeId ?? "-"
                        )}
                      </td>
                      <td>
                        {isEditing && user.canChangeRole ? (
                          <select
                            className="text-input compact-input"
                            value={draft.orgRole}
                            disabled={savingUserId === user.userId}
                            onChange={(event) =>
                              updateDraft(user.userId, {
                                orgRole: event.target.value as OrgUserRole,
                                managerUserId: event.target.value === "user" ? draft.managerUserId : "",
                              })
                            }
                          >
                            <option value="user">User</option>
                            <option value="user_admin">User Admin</option>
                          </select>
                        ) : (
                          roleLabel(user.orgRole)
                        )}
                      </td>
                      <td>
                        {isEditing && user.canAssignManager && draft.orgRole === "user" ? (
                          <select
                            className="text-input compact-input"
                            value={draft.managerUserId}
                            disabled={savingUserId === user.userId}
                            onChange={(event) => updateDraft(user.userId, { managerUserId: event.target.value })}
                          >
                            <option value="">Unassigned</option>
                            {managerOptions.map((manager) => (
                              <option key={manager.userId} value={manager.userId}>
                                {manager.email ? `${manager.displayName} (${manager.email})` : manager.displayName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          managerLabel(user)
                        )}
                      </td>
                      <td>
                        <span className={`pill ${user.status === "active" ? "accent" : "muted"}`}>
                          {statusLabel(user.status)}
                        </span>
                      </td>
                      <td>
                        <div className="pill-row">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="ghost-button compact-button"
                                disabled={savingUserId === user.userId}
                                onClick={() => {
                                  void saveUser(user);
                                }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="ghost-button compact-button"
                                disabled={savingUserId === user.userId}
                                onClick={() => {
                                  setDrafts((current) => ({ ...current, [user.userId]: createDraft(user) }));
                                  setEditingUserId(null);
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : canEditUser ? (
                            <button
                              type="button"
                              className="ghost-button compact-button"
                              disabled={savingUserId === user.userId}
                              onClick={() => setEditingUserId(user.userId)}
                            >
                              Edit
                            </button>
                          ) : null}
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
                          {!canEditUser && !user.canDeactivate && !user.canReactivate ? (
                            <span className="table-subcopy">-</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : canManageAccessRequests ? (
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
      ) : null}
    </div>
  );
}
