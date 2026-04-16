"use client";

import { useMemo, useState } from "react";
import {
  CreateOrgDivisionRequest,
  OrgDivisionListResponse,
  OrgDivisionRecord,
  UpdateOrgDivisionRequest,
  UpdateOrgDivisionSettingsRequest,
} from "@voicepractice/shared";

import { adminFetch } from "../lib/api";

interface EnterpriseCompanyDivisionsCardProps {
  orgId: string;
  orgName?: string;
  divisionsEnabled: boolean;
  divisions: OrgDivisionRecord[];
  onChanged?: () => void | Promise<void>;
}

function sortDivisions(rows: OrgDivisionRecord[]): OrgDivisionRecord[] {
  return [...rows].sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function EnterpriseCompanyDivisionsCard({
  orgId,
  orgName,
  divisionsEnabled,
  divisions,
  onChanged,
}: EnterpriseCompanyDivisionsCardProps) {
  const [createName, setCreateName] = useState("");
  const [renameById, setRenameById] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sortedDivisions = useMemo(() => sortDivisions(divisions), [divisions]);
  const activeDivisions = sortedDivisions.filter((entry) => entry.active);
  const deletedDivisions = sortedDivisions.filter((entry) => !entry.active);

  const runChanged = async () => {
    if (onChanged) {
      await onChanged();
    }
  };

  const updateSettings = async (nextEnabled: boolean) => {
    setSavingKey("settings");
    setError(null);
    setNotice(null);
    try {
      await adminFetch<OrgDivisionListResponse>(`/orgs/${orgId}/divisions/settings`, {
        method: "PATCH",
        body: JSON.stringify({ divisionsEnabled: nextEnabled } satisfies UpdateOrgDivisionSettingsRequest),
      });
      setNotice(nextEnabled ? "Divisions enabled." : "Divisions disabled. Live routing now falls back to general company behavior.");
      await runChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update division settings.");
    } finally {
      setSavingKey(null);
    }
  };

  const createDivision = async () => {
    const name = createName.trim();
    if (!name) {
      setError("Division name is required.");
      return;
    }

    setSavingKey("create");
    setError(null);
    setNotice(null);
    try {
      await adminFetch<OrgDivisionListResponse>(`/orgs/${orgId}/divisions`, {
        method: "POST",
        body: JSON.stringify({ name } satisfies CreateOrgDivisionRequest),
      });
      setCreateName("");
      setNotice(`Created division "${name}".`);
      await runChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create division.");
    } finally {
      setSavingKey(null);
    }
  };

  const renameDivision = async (division: OrgDivisionRecord) => {
    const nextName = (renameById[division.id] ?? division.name).trim();
    if (!nextName) {
      setError("Division name is required.");
      return;
    }

    setSavingKey(`rename:${division.id}`);
    setError(null);
    setNotice(null);
    try {
      await adminFetch<OrgDivisionListResponse>(`/orgs/${orgId}/divisions/${division.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName } satisfies UpdateOrgDivisionRequest),
      });
      setNotice(`Saved division "${nextName}".`);
      await runChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rename division.");
    } finally {
      setSavingKey(null);
    }
  };

  const deleteDivision = async (division: OrgDivisionRecord) => {
    const confirmed = window.confirm(
      `Delete division "${division.name}" from ${orgName ?? "this company"}?\n\n` +
        "Live user, training, and standard-scenario assignments for this division will be cleared. Historical attribution stays intact."
    );
    if (!confirmed) {
      return;
    }

    setSavingKey(`delete:${division.id}`);
    setError(null);
    setNotice(null);
    try {
      await adminFetch<OrgDivisionListResponse>(`/orgs/${orgId}/divisions/${division.id}`, {
        method: "DELETE",
      });
      setNotice(`Deleted division "${division.name}".`);
      await runChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete division.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 style={{ marginBottom: 6 }}>Company Divisions</h3>
          <p className="small" style={{ marginTop: 0 }}>
            Divisions are an optional routing layer. Company-wide behavior and totals remain unchanged.
          </p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className={divisionsEnabled ? "primary" : undefined}
            disabled={savingKey === "settings"}
            onClick={() => void updateSettings(true)}
          >
            {savingKey === "settings" && divisionsEnabled ? "Saving..." : "Enable"}
          </button>
          <button
            type="button"
            className={!divisionsEnabled ? "primary" : undefined}
            disabled={savingKey === "settings"}
            onClick={() => void updateSettings(false)}
          >
            {savingKey === "settings" && !divisionsEnabled ? "Saving..." : "Disable"}
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      <div className="enterprise-summary-grid" style={{ marginBottom: 16 }}>
        <div className="enterprise-summary-pill">
          <span className="small">Routing Status</span>
          <strong>{divisionsEnabled ? "Enabled" : "Disabled"}</strong>
        </div>
        <div className="enterprise-summary-pill">
          <span className="small">Active Divisions</span>
          <strong>{activeDivisions.length}</strong>
        </div>
        <div className="enterprise-summary-pill">
          <span className="small">Historical / Deleted</span>
          <strong>{deletedDivisions.length}</strong>
        </div>
      </div>

      <div className="enterprise-actions-inline" style={{ alignItems: "end", marginBottom: 16 }}>
        <div style={{ minWidth: 260, flex: "1 1 260px" }}>
          <label>New Division</label>
          <input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Enter division name"
          />
        </div>
        <button type="button" className="primary" disabled={savingKey === "create"} onClick={() => void createDivision()}>
          {savingKey === "create" ? "Creating..." : "Create Division"}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Division</th>
              <th>Status</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activeDivisions.length === 0 ? (
              <tr>
                <td colSpan={4} className="small">
                  No active divisions yet.
                </td>
              </tr>
            ) : (
              activeDivisions.map((division) => (
                <tr key={division.id}>
                  <td>
                    <input
                      value={renameById[division.id] ?? division.name}
                      onChange={(event) =>
                        setRenameById((prev) => ({
                          ...prev,
                          [division.id]: event.target.value,
                        }))
                      }
                    />
                    <div className="small">{division.id}</div>
                  </td>
                  <td>{division.active ? "Active" : "Deleted"}</td>
                  <td>{new Date(division.updatedAt).toLocaleString()}</td>
                  <td>
                    <div className="enterprise-actions-inline">
                      <button
                        type="button"
                        disabled={savingKey === `rename:${division.id}` || savingKey === `delete:${division.id}`}
                        onClick={() => void renameDivision(division)}
                      >
                        {savingKey === `rename:${division.id}` ? "Saving..." : "Save Name"}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={savingKey === `rename:${division.id}` || savingKey === `delete:${division.id}`}
                        onClick={() => void deleteDivision(division)}
                      >
                        {savingKey === `delete:${division.id}` ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {deletedDivisions.length > 0 ? (
        <details style={{ marginTop: 16 }}>
          <summary>Historical / Deleted Divisions</summary>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Division</th>
                  <th>Deleted</th>
                </tr>
              </thead>
              <tbody>
                {deletedDivisions.map((division) => (
                  <tr key={division.id}>
                    <td>
                      <div>{division.name}</div>
                      <div className="small">{division.id}</div>
                    </td>
                    <td>{division.deletedAt ? new Date(division.deletedAt).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}
