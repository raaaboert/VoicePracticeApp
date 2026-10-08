"use client";

import { useState } from "react";
import type { DashboardAdminUserRow, OrgTrainingSummary } from "@voicepractice/shared";

import { fetchAdminApiJson } from "@/src/lib/adminApiClient";
import type {
  DashboardFocusTopicAssignment,
  DashboardFocusTopicContentAttachment,
  DashboardFocusTopicRelatedContentResponse,
} from "@/src/lib/auth";
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

export function FocusTopicAdministration({
  orgId, initialTopics, users, canManageAllTopics, learningResourcesEnabled,
}: {
  orgId: string;
  initialTopics: OrgTrainingSummary[];
  users: DashboardAdminUserRow[];
  canManageAllTopics: boolean;
  learningResourcesEnabled: boolean;
}) {
  const [topics, setTopics] = useState<TopicRow[]>(initialTopics);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<DashboardFocusTopicAssignment[]>([]);
  const [related, setRelated] = useState<DashboardFocusTopicRelatedContentResponse | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [audience, setAudience] = useState<Audience>("organization");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [managementSubjectUserId, setManagementSubjectUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = topics.find((topic) => topic.id === selectedId) ?? null;
  const targeted = ["manager_only", "manager_with_team", "individual"].includes(audience);
  const subjectOptions = users.filter((user) => user.status === "active"
    && (audience === "individual" || user.assignedReportCount > 0));
  const managerOptions = users.filter((user) => user.status === "active"
    && (user.orgRole === "user_admin" || user.assignedReportCount > 0));
  const userLabel = (id: string | null) => users.find((user) => user.userId === id)?.displayName
    ?? (id ? "Assigned organization member" : "All eligible members");
  const learnerRows = assignments.filter((row) => !row.grantsManagement);
  const managerRows = assignments.filter((row) => row.grantsManagement);
  const learnerParts = partitionFocusTopicAssignments(learnerRows);
  const managerParts = partitionFocusTopicAssignments(managerRows);
  const activeAttachments = related?.content.filter((row) => row.detachedAt === null) ?? [];
  const activeContentIds = new Set(activeAttachments.map((row) => row.contentId));
  const attachedContent = activeAttachments.map((attachment) => ({
    attachment,
    item: related?.contentItems.find((item) => item.id === attachment.contentId) ?? null,
  }));
  const availableContent = related?.contentItems.filter((item) =>
    !item.archivedAt && !activeContentIds.has(item.id)) ?? [];

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Focus Topic action failed."); }
    finally { setBusy(false); }
  };

  const selectTopic = (topic: TopicRow) => void run(async () => {
    const [assignmentResult, relatedResult] = await Promise.all([
      action<{ assignments: DashboardFocusTopicAssignment[] }>({
        action: "list_assignments", orgId, topicId: topic.id,
      }),
      action<DashboardFocusTopicRelatedContentResponse>({
        action: "list_related_content", orgId, topicId: topic.id,
      }),
    ]);
    setSelectedId(topic.id); setName(topic.name); setDescription(topic.description); setStatus(topic.status);
    setAssignments(assignmentResult.assignments); setRelated(relatedResult);
  });

  const createTopic = () => void run(async () => {
    const created = await action<TopicRow>({ action: "create_topic", orgId, name, description, status: "draft" });
    setTopics((current) => [...current, created]); setSelectedId(created.id); setStatus("draft");
    setAssignments([]); setRelated(null); setMessage("Focus Topic created as a draft.");
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
      action: "create_assignment", orgId, topicId: selected.id, audience,
      subjectUserId: targeted ? subjectUserId : null, grantsManagement: false,
    });
    setAssignments((current) => [...current, created]); setSubjectUserId("");
    setMessage("Learner assignment created.");
  });
  const createManagementGrant = () => void run(async () => {
    if (!selected) return;
    const subject = users.find((user) => user.userId === managementSubjectUserId);
    if (!subject) return;
    const created = await action<DashboardFocusTopicAssignment>({
      action: "create_assignment", orgId, topicId: selected.id,
      audience: subject.orgRole === "user_admin" ? "individual" : "manager_only",
      subjectUserId: subject.userId, grantsManagement: true,
    });
    setAssignments((current) => [...current, created]); setManagementSubjectUserId("");
    setMessage("Topic management grant created.");
  });
  const revokeAssignment = (assignmentId: string, management: boolean) => void run(async () => {
    if (!selected) return;
    const revoked = await action<DashboardFocusTopicAssignment>({
      action: "revoke_assignment", orgId, topicId: selected.id, assignmentId,
    });
    setAssignments((current) => current.map((row) => row.id === revoked.id ? revoked : row));
    setMessage(management ? "Topic management grant revoked." : "Learner assignment revoked.");
  });
  const attachContent = (contentId: string) => void run(async () => {
    if (!selected || !related) return;
    const attachment = await action<DashboardFocusTopicContentAttachment>({
      action: "attach_content", orgId, topicId: selected.id, contentId,
    });
    setRelated({ ...related, content: [...related.content, attachment] });
    setMessage("Learning Resource attached to this Focus Topic.");
  });
  const detachContent = (attachmentId: string) => void run(async () => {
    if (!selected || !related) return;
    const result = await action<{ detachedAt: string }>({
      action: "detach_content", orgId, topicId: selected.id, attachmentId,
    });
    setRelated({
      ...related,
      content: related.content.map((row) => row.id === attachmentId
        ? { ...row, detachedAt: result.detachedAt } : row),
    });
    setMessage("Learning Resource detached. Relationship history remains recorded.");
  });

  const renderAssignments = (
    rows: DashboardFocusTopicAssignment[],
    options: { revoked?: boolean; management?: boolean },
  ) => rows.map((row) => <div key={row.id}
    className={`focus-topic-assignment-row${options.revoked ? " revoked" : ""}`}>
    <div className="training-content-order-copy">
      <div className="focus-topic-assignment-title">
        <strong>{options.management ? "Topic manager" : AUDIENCES.find((option) => option.value === row.audience)?.label}</strong>
        <span className={`status-badge${options.revoked ? "" : " status-active"}`}>
          {options.revoked ? "Revoked" : "Active"}
        </span>
      </div>
      <small>{row.subjectDisplayName ?? userLabel(row.subjectUserId)}</small>
      <small>Assigned {formatDateTime(row.createdAt)}
        {options.revoked ? ` · Revoked ${formatDateTime(row.revokedAt)}` : ""}</small>
    </div>
    {!options.revoked && canManageAllTopics ? <button type="button"
      className="ghost-button danger-button compact-button" disabled={busy}
      onClick={() => revokeAssignment(row.id, options.management === true)}>Revoke</button> : null}
  </div>);

  return <section className="section-card focus-topic-admin" aria-label="Focus Topic administration">
    <div className="section-header"><div>
      <p className="eyebrow">Topic workspace</p><h2>Focus Topic administration</h2>
      <p className="muted-copy">Review Topic details, learner assignments, and directly related learning resources.</p>
    </div></div>
    {error ? <div className="notice danger" role="alert">{error}</div> : null}
    {message ? <div className="notice success" role="status">{message}</div> : null}

    <div className="focus-topic-selector"><div className="focus-topic-field">
      <label htmlFor="focus-topic-select">Focus Topic</label>
      <select className="text-input" id="focus-topic-select" value={selectedId ?? ""} disabled={busy}
        onChange={(event) => {
          const topic = topics.find((row) => row.id === event.target.value);
          if (topic) selectTopic(topic);
          else { setSelectedId(null); setName(""); setDescription(""); setAssignments([]); setRelated(null); }
        }}>
        <option value="">{canManageAllTopics ? "Create a new Focus Topic" : "Select a Focus Topic"}</option>
        {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name} ({topic.status})</option>)}
      </select>
      {!canManageAllTopics && topics.length === 0
        ? <small>No current Focus Topic management grants are available.</small> : null}
    </div></div>

    {(selected || canManageAllTopics) ? <div className="focus-topic-admin-panel"
      aria-labelledby="focus-topic-details-heading">
      <div className="focus-topic-panel-heading"><div><p className="eyebrow">Topic details</p>
        <h3 id="focus-topic-details-heading">{selected
          ? (canManageAllTopics ? "Edit Focus Topic" : "Focus Topic details") : "Create Focus Topic"}</h3>
        {!canManageAllTopics ? <p className="muted-copy">Details are read-only for scoped Topic managers.</p> : null}
      </div></div>
      <div className="focus-topic-details-grid">
        <div className="focus-topic-field focus-topic-field-wide"><label htmlFor="focus-topic-name">Name</label>
          <input className="text-input" id="focus-topic-name" value={name} maxLength={160}
            disabled={busy || !canManageAllTopics || selected?.status === "archived"}
            onChange={(event) => setName(event.target.value)} /></div>
        <div className="focus-topic-field focus-topic-field-wide"><label htmlFor="focus-topic-description">Description</label>
          <textarea className="text-input focus-topic-description" id="focus-topic-description" value={description}
            maxLength={4000} disabled={busy || !canManageAllTopics || selected?.status === "archived"}
            onChange={(event) => setDescription(event.target.value)} /></div>
        {selected ? <div className="focus-topic-field focus-topic-status-field"><label htmlFor="focus-topic-status">Status</label>
          <select className="text-input" id="focus-topic-status" value={status}
            disabled={busy || !canManageAllTopics || selected.status === "archived"}
            onChange={(event) => setStatus(event.target.value as "draft" | "active")}>
            <option value="draft">Draft</option><option value="active">Active</option>
            {selected.status === "archived" ? <option value="archived">Archived</option> : null}
          </select></div> : null}
      </div>
      {canManageAllTopics ? <div className="focus-topic-actions">
        <button type="button" className="primary-button" disabled={busy || !name.trim() || selected?.status === "archived"}
          onClick={selected ? saveTopic : createTopic}>{selected ? "Save Focus Topic" : "Create draft"}</button>
        {selected && selected.status !== "archived" ? <button type="button" className="ghost-button danger-button"
          disabled={busy} onClick={archiveTopic}>Archive Focus Topic</button> : null}
      </div> : null}
    </div> : null}

    {selected ? <div className="focus-topic-admin-panel" aria-labelledby="focus-topic-assignments-heading">
      <div className="focus-topic-panel-heading"><div><p className="eyebrow">Learner access</p>
        <h3 id="focus-topic-assignments-heading">Learner assignments</h3>
        <p className="muted-copy">Scoped Topic managers can inspect assignments. Organization Admins control learner access.</p>
      </div></div>
      {canManageAllTopics ? <div className="focus-topic-assignment-composer">
        <div className={`focus-topic-assignment-fields${targeted ? " targeted" : ""}`}>
          <div className="focus-topic-field"><label htmlFor="focus-topic-audience">Audience</label>
            <select className="text-input" id="focus-topic-audience" value={audience}
              disabled={busy || selected.status === "archived"}
              onChange={(event) => { setAudience(event.target.value as Audience); setSubjectUserId(""); }}>
              {AUDIENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select><small>{AUDIENCES.find((option) => option.value === audience)?.description}</small></div>
          {targeted ? <div className="focus-topic-field"><label htmlFor="focus-topic-subject">
            {audience === "individual" ? "Learner" : "Manager"}</label>
            <select className="text-input" id="focus-topic-subject" value={subjectUserId}
              disabled={busy || selected.status === "archived"} onChange={(event) => setSubjectUserId(event.target.value)}>
              <option value="">Select an active organization member</option>
              {subjectOptions.map((user) => <option key={user.userId} value={user.userId}>{user.displayName}</option>)}
            </select></div> : null}
        </div>
        <button type="button" className="primary-button focus-topic-add-assignment"
          disabled={busy || selected.status === "archived" || (targeted && !subjectUserId)}
          onClick={createAssignment}>Add Assignment</button>
      </div> : null}
      <div className="focus-topic-assignment-section"><h4>Active assignments</h4>
        {learnerParts.activeAssignments.length === 0 ? <p className="muted-copy">No active learner assignments.</p> : null}
        <div className="focus-topic-assignment-list">{renderAssignments(learnerParts.activeAssignments, {})}</div>
      </div>
      <details className="focus-topic-assignment-section focus-topic-assignment-history">
        <summary>Assignment History ({learnerParts.assignmentHistory.length})</summary>
        {learnerParts.assignmentHistory.length === 0 ? <p className="muted-copy">No revoked assignments.</p>
          : <div className="focus-topic-assignment-list">
            {renderAssignments(learnerParts.assignmentHistory, { revoked: true })}</div>}
      </details>
    </div> : null}

    {selected && canManageAllTopics ? <div className="focus-topic-admin-panel"
      aria-labelledby="focus-topic-managers-heading">
      <div className="focus-topic-panel-heading"><div><p className="eyebrow">Scoped administration</p>
        <h3 id="focus-topic-managers-heading">Topic managers</h3>
        <p className="muted-copy">Grant this Topic to one eligible User Admin or current Manager. Product switches still apply.</p>
      </div></div>
      <div className="focus-topic-assignment-composer">
        <div className="focus-topic-field"><label htmlFor="focus-topic-manager-subject">Responsible actor</label>
          <select className="text-input" id="focus-topic-manager-subject" value={managementSubjectUserId}
            disabled={busy || selected.status === "archived"}
            onChange={(event) => setManagementSubjectUserId(event.target.value)}>
            <option value="">Select a User Admin or current Manager</option>
            {managerOptions.map((user) => <option key={user.userId} value={user.userId}>{user.displayName}</option>)}
          </select></div>
        <button type="button" className="primary-button focus-topic-add-assignment"
          disabled={busy || selected.status === "archived" || !managementSubjectUserId}
          onClick={createManagementGrant}>Grant Topic Management</button>
      </div>
      <div className="focus-topic-assignment-section"><h4>Active Topic managers</h4>
        {managerParts.activeAssignments.length === 0 ? <p className="muted-copy">No active scoped managers.</p> : null}
        <div className="focus-topic-assignment-list">
          {renderAssignments(managerParts.activeAssignments, { management: true })}</div>
      </div>
      <details className="focus-topic-assignment-section focus-topic-assignment-history">
        <summary>Management Grant History ({managerParts.assignmentHistory.length})</summary>
        {managerParts.assignmentHistory.length === 0 ? <p className="muted-copy">No revoked management grants.</p>
          : <div className="focus-topic-assignment-list">
            {renderAssignments(managerParts.assignmentHistory, { revoked: true, management: true })}</div>}
      </details>
    </div> : null}

    {selected ? <div className="focus-topic-admin-panel" aria-labelledby="focus-topic-related-heading">
      <div className="focus-topic-panel-heading"><div><p className="eyebrow">Learning Resources</p>
        <h3 id="focus-topic-related-heading">Related Content</h3>
        <p className="muted-copy">Attach existing organization content. Shared central items are not edited here.</p>
      </div></div>
      {!learningResourcesEnabled || related?.permissions.learningResourcesEnabled === false
        ? <div className="notice" role="status">Learning Resources are not enabled for this organization. Related Content is read-only.</div>
        : null}
      <div className="focus-topic-assignment-section"><h4>Attached Content</h4>
        {attachedContent.length === 0 ? <p className="muted-copy">No Learning Resources are attached.</p> : null}
        <div className="focus-topic-assignment-list">{attachedContent.map(({ attachment, item }) =>
          <div key={attachment.id} className="focus-topic-assignment-row">
            <div className="training-content-order-copy"><strong>{item?.title ?? "Unavailable Learning Resource"}</strong>
              <small>{item
                ? `${item.contentType} · ${item.publicationState}${item.archivedAt ? " · archived" : ""}`
                : attachment.contentId}</small>
              <small>Attached {formatDateTime(attachment.attachedAt)}</small></div>
            {related?.permissions.canManageRelatedContent ? <button type="button"
              className="ghost-button danger-button compact-button" disabled={busy}
              onClick={() => detachContent(attachment.id)}>Detach</button> : null}
          </div>)}</div>
      </div>
      <div className="focus-topic-assignment-section"><h4>Available Organization Content</h4>
        {availableContent.length === 0 ? <p className="muted-copy">No additional current Learning Resources are available.</p> : null}
        <div className="focus-topic-assignment-list">{availableContent.map((item) =>
          <div key={item.id} className="focus-topic-assignment-row">
            <div className="training-content-order-copy"><strong>{item.title}</strong>
              <small>{item.contentType} · {item.publicationState}</small>
              {item.description ? <small>{item.description}</small> : null}</div>
            {related?.permissions.canManageRelatedContent ? <button type="button"
              className="primary-button compact-button" disabled={busy}
              onClick={() => attachContent(item.id)}>Attach</button> : null}
          </div>)}</div>
      </div>
    </div> : null}
  </section>;
}
