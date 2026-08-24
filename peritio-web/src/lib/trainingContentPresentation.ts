import type {
  TrainingContentAssetUploadState,
  DashboardTrainingContentTarget,
  TrainingContentFileLimitsBytes,
  TrainingContentPublicationState,
  TrainingContentType,
} from "@voicepractice/shared";

export const UPLOADED_TRAINING_CONTENT_TYPES: readonly TrainingContentType[] = [
  "video",
  "audio",
  "pdf",
  "docx",
  "image",
];

const TYPE_LABELS: Record<TrainingContentType, string> = {
  native: "Native Peritio",
  external_url: "External URL",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  docx: "DOCX",
  image: "Image",
};

const STATUS_LABELS: Record<TrainingContentPublicationState, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const FILE_POLICIES: Partial<Record<TrainingContentType, {
  accept: string;
  extensions: string[];
  mimeTypes: string[];
  limitKey: keyof TrainingContentFileLimitsBytes;
}>> = {
  video: {
    accept: ".mp4,video/mp4",
    extensions: ["mp4"],
    mimeTypes: ["video/mp4"],
    limitKey: "video",
  },
  audio: {
    accept: ".mp3,.m4a,audio/mpeg,audio/mp4",
    extensions: ["mp3", "m4a"],
    mimeTypes: ["audio/mpeg", "audio/mp4"],
    limitKey: "audio",
  },
  pdf: {
    accept: ".pdf,application/pdf",
    extensions: ["pdf"],
    mimeTypes: ["application/pdf"],
    limitKey: "pdf",
  },
  docx: {
    accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    limitKey: "docx",
  },
  image: {
    accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
    extensions: ["jpg", "jpeg", "png", "webp"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    limitKey: "image",
  },
};

export function trainingContentTypeLabel(contentType: TrainingContentType): string {
  return TYPE_LABELS[contentType];
}

export function trainingContentStatusLabel(
  status: TrainingContentPublicationState
): string {
  return STATUS_LABELS[status];
}

export function trainingContentUploadFinalizationMessage(params: {
  uploadState: TrainingContentAssetUploadState;
  replacing: boolean;
}): string {
  if (params.uploadState === "processing") {
    return params.replacing
      ? "Replacement video uploaded. Processing is in progress."
      : "Video uploaded. Processing is in progress.";
  }
  return params.replacing ? "Replacement file is ready." : "File is ready.";
}

export function trainingContentOrgQuery(orgId: string | null): string {
  return orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
}

export function trainingContentOrgQuerySuffix(orgId: string | null): string {
  return orgId ? `&orgId=${encodeURIComponent(orgId)}` : "";
}

export function isUploadedTrainingContentType(
  contentType: TrainingContentType
): boolean {
  return UPLOADED_TRAINING_CONTENT_TYPES.includes(contentType);
}

export function getTrainingContentFilePolicy(contentType: TrainingContentType) {
  return FILE_POLICIES[contentType] ?? null;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  }
  return `${bytes} B`;
}

export function validateTrainingContentFileSelection(params: {
  contentType: TrainingContentType;
  file: Pick<File, "name" | "type" | "size">;
  limits: TrainingContentFileLimitsBytes;
}): string | null {
  const policy = getTrainingContentFilePolicy(params.contentType);
  if (!policy) {
    return "This Learning Resource type does not accept a file.";
  }
  const extension = params.file.name.split(".").pop()?.trim().toLowerCase() ?? "";
  if (!policy.extensions.includes(extension)) {
    return `Choose a ${policy.extensions.map((entry) => entry.toUpperCase()).join(" or ")} file.`;
  }
  const mimeType = params.file.type.trim().toLowerCase();
  if (mimeType && !policy.mimeTypes.includes(mimeType)) {
    return "The selected file type does not match its extension.";
  }
  const limit = params.limits[policy.limitKey];
  if (!Number.isSafeInteger(params.file.size) || params.file.size <= 0) {
    return "Choose a non-empty file.";
  }
  if (params.file.size > limit) {
    return `The selected file exceeds the ${formatFileSize(limit)} limit.`;
  }
  return null;
}

export function trainingContentDeclaredMimeType(
  contentType: TrainingContentType,
  file: Pick<File, "name" | "type">
): string {
  const declared = file.type.trim().toLowerCase();
  if (declared) {
    return declared;
  }
  const extension = file.name.split(".").pop()?.trim().toLowerCase() ?? "";
  const inferred: Record<string, string> = {
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return inferred[extension] ?? (getTrainingContentFilePolicy(contentType)?.mimeTypes[0] ?? "");
}

export function safeTrainingContentMarkdownUrl(url: string): string {
  const normalized = url.trim();
  if (normalized.startsWith("#")) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    return (parsed.protocol === "https:" || parsed.protocol === "mailto:")
      && !parsed.username
      && !parsed.password
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

export function mergeTrainingContentTargets(
  existing: readonly DashboardTrainingContentTarget[],
  incoming: readonly DashboardTrainingContentTarget[]
): DashboardTrainingContentTarget[] {
  const targets = new Map(existing.map((target) => [target.userId, target]));
  for (const target of incoming) {
    targets.set(target.userId, target);
  }
  return [...targets.values()].sort((left, right) => {
    const nameDelta = left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base",
    });
    return nameDelta !== 0 ? nameDelta : left.email.localeCompare(right.email);
  });
}
