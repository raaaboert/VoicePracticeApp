"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";
import { useAdminMode } from "../../src/lib/adminMode";

interface SupportCaseSummary {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  org: { id: string; name: string } | null;
  user: { id: string; email: string };
  segmentLabel: string | null;
  scenarioTitle: string | null;
  message: string;
  transcript: { available: boolean; expiresAt: string | null; fileName: string | null };
  meta: Record<string, unknown> | null;
}

interface SupportCaseListResponse {
  generatedAt: string;
  cases: SupportCaseSummary[];
}

interface SupportCaseDetail {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  org: { id: string; name: string } | null;
  user: { id: string; email: string };
  message: string;
  transcript: { available: boolean; expiresAt: string | null; fileName: string | null; text: string | null };
  meta: Record<string, unknown> | null;
}

function isAutoErrorCase(message: string): boolean {
  return message.trim().toUpperCase().startsWith("[AUTO-ERROR]");
}

function parseDateAtStart(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(`${trimmed}T00:00:00.000`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.getTime();
}

function parseDateAtEnd(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(`${trimmed}T23:59:59.999`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.getTime();
}

function withinDateRange(value: string, fromDate: string, toDate: string): boolean {
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime())) {
    return false;
  }

  const fromMs = parseDateAtStart(fromDate);
  if (fromMs !== null && createdAt.getTime() < fromMs) {
    return false;
  }

  const toMs = parseDateAtEnd(toDate);
  if (toMs !== null && createdAt.getTime() > toMs) {
    return false;
  }

  return true;
}

function includesIgnoreCase(value: string | null | undefined, needle: string): boolean {
  const normalizedNeedle = needle.trim().toLowerCase();
  if (!normalizedNeedle) {
    return true;
  }
  return (value ?? "").toLowerCase().includes(normalizedNeedle);
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

export default function SupportPage() {
  useRequireAdminToken();
  const mode = useAdminMode();
  const isPersonalMode = mode === "personal";
  const initialFilters = useMemo(
    () => ({
      createdFrom: "",
      createdTo: "",
      type: "all" as "all" | "auto_error" | "user_feedback",
      status: "all",
      transcript: "all" as "all" | "available" | "none",
      org: "",
      user: "",
      scenario: "",
      message: "",
    }),
    [],
  );
  const [payload, setPayload] = useState<SupportCaseListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tableFilters, setTableFilters] = useState(initialFilters);
  const [exportFromDate, setExportFromDate] = useState("");
  const [exportToDate, setExportToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SupportCaseDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetch<SupportCaseListResponse>("/support/cases");
      setPayload(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load support cases.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setSelectedCaseId(null);
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setTableFilters(initialFilters);
    setExportFromDate("");
    setExportToDate("");
    setExportError(null);
    setExportNotice(null);
  }, [initialFilters, isPersonalMode]);

  const rowsByMode = useMemo(
    () =>
      (payload?.cases ?? []).filter((row) =>
        isPersonalMode ? row.org === null : row.org !== null
      ),
    [isPersonalMode, payload],
  );

  const statusOptions = useMemo(() => {
    return Array.from(new Set(rowsByMode.map((row) => row.status).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [rowsByMode]);

  const filteredRows = useMemo(() => {
    return rowsByMode.filter((row) => {
      if (!withinDateRange(row.createdAt, tableFilters.createdFrom, tableFilters.createdTo)) {
        return false;
      }

      const isAuto = isAutoErrorCase(row.message);
      if (tableFilters.type === "auto_error" && !isAuto) {
        return false;
      }
      if (tableFilters.type === "user_feedback" && isAuto) {
        return false;
      }

      if (tableFilters.status !== "all" && row.status !== tableFilters.status) {
        return false;
      }

      if (tableFilters.transcript === "available" && !row.transcript.available) {
        return false;
      }
      if (tableFilters.transcript === "none" && row.transcript.available) {
        return false;
      }

      if (!includesIgnoreCase(row.user.email, tableFilters.user) && !includesIgnoreCase(row.user.id, tableFilters.user)) {
        return false;
      }

      const scenarioCombined = [row.scenarioTitle ?? "", row.segmentLabel ?? ""].join(" ");
      if (!includesIgnoreCase(scenarioCombined, tableFilters.scenario)) {
        return false;
      }

      if (!includesIgnoreCase(row.message, tableFilters.message)) {
        return false;
      }

      if (!isPersonalMode && !includesIgnoreCase(row.org?.name, tableFilters.org) && !includesIgnoreCase(row.org?.id, tableFilters.org)) {
        return false;
      }

      return true;
    });
  }, [isPersonalMode, rowsByMode, tableFilters]);

  const downloadCsv = () => {
    setExporting(true);
    setExportError(null);
    setExportNotice(null);

    try {
      const fromMs = parseDateAtStart(exportFromDate);
      const toMs = parseDateAtEnd(exportToDate);

      if (fromMs !== null && toMs !== null && fromMs > toMs) {
        throw new Error("Export date range is invalid. 'From' must be on or before 'To'.");
      }

      const exportRows = rowsByMode.filter((row) => withinDateRange(row.createdAt, exportFromDate, exportToDate));

      const headers = [
        "Case ID",
        "Created At",
        "Updated At",
        "Type",
        "Status",
        "Org ID",
        "Org Name",
        "User ID",
        "User Email",
        "Segment",
        "Scenario",
        "Transcript Available",
        "Transcript Expires At",
        "Message",
        "Meta JSON",
      ];

      const csv = [headers, ...exportRows.map((row) => [
        row.id,
        row.createdAt,
        row.updatedAt,
        isAutoErrorCase(row.message) ? "Auto Error" : "User Feedback",
        row.status,
        row.org?.id ?? "",
        row.org?.name ?? "",
        row.user.id,
        row.user.email,
        row.segmentLabel ?? "",
        row.scenarioTitle ?? "",
        row.transcript.available ? "true" : "false",
        row.transcript.expiresAt ?? "",
        row.message,
        row.meta ? JSON.stringify(row.meta) : "",
      ])]
        .map((line) => line.map((cell) => csvCell(cell)).join(","))
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `voicepractice-support-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportNotice(`Downloaded ${exportRows.length} support logs.`);
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : "Could not export support logs.");
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setTableFilters(initialFilters);
  };

  const openCase = async (caseId: string) => {
    setSelectedCaseId(caseId);
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const detail = await adminFetch<SupportCaseDetail>(`/support/cases/${encodeURIComponent(caseId)}`);
      setSelectedDetail(detail);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Could not load support case.");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setSelectedCaseId(null);
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  return (
    <AdminShell title={isPersonalMode ? "Feedback / Error Support (Personal)" : "Feedback / Error Support (Enterprise)"}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <p className="small" style={{ marginTop: 0 }}>
              Generated: {payload?.generatedAt ? new Date(payload.generatedAt).toLocaleString() : "-"}
            </p>
            <p className="small" style={{ marginBottom: 0 }}>
              {isPersonalMode
                ? "Showing support cases submitted by individual users."
                : "Showing support cases submitted by enterprise users."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ minWidth: 140 }}>
              <label>Export From</label>
              <input
                type="date"
                value={exportFromDate}
                onChange={(event) => setExportFromDate(event.target.value)}
              />
            </div>
            <div style={{ minWidth: 140 }}>
              <label>Export To</label>
              <input
                type="date"
                value={exportToDate}
                onChange={(event) => setExportToDate(event.target.value)}
              />
            </div>
            <button type="button" onClick={downloadCsv} disabled={exporting}>
              {exporting ? "Exporting..." : "Download Logs CSV"}
            </button>
            <button className="primary" onClick={() => void refresh()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {exportError ? <p className="error">{exportError}</p> : null}
        {exportNotice ? <p className="success">{exportNotice}</p> : null}

        <div
          style={{
            marginBottom: 12,
            border: "1px solid rgba(129, 206, 166, 0.2)",
            borderRadius: 10,
            padding: 10,
            background: "rgba(5, 30, 18, 0.42)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>Table Filters</h4>
            <button type="button" onClick={clearFilters}>
              Clear Filters
            </button>
          </div>
          <div className="grid" style={{ marginTop: 10 }}>
            <div>
              <label>Created From</label>
              <input
                type="date"
                value={tableFilters.createdFrom}
                onChange={(event) =>
                  setTableFilters((previous) => ({ ...previous, createdFrom: event.target.value }))
                }
              />
            </div>
            <div>
              <label>Created To</label>
              <input
                type="date"
                value={tableFilters.createdTo}
                onChange={(event) =>
                  setTableFilters((previous) => ({ ...previous, createdTo: event.target.value }))
                }
              />
            </div>
            <div>
              <label>Type</label>
              <select
                value={tableFilters.type}
                onChange={(event) =>
                  setTableFilters((previous) => ({
                    ...previous,
                    type: event.target.value as "all" | "auto_error" | "user_feedback",
                  }))
                }
              >
                <option value="all">All</option>
                <option value="auto_error">Auto Error</option>
                <option value="user_feedback">User Feedback</option>
              </select>
            </div>
            <div>
              <label>Status</label>
              <select
                value={tableFilters.status}
                onChange={(event) => setTableFilters((previous) => ({ ...previous, status: event.target.value }))}
              >
                <option value="all">All</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Transcript</label>
              <select
                value={tableFilters.transcript}
                onChange={(event) =>
                  setTableFilters((previous) => ({
                    ...previous,
                    transcript: event.target.value as "all" | "available" | "none",
                  }))
                }
              >
                <option value="all">All</option>
                <option value="available">Available</option>
                <option value="none">None</option>
              </select>
            </div>
            {!isPersonalMode ? (
              <div>
                <label>Org</label>
                <input
                  value={tableFilters.org}
                  onChange={(event) => setTableFilters((previous) => ({ ...previous, org: event.target.value }))}
                  placeholder="Name or ID"
                />
              </div>
            ) : null}
            <div>
              <label>User</label>
              <input
                value={tableFilters.user}
                onChange={(event) => setTableFilters((previous) => ({ ...previous, user: event.target.value }))}
                placeholder="Email or ID"
              />
            </div>
            <div>
              <label>Scenario</label>
              <input
                value={tableFilters.scenario}
                onChange={(event) =>
                  setTableFilters((previous) => ({ ...previous, scenario: event.target.value }))
                }
                placeholder="Title or segment"
              />
            </div>
            <div>
              <label>Message</label>
              <input
                value={tableFilters.message}
                onChange={(event) => setTableFilters((previous) => ({ ...previous, message: event.target.value }))}
                placeholder="Contains text..."
              />
            </div>
          </div>
          <p className="small" style={{ marginBottom: 0 }}>
            Showing {filteredRows.length} of {rowsByMode.length} case(s).
          </p>
        </div>

        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Type</th>
              {isPersonalMode ? null : <th>Org</th>}
              <th>User</th>
              <th>Scenario</th>
              <th>Status</th>
              <th>Transcript</th>
              <th>Message</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id}>
                <td>
                  <div>{new Date(row.createdAt).toLocaleString()}</div>
                  <div className="small">{row.id}</div>
                </td>
                <td>{isAutoErrorCase(row.message) ? "Auto Error" : "User Feedback"}</td>
                {isPersonalMode ? null : <td>{row.org?.name ?? "-"}</td>}
                <td>
                  <div>{row.user.email}</div>
                  <div className="small">{row.user.id}</div>
                </td>
                <td>
                  <div>{row.scenarioTitle ?? "-"}</div>
                  <div className="small">{row.segmentLabel ?? ""}</div>
                </td>
                <td>{row.status}</td>
                <td>
                  {row.transcript.available ? (
                    <div>
                      <div>available</div>
                      <div className="small">
                        Expires: {row.transcript.expiresAt ? new Date(row.transcript.expiresAt).toLocaleString() : "-"}
                      </div>
                    </div>
                  ) : (
                    <div className="small">none</div>
                  )}
                </td>
                <td style={{ maxWidth: 360 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.message}>
                    {row.message}
                  </div>
                </td>
                <td>
                  <button type="button" onClick={() => void openCase(row.id)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={isPersonalMode ? 8 : 9} className="small">
                  {rowsByMode.length === 0 ? "No cases yet." : "No cases match current filters."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedCaseId ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            zIndex: 50
          }}
          onClick={() => closeModal()}
        >
          <div
            className="card"
            style={{
              width: "min(980px, 100%)",
              maxHeight: "90vh",
              overflow: "auto",
              background: "rgba(17, 35, 62, 0.96)"
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <h3 style={{ margin: 0 }}>Case {selectedCaseId}</h3>
              <button onClick={() => closeModal()}>Close</button>
            </div>

            {detailLoading ? <p className="small">Loading case details...</p> : null}
            {detailError ? <p className="error">{detailError}</p> : null}

            {selectedDetail ? (
              <>
                <div className="small" style={{ marginTop: 8 }}>
                  Type: {isAutoErrorCase(selectedDetail.message) ? "Auto Error" : "User Feedback"}{"\n"}
                  Org: {selectedDetail.org?.name ?? "-"}{"\n"}
                  User: {selectedDetail.user.email}{"\n"}
                  Status: {selectedDetail.status}{"\n"}
                  Created: {new Date(selectedDetail.createdAt).toLocaleString()}
                </div>

                <div className="card" style={{ marginTop: 12 }}>
                  <h4 style={{ marginTop: 0 }}>Message</h4>
                  <div style={{ whiteSpace: "pre-wrap" }}>{selectedDetail.message}</div>
                </div>

                <div className="card">
                  <h4 style={{ marginTop: 0 }}>Transcript</h4>
                  <div className="small" style={{ marginBottom: 8 }}>
                    {selectedDetail.transcript.available
                      ? `Expires: ${
                          selectedDetail.transcript.expiresAt
                            ? new Date(selectedDetail.transcript.expiresAt).toLocaleString()
                            : "-"
                        }`
                      : "No transcript attached."}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      fontFamily: "Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                      fontSize: 12.5,
                      lineHeight: 1.45
                    }}
                  >
                    {selectedDetail.transcript.text ?? "(no transcript)"}
                  </pre>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
