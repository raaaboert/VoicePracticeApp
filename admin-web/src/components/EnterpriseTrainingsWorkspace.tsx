"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AppConfig,
  CreateOrgTrainingRequest,
  ORG_TRAINING_STATUSES,
  OrgDivisionRecord,
  OrgTrainingListResponse,
  OrgTrainingStatus,
  OrgTrainingSummary,
  SetOrgTrainingPackAttachmentsRequest,
  SetOrgTrainingScenarioAttachmentsRequest,
  UpdateOrgTrainingRequest,
} from "@voicepractice/shared";
import { adminFetch } from "../lib/api";
import { EnterpriseCustomScenariosCard } from "./EnterpriseCustomScenariosCard";
import { EnterpriseTrainingPacksCard } from "./EnterpriseTrainingPacksCard";

interface EnterpriseTrainingsWorkspaceProps {
  orgId: string;
  orgName?: string;
  config: AppConfig | null;
  orgUsers?: TrainingWorkspaceAssignableUser[];
  divisions?: OrgDivisionRecord[];
  divisionsEnabled?: boolean;
}

interface TrainingWorkspaceAssignableUser {
  userId: string;
  email: string;
  status: string;
  orgRole?: string;
  dashboardAccessEnabled?: boolean;
}

interface TrainingEditorState {
  name: string;
  status: OrgTrainingStatus;
  description: string;
  divisionId: string;
}

const NEW_TRAINING_ID = "__new__";
const LEGACY_MIGRATION_DESCRIPTION =
  "Auto-created to preserve existing enterprise training assets during the training-first workspace migration.";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
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

function createEmptyTrainingEditor(): TrainingEditorState {
  return {
    name: "",
    status: "draft",
    description: "",
    divisionId: "",
  };
}

function sanitizeTrainingDescription(value: string | null | undefined): string {
  const description = (value ?? "").trim();
  if (!description) {
    return "";
  }
  if (description === LEGACY_MIGRATION_DESCRIPTION) {
    return "";
  }
  return description;
}

function editorFromTraining(training: OrgTrainingSummary): TrainingEditorState {
  return {
    name: training.name,
    status: training.status,
    description: sanitizeTrainingDescription(training.description),
    divisionId: training.divisionId ?? "",
  };
}

function sortTrainings(rows: OrgTrainingSummary[]): OrgTrainingSummary[] {
  const order: Record<OrgTrainingStatus, number> = {
    active: 0,
    draft: 1,
    archived: 2,
  };

  return [...rows].sort((left, right) => {
    if (order[left.status] !== order[right.status]) {
      return order[left.status] - order[right.status];
    }
    const updatedAtDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (Number.isFinite(updatedAtDelta) && updatedAtDelta !== 0) {
      return updatedAtDelta;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function EnterpriseTrainingsWorkspace({
  orgId,
  orgName,
  config,
  orgUsers = [],
  divisions = [],
  divisionsEnabled = false,
}: EnterpriseTrainingsWorkspaceProps) {
  const [trainings, setTrainings] = useState<OrgTrainingSummary[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trainingSearch, setTrainingSearch] = useState("");
  const [editorTargetId, setEditorTargetId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<TrainingEditorState>(() => createEmptyTrainingEditor());
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [deletingTrainingId, setDeletingTrainingId] = useState<string | null>(null);
  const activeDivisions = useMemo(() => divisions.filter((division) => division.active), [divisions]);
  const divisionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const division of divisions) {
      map.set(division.id, division.name);
    }
    return map;
  }, [divisions]);

  const refreshWorkspace = async (options?: { preserveTargetId?: string | null; preserveNotice?: boolean }) => {
    if (!orgId) {
      return;
    }

    setLoading(true);
    setError(null);
    if (!options?.preserveNotice) {
      setNotice(null);
    }

    try {
      const payload = await adminFetch<OrgTrainingListResponse>(`/orgs/${orgId}/trainings`);
      setTrainings(sortTrainings(payload.trainings ?? []));
      setGeneratedAt(payload.generatedAt ?? null);

      const preferredTargetId =
        options && "preserveTargetId" in options ? options.preserveTargetId : editorTargetId;
      if (preferredTargetId === NEW_TRAINING_ID) {
        setEditorTargetId(NEW_TRAINING_ID);
      } else if (preferredTargetId && payload.trainings.some((entry) => entry.id === preferredTargetId)) {
        setEditorTargetId(preferredTargetId);
      } else {
        setEditorTargetId(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Focus Topic workspace.");
    } finally {
      setLoading(false);
    }
  };

  const replaceTrainingSummary = (next: OrgTrainingSummary | null | undefined, options?: { select?: boolean }) => {
    if (!next) {
      return;
    }
    setTrainings((prev) => sortTrainings([...prev.filter((entry) => entry.id !== next.id), next]));
    if (options?.select) {
      setEditorTargetId(next.id);
    }
  };

  useEffect(() => {
    void refreshWorkspace({ preserveTargetId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const selectedTraining = useMemo(
    () => trainings.find((entry) => entry.id === editorTargetId) ?? null,
    [editorTargetId, trainings],
  );

  useEffect(() => {
    if (editorTargetId === NEW_TRAINING_ID) {
      return;
    }
    if (selectedTraining) {
      setEditorState(editorFromTraining(selectedTraining));
      return;
    }
    setEditorState(createEmptyTrainingEditor());
  }, [editorTargetId, selectedTraining]);

  const filteredTrainings = useMemo(() => {
    const needle = trainingSearch.trim().toLowerCase();
    if (!needle) {
      return trainings;
    }
    return trainings.filter((training) => training.name.toLowerCase().includes(needle));
  }, [trainingSearch, trainings]);

  const startCreateTraining = () => {
    setEditorTargetId(NEW_TRAINING_ID);
    setEditorState(createEmptyTrainingEditor());
    setNotice(null);
    setError(null);
  };

  const openTraining = (trainingId: string) => {
    setEditorTargetId(trainingId);
    setNotice(null);
    setError(null);
  };

  const saveTraining = async () => {
    const name = editorState.name.trim();
    if (!name) {
      setError("Focus Topic name is required.");
      return;
    }

    setTrainingSaving(true);
    setError(null);
    setNotice(null);

    try {
      if (editorTargetId === NEW_TRAINING_ID) {
        const created = await adminFetch<OrgTrainingSummary>(`/orgs/${orgId}/trainings`, {
          method: "POST",
          body: JSON.stringify({
            name,
            status: editorState.status,
            description: editorState.description.trim(),
            divisionId: editorState.divisionId || null,
          } satisfies CreateOrgTrainingRequest),
        });
        replaceTrainingSummary(created, { select: true });
        setNotice(`Created Focus Topic "${created.name}".`);
      } else if (selectedTraining) {
        const updated = await adminFetch<OrgTrainingSummary>(`/orgs/${orgId}/trainings/${selectedTraining.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            status: editorState.status,
            description: editorState.description.trim(),
            divisionId: editorState.divisionId || null,
          } satisfies UpdateOrgTrainingRequest),
        });
        replaceTrainingSummary(updated, { select: true });
        setNotice(`Saved Focus Topic "${updated.name}".`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Focus Topic.");
    } finally {
      setTrainingSaving(false);
    }
  };

  const deleteTraining = async () => {
    if (!selectedTraining) {
      return;
    }
    if (selectedTraining.attachedTrainingPackCount > 0 || selectedTraining.attachedCustomScenarioCount > 0) {
      setError("Remove or delete the Focus Topic's packs and custom scenarios before deleting the Focus Topic.");
      return;
    }

    const confirmed = window.confirm(
      `Delete Focus Topic "${selectedTraining.name}"?`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingTrainingId(selectedTraining.id);
    setError(null);
    setNotice(null);
    try {
      await adminFetch<{ deleted: boolean; trainingId: string }>(`/orgs/${orgId}/trainings/${selectedTraining.id}`, {
        method: "DELETE",
      });
      setTrainings((prev) => prev.filter((entry) => entry.id !== selectedTraining.id));
      setEditorTargetId(null);
      setNotice(`Deleted Focus Topic "${selectedTraining.name}".`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete Focus Topic.");
    } finally {
      setDeletingTrainingId(null);
    }
  };

  const updateTrainingPackOwnership = async (trainingId: string, trainingPackIds: string[]) => {
    const updated = await adminFetch<OrgTrainingSummary>(`/orgs/${orgId}/trainings/${trainingId}/training-packs`, {
      method: "PUT",
      body: JSON.stringify({
        trainingPackIds,
      } satisfies SetOrgTrainingPackAttachmentsRequest),
    });
    replaceTrainingSummary(updated, { select: true });
  };

  const updateTrainingScenarioOwnership = async (trainingId: string, scenarioIds: string[]) => {
    const updated = await adminFetch<OrgTrainingSummary>(`/orgs/${orgId}/trainings/${trainingId}/custom-scenarios`, {
      method: "PUT",
      body: JSON.stringify({
        scenarioIds,
      } satisfies SetOrgTrainingScenarioAttachmentsRequest),
    });
    replaceTrainingSummary(updated, { select: true });
  };

  return (
    <div className="enterprise-tab-panel">
      {error ? (
        <div className="card">
          <p className="error">{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="card">
          <p className="success">{notice}</p>
        </div>
      ) : null}

      <div className="card enterprise-section-card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>Focus Topics</h3>
            <p className="small enterprise-note">Select a Focus Topic to open its detail workspace and attached assets.</p>
          </div>
          <div className="card-actions">
            <button
              type="button"
              onClick={() => void refreshWorkspace({ preserveTargetId: editorTargetId, preserveNotice: true })}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh Workspace"}
            </button>
            <button type="button" className="primary" onClick={startCreateTraining}>
              Create Focus Topic
            </button>
          </div>
        </div>
        <div className="enterprise-search-row">
          <div className="enterprise-search-field">
            <label>Search Focus Topics</label>
            <input
              type="search"
              value={trainingSearch}
              onChange={(event) => setTrainingSearch(event.target.value)}
              placeholder="Search by Focus Topic name"
            />
          </div>
        </div>
        <p className="small enterprise-note">
          {generatedAt ? `Workspace refreshed ${formatDateTime(generatedAt)}.` : "Focus Topic workspace data is loading."}
        </p>
        {trainings.length === 0 ? (
          <div className="enterprise-training-empty">
            <p>No Focus Topics created yet.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Focus Topic Name</th>
                  <th>Division</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Attached Packs</th>
                  <th>Attached Scenarios</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrainings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="small">
                      No Focus Topics match your search.
                    </td>
                  </tr>
                ) : (
                  filteredTrainings.map((training) => (
                    <tr
                      key={training.id}
                      className={[
                        "enterprise-training-row",
                        training.id === selectedTraining?.id ? "enterprise-training-row-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      tabIndex={0}
                      aria-selected={training.id === selectedTraining?.id}
                      onClick={() => openTraining(training.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openTraining(training.id);
                        }
                      }}
                    >
                      <td className="content-long-cell">
                        <button
                          type="button"
                          className="enterprise-training-name-button"
                          onClick={() => openTraining(training.id)}
                        >
                          {training.name}
                        </button>
                        <div className="small">{training.id}</div>
                      </td>
                      <td>{divisionLabelById.get(training.divisionId ?? "") ?? "General / Unassigned"}</td>
                      <td>{formatDateTime(training.createdAt)}</td>
                      <td>{training.status}</td>
                      <td>{formatDateTime(training.updatedAt)}</td>
                      <td>{training.attachedTrainingPackCount}</td>
                      <td>{training.attachedCustomScenarioCount}</td>
                      <td>
                        {training.id === selectedTraining?.id ? (
                          <span className="enterprise-row-status-badge">Selected</span>
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openTraining(training.id);
                            }}
                          >
                            Select
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editorTargetId !== NEW_TRAINING_ID && !selectedTraining ? (
        <div className="card enterprise-section-card">
          <div className="card-header">
            <div>
              <h3 style={{ marginBottom: 6 }}>Focus Topic Details</h3>
              <p className="small">Select a Focus Topic above to view its details and attached assets.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="card enterprise-section-card">
          <div className="card-header">
            <div>
              <h3 style={{ marginBottom: 6 }}>Focus Topic Details</h3>
              <p className="small">
                {selectedTraining
                  ? `Editing ${selectedTraining.name}.`
                  : "Create a Focus Topic, save it, then manage the packs and scenarios attached to it."}
              </p>
            </div>
            <div className="card-actions">
              {selectedTraining ? (
                <button
                  type="button"
                  className="danger"
                  disabled={trainingSaving || deletingTrainingId === selectedTraining.id}
                  onClick={() => void deleteTraining()}
                >
                  {deletingTrainingId === selectedTraining.id ? "Deleting..." : "Delete Focus Topic"}
                </button>
              ) : null}
              <button type="button" className="primary" disabled={trainingSaving} onClick={() => void saveTraining()}>
                {trainingSaving ? "Saving..." : editorTargetId === NEW_TRAINING_ID ? "Create Focus Topic" : "Save Focus Topic"}
              </button>
            </div>
          </div>

          {selectedTraining ? (
            <div className="enterprise-subsection">
              <div className="enterprise-summary-grid" style={{ marginTop: 0 }}>
                <div className="enterprise-summary-pill">
                  <span className="small">Created</span>
                  <strong>{formatDateTime(selectedTraining.createdAt)}</strong>
                </div>
                <div className="enterprise-summary-pill">
                  <span className="small">Status</span>
                  <strong>{selectedTraining.status}</strong>
                </div>
                <div className="enterprise-summary-pill">
                  <span className="small">Attached Packs</span>
                  <strong>{selectedTraining.attachedTrainingPackCount}</strong>
                </div>
                <div className="enterprise-summary-pill">
                  <span className="small">Attached Scenarios</span>
                  <strong>{selectedTraining.attachedCustomScenarioCount}</strong>
                </div>
                <div className="enterprise-summary-pill">
                  <span className="small">Division</span>
                  <strong>{divisionLabelById.get(selectedTraining.divisionId ?? "") ?? "General / Unassigned"}</strong>
                </div>
                <div className="enterprise-summary-pill">
                  <span className="small">Updated</span>
                  <strong>{formatDateTime(selectedTraining.updatedAt)}</strong>
                </div>
              </div>
            </div>
          ) : null}

          <div className="enterprise-subsection">
            <div className="enterprise-detail-grid">
              <div className="enterprise-detail-item">
                <label>Focus Topic Name</label>
                <input
                  value={editorState.name}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Enter Focus Topic name"
                />
              </div>
              <div className="enterprise-detail-item">
                <label>Status</label>
                <select
                  value={editorState.status}
                  onChange={(event) =>
                    setEditorState((prev) => ({
                      ...prev,
                      status: event.target.value as OrgTrainingStatus,
                    }))
                  }
                >
                  {ORG_TRAINING_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="enterprise-detail-item">
                <label>Division</label>
                <select
                  value={editorState.divisionId}
                  onChange={(event) =>
                    setEditorState((prev) => ({
                      ...prev,
                      divisionId: event.target.value,
                    }))
                  }
                >
                  <option value="">General / Unassigned</option>
                  {activeDivisions.map((division) => (
                    <option key={division.id} value={division.id}>
                      {division.name}
                    </option>
                  ))}
                </select>
                <div className="small" style={{ marginTop: 4 }}>
                  {divisionsEnabled
                    ? "Assigned divisions restrict visibility to matching users. Unassigned Focus Topics remain general."
                    : "Division assignments are retained, but live routing is currently disabled for this company."}
                </div>
              </div>
              <div className="enterprise-detail-item" style={{ gridColumn: "1 / -1" }}>
                <label>Notes</label>
                <textarea
                  rows={4}
                  value={editorState.description}
                  onChange={(event) => setEditorState((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Optional notes for operators."
                />
              </div>
            </div>
          </div>

          {!selectedTraining ? (
            <p className="small">Save the Focus Topic first, then create and manage its packs and custom scenarios below.</p>
          ) : null}
          {selectedTraining ? (
            <p className="small" style={{ marginTop: 12 }}>
              Custom scenarios do not accept direct division assignments. They inherit routing from this Focus Topic.
            </p>
          ) : null}
        </div>
      )}

      {selectedTraining ? (
        <>
          <EnterpriseTrainingPacksCard
            orgId={orgId}
            orgName={orgName}
            config={config}
            orgUsers={orgUsers}
            onCatalogChanged={() => refreshWorkspace({ preserveTargetId: selectedTraining.id, preserveNotice: true })}
            trainingScope={{
              trainingId: selectedTraining.id,
              trainingName: selectedTraining.name,
              attachedTrainingPackIds: selectedTraining.attachedTrainingPackIds,
              onTrainingPackOwnershipChange: async (trainingPackIds) => {
                await updateTrainingPackOwnership(selectedTraining.id, trainingPackIds);
              },
            }}
          />

          <EnterpriseCustomScenariosCard
            orgId={orgId}
            orgName={orgName}
            config={config}
            onCatalogChanged={() => refreshWorkspace({ preserveTargetId: selectedTraining.id, preserveNotice: true })}
            trainingScope={{
              trainingId: selectedTraining.id,
              trainingName: selectedTraining.name,
              attachedScenarioIds: selectedTraining.attachedCustomScenarioIds,
              onScenarioOwnershipChange: async (scenarioIds) => {
                await updateTrainingScenarioOwnership(selectedTraining.id, scenarioIds);
              },
            }}
          />
        </>
      ) : null}
    </div>
  );
}
