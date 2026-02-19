"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AppConfig,
  IndustryDefinition,
  RoleIndustryDefinition,
  Scenario,
  SegmentDefinition,
  UpdateConfigRequest
} from "@voicepractice/shared";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";

type DeleteTarget =
  | { kind: "industry"; id: string; label: string }
  | { kind: "role"; id: string; label: string }
  | { kind: "scenario"; id: string; label: string; roleId: string };

function createIdFromLabel(label: string, prefix: string, existingIds: Set<string>): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || prefix;

  if (!existingIds.has(base)) {
    return base;
  }

  let attempt = 2;
  while (existingIds.has(`${base}_${attempt}`)) {
    attempt += 1;
  }

  return `${base}_${attempt}`;
}

function sortIndustries(items: IndustryDefinition[]): IndustryDefinition[] {
  return [...items].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function sortRoles(items: SegmentDefinition[]): SegmentDefinition[] {
  return [...items].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function sortScenarios(items: Scenario[]): Scenario[] {
  return [...items].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`)
        .join(",")
    )
    .join("\n");
}

export default function ContentPage() {
  useRequireAdminToken();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [industrySearch, setIndustrySearch] = useState("");
  const [selectedIndustryId, setSelectedIndustryId] = useState("");
  const [newIndustryLabel, setNewIndustryLabel] = useState("");
  const [editingIndustryLabel, setEditingIndustryLabel] = useState("");

  const [roleSearch, setRoleSearch] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [editingRoleLabel, setEditingRoleLabel] = useState("");
  const [editingRoleSummary, setEditingRoleSummary] = useState("");

  const [roleIndustrySearch, setRoleIndustrySearch] = useState("");
  const [selectedRoleIndustryId, setSelectedRoleIndustryId] = useState("");

  const [addScenarioMode, setAddScenarioMode] = useState(false);
  const [newScenarioTitle, setNewScenarioTitle] = useState("");
  const [newScenarioDescription, setNewScenarioDescription] = useState("");
  const [newScenarioAiRole, setNewScenarioAiRole] = useState("");
  const [newScenarioEnabled, setNewScenarioEnabled] = useState(true);
  const [editingScenarioId, setEditingScenarioId] = useState("");
  const [editingScenarioDraft, setEditingScenarioDraft] = useState<Scenario | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteText, setDeleteText] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await adminFetch<AppConfig>("/config");
      setConfig(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load content.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const savePatch = async (patch: UpdateConfigRequest, successMessage: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await adminFetch<AppConfig>("/config", {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      setConfig(payload);
      setNotice(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save content.");
    } finally {
      setSaving(false);
    }
  };

  const industries = useMemo(() => sortIndustries(config?.industries ?? []), [config?.industries]);
  const roles = useMemo(() => sortRoles(config?.segments ?? []), [config?.segments]);
  const roleIndustries = config?.roleIndustries ?? [];

  const filteredIndustries = useMemo(() => {
    const needle = industrySearch.trim().toLowerCase();
    if (!needle) {
      return industries;
    }

    return industries.filter((industry) => industry.label.toLowerCase().includes(needle));
  }, [industries, industrySearch]);

  const filteredRoles = useMemo(() => {
    const needle = roleSearch.trim().toLowerCase();
    if (!needle) {
      return roles;
    }

    return roles.filter((role) => role.label.toLowerCase().includes(needle));
  }, [roles, roleSearch]);

  useEffect(() => {
    if (filteredIndustries.length === 0) {
      setSelectedIndustryId("");
      return;
    }

    if (!filteredIndustries.some((industry) => industry.id === selectedIndustryId)) {
      setSelectedIndustryId(filteredIndustries[0].id);
    }
  }, [filteredIndustries, selectedIndustryId]);

  useEffect(() => {
    if (filteredRoles.length === 0) {
      setSelectedRoleId("");
      return;
    }

    if (!filteredRoles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(filteredRoles[0].id);
    }
  }, [filteredRoles, selectedRoleId]);

  const selectedIndustry = useMemo(
    () => industries.find((industry) => industry.id === selectedIndustryId) ?? null,
    [industries, selectedIndustryId]
  );

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );

  useEffect(() => {
    setEditingIndustryLabel(selectedIndustry?.label ?? "");
  }, [selectedIndustry?.id, selectedIndustry?.label]);

  useEffect(() => {
    setEditingRoleLabel(selectedRole?.label ?? "");
    setEditingRoleSummary(selectedRole?.summary ?? "");
    setAddScenarioMode(false);
    setEditingScenarioId("");
    setEditingScenarioDraft(null);
  }, [selectedRole?.id, selectedRole?.label, selectedRole?.summary]);

  const roleIndustryRows = useMemo(() => {
    const activeByIndustryId = new Map<string, boolean>();
    for (const row of roleIndustries) {
      if (row.roleId !== selectedRoleId) {
        continue;
      }
      activeByIndustryId.set(row.industryId, row.active);
    }

    return industries.map((industry) => ({
      id: industry.id,
      label: industry.label,
      industryEnabled: industry.enabled,
      active: activeByIndustryId.get(industry.id) ?? false
    }));
  }, [industries, roleIndustries, selectedRoleId]);

  const filteredRoleIndustryRows = useMemo(() => {
    const needle = roleIndustrySearch.trim().toLowerCase();
    if (!needle) {
      return roleIndustryRows;
    }
    return roleIndustryRows.filter((row) => row.label.toLowerCase().includes(needle));
  }, [roleIndustryRows, roleIndustrySearch]);

  useEffect(() => {
    if (filteredRoleIndustryRows.length === 0) {
      setSelectedRoleIndustryId("");
      return;
    }

    if (!filteredRoleIndustryRows.some((row) => row.id === selectedRoleIndustryId)) {
      setSelectedRoleIndustryId(filteredRoleIndustryRows[0].id);
    }
  }, [filteredRoleIndustryRows, selectedRoleIndustryId]);

  const activeRoleIndustryLabels = useMemo(() => {
    return roleIndustryRows.filter((row) => row.active).map((row) => row.label);
  }, [roleIndustryRows]);

  const scenariosForRole = useMemo(() => sortScenarios(selectedRole?.scenarios ?? []), [selectedRole?.scenarios]);

  const addIndustry = async () => {
    if (!config) {
      return;
    }

    const label = newIndustryLabel.trim();
    if (!label) {
      setError("Industry name is required.");
      return;
    }

    const existingIds = new Set((config.industries ?? []).map((industry) => industry.id));
    const id = createIdFromLabel(label, "industry", existingIds);
    const nextIndustries = sortIndustries([...(config.industries ?? []), { id, label, enabled: true }]);

    await savePatch({ industries: nextIndustries }, "Industry added.");
    setNewIndustryLabel("");
    setSelectedIndustryId(id);
  };

  const saveIndustryEdit = async () => {
    if (!config || !selectedIndustry) {
      return;
    }

    const label = editingIndustryLabel.trim();
    if (!label) {
      setError("Industry name is required.");
      return;
    }

    const nextIndustries = sortIndustries(
      (config.industries ?? []).map((industry) =>
        industry.id === selectedIndustry.id ? { ...industry, label } : industry
      )
    );
    await savePatch({ industries: nextIndustries }, "Industry updated.");
  };

  const setIndustryActive = async (active: boolean) => {
    if (!config || !selectedIndustry) {
      return;
    }

    const nextIndustries = (config.industries ?? []).map((industry) =>
      industry.id === selectedIndustry.id ? { ...industry, enabled: active } : industry
    );
    await savePatch({ industries: nextIndustries }, active ? "Industry activated." : "Industry deactivated.");
  };

  const addRole = async () => {
    if (!config) {
      return;
    }

    const label = newRoleLabel.trim();
    if (!label) {
      setError("Role name is required.");
      return;
    }

    const existingIds = new Set((config.segments ?? []).map((segment) => segment.id));
    const id = createIdFromLabel(label, "role", existingIds);
    const nextRoles = sortRoles([
      ...(config.segments ?? []),
      { id, label, summary: `Conversations for ${label}.`, enabled: true, scenarios: [] }
    ]);

    await savePatch({ segments: nextRoles }, "Role added.");
    setNewRoleLabel("");
    setSelectedRoleId(id);
  };

  const saveRoleEdit = async () => {
    if (!config || !selectedRole) {
      return;
    }

    const label = editingRoleLabel.trim();
    if (!label) {
      setError("Role name is required.");
      return;
    }

    const summary = editingRoleSummary.trim() || `Conversations for ${label}.`;
    const nextRoles = sortRoles(
      (config.segments ?? []).map((segment) =>
        segment.id === selectedRole.id ? { ...segment, label, summary } : segment
      )
    );
    await savePatch({ segments: nextRoles }, "Role updated.");
  };

  const setRoleActive = async (active: boolean) => {
    if (!config || !selectedRole) {
      return;
    }

    const nextRoles = (config.segments ?? []).map((segment) =>
      segment.id === selectedRole.id ? { ...segment, enabled: active } : segment
    );
    await savePatch({ segments: nextRoles }, active ? "Role activated." : "Role deactivated.");
  };

  const setRoleIndustryActive = async (industryId: string, active: boolean) => {
    if (!config || !selectedRoleId || !industryId) {
      return;
    }

    const existing = (config.roleIndustries ?? []).find(
      (entry) => entry.roleId === selectedRoleId && entry.industryId === industryId
    );

    let nextRoleIndustries: RoleIndustryDefinition[];
    if (existing) {
      nextRoleIndustries = (config.roleIndustries ?? []).map((entry) =>
        entry.roleId === selectedRoleId && entry.industryId === industryId
          ? { ...entry, active }
          : entry
      );
    } else {
      nextRoleIndustries = [
        ...(config.roleIndustries ?? []),
        { roleId: selectedRoleId, industryId, active }
      ];
    }

    await savePatch(
      { roleIndustries: nextRoleIndustries },
      active ? "Role industry activated." : "Role industry set to inactive."
    );
  };

  const saveNewScenario = async () => {
    if (!config || !selectedRole) {
      return;
    }

    const title = newScenarioTitle.trim();
    const description = newScenarioDescription.trim();
    const aiRole = newScenarioAiRole.trim();

    if (!title || !description || !aiRole) {
      setError("Scenario, Description, and AI Role are required.");
      return;
    }

    const existingIds = new Set((selectedRole.scenarios ?? []).map((scenario) => scenario.id));
    const id = createIdFromLabel(title, `${selectedRole.id}_scenario`, existingIds);
    const newScenario: Scenario = {
      id,
      segmentId: selectedRole.id,
      title,
      description,
      aiRole,
      enabled: newScenarioEnabled
    };

    const nextRoles = (config.segments ?? []).map((segment) =>
      segment.id === selectedRole.id
        ? { ...segment, scenarios: sortScenarios([...(segment.scenarios ?? []), newScenario]) }
        : segment
    );

    await savePatch({ segments: nextRoles }, "Scenario added.");
    setNewScenarioTitle("");
    setNewScenarioDescription("");
    setNewScenarioAiRole("");
    setNewScenarioEnabled(true);
    setAddScenarioMode(false);
  };

  const startScenarioEdit = (scenario: Scenario) => {
    setEditingScenarioId(scenario.id);
    setEditingScenarioDraft({ ...scenario });
  };

  const saveScenarioEdit = async () => {
    if (!config || !selectedRole || !editingScenarioDraft || !editingScenarioId) {
      return;
    }

    const title = editingScenarioDraft.title.trim();
    const description = editingScenarioDraft.description.trim();
    const aiRole = editingScenarioDraft.aiRole.trim();
    if (!title || !description || !aiRole) {
      setError("Scenario, Description, and AI Role are required.");
      return;
    }

    const nextRoles = (config.segments ?? []).map((segment) => {
      if (segment.id !== selectedRole.id) {
        return segment;
      }

      const updatedScenarios = (segment.scenarios ?? []).map((scenario) =>
        scenario.id === editingScenarioId
          ? {
              ...scenario,
              title,
              description,
              aiRole,
              enabled: editingScenarioDraft.enabled !== false
            }
          : scenario
      );

      return {
        ...segment,
        scenarios: sortScenarios(updatedScenarios)
      };
    });

    await savePatch({ segments: nextRoles }, "Scenario updated.");
    setEditingScenarioId("");
    setEditingScenarioDraft(null);
  };

  const openDelete = (target: DeleteTarget) => {
    setDeleteTarget(target);
    setDeleteStep(1);
    setDeleteText("");
  };

  const confirmDelete = async () => {
    if (!config || !deleteTarget) {
      return;
    }

    if (deleteStep === 1) {
      setDeleteStep(2);
      return;
    }

    if (deleteText !== "Delete") {
      setError('Type "Delete" exactly to confirm.');
      return;
    }

    if (deleteTarget.kind === "industry") {
      const nextIndustries = (config.industries ?? []).filter((industry) => industry.id !== deleteTarget.id);
      const nextRoleIndustries = (config.roleIndustries ?? []).filter(
        (entry) => entry.industryId !== deleteTarget.id
      );
      await savePatch(
        { industries: nextIndustries, roleIndustries: nextRoleIndustries },
        "Industry deleted."
      );
    } else if (deleteTarget.kind === "role") {
      const nextRoles = (config.segments ?? []).filter((segment) => segment.id !== deleteTarget.id);
      const nextRoleIndustries = (config.roleIndustries ?? []).filter(
        (entry) => entry.roleId !== deleteTarget.id
      );
      await savePatch(
        { segments: nextRoles, roleIndustries: nextRoleIndustries },
        "Role deleted."
      );
    } else {
      const nextRoles = (config.segments ?? []).map((segment) => {
        if (segment.id !== deleteTarget.roleId) {
          return segment;
        }

        return {
          ...segment,
          scenarios: (segment.scenarios ?? []).filter((scenario) => scenario.id !== deleteTarget.id)
        };
      });
      await savePatch({ segments: nextRoles }, "Scenario deleted.");
    }

    setDeleteTarget(null);
    setDeleteText("");
    setDeleteStep(1);
  };

  const downloadScenariosCsv = () => {
    if (!config) {
      return;
    }

    const rows: string[][] = [
      ["Role", "Role Id", "Scenario", "Description", "AI Role", "Status"]
    ];

    const flattened = config.segments.flatMap((segment) =>
      (segment.scenarios ?? []).map((scenario) => ({
        roleLabel: segment.label,
        roleId: segment.id,
        scenarioTitle: scenario.title,
        description: scenario.description,
        aiRole: scenario.aiRole,
        status: scenario.enabled === false ? "inactive" : "active"
      }))
    );

    flattened
      .sort((a, b) => {
        const byRole = a.roleLabel.localeCompare(b.roleLabel, undefined, { sensitivity: "base" });
        if (byRole !== 0) {
          return byRole;
        }

        return a.scenarioTitle.localeCompare(b.scenarioTitle, undefined, { sensitivity: "base" });
      })
      .forEach((row) => {
        rows.push([row.roleLabel, row.roleId, row.scenarioTitle, row.description, row.aiRole, row.status]);
      });

    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `voicepractice-content-scenarios-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminShell title="Content">
      <div className="content-page">
        <div className="card content-intro-card">
          <h3>App Content</h3>
          <p className="small content-intro-copy">
            Manage industries, roles, role industries, and scenarios used by the entire app.
          </p>
          {loading ? <p className="small">Loading content...</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {notice ? <p className="success">{notice}</p> : null}
        </div>

        <div className="card content-section-card">
          <h3>Industry</h3>
          <div className="content-grid content-grid-two">
            <div>
              <label>Search Industries</label>
              <input
                value={industrySearch}
                onChange={(event) => setIndustrySearch(event.target.value)}
                placeholder="Type to filter industries"
              />
            </div>
            <div>
              <label>Industry</label>
              <select
                value={selectedIndustryId}
                onChange={(event) => setSelectedIndustryId(event.target.value)}
                disabled={filteredIndustries.length === 0}
              >
                {filteredIndustries.map((industry) => (
                  <option key={industry.id} value={industry.id}>
                    {industry.label} {industry.enabled ? "" : "(inactive)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="content-grid content-grid-input-action">
            <div>
              <label>Add Industry</label>
              <input
                value={newIndustryLabel}
                onChange={(event) => setNewIndustryLabel(event.target.value)}
                placeholder="Industry name"
              />
            </div>
            <div className="content-actions">
              <button
                type="button"
                className="primary"
                disabled={saving || !newIndustryLabel.trim()}
                onClick={() => void addIndustry()}
              >
                Add Industry
              </button>
            </div>
          </div>
          <div className="content-grid content-grid-input-action">
            <div>
              <label>Edit Industry Name</label>
              <input
                value={editingIndustryLabel}
                onChange={(event) => setEditingIndustryLabel(event.target.value)}
                disabled={!selectedIndustry}
              />
            </div>
            <div className="content-actions content-actions-wrap">
              <button
                type="button"
                disabled={saving || !selectedIndustry}
                onClick={() => void saveIndustryEdit()}
              >
                Save Industry
              </button>
              <button
                type="button"
                className={selectedIndustry?.enabled ? "primary" : undefined}
                disabled={saving || !selectedIndustry}
                onClick={() => void setIndustryActive(true)}
              >
                Active
              </button>
              <button
                type="button"
                className={!selectedIndustry?.enabled ? "primary" : undefined}
                disabled={saving || !selectedIndustry}
                onClick={() => void setIndustryActive(false)}
              >
                Inactive
              </button>
              <button
                type="button"
                className="danger"
                disabled={saving || !selectedIndustry}
                onClick={() =>
                  selectedIndustry
                    ? openDelete({ kind: "industry", id: selectedIndustry.id, label: selectedIndustry.label })
                    : undefined
                }
              >
                Delete
              </button>
            </div>
          </div>
          <p className="small content-hint">Rename, deactivate, or delete the selected industry.</p>
        </div>

        <div className="card content-section-card">
          <h3>Role</h3>
          <div className="content-grid content-grid-two">
            <div>
              <label>Search Roles</label>
              <input
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
                placeholder="Type to filter roles"
              />
            </div>
            <div>
              <label>Role</label>
              <select
                value={selectedRoleId}
                onChange={(event) => setSelectedRoleId(event.target.value)}
                disabled={filteredRoles.length === 0}
              >
                {filteredRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label} {role.enabled ? "" : "(inactive)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="content-grid content-grid-input-action">
            <div>
              <label>Add Role</label>
              <input
                value={newRoleLabel}
                onChange={(event) => setNewRoleLabel(event.target.value)}
                placeholder="Role name"
              />
            </div>
            <div className="content-actions">
              <button
                type="button"
                className="primary"
                disabled={saving || !newRoleLabel.trim()}
                onClick={() => void addRole()}
              >
                Add Role
              </button>
            </div>
          </div>
          <div className="content-grid content-grid-two">
            <div>
              <label>Edit Role Name</label>
              <input
                value={editingRoleLabel}
                onChange={(event) => setEditingRoleLabel(event.target.value)}
                disabled={!selectedRole}
              />
            </div>
            <div>
              <label>Role Summary</label>
              <input
                value={editingRoleSummary}
                onChange={(event) => setEditingRoleSummary(event.target.value)}
                disabled={!selectedRole}
              />
            </div>
          </div>
          <div className="content-actions content-actions-wrap content-actions-row">
            <button
              type="button"
              disabled={saving || !selectedRole}
              onClick={() => void saveRoleEdit()}
            >
              Save Role
            </button>
            <button
              type="button"
              className={selectedRole?.enabled ? "primary" : undefined}
              disabled={saving || !selectedRole}
              onClick={() => void setRoleActive(true)}
            >
              Active
            </button>
            <button
              type="button"
              className={!selectedRole?.enabled ? "primary" : undefined}
              disabled={saving || !selectedRole}
              onClick={() => void setRoleActive(false)}
            >
              Inactive
            </button>
            <button
              type="button"
              className="danger"
              disabled={saving || !selectedRole}
              onClick={() =>
                selectedRole
                  ? openDelete({ kind: "role", id: selectedRole.id, label: selectedRole.label })
                  : undefined
              }
            >
              Delete
            </button>
          </div>
        </div>

        <div className="card content-section-card">
          <h3>Role Industries</h3>
          <p className="small content-pill">
            Active Industries for role: {activeRoleIndustryLabels.length > 0 ? activeRoleIndustryLabels.join(", ") : "(none)"}
          </p>
          <div className="content-grid content-grid-two">
            <div>
              <label>Search Industries</label>
              <input
                value={roleIndustrySearch}
                onChange={(event) => setRoleIndustrySearch(event.target.value)}
                placeholder="Type to filter industries"
              />
            </div>
            <div>
              <label>Industry</label>
              <select
                value={selectedRoleIndustryId}
                onChange={(event) => setSelectedRoleIndustryId(event.target.value)}
                disabled={!selectedRoleId || filteredRoleIndustryRows.length === 0}
              >
                {filteredRoleIndustryRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label} {row.active ? "(active)" : "(inactive)"} {row.industryEnabled ? "" : "(industry disabled)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="content-actions content-actions-wrap content-actions-row">
            <button
              type="button"
              className="primary"
              disabled={saving || !selectedRoleId || !selectedRoleIndustryId}
              onClick={() => void setRoleIndustryActive(selectedRoleIndustryId, true)}
            >
              Active
            </button>
            <button
              type="button"
              disabled={saving || !selectedRoleId || !selectedRoleIndustryId}
              onClick={() => void setRoleIndustryActive(selectedRoleIndustryId, false)}
            >
              Inactive
            </button>
          </div>
        </div>

        <div className="card content-section-card">
          <div className="content-section-header content-header-actions">
            <h3>Scenarios For Role</h3>
            <div className="content-actions content-actions-wrap">
              <button type="button" onClick={downloadScenariosCsv}>
                Download CSV
              </button>
              <button type="button" className="primary" onClick={() => setAddScenarioMode((prev) => !prev)} disabled={!selectedRole}>
                {addScenarioMode ? "Cancel Add" : "Add Scenario"}
              </button>
            </div>
          </div>
          <div className="content-table-wrap">
            <table className="content-table">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Description</th>
              <th>AI Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {addScenarioMode ? (
              <tr>
                <td>
                  <input value={newScenarioTitle} onChange={(event) => setNewScenarioTitle(event.target.value)} />
                </td>
                <td>
                  <textarea
                    rows={3}
                    value={newScenarioDescription}
                    onChange={(event) => setNewScenarioDescription(event.target.value)}
                  />
                </td>
                <td>
                  <textarea rows={3} value={newScenarioAiRole} onChange={(event) => setNewScenarioAiRole(event.target.value)} />
                </td>
                <td>
                  <select
                    value={newScenarioEnabled ? "active" : "inactive"}
                    onChange={(event) => setNewScenarioEnabled(event.target.value === "active")}
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </td>
                <td>
                  <button type="button" className="primary" disabled={saving || !selectedRole} onClick={() => void saveNewScenario()}>
                    Save
                  </button>
                </td>
              </tr>
            ) : null}
            {scenariosForRole.length === 0 ? (
              <tr>
                <td colSpan={5} className="small">
                  {selectedRole ? "No scenarios for this role yet." : "Select a role to manage scenarios."}
                </td>
              </tr>
            ) : (
              scenariosForRole.map((scenario) => {
                const editing = scenario.id === editingScenarioId && editingScenarioDraft;
                return (
                  <tr key={scenario.id}>
                    <td>
                      {editing ? (
                        <input
                          value={editingScenarioDraft.title}
                          onChange={(event) =>
                            setEditingScenarioDraft({ ...editingScenarioDraft, title: event.target.value })
                          }
                        />
                      ) : (
                        scenario.title
                      )}
                    </td>
                    <td className="content-long-cell">
                      {editing ? (
                        <textarea
                          rows={3}
                          value={editingScenarioDraft.description}
                          onChange={(event) =>
                            setEditingScenarioDraft({ ...editingScenarioDraft, description: event.target.value })
                          }
                        />
                      ) : (
                        scenario.description
                      )}
                    </td>
                    <td className="content-long-cell">
                      {editing ? (
                        <textarea
                          rows={3}
                          value={editingScenarioDraft.aiRole}
                          onChange={(event) =>
                            setEditingScenarioDraft({ ...editingScenarioDraft, aiRole: event.target.value })
                          }
                        />
                      ) : (
                        scenario.aiRole
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select
                          value={editingScenarioDraft.enabled === false ? "inactive" : "active"}
                          onChange={(event) =>
                            setEditingScenarioDraft({
                              ...editingScenarioDraft,
                              enabled: event.target.value === "active"
                            })
                          }
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                      ) : scenario.enabled === false ? (
                        "inactive"
                      ) : (
                        "active"
                      )}
                    </td>
                    <td>
                      <div className="content-actions content-actions-wrap">
                        {editing ? (
                          <>
                            <button type="button" className="primary" onClick={() => void saveScenarioEdit()} disabled={saving}>
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingScenarioId("");
                                setEditingScenarioDraft(null);
                              }}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => startScenarioEdit(scenario)} disabled={saving}>
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="danger"
                          disabled={saving}
                          onClick={() =>
                            selectedRole
                              ? openDelete({
                                  kind: "scenario",
                                  id: scenario.id,
                                  roleId: selectedRole.id,
                                  label: scenario.title
                                })
                              : undefined
                          }
                        >
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
        </div>

        {deleteTarget ? (
          <div className="content-modal-backdrop">
            <div className="card content-modal-card">
            <h3>Confirm Delete</h3>
            <p className="content-modal-copy">
              Delete <strong>{deleteTarget.label}</strong>?
            </p>
            {deleteStep === 1 ? (
              <p className="small content-modal-copy">
                This action can permanently remove content. Click Continue to confirm.
              </p>
            ) : (
              <>
                <p className="small content-modal-copy">
                  Type <code>Delete</code> exactly, then confirm.
                </p>
                <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} />
              </>
            )}
              <div className="content-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteText("");
                  setDeleteStep(1);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={saving || (deleteStep === 2 && deleteText !== "Delete")}
                onClick={() => void confirmDelete()}
              >
                {deleteStep === 1 ? "Continue" : "Confirm Delete"}
              </button>
            </div>
          </div>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
