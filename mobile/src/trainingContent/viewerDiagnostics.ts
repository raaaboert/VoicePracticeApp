export type TrainingContentViewerDiagnosticCategory =
  | "asset_access_failed"
  | "pdf_download_failed"
  | "pdf_local_file_missing"
  | "pdf_render_failed"
  | "pdf_render_timeout"
  | "video_first_frame_rendered"
  | "video_surface_layout"
  | "video_track_dimensions";

interface ViewerDiagnosticDetails {
  width?: number;
  height?: number;
}

interface ViewerDiagnosticOptions {
  enabled?: boolean;
  sink?: (message: string, payload: Record<string, unknown>) => void;
}

const STAGING_API_BASE_URL = "https://voicepractice-api-dev.onrender.com";

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
  if (Number.isFinite(details.width) && (details.width ?? 0) > 0) {
    payload.width = Math.round(details.width!);
  }
  if (Number.isFinite(details.height) && (details.height ?? 0) > 0) {
    payload.height = Math.round(details.height!);
  }
  const sink =
    options.sink ??
    ((message: string, safePayload: Record<string, unknown>) => {
      console.warn(message, safePayload);
    });
  sink("[training-content-viewer]", payload);
}
