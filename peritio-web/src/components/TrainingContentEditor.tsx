"use client";

import {
  Archive,
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Eye,
  FileUp,
  LoaderCircle,
  PenLine,
  RefreshCw,
  Search,
  Send,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  ChangeEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  DashboardTrainingContentAssetAccessResponse,
  DashboardTrainingContentAssetFinalizationResponse,
  DashboardTrainingContentCategory,
  DashboardTrainingContentDetail,
  DashboardTrainingContentDetailResponse,
  DashboardTrainingContentFocusTopic,
  DashboardTrainingContentScenarioOption,
  DashboardTrainingContentTarget,
  DashboardTrainingContentTargetsResponse,
  DashboardTrainingContentUploadInitiationResponse,
  TrainingContentFileLimitsBytes,
  UpdateDashboardTrainingContentAssignmentsRequest,
  UpdateDashboardTrainingContentRequest,
} from "@voicepractice/shared";

import { TrainingContentMarkdown } from "@/src/components/TrainingContentMarkdown";
import { TrainingContentScenarioSelector } from "@/src/components/TrainingContentScenarioSelector";
import { UnsavedChangesDialog } from "@/src/components/UnsavedChangesDialog";
import {
  formatTrainingContentVideoFailureCategory,
  pollTrainingContentVideoStatus,
  restoreTrainingContentVideoProcessingAsset,
  TRAINING_CONTENT_VIDEO_STATUS_POLL_MS,
  trainingContentVideoUploadIsBlocked,
} from "@/src/components/trainingContentVideoProcessingState";
import {
  AdminApiClientError,
  fetchAdminApiJson,
} from "@/src/lib/adminApiClient";
import { formatDateTime } from "@/src/lib/formatters";
import {
  formatFileSize,
  getTrainingContentFilePolicy,
  isUploadedTrainingContentType,
  mergeTrainingContentTargets,
  trainingContentDeclaredMimeType,
  trainingContentUploadFinalizationMessage,
  trainingContentStatusLabel,
  trainingContentTypeLabel,
  validateTrainingContentFileSelection,
} from "@/src/lib/trainingContentPresentation";
import {
  directUploadTrainingContentAsset,
  TrainingContentDirectUploadError,
} from "@/src/lib/trainingContentDirectUpload";
import {
  buildUpdateRelatedScenarioIdsField,
  createTrainingContentScenarioSelection,
  hasTrainingContentScenarioSelectionChanges,
  type TrainingContentScenarioSelectionItem,
} from "@/src/lib/trainingContentScenarioSelection";

interface ContentDraft {
  categoryId: string;
  title: string;
  description: string;
  focusTopicId: string;
  nativeBody: string;
  externalUrl: string;
}

interface AssignmentDraft {
  availableToEveryone: boolean;
  users: DashboardTrainingContentTarget[];
  managers: DashboardTrainingContentTarget[];
  managerTeams: DashboardTrainingContentTarget[];
}

function createDraft(item: DashboardTrainingContentDetail): ContentDraft {
  return {
    categoryId: item.categoryId,
    title: item.title,
    description: item.description,
    focusTopicId: item.focusTopicId ?? "",
    nativeBody: item.nativeBody ?? "",
    externalUrl: item.externalUrl ?? "",
  };
}

function createAssignmentDraft(item: DashboardTrainingContentDetail): AssignmentDraft {
  return {
    availableToEveryone: item.assignments.availableToEveryone,
    users: [...item.assignments.users],
    managers: [...item.assignments.managers],
    managerTeams: [...item.assignments.managerTeams],
  };
}

function ids(targets: readonly DashboardTrainingContentTarget[]): string[] {
  return targets.map((target) => target.userId).sort();
}

function sameIds(
  left: readonly DashboardTrainingContentTarget[],
  right: readonly DashboardTrainingContentTarget[]
): boolean {
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right));
}

function hasAssignmentChanges(
  item: DashboardTrainingContentDetail,
  assignments: AssignmentDraft
): boolean {
  return item.assignments.availableToEveryone !== assignments.availableToEveryone
    || !sameIds(item.assignments.users, assignments.users)
    || !sameIds(item.assignments.managers, assignments.managers)
    || !sameIds(item.assignments.managerTeams, assignments.managerTeams);
}

function buildMetadataPatch(
  item: DashboardTrainingContentDetail,
  draft: ContentDraft
): UpdateDashboardTrainingContentRequest {
  const patch: UpdateDashboardTrainingContentRequest = {
    expectedUpdatedAt: item.updatedAt,
  };
  if (draft.title !== item.title) {
    patch.title = draft.title;
  }
  if (draft.categoryId !== item.categoryId) {
    patch.categoryId = draft.categoryId;
  }
  if (draft.description !== item.description) {
    patch.description = draft.description;
  }
  if ((draft.focusTopicId || null) !== item.focusTopicId) {
    patch.focusTopicId = draft.focusTopicId || null;
  }
  if (item.contentType === "native" && draft.nativeBody !== (item.nativeBody ?? "")) {
    patch.nativeBody = draft.nativeBody || null;
  }
  if (item.contentType === "external_url" && draft.externalUrl !== (item.externalUrl ?? "")) {
    patch.externalUrl = draft.externalUrl || null;
  }
  return patch;
}

function hasMetadataChanges(
  item: DashboardTrainingContentDetail,
  draft: ContentDraft
): boolean {
  return Object.keys(buildMetadataPatch(item, draft)).length > 1;
}

function withOrg(pathname: string, orgId: string | null): string {
  if (!orgId) {
    return pathname;
  }
  const separator = pathname.includes("?") ? "&" : "?";
  return `${pathname}${separator}orgId=${encodeURIComponent(orgId)}`;
}

function errorDetails(error: unknown): string[] {
  if (!(error instanceof AdminApiClientError)) {
    return [];
  }
  const reasons = error.details?.reasons;
  if (!Array.isArray(reasons)) {
    return [];
  }
  const labels: Record<string, string> = {
    assignment_required: "Add at least one availability assignment.",
    native_body_required: "Add Native content before publishing.",
    https_url_required: "Add a valid HTTPS URL before publishing.",
    ready_asset_required: "Finish a valid file upload before publishing.",
  };
  return reasons
    .filter((reason): reason is string => typeof reason === "string")
    .map((reason) => labels[reason] ?? reason);
}

export function TrainingContentEditor({
  initialItem,
  categories,
  focusTopics,
  scenarioOptions,
  fileLimits,
  orgId,
}: {
  initialItem: DashboardTrainingContentDetail;
  categories: DashboardTrainingContentCategory[];
  focusTopics: DashboardTrainingContentFocusTopic[];
  scenarioOptions: DashboardTrainingContentScenarioOption[];
  fileLimits: TrainingContentFileLimitsBytes;
  orgId: string | null;
}) {
  const router = useRouter();
  const [item, setItem] = useState(initialItem);
  const [draft, setDraft] = useState(() => createDraft(initialItem));
  const [assignments, setAssignments] = useState(() => createAssignmentDraft(initialItem));
  const [relatedScenarios, setRelatedScenarios] = useState<
    TrainingContentScenarioSelectionItem[]
  >(() => createTrainingContentScenarioSelection(initialItem.relatedScenarios, scenarioOptions));
  const [nativeMode, setNativeMode] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [managerQuery, setManagerQuery] = useState("");
  const [userResults, setUserResults] = useState<DashboardTrainingContentTarget[]>([]);
  const [managerResults, setManagerResults] = useState<DashboardTrainingContentTarget[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchingManagers, setSearchingManagers] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingUpload, setPendingUpload] =
    useState<DashboardTrainingContentUploadInitiationResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [latestVideoUploadAsset, setLatestVideoUploadAsset] = useState(() =>
    restoreTrainingContentVideoProcessingAsset(initialItem)
  );

  const archived = item.publicationState === "archived";
  const dirty = hasMetadataChanges(item, draft)
    || hasAssignmentChanges(item, assignments)
    || hasTrainingContentScenarioSelectionChanges(item.relatedScenarios, relatedScenarios);
  const policy = getTrainingContentFilePolicy(item.contentType);
  const videoUploadBlocked = trainingContentVideoUploadIsBlocked(latestVideoUploadAsset);
  const listPath = `/app/admin/training-content${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const navigateAway = () => {
    if (dirty) {
      setPendingNavigation(listPath);
      return;
    }
    router.push(listPath);
  };

  useEffect(() => {
    if (userQuery.trim().length < 2) {
      setUserResults([]);
      setSearchingUsers(false);
      return;
    }
    const controller = new AbortController();
    setSearchingUsers(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchAdminApiJson<DashboardTrainingContentTargetsResponse>(
          withOrg(
            `/api/admin/training-content-targets/users?q=${encodeURIComponent(userQuery.trim())}`,
            orgId
          ),
          { signal: controller.signal }
        );
        setUserResults(response.targets);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Could not search users.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearchingUsers(false);
        }
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [orgId, userQuery]);

  useEffect(() => {
    const controller = new AbortController();
    setSearchingManagers(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchAdminApiJson<DashboardTrainingContentTargetsResponse>(
          withOrg(
            `/api/admin/training-content-targets/managers?q=${encodeURIComponent(managerQuery.trim())}`,
            orgId
          ),
          { signal: controller.signal }
        );
        setManagerResults(response.targets);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Could not search managers.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearchingManagers(false);
        }
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [managerQuery, orgId]);

  const managerChoices = useMemo(
    () => mergeTrainingContentTargets(
      mergeTrainingContentTargets(assignments.managers, assignments.managerTeams),
      managerResults
    ),
    [assignments.managerTeams, assignments.managers, managerResults]
  );

  const acceptItem = (next: DashboardTrainingContentDetail) => {
    setItem(next);
    setDraft(createDraft(next));
    setAssignments(createAssignmentDraft(next));
    setRelatedScenarios(createTrainingContentScenarioSelection(next.relatedScenarios, scenarioOptions));
    setLatestVideoUploadAsset(restoreTrainingContentVideoProcessingAsset(next));
    setConflict(false);
    setPreviewUrl(null);
  };

  useEffect(() => {
    if (!latestVideoUploadAsset || latestVideoUploadAsset.uploadState !== "processing") {
      return;
    }
    const controller = new AbortController();
    let timer: number | null = null;
    const schedule = () => {
      if (!controller.signal.aborted) {
        timer = window.setTimeout(poll, TRAINING_CONTENT_VIDEO_STATUS_POLL_MS);
      }
    };
    const poll = async () => {
      try {
        const { result, refreshedItem } = await pollTrainingContentVideoStatus({
          loadStatus: () =>
            fetchAdminApiJson<DashboardTrainingContentAssetFinalizationResponse>(
              withOrg(
                `/api/admin/training-content/${encodeURIComponent(item.id)}/assets/${encodeURIComponent(latestVideoUploadAsset.id)}`,
                orgId
              ),
              { signal: controller.signal }
            ),
          refreshReadyItem: async () => {
            const refreshed = await fetchAdminApiJson<DashboardTrainingContentDetailResponse>(
              withOrg(`/api/admin/training-content/${encodeURIComponent(item.id)}`, orgId),
              { signal: controller.signal }
            );
            return refreshed.item;
          },
        });
        if (controller.signal.aborted) {
          return;
        }
        if (result.action === "continue") {
          setLatestVideoUploadAsset(result.asset);
          schedule();
          return;
        }
        if (result.action === "ready") {
          setItem(refreshedItem!);
          setLatestVideoUploadAsset(null);
          setPreviewUrl(null);
          setError(null);
          setErrorItems([]);
          setMessage("Video processing complete. File is ready.");
          return;
        }
        if (result.action === "failed") {
          setLatestVideoUploadAsset(result.asset);
          setMessage(null);
          return;
        }
        setLatestVideoUploadAsset(null);
      } catch {
        schedule();
      }
    };
    schedule();
    return () => {
      controller.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [item.id, latestVideoUploadAsset?.id, latestVideoUploadAsset?.uploadState, orgId]);

  const handleError = (caught: unknown, fallback: string) => {
    const nextError = caught instanceof Error ? caught.message : fallback;
    setError(nextError);
    setErrorItems(errorDetails(caught));
    setConflict(
      caught instanceof AdminApiClientError
      && caught.code === "training_content_conflict"
    );
  };

  const saveChanges = async (): Promise<DashboardTrainingContentDetail> => {
    let next = item;
    const relatedScenarioIdsField = buildUpdateRelatedScenarioIdsField(
      item.relatedScenarios,
      relatedScenarios
    );
    if (hasMetadataChanges(item, draft) || relatedScenarioIdsField.relatedScenarioIds !== undefined) {
      const response = await fetchAdminApiJson<DashboardTrainingContentDetailResponse>(
        withOrg(`/api/admin/training-content/${encodeURIComponent(item.id)}`, orgId),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...buildMetadataPatch(item, draft),
            ...relatedScenarioIdsField,
          }),
        }
      );
      next = response.item;
      setItem(next);
      setDraft(createDraft(next));
      setConflict(false);
      setPreviewUrl(null);
    }
    if (hasAssignmentChanges(item, assignments)) {
      const input: UpdateDashboardTrainingContentAssignmentsRequest = {
        expectedUpdatedAt: next.updatedAt,
        availableToEveryone: assignments.availableToEveryone,
        userIds: ids(assignments.users),
        managerIds: ids(assignments.managers),
        managerTeamIds: ids(assignments.managerTeams),
      };
      const response = await fetchAdminApiJson<DashboardTrainingContentDetailResponse>(
        withOrg(
          `/api/admin/training-content/${encodeURIComponent(item.id)}/assignments`,
          orgId
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      next = response.item;
    }
    acceptItem(next);
    return next;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setErrorItems([]);
    setMessage(null);
    try {
      await saveChanges();
      setMessage(item.publicationState === "draft" ? "Draft saved." : "Changes saved.");
      router.refresh();
    } catch (caught) {
      handleError(caught, "Could not save Learning Resource.");
    } finally {
      setSaving(false);
    }
  };

  const transition = async (action: "publish" | "unpublish" | "archive") => {
    if (
      action === "unpublish"
      && !window.confirm("Unpublish this Learning Resource and return it to Draft?")
    ) {
      return;
    }
    if (
      action === "archive"
      && !window.confirm("Archive this Learning Resource? It will remain available in archived records.")
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setErrorItems([]);
    setMessage(null);
    try {
      const saved = await saveChanges();
      const response = await fetchAdminApiJson<DashboardTrainingContentDetailResponse>(
        withOrg(
          `/api/admin/training-content/${encodeURIComponent(item.id)}/${action}`,
          orgId
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedUpdatedAt: saved.updatedAt }),
        }
      );
      acceptItem(response.item);
      setMessage(
        action === "publish"
          ? "Learning Resource published."
          : action === "unpublish"
            ? "Learning Resource returned to Draft."
            : "Learning Resource archived."
      );
      router.refresh();
    } catch (caught) {
      handleError(caught, `Could not ${action} Learning Resource.`);
    } finally {
      setSaving(false);
    }
  };

  const reload = () => {
    router.refresh();
    window.location.reload();
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setPendingUpload(null);
    setUploadProgress(0);
    setMessage(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const validation = validateTrainingContentFileSelection({
      contentType: item.contentType,
      file,
      limits: fileLimits,
    });
    if (validation) {
      setSelectedFile(null);
      setError(validation);
      event.target.value = "";
      return;
    }
    setError(null);
    setSelectedFile(file);
  };

  const refreshItem = async () => {
    const response = await fetchAdminApiJson<DashboardTrainingContentDetailResponse>(
      withOrg(`/api/admin/training-content/${encodeURIComponent(item.id)}`, orgId)
    );
    acceptItem(response.item);
  };

  const uploadFile = async () => {
    if (videoUploadBlocked) {
      setError("A video upload is already processing.");
      return;
    }
    if (!selectedFile) {
      setError("Choose a file to upload.");
      return;
    }
    const replacing = Boolean(item.currentAsset);
    if (
      replacing
      && !pendingUpload
      && !window.confirm("Replace the current file after the new upload passes validation?")
    ) {
      return;
    }
    setUploading(true);
    setSaving(true);
    setError(null);
    setErrorItems([]);
    setMessage(null);
    try {
      await saveChanges();
      let initiated = pendingUpload;
      if (!initiated) {
        initiated = await fetchAdminApiJson<DashboardTrainingContentUploadInitiationResponse>(
          withOrg(
            `/api/admin/training-content/${encodeURIComponent(item.id)}/assets/uploads`,
            orgId
          ),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assetRole: "primary",
              originalFilename: selectedFile.name,
              declaredMimeType: trainingContentDeclaredMimeType(item.contentType, selectedFile),
              declaredByteSize: selectedFile.size,
              replacementAssetId: item.currentAsset?.id ?? null,
            }),
          }
        );
        setPendingUpload(initiated);
      }
      await directUploadTrainingContentAsset(
        initiated.upload,
        selectedFile,
        setUploadProgress
      );
      const finalized = await fetchAdminApiJson<DashboardTrainingContentAssetFinalizationResponse>(
        withOrg(
          `/api/admin/training-content/${encodeURIComponent(item.id)}/assets/${encodeURIComponent(initiated.asset.id)}/finalize`,
          orgId
        ),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      setLatestVideoUploadAsset(
        finalized.asset.uploadState === "processing" ? finalized.asset : null
      );
      await refreshItem();
      setPendingUpload(null);
      setSelectedFile(null);
      setUploadProgress(0);
      setMessage(trainingContentUploadFinalizationMessage({
        uploadState: finalized.asset.uploadState,
        replacing,
      }));
    } catch (caught) {
      if (
        (
          caught instanceof AdminApiClientError
          && caught.code === "training_content_upload_expired"
        )
        || (
          caught instanceof TrainingContentDirectUploadError
          && caught.status !== null
          && caught.status >= 400
          && caught.status < 500
        )
      ) {
        setPendingUpload(null);
      }
      handleError(caught, "Could not complete the upload.");
    } finally {
      setUploading(false);
      setSaving(false);
    }
  };

  const loadPreview = async () => {
    if (item.contentType === "external_url") {
      if (
        item.externalUrl
        && window.confirm("This resource opens outside Peritio. Continue?")
      ) {
        window.open(item.externalUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (!item.currentAsset) {
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const response = await fetchAdminApiJson<DashboardTrainingContentAssetAccessResponse>(
        withOrg(
          `/api/admin/training-content/${encodeURIComponent(item.id)}/assets/${encodeURIComponent(item.currentAsset.id)}/access`,
          orgId
        ),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      setPreviewUrl(response.access.url);
    } catch (caught) {
      handleError(caught, "Could not open the preview.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggleUser = (target: DashboardTrainingContentTarget, checked: boolean) => {
    setAssignments((current) => ({
      ...current,
      users: checked
        ? mergeTrainingContentTargets(current.users, [target])
        : current.users.filter((entry) => entry.userId !== target.userId),
    }));
  };

  const removeTarget = (
    field: "users" | "managers" | "managerTeams",
    userId: string
  ) => {
    setAssignments((current) => ({
      ...current,
      [field]: current[field].filter((target) => target.userId !== userId),
    }));
  };

  const toggleManagerRule = (
    field: "managers" | "managerTeams",
    target: DashboardTrainingContentTarget,
    checked: boolean
  ) => {
    setAssignments((current) => ({
      ...current,
      [field]: checked
        ? mergeTrainingContentTargets(current[field], [target])
        : current[field].filter((entry) => entry.userId !== target.userId),
    }));
  };

  const removeManagerRules = (userId: string) => {
    setAssignments((current) => ({
      ...current,
      managers: current.managers.filter((target) => target.userId !== userId),
      managerTeams: current.managerTeams.filter((target) => target.userId !== userId),
    }));
  };

  return (
    <div className="training-content-editor">
      <button
        className="training-content-back-link"
        type="button"
        onClick={navigateAway}
        disabled={saving || uploading}
      >
        <ArrowLeft size={17} aria-hidden="true" />
        Back to Learning Resources
      </button>
      {message ? <div className="notice success">{message}</div> : null}
      {error ? (
        <div className="notice danger">
          <strong>{error}</strong>
          {errorItems.length > 0 ? (
            <ul>{errorItems.map((entry) => <li key={entry}>{entry}</li>)}</ul>
          ) : null}
          {conflict ? (
            <button type="button" className="ghost-button compact-button" onClick={reload}>
              <RefreshCw size={16} aria-hidden="true" />
              Reload current version
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="training-content-band">
        <div className="section-header">
          <div>
            <p className="eyebrow">Basic information</p>
            <h2>Content details</h2>
          </div>
          <span className={`status-badge status-${item.publicationState}`}>
            {trainingContentStatusLabel(item.publicationState)}
          </span>
        </div>
        <div className="training-content-form-grid">
          <label className="field-label full-span">
            Title
            <input
              className="text-input"
              value={draft.title}
              maxLength={200}
              disabled={archived || saving}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label className="field-label full-span">
            Description
            <textarea
              className="text-input training-content-description"
              value={draft.description}
              maxLength={2000}
              disabled={archived || saving}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          <label className="field-label">
            Content Category
            <select
              className="text-input"
              value={draft.categoryId}
              disabled={archived || saving}
              onChange={(event) =>
                setDraft((current) => ({ ...current, categoryId: event.target.value }))
              }
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}{category.isDefault ? " (Default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Related Focus Topic
            <select
              className="text-input"
              value={draft.focusTopicId}
              disabled={archived || saving}
              onChange={(event) =>
                setDraft((current) => ({ ...current, focusTopicId: event.target.value }))
              }
            >
              <option value="">None</option>
              {!item.focusTopicAvailable && item.focusTopicId ? (
                <option value={item.focusTopicId}>
                  {item.focusTopicName ?? "Prior Focus Topic"} (no longer available)
                </option>
              ) : null}
              {focusTopics.map((topic) => (
                <option key={topic.id} value={topic.id}>{topic.name}</option>
              ))}
            </select>
          </label>
          <TrainingContentScenarioSelector
            options={scenarioOptions}
            selected={relatedScenarios}
            disabled={archived || saving}
            onChange={setRelatedScenarios}
          />
        </div>
      </section>

      <section className="training-content-band">
        <div className="section-header">
          <div>
            <p className="eyebrow">Content</p>
            <h2>{trainingContentTypeLabel(item.contentType)}</h2>
          </div>
          {item.contentType === "native" ? (
            <div className="segmented-control" aria-label="Native content mode">
              <button
                type="button"
                className={nativeMode === "write" ? "active" : ""}
                onClick={() => setNativeMode("write")}
                title="Write"
              >
                <PenLine size={16} aria-hidden="true" />
                Write
              </button>
              <button
                type="button"
                className={nativeMode === "preview" ? "active" : ""}
                onClick={() => setNativeMode("preview")}
                title="Preview"
              >
                <Eye size={16} aria-hidden="true" />
                Preview
              </button>
            </div>
          ) : null}
        </div>

        {item.contentType === "native" ? (
          nativeMode === "write" ? (
            <label className="field-label">
              Markdown
              <textarea
                className="text-input training-content-native-editor"
                value={draft.nativeBody}
                disabled={archived || saving}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, nativeBody: event.target.value }))
                }
              />
            </label>
          ) : (
            <div className="training-content-preview-surface">
              {draft.nativeBody.trim()
                ? <TrainingContentMarkdown markdown={draft.nativeBody} />
                : <p className="muted-copy">No Native content yet.</p>}
            </div>
          )
        ) : null}

        {item.contentType === "external_url" ? (
          <div className="training-content-form-grid">
            <label className="field-label full-span">
              HTTPS URL
              <input
                className="text-input"
                type="url"
                inputMode="url"
                value={draft.externalUrl}
                disabled={archived || saving}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, externalUrl: event.target.value }))
                }
              />
            </label>
            <button
              type="button"
              className="ghost-button icon-text-button"
              onClick={loadPreview}
              disabled={!item.externalUrl || dirty}
            >
              <ExternalLink size={17} aria-hidden="true" />
              Open resource
            </button>
          </div>
        ) : null}

        {isUploadedTrainingContentType(item.contentType) ? (
          <div className="training-content-upload">
            {item.currentAsset ? (
              <div className="current-file-row">
                <FileUp size={20} aria-hidden="true" />
                <div>
                  <span className="current-file-label">Current published file</span>
                  <strong>{item.currentAsset.originalFilename ?? "Uploaded file"}</strong>
                  <span>
                    Version {item.currentAsset.version}
                    {" | "}
                    {formatFileSize(item.currentAsset.byteSize ?? item.currentAsset.declaredByteSize)}
                    {" | "}
                    {item.currentAsset.uploadState}
                    {item.currentAsset.finalizedAt
                      ? ` | Ready ${formatDateTime(item.currentAsset.finalizedAt)}`
                      : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost-button icon-text-button"
                  onClick={loadPreview}
                  disabled={loadingPreview}
                >
                  {loadingPreview
                    ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
                    : item.contentType === "docx"
                      ? <Download size={17} aria-hidden="true" />
                      : <Eye size={17} aria-hidden="true" />}
                  {item.contentType === "docx" ? "Open file" : "Preview"}
                </button>
              </div>
            ) : (
              <p className="muted-copy">No ready file.</p>
            )}
            {latestVideoUploadAsset ? (
              <div
                className={`notice video-processing-card${
                  latestVideoUploadAsset.uploadState === "rejected" ? " danger" : ""
                }`}
                role="status"
                aria-live="polite"
              >
                {latestVideoUploadAsset.uploadState === "processing" ? (
                  <LoaderCircle size={18} className="spin" aria-hidden="true" />
                ) : (
                  <X size={18} aria-hidden="true" />
                )}
                <div>
                  <strong>
                    {latestVideoUploadAsset.replacementForAssetId || item.currentAsset
                      ? "Replacement video"
                      : "Video upload"}
                    {latestVideoUploadAsset.uploadState === "processing"
                      ? ": Processing"
                      : ": Processing failed"}
                  </strong>
                  <span>
                    {latestVideoUploadAsset.uploadState === "processing"
                      ? "You can leave this page. Processing will continue in the background."
                      : "Video processing failed."}
                  </span>
                  {latestVideoUploadAsset.uploadState === "rejected"
                    && formatTrainingContentVideoFailureCategory(
                      latestVideoUploadAsset.processingErrorCategory
                        ?? latestVideoUploadAsset.rejectionReasonCategory
                    ) ? (
                      <span>
                        Reason: {formatTrainingContentVideoFailureCategory(
                          latestVideoUploadAsset.processingErrorCategory
                            ?? latestVideoUploadAsset.rejectionReasonCategory
                        )}
                      </span>
                    ) : null}
                </div>
              </div>
            ) : null}
            {item.currentAsset && item.contentType === "docx" ? (
              <p className="muted-copy">
                DOCX opens as a secure file. An in-app converted preview is not available yet.
              </p>
            ) : null}

            {!archived && policy ? (
              <div className="upload-controls">
                <label className="field-label">
                  {item.currentAsset ? "Replacement file" : "File"}
                  <input
                    className="text-input file-input"
                    type="file"
                    accept={policy.accept}
                    onChange={selectFile}
                    disabled={uploading || videoUploadBlocked}
                  />
                </label>
                <span className="muted-copy">
                  Maximum {formatFileSize(fileLimits[policy.limitKey])}
                </span>
                {selectedFile ? (
                  <button
                    type="button"
                    className="primary-button icon-text-button"
                    onClick={uploadFile}
                    disabled={uploading || videoUploadBlocked}
                  >
                    {uploading
                      ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
                      : <Upload size={17} aria-hidden="true" />}
                    {uploading
                      ? `Uploading ${uploadProgress}%`
                      : pendingUpload
                        ? "Retry upload"
                        : item.currentAsset
                          ? "Upload replacement"
                          : "Upload file"}
                  </button>
                ) : null}
                {uploading ? (
                  <progress className="upload-progress" max={100} value={uploadProgress}>
                    {uploadProgress}%
                  </progress>
                ) : null}
              </div>
            ) : null}

            {previewUrl ? (
              <div className="training-content-preview-surface">
                {item.contentType === "image" ? (
                  <img src={previewUrl} alt={item.title} className="training-content-image-preview" />
                ) : null}
                {item.contentType === "video" ? (
                  <video src={previewUrl} controls className="training-content-media-preview" />
                ) : null}
                {item.contentType === "audio" ? (
                  <audio src={previewUrl} controls className="training-content-audio-preview" />
                ) : null}
                {item.contentType === "pdf" ? (
                  <iframe
                    src={previewUrl}
                    title={`${item.title} PDF preview`}
                    className="training-content-pdf-preview"
                  />
                ) : null}
                {item.contentType === "docx" ? (
                  <div className="docx-preview-action">
                    <a
                      className="primary-button icon-text-button"
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download size={17} aria-hidden="true" />
                      Open DOCX
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="training-content-band">
        <div className="section-header">
          <div>
            <p className="eyebrow">Availability</p>
            <h2>Assignments</h2>
          </div>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={assignments.availableToEveryone}
            disabled={archived || saving}
            onChange={(event) =>
              setAssignments((current) => ({
                ...current,
                availableToEveryone: event.target.checked,
              }))
            }
          />
          <span>
            <strong>Available to everyone</strong>
            <small>All active organization users qualify.</small>
          </span>
        </label>
        {assignments.availableToEveryone ? (
          <p className="muted-copy assignment-everyone-note">
            Targeted assignments remain saved, but Available to everyone currently supersedes them.
          </p>
        ) : null}

        <div className="assignment-columns">
          <div>
            <h3>Specific users</h3>
            <div className="assignment-selection-summary">
              <strong>Selected users ({assignments.users.length})</strong>
              {assignments.users.length > 0 ? (
                <div className="assignment-chips">
                  {assignments.users.map((target) => (
                    <span
                      key={target.userId}
                      className={`assignment-chip${target.available ? "" : " unavailable"}`}
                    >
                      {target.displayName}
                      {!target.available ? " (Inactive)" : ""}
                      {!archived ? (
                        <button
                          type="button"
                          onClick={() => removeTarget("users", target.userId)}
                          aria-label={`Remove ${target.displayName}`}
                          title={`Remove ${target.displayName}`}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <label className="field-label">
              Search users
              <span className="input-with-icon">
                {searchingUsers
                  ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
                  : <Search size={17} aria-hidden="true" />}
                <input
                  className="text-input"
                  value={userQuery}
                  placeholder="Name, email, or Employee ID"
                  disabled={archived || saving}
                  onChange={(event) => setUserQuery(event.target.value)}
                />
              </span>
            </label>
            {userResults.length > 0 ? (
              <div className="assignment-search-results">
                {userResults.map((target) => {
                  const selected = assignments.users.some(
                    (entry) => entry.userId === target.userId
                  );
                  return (
                    <label key={target.userId} className="assignment-result-row">
                      <span>
                        <strong>{target.displayName}</strong>
                        <small>{target.email}{target.employeeId ? ` | ${target.employeeId}` : ""}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={archived || saving}
                        onChange={(event) => toggleUser(target, event.target.checked)}
                        aria-label={`Assign ${target.displayName}`}
                      />
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div>
            <h3>Managers</h3>
            <div className="assignment-selection-summary">
              <strong>
                Selected manager rules ({
                  managerChoices.filter((target) =>
                    assignments.managers.some((entry) => entry.userId === target.userId)
                    || assignments.managerTeams.some((entry) => entry.userId === target.userId)
                  ).length
                })
              </strong>
              <div className="assignment-chips">
                {managerChoices
                  .filter((target) =>
                    assignments.managers.some((entry) => entry.userId === target.userId)
                    || assignments.managerTeams.some((entry) => entry.userId === target.userId)
                  )
                  .map((target) => {
                    const manager = assignments.managers.some(
                      (entry) => entry.userId === target.userId
                    );
                    const team = assignments.managerTeams.some(
                      (entry) => entry.userId === target.userId
                    );
                    const rule = manager && team ? "Manager + Team" : manager ? "Manager" : "Team";
                    return (
                      <span
                        key={target.userId}
                        className={`assignment-chip${target.available ? "" : " unavailable"}`}
                      >
                        {target.displayName} - {rule}{!target.available ? " (Inactive)" : ""}
                        {!archived ? (
                          <button
                            type="button"
                            onClick={() => removeManagerRules(target.userId)}
                            aria-label={`Remove ${target.displayName} manager rules`}
                            title={`Remove ${target.displayName} manager rules`}
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
              </div>
            </div>
            <label className="field-label">
              Search managers
              <span className="input-with-icon">
                {searchingManagers
                  ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
                  : <Search size={17} aria-hidden="true" />}
                <input
                  className="text-input"
                  value={managerQuery}
                  placeholder="Name or email"
                  disabled={archived || saving}
                  onChange={(event) => setManagerQuery(event.target.value)}
                />
              </span>
            </label>
            <div className="manager-assignment-list">
              {managerChoices.map((target) => {
                const personallyAssigned = assignments.managers.some(
                  (entry) => entry.userId === target.userId
                );
                const teamAssigned = assignments.managerTeams.some(
                  (entry) => entry.userId === target.userId
                );
                return (
                  <div
                    key={target.userId}
                    className={`manager-assignment-row${target.available ? "" : " unavailable"}`}
                  >
                    <span>
                      <strong>{target.displayName}</strong>
                      <small>
                        {target.available
                          ? `${target.email}${target.employeeId ? ` | ${target.employeeId}` : ""}`
                          : "No longer an active User Admin"}
                      </small>
                    </span>
                    <label>
                      <input
                        type="checkbox"
                        checked={personallyAssigned}
                        disabled={!target.available || archived || saving}
                        onChange={(event) =>
                          toggleManagerRule("managers", target, event.target.checked)
                        }
                      />
                      Assign to manager
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={teamAssigned}
                        disabled={!target.available || archived || saving}
                        onChange={(event) =>
                          toggleManagerRule("managerTeams", target, event.target.checked)
                        }
                      />
                      Assign to manager&apos;s team
                    </label>
                    {!target.available && !archived ? (
                      <button
                        type="button"
                        className="icon-button"
                        title="Remove unavailable manager rules"
                        onClick={() => {
                          removeTarget("managers", target.userId);
                          removeTarget("managerTeams", target.userId);
                        }}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="training-content-sticky-actions training-content-editor-actions">
        <div>
          <p className="muted-copy">
            {trainingContentStatusLabel(item.publicationState)}
            {" | "}
            Version {item.contentVersion}
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={navigateAway}
            disabled={saving || uploading}
          >
            Close
          </button>
          {!archived ? (
            <button
              type="button"
              className="ghost-button icon-text-button"
              onClick={save}
              disabled={saving || uploading || !dirty}
            >
              {saving
                ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
                : <Check size={17} aria-hidden="true" />}
              {saving
                ? "Saving..."
                : item.publicationState === "draft"
                  ? "Save draft"
                  : "Save changes"}
            </button>
          ) : null}
          {item.publicationState === "draft" ? (
            <button
              type="button"
              className="primary-button icon-text-button"
              onClick={() => transition("publish")}
              disabled={saving || uploading}
            >
              <Send size={17} aria-hidden="true" />
              Publish
            </button>
          ) : null}
          {item.publicationState === "published" ? (
            <button
              type="button"
              className="ghost-button icon-text-button"
              onClick={() => transition("unpublish")}
              disabled={saving || uploading}
            >
              <Undo2 size={17} aria-hidden="true" />
              Unpublish
            </button>
          ) : null}
          {!archived ? (
            <button
              type="button"
              className="ghost-button danger-button icon-text-button"
              onClick={() => transition("archive")}
              disabled={saving || uploading}
            >
              <Archive size={17} aria-hidden="true" />
              Archive
            </button>
          ) : null}
        </div>
      </div>
      <UnsavedChangesDialog
        open={pendingNavigation !== null}
        onStay={() => setPendingNavigation(null)}
        onLeave={() => {
          const destination = pendingNavigation;
          setPendingNavigation(null);
          if (destination) {
            router.push(destination);
          }
        }}
      />
    </div>
  );
}
