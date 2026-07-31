import { statfs } from "node:fs/promises";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ClaimedTrainingContentVideoProcessing,
  TrainingContentAssetStore,
} from "../storage/trainingContentAssetStore.js";
import type {
  TrainingContentObjectStorage,
} from "../storage/trainingContentObjectStorage.js";
import {
  decideTrainingContentVideoProcessing,
  TrainingContentVideoMediaProcessor,
  TrainingContentVideoProcessingError,
  validateTrainingContentVideoCandidate,
} from "./trainingContentVideoMedia.js";

export interface TrainingContentVideoWorkerConfig {
  maximumInputBytes: number;
  minimumFreeDiskBytes: number;
  jobTimeoutMs: number;
  leaseSeconds: number;
  maximumAttempts: number;
  retryDelaySeconds: number[];
}

export type TrainingContentVideoWorkerRunResult =
  | "idle"
  | "ready_bypassed"
  | "ready_normalized"
  | "retry_scheduled"
  | "failed";

export type TrainingContentVideoWorkerPollFailureCategory =
  | "poll_sweep_failed"
  | "poll_claim_failed";

export class TrainingContentVideoWorkerPollError extends Error {
  constructor(
    readonly category: TrainingContentVideoWorkerPollFailureCategory,
    cause: unknown
  ) {
    super("Training Content video worker polling failed.", { cause });
    this.name = "TrainingContentVideoWorkerPollError";
  }
}

interface TrainingContentVideoWorkerDependencies {
  config: TrainingContentVideoWorkerConfig;
  assetStore: TrainingContentAssetStore;
  objectStorage: TrainingContentObjectStorage;
  mediaProcessor: TrainingContentVideoMediaProcessor;
  temporaryRoot?: string;
  now?: () => Date;
  shutdownSignal?: AbortSignal;
}

const SYSTEM_ACTOR = {
  actorType: "system" as const,
  actorId: "training_content_video_worker",
};

export async function processNextTrainingContentVideo(
  dependencies: TrainingContentVideoWorkerDependencies
): Promise<TrainingContentVideoWorkerRunResult> {
  if (dependencies.shutdownSignal?.aborted) {
    return "idle";
  }
  const now = dependencies.now?.() ?? new Date();
  try {
    await dependencies.assetStore.rejectExhaustedVideoProcessing({
      maximumAttempts: dependencies.config.maximumAttempts,
      actor: SYSTEM_ACTOR,
      now,
    });
  } catch (error) {
    throw new TrainingContentVideoWorkerPollError("poll_sweep_failed", error);
  }
  let claim: ClaimedTrainingContentVideoProcessing | null;
  try {
    claim = await dependencies.assetStore.claimNextVideoProcessing({
      leaseSeconds: dependencies.config.leaseSeconds,
      maximumAttempts: dependencies.config.maximumAttempts,
      now,
    });
  } catch (error) {
    throw new TrainingContentVideoWorkerPollError("poll_claim_failed", error);
  }
  if (!claim) {
    return "idle";
  }

  const controller = new AbortController();
  const abortForShutdown = () => controller.abort();
  dependencies.shutdownSignal?.addEventListener("abort", abortForShutdown, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, dependencies.config.jobTimeoutMs);
  timeout.unref();

  let workspace: string | null = null;
  try {
    assertClaimMetadata(claim, dependencies.config.maximumInputBytes);
    await assertDiskCapacity({
      root: dependencies.temporaryRoot ?? tmpdir(),
      inputBytes: claim.asset.declaredByteSize!,
      minimumFreeBytes: dependencies.config.minimumFreeDiskBytes,
    });
    workspace = await mkdtemp(path.join(dependencies.temporaryRoot ?? tmpdir(), "peritio-video-"));
    const sourcePath = path.join(workspace, "source.mp4");
    const normalizedPath = path.join(workspace, "normalized.mp4");
    const sourceObject = await dependencies.objectStorage.headObject(
      claim.asset.temporaryObjectKey!,
      controller.signal
    );
    if (
      !sourceObject
      || sourceObject.byteSize !== claim.asset.byteSize
      || sourceObject.byteSize !== claim.asset.declaredByteSize
      || sourceObject.contentType?.trim().toLowerCase() !== "video/mp4"
    ) {
      throw permanentFailure(
        "source_object_invalid",
        "The temporary video object no longer matches its validated upload metadata."
      );
    }
    const downloaded = await dependencies.objectStorage.downloadObjectToFile({
      key: claim.asset.temporaryObjectKey!,
      destinationPath: sourcePath,
      maximumBytes: dependencies.config.maximumInputBytes,
      signal: controller.signal,
    });
    if (downloaded.byteSize !== sourceObject.byteSize) {
      throw permanentFailure("source_download_truncated", "The temporary video download was truncated.");
    }

    const sourceInspection = await dependencies.mediaProcessor.inspect(
      sourcePath,
      controller.signal
    );
    const decision = decideTrainingContentVideoProcessing(sourceInspection);
    await dependencies.mediaProcessor.verifyReadable(sourcePath, controller.signal);

    let candidatePath = sourcePath;
    let candidateByteSize = downloaded.byteSize;
    let result: TrainingContentVideoWorkerRunResult = "ready_bypassed";
    if (decision.normalizationRequired) {
      await dependencies.mediaProcessor.normalizeLosslessly(
        sourcePath,
        normalizedPath,
        controller.signal
      );
      const normalizedStat = await stat(normalizedPath);
      if (
        !normalizedStat.isFile()
        || normalizedStat.size <= 0
        || normalizedStat.size > dependencies.config.maximumInputBytes
      ) {
        throw permanentFailure(
          "normalized_output_invalid",
          "The normalized video output is empty or outside the configured size bound."
        );
      }
      const candidateInspection = await dependencies.mediaProcessor.inspect(
        normalizedPath,
        controller.signal
      );
      validateTrainingContentVideoCandidate({
        source: sourceInspection,
        candidate: candidateInspection,
      });
      await dependencies.mediaProcessor.verifyReadable(normalizedPath, controller.signal);
      candidatePath = normalizedPath;
      candidateByteSize = normalizedStat.size;
      result = "ready_normalized";
    }

    let finalObject;
    if (decision.normalizationRequired) {
      finalObject = await dependencies.objectStorage.uploadFileImmutable({
        key: claim.asset.finalObjectKey!,
        sourcePath: candidatePath,
        contentType: "video/mp4",
        contentLength: candidateByteSize,
        signal: controller.signal,
      });
    } else {
      await dependencies.objectStorage.copyObject({
        sourceKey: claim.asset.temporaryObjectKey!,
        destinationKey: claim.asset.finalObjectKey!,
        signal: controller.signal,
      });
      finalObject = await dependencies.objectStorage.headObject(
        claim.asset.finalObjectKey!,
        controller.signal
      );
    }
    if (
      !finalObject
      || finalObject.byteSize !== candidateByteSize
      || finalObject.contentType?.trim().toLowerCase() !== "video/mp4"
    ) {
      throw transientFailure(
        "final_object_confirmation_failed",
        "Object storage did not confirm the validated immutable video."
      );
    }

    const completed = await dependencies.assetStore.completeFinalization({
      orgId: claim.asset.orgId,
      contentId: claim.asset.contentId,
      assetId: claim.asset.id,
      finalObjectKey: claim.asset.finalObjectKey!,
      actualByteSize: finalObject.byteSize,
      detectedMimeType: "video/mp4",
      checksumOrEtag: finalObject.etag,
      processingLeaseToken: claim.leaseToken,
      actor: SYSTEM_ACTOR,
      now: dependencies.now?.() ?? new Date(),
    });
    await cleanupTemporaryObjectBestEffort({
      assetStore: dependencies.assetStore,
      objectStorage: dependencies.objectStorage,
      claim,
      ready: completed.asset.uploadState === "ready",
      now: dependencies.now?.() ?? new Date(),
    });
    return result;
  } catch (error) {
    const failure = normalizeFailure(error, timedOut);
    const canRetry = failure.transient
      && claim.asset.processingAttemptCount < dependencies.config.maximumAttempts;
    const retryAt = canRetry
      ? calculateRetryAt(
        dependencies.now?.() ?? new Date(),
        claim.asset.processingAttemptCount,
        dependencies.config.retryDelaySeconds
      )
      : null;
    try {
      await dependencies.assetStore.recordVideoProcessingFailure({
        orgId: claim.asset.orgId,
        contentId: claim.asset.contentId,
        assetId: claim.asset.id,
        leaseToken: claim.leaseToken,
        errorCategory: failure.category,
        retryAt,
        actor: SYSTEM_ACTOR,
        now: dependencies.now?.() ?? new Date(),
      });
    } catch {
      // A lost/expired lease must not let a stale worker overwrite newer durable state.
    }
    return retryAt ? "retry_scheduled" : "failed";
  } finally {
    clearTimeout(timeout);
    dependencies.shutdownSignal?.removeEventListener("abort", abortForShutdown);
    if (workspace) {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function assertClaimMetadata(
  claim: ClaimedTrainingContentVideoProcessing,
  maximumInputBytes: number
): void {
  const asset = claim.asset;
  if (
    !asset.temporaryObjectKey
    || !asset.finalObjectKey
    || asset.detectedMimeType !== "video/mp4"
    || asset.declaredMimeType !== "video/mp4"
    || !asset.declaredByteSize
    || !asset.byteSize
    || asset.declaredByteSize !== asset.byteSize
    || asset.byteSize > maximumInputBytes
  ) {
    throw permanentFailure(
      "processing_metadata_invalid",
      "The queued video is missing required validated processing metadata."
    );
  }
}

async function assertDiskCapacity(params: {
  root: string;
  inputBytes: number;
  minimumFreeBytes: number;
}): Promise<void> {
  const disk = await statfs(params.root);
  const availableBytes = disk.bavail * disk.bsize;
  const requiredBytes = params.inputBytes * 2 + params.minimumFreeBytes;
  if (!Number.isSafeInteger(availableBytes) || availableBytes < requiredBytes) {
    throw transientFailure(
      "insufficient_temporary_disk",
      "The worker does not have enough temporary disk space for this video."
    );
  }
}

async function cleanupTemporaryObjectBestEffort(params: {
  assetStore: TrainingContentAssetStore;
  objectStorage: TrainingContentObjectStorage;
  claim: ClaimedTrainingContentVideoProcessing;
  ready: boolean;
  now: Date;
}): Promise<void> {
  if (!params.ready || !params.claim.asset.temporaryObjectKey) {
    return;
  }
  try {
    await params.objectStorage.deleteObject(params.claim.asset.temporaryObjectKey);
    await params.assetStore.clearTemporaryObject({
      orgId: params.claim.asset.orgId,
      assetId: params.claim.asset.id,
      expectedTemporaryObjectKey: params.claim.asset.temporaryObjectKey,
      now: params.now,
    });
  } catch {
    // Ready is already committed; the existing cleanup path will retry this private object.
  }
}

function calculateRetryAt(
  now: Date,
  attemptCount: number,
  retryDelaySeconds: number[]
): Date {
  const index = Math.max(0, Math.min(retryDelaySeconds.length - 1, attemptCount - 1));
  return new Date(now.getTime() + retryDelaySeconds[index]! * 1000);
}

function normalizeFailure(
  error: unknown,
  timedOut: boolean
): TrainingContentVideoProcessingError {
  if (timedOut) {
    return transientFailure("processing_timeout", "Video processing exceeded its time limit.");
  }
  if (error instanceof TrainingContentVideoProcessingError) {
    return error;
  }
  return transientFailure(
    "processing_dependency_failed",
    "A video processing dependency failed temporarily."
  );
}

function permanentFailure(
  category: string,
  message: string
): TrainingContentVideoProcessingError {
  return new TrainingContentVideoProcessingError(category, false, message);
}

function transientFailure(
  category: string,
  message: string
): TrainingContentVideoProcessingError {
  return new TrainingContentVideoProcessingError(category, true, message);
}
