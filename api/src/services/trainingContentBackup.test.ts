import assert from "node:assert/strict";
import test from "node:test";

import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type {
  TrainingContentAssetRecord,
  TrainingContentAssetStore,
} from "../storage/trainingContentAssetStore.js";
import type {
  TrainingContentBackupCopyResult,
  TrainingContentBackupObjectStorage,
} from "../storage/trainingContentBackupStorage.js";
import { DefaultTrainingContentBackupService } from "./trainingContentBackup.js";

const NOW = new Date("2026-08-13T12:00:00.000Z");

const ENABLED_CONFIG: TrainingContentStorageConfig = {
  provider: "r2",
  r2: {
    environment: "staging",
    accountId: "abc123",
    bucket: "peritio-training-content-staging",
    accessKeyId: "live-access",
    secretAccessKey: "live-secret",
    endpoint: "https://abc123.r2.cloudflarestorage.com",
  },
  uploadUrlTtlSeconds: 600,
  downloadUrlTtlSeconds: 300,
  mediaAccessUrlTtlSeconds: 3600,
  maxPendingUploadBytesPerOrganization: 1024,
  fileSizeLimits: { video: 1024, audio: 1024, pdf: 1024, docx: 1024, image: 1024 },
  finalizationLeaseSeconds: 300,
  orphanGracePeriodSeconds: 3600,
  supersededRetentionDays: 30,
  backup: {
    enabled: true,
    r2: {
      environment: "staging",
      accountId: "abc123",
      bucket: "peritio-training-content-backup-staging",
      accessKeyId: "backup-access",
      secretAccessKey: "backup-secret",
      endpoint: "https://abc123.r2.cloudflarestorage.com",
    },
  },
};

function readyAsset(
  id: string,
  finalObjectKey: string,
  overrides: Partial<TrainingContentAssetRecord> = {}
): TrainingContentAssetRecord {
  return {
    id,
    orgId: "org_1",
    contentId: "11111111-1111-4111-8111-111111111111",
    assetRole: "primary",
    version: 1,
    uploadState: "ready",
    storageProvider: "r2",
    temporaryObjectKey: null,
    finalObjectKey,
    originalFilename: "guide.pdf",
    declaredMimeType: "application/pdf",
    detectedMimeType: "application/pdf",
    fileExtension: "pdf",
    declaredByteSize: 42,
    byteSize: 42,
    checksumOrEtag: '"etag"',
    uploadExpiresAt: null,
    finalizationNonce: "immutable-nonce",
    finalizationStartedAt: null,
    processingAttemptCount: 0,
    processingLeaseToken: null,
    processingLeaseExpiresAt: null,
    processingNextAttemptAt: null,
    processingErrorCategory: null,
    backedUpAt: null,
    backupAttemptCount: 0,
    replacementForAssetId: null,
    isCurrent: true,
    cleanupPending: false,
    rejectionReasonCategory: null,
    finalizedAt: NOW.toISOString(),
    supersededAt: null,
    objectDeletedAt: null,
    createdByActorId: "admin_1",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

class FakeBackupAssetStore {
  readonly assets: TrainingContentAssetRecord[];

  constructor(assets: TrainingContentAssetRecord[]) {
    this.assets = assets;
  }

  async markAssetBackedUp(assetId: string, backedUpAt: Date) {
    const asset = this.require(assetId);
    asset.backedUpAt ??= backedUpAt.toISOString();
    return structuredClone(asset);
  }

  async recordBackupFailure(assetId: string) {
    const asset = this.require(assetId);
    asset.backupAttemptCount += 1;
    return structuredClone(asset);
  }

  async listAssetsPendingBackup(limit: number) {
    return this.assets
      .filter((asset) => asset.uploadState === "ready" && !asset.backedUpAt && asset.finalObjectKey)
      .slice(0, limit)
      .map((asset) => structuredClone(asset));
  }

  async countAssetsPendingBackup() {
    return (await this.listAssetsPendingBackup(Number.MAX_SAFE_INTEGER)).length;
  }

  private require(assetId: string) {
    const asset = this.assets.find((candidate) => candidate.id === assetId);
    if (!asset) {
      throw new Error("asset_not_found");
    }
    return asset;
  }
}

class FakeBackupStorage implements TrainingContentBackupObjectStorage {
  readonly copies: Array<{ sourceBucket: string; sourceKey: string; destinationKey: string }> = [];
  results: TrainingContentBackupCopyResult[] = [];
  fail = false;
  failure: unknown = null;
  readonly failOnCopies = new Set<number>();

  async copyFromSource(params: {
    sourceBucket: string;
    sourceKey: string;
    destinationKey: string;
  }): Promise<TrainingContentBackupCopyResult> {
    this.copies.push(params);
    if (this.fail || this.failOnCopies.has(this.copies.length)) {
      throw this.failure ?? new Error("provider_failure");
    }
    return this.results.shift() ?? "copied";
  }

  async headObject(key: string) {
    return {
      key,
      byteSize: 42,
      contentType: "application/pdf",
      etag: '"backup"',
      lastModified: NOW.toISOString(),
    };
  }
}

function serviceHarness(assets: TrainingContentAssetRecord[], enabled = true) {
  const store = new FakeBackupAssetStore(assets);
  const storage = new FakeBackupStorage();
  const logs: string[] = [];
  const service = new DefaultTrainingContentBackupService({
    config: {
      ...ENABLED_CONFIG,
      backup: enabled ? ENABLED_CONFIG.backup : { enabled: false, r2: null },
    },
    assetStore: store as unknown as TrainingContentAssetStore,
    backupStorage: storage,
    now: () => NOW,
    logger: {
      info: (message?: unknown) => logs.push(String(message)),
      warn: (message?: unknown) => logs.push(String(message)),
    },
  });
  return { service, store, storage, logs };
}

test("finalized assets copy to the backup bucket with their exact immutable final key", async () => {
  const first = readyAsset("asset_1", "objects/org/content/primary/1/nonce-one");
  const replacement = readyAsset("asset_2", "objects/org/content/primary/2/nonce-two", { version: 2 });
  const harness = serviceHarness([first, replacement]);

  assert.equal(await harness.service.backupFinalizedAsset(first), "copied");
  assert.deepEqual(harness.storage.copies[0], {
    sourceBucket: "peritio-training-content-staging",
    sourceKey: first.finalObjectKey,
    destinationKey: first.finalObjectKey,
  });
  assert.equal(first.backedUpAt, NOW.toISOString());
  assert.notEqual(first.finalObjectKey, replacement.finalObjectKey);
  assert.equal(harness.logs.some((line) => line.includes(first.finalObjectKey!)), false);
});

test("immutable already-present copies converge to durable backup success", async () => {
  const asset = readyAsset("asset_1", "objects/org/content/primary/1/nonce");
  const harness = serviceHarness([asset]);
  harness.storage.results.push("already_present");

  assert.equal(await harness.service.backupFinalizedAsset(asset), "already_present");
  assert.equal(asset.backedUpAt, NOW.toISOString());
  assert.equal(asset.backupAttemptCount, 0);
});

test("backup failures are absorbed, counted separately, and leave ready state unchanged", async () => {
  const asset = readyAsset("asset_1", "objects/org/content/primary/1/nonce");
  const harness = serviceHarness([asset]);
  harness.storage.fail = true;

  assert.equal(await harness.service.backupFinalizedAsset(asset), "failed");
  assert.equal(asset.uploadState, "ready");
  assert.equal(asset.backedUpAt, null);
  assert.equal(asset.backupAttemptCount, 1);
  assert.equal(harness.logs.some((line) => line.includes("provider_failure")), true);
});

test("provider failures expose sanitized S3 diagnostics without storage or credential leakage", async () => {
  const asset = readyAsset(
    "asset_1",
    "objects/org-sensitive/content/primary/1/private-finalization-nonce",
    { originalFilename: "customer-plan.pdf" }
  );
  const harness = serviceHarness([asset]);
  const providerMessage = [
    "Invalid Argument: copy source bucket name error",
    ENABLED_CONFIG.r2!.bucket,
    asset.finalObjectKey,
    asset.originalFilename,
    ENABLED_CONFIG.backup.r2!.endpoint,
    ENABLED_CONFIG.backup.r2!.accessKeyId,
    ENABLED_CONFIG.backup.r2!.secretAccessKey,
  ].join(" | ");
  harness.storage.fail = true;
  harness.storage.failure = Object.assign(new Error(providerMessage), {
    name: "InvalidArgument",
    Code: "InvalidArgument",
    Message: providerMessage,
    $metadata: {
      httpStatusCode: 400,
      requestId: "cf-request-123",
    },
  });

  assert.equal(await harness.service.backupFinalizedAsset(asset), "failed");
  const warning = harness.logs.at(-1) ?? "";
  assert.match(warning, /category=provider_http_400/);
  assert.match(warning, /providerCode=invalidargument/);
  assert.match(warning, /providerMessage="Invalid Argument: copy source bucket name error/);
  assert.match(warning, /requestId=cf-request-123/);
  for (const sensitiveValue of [
    ENABLED_CONFIG.r2!.bucket,
    asset.finalObjectKey!,
    asset.originalFilename,
    ENABLED_CONFIG.backup.r2!.endpoint,
    ENABLED_CONFIG.backup.r2!.accessKeyId,
    ENABLED_CONFIG.backup.r2!.secretAccessKey,
  ].filter((value): value is string => typeof value === "string")) {
    assert.equal(warning.includes(sensitiveValue), false);
  }
  assert.doesNotMatch(warning, /https?:\/\//i);
  assert.doesNotMatch(warning, /objects\//i);
});

test("disabled backup performs no network or durable backup calls", async () => {
  const asset = readyAsset("asset_1", "objects/org/content/primary/1/nonce");
  const harness = serviceHarness([asset], false);

  assert.equal(await harness.service.backupFinalizedAsset(asset), "disabled");
  assert.equal(harness.storage.copies.length, 0);
  assert.equal(asset.backedUpAt, null);
});

test("reconciliation is bounded and reports copied, existing, failed, and remaining assets", async () => {
  const assets = [
    readyAsset("asset_1", "objects/org/content/primary/1/one"),
    readyAsset("asset_2", "objects/org/content/primary/2/two"),
    readyAsset("asset_3", "objects/org/content/primary/3/three"),
    readyAsset("asset_4", "objects/org/content/primary/4/four"),
  ];
  const harness = serviceHarness(assets);
  harness.storage.results.push("copied", "already_present");
  harness.storage.failOnCopies.add(3);

  assert.deepEqual(await harness.service.reconcilePendingBackups(3), {
    scanned: 3,
    backedUp: 1,
    alreadyPresent: 1,
    failed: 1,
    stillPending: 2,
  });
  assert.equal(harness.storage.copies.length, 3);
  assert.equal(assets[2]?.backupAttemptCount, 1);
  assert.equal(assets[3]?.backupAttemptCount, 0);
});
