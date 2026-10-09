import type {
  TrainingContentExternalKind,
  TrainingContentPublicationState,
  TrainingContentType,
} from "@voicepractice/shared";

export const TRAINING_CONTENT_TRANSCRIPT_MAX_CHARACTERS = 200_000;

// Batch 6 extraction must preserve these bounds; Batch 4B.2 performs no extraction.
export const TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1 = Object.freeze({
  maximumExtractedCharacters: 200_000,
  pdf: Object.freeze({ boundedInputRequired: true, ocrAllowed: false }),
  docx: Object.freeze({ boundedInputRequired: true, boundedArchiveExpansionRequired: true,
    externalRelationshipsAllowed: false, dtdOrEntityExpansionAllowed: false }),
});

export type TrainingContentGenerationSourceKind =
  | "native_text"
  | "pdf"
  | "docx"
  | "uploaded_video_transcript"
  | "youtube_transcript"
  | "unsupported";

export type TrainingContentGenerationEligibilityReason =
  | "ready"
  | "draft"
  | "archived"
  | "missing_transcript"
  | "missing_source_text"
  | "unsupported_type"
  | "asset_not_ready"
  | "text_not_extractable_yet"
  | "module_disabled";

export interface TrainingContentGenerationEligibility {
  eligible: boolean;
  reasonCode: TrainingContentGenerationEligibilityReason;
  sourceKind: TrainingContentGenerationSourceKind;
}

export function canonicalizeYouTubeUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw invalidYouTubeUrl();
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw invalidYouTubeUrl();
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw invalidYouTubeUrl();
  }
  const host = parsed.hostname.toLowerCase();
  const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
  let videoId: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    if (parsed.search || parsed.pathname.split("/").filter(Boolean).length !== 1) throw invalidYouTubeUrl();
    videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (youtubeHosts.has(host)) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.pathname === "/watch") {
      if ([...parsed.searchParams.keys()].some((key) => key !== "v")) throw invalidYouTubeUrl();
      if (parsed.searchParams.getAll("v").length !== 1) throw invalidYouTubeUrl();
      videoId = parsed.searchParams.get("v");
    } else if ((parts[0] === "shorts" || parts[0] === "embed") && parts.length === 2 && !parsed.search) {
      videoId = parts[1] ?? null;
    }
  }
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw invalidYouTubeUrl();
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function normalizeCustomerTranscript(value: unknown): string {
  if (typeof value !== "string") throw new Error("Transcript must be text.");
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("Transcript cannot be empty.");
  if (normalized.length > TRAINING_CONTENT_TRANSCRIPT_MAX_CHARACTERS) {
    throw new Error(`Transcript must be ${TRAINING_CONTENT_TRANSCRIPT_MAX_CHARACTERS.toLocaleString()} characters or fewer.`);
  }
  if (/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(normalized)) {
    throw new Error("Transcript contains unsupported characters.");
  }
  return normalized;
}

export function evaluateTrainingContentGenerationSource(input: {
  contentType: TrainingContentType;
  publicationState: TrainingContentPublicationState;
  archivedAt: string | null;
  externalKind?: TrainingContentExternalKind | null;
  nativeBody: string | null;
  hasReadyPrimaryAsset: boolean;
  hasCurrentTranscript: boolean;
  moduleEnabled: boolean;
}): TrainingContentGenerationEligibility {
  const sourceKind = resolveSourceKind(input.contentType, input.externalKind ?? null);
  if (!input.moduleEnabled) return { eligible: false, reasonCode: "module_disabled", sourceKind };
  if (input.archivedAt !== null || input.publicationState === "archived") {
    return { eligible: false, reasonCode: "archived", sourceKind };
  }
  if (input.publicationState === "draft") return { eligible: false, reasonCode: "draft", sourceKind };
  if (input.contentType === "native") {
    return input.nativeBody?.trim()
      ? { eligible: true, reasonCode: "ready", sourceKind }
      : { eligible: false, reasonCode: "missing_source_text", sourceKind };
  }
  if (input.contentType === "pdf" || input.contentType === "docx") {
    return input.hasReadyPrimaryAsset
      ? { eligible: false, reasonCode: "text_not_extractable_yet", sourceKind }
      : { eligible: false, reasonCode: "asset_not_ready", sourceKind };
  }
  if (input.contentType === "video") {
    if (!input.hasReadyPrimaryAsset) return { eligible: false, reasonCode: "asset_not_ready", sourceKind };
    return input.hasCurrentTranscript
      ? { eligible: true, reasonCode: "ready", sourceKind }
      : { eligible: false, reasonCode: "missing_transcript", sourceKind };
  }
  if (input.contentType === "external_url" && input.externalKind === "youtube") {
    return input.hasCurrentTranscript
      ? { eligible: true, reasonCode: "ready", sourceKind }
      : { eligible: false, reasonCode: "missing_transcript", sourceKind };
  }
  return { eligible: false, reasonCode: "unsupported_type", sourceKind: "unsupported" };
}

function resolveSourceKind(
  contentType: TrainingContentType,
  externalKind: TrainingContentExternalKind | null,
): TrainingContentGenerationSourceKind {
  if (contentType === "native") return "native_text";
  if (contentType === "pdf") return "pdf";
  if (contentType === "docx") return "docx";
  if (contentType === "video") return "uploaded_video_transcript";
  if (contentType === "external_url" && externalKind === "youtube") return "youtube_transcript";
  return "unsupported";
}

function invalidYouTubeUrl(): Error {
  return new Error("Enter a valid public YouTube URL.");
}
