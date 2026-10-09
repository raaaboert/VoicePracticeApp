"use client";

import { useEffect, useState } from "react";
import type { OrgTrainingSummary } from "@voicepractice/shared";

import { adminFetch } from "../lib/api";

type Audience = "organization" | "managers_and_admins" | "manager_only" | "manager_with_team" | "individual";
type Assignment = {
  id: string; audience: Audience; subjectUserId: string | null; revokedAt: string | null;
  grantsManagement: boolean;
};
type Attachment = {
  id: string; scenarioKind?: "standard" | "org"; scenarioId?: string;
  contentId?: string; detachedAt: string | null;
};
const AUDIENCES: Array<{ value: Audience; label: string }> = [
  { value: "organization", label: "Entire organization" },
  { value: "managers_and_admins", label: "Managers & Admins" },
  { value: "manager_only", label: "Manager only (no team)" },
  { value: "manager_with_team", label: "Manager + current direct team" },
  { value: "individual", label: "Individual" },
];

export function EnterpriseFocusTopicAuthorityCard({ orgId, topic, users }: {
  orgId: string;
  topic: OrgTrainingSummary;
  users: Array<{ userId: string; email: string; status: string }>;
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [audience, setAudience] = useState<Audience>("organization");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [kind, setKind] = useState<"standard" | "org" | "content">("standard");
  const [childId, setChildId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/orgs/${encodeURIComponent(orgId)}/trainings/${encodeURIComponent(topic.id)}`;
  const targeted = audience === "manager_only" || audience === "manager_with_team" || audience === "individual";
  const learnerAssignments = assignments.filter((row) => !row.grantsManagement);
  const managementGrants = assignments.filter((row) => row.grantsManagement);

  const refresh = async () => {
    const [assignmentResult, attachmentResult] = await Promise.all([
      adminFetch<{ assignments: Assignment[] }>(`${base}/assignments`),
      adminFetch<{ scenarios: Attachment[]; content: Attachment[] }>(`${base}/direct-attachments`),
    ]);
    setAssignments(assignmentResult.assignments);
    setAttachments([...attachmentResult.scenarios, ...attachmentResult.content]);
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      adminFetch<{ assignments: Assignment[] }>(`${base}/assignments`),
      adminFetch<{ scenarios: Attachment[]; content: Attachment[] }>(`${base}/direct-attachments`),
    ]).then(([assignmentResult, attachmentResult]) => {
      if (!active) return;
      setAssignments(assignmentResult.assignments);
      setAttachments([...attachmentResult.scenarios, ...attachmentResult.content]);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Could not load direct Topic authority.");
    });
    return () => { active = false; };
  }, [base]);

  const run = async (operation: () => Promise<void>, message: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await operation(); await refresh(); setNotice(message); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Authority action failed."); }
    finally { setBusy(false); }
  };

  return <section className="card enterprise-section-card" aria-label="Direct Focus Topic authority">
    <h3>Direct learner authority</h3>
    <p className="small">Assignments and direct attachments control this Topic. Revoked and detached rows remain in history.</p>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {notice ? <p className="success" role="status">{notice}</p> : null}
    <h4>Learner authority</h4>
    <div className="enterprise-detail-grid">
      <div className="enterprise-detail-item"><label htmlFor="topic-authority-audience">Audience</label>
        <select id="topic-authority-audience" value={audience} disabled={busy || topic.status === "archived"}
          onChange={(event) => { setAudience(event.target.value as Audience); setSubjectUserId(""); }}>
          {AUDIENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {targeted ? <div className="enterprise-detail-item"><label htmlFor="topic-authority-subject">{audience === "individual" ? "Learner" : "Manager"}</label>
        <select id="topic-authority-subject" value={subjectUserId} disabled={busy || topic.status === "archived"}
          onChange={(event) => setSubjectUserId(event.target.value)}>
          <option value="">Select an active member</option>
          {users.filter((user) => user.status === "active").map((user) =>
            <option key={user.userId} value={user.userId}>{user.email}</option>)}
        </select>
      </div> : null}
    </div>
    <button type="button" disabled={busy || topic.status === "archived" || (targeted && !subjectUserId)}
      onClick={() => void run(async () => {
        await adminFetch(`${base}/assignments`, { method: "POST", body: JSON.stringify({
          audience, subjectUserId: targeted ? subjectUserId : null,
        }) });
      }, "Assignment created.")}>Add assignment</button>
    <ul>{learnerAssignments.map((row) => <li key={row.id}>
      {AUDIENCES.find((option) => option.value === row.audience)?.label ?? row.audience}
      {row.subjectUserId ? ` · ${users.find((user) => user.userId === row.subjectUserId)?.email ?? "Former member"}` : ""}
      {row.revokedAt ? " · Revoked" : <button type="button" disabled={busy}
        onClick={() => void run(async () => {
          await adminFetch(`${base}/assignments/${encodeURIComponent(row.id)}`, { method: "DELETE" });
        }, "Assignment revoked; history retained.")}>Revoke</button>}
    </li>)}</ul>
    <h4>Management grants</h4>
    <p className="small">Management authority is independent from learner access.</p>
    <ul>{managementGrants.map((row) => <li key={row.id}>
      Management grant · {AUDIENCES.find((option) => option.value === row.audience)?.label ?? row.audience}
      {row.subjectUserId ? ` · ${users.find((user) => user.userId === row.subjectUserId)?.email ?? "Former member"}` : ""}
      {row.revokedAt ? " · Revoked" : <button type="button" disabled={busy}
        onClick={() => void run(async () => {
          await adminFetch(`${base}/management-grants/${encodeURIComponent(row.id)}`, { method: "DELETE" });
        }, "Management grant revoked; history retained.")}>Revoke</button>}
    </li>)}</ul>
    <h4>Direct attachments</h4>
    <p className="small">Enter an existing standard scenario, organization scenario, or content ID. The server validates its organization and lifecycle.</p>
    <div className="enterprise-detail-grid">
      <div className="enterprise-detail-item"><label htmlFor="topic-authority-kind">Child type</label>
        <select id="topic-authority-kind" value={kind} disabled={busy || topic.status === "archived"}
          onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="standard">Standard scenario</option><option value="org">Organization scenario</option>
          <option value="content">Training Content</option>
        </select>
      </div>
      <div className="enterprise-detail-item"><label htmlFor="topic-authority-child">Child ID</label>
        <input id="topic-authority-child" value={childId} disabled={busy || topic.status === "archived"}
          onChange={(event) => setChildId(event.target.value)} />
      </div>
    </div>
    <button type="button" disabled={busy || topic.status === "archived" || !childId.trim()}
      onClick={() => void run(async () => {
        await adminFetch(`${base}/direct-attachments`, { method: "POST", body: JSON.stringify(
          kind === "content" ? { kind: "content", contentId: childId.trim() }
            : { kind: "scenario", scenarioKind: kind, scenarioId: childId.trim() },
        ) });
        setChildId("");
      }, "Direct attachment created.")}>Attach child</button>
    <ul>{attachments.map((row) => <li key={row.id}>
      {row.contentId ? `Content ${row.contentId}` : `${row.scenarioKind} scenario ${row.scenarioId}`}
      {row.detachedAt ? " · Detached" : <button type="button" disabled={busy}
        onClick={() => void run(async () => {
          await adminFetch(`${base}/direct-attachments/${encodeURIComponent(row.id)}`, { method: "DELETE" });
        }, "Direct attachment detached; history retained.")}>Detach</button>}
    </li>)}</ul>
  </section>;
}
