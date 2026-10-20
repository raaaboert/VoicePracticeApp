"use client";

import { useEffect, useRef, useState } from "react";
import type { AppConfig, OrgCustomScenario, OrgStandardScenarioDivisionListResponse, OrgTrainingSummary } from "@voicepractice/shared";
import { adminFetch } from "../lib/api";

type Audience = "organization" | "managers_and_admins" | "manager_only" | "manager_with_team" | "individual";
type Assignment = {
  id: string; audience: Audience; subjectUserId: string | null; revokedAt: string | null;
  grantsManagement: boolean; createdAt?: string; createdBy?: string; revokedBy?: string | null;
};
type Attachment = {
  id: string; scenarioKind?: "standard" | "org"; scenarioId?: string;
  contentId?: string; detachedAt: string | null; attachedAt?: string; attachedBy?: string;
  createdAt?: string; createdBy?: string; detachedBy?: string | null;
};
type ContentItem = { id: string; title: string; description: string; contentType: string;
  publicationState: string; archivedAt: string | null; availableToAttach: boolean };
type DirectResponse = { scenarios: Attachment[]; content: Attachment[]; contentItems?: ContentItem[] };
export type AttachmentOption = { id: string; kind: "standard" | "org" | "content"; title: string;
  detail: string; available: boolean; attached: boolean };
export function filterAttachmentOptions(options: AttachmentOption[], search: string) {
  const needle = search.trim().toLocaleLowerCase();
  return options.filter((item) => [item.title, item.detail].join(" ").toLocaleLowerCase().includes(needle));
}
const AUDIENCES: Array<{ value: Audience; label: string }> = [
  { value: "organization", label: "Entire organization" },
  { value: "managers_and_admins", label: "Managers & Admins" },
  { value: "manager_only", label: "Manager only (no team)" },
  { value: "manager_with_team", label: "Manager + current direct team" },
  { value: "individual", label: "Individual" },
];
function date(value?: string | null) { return value ? new Date(value).toLocaleString() : "Not recorded"; }

export function EnterpriseFocusTopicAuthorityCard({ orgId, topic, users, view = "access", config }: {
  orgId: string; topic: OrgTrainingSummary; config?: AppConfig | null;
  view?: "overview" | "access" | "content" | "history";
  users: Array<{ userId: string; email: string; status: string }>;
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [scenarios, setScenarios] = useState<OrgCustomScenario[]>([]);
  const [standards, setStandards] = useState<OrgStandardScenarioDivisionListResponse["rows"]>([]);
  const [audience, setAudience] = useState<Audience>("organization");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [kind, setKind] = useState<"standard" | "org" | "content">("standard");
  const [childId, setChildId] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sequence = useRef(0);
  const catalogSequence = useRef(0);
  const mounted = useRef(true);
  const base = `/orgs/${encodeURIComponent(orgId)}/trainings/${encodeURIComponent(topic.id)}`;
  const targeted = audience === "manager_only" || audience === "manager_with_team" || audience === "individual";
  const learnerAssignments = assignments.filter((row) => !row.grantsManagement);
  const managementGrants = assignments.filter((row) => row.grantsManagement);
  const activeLearners = learnerAssignments.filter((row) => !row.revokedAt);
  const activeManagers = managementGrants.filter((row) => !row.revokedAt);
  const activeAttachments = attachments.filter((row) => !row.detachedAt);
  const revoked = assignments.filter((row) => row.revokedAt);
  const detached = attachments.filter((row) => row.detachedAt);

  const refresh = async () => {
    const request = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const [assignmentResult, attachmentResult] = await Promise.all([
        adminFetch<{ assignments: Assignment[] }>(`${base}/assignments`),
        adminFetch<DirectResponse>(`${base}/direct-attachments`),
      ]);
      if (!mounted.current || request !== sequence.current) return;
      setAssignments(assignmentResult.assignments);
      setAttachments([...attachmentResult.scenarios, ...attachmentResult.content]);
      setContentItems(attachmentResult.contentItems ?? []);
    } finally { if (mounted.current && request === sequence.current) setLoading(false); }
  };
  const loadCatalogs = async () => {
    const request = ++catalogSequence.current;
    setCatalogError(null);
    try {
      const [custom, standard] = await Promise.all([
        adminFetch<{ scenarios: OrgCustomScenario[] }>(`/orgs/${encodeURIComponent(orgId)}/custom-scenarios`),
        adminFetch<OrgStandardScenarioDivisionListResponse>(`/orgs/${encodeURIComponent(orgId)}/standard-scenarios/divisions`),
      ]);
      if (!mounted.current || request !== catalogSequence.current) return;
      setScenarios(custom.scenarios); setStandards(standard.rows);
    } catch (caught) { if (mounted.current && request === catalogSequence.current) setCatalogError(caught instanceof Error ? caught.message : "Scenario names could not be loaded."); }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((caught) => { if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not load Topic relationships."); });
    return () => { mounted.current = false; sequence.current += 1; catalogSequence.current += 1; };
    // Topic keys remount this card, isolating requests, forms and disclosures.
  }, [base]);
  useEffect(() => { if (view === "content" || view === "history") void loadCatalogs(); }, [base, view]);

  const run = async (operation: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await operation(); if (!mounted.current) return; await refresh(); if (mounted.current) setNotice(message); }
    catch (caught) {
      // A retry/duplicate may already have changed relationships; always re-read current state.
      try { if (mounted.current) await refresh(); } catch { /* Preserve the original action error. */ }
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Authority action failed.");
    } finally { if (mounted.current) setBusy(false); }
  };
  const options: AttachmentOption[] = [
    ...contentItems.map((item) => ({ id: item.id, kind: "content" as const, title: item.title,
      detail: [item.contentType, item.publicationState, item.archivedAt ? "Archived" : "", item.description].filter(Boolean).join(" | "),
      available: item.availableToAttach && !item.archivedAt, attached: activeAttachments.some((row) => row.contentId === item.id) })),
    ...scenarios.map((item) => ({ id: item.id, kind: "org" as const, title: item.title,
      detail: ["Organization scenario", item.enabled ? "Active" : "Inactive", config?.segments.find((role) => role.id === item.segmentId)?.label,
        ...(item.applicableIndustryIds ?? []).map((id) => config?.industries.find((industry) => industry.id === id)?.label ?? id)].filter(Boolean).join(" | "),
      available: item.enabled === true, attached: activeAttachments.some((row) => row.scenarioKind === "org" && row.scenarioId === item.id) })),
    ...standards.map((item) => ({ id: item.scenarioId, kind: "standard" as const, title: item.title,
      detail: ["Standard scenario", item.segmentLabel, item.enabled ? "Enabled" : "Disabled"].join(" | "),
      available: item.enabled, attached: activeAttachments.some((row) => row.scenarioKind === "standard" && row.scenarioId === item.scenarioId) })),
  ];
  const attachmentName = (row: Attachment) => options.find((option) => option.id === (row.contentId ?? row.scenarioId)
    && option.kind === (row.contentId ? "content" : row.scenarioKind))?.title ?? "Historical or unavailable item";
  const assignmentName = (row: Assignment) => [AUDIENCES.find((option) => option.value === row.audience)?.label ?? row.audience,
    row.subjectUserId ? users.find((user) => user.userId === row.subjectUserId)?.email ?? "Former member" : null].filter(Boolean).join(" | ");
  const assignmentRows = (rows: Assignment[], history = false) => rows.length ? <ul className="topic-compact-list">{rows.map((row) => <li key={row.id}>
    <div><strong>{assignmentName(row)}</strong><div className="small">{row.grantsManagement ? "Management grant" : "Learner assignment"}
      {history ? ` | Revoked ${date(row.revokedAt)}` : ` | Created ${date(row.createdAt)}`}</div>
      <details><summary>Record details</summary><div className="small">ID: {row.id}<br />Created by: {row.createdBy ?? "Not recorded"}
        {history ? <><br />Revoked by: {row.revokedBy ?? "Not recorded"}</> : null}</div></details></div>
    {!history ? <button type="button" disabled={busy || loading} onClick={() => {
      if (!window.confirm(`Revoke ${assignmentName(row)}? History will be retained.`)) return;
      void run(() => adminFetch(`${base}/${row.grantsManagement ? "management-grants" : "assignments"}/${encodeURIComponent(row.id)}`, {method:"DELETE"}),
        row.grantsManagement ? "Management grant revoked; history retained." : "Assignment revoked; history retained.");
    }}>Revoke</button> : null}
  </li>)}</ul> : <p className="small">{history ? "No revoked records." : "No active records."}</p>;
  const attachmentRows = (rows: Attachment[], history = false) => rows.length ? <ul className="topic-compact-list">{rows.map((row) => <li key={row.id}>
    <div><strong>{attachmentName(row)}</strong><div className="small">{row.contentId ? "Learning material" : `${row.scenarioKind} scenario`}
      {history ? ` | Detached ${date(row.detachedAt)}` : " | Attached"}</div>
      <details><summary>Relationship details</summary><div className="small">Item ID: {row.contentId ?? row.scenarioId}<br />Relationship ID: {row.id}
        <br />Attached: {date(row.attachedAt ?? row.createdAt)} by {row.attachedBy ?? row.createdBy ?? "Not recorded"}
        {history ? <><br />Detached by: {row.detachedBy ?? "Not recorded"}</> : null}</div></details></div>
    {!history ? <button type="button" disabled={busy || loading} onClick={() => {
      if (!window.confirm(`Detach ${attachmentName(row)} from this Focus Topic? History will be retained.`)) return;
      void run(() => adminFetch(`${base}/direct-attachments/${encodeURIComponent(row.id)}`, {method:"DELETE"}), "Direct attachment detached; history retained.");
    }}>Detach</button> : null}
  </li>)}</ul> : <p className="small">{history ? "No detached relationships." : "No active direct attachments."}</p>;
  const attach = (selectedKind: typeof kind, id: string) => run(() => adminFetch(`${base}/direct-attachments`, {
    method:"POST", body:JSON.stringify(selectedKind === "content" ? {kind:"content",contentId:id}
      : {kind:"scenario",scenarioKind:selectedKind,scenarioId:id}),
  }), "Direct attachment created. Publication and approval are unchanged.");

  return <div className="enterprise-tab-panel" aria-label="Direct Focus Topic authority" hidden={view === "overview"}>
    {loading ? <p role="status">Loading Topic relationships...</p> : null}
    {error ? <p className="error" role="alert">{error} <button type="button" disabled={loading} onClick={() => void run(async () => {}, "Relationships refreshed.")}>Retry</button></p> : null}
    {notice ? <p className="success" role="status">{notice}</p> : null}
    <section className="card" id="topic-workspace-panel-access" role="tabpanel" aria-labelledby="topic-workspace-tab-access" hidden={view !== "access"}>
      <h3>Learner authority ({activeLearners.length} active assignments)</h3>
      <p className="small">Audience membership and effective learner access are resolved by the server. Changes take effect immediately.</p>
      <div className="enterprise-detail-grid">
        <div><label htmlFor="topic-authority-audience">Audience</label><select id="topic-authority-audience" value={audience}
          disabled={busy || loading || topic.status === "archived"} onChange={(event) => {setAudience(event.target.value as Audience);setSubjectUserId("");}}>
          {AUDIENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></div>
        {targeted ? <div><label htmlFor="topic-authority-subject">{audience === "individual" ? "Learner" : "Manager"}</label>
          <select id="topic-authority-subject" value={subjectUserId} disabled={busy || loading || topic.status === "archived"} onChange={(event) => setSubjectUserId(event.target.value)}>
            <option value="">Select an active member</option>{users.filter((user) => user.status === "active").map((user) => <option key={user.userId} value={user.userId}>{user.email}</option>)}
          </select></div> : null}
      </div>
      <button type="button" disabled={busy || loading || topic.status === "archived" || (targeted && !subjectUserId)} onClick={() => void run(() => adminFetch(`${base}/assignments`, {
        method:"POST",body:JSON.stringify({audience,subjectUserId:targeted ? subjectUserId : null}),
      }), "Assignment created.")}>Add assignment</button>
      {assignmentRows(activeLearners)}
      <details className="enterprise-subsection"><summary>Management grants ({activeManagers.length} active)</summary>
        <p className="small">Management authority is independent from learner access. This utility supports inspecting and revoking existing grants.</p>
        {assignmentRows(activeManagers)}
      </details>
    </section>
    <section className="card" id="topic-workspace-panel-content" role="tabpanel" aria-labelledby="topic-workspace-tab-content" hidden={view !== "content"}>
      <h3>Direct content attachments ({activeAttachments.length})</h3>
      <p className="small">{activeAttachments.filter((row) => row.scenarioId).length} direct scenarios | {activeAttachments.filter((row) => row.contentId).length} learning materials. These are separate from legacy ownership counts.</p>
      {attachmentRows(activeAttachments)}
      <h4>Attach an existing item</h4>
      <label htmlFor="topic-attachment-search">Search authorized scenarios and learning materials</label>
      <input id="topic-attachment-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, type, role or industry" />
      {catalogError ? <p className="error" role="alert">{catalogError} <button type="button" onClick={() => void loadCatalogs()}>Retry scenario catalog</button></p> : null}
      <ul className="topic-compact-list topic-attachment-options">{filterAttachmentOptions(options,search).map((option) => <li key={option.kind+option.id}>
        <div><strong>{option.title}</strong><p className="small">{option.detail}</p></div>
        <button type="button" disabled={busy || loading || topic.status === "archived" || option.attached || !option.available} onClick={() => void attach(option.kind,option.id)}>
          {option.attached ? "Already attached" : option.available ? "Attach" : "Unavailable"}</button>
      </li>)}</ul>
      {filterAttachmentOptions(options,search).length === 0 ? <p className="small">{search.trim() ? "No authorized items match your search." : "No available items were returned by the authorized catalogs."}</p> : null}
      <details className="enterprise-subsection"><summary>Advanced: attach by ID</summary>
        <p className="small">For specialized support. Server organization, eligibility and lifecycle validation still apply.</p>
        <label htmlFor="topic-authority-kind">Item type</label><select id="topic-authority-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="standard">Standard scenario</option><option value="org">Organization scenario</option><option value="content">Learning material</option></select>
        <label htmlFor="topic-authority-child">Existing item ID</label><input id="topic-authority-child" value={childId} onChange={(event) => setChildId(event.target.value)} />
        <button type="button" disabled={busy || loading || topic.status === "archived" || !childId.trim()} onClick={() => void attach(kind,childId.trim())}>Attach by ID</button>
      </details>
    </section>
    <section className="card" id="topic-workspace-panel-history" role="tabpanel" aria-labelledby="topic-workspace-tab-history" hidden={view !== "history"}>
      <h3>Topic relationship history</h3><p className="small">Existing revoked and detached records are retained. This is relationship history, not a complete metadata audit trail.</p>
      <details className="enterprise-subsection"><summary>Revoked learner assignments ({revoked.filter((row) => !row.grantsManagement).length})</summary>{assignmentRows(revoked.filter((row) => !row.grantsManagement),true)}</details>
      <details className="enterprise-subsection"><summary>Revoked management grants ({revoked.filter((row) => row.grantsManagement).length})</summary>{assignmentRows(revoked.filter((row) => row.grantsManagement),true)}</details>
      <details className="enterprise-subsection"><summary>Detached attachments ({detached.length})</summary>{attachmentRows(detached,true)}</details>
    </section>
  </div>;
}
