"use client";

import { ChevronDown, ChevronUp, CircleHelp, LoaderCircle } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type {
  CustomerPracticeScenario,
  CustomerPracticeScenarioGeneratedDraft,
  CustomerPracticeScenarioHistoryEvent,
  CustomerPracticeScenarioListResponse,
  CustomerPracticeScenarioVersion,
  DashboardAdminUserRow,
  DashboardTrainingContentAssetFinalizationResponse,
  DashboardTrainingContentUploadInitiationResponse,
  OrgTrainingSummary,
} from "@voicepractice/shared";

import { AdminApiClientError, fetchAdminApiJson } from "@/src/lib/adminApiClient";
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
import { editableScenarioIndustries, scenarioRolesForIndustries } from "./practiceScenarioIndustryOptions";

type TopicRow = Pick<OrgTrainingSummary, "id" | "name" | "description" | "status">;
type Audience = DashboardFocusTopicAssignment["audience"];
type ScenarioGroup = "active" | "archived";
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

function latestApplicableRejectionFeedback(scenario: CustomerPracticeScenario): CustomerPracticeScenarioHistoryEvent | null {
  if (scenario.status !== "rejected") return null;
  return [...scenario.history]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .find((event) => event.eventType === "rejected" && event.versionId === scenario.currentVersion.id) ?? null;
}

function scenarioProvenanceLabel(scenario: CustomerPracticeScenario, version: CustomerPracticeScenarioVersion): string {
  const origin = [...scenario.versions]
    .sort((left, right) => left.versionNumber - right.versionNumber)[0] ?? version;
  const baseLabel = origin.provenance.baseScenarioTitle
    ? ` based on ${origin.provenance.baseScenarioTitle}`
    : "";

  if (version.versionNumber > 1) {
    if (origin.provenance.creationMethod === "ai") return "Manual revision of an AI-generated scenario.";
    if (origin.provenance.sourceMode === "standard_base") return `Manual revision of a scenario${baseLabel}.`;
    return "Manual revision of a manually authored scenario.";
  }
  if (version.provenance.creationMethod === "ai") return "AI-generated draft from selected Related Content.";
  if (version.provenance.sourceMode === "standard_base") return `Manually authored from an existing scenario${baseLabel}.`;
  return "Manually authored from a blank draft.";
}

function FocusTopicWorkspaceSection({
  headingId,
  eyebrow,
  title,
  summary,
  description,
  defaultOpen = false,
  children,
}: {
  headingId: string;
  eyebrow: string;
  title: string;
  summary: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${headingId}-content`;

  return <section className="focus-topic-admin-panel" aria-labelledby={headingId}>
    <div className="focus-topic-panel-heading">
      <div className="focus-topic-section-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h3 id={headingId}>{title}</h3>
        <span className="focus-topic-section-summary">{summary}</span>
        <p className="muted-copy">{description}</p>
      </div>
      <button type="button" className="ghost-button compact-button focus-topic-section-toggle"
        aria-expanded={open} aria-controls={contentId}
        aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
        onClick={() => setOpen((current) => !current)}>
        <span>{open ? "Collapse" : "Expand"}</span>
        {open ? <ChevronUp aria-hidden="true" size={18} /> : <ChevronDown aria-hidden="true" size={18} />}
      </button>
    </div>
    <div id={contentId} className="focus-topic-panel-body" hidden={!open}>{children}</div>
  </section>;
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
  const [assignableLearners, setAssignableLearners] = useState<Array<{ userId: string; displayName: string; email: string }>>([]);
  const [assignableLearnersLoading, setAssignableLearnersLoading] = useState(false);
  const [assignableLearnersError, setAssignableLearnersError] = useState<string | null>(null);
  const [related, setRelated] = useState<DashboardFocusTopicRelatedContentResponse | null>(null);
  const [practiceScenarios, setPracticeScenarios] = useState<CustomerPracticeScenarioListResponse | null>(null);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [scenarioTitle, setScenarioTitle] = useState("");
  const [scenarioDescription, setScenarioDescription] = useState("");
  const [scenarioDesiredOutcome, setScenarioDesiredOutcome] = useState("");
  const [scenarioAiRole, setScenarioAiRole] = useState("");
  const [scenarioScoringGuidance, setScenarioScoringGuidance] = useState("");
  const [scenarioUseIndustryScoringOnly, setScenarioUseIndustryScoringOnly] = useState(false);
  const [scenarioSegmentId, setScenarioSegmentId] = useState("");
  const [scenarioIndustryIds, setScenarioIndustryIds] = useState<string[]>([]);
  const [scenarioSourceContentIds, setScenarioSourceContentIds] = useState<string[]>([]);
  const [scenarioPracticeGuidance, setScenarioPracticeGuidance] = useState("");
  const [generatedScenario, setGeneratedScenario] = useState<CustomerPracticeScenarioGeneratedDraft | null>(null);
  const [generatingScenario, setGeneratingScenario] = useState(false);
  const [scenarioReviewNotes, setScenarioReviewNotes] = useState<Record<string, string>>({});
  const [scenarioGroupOpenByTopic, setScenarioGroupOpenByTopic] = useState<Record<string, Record<ScenarioGroup, boolean>>>({});
  const [expandedScenarioIdsByTopic, setExpandedScenarioIdsByTopic] = useState<Record<string, string[]>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [audience, setAudience] = useState<Audience>("organization");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [managementSubjectUserId, setManagementSubjectUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<"attach" | "upload" | null>(null);
  const [availableContentSearch, setAvailableContentSearch] = useState("");
  const [availableContentVisibleCount, setAvailableContentVisibleCount] = useState(50);
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
  const scenarioGenerationInFlight = useRef(false);
  const selected = topics.find((topic) => topic.id === selectedId) ?? null;
  // Scoped Topic managers may create only individual learner assignments. Their
  // selector has one visible option, so derive the effective value rather than
  // retaining the initial organization-wide default in hidden component state.
  const assignmentAudience: Audience = canManageAllTopics ? audience : "individual";
  const targeted = ["manager_only", "manager_with_team", "individual"].includes(assignmentAudience);
  const subjectOptions = (canManageAllTopics ? users.filter((user) => user.status === "active"
    && (assignmentAudience === "individual" || user.assignedReportCount > 0))
    : assignableLearners.map((user) => ({ ...user, status: "active", assignedReportCount: 0 }))) as Array<{
      userId: string; displayName: string; email?: string; status: string; assignedReportCount: number;
    }>;
  const managerOptions = users.filter((user) => user.status === "active"
    && (user.orgRole === "user_admin" || user.assignedReportCount > 0));
  const userLabel = (id: string | null) => users.find((user) => user.userId === id)?.displayName
    ?? (id ? "Assigned organization member" : "All eligible members");
  const learnerRows = assignments.filter((row) => !row.grantsManagement);
  const managerRows = assignments.filter((row) => row.grantsManagement);
  const assignableLearnerIds = new Set(assignableLearners.map((user) => user.userId));
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
  const normalizedAvailableContentSearch = availableContentSearch.trim().toLocaleLowerCase();
  const matchingAvailableContent = normalizedAvailableContentSearch
    ? availableContent.filter((item) => [item.title, item.description, item.contentType]
      .some((value) => value.toLocaleLowerCase().includes(normalizedAvailableContentSearch)))
    : availableContent;
  const visibleAvailableContent = matchingAvailableContent.slice(0, availableContentVisibleCount);
  const scenarioSourceOptions = attachedContent.flatMap(({ item }) =>
    item && !item.archivedAt ? [item] : []);
  const eligibleScenarioSourceOptions = scenarioSourceOptions.filter((item) => item.generationSource.eligible);
  const orderedPracticeScenarios = [...(practiceScenarios?.scenarios ?? [])].sort((left, right) =>
    Number(right.status === "in_review") - Number(left.status === "in_review"));
  const activePracticeScenarios = orderedPracticeScenarios.filter((scenario) => scenario.status !== "archived");
  const archivedPracticeScenarios = orderedPracticeScenarios.filter((scenario) => scenario.status === "archived");
  const selectedScenarioGroupOpen = selected
    ? scenarioGroupOpenByTopic[selected.id] ?? { active: true, archived: false }
    : { active: true, archived: false };
  const expandedScenarioIds = new Set(selected ? expandedScenarioIdsByTopic[selected.id] ?? [] : []);
  const editingScenario = practiceScenarios?.scenarios.find((scenario) => scenario.id === editingScenarioId) ?? null;
  const editingRejectionFeedback = editingScenario ? latestApplicableRejectionFeedback(editingScenario) : null;

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Focus Topic action failed."); }
    finally { setBusy(false); }
  };

  const setScenarioGroupOpen = (group: ScenarioGroup, open: boolean) => {
    if (!selected) return;
    setScenarioGroupOpenByTopic((current) => ({
      ...current,
      [selected.id]: { active: current[selected.id]?.active ?? true, archived: current[selected.id]?.archived ?? false, [group]: open },
    }));
  };
  const toggleScenarioDisclosure = (scenarioId: string) => {
    if (!selected) return;
    setExpandedScenarioIdsByTopic((current) => {
      const expanded = current[selected.id] ?? [];
      return {
        ...current,
        [selected.id]: expanded.includes(scenarioId)
          ? expanded.filter((id) => id !== scenarioId)
          : [...expanded, scenarioId],
      };
    });
  };

  const loadAssignableLearners = async (topicId: string) => {
    if (canManageAllTopics) return;
    setAssignableLearnersLoading(true);
    setAssignableLearnersError(null);
    setAssignableLearners([]);
    try {
      const result = await action<{ learners: Array<{ userId: string; displayName: string; email: string }> }>({
        action: "list_assignable_learners", orgId, topicId,
      });
      setAssignableLearners(result.learners);
    } catch {
      setAssignableLearnersError("Eligible direct reports could not be loaded. Refresh the Topic and try again.");
    } finally {
      setAssignableLearnersLoading(false);
    }
  };

  const selectTopic = (topic: TopicRow) => void run(async () => {
    setContentMode(null); setAvailableContentSearch(""); setAvailableContentVisibleCount(50);
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
    void loadAssignableLearners(topic.id);
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
      action: "create_assignment", orgId, topicId: selected.id, audience: assignmentAudience,
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
    if (!selected) return;
    try {
      await action<DashboardFocusTopicContentAttachment>({
        action: "attach_content", orgId, topicId: selected.id, contentId,
      });
    } catch (caught) {
      if (!(caught instanceof AdminApiClientError) || caught.status !== 409) throw caught;
      await refreshRelatedContent();
      setMessage("Learning Resource is already attached. The current list was refreshed.");
      return;
    }
    await refreshRelatedContent();
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
    setScenarioUseIndustryScoringOnly(false);
    setScenarioSegmentId(""); setScenarioIndustryIds([]); setScenarioSourceContentIds([]);
    setScenarioPracticeGuidance(""); setGeneratedScenario(null);
  };
  const generateScenarioDraft = () => {
    if (scenarioGenerationInFlight.current || !selected || scenarioSourceContentIds.length === 0) return;
    scenarioGenerationInFlight.current = true;
    setGeneratingScenario(true);
    void run(async () => {
      const generated = await action<CustomerPracticeScenarioGeneratedDraft>({
        action: "generate_practice_scenario", orgId, topicId: selected.id,
        sourceContentIds: scenarioSourceContentIds, practiceGuidance: scenarioPracticeGuidance || null,
      });
      setEditingScenarioId(null); setScenarioTitle(generated.title); setScenarioDescription(generated.description);
      setScenarioDesiredOutcome(generated.desiredOutcome ?? ""); setScenarioAiRole(generated.aiRole);
      setScenarioScoringGuidance(generated.scoringGuidance); setScenarioUseIndustryScoringOnly(false);
      setScenarioSourceContentIds(generated.sourceContentIds); setGeneratedScenario(generated);
      setMessage("Generated a draft for review. Complete the remaining fields, then save it as a normal draft.");
    }).finally(() => {
      scenarioGenerationInFlight.current = false;
      setGeneratingScenario(false);
    });
  };
  const beginScenarioRevision = (scenario: CustomerPracticeScenario) => {
    setGeneratedScenario(null);
    const version = scenario.currentVersion;
    setEditingScenarioId(scenario.id); setScenarioTitle(version.title);
    setScenarioDescription(version.description); setScenarioDesiredOutcome(version.desiredOutcome ?? "");
    setScenarioAiRole(version.aiRole); setScenarioScoringGuidance(version.scoringGuidance);
    setScenarioUseIndustryScoringOnly(!version.scoringGuidance.trim());
    const editableIndustryIds = editableScenarioIndustries(version.applicableIndustryIds, practiceScenarios?.industryOptions ?? []);
    setScenarioIndustryIds(editableIndustryIds);
    const roleAvailable = scenarioRolesForIndustries(practiceScenarios?.roleOptions ?? [], editableIndustryIds)
      .some((role) => role.id === version.segmentId);
    setScenarioSegmentId(roleAvailable ? version.segmentId : "");
    if (editableIndustryIds.length !== version.applicableIndustryIds.length || !roleAvailable) {
      setMessage("Unavailable industries were removed from this editable revision. Choose currently available industries and a role before saving. The saved version is unchanged.");
    }
    setScenarioSourceContentIds(version.sourceReferences.flatMap((source) =>
      source.kind === "training_content" && source.referenceId ? [source.referenceId] : []));
  };
  const saveScenarioDraft = () => void run(async () => {
    if (!selected || !practiceScenarios) return;
    const payload = {
      action: editingScenarioId ? "revise_practice_scenario" : "create_practice_scenario",
      orgId, topicId: selected.id,
      ...(editingScenarioId ? { scenarioId: editingScenarioId } : {}),
      title: scenarioTitle, description: scenarioDescription,
      desiredOutcome: scenarioDesiredOutcome || null,
      aiRole: scenarioAiRole, scoringGuidance: scenarioUseIndustryScoringOnly ? "" : scenarioScoringGuidance,
      segmentId: scenarioSegmentId, applicableIndustryIds: scenarioIndustryIds,
      sourceContentIds: scenarioSourceContentIds,
      ...(generatedScenario ? { generationToken: generatedScenario.generationToken } : {}),
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
    reviewNote?: string,
  ) => void run(async () => {
    if (!selected || !practiceScenarios) return;
    const updated = await action<CustomerPracticeScenario>({
      action: `${next}_practice_scenario`, orgId, topicId: selected.id, scenarioId: scenario.id,
      ...(reviewNote?.trim() ? { reviewNote: reviewNote.trim() } : {}),
    });
    setScenarioReviewNotes((current) => ({ ...current, [scenario.id]: "" }));
    if (next === "archive") setScenarioGroupOpen("archived", true);
    setPracticeScenarios({
      ...practiceScenarios,
      scenarios: practiceScenarios.scenarios.map((row) => row.id === updated.id ? updated : row),
    });
    setMessage(`Practice Scenario ${next === "submit" ? "submitted"
      : next === "approve" ? "approved"
      : next === "reject" ? "rejected"
      : next === "publish" ? "published" : "archived"}.`);
  });

  const renderPracticeScenarioRows = (scenarios: CustomerPracticeScenario[]) => scenarios.map((scenario) => {
    if (!practiceScenarios) return null;
    const version = scenario.currentVersion;
    const editable = practiceScenarios.editableScenarioIds.includes(scenario.id)
      && practiceScenarios.permissions.canAuthor && scenario.status !== "archived";
    const rejectionFeedback = latestApplicableRejectionFeedback(scenario);
    const history = [...scenario.history]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const contentId = `focus-topic-scenario-${scenario.id}-content`;
    const open = expandedScenarioIds.has(scenario.id);
    const industryLabels = version.applicableIndustryIds.map((industryId) =>
      practiceScenarios.industryOptions.find((industry) => industry.id === industryId)?.label
        ?? `${industryId.replaceAll("_", " ")} (currently unavailable)`,
    );

    return <article key={scenario.id} className="focus-topic-scenario-card">
      <div className="focus-topic-scenario-row">
        <div className="focus-topic-scenario-row-copy">
          <div className="focus-topic-assignment-title"><strong>{version.title}</strong>
            <span className={`status-badge${scenario.status === "published" ? " status-active" : ""}`}>
              {scenario.status.replaceAll("_", " ")}
            </span>
          </div>
          <small>Version {version.versionNumber} · Updated {formatDateTime(scenario.updatedAt)}</small>
        </div>
        <button type="button" className="ghost-button compact-button focus-topic-scenario-toggle"
          aria-expanded={open} aria-controls={contentId}
          aria-label={`${open ? "Collapse" : "Expand"} ${version.title}`}
          onClick={() => toggleScenarioDisclosure(scenario.id)}>
          <span>{open ? "Collapse" : "Expand"}</span>
          {open ? <ChevronUp aria-hidden="true" size={18} /> : <ChevronDown aria-hidden="true" size={18} />}
        </button>
      </div>
      <div id={contentId} className="focus-topic-scenario-detail" hidden={!open}>
        <div className="focus-topic-scenario-detail-header">
          <div className="focus-topic-scenario-summary">
            <small>{industryLabels.length} applicable {industryLabels.length === 1 ? "industry" : "industries"}: {industryLabels.join(" · ")}</small>
            {scenario.publishedVersion && scenario.publishedVersion.id !== version.id
              ? <small>Published learner version: {scenario.publishedVersion.versionNumber}</small> : null}
          </div>
          <div className="focus-topic-scenario-actions" aria-label={`Actions for ${version.title}`}>
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
                onClick={() => transitionScenario(scenario, "approve", scenarioReviewNotes[scenario.id])}>Approve</button>
              <button type="button" className="ghost-button danger-button compact-button" disabled={busy}
                onClick={() => transitionScenario(scenario, "reject", scenarioReviewNotes[scenario.id])}>Reject</button>
            </> : null}
            {practiceScenarios.permissions.canReviewAndPublish && scenario.status === "approved"
              ? <button type="button" className="primary-button compact-button" disabled={busy}
                onClick={() => transitionScenario(scenario, "publish")}>Publish Approved Version</button> : null}
          </div>
        </div>
        <dl className="focus-topic-scenario-version-details">
          <div><dt>Scenario context</dt><dd>{version.description}</dd></div>
          <div><dt>Desired outcome</dt><dd>{version.desiredOutcome || "Not specified"}</dd></div>
          <div><dt>AI counterpart role</dt><dd>{version.aiRole}</dd></div>
          <div><dt>Scoring guidance</dt><dd className="focus-topic-scenario-scoring-guidance">
            {version.scoringGuidance || "Existing industry scoring only"}
          </dd></div>
        </dl>
        {version.sourceReferences.length > 0
          ? <p className="focus-topic-scenario-provenance">Related Content: {version.sourceReferences.map((source) => source.label).join(" · ")}</p>
          : <p className="focus-topic-scenario-provenance">No Related Content source selected.</p>}
        <p className="focus-topic-scenario-provenance">{scenarioProvenanceLabel(scenario, version)}</p>
        {rejectionFeedback ? <aside className="focus-topic-scenario-feedback" aria-label="Latest rejection feedback">
          <strong>Latest rejection feedback</strong>
          <small>Reviewer: {userLabel(rejectionFeedback.actorId)} · {formatDateTime(rejectionFeedback.createdAt)}</small>
          <p>{rejectionFeedback.comment || "No written feedback was provided."}</p>
        </aside> : null}
        {practiceScenarios.permissions.canReviewAndPublish && scenario.status === "in_review" ? <label
          className="focus-topic-field focus-topic-review-comment">Review comment (optional)
          <textarea className="text-input focus-topic-review-textarea" rows={3} maxLength={2000}
            value={scenarioReviewNotes[scenario.id] ?? ""}
            onChange={(event) => setScenarioReviewNotes((current) => ({
              ...current, [scenario.id]: event.target.value,
            }))} />
        </label> : null}
        <details className="focus-topic-scenario-history"><summary>Version and review history ({history.length})</summary>
          <div>{history.map((event) => <div key={event.id} className="focus-topic-scenario-history-event">
            <strong>{event.status.replaceAll("_", " ")}</strong>
            <small>Version {scenario.versions.find((candidate) => candidate.id === event.versionId)?.versionNumber ?? "?"}
              · {event.eventType.replaceAll("_", " ")} · {userLabel(event.actorId)} · {formatDateTime(event.createdAt)}</small>
            {event.comment ? <p>{event.comment}</p> : null}
          </div>)}</div>
        </details>
        {practiceScenarios.permissions.canReviewAndPublish && scenario.status !== "archived"
          ? <div className="focus-topic-scenario-archive-action"><button type="button"
            className="ghost-button danger-button compact-button" disabled={busy}
            onClick={() => transitionScenario(scenario, "archive")}>Archive</button></div> : null}
      </div>
    </article>;
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
      <small>{row.subjectDisplayName ?? userLabel(row.subjectUserId)}
        {row.subjectEmail ? ` (${row.subjectEmail})` : ""}</small>
      <small>Assigned {formatDateTime(row.createdAt)}
        {options.revoked ? ` · Revoked ${formatDateTime(row.revokedAt)}` : ""}</small>
    </div>
    {!options.revoked && (canManageAllTopics || (!options.management && assignableLearnerIds.has(row.subjectUserId ?? ""))) ? <button type="button"
      className="ghost-button danger-button compact-button" disabled={busy}
      onClick={() => revokeAssignment(row.id, options.management === true)}>Revoke</button> : null}
  </div>);

  return <section className="section-card focus-topic-admin" aria-label="Focus Topic administration" aria-busy={busy}>
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
            setRelated(null); setPracticeScenarios(null); setAssignableLearners([]); setAssignableLearnersError(null);
            setContentMode(null); setAvailableContentSearch(""); setAvailableContentVisibleCount(50); resetScenarioForm(); }
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
            rows={5} maxLength={4000} disabled={busy || !canManageAllTopics || selected?.status === "archived"}
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

    {selected ? <FocusTopicWorkspaceSection key={`${selected.id}-assignments`} headingId="focus-topic-assignments-heading" eyebrow="Learner access"
      title="Learner assignments"
      summary={`${learnerParts.activeAssignments.length} active · ${learnerParts.assignmentHistory.length} revoked`}
      description="Topic Managers can assign and revoke individual assignments for their current direct reports.">
      <div className="focus-topic-assignment-composer">
        <div className={`focus-topic-assignment-fields${targeted ? " targeted" : ""}`}>
          <div className="focus-topic-field"><label htmlFor="focus-topic-audience">Audience</label>
            <select className="text-input" id="focus-topic-audience" value={assignmentAudience}
              disabled={busy || selected.status === "archived" || !canManageAllTopics}
              onChange={(event) => { setAudience(event.target.value as Audience); setSubjectUserId(""); }}>
              {(canManageAllTopics ? AUDIENCES : AUDIENCES.filter((option) => option.value === "individual"))
                .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select><small>{AUDIENCES.find((option) => option.value === assignmentAudience)?.description}</small></div>
          {targeted ? <div className="focus-topic-field"><label htmlFor="focus-topic-subject">
            {assignmentAudience === "individual" ? "Learner" : "Manager"}</label>
            <select className="text-input" id="focus-topic-subject" value={subjectUserId}
              disabled={busy || selected.status === "archived" || assignableLearnersLoading || Boolean(assignableLearnersError)}
              onChange={(event) => setSubjectUserId(event.target.value)}>
              <option value="">{assignableLearnersLoading ? "Loading eligible direct reports..." : "Select an eligible learner"}</option>
              {subjectOptions.map((user) => <option key={user.userId} value={user.userId}>
                {user.displayName}{user.email ? ` (${user.email})` : ""}
              </option>)}
            </select>
            {!canManageAllTopics && assignableLearnersLoading ? <small role="status">Loading current eligible direct reports...</small> : null}
            {!canManageAllTopics && assignableLearnersError ? <small className="notice danger" role="alert">{assignableLearnersError}</small> : null}
            {!canManageAllTopics && !assignableLearnersLoading && !assignableLearnersError && subjectOptions.length === 0
              ? <small>No current eligible direct reports are available for this Topic.</small> : null}
          </div> : null}
        </div>
        <button type="button" className="primary-button focus-topic-add-assignment"
          disabled={busy || selected.status === "archived" || (targeted && !subjectUserId)}
          onClick={createAssignment}>Add Assignment</button>
      </div>
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
    </FocusTopicWorkspaceSection> : null}

    {selected && canManageAllTopics ? <FocusTopicWorkspaceSection key={`${selected.id}-managers`} headingId="focus-topic-managers-heading"
      eyebrow="Scoped administration" title="Topic managers"
      summary={`${managerParts.activeAssignments.length} active · ${managerParts.assignmentHistory.length} revoked`}
      description="Grant management of this Topic to an eligible User Admin or current Manager. Learner access is assigned separately.">
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
    </FocusTopicWorkspaceSection> : null}

    {selected ? <FocusTopicWorkspaceSection key={`${selected.id}-practice`} headingId="focus-topic-practice-heading" eyebrow="Practice Scenarios"
      title="Practice Scenarios"
      summary={`${orderedPracticeScenarios.length} scenarios · ${practiceScenarios?.scenarios.filter((scenario) => scenario.status === "in_review").length ?? 0} awaiting review`}
      description="Create reviewable scenario versions for this Topic. Learners receive only an explicitly published approved version.">
      {practiceScenarios && !practiceScenarios.permissions.creationEnabled
        ? <div className="notice" role="status">Customer Practice Scenario creation is not enabled for this organization. Existing scenarios remain visible.</div>
        : null}
      {practiceScenarios?.permissions.canReviewAndPublish ? <p className="muted-copy">
        Awaiting review: {practiceScenarios.scenarios.filter((scenario) => scenario.status === "in_review").length}
      </p> : null}
      <div className="focus-topic-scenario-groups">
        {!practiceScenarios ? <p className="muted-copy">Select this Topic to load Practice Scenarios.</p> : <>
          <section className="focus-topic-scenario-group" aria-labelledby={`focus-topic-${selected.id}-active-scenarios-heading`}>
            <div className="focus-topic-scenario-group-heading">
              <div><h4 id={`focus-topic-${selected.id}-active-scenarios-heading`}>Active Scenarios ({activePracticeScenarios.length})</h4>
                <p className="muted-copy">Draft, review, approved, rejected, and published scenarios.</p></div>
              <button type="button" className="ghost-button compact-button focus-topic-scenario-toggle"
                aria-expanded={selectedScenarioGroupOpen.active}
                aria-controls={`focus-topic-${selected.id}-active-scenarios-content`}
                aria-label={`${selectedScenarioGroupOpen.active ? "Collapse" : "Expand"} Active Scenarios`}
                onClick={() => setScenarioGroupOpen("active", !selectedScenarioGroupOpen.active)}>
                <span>{selectedScenarioGroupOpen.active ? "Collapse" : "Expand"}</span>
                {selectedScenarioGroupOpen.active ? <ChevronUp aria-hidden="true" size={18} /> : <ChevronDown aria-hidden="true" size={18} />}
              </button>
            </div>
            <div id={`focus-topic-${selected.id}-active-scenarios-content`} className="focus-topic-scenario-group-body"
              hidden={!selectedScenarioGroupOpen.active}>
              {activePracticeScenarios.length === 0
                ? <p className="muted-copy">No active Practice Scenarios. Archived scenarios remain available below.</p>
                : <div className="focus-topic-scenario-list">{renderPracticeScenarioRows(activePracticeScenarios)}</div>}
            </div>
          </section>
          <section className="focus-topic-scenario-group" aria-labelledby={`focus-topic-${selected.id}-archived-scenarios-heading`}>
            <div className="focus-topic-scenario-group-heading">
              <div><h4 id={`focus-topic-${selected.id}-archived-scenarios-heading`}>Archived Scenarios ({archivedPracticeScenarios.length})</h4>
                <p className="muted-copy">Archived scenarios are retained for review and history.</p></div>
              <button type="button" className="ghost-button compact-button focus-topic-scenario-toggle"
                aria-expanded={selectedScenarioGroupOpen.archived}
                aria-controls={`focus-topic-${selected.id}-archived-scenarios-content`}
                aria-label={`${selectedScenarioGroupOpen.archived ? "Collapse" : "Expand"} Archived Scenarios`}
                onClick={() => setScenarioGroupOpen("archived", !selectedScenarioGroupOpen.archived)}>
                <span>{selectedScenarioGroupOpen.archived ? "Collapse" : "Expand"}</span>
                {selectedScenarioGroupOpen.archived ? <ChevronUp aria-hidden="true" size={18} /> : <ChevronDown aria-hidden="true" size={18} />}
              </button>
            </div>
            <div id={`focus-topic-${selected.id}-archived-scenarios-content`} className="focus-topic-scenario-group-body"
              hidden={!selectedScenarioGroupOpen.archived}>
              {archivedPracticeScenarios.length === 0
                ? <p className="muted-copy">No archived Practice Scenarios.</p>
                : <div className="focus-topic-scenario-list">{renderPracticeScenarioRows(archivedPracticeScenarios)}</div>}
            </div>
          </section>
        </>}
      </div>
      {practiceScenarios?.permissions.canAuthor && selected.status !== "archived"
        ? <div className="focus-topic-assignment-section focus-topic-upload-new">
          <div className="focus-topic-scenario-generation-heading"><h4>Generate Scenario Draft</h4>
            <span className="focus-topic-generation-help">
              <button type="button" className="focus-topic-generation-help-button" aria-label="How scenario generation works"
                aria-describedby="focus-topic-generation-help-tooltip"><CircleHelp aria-hidden="true" size={18} /></button>
              <span id="focus-topic-generation-help-tooltip" role="tooltip" className="focus-topic-generation-tooltip">
                Choose one or more generation-ready sources and optionally add practice guidance. Generating creates one unsaved draft. Review and edit it, then save a version; your organization&apos;s review and publication workflow still applies. Nothing is published automatically.
              </span>
            </span>
          </div>
          <p className="muted-copy">Select one or more generation-ready Related Content resources. Generation creates no scenario until you review and save the draft below.</p>
          {practiceScenarios.industryOptions.length === 0 ? <div className="notice" role="status">
            No industries are currently available for this organization. An administrator must enable an organization industry before a scenario can be authored or published.
          </div> : null}
          <fieldset className="focus-topic-field focus-topic-field-wide focus-topic-scenario-option-group"><legend>Eligible Related Content sources</legend>
            <div className="scenario-option-list focus-topic-scenario-option-list">{eligibleScenarioSourceOptions.map((item) =>
              <label key={`generate-${item.id}`} className={`scenario-option-row focus-topic-scenario-option-row${scenarioSourceContentIds.includes(item.id) ? " is-selected" : ""}`}><input type="checkbox" checked={scenarioSourceContentIds.includes(item.id)}
                onChange={(event) => setScenarioSourceContentIds((current) => event.target.checked
                  ? [...new Set([...current, item.id])]
                  : current.filter((id) => id !== item.id))} /> <span>{item.title}</span></label>)}</div>
            {eligibleScenarioSourceOptions.length === 0 ? <small>No attached Related Content is currently generation-ready.</small> : null}
          </fieldset>
          <label className="focus-topic-field focus-topic-field-wide">Optional practice guidance
            <textarea className="text-input focus-topic-long-textarea" rows={4} maxLength={2000} value={scenarioPracticeGuidance}
              onChange={(event) => setScenarioPracticeGuidance(event.target.value)} /></label>
          <div className="focus-topic-actions"><button type="button" className="primary-button" disabled={busy || generatingScenario || scenarioSourceContentIds.length === 0 || practiceScenarios.industryOptions.length === 0}
            onClick={generateScenarioDraft}>
            {generatingScenario ? <><LoaderCircle aria-hidden="true" className="spin" size={18} /> Generating scenario…</> : "Generate Scenario"}
          </button></div>
          {generatingScenario ? <p className="focus-topic-generation-status" role="status" aria-live="polite">
            Generating a draft from the selected sources…
          </p> : null}
          {generatedScenario?.similarity.flagged ? <div className="notice" role="status">
            This draft is similar to an existing Topic scenario. Review it before saving.
          </div> : null}
          {editingRejectionFeedback ? <aside className="focus-topic-scenario-feedback" aria-label="Latest rejection feedback">
            <strong>Latest rejection feedback</strong>
            <small>Reviewer: {userLabel(editingRejectionFeedback.actorId)} - {formatDateTime(editingRejectionFeedback.createdAt)}</small>
            <p>{editingRejectionFeedback.comment || "No written feedback was provided."}</p>
          </aside> : null}
          <h4>{editingScenarioId ? "Create New Revision" : "Create Draft"}</h4>
          <p className="muted-copy">Content saves as a new immutable version. Submission and publication are separate actions.</p>
          <div className="focus-topic-details-grid">
            <label className="focus-topic-field focus-topic-field-wide">Title
              <input className="text-input" value={scenarioTitle} maxLength={300}
                onChange={(event) => setScenarioTitle(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">Scenario context
              <textarea className="text-input focus-topic-scenario-textarea" rows={8} value={scenarioDescription} maxLength={12000}
                onChange={(event) => setScenarioDescription(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">Desired outcome
              <textarea className="text-input focus-topic-long-textarea" rows={5} value={scenarioDesiredOutcome} maxLength={4000}
                onChange={(event) => setScenarioDesiredOutcome(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">AI counterpart role
              <textarea className="text-input focus-topic-long-textarea" rows={4} value={scenarioAiRole} maxLength={2000}
                onChange={(event) => setScenarioAiRole(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide">Scoring guidance
              <textarea className="text-input focus-topic-scenario-textarea" rows={8} value={scenarioScoringGuidance} maxLength={8000}
                disabled={scenarioUseIndustryScoringOnly} aria-describedby="focus-topic-scoring-mode-help"
                onChange={(event) => setScenarioScoringGuidance(event.target.value)} /></label>
            <label className="focus-topic-field focus-topic-field-wide focus-topic-scoring-mode">
              <span><input type="checkbox" checked={scenarioUseIndustryScoringOnly}
                onChange={(event) => setScenarioUseIndustryScoringOnly(event.target.checked)} /> Use existing industry scoring only</span>
              <small id="focus-topic-scoring-mode-help">{scenarioUseIndustryScoringOnly
                ? "This version will use the existing industry scoring framework without custom scenario criteria. Your unsaved guidance is retained if you switch back."
                : "Custom guidance supplements the existing industry scoring framework and remains editable."}</small>
            </label>
            <label className="focus-topic-field">Role
              <select className="text-input" value={scenarioSegmentId}
                onChange={(event) => setScenarioSegmentId(event.target.value)}>
                <option value="">Select a role</option>
                {scenarioRolesForIndustries(practiceScenarios.roleOptions, scenarioIndustryIds).map((option) =>
                  <option key={option.id} value={option.id}>{option.label}</option>)}
              </select></label>
            <fieldset className="focus-topic-field focus-topic-field-wide focus-topic-scenario-option-group"><legend>Applicable industries</legend>
              <div className="scenario-option-list focus-topic-scenario-option-list">{practiceScenarios.industryOptions.map((option) =>
                <label key={option.id} className={`scenario-option-row focus-topic-scenario-option-row${scenarioIndustryIds.includes(option.id) ? " is-selected" : ""}`}><input type="checkbox" checked={scenarioIndustryIds.includes(option.id)}
                  onChange={(event) => {
                    const next = event.target.checked ? [...new Set([...scenarioIndustryIds, option.id])]
                      : scenarioIndustryIds.filter((id) => id !== option.id);
                    setScenarioIndustryIds(next);
                    if (!scenarioRolesForIndustries(practiceScenarios.roleOptions, next).some((role) => role.id === scenarioSegmentId)) {
                      setScenarioSegmentId("");
                    }
                  }} /> <span>{option.label}</span></label>)}</div>
            </fieldset>
            <fieldset className="focus-topic-field focus-topic-field-wide focus-topic-scenario-option-group"><legend>Related Content sources (optional)</legend>
              <p className="muted-copy">Select resources currently attached to this Focus Topic. Manual scenarios do not require a source.</p>
              <div className="scenario-option-list focus-topic-scenario-option-list">{scenarioSourceOptions.map((item) =>
                <label key={item.id} className={`scenario-option-row focus-topic-scenario-option-row${scenarioSourceContentIds.includes(item.id) ? " is-selected" : ""}`}><input type="checkbox" checked={scenarioSourceContentIds.includes(item.id)}
                  onChange={(event) => setScenarioSourceContentIds((current) => event.target.checked
                    ? [...new Set([...current, item.id])]
                    : current.filter((id) => id !== item.id))} /> <span>{item.title}</span></label>)}</div>
              {scenarioSourceOptions.length === 0 ? <small>No current Related Content is available.</small> : null}
            </fieldset>
          </div>
          <div className="focus-topic-actions">
            <button type="button" className="primary-button" disabled={busy || !scenarioTitle.trim()
              || !scenarioDescription.trim() || !scenarioAiRole.trim()
              || (!scenarioUseIndustryScoringOnly && !scenarioScoringGuidance.trim())
              || !scenarioSegmentId || scenarioIndustryIds.length === 0}
              onClick={saveScenarioDraft}>{editingScenarioId ? "Save New Revision" : "Create Draft"}</button>
            {editingScenarioId ? <button type="button" className="ghost-button" disabled={busy}
              onClick={resetScenarioForm}>Cancel Revision</button> : null}
          </div>
        </div> : null}
    </FocusTopicWorkspaceSection> : null}

    {selected ? <FocusTopicWorkspaceSection key={`${selected.id}-related`} headingId="focus-topic-related-heading" eyebrow="Learning Resources"
      title="Related Content" summary={`${attachedContent.length} attached · ${availableContent.length} available`}
      description="Attach an existing organization resource or upload a new draft for this Topic.">
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
                    <label>Private customer transcript<textarea className="text-input focus-topic-transcript-input" rows={12} value={transcriptText}
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
                <label>Description<textarea className="text-input focus-topic-long-textarea" rows={5} value={editingDescription} maxLength={2000}
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
          disabled={busy} aria-expanded={contentMode === "attach"} aria-controls="focus-topic-available-content"
          aria-pressed={contentMode === "attach"}
          onClick={() => setContentMode((current) => current === "attach" ? null : "attach")}>Attach Existing</button>
        <button type="button" className={contentMode === "upload" ? "primary-button" : "ghost-button"}
          disabled={busy} aria-expanded={contentMode === "upload"} aria-controls="focus-topic-upload-content"
          aria-pressed={contentMode === "upload"}
          onClick={() => setContentMode((current) => current === "upload" ? null : "upload")}>Upload New</button>
      </div> : null}
      {contentMode === "attach" ? <div id="focus-topic-available-content" className="focus-topic-assignment-section"><h4>Available Content</h4>
        {availableContent.length === 0 ? <p className="muted-copy">No additional current Learning Resources are available.</p> : <>
          <label className="focus-topic-field" htmlFor="focus-topic-available-content-search">Search available Learning Resources
            <input className="text-input" id="focus-topic-available-content-search" type="search"
              value={availableContentSearch} placeholder="Search title, description, or type"
              onChange={(event) => { setAvailableContentSearch(event.target.value); setAvailableContentVisibleCount(50); }} />
          </label>
          {matchingAvailableContent.length === 0
            ? <p className="muted-copy">No available Learning Resources match this search.</p>
            : <p className="muted-copy">Showing {visibleAvailableContent.length} of {matchingAvailableContent.length} available Learning Resources.</p>}
        </>}
        <div className="focus-topic-assignment-list">{visibleAvailableContent.map((item) =>
          <div key={item.id} className="focus-topic-assignment-row">
            <div className="training-content-order-copy"><strong>{item.title}</strong>
              <small>{item.contentType} · {item.publicationState}</small>
              {item.description ? <small>{item.description}</small> : null}</div>
            {related?.permissions.canManageRelatedContent ? <button type="button"
              className="primary-button compact-button" disabled={busy}
              onClick={() => attachContent(item.id)}>Attach</button> : null}
          </div>)}</div>
        {visibleAvailableContent.length < matchingAvailableContent.length ? <button type="button"
          className="ghost-button compact-button" disabled={busy}
          onClick={() => setAvailableContentVisibleCount((count) => count + 50)}>Show More</button> : null}
      </div> : null}
      {contentMode === "upload" && related?.permissions.canManageRelatedContent
        ? <div id="focus-topic-upload-content" className="focus-topic-assignment-section focus-topic-upload-new"><h4>Upload New</h4>
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
            <label className="focus-topic-field focus-topic-field-wide">Description<textarea className="text-input focus-topic-long-textarea" rows={5}
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
    </FocusTopicWorkspaceSection> : null}
  </section>;
}
