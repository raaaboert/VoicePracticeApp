import type {
  DashboardTrainingContentAsset,
  DashboardTrainingContentAssetFinalizationResponse,
  TrainingContentType,
} from "@voicepractice/shared";

export const TRAINING_CONTENT_VIDEO_STATUS_POLL_MS = 4_000;

export interface TrainingContentVideoProcessingSource {
  contentType: TrainingContentType;
  currentAsset: DashboardTrainingContentAsset | null;
  latestVideoUploadAsset?: DashboardTrainingContentAsset | null;
}

export type TrainingContentVideoPollResult =
  | { action: "continue"; asset: DashboardTrainingContentAsset }
  | { action: "ready"; asset: DashboardTrainingContentAsset }
  | { action: "failed"; asset: DashboardTrainingContentAsset; safeCategory: string | null }
  | { action: "stop"; asset: DashboardTrainingContentAsset };

export function restoreTrainingContentVideoProcessingAsset(
  source: TrainingContentVideoProcessingSource
): DashboardTrainingContentAsset | null {
  const latest = source.latestVideoUploadAsset ?? null;
  if (
    source.contentType !== "video"
    || !latest
    || latest.id === source.currentAsset?.id
    || !["processing", "rejected"].includes(latest.uploadState)
  ) {
    return null;
  }
  return latest;
}

export function resolveTrainingContentVideoPollResult(
  asset: DashboardTrainingContentAsset
): TrainingContentVideoPollResult {
  if (asset.uploadState === "processing") {
    return { action: "continue", asset };
  }
  if (asset.uploadState === "ready") {
    return { action: "ready", asset };
  }
  if (asset.uploadState === "rejected") {
    return {
      action: "failed",
      asset,
      safeCategory: asset.processingErrorCategory
        ?? asset.rejectionReasonCategory
        ?? null,
    };
  }
  return { action: "stop", asset };
}

export async function pollTrainingContentVideoStatus<T>(options: {
  loadStatus: () => Promise<DashboardTrainingContentAssetFinalizationResponse>;
  refreshReadyItem: () => Promise<T>;
}): Promise<{
  result: TrainingContentVideoPollResult;
  refreshedItem: T | null;
}> {
  const status = await options.loadStatus();
  const result = resolveTrainingContentVideoPollResult(status.asset);
  return {
    result,
    refreshedItem: result.action === "ready"
      ? await options.refreshReadyItem()
      : null,
  };
}

export function trainingContentVideoUploadIsBlocked(
  asset: DashboardTrainingContentAsset | null
): boolean {
  return asset?.uploadState === "processing";
}

export function formatTrainingContentVideoFailureCategory(
  category: string | null | undefined
): string | null {
  const normalized = category?.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") ?? "";
  return normalized ? normalized.replaceAll("_", " ") : null;
}
