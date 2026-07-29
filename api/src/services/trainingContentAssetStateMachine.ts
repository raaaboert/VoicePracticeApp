import type { TrainingContentAssetUploadState } from "@voicepractice/shared";

const LEGAL_TRANSITIONS: Record<
  TrainingContentAssetUploadState,
  ReadonlySet<TrainingContentAssetUploadState>
> = {
  pending: new Set(["uploaded", "rejected", "expired"]),
  uploaded: new Set(["processing", "rejected", "expired"]),
  processing: new Set(["ready", "rejected"]),
  ready: new Set(["superseded"]),
  rejected: new Set(),
  expired: new Set(),
  superseded: new Set(),
};

export function canTransitionTrainingContentAsset(
  from: TrainingContentAssetUploadState,
  to: TrainingContentAssetUploadState
): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

export function assertTrainingContentAssetTransition(
  from: TrainingContentAssetUploadState,
  to: TrainingContentAssetUploadState
): void {
  if (!canTransitionTrainingContentAsset(from, to)) {
    throw new Error(`Training Content asset cannot transition from ${from} to ${to}.`);
  }
}

export function assertTrainingContentFinalizationTransition(
  from: TrainingContentAssetUploadState
): void {
  if (from === "pending") {
    assertTrainingContentAssetTransition("pending", "uploaded");
    assertTrainingContentAssetTransition("uploaded", "processing");
    return;
  }
  assertTrainingContentAssetTransition(from, "processing");
}
