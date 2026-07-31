export const NATIVE_VIEWER_LOAD_TIMEOUT_MS = 20_000;
export const ASSET_ACCESS_RENEWAL_LEAD_MS = 15_000;

export interface ViewerRequestLifecycle {
  active: boolean;
  generation: number;
}

export interface NativeViewerLoadGuard {
  active: boolean;
  settled: boolean;
}

export type PdfNativeRenderSignal =
  | "load_complete"
  | "page_changed"
  | "error"
  | "timeout";

export type PdfNativeRenderOutcome = "loaded" | "failed";

export interface ProgressiveVideoSource {
  uri: string;
  useCaching: false;
  contentType: "progressive";
  headers?: Record<string, string>;
}

export interface LocalPdfSource {
  uri: string;
  cache: false;
}

export function createViewerRequestLifecycle(): ViewerRequestLifecycle {
  return { active: true, generation: 0 };
}

export function createNativeViewerLoadGuard(): NativeViewerLoadGuard {
  return { active: true, settled: false };
}

export function resetNativeViewerLoadGuard(guard: NativeViewerLoadGuard): void {
  guard.active = true;
  guard.settled = false;
}

export function settleNativeViewerLoad(guard: NativeViewerLoadGuard): boolean {
  if (!guard.active || guard.settled) {
    return false;
  }
  guard.settled = true;
  return true;
}

export function isValidPdfPageProgress(
  currentPage: number,
  pageCount: number
): boolean {
  return (
    Number.isSafeInteger(currentPage) &&
    currentPage > 0 &&
    Number.isSafeInteger(pageCount) &&
    pageCount > 0 &&
    currentPage <= pageCount
  );
}

export function resolvePdfNativeRenderSignal(
  guard: NativeViewerLoadGuard,
  signal: PdfNativeRenderSignal,
  platform: string
): PdfNativeRenderOutcome | null {
  const isReadySignal =
    signal === "load_complete" ||
    (platform === "android" && signal === "page_changed");
  if (signal === "page_changed" && !isReadySignal) {
    return null;
  }
  if (!settleNativeViewerLoad(guard)) {
    return null;
  }
  return isReadySignal ? "loaded" : "failed";
}

export function disposeNativeViewerLoadGuard(guard: NativeViewerLoadGuard): void {
  guard.active = false;
  guard.settled = true;
}

export function activateViewerRequestLifecycle(lifecycle: ViewerRequestLifecycle): void {
  if (!lifecycle.active) {
    lifecycle.active = true;
    lifecycle.generation += 1;
  }
}

export function beginViewerRequest(lifecycle: ViewerRequestLifecycle): number | null {
  if (!lifecycle.active) {
    return null;
  }
  lifecycle.generation += 1;
  return lifecycle.generation;
}

export function cancelViewerRequests(lifecycle: ViewerRequestLifecycle): void {
  lifecycle.generation += 1;
}

export function disposeViewerRequestLifecycle(lifecycle: ViewerRequestLifecycle): void {
  lifecycle.active = false;
  lifecycle.generation += 1;
}

export function isViewerRequestCurrent(
  lifecycle: ViewerRequestLifecycle,
  generation: number
): boolean {
  return lifecycle.active && lifecycle.generation === generation;
}

export function getAssetAccessRenewalDelayMs(
  expiresAt: string,
  nowMs = Date.now()
): number | null {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }
  return Math.max(1_000, expiresAtMs - nowMs - ASSET_ACCESS_RENEWAL_LEAD_MS);
}

export function buildProgressiveVideoSource(
  url: string,
  headers: Record<string, string>
): ProgressiveVideoSource {
  return {
    uri: url,
    useCaching: false,
    contentType: "progressive",
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

export function buildLocalPdfSource(localUri: string): LocalPdfSource {
  return {
    uri: localUri,
    cache: false,
  };
}

export function createNativeViewerInstanceKey(
  contentId: string,
  accessRevision: number
): string {
  return `${contentId}:${accessRevision}`;
}
