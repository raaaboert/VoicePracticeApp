"use client";

import { useState } from "react";
import type { DashboardAdminUserRow, OrgTrainingSummary } from "@voicepractice/shared";

import { fetchAdminApiJson } from "@/src/lib/adminApiClient";
import type { DashboardFocusTopicAssignment } from "@/src/lib/auth";
import { formatDateTime } from "@/src/lib/formatters";
import { partitionFocusTopicAssignments } from "@/src/components/focusTopicAssignmentPresentation";

type TopicRow = Pick<OrgTrainingSummary, "id" | "name" | "description" | "status">;
type Audience = DashboardFocusTopicAssignment["audience"];
const AUDIENCES: Array<{ value: Audience; label: string; description: string }> = [
  { value: "organization", label: "Entire organization", description: "Every active learner in this organization." },
  { value: "managers_and_admins", label: "Managers & Admins", description: "Organization admins, user admins, and current managers." },
  { value: "manager_only", label: "Manager only", description: "Only the selected manager; their team is not included." },
  { value: "manager_with_team", label: "Manager + current direct team", description: "The selected manager and their current direct reports." },
  { value: "individual", label: "Individual", description: "Only the selected learner." },
];

async function action<T>(body: Record<string, unknown>): Promise<T> {
  return fetchAdminApiJson<T>("/api/admin/focus-topic-management", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

export function FocusTopicAdministration({ orgId, initialTopics, users }: {
  orgId: string;
  initialTopics: OrgTrainingSummary[];
  users: DashboardAdminUserRow[];
}) {
  const [topics, setTopics] = useState<TopicRow[]>(initialTopics);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<DashboardFocusTopicAssignment[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [audience, setAudience] = useState<Audience>("organization");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = topics.find((topic) => topic.id === selectedId) ?? null;
  const targeted = audience === "manager_only" || audience === "manager_with_team" || audience === "individual";
  const subjectOptions = users.filter((user) => user.status === "active"
    && (audience === "individual" || user.assignedReportCount > 0));
  const userLabel = (id: string | null) => users.find((user) => user.userId === id)?.displayName ?? "Former member";
  const { activeAssignments, assignmentHistory } = partitionFocusTopicAssignments(assignments);
  const assignmentSubject = (row: DashboardFocusTopicAssignment) =>
    row.subjectUserId ? userLabel(row.subjectUserId) : "All eligible members";

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Focus Topic action failed."); }
    finally { setBusy(false); }
  };

  const selectTopic = (topic: TopicRow) => void run(async () => {
    const result = await action<{ assignments: DashboardFocusTopicAssignment[] }>({
      action: "list_assignments", orgId, topicId: topic.id,
    });
    setSelectedId(topic.id); setName(topic.name); setDescription(topic.description); setStatus(topic.status);
    setAssignments(result.assignments);
  });

  const createTopic = () => void run(async () => {
    const created = await action<TopicRow>({ action: "create_topic", orgId, name, description, status: "draft" });
    setTopics((current) => [...current, created]);
    setSelectedId(created.id); setStatus("draft"); setAssignments([]);
    setMessage("Focus Topic created as a draft.");
  });

  const saveTopic = () => void run(async () => {
    if (!selected) return;
    const updated = await action<TopicRow>({
      action: "update_topic", orgId, topicId: selected.id, name, description, status,
    });
    setTopics((current) => current.map((topic) => topic.id === updated.id ? updated : topic));
    setMessage("Focus Topic saved.");
  });

  const archiveTopic = () => void run(async () => {
    if (!selected) return;
    const updated = await action<TopicRow>({
      action: "update_topic", orgId, topicId: selected.id, status: "archived",
    });
    setTopics((current) => current.map((topic) => topic.id === updated.id ? updated : topic));
    setStatus("archived"); setMessage("Focus Topic archived. Historical records remain available.");
  });

  const createAssignment = () => void run(async () => {
    if (!selected) return;
    const created = await action<DashboardFocusTopicAssignment>({
      action: "create_assignment", orgId, topicId: selected.id,
      audience, subjectUserId: targeted ? subjectUserId : null,
    });
    setAssignments((current) => [...current, created]);
    setSubjectUserId(""); setMessage("Learner assignment created.");
  });

  const revokeAssignment = (assignmentId: string) => void run(async () => {
    if (!selected) return;
    const revoked = await action<DashboardFocusTopicAssignment>({
      action: "revoke_assignment", orgId, topicId: selected.id, assignmentId,
    });
    setAssignments((current) => current.map((row) => row.id === revoked.id ? revoked : row));
    setMessage("Learner assignment revoked. Its history remains recorded.");
  });

  return (
    <section className="section-card focus-topic-admin" aria-label="Focus Topic administration">
      <div className="section-header"><div>
        <p className="eyebrow">Learner authority</p>
        <h2>Focus Topic administration</h2>
        <p className="muted-copy">Manage Topic details and learner assignments.</p>
      </div></div>
      {error ? <div className="notice danger" role="alert">{error}</div> : null}
      {message ? <div className="notice success" role="status">{message}</div> : null}

      <div className="focus-topic-selector">
        <div className="focus-topic-field">
          <label htmlFor="focus-topic-select">Focus Topic</label>
          <select className="text-input" id="focus-topic-select" value={selectedId ?? ""} disabled={busy}
            onChange={(event) => {
              const topic = topics.find((row) => row.id === event.target.value);
              if (topic) selectTopic(topic);
              else { setSelectedId(null); setName(""); setDescription(""); setAssignments([]); }
            }}>
            <option value="">Create a new Focus Topic</option>
            {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name} ({topic.status})</option>)}
          </select>
        </div>
      </div>

      <div className="focus-topic-admin-panel" aria-labelledby="focus-topic-details-heading">
        <div className="focus-topic-panel-heading">
          <div>
            <p className="eyebrow">Topic details</p>
            <h3 id="focus-topic-details-heading">{selected ? "Edit Focus Topic" : "Create Focus Topic"}</h3>
          </div>
        </div>
        <div className="focus-topic-details-grid">
          <div className="focus-topic-field focus-topic-field-wide"><label htmlFor="focus-topic-name">Name</label>
            <input className="text-input" id="focus-topic-name" value={name} maxLength={160}
              disabled={busy || selected?.status === "archived"}
              onChange={(event) => setName(event.target.value)} /></div>
          <div className="focus-topic-field focus-topic-field-wide"><label htmlFor="focus-topic-description">Description</label>
            <textarea className="text-input focus-topic-description" id="focus-topic-description" value={description}
              maxLength={4000} disabled={busy || selected?.status === "archived"}
              onChange={(event) => setDescription(event.target.value)} /></div>
          {selected ? <div className="focus-topic-field focus-topic-status-field"><label htmlFor="focus-topic-status">Status</label>
            <select className="text-input" id="focus-topic-status" value={status}
              disabled={busy || selected.status === "archived"}
              onChange={(event) => setStatus(event.target.value as "draft" | "active") }>
              <option value="draft">Draft</option><option value="active">Active</option>
              {selected.status === "archived" ? <option value="archived">Archived</option> : null}
            </select></div> : null}
        </div>
        <div className="focus-topic-actions">
          <button type="button" className="primary-button" disabled={busy || !name.trim() || selected?.status === "archived"}
            onClick={selected ? saveTopic : createTopic}>{selected ? "Save Focus Topic" : "Create draft"}</button>
          {selected && selected.status !== "archived" ? <button type="button" className="ghost-button danger-button"
            disabled={busy} onClick={archiveTopic}>Archive Focus Topic</button> : null}
        </div>
      </div>

      {selected ? <div className="focus-topic-admin-panel" aria-labelledby="focus-topic-assignments-heading">
        <div className="focus-topic-panel-heading">
          <div>
            <p className="eyebrow">Learner access</p>
            <h3 id="focus-topic-assignments-heading">Assignments</h3>
            <p className="muted-copy">Assignments control learner access. Manager + current direct team follows current reporting lines.</p>
          </div>
        </div>
        <div className="focus-topic-assignment-composer">
          <div className={`focus-topic-assignment-fields${targeted ? " targeted" : ""}`}>
            <div className="focus-topic-field"><label htmlFor="focus-topic-audience">Audience</label>
              <select className="text-input" id="focus-topic-audience" value={audience}
                disabled={busy || selected.status === "archived"}
                onChange={(event) => { setAudience(event.target.value as Audience); setSubjectUserId(""); }}>
                {AUDIENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <small>{AUDIENCES.find((option) => option.value === audience)?.description}</small>
            </div>
            {targeted ? <div className="focus-topic-field"><label htmlFor="focus-topic-subject">
              {audience === "individual" ? "Learner" : "Manager"}</label>
              <select className="text-input" id="focus-topic-subject" value={subjectUserId}
                disabled={busy || selected.status === "archived"}
                onChange={(event) => setSubjectUserId(event.target.value)}>
                <option value="">Select an active organization member</option>
                {subjectOptions.map((user) => <option key={user.userId} value={user.userId}>{user.displayName}</option>)}
              </select></div> : null}
          </div>
          <button type="button" className="primary-button focus-topic-add-assignment"
            disabled={busy || selected.status === "archived" || (targeted && !subjectUserId)}
            onClick={createAssignment}>Add Assignment</button>
        </div>

        <div className="focus-topic-assignment-section">
          <h4>Active assignments</h4>
          {activeAssignments.length === 0 ? <p className="muted-copy">No active assignments.</p> : null}
          <div className="focus-topic-assignment-list">
            {activeAssignments.map((row) => <div key={row.id} className="focus-topic-assignment-row">
              <div className="training-content-order-copy">
                <div className="focus-topic-assignment-title">
                  <strong>{AUDIENCES.find((option) => option.value === row.audience)?.label}</strong>
                  <span className="status-badge status-active">Active</span>
                </div>
                <small>{assignmentSubject(row)}</small>
                <small>Assigned {formatDateTime(row.createdAt)}</small>
              </div>
              <button type="button" className="ghost-button danger-button compact-button" disabled={busy}
                onClick={() => revokeAssignment(row.id)}>Revoke</button>
            </div>)}
          </div>
        </div>

        <details className="focus-topic-assignment-section focus-topic-assignment-history">
          <summary>Assignment History ({assignmentHistory.length})</summary>
          {assignmentHistory.length === 0 ? <p className="muted-copy">No revoked assignments.</p> : (
            <div className="focus-topic-assignment-list">
              {assignmentHistory.map((row) => <div key={row.id} className="focus-topic-assignment-row revoked">
                <div className="training-content-order-copy">
                  <div className="focus-topic-assignment-title">
                    <strong>{AUDIENCES.find((option) => option.value === row.audience)?.label}</strong>
                    <span className="status-badge">Revoked</span>
                  </div>
                  <small>{assignmentSubject(row)}</small>
                  <small>Assigned {formatDateTime(row.createdAt)} · Revoked {formatDateTime(row.revokedAt)}</small>
                </div>
              </div>)}
            </div>
          )}
        </details>
      </div> : null}
    </section>
  );
}
