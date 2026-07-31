import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  ClaimedTrainingContentVideoProcessing,
  TrainingContentAssetRecord,
  TrainingContentAssetStore,
} from "../storage/trainingContentAssetStore.js";
import type {
  TrainingContentObjectStorage,
  TrainingContentStoredObject,
} from "../storage/trainingContentObjectStorage.js";
import type {
  TrainingContentVideoInspection,
  TrainingContentVideoMediaProcessor,
} from "./trainingContentVideoMedia.js";
import {
  TrainingContentVideoProcessingError,
} from "./trainingContentVideoMedia.js";
import {
  processNextTrainingContentVideo,
  TrainingContentVideoWorkerConfig,
} from "./trainingContentVideoWorker.js";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const SOURCE_BYTES = Buffer.from("synthetic-mp4-bytes", "ascii");

function asset(overrides: Partial<TrainingContentAssetRecord> = {}): TrainingContentAssetRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orgId: "org_1",
    contentId: "22222222-2222-4222-8222-222222222222",
    assetRole: "primary",
    version: 1,
    uploadState: "processing",
    storageProvider: "r2",
    temporaryObjectKey: "tmp/org/content/asset/nonce",
    finalObjectKey: "objects/org/content/primary/1/nonce",
    originalFilename: "coaching.mp4",
    declaredMimeType: "video/mp4",
    detectedMimeType: "video/mp4",
    fileExtension: "mp4",
    declaredByteSize: SOURCE_BYTES.byteLength,
    byteSize: SOURCE_BYTES.byteLength,
    checksumOrEtag: "\"source\"",
    uploadExpiresAt: NOW.toISOString(),
    finalizationNonce: "nonce_nonce_nonce_nonce",
    finalizationStartedAt: null,
    processingAttemptCount: 0,
    processingLeaseToken: null,
    processingLeaseExpiresAt: null,
    processingNextAttemptAt: null,
    processingErrorCategory: null,
    replacementForAssetId: null,
    isCurrent: false,
    cleanupPending: false,
    rejectionReasonCategory: null,
    finalizedAt: null,
    supersededAt: null,
    objectDeletedAt: null,
    createdByActorId: "admin_1",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function inspection(normalizationRequired: boolean): TrainingContentVideoInspection {
  return {
    formatNames: ["mov", "mp4"],
    durationSeconds: 10,
    video: {
      codecName: "h264",
      profile: "Main",
      level: 40,
      width: 64,
      height: 36,
      codedWidth: 64,
      codedHeight: 36,
      sampleAspectRatio: "1:1",
      displayAspectRatio: "16:9",
      rotationDegrees: 0,
      sideDataTypes: [],
      colorRange: "tv",
      colorSpace: "bt709",
      colorTransfer: "bt709",
      colorPrimaries: "bt709",
      durationSeconds: 10,
    },
    firstFrame: {
      width: 64,
      height: 36,
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
      cropBottom: 0,
      sampleAspectRatio: "1:1",
      sideDataTypes: [],
    },
    audio: [{ codecName: "aac", profile: "LC", durationSeconds: 10 }],
    container: {
      trackWidth: normalizationRequired ? 96 : 64,
      trackHeight: normalizationRequired ? 54 : 36,
      sampleEntryType: "avc1",
      sampleEntryWidth: normalizationRequired ? 96 : 64,
      sampleEntryHeight: normalizationRequired ? 54 : 36,
      cleanApertureWidth: null,
      cleanApertureHeight: null,
    },
  };
}

class FakeAssetStore {
  current = asset();
  claimed = false;
  completeCount = 0;
  failureCount = 0;
  clearCount = 0;
  exhaustedSweepCount = 0;

  async rejectExhaustedVideoProcessing() {
    this.exhaustedSweepCount += 1;
    return 0;
  }

  async claimNextVideoProcessing(): Promise<ClaimedTrainingContentVideoProcessing | null> {
    if (this.claimed || this.current.uploadState !== "processing") {
      return null;
    }
    this.claimed = true;
    this.current.processingAttemptCount += 1;
    this.current.processingLeaseToken = "lease_1";
    this.current.processingLeaseExpiresAt = new Date(NOW.getTime() + 1_800_000).toISOString();
    return { asset: structuredClone(this.current), leaseToken: "lease_1" };
  }

  async completeFinalization(params: any) {
    assert.equal(params.processingLeaseToken, this.current.processingLeaseToken);
    this.completeCount += 1;
    this.current.uploadState = "ready";
    this.current.isCurrent = true;
    this.current.finalizedAt = NOW.toISOString();
    this.current.byteSize = params.actualByteSize;
    this.current.processingLeaseToken = null;
    this.current.processingLeaseExpiresAt = null;
    this.current.cleanupPending = Boolean(this.current.temporaryObjectKey);
    return { asset: structuredClone(this.current), replacedAsset: null };
  }

  async recordVideoProcessingFailure(params: any) {
    this.failureCount += 1;
    this.current.processingLeaseToken = null;
    this.current.processingLeaseExpiresAt = null;
    this.current.processingErrorCategory = params.errorCategory;
    this.current.processingNextAttemptAt = params.retryAt?.toISOString() ?? null;
    if (!params.retryAt) {
      this.current.uploadState = "rejected";
      this.current.rejectionReasonCategory = `video_processing_${params.errorCategory}`;
      this.current.cleanupPending = true;
    }
    return structuredClone(this.current);
  }

  async clearTemporaryObject() {
    this.clearCount += 1;
    this.current.temporaryObjectKey = null;
    this.current.cleanupPending = false;
  }
}

class FakeObjectStorage {
  readonly provider = "r2" as const;
  readonly objects = new Map<string, {
    bytes: Buffer;
    contentType: string;
    etag: string;
  }>();
  copyCount = 0;
  uploadCount = 0;
  deleteCount = 0;
  failHead = false;

  constructor() {
    this.objects.set("tmp/org/content/asset/nonce", {
      bytes: SOURCE_BYTES,
      contentType: "video/mp4",
      etag: "\"source\"",
    });
  }

  async headObject(key: string): Promise<TrainingContentStoredObject | null> {
    if (this.failHead) {
      throw new Error("transient provider failure");
    }
    const object = this.objects.get(key);
    return object ? {
      key,
      byteSize: object.bytes.byteLength,
      contentType: object.contentType,
      etag: object.etag,
      lastModified: NOW.toISOString(),
    } : null;
  }

  async downloadObjectToFile(params: any) {
    const object = this.objects.get(params.key)!;
    await writeFile(params.destinationPath, object.bytes, { flag: "wx" });
    return { byteSize: object.bytes.byteLength };
  }

  async copyObject(params: any) {
    this.copyCount += 1;
    const source = this.objects.get(params.sourceKey)!;
    this.objects.set(params.destinationKey, {
      ...source,
      bytes: Buffer.from(source.bytes),
    });
  }

  async uploadFileImmutable(params: any): Promise<TrainingContentStoredObject> {
    this.uploadCount += 1;
    const bytes = await readFile(params.sourcePath);
    this.objects.set(params.key, {
      bytes,
      contentType: params.contentType,
      etag: "\"normalized\"",
    });
    return (await this.headObject(params.key))!;
  }

  async deleteObject(key: string) {
    this.deleteCount += 1;
    this.objects.delete(key);
  }
}

class FakeMediaProcessor implements TrainingContentVideoMediaProcessor {
  normalizeCount = 0;
  verifyCount = 0;
  failNormalization = false;
  corruptOutput = false;

  constructor(readonly requiresNormalization: boolean) {}

  async verifyRuntime() {}

  async inspect(filePath: string) {
    return inspection(this.requiresNormalization && !filePath.endsWith("normalized.mp4"));
  }

  async verifyReadable() {
    this.verifyCount += 1;
  }

  async normalizeLosslessly(sourcePath: string, destinationPath: string) {
    this.normalizeCount += 1;
    if (this.failNormalization) {
      throw new TrainingContentVideoProcessingError(
        "media_remux_failed",
        false,
        "Synthetic FFmpeg failure."
      );
    }
    if (this.corruptOutput) {
      await writeFile(destinationPath, Buffer.alloc(0), { flag: "wx" });
      return;
    }
    await copyFile(sourcePath, destinationPath);
  }
}

const WORKER_CONFIG: TrainingContentVideoWorkerConfig = {
  maximumInputBytes: 1024,
  minimumFreeDiskBytes: 1,
  jobTimeoutMs: 10_000,
  leaseSeconds: 30,
  maximumAttempts: 3,
  retryDelaySeconds: [60, 300, 900],
};

test("healthy video is validated, immutably promoted without remux, and fully cleaned up", async () => {
  await withWorker(async ({ root, store, storage }) => {
    const media = new FakeMediaProcessor(false);
    const result = await runWorker(root, store, storage, media);
    assert.equal(result, "ready_bypassed");
    assert.equal(media.normalizeCount, 0);
    assert.equal(storage.copyCount, 1);
    assert.equal(storage.uploadCount, 0);
    assert.equal(store.current.uploadState, "ready");
    assert.equal(store.completeCount, 1);
    assert.equal(storage.deleteCount, 1);
    assert.equal(store.clearCount, 1);
    assert.deepEqual(await readdir(root), []);
  });
});

test("mismatched video is losslessly remuxed, revalidated with audio retained, then published", async () => {
  await withWorker(async ({ root, store, storage }) => {
    const media = new FakeMediaProcessor(true);
    const result = await runWorker(root, store, storage, media);
    assert.equal(result, "ready_normalized");
    assert.equal(media.normalizeCount, 1);
    assert.equal(media.verifyCount, 2);
    assert.equal(storage.copyCount, 0);
    assert.equal(storage.uploadCount, 1);
    assert.equal(store.current.uploadState, "ready");
    assert.deepEqual(await readdir(root), []);
  });
});

test("FFmpeg failure and corrupt output never publish an immutable object", async () => {
  for (const mode of ["ffmpeg", "corrupt"] as const) {
    await withWorker(async ({ root, store, storage }) => {
      const media = new FakeMediaProcessor(true);
      media.failNormalization = mode === "ffmpeg";
      media.corruptOutput = mode === "corrupt";
      const result = await runWorker(root, store, storage, media);
      assert.equal(result, "failed");
      assert.equal(store.current.uploadState, "rejected");
      assert.equal(store.completeCount, 0);
      assert.equal(storage.copyCount, 0);
      assert.equal(storage.uploadCount, 0);
      assert.equal(storage.objects.has(store.current.finalObjectKey!), false);
      assert.deepEqual(await readdir(root), []);
    });
  }
});

test("durable claim prevents duplicate workers from processing the same asset", async () => {
  await withWorker(async ({ root, store, storage }) => {
    const media = new FakeMediaProcessor(false);
    const results = await Promise.all([
      runWorker(root, store, storage, media),
      runWorker(root, store, storage, media),
    ]);
    assert.deepEqual(results.sort(), ["idle", "ready_bypassed"]);
    assert.equal(storage.copyCount, 1);
    assert.equal(store.completeCount, 1);
  });
});

test("transient failure schedules a bounded retry and the final allowed attempt becomes failed", async () => {
  await withWorker(async ({ root, store, storage }) => {
    storage.failHead = true;
    assert.equal(
      await runWorker(root, store, storage, new FakeMediaProcessor(false)),
      "retry_scheduled"
    );
    assert.equal(store.current.uploadState, "processing");
    assert.equal(store.failureCount, 1);
    assert.equal(store.current.processingNextAttemptAt, "2026-07-30T12:01:00.000Z");
  });
  await withWorker(async ({ root, store, storage }) => {
    store.current.processingAttemptCount = 2;
    storage.failHead = true;
    assert.equal(
      await runWorker(root, store, storage, new FakeMediaProcessor(false)),
      "failed"
    );
    assert.equal(store.current.uploadState, "rejected");
    assert.equal(store.current.processingNextAttemptAt, null);
  });
});

async function runWorker(
  root: string,
  store: FakeAssetStore,
  storage: FakeObjectStorage,
  media: FakeMediaProcessor
) {
  return processNextTrainingContentVideo({
    config: WORKER_CONFIG,
    assetStore: store as unknown as TrainingContentAssetStore,
    objectStorage: storage as unknown as TrainingContentObjectStorage,
    mediaProcessor: media,
    temporaryRoot: root,
    now: () => NOW,
  });
}

async function withWorker(
  callback: (harness: {
    root: string;
    store: FakeAssetStore;
    storage: FakeObjectStorage;
  }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "peritio-worker-test-"));
  try {
    await callback({
      root,
      store: new FakeAssetStore(),
      storage: new FakeObjectStorage(),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
