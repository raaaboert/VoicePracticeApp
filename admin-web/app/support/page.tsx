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

type SortDirection = "asc" | "desc";
type SortKey = "createdAt" | "type" | "org" | "user" | "scenario" | "status" | "transcript" | "message";

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

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function getSortText(row: SupportCaseSummary, key: SortKey): string {
  if (key === "type") {
    return isAutoErrorCase(row.message) ? "Auto Error" : "User Feedback";
  }

  if (key === "org") {
    return row.org?.name ?? row.org?.id ?? "";
  }

  if (key === "user") {
    return `${row.user.email} ${row.user.id}`;
  }

  if (key === "scenario") {
    return `${row.scenarioTitle ?? ""} ${row.segmentLabel ?? ""}`;
  }

  if (key === "status") {
    return row.status;
  }

  if (key === "transcript") {
    return row.transcript.available ? "available" : "none";
  }

  return row.message;
}

function getCreatedAtMs(row: SupportCaseSummary): number {
  const value = new Date(row.createdAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export default function SupportPage() {
  useRequireAdminToken();
  const mode = useAdminMode();
  const isPersonalMode = mode === "personal";
  const [payload, setPayload] = useState<SupportCaseListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportFromDate, setExportFromDate] = useState("");
  const [exportToDate, setExportToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

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
    setExportFromDate("");
    setExportToDate("");
    setExportError(null);
    setExportNotice(null);
    setSortKey("createdAt");
    setSortDirection("desc");
  }, [isPersonalMode]);

  const rowsByMode = useMemo(
    () =>
      (payload?.cases ?? []).filter((row) =>
        isPersonalMode ? row.org === null : row.org !== null
      ),
    [isPersonalMode, payload],
  );

  const rows = useMemo(() => {
    const sorted = [...rowsByMode];
    sorted.sort((a, b) => {
      if (sortKey === "createdAt") {
        const diff = getCreatedAtMs(a) - getCreatedAtMs(b);
        if (diff !== 0) {
          return sortDirection === "asc" ? diff : -diff;
        }
        return b.id.localeCompare(a.id);
      }

      const textDiff = compareText(getSortText(a, sortKey), getSortText(b, sortKey));
      if (textDiff !== 0) {
        return sortDirection === "asc" ? textDiff : -textDiff;
      }

      return getCreatedAtMs(b) - getCreatedAtMs(a);
    });
    return sorted;
  }, [rowsByMode, sortDirection, sortKey]);

  const setSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "createdAt" ? "desc" : "asc");
  };

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

  const renderSortButton = (label: string, key: SortKey) => (
    <button type="button" className="sort-button" onClick={() => setSort(key)}>
      {label}
      <span className="sort-indicator">{sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
    </button>
  );

  return (
    <AdminShell title={isPersonalMode ? "Feedback / Error Support (Personal)" : "Feedback / Error Support (Enterprise)"}>
      <div className="card">
        <div className="card-header">
          <div>
            <p className="small">
              Generated: {payload?.generatedAt ? new Date(payload.generatedAt).toLocaleString() : "-"}
            </p>
            <p className="small" style={{ marginBottom: 0 }}>
              {isPersonalMode
                ? "Showing support cases submitted by individual users."
                : "Showing support cases submitted by enterprise users."}
            </p>
          </div>
          <div className="card-actions">
            <div style={{ minWidth: 150 }}>
              <label>Export From</label>
              <input
                type="date"
                value={exportFromDate}
                onChange={(event) => setExportFromDate(event.target.value)}
              />
            </div>
            <div style={{ minWidth: 150 }}>
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

        <p className="small" style={{ marginBottom: 0 }}>
          Click column headers to sort.
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{renderSortButton("Created", "createdAt")}</th>
                <th>{renderSortButton("Type", "type")}</th>
                {isPersonalMode ? null : <th>{renderSortButton("Org", "org")}</th>}
                <th>{renderSortButton("User", "user")}</th>
                <th>{renderSortButton("Scenario", "scenario")}</th>
                <th>{renderSortButton("Status", "status")}</th>
                <th>{renderSortButton("Transcript", "transcript")}</th>
                <th>{renderSortButton("Message", "message")}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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
                  <td style={{ maxWidth: 380 }}>
                    <div className="truncate" title={row.message}>
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
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={isPersonalMode ? 8 : 9} className="small">
                    No cases yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
            <div className="card-header">
              <h3>Case {selectedCaseId}</h3>
              <div className="card-actions">
                <button onClick={() => closeModal()}>Close</button>
              </div>
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
