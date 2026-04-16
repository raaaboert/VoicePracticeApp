"use client";

import { useEffect, useMemo, useState } from "react";
import {
  OrgDivisionRecord,
  OrgStandardScenarioDivisionListResponse,
  OrgStandardScenarioDivisionRow,
  SetOrgStandardScenarioDivisionRequest,
} from "@voicepractice/shared";

import { adminFetch } from "../lib/api";

interface EnterpriseStandardScenarioDivisionCardProps {
  orgId: string;
  divisionsEnabled: boolean;
  divisions: OrgDivisionRecord[];
}

function sortRows(rows: OrgStandardScenarioDivisionRow[]): OrgStandardScenarioDivisionRow[] {
  return [...rows].sort((left, right) => {
    if (left.segmentLabel !== right.segmentLabel) {
      return left.segmentLabel.localeCompare(right.segmentLabel, undefined, { sensitivity: "base" });
    }
    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  });
}

export function EnterpriseStandardScenarioDivisionCard({
  orgId,
  divisionsEnabled,
  divisions,
}: EnterpriseStandardScenarioDivisionCardProps) {
  const [rows, setRows] = useState<OrgStandardScenarioDivisionRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingScenarioId, setSavingScenarioId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeDivisions = useMemo(() => divisions.filter((division) => division.active), [divisions]);

  const load = async (options?: { preserveNotice?: boolean }) => {
    if (!orgId) {
      return;
    }

    setLoading(true);
    setError(null);
    if (!options?.preserveNotice) {
      setNotice(null);
    }
    try {
      const payload = await adminFetch<OrgStandardScenarioDivisionListResponse>(
        `/orgs/${orgId}/standard-scenarios/divisions`
      );
      setRows(sortRows(payload.rows ?? []));
      setGeneratedAt(payload.generatedAt ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load standard scenario routing.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const updateScenarioDivision = async (scenarioId: string, divisionId: string | null) => {
    setSavingScenarioId(scenarioId);
    setError(null);
    setNotice(null);
    try {
      const updated = await adminFetch<{ scenarioId: string; divisionId: string | null }>(
        `/orgs/${orgId}/standard-scenarios/${scenarioId}/division`,
        {
          method: "PUT",
          body: JSON.stringify({ divisionId } satisfies SetOrgStandardScenarioDivisionRequest),
        }
      );
      setRows((prev) =>
        sortRows(
          prev.map((row) =>
            row.scenarioId === updated.scenarioId ? { ...row, divisionId: updated.divisionId } : row
          )
        )
      );
      setNotice("Standard scenario routing saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save standard scenario routing.");
    } finally {
      setSavingScenarioId(null);
    }
  };

  return (
    <div className="card enterprise-section-card">
      <div className="card-header">
        <div>
          <h3 style={{ marginBottom: 6 }}>Standard Scenario Division Routing</h3>
          <p className="small" style={{ marginTop: 0 }}>
            This is an org-scoped overlay. It does not modify the global standard scenario catalog.
          </p>
        </div>
        <div className="card-actions">
          <button type="button" onClick={() => void load({ preserveNotice: true })} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      <p className="small enterprise-note" style={{ marginTop: 0 }}>
        {divisionsEnabled
          ? "Division assignments are live for matching users. Unassigned standard scenarios remain generally visible."
          : "Divisions are currently disabled for this company. Assignments are retained, but live routing falls back to general behavior."}
        {generatedAt ? ` Refreshed ${new Date(generatedAt).toLocaleString()}.` : ""}
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Scenario</th>
              <th>Status</th>
              <th>Division</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="small">
                  {loading ? "Loading..." : "No standard scenarios are available for division routing."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.scenarioId}>
                  <td>{row.segmentLabel}</td>
                  <td>
                    <div>{row.title}</div>
                    <div className="small">{row.scenarioId}</div>
                  </td>
                  <td>{row.enabled ? "Enabled" : "Disabled"}</td>
                  <td>
                    <select
                      value={row.divisionId ?? ""}
                      disabled={savingScenarioId === row.scenarioId}
                      onChange={(event) =>
                        void updateScenarioDivision(row.scenarioId, event.target.value || null)
                      }
                    >
                      <option value="">General / Unassigned</option>
                      {activeDivisions.map((division) => (
                        <option key={division.id} value={division.id}>
                          {division.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
