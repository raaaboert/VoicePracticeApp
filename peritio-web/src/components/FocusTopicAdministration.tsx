"use client";

import { useState } from "react";
import type {
  CustomerPracticeScenario,
  CustomerPracticeScenarioListResponse,
  DashboardAdminUserRow,
  DashboardTrainingContentAssetFinalizationResponse,
  DashboardTrainingContentUploadInitiationResponse,
  OrgTrainingSummary,
} from "@voicepractice/shared";

import { fetchAdminApiJson } from "@/src/lib/adminApiClient";
import type {
  DashboardFocusTopicAssignment,
  DashboardFocusTopicContentAttachment,
  DashboardFocusTopicContentCreateResponse,
  DashboardFocusTopicContentItem,
  DashboardFocusTopicContentMutationResponse,
  DashboardFocusTopicRelatedContentResponse,
} from "@/src/lib/auth";
import { formatDateTime } from "@/src/lib/formatters";
import { directUploadTrainingContentAsset } from "@/src/lib/trainingContentDirectUpload";
import {
  trainingContentDeclaredMimeType,
  validateTrainingContentFileSelection,
} from "@/src/lib/trainingContentPresentation";
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

function contentTypeForFile(file: File): "video" | "audio" | "pdf" | "docx" | "image" | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || name.endsWith(".docx")) return "docx";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "video/mp4" || name.endsWith(".mp4")) return "video";
  return null;
}

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
  const [practiceScenarios, setPracticeScenarios] = useState<CustomerPracticeScenarioListResponse | null>(null);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [scenarioTitle, setScenarioTitle] = useState("");
  const [scenarioDescription, setScenarioDescription] = useState("");
  const [scenarioDesiredOutcome, setScenarioDesiredOutcome] = useState("");
  const [scenarioAiRole, setScenarioAiRole] = useState("");
  const [scenarioScoringGuidance, setScenarioScoringGuidance] = useState("");
  const [scenarioSegmentId, setScenarioSegmentId] = useState("");
  const [scenarioIndustryIds, setScenarioIndustryIds] = useState<string[]>([]);
  const [scenarioSourceLabel, setScenarioSourceLabel] = useState("");
  const [scenarioSourceReferenceId, setScenarioSourceReferenceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [audience, setAudience] = useState<Audience>("organization");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [managementSubjectUserId, setManagementSubjectUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<"attach" | "upload">("attach");
  const [newSourceMode, setNewSourceMode] = useState<"file" | "youtube">("file");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [transcriptContentId, setTranscriptContentId] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
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
    item.availableToAttach && !activeContentIds.has(item.id)) ?? [];

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Focus Topic action failed."); }
    finally { setBusy(false); }
  };

  const selectTopic = (topic: TopicRow) => void run(async () => {
    const [assignmentResult, relatedResult, scenarioResult] = await Promise.all([
      action<{ assignments: DashboardFocusTopicAssignment[] }>({
        action: "list_assignments", orgId, topicId: topic.id,
      }),
      action<DashboardFocusTopicRelatedContentResponse>({
        action: "list_related_content", orgId, topicId: topic.id,
      }),
      action<CustomerPracticeScenarioListResponse>({
        action: "list_practice_scenarios", orgId, topicId: topic.id,
      }),
    ]);
    setSelectedId(topic.id); setName(topic.name); setDescription(topic.description); setStatus(topic.status);
    setAssignments(assignmentResult.assignments); setRelated(relatedResult);
    setPracticeScenarios(scenarioResult); setEditingScenarioId(null);
  });

  const createTopic = () => void run(async () => {
    const created = await action<TopicRow>({ action: "create_topic", orgId, name, description, status: "draft" });
    setTopics((current) => [...current, created]); setSelectedId(created.id); setStatus("draft");
    setAssignments([]); setRelated(null); setMessage("Focus Topic created as a draft.");
    setPracticeScenarios(null);
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
      subjectUserId: targeted ? subjectUserId : null,
    });
    setAssignments((current) => [...current, created]); setSubjectUserId("");
    setMessage("Learner assignment created.");
  });
  const createManagementGrant = () => void run(async () => {
    if (!selected) return;
    const subject = users.find((user) => user.userId === managementSubjectUserId);
    if (!subject) return;
    const created = await action<DashboardFocusTopicAssignment>({
      action: "create_management_grant", orgId, topicId: selected.id,
      audience: subject.orgRole === "user_admin" ? "individual" : "manager_only",
      subjectUserId: subject.userId,
    });
    setAssignments((current) => [...current, created]); setManagementSubjectUserId("");
    setMessage("Topic management grant created.");
  });
  const revokeAssignment = (assignmentId: string, management: boolean) => void run(async () => {
    if (!selected) return;
    const revoked = management
      ? await action<DashboardFocusTopicAssignment>({
          action: "revoke_management_grant", orgId, topicId: selected.id, assignmentId,
        })
      : await action<DashboardFocusTopicAssignment>({
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
  const refreshRelatedContent = async () => {
    if (!selected) return null;
    const next = await action<DashboardFocusTopicRelatedContentResponse>({
      action: "list_related_content", orgId, topicId: selected.id,
    });
    setRelated(next);
    return next;
  };
  const uploadAsset = async (
    item: DashboardFocusTopicContentItem,
    file: File,
    replacementAssetId?: string | null,
  ) => {
    if (!selected || !related) return;
    const contentType = contentTypeForFile(file);
    if (!contentType || contentType !== item.contentType) {
      throw new Error("The selected file must match this Learning Resource type.");
    }
    const fileError = validateTrainingContentFileSelection({
      contentType, file, limits: related.fileLimitsBytes,
    });
    if (fileError) throw new Error(fileError);
    const initiated = await action<DashboardTrainingContentUploadInitiationResponse>({
      action: "initiate_content_upload",
      orgId,
      topicId: selected.id,
      contentId: item.id,
      assetRole: "primary",
      originalFilename: file.name,
      declaredMimeType: trainingContentDeclaredMimeType(contentType, file),
      declaredByteSize: file.size,
      replacementAssetId: replacementAssetId ?? null,
    });
    await directUploadTrainingContentAsset(initiated.upload, file, setUploadProgress);
    await action<DashboardTrainingContentAssetFinalizationResponse>({
      action: "finalize_content_upload",
      orgId,
      topicId: selected.id,
      contentId: item.id,
      assetId: initiated.asset.id,
    });
  };
  const createAndUploadContent = () => void run(async () => {
    if (!selected || !uploadFile) return;
    const contentType = contentTypeForFile(uploadFile);
    if (!contentType) throw new Error("Choose an MP4 video, audio, PDF, DOCX, or image file.");
    if (!related) return;
    const fileError = validateTrainingContentFileSelection({
      contentType, file: uploadFile, limits: related.fileLimitsBytes,
    });
    if (fileError) throw new Error(fileError);
    setUploadProgress(0);
    const created = await action<DashboardFocusTopicContentCreateResponse>({
      action: "create_content",
      orgId,
      topicId: selected.id,
      contentType,
      title: uploadTitle,
      description: uploadDescription,
    });
    setRelated((current) => current ? {
      ...current,
      content: [...current.content, created.attachment],
      contentItems: [...current.contentItems, created.item],
    } : current);
    await uploadAsset(created.item, uploadFile);
    await refreshRelatedContent();
    setUploadTitle(""); setUploadDescription(""); setUploadFile(null); setUploadProgress(null);
    setMessage("Draft Learning Resource uploaded and attached to this Focus Topic.");
  });
  const beginEditingContent = (item: DashboardFocusTopicContentItem) => {
    setEditingContentId(item.id);
    setEditingTitle(item.title);
    setEditingDescription(item.description);
    setReplacementFile(null);
  };
  const createYouTubeContent = () => void run(async () => {
    if (!selected) return;
    await action<DashboardFocusTopicContentCreateResponse>({
      action: "create_content", orgId, topicId: selected.id,
      contentType: "external_url", externalKind: "youtube", externalUrl: youtubeUrl,
      title: uploadTitle, description: uploadDescription,
    });
    await refreshRelatedContent();
    setUploadTitle(""); setUploadDescription(""); setYoutubeUrl("");
    setMessage("Draft YouTube Learning Resource created and attached to this Focus Topic.");
  });
  const reviewTranscript = (item: DashboardFocusTopicContentItem) => void run(async () => {
    if (!selected) return;
    const result = await action<{ transcript: null | { text: string } }>({
      action: "get_content_transcript", orgId, topicId: selected.id, contentId: item.id,
    });
    setTranscriptContentId(item.id); setTranscriptText(result.transcript?.text ?? "");
  });
  const saveTranscript = (item: DashboardFocusTopicContentItem) => void run(async () => {
    if (!selected) return;
    await action({ action: "put_content_transcript", orgId, topicId: selected.id,
      contentId: item.id, text: transcriptText });
    await refreshRelatedContent();
    setMessage(item.transcript.status === "ready" ? "Transcript replaced." : "Transcript added.");
  });
  const removeTranscript = (item: DashboardFocusTopicContentItem) => void run(async () => {
    if (!selected) return;
    await action({ action: "remove_content_transcript", orgId, topicId: selected.id, contentId: item.id });
    await refreshRelatedContent(); setTranscriptContentId(null); setTranscriptText("");
    setMessage("Transcript removed. Learner publication is unchanged.");
  });
  const saveContent = (item: DashboardFocusTopicContentItem) => void run(async () => {
    if (!selected) return;
    await action<DashboardFocusTopicContentMutationResponse>({
      action: "update_content", orgId, topicId: selected.id, contentId: item.id,
      expectedUpdatedAt: item.updatedAt, title: editingTitle, description: editingDescription,
    });
    if (replacementFile) {
      setUploadProgress(0);
      await uploadAsset(item, replacementFile, item.currentAsset?.id ?? null);
    }
    await refreshRelatedContent();
    setEditingContentId(null); setReplacementFile(null); setUploadProgress(null);
    setMessage("Learning Resource updated.");
  });
  const transitionContent = (
    item: DashboardFocusTopicContentItem,
    next: "publish_content" | "unpublish_content",
  ) => void run(async () => {
    if (!selected) return;
    await action<DashboardFocusTopicContentMutationResponse>({
      action: next, orgId, topicId: selected.id, contentId: item.id,
      expectedUpdatedAt: item.updatedAt,
    });
    await refreshRelatedContent();
    setMessage(next === "publish_content" ? "Learning Resource published." : "Learning Resource returned to draft.");
  });

  const resetScenarioForm = () => {
    setEditingScenarioId(null); setScenarioTitle(""); setScenarioDescription("");
    setScenarioDesiredOutcome(""); setScenarioAiRole(""); setScenarioScoringGuidance("");
    setScenarioSegmentId(""); setScenarioIndustryIds([]); setScenarioSourceLabel("");
    setScenarioSourceReferenceId("");
  };
  const beginScenarioRevision = (scenario: CustomerPracticeScenario) => {
    const version = scenario.currentVersion;
    setEditingScenarioId(scenario.id); setScenarioTitle(version.title);
    setScenarioDescription(version.description); setScenarioDesiredOutcome(version.desiredOutcome ?? "");
    setScenarioAiRole(version.aiRole); setScenarioScoringGuidance(version.scoringGuidance);
    setScenarioSegmentId(version.segmentId); setScenarioIndustryIds(version.applicableIndustryIds);
    const firstSource = version.sourceReferences[0];
    setScenarioSourceLabel(firstSource?.label ?? "");
    setScenarioSourceReferenceId(firstSource?.referenceId ?? "");
  };
  const saveScenarioDraft = () => void run(async () => {
    if (!selected || !practiceScenarios) return;
    const payload = {
      action: editingScenarioId ? "revise_practice_scenario" : "create_practice_scenario",
      orgId, topicId: selected.id,
      ...(editingScenarioId ? { scenarioId: editingScenarioId } : {}),
      title: scenarioTitle, description: scenarioDescription,
      desiredOutcome: scenarioDesiredOutcome || null,
      aiRole: scenarioAiRole, scoringGuidance: scenarioScoringGuidance,
      segmentId: scenarioSegmentId, applicableIndustryIds: scenarioIndustryIds,
      sourceReferences: scenarioSourceLabel.trim() ? [{
        kind: "manual", referenceId: scenarioSourceReferenceId.trim() || null,
        label: scenarioSourceLabel.trim(),
      }] : [],
    };
    const saved = await action<CustomerPracticeScenario>(payload);
    setPracticeScenarios({
      ...practiceScenarios,
      scenarios: editingScenarioId
        ? practiceScenarios.scenarios.map((row) => row.id === saved.id ? saved : row)
        : [saved, ...practiceScenarios.scenarios],
      editableScenarioIds: practiceScenarios.editableScenarioIds.includes(saved.id)
        ? practiceScenarios.editableScenarioIds
        : [...practiceScenarios.editableScenarioIds, saved.id],
    });
    resetScenarioForm();
    setMessage(editingScenarioId ? "New Practice Scenario revision created." : "Practice Scenario draft created.");
  });
  const transitionScenario = (
    scenario: CustomerPracticeScenario,
    next: "submit" | "approve" | "reject" | "publish" | "archive",
  ) => void run(async () => {
    if (!selected || !practiceScenarios) return;
    const updated = await action<CustomerPracticeScenario>({
      action: `${next}_practice_scenario`, orgId, topicId: selected.id, scenarioId: scenario.id,
    });
    setPracticeScenarios({
      ...practiceScenarios,
      scenarios: practiceScenarios.scenarios.map((row) => row.id === updated.id ? updated : row),
    });
    setMessage(`Practice Scenario ${next === "submit" ? "submitted"
      : next === "approve" ? "approved"
      : next === "reject" ? "rejected"
      : next === "publish" ? "published" : "archived"}.`);
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
          else { setSelectedId(null); setName(""); setDescription(""); setAssignments([]);
            setRelated(null); setPracticeScenarios(null); resetScenarioForm(); }
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
        <p className="muted-copy">Grant management of this Topic to an eligible User Admin or current Manager. Learner access is assigned separately.</p>
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

    {selected ? <div className="focus-topic-admin-panel" aria-labelledby="focus-topic-practice-heading">
      <div className="focus-topic-panel-heading"><div><p className="eyebrow">Practice Scenarios</p>
        <h3 id="focus-topic-practice-heading">Practice Scenarios</h3>
        <p className="muted-copy">Create reviewable scenario versions for this Topic. Learners receive only an explicitly published approved version.</p>
      </div></div>
      {practiceScenarios && !practiceScenarios.permissions.creationEnabled
        ? <div className="notice" role="status">Customer Practice Scenario creation is not enabled for this organization. Existing scenarios remain visible.</div>
        : null}
      <div className="focus-topic-assignment-section"><h4>Topic scenarios</h4>
        {!practiceScenarios ? <p className="muted-copy">Select this Topic to load Practice Scenarios.</p> : null}
        {practiceScenarios?.scenarios.length === 0
          ? <p className="muted-copy">No customer Practice Scenarios have been created for this Topic.</p> : null}
        <div className="focus-topic-assignment-list">{practiceScenarios?.scenarios.map((scenario) => {
          const version = scenario.currentVersion;
          const editable = practiceScenarios.editableScenarioIds.includes(scenario.id)
            && practiceScenarios.permissions.canAuthor && scenario.status !== "archived";
          return <div key={scenario.id} className="focus-topic-assignment-row">
            <div className="training-content-order-copy">
              <div className="focus-topic-assignment-title"><strong>{version.title}</strong>
                <span className={`status-badge${scenario.status === "published" ? " status-active" : ""}`}>
                  {scenario.status.replaceAll("_", " ")}
                </span>
              </div>
              <small>Version {version.versionNumber} · {version.segmentId}</small>
              <small>{version.description}</small>
              <small>{version.applicableIndustryIds.length} applicable {version.applicableIndustryIds.length === 1 ? "industry" : "industries"}</small>
              {version.sourceReferences.length > 0
                ? <small>Source reference: {version.sourceReferences.map((source) => source.label).join(" · ")}</small>
                : <small>Source reference: Manual authoring</small>}
              {scenario.publishedVersion && scenario.publishedVersion.id !== version.id
                ? <small>Published learner version: {scenario.publishedVersion.versionNumber}</small> : null}
            </div>
            {editable && scenario.status !== "in_review"
              ? <button type="button" className="ghost-button compact-button" disabled={busy}
                onClick={() => beginScenarioRevision(scenario)}>Edit / New Revision</button> : null}
            {editable && (scenario.status === "draft" || scenario.status === "rejected")
              ? <button type="button" className="primary-button compact-button" disabled={busy}
                onClick={() => transitionScenario(scenario, "submit")}>
                {practiceScenarios.permissions.approvalRequired ? "Submit for Review" : "Approve Draft"}
              </button> : null}
            {practiceScenarios.permissions.canReviewAndPublish && scenario.status === "in_review" ? <>
              <button type="button" className="primary-button compact-button" disabled={busy}
                onClick={() => transitionScenario(scenario, "approve")}>Approve</button>
              <button type="button" className="ghost-button danger-button compact-button" disabled={busy}
                onClick={() => transitionScenario(scenario, "reject")}>Reject</button>
            </> : null}
            {practiceScenarios.permissions.canReviewAndPublish && scenario.status === "approved"
              ? <button type="button" className="primary-button compact-button" disabled={busy}
                onClick={() => transitionScenario(scenario, "publish")}>Publish Approved Version</button> : null}
            {practiceScenarios.permissions.canReviewAndPublish && scenario.status !== "archived"
              ? <button type="button" className="ghost-button danger-button compact-button" disabled={busy}
                onClick={() => transitionScenario(scenario, "archive")}>Archive</button> : null}
          </div>;
        })}</div>
      </div>
      {practiceScenarios?.permissions.canAuthor && selected.status !== "archived"
        ? <div className="focus-topic-assignment-section focus-topic-upload-new">
          <h4>{editingScenarioId ? "Create New Revision" : "Create Draft"}</h4>
          <p className="muted-copy">Content saves as a new immutable version. Submission and publication are separate actions.</p>
          <div className="focus-topic-details-grid">
            <label className="focus-topic-field focus-topic-field-wide">Title
              <input className="text-input" value={scenarioTitle} maxLength={300}
                onChange={(event) => setScenarioTitle(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">Scenario context
              <textarea className="text-input" value={scenarioDescription} maxLength={12000}
                onChange={(event) => setScenarioDescription(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">Desired outcome
              <textarea className="text-input" value={scenarioDesiredOutcome} maxLength={4000}
                onChange={(event) => setScenarioDesiredOutcome(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">AI counterpart role
              <textarea className="text-input" value={scenarioAiRole} maxLength={2000}
                onChange={(event) => setScenarioAiRole(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">Scoring guidance
              <textarea className="text-input" value={scenarioScoringGuidance} maxLength={8000}
                onChange={(event) => setScenarioScoringGuidance(event.target.value)} /></label>
            <label className="focus-topic-field">Role
              <select className="text-input" value={scenarioSegmentId}
                onChange={(event) => setScenarioSegmentId(event.target.value)}>
                <option value="">Select a role</option>
                {practiceScenarios.roleOptions.map((option) =>
                  <option key={option.id} value={option.id}>{option.label}</option>)}
              </select></label>
            <fieldset className="focus-topic-field focus-topic-field-wide"><legend>Applicable industries</legend>
              <div className="focus-topic-content-mode">{practiceScenarios.industryOptions.map((option) =>
                <label key={option.id}><input type="checkbox" checked={scenarioIndustryIds.includes(option.id)}
                  onChange={(event) => setScenarioIndustryIds((current) => event.target.checked
                    ? [...new Set([...current, option.id])]
                    : current.filter((id) => id !== option.id))} /> {option.label}</label>)}</div>
            </fieldset>
            <label className="focus-topic-field">Source label (optional)
              <input className="text-input" value={scenarioSourceLabel} maxLength={500}
                onChange={(event) => setScenarioSourceLabel(event.target.value)} /></label>
            <label className="focus-topic-field">Source reference (optional)
              <input className="text-input" value={scenarioSourceReferenceId} maxLength={300}
                onChange={(event) => setScenarioSourceReferenceId(event.target.value)} /></label>
          </div>
          <div className="focus-topic-actions">
            <button type="button" className="primary-button" disabled={busy || !scenarioTitle.trim()
              || !scenarioDescription.trim() || !scenarioAiRole.trim() || !scenarioScoringGuidance.trim()
              || !scenarioSegmentId || scenarioIndustryIds.length === 0}
              onClick={saveScenarioDraft}>{editingScenarioId ? "Save New Revision" : "Create Draft"}</button>
            {editingScenarioId ? <button type="button" className="ghost-button" disabled={busy}
              onClick={resetScenarioForm}>Cancel Revision</button> : null}
          </div>
        </div> : null}
    </div> : null}

    {selected ? <div className="focus-topic-admin-panel" aria-labelledby="focus-topic-related-heading">
      <div className="focus-topic-panel-heading"><div><p className="eyebrow">Learning Resources</p>
        <h3 id="focus-topic-related-heading">Related Content</h3>
        <p className="muted-copy">Attach an existing organization resource or upload a new draft for this Topic.</p>
      </div></div>
      {!learningResourcesEnabled || related?.permissions.learningResourcesEnabled === false
        ? <div className="notice" role="status">Learning Resources are not enabled for this organization. Related Content is read-only.</div>
        : null}
      <div className="focus-topic-assignment-section"><h4>Attached Content</h4>
        {attachedContent.length === 0 ? <p className="muted-copy">No Learning Resources are attached.</p> : null}
        <div className="focus-topic-assignment-list">{attachedContent.map(({ attachment, item }) =>
          <div key={attachment.id} className="focus-topic-assignment-row">
            <div className="training-content-order-copy"><div className="focus-topic-assignment-title">
              <strong>{item?.title ?? "Unavailable Learning Resource"}</strong>
              {item ? <span className={`status-badge${item.publicationState === "published" ? " status-active" : ""}`}>
                {item.publicationState === "published" ? "Published" : "Draft"}
              </span> : null}
            </div>
              <small>{item
                ? `${item.contentType} · ${item.publicationState}${item.archivedAt ? " · archived" : ""}`
                : attachment.contentId}</small>
              <small>Attached {formatDateTime(attachment.attachedAt)}</small>
              {item && !item.canMutate ? <small>{item.mutationRestriction}</small> : null}
              {item ? <small>Generation source: {item.generationSource.eligible
                ? "Ready" : item.generationSource.reasonCode.replaceAll("_", " ")}</small> : null}
              {item && (item.contentType === "video" || item.externalKind === "youtube")
                ? <div className="focus-topic-transcript-panel">
                  <div><strong>Transcript</strong><small>{item.transcript.status === "ready"
                    ? `${item.transcript.characterCount?.toLocaleString() ?? 0} characters · Ready`
                    : "Not provided"}</small></div>
                  <small>A transcript is required before this resource can be used to generate practice scenarios.</small>
                  {item.transcript.canRead && (item.transcript.status === "ready" || item.transcript.canMutate)
                    ? <button type="button" className="ghost-button compact-button"
                    disabled={busy} onClick={() => reviewTranscript(item)}>
                    {item.transcript.status === "ready" ? "Review Transcript" : "Add Transcript"}
                  </button> : null}
                  {transcriptContentId === item.id ? <div className="focus-topic-transcript-editor">
                    <label>Private customer transcript<textarea className="text-input" value={transcriptText}
                      maxLength={200000} readOnly={!item.transcript.canMutate}
                      onChange={(event) => setTranscriptText(event.target.value)} /></label>
                    {item.transcript.canMutate ? <div className="focus-topic-actions">
                      <button type="button" className="primary-button compact-button"
                        disabled={busy || !transcriptText.trim()} onClick={() => saveTranscript(item)}>
                        {item.transcript.status === "ready" ? "Replace Transcript" : "Add Transcript"}
                      </button>
                      {item.transcript.status === "ready" ? <button type="button"
                        className="ghost-button danger-button compact-button" disabled={busy}
                        onClick={() => removeTranscript(item)}>Remove Transcript</button> : null}
                    </div> : <small>{item.mutationRestriction}</small>}
                    <button type="button" className="ghost-button compact-button" disabled={busy}
                      onClick={() => { setTranscriptContentId(null); setTranscriptText(""); }}>Close</button>
                  </div> : null}
                </div> : null}
              {item && editingContentId === item.id ? <div className="focus-topic-content-editor">
                <label>Title<input className="text-input" value={editingTitle} maxLength={200}
                  onChange={(event) => setEditingTitle(event.target.value)} /></label>
                <label>Description<textarea className="text-input" value={editingDescription} maxLength={2000}
                  onChange={(event) => setEditingDescription(event.target.value)} /></label>
                {item.contentType !== "external_url" ? <label>Replace file (optional)
                  <input type="file" accept="video/mp4,audio/*,image/*,.pdf,.docx"
                    onChange={(event) => setReplacementFile(event.target.files?.[0] ?? null)} />
                </label> : null}
                {uploadProgress !== null ? <small role="status">Uploading: {uploadProgress}%</small> : null}
                <div className="focus-topic-actions"><button type="button" className="primary-button compact-button"
                  disabled={busy || !editingTitle.trim()} onClick={() => saveContent(item)}>Save</button>
                  <button type="button" className="ghost-button compact-button" disabled={busy}
                    onClick={() => setEditingContentId(null)}>Cancel</button></div>
              </div> : null}
            </div>
            {item?.canMutate && editingContentId !== item.id ? <>
              <button type="button" className="ghost-button compact-button" disabled={busy}
                onClick={() => beginEditingContent(item)}>Edit</button>
              <button type="button" className="ghost-button compact-button" disabled={busy}
                onClick={() => transitionContent(item, item.publicationState === "published"
                  ? "unpublish_content" : "publish_content")}>
                {item.publicationState === "published" ? "Unpublish" : "Publish"}
              </button>
            </> : null}
            {related?.permissions.canManageRelatedContent ? <button type="button"
              className="ghost-button danger-button compact-button" disabled={busy}
              onClick={() => detachContent(attachment.id)}>Detach</button> : null}
          </div>)}</div>
      </div>
      {related?.permissions.canManageRelatedContent ? <div className="focus-topic-content-mode" role="group"
        aria-label="Add Content">
        <button type="button" className={contentMode === "attach" ? "primary-button" : "ghost-button"}
          disabled={busy} onClick={() => setContentMode("attach")}>Attach Existing</button>
        <button type="button" className={contentMode === "upload" ? "primary-button" : "ghost-button"}
          disabled={busy} onClick={() => setContentMode("upload")}>Upload New</button>
      </div> : null}
      {contentMode === "attach" ? <div className="focus-topic-assignment-section"><h4>Available Content</h4>
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
      </div> : null}
      {contentMode === "upload" && related?.permissions.canManageRelatedContent
        ? <div className="focus-topic-assignment-section focus-topic-upload-new"><h4>Upload New</h4>
          <p className="muted-copy">The new organization resource starts as a draft and is attached here automatically.</p>
          <div className="focus-topic-content-mode" role="group" aria-label="New resource source">
            <button type="button" className={newSourceMode === "file" ? "primary-button" : "ghost-button"}
              disabled={busy} onClick={() => setNewSourceMode("file")}>Upload File</button>
            <button type="button" className={newSourceMode === "youtube" ? "primary-button" : "ghost-button"}
              disabled={busy} onClick={() => setNewSourceMode("youtube")}>YouTube URL</button>
          </div>
          <div className="focus-topic-details-grid">
            <label className="focus-topic-field">Title<input className="text-input" value={uploadTitle} maxLength={200}
              onChange={(event) => setUploadTitle(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">Description<textarea className="text-input"
              value={uploadDescription} maxLength={2000}
              onChange={(event) => setUploadDescription(event.target.value)} /></label>
            {newSourceMode === "file" ? <label className="focus-topic-field focus-topic-field-wide">File
              <input type="file" accept="video/mp4,audio/*,image/*,.pdf,.docx"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label>
              : <label className="focus-topic-field focus-topic-field-wide">Public YouTube URL
                <input className="text-input" type="url" placeholder="https://www.youtube.com/watch?v=…"
                  value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} />
                <small>Peritio stores the canonical public URL and never fetches captions automatically.</small>
              </label>}
          </div>
          {uploadProgress !== null ? <p className="muted-copy" role="status">Uploading: {uploadProgress}%</p> : null}
          <button type="button" className="primary-button"
            disabled={busy || !uploadTitle.trim() || (newSourceMode === "file" ? !uploadFile : !youtubeUrl.trim())}
            onClick={newSourceMode === "file" ? createAndUploadContent : createYouTubeContent}>
            {newSourceMode === "file" ? "Create Draft & Upload" : "Create Draft YouTube Resource"}
          </button>
        </div> : null}
    </div> : null}
  </section>;
}
