import assert from "node:assert/strict";
import test from "node:test";

import { TrainingContentCleanupService } from "./trainingContentCleanup.js";
import { TrainingContentStorageReadinessService } from "./trainingContentStorageReadiness.js";
import type {
  TrainingContentAssetCleanupCandidate,
  TrainingContentAssetRecord,
} from "../storage/trainingContentAssetStore.js";
import { loadTrainingContentStorageConfig } from "../trainingContentStorageConfig.js";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function asset(
  id: string,
  overrides: Partial<TrainingContentAssetRecord> = {}
): TrainingContentAssetRecord {
  return {
    id,
    orgId: "org_1",
    contentId: "11111111-1111-4111-8111-111111111111",
    assetRole: "primary",
    version: 1,
    uploadState: "pending",
    storageProvider: "r2",
    temporaryObjectKey: `tmp/org/content/${id}/nonce`,
    finalObjectKey: null,
    originalFilename: "reference.pdf",
    declaredMimeType: "application/pdf",
    detectedMimeType: null,
    fileExtension: "pdf",
    declaredByteSize: 8,
    byteSize: null,
    checksumOrEtag: null,
    uploadExpiresAt: "2026-07-28T11:00:00.000Z",
    finalizationNonce: "nonce_nonce_nonce_nonce",
    finalizationStartedAt: null,
    processingAttemptCount: 0,
    processingLeaseToken: null,
    processingLeaseExpiresAt: null,
    processingNextAttemptAt: null,
    processingErrorCategory: null,
    backedUpAt: null,
    backupAttemptCount: 0,
    replacementForAssetId: null,
    isCurrent: false,
    cleanupPending: false,
    rejectionReasonCategory: null,
    finalizedAt: null,
    supersededAt: null,
    objectDeletedAt: null,
    createdByActorId: "admin_1",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:00.000Z",
    ...overrides,
  };
}

function buildHarness() {
  const expired = asset("expired");
  const readyWithTemp = asset("ready_temp", {
    uploadState: "ready",
    isCurrent: true,
    finalObjectKey: "objects/org/content/primary/1/current",
    detectedMimeType: "application/pdf",
    byteSize: 8,
    finalizedAt: "2026-07-01T00:00:00.000Z",
    uploadExpiresAt: null,
    cleanupPending: true,
  });
  const superseded = asset("superseded", {
    uploadState: "superseded",
    isCurrent: false,
    temporaryObjectKey: null,
    finalObjectKey: "objects/org/content/primary/1/superseded",
    detectedMimeType: "application/pdf",
    byteSize: 8,
    finalizedAt: "2026-01-01T00:00:00.000Z",
    supersededAt: "2026-01-02T00:00:00.000Z",
    uploadExpiresAt: null,
  });
  const maliciousCurrentCandidate = asset("current_guard", {
    uploadState: "ready",
    isCurrent: true,
    temporaryObjectKey: null,
    finalObjectKey: "objects/org/content/primary/2/current-guard",
    detectedMimeType: "application/pdf",
    byteSize: 8,
    finalizedAt: "2026-01-01T00:00:00.000Z",
    uploadExpiresAt: null,
  });
  const candidates: TrainingContentAssetCleanupCandidate[] = [
    { asset: expired, reason: "expired_pending" },
    { asset: readyWithTemp, reason: "temporary_after_finalization" },
    { asset: superseded, reason: "superseded_retention" },
    { asset: maliciousCurrentCandidate, reason: "superseded_retention" },
  ];
  const calls = {
    expire: 0,
    clearTemporary: 0,
    markFinalDeleted: 0,
    deletedKeys: [] as string[],
  };
  const referenced = new Set([
    readyWithTemp.finalObjectKey!,
    superseded.finalObjectKey!,
    maliciousCurrentCandidate.finalObjectKey!,
  ]);
  const oldOrphan = "objects/org/content/primary/9/old-orphan";
  const recentOrphan = "objects/org/content/primary/10/recent-orphan";
  const objectStorage = {
    provider: "r2" as const,
    async verifyReadiness() {},
    async deleteObject(key: string) {
      calls.deletedKeys.push(key);
    },
    async listObjects() {
      return {
        objects: [
          {
            key: readyWithTemp.finalObjectKey!,
            byteSize: 8,
            contentType: null,
            etag: null,
            lastModified: "2026-01-01T00:00:00.000Z",
          },
          {
            key: oldOrphan,
            byteSize: 8,
            contentType: null,
            etag: null,
            lastModified: "2026-07-20T00:00:00.000Z",
          },
          {
            key: recentOrphan,
            byteSize: 8,
            contentType: null,
            etag: null,
            lastModified: "2026-07-28T11:30:00.000Z",
          },
        ],
        continuationToken: null,
      };
    },
  };
  const assetStore = {
    async listCleanupCandidates() {
      return candidates;
    },
    async expirePendingAsset() {
      calls.expire += 1;
      return expired;
    },
    async clearTemporaryObject() {
      calls.clearTemporary += 1;
    },
    async markFinalObjectDeleted() {
      calls.markFinalDeleted += 1;
    },
    async listReferencedFinalObjectKeys() {
      return new Set(referenced);
    },
  };
  const config = loadTrainingContentStorageConfig({
    TRAINING_CONTENT_STORAGE_PROVIDER: "r2",
    TRAINING_CONTENT_R2_ENVIRONMENT: "staging",
    TRAINING_CONTENT_R2_ACCOUNT_ID: "abc123",
    TRAINING_CONTENT_R2_BUCKET: "peritio-training-content-staging",
    TRAINING_CONTENT_R2_ACCESS_KEY_ID: "test-access-key",
    TRAINING_CONTENT_R2_SECRET_ACCESS_KEY: "test-secret-key",
    TRAINING_CONTENT_R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
  }, "staging");
  const readiness = new TrainingContentStorageReadinessService(config, objectStorage as any);
  const cleanup = new TrainingContentCleanupService({
    config,
    assetStore: assetStore as any,
    objectStorage: objectStorage as any,
    readiness,
  });
  return {
    cleanup,
    calls,
    expired,
    readyWithTemp,
    superseded,
    maliciousCurrentCandidate,
    oldOrphan,
    recentOrphan,
  };
}

test("Training Content cleanup is dry-run by default and performs zero writes", async () => {
  const harness = buildHarness();
  const report = await harness.cleanup.run({ now: NOW });
  assert.equal(report.dryRun, true);
  assert.equal(report.expiredAssetCount, 1);
  assert.equal(report.temporaryObjectDeleteCount, 2);
  assert.equal(report.finalObjectDeleteCount, 1);
  assert.equal(report.orphanFinalObjectDeleteCount, 1);
  assert.equal(report.skippedRecentOrphanCount, 1);
  assert.deepEqual(harness.calls, {
    expire: 0,
    clearTemporary: 0,
    markFinalDeleted: 0,
    deletedKeys: [],
  });
});

test("applied cleanup handles terminal objects and never deletes a current ready asset", async () => {
  const harness = buildHarness();
  const report = await harness.cleanup.run({ apply: true, now: NOW });
  assert.equal(report.dryRun, false);
  assert.equal(harness.calls.expire, 1);
  assert.equal(harness.calls.clearTemporary, 2);
  assert.equal(harness.calls.markFinalDeleted, 1);
  assert.equal(harness.calls.deletedKeys.includes(harness.expired.temporaryObjectKey!), true);
  assert.equal(harness.calls.deletedKeys.includes(harness.readyWithTemp.temporaryObjectKey!), true);
  assert.equal(harness.calls.deletedKeys.includes(harness.superseded.finalObjectKey!), true);
  assert.equal(harness.calls.deletedKeys.includes(harness.oldOrphan), true);
  assert.equal(harness.calls.deletedKeys.includes(harness.recentOrphan), false);
  assert.equal(
    harness.calls.deletedKeys.includes(harness.maliciousCurrentCandidate.finalObjectKey!),
    false
  );
});
