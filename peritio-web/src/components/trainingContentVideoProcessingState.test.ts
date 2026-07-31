import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardTrainingContentAsset } from "@voicepractice/shared";

import {
  formatTrainingContentVideoFailureCategory,
  pollTrainingContentVideoStatus,
  resolveTrainingContentVideoPollResult,
  restoreTrainingContentVideoProcessingAsset,
  trainingContentVideoUploadIsBlocked,
} from "./trainingContentVideoProcessingState";

function asset(
  uploadState: DashboardTrainingContentAsset["uploadState"],
  overrides: Partial<DashboardTrainingContentAsset> = {}
): DashboardTrainingContentAsset {
  return {
    id: "asset_processing",
    contentId: "content_1",
    assetRole: "primary",
    version: 2,
    uploadState,
    originalFilename: "training.mp4",
    declaredMimeType: "video/mp4",
    detectedMimeType: "video/mp4",
    fileExtension: "mp4",
    declaredByteSize: 1024,
    byteSize: 1024,
    uploadExpiresAt: null,
    finalizedAt: null,
    supersededAt: null,
    replacementForAssetId: "asset_current",
    isCurrent: false,
    cleanupPending: false,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

test("finalized processing video restores a visible processing state and blocks another upload", () => {
  const processing = asset("processing");
  assert.equal(resolveTrainingContentVideoPollResult(processing).action, "continue");
  assert.equal(trainingContentVideoUploadIsBlocked(processing), true);
});

test("processing poll result continues polling", () => {
  assert.deepEqual(resolveTrainingContentVideoPollResult(asset("processing")), {
    action: "continue",
    asset: asset("processing"),
  });
});

test("processing status does not refresh the item and keeps the poll active", async () => {
  let refreshCount = 0;
  const polled = await pollTrainingContentVideoStatus({
    loadStatus: async () => ({
      asset: asset("processing"),
      replacedAssetId: "asset_current",
    }),
    refreshReadyItem: async () => {
      refreshCount += 1;
      return "refreshed";
    },
  });
  assert.equal(polled.result.action, "continue");
  assert.equal(polled.refreshedItem, null);
  assert.equal(refreshCount, 0);
});

test("ready poll result stops processing and requests the ready transition", () => {
  assert.equal(resolveTrainingContentVideoPollResult(asset("ready")).action, "ready");
  assert.equal(trainingContentVideoUploadIsBlocked(asset("ready")), false);
});

test("ready status refreshes the item exactly once and ends the poll", async () => {
  let refreshCount = 0;
  const polled = await pollTrainingContentVideoStatus({
    loadStatus: async () => ({
      asset: asset("ready", { id: "asset_ready", isCurrent: true }),
      replacedAssetId: "asset_current",
    }),
    refreshReadyItem: async () => {
      refreshCount += 1;
      return { id: "content_1" };
    },
  });
  assert.equal(polled.result.action, "ready");
  assert.deepEqual(polled.refreshedItem, { id: "content_1" });
  assert.equal(refreshCount, 1);
});

test("rejected poll result stops with only a safe failure category", () => {
  const failed = resolveTrainingContentVideoPollResult(asset("rejected", {
    processingErrorCategory: "invalid_media",
    rejectionReasonCategory: "video_processing_invalid_media",
  }));
  assert.deepEqual(failed, {
    action: "failed",
    asset: asset("rejected", {
      processingErrorCategory: "invalid_media",
      rejectionReasonCategory: "video_processing_invalid_media",
    }),
    safeCategory: "invalid_media",
  });
  assert.equal(formatTrainingContentVideoFailureCategory("invalid_media"), "invalid media");
  assert.equal(trainingContentVideoUploadIsBlocked(failed.asset), false);
});

test("rejected status stops without refreshing and re-enables replacement", async () => {
  let refreshCount = 0;
  const polled = await pollTrainingContentVideoStatus({
    loadStatus: async () => ({
      asset: asset("rejected", { processingErrorCategory: "invalid_media" }),
      replacedAssetId: "asset_current",
    }),
    refreshReadyItem: async () => {
      refreshCount += 1;
      return "refreshed";
    },
  });
  assert.equal(polled.result.action, "failed");
  assert.equal(polled.refreshedItem, null);
  assert.equal(refreshCount, 0);
  assert.equal(trainingContentVideoUploadIsBlocked(polled.result.asset), false);
});
test("reopening a video item restores its newer processing replacement", () => {
  const current = asset("ready", { id: "asset_current", version: 1, isCurrent: true });
  const processing = asset("processing");
  assert.equal(restoreTrainingContentVideoProcessingAsset({
    contentType: "video",
    currentAsset: current,
    latestVideoUploadAsset: processing,
  }), processing);
});

test("normal ready videos and PDF/document flows remain unchanged", () => {
  const ready = asset("ready", { id: "asset_current", isCurrent: true });
  assert.equal(restoreTrainingContentVideoProcessingAsset({
    contentType: "video",
    currentAsset: ready,
    latestVideoUploadAsset: ready,
  }), null);
  assert.equal(restoreTrainingContentVideoProcessingAsset({
    contentType: "pdf",
    currentAsset: ready,
    latestVideoUploadAsset: asset("processing"),
  }), null);
  assert.equal(restoreTrainingContentVideoProcessingAsset({
    contentType: "docx",
    currentAsset: ready,
    latestVideoUploadAsset: asset("rejected"),
  }), null);
});
