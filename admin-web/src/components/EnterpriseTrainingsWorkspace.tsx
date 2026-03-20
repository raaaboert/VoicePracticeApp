"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AppConfig,
  CreateOrgTrainingRequest,
  OrgCustomScenario,
  ORG_TRAINING_STATUSES,
  OrgTrainingListResponse,
  OrgTrainingStatus,
  OrgTrainingSummary,
  SetOrgTrainingPackAttachmentsRequest,
  SetOrgTrainingScenarioAttachmentsRequest,
  TrainingPack,
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
  trainingPacksCollapsed?: boolean;
  onToggleTrainingPacks?: () => void;
  customScenariosCollapsed?: boolean;
  onToggleCustomScenarios?: () => void;
}

interface TrainingWorkspaceAssignableUser {
  userId: string;
  email: string;
  status: string;
  orgRole?: string;
  dashboardAccessEnabled?: boolean;
}

interface OrgTrainingPacksListResponse {
  generatedAt: string;
  orgId: string;
  packs: TrainingPack[];
}

interface OrgCustomScenariosListResponse {
  generatedAt: string;
  orgId: string;
  scenarios: OrgCustomScenario[];
}

interface TrainingEditorState {
  name: string;
  status: OrgTrainingStatus;
  description: string;
}

const NEW_TRAINING_ID = "__new__";

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
  };
}

function editorFromTraining(training: OrgTrainingSummary): TrainingEditorState {
  return {
    name: training.name,
    status: training.status,
    description: training.description ?? "",
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
  trainingPacksCollapsed = false,
  onToggleTrainingPacks,
  customScenariosCollapsed = false,
  onToggleCustomScenarios,
}: EnterpriseTrainingsWorkspaceProps) {
  const [trainings, setTrainings] = useState<OrgTrainingSummary[]>([]);
  const [trainingPacks, setTrainingPacks] = useState<TrainingPack[]>([]);
  const [customScenarios, setCustomScenarios] = useState<OrgCustomScenario[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorTargetId, setEditorTargetId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<TrainingEditorState>(() => createEmptyTrainingEditor());
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [deletingTrainingId, setDeletingTrainingId] = useState<string | null>(null);
  const [packAttachmentSaving, setPackAttachmentSaving] = useState(false);
  const [scenarioAttachmentSaving, setScenarioAttachmentSaving] = useState(false);
  const [packSearch, setPackSearch] = useState("");
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);

  const refreshWorkspace = async (options?: { preserveTargetId?: string | null; preserveNotice?: boolean }) => {
    if (!orgId) {
      return;
    }

    setLoading(true);
    setError(null);
    if (!options?.preserveNotice) {
      setNotice(null);
    }

    const [trainingResult, packsResult, scenariosResult] = await Promise.allSettled([
      adminFetch<OrgTrainingListResponse>(`/orgs/${orgId}/trainings`),
      adminFetch<OrgTrainingPacksListResponse>(`/orgs/${orgId}/training-packs`),
      adminFetch<OrgCustomScenariosListResponse>(`/orgs/${orgId}/custom-scenarios`),
    ]);

    if (trainingResult.status === "fulfilled") {
      setTrainings(sortTrainings(trainingResult.value.trainings ?? []));
      setGeneratedAt(trainingResult.value.generatedAt ?? null);
      const preferredTargetId = options?.preserveTargetId ?? editorTargetId;
      if (preferredTargetId === NEW_TRAINING_ID) {
        setEditorTargetId(NEW_TRAINING_ID);
      } else if (preferredTargetId && trainingResult.value.trainings.some((entry) => entry.id === preferredTargetId)) {
        setEditorTargetId(preferredTargetId);
      } else if (trainingResult.value.trainings.length > 0) {
        setEditorTargetId(trainingResult.value.trainings[0].id);
      } else {
        setEditorTargetId(null);
      }
    }

    if (packsResult.status === "fulfilled") {
      setTrainingPacks(packsResult.value.packs ?? []);
    }
    if (scenariosResult.status === "fulfilled") {
      setCustomScenarios(scenariosResult.value.scenarios ?? []);
    }

    const failures = [trainingResult, packsResult, scenariosResult].filter((entry) => entry.status === "rejected");
    if (failures.length > 0) {
      const firstFailure = failures[0];
      setError(firstFailure.reason instanceof Error ? firstFailure.reason.message : "Could not load training workspace.");
    }

    setLoading(false);
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
    if (trainings.length === 0) {
      setEditorState(createEmptyTrainingEditor());
    }
  }, [editorTargetId, selectedTraining, trainings.length]);

  useEffect(() => {
    if (!selectedTraining) {
      setSelectedPackIds([]);
      setSelectedScenarioIds([]);
      return;
    }
    setSelectedPackIds(selectedTraining.attachedTrainingPackIds ?? []);
    setSelectedScenarioIds(selectedTraining.attachedCustomScenarioIds ?? []);
  }, [selectedTraining]);

  const roleLabelById = useMemo(
    () => new Map((config?.segments ?? []).map((segment) => [segment.id, segment.label])),
    [config?.segments],
  );
  const industryLabelById = useMemo(
    () => new Map((config?.industries ?? []).map((industry) => [industry.id, industry.label])),
    [config?.industries],
  );

  const filteredTrainingPacks = useMemo(() => {
    const needle = packSearch.trim().toLowerCase();
    if (!needle) {
      return trainingPacks;
    }
    return trainingPacks.filter((pack) =>
      [pack.title, pack.id, pack.trainingTopic].join(" ").toLowerCase().includes(needle),
    );
  }, [packSearch, trainingPacks]);

  const filteredCustomScenarios = useMemo(() => {
    const needle = scenarioSearch.trim().toLowerCase();
    if (!needle) {
      return customScenarios;
    }
    return customScenarios.filter((scenario) =>
      [
        scenario.title,
        scenario.id,
        scenario.description,
        scenario.aiRole,
        roleLabelById.get(scenario.segmentId) ?? scenario.segmentId,
        ...(scenario.applicableIndustryIds ?? []).map((industryId) => industryLabelById.get(industryId) ?? industryId),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [customScenarios, industryLabelById, roleLabelById, scenarioSearch]);

  const startCreateTraining = () => {
    setEditorTargetId(NEW_TRAINING_ID);
    setEditorState(createEmptyTrainingEditor());
    setNotice(null);
    setError(null);
  };

  const saveTraining = async () => {
    const name = editorState.name.trim();
    if (!name) {
      setError("Training name is required.");
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
          } satisfies CreateOrgTrainingRequest),
        });
        replaceTrainingSummary(created, { select: true });
        setNotice(`Created training "${created.name}".`);
      } else if (selectedTraining) {
        const updated = await adminFetch<OrgTrainingSummary>(`/orgs/${orgId}/trainings/${selectedTraining.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            status: editorState.status,
            description: editorState.description.trim(),
          } satisfies UpdateOrgTrainingRequest),
        });
        replaceTrainingSummary(updated, { select: true });
        setNotice(`Saved training "${updated.name}".`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save training.");
    } finally {
      setTrainingSaving(false);
    }
  };

  const deleteTraining = async () => {
    if (!selectedTraining) {
      return;
    }

    const confirmed = window.confirm(
      `Delete training "${selectedTraining.name}"? This detaches its packs and scenarios but does not delete the underlying assets.`,
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
      const remaining = trainings.filter((entry) => entry.id !== selectedTraining.id);
      setTrainings(sortTrainings(remaining));
      setEditorTargetId(remaining[0]?.id ?? null);
      setNotice(`Deleted training "${selectedTraining.name}".`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete training.");
    } finally {
      setDeletingTrainingId(null);
    }
  };

  const savePackAttachments = async () => {
    if (!selectedTraining) {
      return;
    }

    setPackAttachmentSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await adminFetch<OrgTrainingSummary>(
        `/orgs/${orgId}/trainings/${selectedTraining.id}/training-packs`,
        {
          method: "PUT",
          body: JSON.stringify({
            trainingPackIds: selectedPackIds,
          } satisfies SetOrgTrainingPackAttachmentsRequest),
        },
      );
      replaceTrainingSummary(updated, { select: true });
      setNotice(`Updated attached training packs for "${updated.name}".`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update training pack attachments.");
    } finally {
      setPackAttachmentSaving(false);
    }
  };

  const saveScenarioAttachments = async () => {
    if (!selectedTraining) {
      return;
    }

    setScenarioAttachmentSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await adminFetch<OrgTrainingSummary>(
        `/orgs/${orgId}/trainings/${selectedTraining.id}/custom-scenarios`,
        {
          method: "PUT",
          body: JSON.stringify({
            scenarioIds: selectedScenarioIds,
          } satisfies SetOrgTrainingScenarioAttachmentsRequest),
        },
      );
      replaceTrainingSummary(updated, { select: true });
      setNotice(`Updated attached custom scenarios for "${updated.name}".`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update custom scenario attachments.");
    } finally {
      setScenarioAttachmentSaving(false);
    }
  };

  const toggleSelectedPack = (trainingPackId: string) => {
    setSelectedPackIds((prev) =>
      prev.includes(trainingPackId) ? prev.filter((entry) => entry !== trainingPackId) : [...prev, trainingPackId],
    );
  };

  const toggleSelectedScenario = (scenarioId: string) => {
    setSelectedScenarioIds((prev) =>
      prev.includes(scenarioId) ? prev.filter((entry) => entry !== scenarioId) : [...prev, scenarioId],
    );
  };

  const workspaceTargetName =
    editorTargetId === NEW_TRAINING_ID ? "New Training" : (selectedTraining?.name ?? "Training Workspace");

  return (
    <div className="enterprise-tab-panel">
      <div className="card enterprise-section-card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>Trainings Workspace</h3>
            <p className="small">
              Trainings are now the primary admin object. Packs and scenarios remain available below as supporting libraries.
            </p>
          </div>
          <div className="card-actions">
            <button type="button" onClick={() => void refreshWorkspace({ preserveTargetId: editorTargetId, preserveNotice: true })} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh Workspace"}
            </button>
            <button type="button" className="primary" onClick={startCreateTraining}>
              Create Training
            </button>
          </div>
        </div>
        <div className="enterprise-summary-grid">
          <div className="enterprise-summary-pill">
            <span className="small">Trainings</span>
            <strong>{trainings.length}</strong>
          </div>
          <div className="enterprise-summary-pill">
            <span className="small">Supporting Packs</span>
            <strong>{trainingPacks.length}</strong>
          </div>
          <div className="enterprise-summary-pill">
            <span className="small">Supporting Scenarios</span>
            <strong>{customScenarios.length}</strong>
          </div>
          <div className="enterprise-summary-pill">
            <span className="small">Next</span>
            <strong>Training-based reporting</strong>
          </div>
        </div>
        <p className="small enterprise-note">
          {generatedAt ? `Workspace refreshed ${formatDateTime(generatedAt)}.` : "Training workspace data is loading."}
        </p>
      </div>

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
            <h3 style={{ marginBottom: 6 }}>Trainings</h3>
            <p className="small">Select a training to manage its details, attached packs, and attached scenarios.</p>
          </div>
        </div>
        {trainings.length === 0 ? (
          <div className="enterprise-training-empty">
            <p>No trainings created yet.</p>
            <button type="button" className="primary" onClick={startCreateTraining}>
              Create Training
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Training Name</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Attached Packs</th>
                  <th>Attached Scenarios</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {trainings.map((training) => (
                  <tr
                    key={training.id}
                    className={training.id === selectedTraining?.id ? "enterprise-training-row-selected" : undefined}
                  >
                    <td className="content-long-cell">
                      <div>{training.name}</div>
                      <div className="small">{training.id}</div>
                    </td>
                    <td>{training.status}</td>
                    <td>{formatDateTime(training.updatedAt)}</td>
                    <td>{training.attachedTrainingPackCount}</td>
                    <td>{training.attachedCustomScenarioCount}</td>
                    <td>
                      <button type="button" onClick={() => setEditorTargetId(training.id)}>
                        {training.id === selectedTraining?.id ? "Selected" : "Open"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(selectedTraining || editorTargetId === NEW_TRAINING_ID) ? (
        <div className="card enterprise-section-card">
          <div className="card-header">
            <div>
              <h3 style={{ marginBottom: 6 }}>{workspaceTargetName}</h3>
              <p className="small">
                Use this workspace to define the training and manage the packs and scenarios that support it.
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
                  {deletingTrainingId === selectedTraining.id ? "Deleting..." : "Delete Training"}
                </button>
              ) : null}
              <button type="button" className="primary" disabled={trainingSaving} onClick={() => void saveTraining()}>
                {trainingSaving
                  ? "Saving..."
                  : editorTargetId === NEW_TRAINING_ID
                    ? "Create Training"
                    : "Save Training"}
              </button>
            </div>
          </div>

          {selectedTraining ? (
            <div className="enterprise-summary-grid">
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
                <span className="small">Updated</span>
                <strong>{formatDateTime(selectedTraining.updatedAt)}</strong>
              </div>
            </div>
          ) : null}

          <div className="enterprise-detail-grid">
            <div className="enterprise-detail-item">
              <label>Training Name</label>
              <input
                value={editorState.name}
                onChange={(event) => setEditorState((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Enter training name"
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
            <div className="enterprise-detail-item" style={{ gridColumn: "1 / -1" }}>
              <label>Internal Notes</label>
              <textarea
                rows={4}
                value={editorState.description}
                onChange={(event) => setEditorState((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Optional notes for operators. This is not customer-facing."
              />
            </div>
          </div>

          {selectedTraining ? (
            <div className="enterprise-two-column">
              <div className="enterprise-subsection">
                <div className="card-header">
                  <div>
                    <h4 style={{ marginBottom: 6 }}>Attached Training Packs</h4>
                    <p className="small">
                      Choose which existing training packs belong to this training. Attached: {selectedPackIds.length}
                    </p>
                  </div>
                  <button type="button" onClick={() => void savePackAttachments()} disabled={packAttachmentSaving}>
                    {packAttachmentSaving ? "Saving..." : "Save Pack Attachments"}
                  </button>
                </div>
                <div className="enterprise-search-row">
                  <div className="enterprise-search-field">
                    <label>Search Training Packs</label>
                    <input
                      type="search"
                      value={packSearch}
                      onChange={(event) => setPackSearch(event.target.value)}
                      placeholder="Search by title, id, or brief"
                    />
                  </div>
                </div>
                <div className="enterprise-attachment-list">
                  {filteredTrainingPacks.length === 0 ? (
                    <p className="small">No training packs found for this account.</p>
                  ) : (
                    filteredTrainingPacks.map((pack) => (
                      <label key={pack.id} className="enterprise-attachment-row">
                        <input
                          type="checkbox"
                          checked={selectedPackIds.includes(pack.id)}
                          onChange={() => toggleSelectedPack(pack.id)}
                        />
                        <span>
                          {pack.title}
                          <span className="small" style={{ display: "block" }}>
                            {pack.active ? "Active" : "Inactive"} | {pack.id}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="enterprise-subsection">
                <div className="card-header">
                  <div>
                    <h4 style={{ marginBottom: 6 }}>Attached Custom Scenarios</h4>
                    <p className="small">
                      Choose which existing custom scenarios belong to this training. Attached: {selectedScenarioIds.length}
                    </p>
                  </div>
                  <button type="button" onClick={() => void saveScenarioAttachments()} disabled={scenarioAttachmentSaving}>
                    {scenarioAttachmentSaving ? "Saving..." : "Save Scenario Attachments"}
                  </button>
                </div>
                <div className="enterprise-search-row">
                  <div className="enterprise-search-field">
                    <label>Search Custom Scenarios</label>
                    <input
                      type="search"
                      value={scenarioSearch}
                      onChange={(event) => setScenarioSearch(event.target.value)}
                      placeholder="Search by title, role, industry, or id"
                    />
                  </div>
                </div>
                <div className="enterprise-attachment-list">
                  {filteredCustomScenarios.length === 0 ? (
                    <p className="small">No custom scenarios found for this account.</p>
                  ) : (
                    filteredCustomScenarios.map((scenario) => (
                      <label key={scenario.id} className="enterprise-attachment-row">
                        <input
                          type="checkbox"
                          checked={selectedScenarioIds.includes(scenario.id)}
                          onChange={() => toggleSelectedScenario(scenario.id)}
                        />
                        <span>
                          {scenario.title}
                          <span className="small" style={{ display: "block" }}>
                            {roleLabelById.get(scenario.segmentId) ?? scenario.segmentId}
                            {" | "}
                            {(scenario.applicableIndustryIds ?? [])
                              .map((industryId) => industryLabelById.get(industryId) ?? industryId)
                              .join(", ") || "-"}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="small">Create the training first, then attach packs and scenarios.</p>
          )}
        </div>
      ) : null}

      <div className="card enterprise-section-card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>Supporting Asset Libraries</h3>
            <p className="small">
              These libraries stay available for creating and maintaining the assets that trainings use.
            </p>
          </div>
        </div>
      </div>

      <EnterpriseTrainingPacksCard
        orgId={orgId}
        orgName={orgName}
        config={config}
        orgUsers={orgUsers}
        collapsed={trainingPacksCollapsed}
        onToggleCollapse={onToggleTrainingPacks}
        onCatalogChanged={() => refreshWorkspace({ preserveTargetId: editorTargetId, preserveNotice: true })}
      />

      <EnterpriseCustomScenariosCard
        orgId={orgId}
        orgName={orgName}
        config={config}
        collapsed={customScenariosCollapsed}
        onToggleCollapse={onToggleCustomScenarios}
        onCatalogChanged={() => refreshWorkspace({ preserveTargetId: editorTargetId, preserveNotice: true })}
      />
    </div>
  );
}
