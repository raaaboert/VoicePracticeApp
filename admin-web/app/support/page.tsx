"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";

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

export default function SupportPage() {
  useRequireAdminToken();
  const [payload, setPayload] = useState<SupportCaseListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const rows = useMemo(() => payload?.cases ?? [], [payload?.cases]);

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
    <AdminShell title="Feedback / Error Support">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
          <div>
            <p className="small" style={{ marginTop: 0 }}>
              Generated: {payload?.generatedAt ? new Date(payload.generatedAt).toLocaleString() : "-"}
            </p>
            <p className="small" style={{ marginBottom: 0 }}>
              Cases are created by mobile users when they opt in to share a transcript for support review.
            </p>
          </div>
          <button className="primary" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}

        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Org</th>
              <th>User</th>
              <th>Scenario</th>
              <th>Status</th>
              <th>Transcript</th>
              <th>Message</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <div>{new Date(row.createdAt).toLocaleString()}</div>
                  <div className="small">{row.id}</div>
                </td>
                <td>{row.org?.name ?? "-"}</td>
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
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{row.message}</div>
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
                <td colSpan={8} className="small">
                  No cases yet.
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

