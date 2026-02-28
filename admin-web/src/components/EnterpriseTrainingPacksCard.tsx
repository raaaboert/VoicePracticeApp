"use client";

import { useEffect, useMemo, useState } from "react";
// @ts-expect-error Workspace does not include react-dom type declarations.
import { createPortal } from "react-dom";
import { AppConfig, TrainingPack } from "@voicepractice/shared";
import { adminFetch } from "../lib/api";

interface EnterpriseTrainingPacksCardProps {
  orgId: string;
  orgName?: string;
  config: AppConfig | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface OrgTrainingPacksListResponse {
  generatedAt: string;
  orgId: string;
  packs: TrainingPack[];
}

interface ScenarioOption {
  id: string;
  title: string;
  segmentId: string;
  segmentLabel: string;
  enabled: boolean;
}

interface TrainingPackEditorState {
  id: string | null;
  title: string;
  active: boolean;
  trainingPackBrief: string;
  customTriggersText: string;
  applyToAllScenarios: boolean;
  selectedScenarioIds: string[];
}

type EditorMode = "create" | "edit";

const SCENARIO_TRIGGER_PREFIX = "scenario:";
const SCENARIO_WILDCARD_TRIGGER = `${SCENARIO_TRIGGER_PREFIX}*`;

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
    minute: "2-digit"
  });
}

function normalizeTriggerList(value: string[]): string[] {
  const deduped = new Set<string>();
  for (const entry of value) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    deduped.add(trimmed);
  }
  return Array.from(deduped);
}

function parseTriggersFromText(value: string): string[] {
  return normalizeTriggerList(value.split(/\r?\n|,/));
}

function extractScenarioOptInFromTriggers(triggers: string[]): {
  applyToAllScenarios: boolean;
  selectedScenarioIds: string[];
  customTriggers: string[];
} {
  let applyToAllScenarios = false;
  const selectedScenarioIds: string[] = [];
  const customTriggers: string[] = [];

  for (const entry of normalizeTriggerList(triggers)) {
    const lower = entry.toLowerCase();
    if (!lower.startsWith(SCENARIO_TRIGGER_PREFIX)) {
      customTriggers.push(entry);
      continue;
    }

    const scenarioId = entry.slice(SCENARIO_TRIGGER_PREFIX.length).trim();
    if (!scenarioId) {
      continue;
    }
    if (scenarioId === "*") {
      applyToAllScenarios = true;
      continue;
    }
    selectedScenarioIds.push(scenarioId);
  }

  return {
    applyToAllScenarios,
    selectedScenarioIds: normalizeTriggerList(selectedScenarioIds),
    customTriggers
  };
}

function countAppliedScenarios(triggers: string[], availableScenarioCount: number): { count: number; label: string } {
  const parsed = extractScenarioOptInFromTriggers(triggers);
  if (parsed.applyToAllScenarios) {
    return {
      count: availableScenarioCount,
      label: availableScenarioCount > 0 ? `All (${availableScenarioCount})` : "All"
    };
  }
  return { count: parsed.selectedScenarioIds.length, label: String(parsed.selectedScenarioIds.length) };
}

function createEmptyEditorForm(): TrainingPackEditorState {
  return {
    id: null,
    title: "",
    active: true,
    trainingPackBrief: "",
    customTriggersText: "",
    applyToAllScenarios: false,
    selectedScenarioIds: []
  };
}

function editorFormFromPack(pack: TrainingPack): TrainingPackEditorState {
  const parsed = extractScenarioOptInFromTriggers(pack.requiredBehavioralTriggers ?? []);
  return {
    id: pack.id,
    title: pack.title ?? "",
    active: pack.active === true,
    trainingPackBrief: pack.trainingTopic ?? "",
    customTriggersText: parsed.customTriggers.join("\n"),
    applyToAllScenarios: parsed.applyToAllScenarios,
    selectedScenarioIds: parsed.applyToAllScenarios ? [] : parsed.selectedScenarioIds
  };
}

export function EnterpriseTrainingPacksCard({
  orgId,
  orgName,
  config,
  collapsed = false,
  onToggleCollapse
}: EnterpriseTrainingPacksCardProps) {
  const [packs, setPacks] = useState<TrainingPack[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editorForm, setEditorForm] = useState<TrainingPackEditorState>(() => createEmptyEditorForm());
  const [editorScenarioSearch, setEditorScenarioSearch] = useState("");
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const scenarioOptions = useMemo<ScenarioOption[]>(() => {
    const rows: ScenarioOption[] = [];
    for (const segment of config?.segments ?? []) {
      for (const scenario of segment.scenarios ?? []) {
        rows.push({
          id: scenario.id,
          title: scenario.title,
          segmentId: segment.id,
          segmentLabel: segment.label,
          enabled: scenario.enabled !== false
        });
      }
    }
    return rows.sort((a, b) => {
      const bySegment = a.segmentLabel.localeCompare(b.segmentLabel, undefined, { sensitivity: "base" });
      return bySegment !== 0 ? bySegment : a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }, [config?.segments]);

  const filteredScenarioOptions = useMemo(() => {
    const needle = editorScenarioSearch.trim().toLowerCase();
    if (!needle) {
      return scenarioOptions;
    }
    return scenarioOptions.filter((entry) =>
      [entry.title, entry.id, entry.segmentLabel, entry.segmentId].join(" ").toLowerCase().includes(needle)
    );
  }, [editorScenarioSearch, scenarioOptions]);

  const sortedPacks = useMemo(
    () =>
      [...packs].sort((a, b) => {
        if (a.active !== b.active) {
          return a.active ? -1 : 1;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
    [packs]
  );

  const refresh = async (options?: { preserveNotice?: boolean }) => {
    if (!orgId) {
      return;
    }
    setLoading(true);
    setError(null);
    if (!options?.preserveNotice) {
      setNotice(null);
    }
    try {
      const payload = await adminFetch<OrgTrainingPacksListResponse>(`/orgs/${orgId}/training-packs`);
      setPacks(payload.packs ?? []);
      setGeneratedAt(payload.generatedAt ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load training packs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const openCreate = () => {
    setEditorMode("create");
    setEditorForm(createEmptyEditorForm());
    setEditorScenarioSearch("");
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEdit = (pack: TrainingPack) => {
    setEditorMode("edit");
    setEditorForm(editorFormFromPack(pack));
    setEditorScenarioSearch("");
    setEditorError(null);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorError(null);
    setEditorSaving(false);
  };

  const toggleScenario = (scenarioId: string) => {
    setEditorForm((prev) => {
      if (prev.applyToAllScenarios) {
        return prev;
      }
      const next = new Set(prev.selectedScenarioIds);
      if (next.has(scenarioId)) {
        next.delete(scenarioId);
      } else {
        next.add(scenarioId);
      }
      return {
        ...prev,
        selectedScenarioIds: Array.from(next)
      };
    });
  };

  const saveEditor = async () => {
    if (!orgId) {
      return;
    }
    const title = editorForm.title.trim();
    const trainingPackBrief = editorForm.trainingPackBrief.trim();
    if (!title) {
      setEditorError("Title is required.");
      return;
    }
    if (!trainingPackBrief) {
      setEditorError("Training pack brief is required.");
      return;
    }

    const customTriggers = parseTriggersFromText(editorForm.customTriggersText);
    const scenarioTriggers = editorForm.applyToAllScenarios
      ? [SCENARIO_WILDCARD_TRIGGER]
      : editorForm.selectedScenarioIds.map((scenarioId) => `${SCENARIO_TRIGGER_PREFIX}${scenarioId}`);
    const requiredBehavioralTriggers = normalizeTriggerList([...customTriggers, ...scenarioTriggers]);

    setEditorSaving(true);
    setEditorError(null);
    setError(null);
    try {
      const payload = {
        title,
        trainingPackBrief,
        requiredBehavioralTriggers,
        active: editorForm.active
      };
      if (editorMode === "create") {
        await adminFetch<TrainingPack>(`/orgs/${orgId}/training-packs`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setNotice("Training pack created.");
      } else if (editorForm.id) {
        await adminFetch<TrainingPack>(`/orgs/${orgId}/training-packs/${editorForm.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        setNotice("Training pack updated.");
      }
      closeEditor();
      await refresh({ preserveNotice: true });
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : "Could not save training pack.");
    } finally {
      setEditorSaving(false);
    }
  };

  const toggleActive = async (pack: TrainingPack) => {
    if (!orgId) {
      return;
    }
    setBusyPackId(pack.id);
    setError(null);
    setNotice(null);
    try {
      await adminFetch<TrainingPack>(`/orgs/${orgId}/training-packs/${pack.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !pack.active })
      });
      setNotice(!pack.active ? "Training pack activated." : "Training pack deactivated.");
      await refresh({ preserveNotice: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update training pack status.");
    } finally {
      setBusyPackId(null);
    }
  };

  const deletePack = async (pack: TrainingPack) => {
    if (!orgId) {
      return;
    }
    const confirmed = window.confirm(`Delete training pack "${pack.title}"?`);
    if (!confirmed) {
      return;
    }

    setBusyPackId(pack.id);
    setError(null);
    setNotice(null);
    try {
      await adminFetch<{ deleted: boolean; trainingPackId: string }>(`/orgs/${orgId}/training-packs/${pack.id}`, {
        method: "DELETE"
      });
      setNotice("Training pack deleted.");
      await refresh({ preserveNotice: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete training pack.");
    } finally {
      setBusyPackId(null);
    }
  };

  return (
    <div className="card content-section-card" style={editorOpen ? { position: "relative", zIndex: 1200 } : undefined}>
      <div className="content-section-header content-header-actions">
        <div>
          <h3 style={{ marginBottom: 6 }}>Training Packs</h3>
          <div className="small">
            Org-scoped prompt coaching packs. {orgName ? `${orgName}. ` : ""}
            {generatedAt ? `Refreshed ${formatDateTime(generatedAt)}` : ""}
          </div>
        </div>
        <div className="content-actions content-actions-wrap">
          {onToggleCollapse ? (
            <button type="button" onClick={onToggleCollapse}>
              {collapsed ? "Expand" : "Collapse"}
            </button>
          ) : null}
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="primary" onClick={openCreate}>
            Create Training Pack
          </button>
        </div>
      </div>

      {loading ? <p className="small">Loading training packs...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      {collapsed ? (
        <p className="small">Training packs are collapsed. Total: {packs.length}</p>
      ) : (
        <div className="content-table-wrap">
          <table className="content-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Active</th>
                <th>Updated</th>
                <th>Applied Scenarios</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPacks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="small">
                    {loading ? "Loading..." : "No training packs found for this account."}
                  </td>
                </tr>
              ) : (
                sortedPacks.map((pack) => {
                  const scenarioSummary = countAppliedScenarios(
                    pack.requiredBehavioralTriggers ?? [],
                    scenarioOptions.length
                  );
                  const busy = busyPackId === pack.id;
                  return (
                    <tr key={pack.id}>
                      <td className="content-long-cell">
                        <div>{pack.title}</div>
                        <div className="small">{pack.id}</div>
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            borderRadius: 999,
                            border: "1px solid rgba(129, 206, 166, 0.4)",
                            background: pack.active ? "rgba(45, 165, 99, 0.28)" : "rgba(94, 107, 98, 0.3)",
                            padding: "4px 10px",
                            fontSize: 12,
                            fontWeight: 600
                          }}
                        >
                          {pack.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>{formatDateTime(pack.updatedAt)}</td>
                      <td>{scenarioSummary.label}</td>
                      <td>
                        <div className="content-actions content-actions-wrap">
                          <button type="button" disabled={busy} onClick={() => openEdit(pack)}>
                            Edit
                          </button>
                          <button type="button" disabled={busy} onClick={() => void toggleActive(pack)}>
                            {pack.active ? "Deactivate" : "Activate"}
                          </button>
                          <button type="button" className="danger" disabled={busy} onClick={() => void deletePack(pack)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {editorOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="content-modal-backdrop"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                display: "flex",
                justifyContent: "center",
                alignItems: "flex-start",
                paddingTop: "10vh",
                paddingLeft: 16,
                paddingRight: 16,
                paddingBottom: 24,
                overflowY: "auto"
              }}
            >
              <div
                className="card content-modal-card"
                style={{ width: "min(900px, calc(100vw - 32px))", maxHeight: "calc(100vh - 14vh)", overflowY: "auto" }}
              >
                <div className="content-section-header content-header-actions" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 style={{ marginBottom: 4 }}>{editorMode === "create" ? "Create Training Pack" : "Edit Training Pack"}</h3>
                    <div className="small">Configure brief, triggers, and scenario opt-in tags.</div>
                  </div>
                  <button type="button" onClick={closeEditor} disabled={editorSaving}>
                    Close
                  </button>
                </div>
                {editorError ? <p className="error">{editorError}</p> : null}
                <div className="content-grid content-grid-two">
                  <div>
                    <label>Title</label>
                    <input
                      value={editorForm.title}
                      onChange={(event) => setEditorForm((prev) => ({ ...prev, title: event.target.value }))}
                      disabled={editorSaving}
                    />
                  </div>
                  <div>
                    <label style={{ marginBottom: 8 }}>Status</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
                      <input
                        type="checkbox"
                        checked={editorForm.active}
                        onChange={(event) => setEditorForm((prev) => ({ ...prev, active: event.target.checked }))}
                        disabled={editorSaving}
                        style={{ width: 18, minHeight: 18 }}
                      />
                      <span>{editorForm.active ? "Active" : "Inactive"}</span>
                    </label>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Training Pack Brief</label>
                    <textarea
                      rows={6}
                      value={editorForm.trainingPackBrief}
                      onChange={(event) => setEditorForm((prev) => ({ ...prev, trainingPackBrief: event.target.value }))}
                      placeholder="Brief that appears in the Training Pack Brief section."
                      disabled={editorSaving}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Required Behavioral Triggers (non-scenario tags)</label>
                    <textarea
                      rows={4}
                      value={editorForm.customTriggersText}
                      onChange={(event) => setEditorForm((prev) => ({ ...prev, customTriggersText: event.target.value }))}
                      placeholder="One trigger per line. Scenario opt-in tags are managed below."
                      disabled={editorSaving}
                    />
                  </div>
                </div>

                <div className="card" style={{ marginTop: 12, marginBottom: 12 }}>
                  <div className="content-section-header content-header-actions" style={{ marginBottom: 8 }}>
                    <h3 style={{ fontSize: "1rem", marginBottom: 0 }}>Scenario Opt-In</h3>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
                      <input
                        type="checkbox"
                        checked={editorForm.applyToAllScenarios}
                        onChange={(event) =>
                          setEditorForm((prev) => ({
                            ...prev,
                            applyToAllScenarios: event.target.checked,
                            selectedScenarioIds: event.target.checked ? [] : prev.selectedScenarioIds
                          }))
                        }
                        disabled={editorSaving}
                        style={{ width: 18, minHeight: 18 }}
                      />
                      <span>Apply to all scenarios ({SCENARIO_WILDCARD_TRIGGER})</span>
                    </label>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label>Search scenarios</label>
                    <input
                      value={editorScenarioSearch}
                      onChange={(event) => setEditorScenarioSearch(event.target.value)}
                      placeholder="Search by scenario title, id, or segment"
                      disabled={editorSaving}
                    />
                  </div>
                  <div
                    style={{
                      border: "1px solid rgba(129, 206, 166, 0.22)",
                      borderRadius: 10,
                      padding: 10,
                      maxHeight: 280,
                      overflowY: "auto",
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: 8
                    }}
                  >
                    {filteredScenarioOptions.length === 0 ? (
                      <div className="small">No matching scenarios.</div>
                    ) : (
                      filteredScenarioOptions.map((scenario) => (
                        <label
                          key={scenario.id}
                          style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 0, color: "inherit" }}
                        >
                          <input
                            type="checkbox"
                            checked={editorForm.selectedScenarioIds.includes(scenario.id)}
                            onChange={() => toggleScenario(scenario.id)}
                            disabled={editorSaving || editorForm.applyToAllScenarios}
                            style={{ width: 18, minHeight: 18, marginTop: 2 }}
                          />
                          <span>
                            {scenario.title} {scenario.enabled ? "" : "(inactive)"}
                            <span className="small" style={{ display: "block" }}>
                              {scenario.segmentLabel} | {scenario.id}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>
                    Selected scenario tags are saved as <code>{SCENARIO_TRIGGER_PREFIX}&lt;scenarioId&gt;</code>. Enabling
                    "Apply to all scenarios" saves only <code>{SCENARIO_WILDCARD_TRIGGER}</code> as opt-in.
                  </p>
                </div>

                <div className="content-modal-actions">
                  <button type="button" onClick={closeEditor} disabled={editorSaving}>
                    Cancel
                  </button>
                  <button type="button" className="primary" onClick={() => void saveEditor()} disabled={editorSaving}>
                    {editorSaving ? "Saving..." : editorMode === "create" ? "Create Training Pack" : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
