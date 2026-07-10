"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  CreateSuperUserRequest,
  SuperUserListResponse,
  SuperUserSummary,
} from "@voicepractice/shared";

import { AdminShell } from "../../src/components/AdminShell";
import { AdminEnvironmentStatus } from "../../src/components/AdminEnvironmentStatus";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function toReadableErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  return error.message.replace(/^Request failed \(\d+(?: [^)]+)?\): /, "") || fallback;
}

export default function SettingsPage() {
  useRequireAdminToken();

  const [rows, setRows] = useState<SuperUserSummary[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async (options?: { preserveSuccess?: boolean }) => {
    setLoading(true);
    setError(null);
    if (!options?.preserveSuccess) {
      setSuccess(null);
    }

    try {
      const payload = await adminFetch<SuperUserListResponse>("/admin/settings/superusers");
      setRows(payload.rows);
      setGeneratedAt(payload.generatedAt);
    } catch (error) {
      setError(toReadableErrorMessage(error, "Could not load settings."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addSuperUser = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const email = emailInput.trim().toLowerCase();
      if (!email) {
        throw new Error("Email is required.");
      }

      const payload: CreateSuperUserRequest = { email };
      const created = await adminFetch<SuperUserSummary>("/admin/settings/superusers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setRows((previous) => [...previous, created].sort((left, right) => left.email.localeCompare(right.email)));
      setEmailInput("");
      setSuccess(`Added super user ${created.email}.`);
      setGeneratedAt(new Date().toISOString());
    } catch (error) {
      setError(toReadableErrorMessage(error, "Could not add super user."));
    } finally {
      setSaving(false);
    }
  };

  const removeSuperUser = async (row: SuperUserSummary) => {
    const confirmed = window.confirm(
      `Remove super user access for ${row.email}? This will immediately revoke app and dashboard access.`,
    );
    if (!confirmed) {
      return;
    }

    setRemovingUserId(row.userId);
    setError(null);
    setSuccess(null);

    try {
      await adminFetch<{ deleted: boolean; userId: string; email: string }>(`/admin/settings/superusers/${row.userId}`, {
        method: "DELETE",
      });
      setRows((previous) => previous.filter((entry) => entry.userId !== row.userId));
      setSuccess(`Removed super user ${row.email}.`);
      setGeneratedAt(new Date().toISOString());
    } catch (error) {
      setError(toReadableErrorMessage(error, "Could not remove super user."));
    } finally {
      setRemovingUserId(null);
    }
  };

  return (
    <AdminShell title="Settings">
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Environment</h3>
            <p className="small">Admin deployment target and API identity.</p>
          </div>
        </div>
        <AdminEnvironmentStatus />
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Super Users</h3>
            <p className="small">
              Super users sign in with the normal email verification flow, can inspect all customer accounts, and do
              not rely on customer-org dashboard access flags.
            </p>
          </div>
          <div className="card-actions">
            <button type="button" onClick={() => void load({ preserveSuccess: true })} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <form className="grid" onSubmit={addSuperUser}>
          <div>
            <label>Super User Email</label>
            <input
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="name@peritio.ai"
              autoCapitalize="none"
              autoComplete="off"
            />
          </div>
          <div className="form-actions">
            <div>
              <button className="primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Add Super User"}
              </button>
            </div>
          </div>
        </form>

        {generatedAt ? (
          <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
            Updated {formatDateTime(generatedAt)}.
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Current Super Users ({rows.length})</h3>
            <p className="small">These accounts are outside customer org structure and remain dashboard-eligible even if a customer org is deactivated.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Verified</th>
                <th>Status</th>
                <th>Created</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="small">
                    No super users configured yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.userId}>
                    <td>{row.email}</td>
                    <td>{row.emailVerifiedAt ? "Yes" : "No"}</td>
                    <td>{row.status}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{formatDateTime(row.updatedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="danger"
                        disabled={removingUserId === row.userId}
                        onClick={() => void removeSuperUser(row)}
                      >
                        {removingUserId === row.userId ? "Removing..." : "Remove"}
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
