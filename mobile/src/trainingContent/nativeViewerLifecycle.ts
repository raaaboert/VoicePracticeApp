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

export interface ProgressiveVideoSource {
  uri: string;
  useCaching: false;
  contentType: "progressive";
  headers?: Record<string, string>;
}

export interface PrivatePdfSource {
  uri: string;
  cache: false;
  headers?: Record<string, string>;
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

export function buildPrivatePdfSource(
  url: string,
  headers: Record<string, string>
): PrivatePdfSource {
  return {
    uri: url,
    cache: false,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

export function createNativeViewerInstanceKey(
  contentId: string,
  accessRevision: number
): string {
  return `${contentId}:${accessRevision}`;
}
