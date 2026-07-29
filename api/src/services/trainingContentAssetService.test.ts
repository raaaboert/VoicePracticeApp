import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { TrainingContentItem } from "@voicepractice/shared";

import { buildDashboardAdminCapabilities } from "./dashboardAuthorization.js";
import {
  createTrainingContentAssetService,
  TrainingContentAssetServiceError,
} from "./trainingContentAssetService.js";
import { TrainingContentStorageReadinessService } from "./trainingContentStorageReadiness.js";
import type {
  CreatePendingTrainingContentAssetInput,
  TrainingContentAssetCleanupCandidate,
  TrainingContentAssetRecord,
  TrainingContentAssetStore,
} from "../storage/trainingContentAssetStore.js";
import {
  createTrainingContentFinalObjectKey,
  createTrainingContentFinalizationNonce,
  createTrainingContentTemporaryObjectKey,
} from "../storage/trainingContentObjectKeys.js";
import type {
  TrainingContentObjectStorage,
  TrainingContentStoredObject,
} from "../storage/trainingContentObjectStorage.js";
import { loadTrainingContentStorageConfig } from "../trainingContentStorageConfig.js";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const PDF_BYTES = Buffer.from("%PDF-1.7", "ascii");

function buildContent(overrides: Partial<TrainingContentItem> = {}): TrainingContentItem {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    orgId: overrides.orgId ?? "org_1",
    title: overrides.title ?? "Reference PDF",
    description: overrides.description ?? "",
    focusTopicId: overrides.focusTopicId ?? null,
    focusTopicNameSnapshot: overrides.focusTopicNameSnapshot ?? null,
    contentType: overrides.contentType ?? "pdf",
    publicationState: overrides.publicationState ?? "draft",
    nativeBody: overrides.nativeBody ?? null,
    externalUrl: overrides.externalUrl ?? null,
    displayOrder: overrides.displayOrder ?? 0,
    contentVersion: overrides.contentVersion ?? 1,
    createdByActorId: overrides.createdByActorId ?? "admin_1",
    updatedByActorId: overrides.updatedByActorId ?? "admin_1",
    createdAt: overrides.createdAt ?? NOW.toISOString(),
    updatedAt: overrides.updatedAt ?? NOW.toISOString(),
    publishedAt: overrides.publishedAt ?? null,
    archivedAt: overrides.archivedAt ?? null,
  };
}

class FakeAssetStore implements TrainingContentAssetStore {
  readonly contents = new Map<string, TrainingContentItem>();
  readonly assets = new Map<string, TrainingContentAssetRecord>();
  readonly audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
  failCompleteOnce = false;

  constructor(content = buildContent()) {
    this.contents.set(`${content.orgId}:${content.id}`, content);
  }

  async initialize() {}

  async getContentItemForOrg(orgId: string, contentId: string) {
    return this.contents.get(`${orgId}:${contentId}`) ?? null;
  }

  async getAssetForOrg(orgId: string, contentId: string, assetId: string) {
    const asset = this.assets.get(assetId);
    return asset?.orgId === orgId && asset.contentId === contentId ? clone(asset) : null;
  }

  async createPendingAsset(input: CreatePendingTrainingContentAssetInput) {
    const content = await this.getContentItemForOrg(input.orgId, input.contentId);
    if (!content) {
      throw new Error("content missing");
    }
    const current = [...this.assets.values()].find((asset) =>
      asset.orgId === input.orgId
      && asset.contentId === input.contentId
      && asset.assetRole === input.assetRole
      && asset.isCurrent
    );
    if (current?.id !== (input.replacementAssetId ?? undefined)) {
      if (current || input.replacementAssetId) {
        throw new Error("replacement conflict");
      }
    }
    const version = Math.max(
      0,
      ...[...this.assets.values()]
        .filter((asset) =>
          asset.orgId === input.orgId
          && asset.contentId === input.contentId
          && asset.assetRole === input.assetRole
        )
        .map((asset) => asset.version)
    ) + 1;
    const id = randomUUID();
    const finalizationNonce = createTrainingContentFinalizationNonce();
    const asset: TrainingContentAssetRecord = {
      id,
      orgId: input.orgId,
      contentId: input.contentId,
      assetRole: input.assetRole,
      version,
      uploadState: "pending",
      storageProvider: "r2",
      temporaryObjectKey: createTrainingContentTemporaryObjectKey({
        orgId: input.orgId,
        contentId: input.contentId,
        assetId: id,
      }),
      finalObjectKey: null,
      originalFilename: input.originalFilename,
      declaredMimeType: input.declaredMimeType,
      detectedMimeType: null,
      fileExtension: input.fileExtension,
      declaredByteSize: input.declaredByteSize,
      byteSize: null,
      checksumOrEtag: null,
      uploadExpiresAt: new Date(
        (input.now ?? NOW).getTime() + input.uploadTtlSeconds * 1000
      ).toISOString(),
      finalizationNonce,
      finalizationStartedAt: null,
      replacementForAssetId: input.replacementAssetId,
      isCurrent: false,
      cleanupPending: false,
      rejectionReasonCategory: null,
      finalizedAt: null,
      supersededAt: null,
      objectDeletedAt: null,
      createdByActorId: input.actor.actorId,
      createdAt: (input.now ?? NOW).toISOString(),
      updatedAt: (input.now ?? NOW).toISOString(),
    };
    this.assets.set(asset.id, asset);
    this.recordAudit("training_content_upload_initiated", asset);
    return { content, asset: clone(asset) };
  }

  async rejectAsset(params: any) {
    const asset = this.requireAsset(params.assetId);
    asset.uploadState = "rejected";
    asset.rejectionReasonCategory = params.reasonCategory;
    asset.cleanupPending = true;
    asset.isCurrent = false;
    asset.updatedAt = (params.now ?? NOW).toISOString();
    this.recordAudit("training_content_asset_rejected", asset, {
      rejectionReasonCategory: params.reasonCategory,
    });
    return clone(asset);
  }

  async claimFinalization(params: any): Promise<any> {
    const asset = this.requireAsset(params.assetId);
    if (asset.uploadState === "ready") {
      return { status: "ready", asset: clone(asset), recovered: false };
    }
    if (asset.uploadState === "rejected" || asset.uploadState === "expired") {
      return { status: "terminal", asset: clone(asset), recovered: false };
    }
    const now = params.now ?? NOW;
    if (
      asset.uploadState !== "processing"
      && asset.uploadExpiresAt
      && new Date(asset.uploadExpiresAt).getTime() <= now.getTime()
    ) {
      asset.uploadState = "expired";
      asset.cleanupPending = true;
      this.recordAudit("training_content_asset_expired", asset);
      return { status: "expired", asset: clone(asset), recovered: false };
    }
    if (asset.uploadState === "processing" && asset.finalizationStartedAt) {
      const age = now.getTime() - new Date(asset.finalizationStartedAt).getTime();
      if (age < params.leaseSeconds * 1000) {
        return { status: "busy", asset: clone(asset), recovered: false };
      }
    }
    const recovered = asset.uploadState === "processing";
    asset.uploadState = "processing";
    asset.finalObjectKey ??= createTrainingContentFinalObjectKey({
      orgId: asset.orgId,
      contentId: asset.contentId,
      assetRole: asset.assetRole,
      version: asset.version,
      finalizationNonce: asset.finalizationNonce!,
    });
    asset.finalizationStartedAt = now.toISOString();
    asset.byteSize = params.actualByteSize;
    asset.detectedMimeType = params.detectedMimeType;
    asset.checksumOrEtag = params.checksumOrEtag;
    asset.updatedAt = now.toISOString();
    return { status: "claimed", asset: clone(asset), recovered };
  }

  async completeFinalization(params: any) {
    if (this.failCompleteOnce) {
      this.failCompleteOnce = false;
      throw new Error("simulated database commit failure");
    }
    const asset = this.requireAsset(params.assetId);
    if (asset.uploadState === "ready") {
      return { asset: clone(asset), replacedAsset: null };
    }
    let replacedAsset: TrainingContentAssetRecord | null = null;
    if (asset.replacementForAssetId) {
      const current = this.requireAsset(asset.replacementForAssetId);
      current.uploadState = "superseded";
      current.isCurrent = false;
      current.supersededAt = (params.now ?? NOW).toISOString();
      current.updatedAt = (params.now ?? NOW).toISOString();
      replacedAsset = clone(current);
    }
    asset.uploadState = "ready";
    asset.isCurrent = true;
    asset.finalizationStartedAt = null;
    asset.finalizedAt = (params.now ?? NOW).toISOString();
    asset.byteSize = params.actualByteSize;
    asset.detectedMimeType = params.detectedMimeType;
    asset.checksumOrEtag = params.checksumOrEtag;
    asset.cleanupPending = Boolean(asset.temporaryObjectKey);
    asset.updatedAt = (params.now ?? NOW).toISOString();
    this.recordAudit("training_content_asset_finalized", asset);
    if (replacedAsset) {
      this.recordAudit("training_content_asset_replaced", asset, {
        replacedAssetId: replacedAsset.id,
      });
    }
    return { asset: clone(asset), replacedAsset };
  }

  async clearTemporaryObject(params: any) {
    const asset = this.requireAsset(params.assetId);
    if (asset.temporaryObjectKey === params.expectedTemporaryObjectKey) {
      asset.temporaryObjectKey = null;
      asset.cleanupPending = false;
      asset.updatedAt = (params.now ?? NOW).toISOString();
    }
  }

  async listCleanupCandidates(): Promise<TrainingContentAssetCleanupCandidate[]> {
    return [];
  }

  async expirePendingAsset(params: any) {
    const asset = this.assets.get(params.assetId);
    if (!asset) {
      return null;
    }
    if (asset.uploadState === "pending") {
      asset.uploadState = "expired";
      asset.cleanupPending = true;
      this.recordAudit("training_content_asset_expired", asset);
    }
    return clone(asset);
  }

  async markFinalObjectDeleted() {}

  async listReferencedFinalObjectKeys() {
    return new Set(
      [...this.assets.values()]
        .map((asset) => asset.finalObjectKey)
        .filter((key): key is string => Boolean(key))
    );
  }

  private requireAsset(assetId: string): TrainingContentAssetRecord {
    const asset = this.assets.get(assetId);
    if (!asset) {
      throw new Error("asset missing");
    }
    return asset;
  }

  private recordAudit(
    action: string,
    asset: TrainingContentAssetRecord,
    extra: Record<string, unknown> = {}
  ) {
    this.audits.push({
      action,
      metadata: {
        orgId: asset.orgId,
        contentId: asset.contentId,
        assetId: asset.id,
        assetRole: asset.assetRole,
        version: asset.version,
        uploadState: asset.uploadState,
        ...extra,
      },
    });
  }
}

class FakeObjectStorage implements TrainingContentObjectStorage {
  readonly provider = "r2" as const;
  readonly objects = new Map<string, {
    bytes: Uint8Array;
    contentType: string;
    etag: string;
    lastModified: string;
  }>();
  copyCount = 0;
  failTemporaryDelete = false;

  async verifyReadiness() {}

  async createPresignedUpload(params: any) {
    return {
      url: `https://uploads.invalid/${encodeURIComponent(params.key)}`,
      expiresAt: new Date((params.now ?? NOW).getTime() + params.expiresInSeconds * 1000).toISOString(),
      requiredHeaders: {
        "content-type": params.contentType,
      },
    };
  }

  async headObject(key: string): Promise<TrainingContentStoredObject | null> {
    const object = this.objects.get(key);
    return object ? {
      key,
      byteSize: object.bytes.byteLength,
      contentType: object.contentType,
      etag: object.etag,
      lastModified: object.lastModified,
    } : null;
  }

  async readObjectRange(key: string, start: number, endInclusive: number) {
    const object = this.objects.get(key);
    if (!object) {
      throw new Error("missing object");
    }
    return object.bytes.slice(start, endInclusive + 1);
  }

  async readObjectBytes(key: string, maximumBytes: number) {
    const object = this.objects.get(key);
    if (!object) {
      throw new Error("missing object");
    }
    return object.bytes.slice(0, maximumBytes);
  }

  async copyObject(params: any) {
    const source = this.objects.get(params.sourceKey);
    if (!source) {
      throw new Error("source missing");
    }
    this.copyCount += 1;
    this.objects.set(params.destinationKey, {
      ...source,
      bytes: source.bytes.slice(),
    });
  }

  async deleteObject(key: string) {
    if (this.failTemporaryDelete && key.startsWith("tmp/")) {
      throw new Error("simulated temporary delete failure");
    }
    this.objects.delete(key);
  }

  async createPresignedAccess(params: any) {
    return {
      url: `https://access.invalid/${encodeURIComponent(params.key)}`,
      expiresAt: new Date((params.now ?? NOW).getTime() + params.expiresInSeconds * 1000).toISOString(),
      requiredHeaders: {},
    };
  }

  async listObjects() {
    return { objects: [], continuationToken: null };
  }

  put(key: string, bytes: Uint8Array, contentType = "application/pdf") {
    this.objects.set(key, {
      bytes,
      contentType,
      etag: `"etag-${bytes.byteLength}"`,
      lastModified: NOW.toISOString(),
    });
  }
}

function buildHarness(params: { enabled?: boolean; content?: TrainingContentItem } = {}) {
  const config = loadTrainingContentStorageConfig({
    TRAINING_CONTENT_STORAGE_PROVIDER: "r2",
    TRAINING_CONTENT_R2_ENVIRONMENT: "staging",
    TRAINING_CONTENT_R2_ACCOUNT_ID: "abc123",
    TRAINING_CONTENT_R2_BUCKET: "peritio-training-content-staging",
    TRAINING_CONTENT_R2_ACCESS_KEY_ID: "test-access-key",
    TRAINING_CONTENT_R2_SECRET_ACCESS_KEY: "test-secret-key",
    TRAINING_CONTENT_R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
  }, "staging");
  const assetStore = new FakeAssetStore(params.content);
  const objectStorage = new FakeObjectStorage();
  const readiness = new TrainingContentStorageReadinessService(config, objectStorage);
  const entitlement = {
    enabled: params.enabled ?? true,
    async initialize() {},
    async getOrgModuleEntitlement(orgId: string) {
      return {
        orgId,
        moduleKey: "training_content" as const,
        enabled: this.enabled,
        updatedByActorId: null,
        updatedAt: null,
      };
    },
    async setOrgModuleEntitlement() {
      throw new Error("not used");
    },
  };
  const service = createTrainingContentAssetService({
    config,
    assetStore,
    entitlementStore: entitlement as any,
    objectStorage,
    readiness,
  });
  return { config, assetStore, objectStorage, entitlement, service };
}

const ORG_ADMIN_CONTEXT = {
  orgId: "org_1",
  actorId: "admin_1",
  capabilities: buildDashboardAdminCapabilities("org_admin"),
};

async function initiatePdf(harness: ReturnType<typeof buildHarness>, replacementAssetId?: string) {
  return harness.service.initiateUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetRole: "primary",
    originalFilename: "reference.pdf",
    declaredMimeType: "application/pdf",
    declaredByteSize: PDF_BYTES.byteLength,
    replacementAssetId,
    now: NOW,
  });
}

function putInitiatedUpload(
  harness: ReturnType<typeof buildHarness>,
  assetId: string,
  bytes = PDF_BYTES,
  contentType = "application/pdf"
) {
  const asset = harness.assetStore.assets.get(assetId)!;
  harness.objectStorage.put(asset.temporaryObjectKey!, bytes, contentType);
}

test("upload initiation requires entitlement and server-derived management capability", async () => {
  const harness = buildHarness();
  const initiated = await initiatePdf(harness);
  assert.equal(initiated.asset.uploadState, "pending");
  assert.equal(initiated.upload.method, "PUT");
  assert.equal(initiated.upload.expiresAt, "2026-07-28T12:10:00.000Z");
  assert.deepEqual(initiated.upload.requiredHeaders, {
    "content-type": "application/pdf",
  });
  const serialized = JSON.stringify(initiated);
  assert.equal(serialized.includes("temporaryObjectKey"), false);
  assert.equal(serialized.includes("finalObjectKey"), false);
  assert.equal(serialized.includes("bucket"), false);
  assert.equal(serialized.includes("test-secret-key"), false);

  await assert.rejects(
    harness.service.initiateUpload({
      context: {
        ...ORG_ADMIN_CONTEXT,
        capabilities: buildDashboardAdminCapabilities("user_admin"),
      },
      contentId: buildContent().id,
      assetRole: "primary",
      originalFilename: "reference.pdf",
      declaredMimeType: "application/pdf",
      declaredByteSize: PDF_BYTES.byteLength,
    }),
    (error: unknown) =>
      error instanceof TrainingContentAssetServiceError
      && error.code === "dashboard_scope_denied"
  );

  harness.entitlement.enabled = false;
  await assert.rejects(
    initiatePdf(harness),
    (error: unknown) =>
      error instanceof TrainingContentAssetServiceError
      && error.code === "module_disabled"
  );
});

test("upload initiation rejects cross-organization content and declared policy violations", async () => {
  const harness = buildHarness();
  await assert.rejects(
    harness.service.initiateUpload({
      context: { ...ORG_ADMIN_CONTEXT, orgId: "org_2" },
      contentId: buildContent().id,
      assetRole: "primary",
      originalFilename: "reference.pdf",
      declaredMimeType: "application/pdf",
      declaredByteSize: PDF_BYTES.byteLength,
    }),
    (error: unknown) =>
      error instanceof TrainingContentAssetServiceError
      && error.code === "training_content_not_found"
  );
  await assert.rejects(
    harness.service.initiateUpload({
      context: ORG_ADMIN_CONTEXT,
      contentId: buildContent().id,
      assetRole: "primary",
      originalFilename: "payload.exe",
      declaredMimeType: "application/octet-stream",
      declaredByteSize: 100,
    }),
    /not supported/
  );
  await assert.rejects(
    harness.service.initiateUpload({
      context: ORG_ADMIN_CONTEXT,
      contentId: buildContent().id,
      assetRole: "primary",
      originalFilename: "large.pdf",
      declaredMimeType: "application/pdf",
      declaredByteSize: 51 * 1024 * 1024,
    }),
    /exceeds the 50 MB/
  );
});

test("finalization validates both temporary and final objects and commits ready state atomically", async () => {
  const harness = buildHarness();
  const initiated = await initiatePdf(harness);
  putInitiatedUpload(harness, initiated.asset.id);
  const finalized = await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: NOW,
  });
  assert.equal(finalized.asset.uploadState, "ready");
  assert.equal(finalized.asset.isCurrent, true);
  assert.equal(finalized.asset.cleanupPending, false);
  assert.equal(finalized.asset.byteSize, PDF_BYTES.byteLength);
  assert.equal(harness.objectStorage.copyCount, 1);
  assert.equal(
    [...harness.objectStorage.objects.keys()].some((key) => key.startsWith("tmp/")),
    false
  );
  assert.deepEqual(
    harness.assetStore.audits.map((audit) => audit.action),
    ["training_content_upload_initiated", "training_content_asset_finalized"]
  );
  const auditJson = JSON.stringify(harness.assetStore.audits);
  assert.equal(auditJson.includes("ObjectKey"), false);
  assert.equal(auditJson.includes("https://"), false);
  assert.equal(auditJson.includes("reference.pdf"), false);
});

test("actual size, MIME, and magic-byte mismatches reject the upload without serving it", async () => {
  for (const variant of [
    { bytes: Buffer.from("%PDF-1.7-extra"), contentType: "application/pdf" },
    { bytes: PDF_BYTES, contentType: "text/html" },
    { bytes: Buffer.from("<script>"), contentType: "application/pdf" },
  ]) {
    const harness = buildHarness();
    const initiated = await initiatePdf(harness);
    putInitiatedUpload(harness, initiated.asset.id, variant.bytes, variant.contentType);
    await assert.rejects(
      harness.service.finalizeUpload({
        context: ORG_ADMIN_CONTEXT,
        contentId: buildContent().id,
        assetId: initiated.asset.id,
        now: NOW,
      }),
      (error: unknown) =>
        error instanceof TrainingContentAssetServiceError
        && error.status === 422
    );
    assert.equal(harness.assetStore.assets.get(initiated.asset.id)?.uploadState, "rejected");
    await assert.rejects(
      harness.service.createAdminPreviewAccess({
        context: ORG_ADMIN_CONTEXT,
        contentId: buildContent().id,
        assetId: initiated.asset.id,
      }),
      /not available/
    );
  }
});

test("expired uploads transition once to expired and cannot be finalized", async () => {
  const harness = buildHarness();
  const initiated = await initiatePdf(harness);
  putInitiatedUpload(harness, initiated.asset.id);
  await assert.rejects(
    harness.service.finalizeUpload({
      context: ORG_ADMIN_CONTEXT,
      contentId: buildContent().id,
      assetId: initiated.asset.id,
      now: new Date(NOW.getTime() + 601_000),
    }),
    (error: unknown) =>
      error instanceof TrainingContentAssetServiceError
      && error.status === 410
      && error.code === "training_content_upload_expired"
  );
  assert.equal(harness.assetStore.assets.get(initiated.asset.id)?.uploadState, "expired");
  assert.deepEqual(
    harness.assetStore.audits.map((audit) => audit.action),
    ["training_content_upload_initiated", "training_content_asset_expired"]
  );
});

test("duplicate finalization and copy-succeeded/database-failed retries are idempotent", async () => {
  const harness = buildHarness();
  const initiated = await initiatePdf(harness);
  putInitiatedUpload(harness, initiated.asset.id);
  harness.assetStore.failCompleteOnce = true;
  await assert.rejects(harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: NOW,
  }), /simulated database commit failure/);
  assert.equal(harness.objectStorage.copyCount, 1);
  assert.equal(harness.assetStore.assets.get(initiated.asset.id)?.uploadState, "processing");

  const recoveredAt = new Date(NOW.getTime() + 1_000);
  const recovered = await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: recoveredAt,
  });
  assert.equal(recovered.asset.uploadState, "ready");
  assert.equal(harness.objectStorage.copyCount, 1);

  const duplicate = await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: recoveredAt,
  });
  assert.equal(duplicate.asset.uploadState, "ready");
  assert.equal(harness.objectStorage.copyCount, 1);
});

test("temporary deletion failure leaves a cleanup marker and does not roll back a ready asset", async () => {
  const harness = buildHarness();
  const initiated = await initiatePdf(harness);
  putInitiatedUpload(harness, initiated.asset.id);
  harness.objectStorage.failTemporaryDelete = true;
  const finalized = await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: NOW,
  });
  assert.equal(finalized.asset.uploadState, "ready");
  assert.equal(finalized.asset.cleanupPending, true);
  assert.equal(
    [...harness.objectStorage.objects.keys()].some((key) => key.startsWith("tmp/")),
    true
  );

  harness.objectStorage.failTemporaryDelete = false;
  const retried = await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: NOW,
  });
  assert.equal(retried.asset.cleanupPending, false);
});

test("replacement preserves the current asset until the new immutable version is ready", async () => {
  const harness = buildHarness();
  const first = await initiatePdf(harness);
  putInitiatedUpload(harness, first.asset.id);
  await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: first.asset.id,
    now: NOW,
  });

  const second = await initiatePdf(harness, first.asset.id);
  assert.equal(harness.assetStore.assets.get(first.asset.id)?.uploadState, "ready");
  assert.equal(harness.assetStore.assets.get(first.asset.id)?.isCurrent, true);
  assert.equal(second.asset.version, 2);
  putInitiatedUpload(harness, second.asset.id);
  const replaced = await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: second.asset.id,
    now: new Date(NOW.getTime() + 1000),
  });
  assert.equal(replaced.replacedAssetId, first.asset.id);
  assert.equal(harness.assetStore.assets.get(first.asset.id)?.uploadState, "superseded");
  assert.equal(harness.assetStore.assets.get(first.asset.id)?.isCurrent, false);
  assert.equal(harness.assetStore.assets.get(second.asset.id)?.uploadState, "ready");
  assert.equal(harness.assetStore.assets.get(second.asset.id)?.isCurrent, true);
  assert.equal(
    harness.assetStore.assets.get(first.asset.id)?.finalObjectKey
      === harness.assetStore.assets.get(second.asset.id)?.finalObjectKey,
    false
  );
});

test("authorized access is short-lived, capped by content type, and unavailable to ordinary users", async () => {
  const harness = buildHarness();
  const initiated = await initiatePdf(harness);
  putInitiatedUpload(harness, initiated.asset.id);
  await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: NOW,
  });
  const access = await harness.service.createAdminPreviewAccess({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: NOW,
  });
  assert.equal(access.access.expiresAt, "2026-07-28T12:05:00.000Z");
  assert.match(access.access.url, /^https:\/\/access\.invalid\//);

  await assert.rejects(
    harness.service.createAdminPreviewAccess({
      context: {
        ...ORG_ADMIN_CONTEXT,
        capabilities: buildDashboardAdminCapabilities("user"),
      },
      contentId: buildContent().id,
      assetId: initiated.asset.id,
    }),
    (error: unknown) =>
      error instanceof TrainingContentAssetServiceError
      && error.code === "dashboard_scope_denied"
  );
});

test("authorized admins can inspect the retained current asset after content is archived", async () => {
  const harness = buildHarness();
  const initiated = await initiatePdf(harness);
  putInitiatedUpload(harness, initiated.asset.id);
  await harness.service.finalizeUpload({
    context: ORG_ADMIN_CONTEXT,
    contentId: buildContent().id,
    assetId: initiated.asset.id,
    now: NOW,
  });
  const archived = buildContent({
    publicationState: "archived",
    archivedAt: new Date(NOW.getTime() + 1000).toISOString(),
  });
  harness.assetStore.contents.set(`${archived.orgId}:${archived.id}`, archived);

  const access = await harness.service.createAdminPreviewAccess({
    context: ORG_ADMIN_CONTEXT,
    contentId: archived.id,
    assetId: initiated.asset.id,
    now: NOW,
  });

  assert.match(access.access.url, /^https:\/\/access\.invalid\//);
  assert.equal(harness.assetStore.assets.get(initiated.asset.id)?.isCurrent, true);
  assert.equal(harness.assetStore.assets.get(initiated.asset.id)?.objectDeletedAt, null);
});

function clone<T>(value: T): T {
  return structuredClone(value);
}
