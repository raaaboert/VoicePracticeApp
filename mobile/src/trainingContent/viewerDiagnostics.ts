export type TrainingContentViewerDiagnosticCategory =
  | "asset_access_failed"
  | "pdf_download_failed"
  | "pdf_local_file_missing"
  | "pdf_signature_invalid"
  | "pdf_size_mismatch"
  | "pdf_render_failed"
  | "pdf_render_timeout"
  | "video_first_frame_rendered"
  | "video_source_load"
  | "video_surface_layout"
  | "video_view_layout"
  | "video_track_dimensions";

export type PdfNativeErrorClass =
  | "document_load_failed"
  | "invalid_document"
  | "network_failure"
  | "password_required"
  | "render_failure"
  | "source_missing"
  | "unknown";

interface ViewerDiagnosticDetails {
  aspectRatio?: number;
  width?: number;
  height?: number;
  platform?: string;
  sourceLoadFired?: boolean;
  trackCount?: number;
  nativeErrorClass?: PdfNativeErrorClass;
}

interface ViewerDiagnosticOptions {
  enabled?: boolean;
  sink?: (message: string, payload: Record<string, unknown>) => void;
}

const STAGING_API_BASE_URL = "https://voicepractice-api-dev.onrender.com";
const PDF_NATIVE_ERROR_CLASSES = new Set<PdfNativeErrorClass>([
  "document_load_failed",
  "invalid_document",
  "network_failure",
  "password_required",
  "render_failure",
  "source_missing",
  "unknown",
]);
const VIEWER_PLATFORMS = new Set(["android", "ios"]);

function nativeErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "";
}

export function classifyPdfNativeError(
  error: unknown
): PdfNativeErrorClass {
  const message = nativeErrorMessage(error)
    .split(/\b(?:path|uri|url)\s*=/i, 1)[0]
    .toLowerCase();
  if (/password|encrypted/.test(message)) {
    return "password_required";
  }
  if (/no pdf source|source (?:is )?missing/.test(message)) {
    return "source_missing";
  }
  if (/load pdf failed|document (?:load|open) failed/.test(message)) {
    return "document_load_failed";
  }
  if (/invalid|corrupt|malformed|not a pdf|signature/.test(message)) {
    return "invalid_document";
  }
  if (/network|download|https?|ssl|tls/.test(message)) {
    return "network_failure";
  }
  if (/render|drawing|page/.test(message)) {
    return "render_failure";
  }
  return "unknown";
}

export function shouldRecordTrainingContentViewerDiagnostics(
  isDevelopment: boolean,
  apiBaseUrl: string | undefined
): boolean {
  return (
    isDevelopment ||
    apiBaseUrl?.trim().replace(/\/+$/, "") === STAGING_API_BASE_URL
  );
}

export function recordTrainingContentViewerDiagnostic(
  category: TrainingContentViewerDiagnosticCategory,
  details: ViewerDiagnosticDetails = {},
  options: ViewerDiagnosticOptions = {}
): void {
  const enabled =
    options.enabled ??
    shouldRecordTrainingContentViewerDiagnostics(
      typeof __DEV__ !== "undefined" && __DEV__,
      process.env.EXPO_PUBLIC_API_BASE_URL
    );
  if (!enabled) {
    return;
  }
  const payload: Record<string, unknown> = { category };
  if (details.platform && VIEWER_PLATFORMS.has(details.platform)) {
    payload.platform = details.platform;
  }
  if (typeof details.sourceLoadFired === "boolean") {
    payload.sourceLoadFired = details.sourceLoadFired;
  }
  if (
    Number.isSafeInteger(details.trackCount) &&
    (details.trackCount ?? -1) >= 0
  ) {
    payload.trackCount = details.trackCount;
  }
  if (
    Number.isFinite(details.aspectRatio) &&
    (details.aspectRatio ?? 0) > 0
  ) {
    payload.aspectRatio =
      Math.round((details.aspectRatio ?? 0) * 10_000) / 10_000;
  }
  if (Number.isFinite(details.width) && (details.width ?? -1) >= 0) {
    payload.width = Math.round(details.width!);
  }
  if (Number.isFinite(details.height) && (details.height ?? -1) >= 0) {
    payload.height = Math.round(details.height!);
  }
  if (
    details.nativeErrorClass &&
    PDF_NATIVE_ERROR_CLASSES.has(details.nativeErrorClass)
  ) {
    payload.nativeErrorClass = details.nativeErrorClass;
  }
  const sink =
    options.sink ??
    ((message: string, safePayload: Record<string, unknown>) => {
      console.warn(message, safePayload);
    });
  sink("[training-content-viewer]", payload);
}
