import type {
  DashboardAdminCapabilities,
  TrainingContentAssetRole,
} from "@voicepractice/shared";

import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type { OrgModuleEntitlementStore } from "../storage/orgModuleEntitlementStore.js";
import type {
  TrainingContentAssetRecord,
  TrainingContentAssetStore,
  TrainingContentAuditActor,
} from "../storage/trainingContentAssetStore.js";
import {
  TrainingContentAssetStoreError,
} from "../storage/trainingContentAssetStore.js";
import type {
  TrainingContentObjectStorage,
  TrainingContentStoredObject,
} from "../storage/trainingContentObjectStorage.js";
import { canManageTrainingContent } from "./trainingContentAuthorization.js";
import {
  assertTrainingContentAssetRoleMatchesContent,
  getTrainingContentSignatureReadSize,
  TrainingContentDeclaredFile,
  TrainingContentFilePolicyError,
  validateDeclaredTrainingContentFile,
  validateTrainingContentFileSignature,
} from "./trainingContentFilePolicy.js";
import type {
  TrainingContentStorageReadinessService,
} from "./trainingContentStorageReadiness.js";
import {
  backupFinalizedAssetBestEffort,
  type TrainingContentBackupService,
} from "./trainingContentBackup.js";

export interface TrainingContentManagementRequestContext {
  orgId: string;
  actorId: string;
  capabilities: DashboardAdminCapabilities;
  actorType?: "web_user";
}

export interface TrainingContentAssetPublicRecord {
  id: string;
  contentId: string;
  assetRole: TrainingContentAssetRole;
  version: number;
  uploadState: TrainingContentAssetRecord["uploadState"];
  originalFilename: string | null;
  declaredMimeType: string | null;
  detectedMimeType: string | null;
  fileExtension: string | null;
  declaredByteSize: number | null;
  byteSize: number | null;
  checksumOrEtag: string | null;
  uploadExpiresAt: string | null;
  processingAttemptCount?: number;
  processingNextAttemptAt?: string | null;
  processingErrorCategory?: string | null;
  rejectionReasonCategory?: string | null;
  finalizedAt: string | null;
  supersededAt: string | null;
  replacementForAssetId: string | null;
  isCurrent: boolean;
  cleanupPending: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingContentUploadInitiationResponse {
  asset: TrainingContentAssetPublicRecord;
  upload: {
    url: string;
    expiresAt: string;
    method: "PUT";
    requiredHeaders: Record<string, string>;
  };
}

export interface TrainingContentAssetFinalizationResponse {
  asset: TrainingContentAssetPublicRecord;
  replacedAssetId: string | null;
}

export interface TrainingContentAssetAccessResponse {
  access: {
    url: string;
    expiresAt: string;
    requiredHeaders: Record<string, string>;
  };
}

export class TrainingContentAssetServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "TrainingContentAssetServiceError";
  }
}

export interface TrainingContentAssetService {
  initiateUpload(params: {
    context: TrainingContentManagementRequestContext;
    contentId: string;
    assetRole: unknown;
    originalFilename: unknown;
    declaredMimeType: unknown;
    declaredByteSize: unknown;
    replacementAssetId?: unknown;
    now?: Date;
  }): Promise<TrainingContentUploadInitiationResponse>;
  finalizeUpload(params: {
    context: TrainingContentManagementRequestContext;
    contentId: string;
    assetId: string;
    now?: Date;
  }): Promise<TrainingContentAssetFinalizationResponse>;
  getUploadStatus(params: {
    context: TrainingContentManagementRequestContext;
    contentId: string;
    assetId: string;
  }): Promise<TrainingContentAssetFinalizationResponse>;
  createAdminPreviewAccess(params: {
    context: TrainingContentManagementRequestContext;
    contentId: string;
    assetId: string;
    now?: Date;
  }): Promise<TrainingContentAssetAccessResponse>;
}

interface TrainingContentAssetServiceParams {
  config: TrainingContentStorageConfig;
  assetStore: TrainingContentAssetStore;
  entitlementStore: OrgModuleEntitlementStore;
  objectStorage: TrainingContentObjectStorage;
  readiness: TrainingContentStorageReadinessService;
  backup?: TrainingContentBackupService;
}

const ASSET_ROLES = new Set<TrainingContentAssetRole>(["primary", "thumbnail", "inline"]);

class DefaultTrainingContentAssetService implements TrainingContentAssetService {
  constructor(private readonly dependencies: TrainingContentAssetServiceParams) {}

  async initiateUpload(params: {
    context: TrainingContentManagementRequestContext;
    contentId: string;
    assetRole: unknown;
    originalFilename: unknown;
    declaredMimeType: unknown;
    declaredByteSize: unknown;
    replacementAssetId?: unknown;
    now?: Date;
  }): Promise<TrainingContentUploadInitiationResponse> {
    const now = params.now ?? new Date();
    await this.authorizeManagement(params.context);
    await this.requireStorageAvailable();
    const contentId = requiredId(params.contentId, "Content id");
    const assetRole = normalizeAssetRole(params.assetRole);
    const replacementAssetId = normalizeOptionalId(params.replacementAssetId, "Replacement asset id");
    const declaredFile = validateDeclaredTrainingContentFile({
      originalFilename: params.originalFilename,
      declaredMimeType: params.declaredMimeType,
      declaredByteSize: params.declaredByteSize,
      limits: this.dependencies.config.fileSizeLimits,
    });
    const content = await this.dependencies.assetStore.getContentItemForOrg(
      params.context.orgId,
      contentId
    );
    if (!content) {
      throw new TrainingContentAssetServiceError(
        "Training Content item was not found.",
        404,
        "training_content_not_found"
      );
    }
    if (content.publicationState === "archived") {
      throw new TrainingContentAssetServiceError(
        "Archived Training Content cannot accept uploads.",
        409,
        "training_content_archived"
      );
    }
    assertTrainingContentAssetRoleMatchesContent({
      contentType: content.contentType,
      assetRole,
      fileKind: declaredFile.kind,
    });

    const actor = buildActor(params.context);
    const created = await this.dependencies.assetStore.createPendingAsset({
      orgId: params.context.orgId,
      contentId,
      assetRole,
      originalFilename: declaredFile.originalFilename,
      declaredMimeType: declaredFile.mimeType,
      fileExtension: declaredFile.extension,
      declaredByteSize: declaredFile.byteSize,
      replacementAssetId,
      uploadTtlSeconds: this.dependencies.config.uploadUrlTtlSeconds,
      maxPendingBytesForOrganization:
        this.dependencies.config.maxPendingUploadBytesPerOrganization,
      actor,
      now,
    });
    if (!created.asset.temporaryObjectKey) {
      throw new Error("Pending Training Content asset is missing its temporary object key.");
    }

    try {
      const upload = await this.dependencies.objectStorage.createPresignedUpload({
        key: created.asset.temporaryObjectKey,
        contentType: declaredFile.mimeType,
        contentLength: declaredFile.byteSize,
        expiresInSeconds: this.dependencies.config.uploadUrlTtlSeconds,
        now,
      });
      return {
        asset: toPublicAsset(created.asset),
        upload: {
          url: upload.url,
          expiresAt: upload.expiresAt,
          method: "PUT",
          requiredHeaders: upload.requiredHeaders,
        },
      };
    } catch {
      await this.dependencies.assetStore.rejectAsset({
        orgId: created.asset.orgId,
        contentId: created.asset.contentId,
        assetId: created.asset.id,
        reasonCategory: "storage_signing_failed",
        actor,
        now,
      });
      throw storageUnavailableError();
    }
  }

  async finalizeUpload(params: {
    context: TrainingContentManagementRequestContext;
    contentId: string;
    assetId: string;
    now?: Date;
  }): Promise<TrainingContentAssetFinalizationResponse> {
    const now = params.now ?? new Date();
    await this.authorizeManagement(params.context);
    await this.requireStorageAvailable();
    const contentId = requiredId(params.contentId, "Content id");
    const assetId = requiredId(params.assetId, "Asset id");
    const content = await this.dependencies.assetStore.getContentItemForOrg(
      params.context.orgId,
      contentId
    );
    if (!content) {
      throw new TrainingContentAssetServiceError(
        "Training Content item was not found.",
        404,
        "training_content_not_found"
      );
    }
    if (content.publicationState === "archived") {
      throw new TrainingContentAssetServiceError(
        "Archived Training Content cannot be finalized.",
        409,
        "training_content_archived"
      );
    }
    const asset = await this.dependencies.assetStore.getAssetForOrg(
      params.context.orgId,
      contentId,
      assetId
    );
    if (!asset) {
      throw new TrainingContentAssetServiceError(
        "Training Content asset was not found.",
        404,
        "training_content_asset_not_found"
      );
    }
    if (asset.uploadState === "ready") {
      await this.tryDeleteTemporaryObject(asset, now);
      const refreshed = await this.dependencies.assetStore.getAssetForOrg(
        asset.orgId,
        asset.contentId,
        asset.id
      );
      return {
        asset: toPublicAsset(refreshed ?? asset),
        replacedAssetId: asset.replacementForAssetId,
      };
    }
    if (["rejected", "expired", "superseded"].includes(asset.uploadState)) {
      throw new TrainingContentAssetServiceError(
        "Training Content asset cannot be finalized from its current state.",
        409,
        "training_content_asset_state_conflict",
        { uploadState: asset.uploadState }
      );
    }
    if (
      asset.uploadState !== "processing"
      && asset.uploadExpiresAt
      && new Date(asset.uploadExpiresAt).getTime() <= now.getTime()
    ) {
      await this.dependencies.assetStore.expirePendingAsset({
        orgId: asset.orgId,
        assetId: asset.id,
        actor: buildActor(params.context),
        now,
      });
      throw new TrainingContentAssetServiceError(
        "The upload URL has expired. Start a new upload.",
        410,
        "training_content_upload_expired"
      );
    }
    if (
      !asset.temporaryObjectKey
      || !asset.declaredMimeType
      || !asset.fileExtension
      || !asset.declaredByteSize
      || !asset.originalFilename
    ) {
      throw new TrainingContentAssetServiceError(
        "Training Content asset is missing upload metadata.",
        409,
        "training_content_asset_state_conflict"
      );
    }

    const declaredFile = validateDeclaredTrainingContentFile({
      originalFilename: asset.originalFilename,
      declaredMimeType: asset.declaredMimeType,
      declaredByteSize: asset.declaredByteSize,
      limits: this.dependencies.config.fileSizeLimits,
    });
    assertTrainingContentAssetRoleMatchesContent({
      contentType: content.contentType,
      assetRole: asset.assetRole,
      fileKind: declaredFile.kind,
    });

    if (content.contentType === "video") {
      const source = await this.safeHeadObject(asset.temporaryObjectKey);
      if (!source) {
        throw new TrainingContentAssetServiceError(
          "The uploaded object is not available yet.",
          409,
          "training_content_upload_not_found"
        );
      }
      await this.validateStoredObjectOrReject({
        asset,
        object: source,
        objectKey: asset.temporaryObjectKey,
        declaredFile,
        actor: buildActor(params.context),
        now,
        reasonPrefix: "temporary",
      });
      const queued = await this.dependencies.assetStore.queueVideoProcessing({
        orgId: asset.orgId,
        contentId: asset.contentId,
        assetId: asset.id,
        actualByteSize: source.byteSize,
        detectedMimeType: declaredFile.mimeType,
        checksumOrEtag: source.etag,
        actor: buildActor(params.context),
        now,
      });
      if (queued.status === "ready" || queued.status === "queued") {
        return {
          asset: toPublicAsset(queued.asset),
          replacedAssetId: queued.asset.replacementForAssetId,
        };
      }
      if (queued.status === "expired") {
        throw new TrainingContentAssetServiceError(
          "The upload URL has expired. Start a new upload.",
          410,
          "training_content_upload_expired"
        );
      }
      throw new TrainingContentAssetServiceError(
        "Training Content asset cannot be finalized from its current state.",
        409,
        "training_content_asset_state_conflict",
        { uploadState: queued.asset.uploadState }
      );
    }

    let existingFinalObject: TrainingContentStoredObject | null = null;
    if (asset.uploadState === "processing" && asset.finalObjectKey) {
      existingFinalObject = await this.safeHeadObject(asset.finalObjectKey);
      if (existingFinalObject) {
        await this.validateStoredObjectOrReject({
          asset,
          object: existingFinalObject,
          objectKey: asset.finalObjectKey,
          declaredFile,
          actor: buildActor(params.context),
          now,
          reasonPrefix: "final",
        });
      }
    }

    const source = existingFinalObject ?? await this.safeHeadObject(asset.temporaryObjectKey);
    if (!source) {
      throw new TrainingContentAssetServiceError(
        "The uploaded object is not available yet.",
        409,
        "training_content_upload_not_found"
      );
    }
    if (!existingFinalObject) {
      await this.validateStoredObjectOrReject({
        asset,
        object: source,
        objectKey: asset.temporaryObjectKey,
        declaredFile,
        actor: buildActor(params.context),
        now,
        reasonPrefix: "temporary",
      });
    }

    const claim = await this.dependencies.assetStore.claimFinalization({
      orgId: asset.orgId,
      contentId: asset.contentId,
      assetId: asset.id,
      actualByteSize: source.byteSize,
      detectedMimeType: declaredFile.mimeType,
      checksumOrEtag: source.etag,
      leaseSeconds: existingFinalObject ? 0 : this.dependencies.config.finalizationLeaseSeconds,
      actor: buildActor(params.context),
      now,
    });
    if (claim.status === "busy") {
      throw new TrainingContentAssetServiceError(
        "Training Content asset finalization is already in progress.",
        409,
        "training_content_finalization_in_progress"
      );
    }
    if (claim.status === "ready") {
      await this.tryDeleteTemporaryObject(claim.asset, now);
      return {
        asset: toPublicAsset(claim.asset),
        replacedAssetId: claim.asset.replacementForAssetId,
      };
    }
    if (claim.status === "expired") {
      throw new TrainingContentAssetServiceError(
        "The upload URL has expired. Start a new upload.",
        410,
        "training_content_upload_expired"
      );
    }
    if (claim.status === "terminal") {
      throw new TrainingContentAssetServiceError(
        "Training Content asset cannot be finalized from its current state.",
        409,
        "training_content_asset_state_conflict"
      );
    }
    const claimed = claim.asset;
    if (!claimed.finalObjectKey) {
      throw new Error("Claimed Training Content asset is missing its final object key.");
    }

    let finalObject = existingFinalObject ?? await this.safeHeadObject(claimed.finalObjectKey);
    if (!finalObject) {
      try {
        await this.dependencies.objectStorage.copyObject({
          sourceKey: asset.temporaryObjectKey,
          destinationKey: claimed.finalObjectKey,
        });
      } catch {
        throw storageUnavailableError(
          "Training Content storage could not copy the uploaded object. Retrying is safe."
        );
      }
      finalObject = await this.safeHeadObject(claimed.finalObjectKey);
    }
    if (!finalObject) {
      throw storageUnavailableError(
        "Training Content storage did not confirm the final object. Retrying is safe."
      );
    }
    await this.validateStoredObjectOrReject({
      asset: claimed,
      object: finalObject,
      objectKey: claimed.finalObjectKey,
      declaredFile,
      actor: buildActor(params.context),
      now,
      reasonPrefix: "final",
    });

    const completed = await this.dependencies.assetStore.completeFinalization({
      orgId: claimed.orgId,
      contentId: claimed.contentId,
      assetId: claimed.id,
      finalObjectKey: claimed.finalObjectKey,
      actualByteSize: finalObject.byteSize,
      detectedMimeType: declaredFile.mimeType,
      checksumOrEtag: finalObject.etag,
      actor: buildActor(params.context),
      now,
    });
    await backupFinalizedAssetBestEffort(this.dependencies.backup, completed.asset);
    await this.tryDeleteTemporaryObject(completed.asset, now);
    const refreshed = await this.dependencies.assetStore.getAssetForOrg(
      completed.asset.orgId,
      completed.asset.contentId,
      completed.asset.id
    );
    return {
      asset: toPublicAsset(refreshed ?? completed.asset),
      replacedAssetId: completed.replacedAsset?.id ?? null,
    };
  }

  async getUploadStatus(params: {
    context: TrainingContentManagementRequestContext;
    contentId: string;
    assetId: string;
  }): Promise<TrainingContentAssetFinalizationResponse> {
    await this.authorizeManagement(params.context);
    const contentId = requiredId(params.contentId, "Content id");
    const assetId = requiredId(params.assetId, "Asset id");
    const content = await this.dependencies.assetStore.getContentItemForOrg(
      params.context.orgId,
      contentId
    );
    if (!content) {
      throw new TrainingContentAssetServiceError(
        "Training Content item was not found.",
        404,
        "training_content_not_found"
      );
    }
    const asset = await this.dependencies.assetStore.getAssetForOrg(
      params.context.orgId,
      contentId,
      assetId
    );
    if (!asset) {
      throw new TrainingContentAssetServiceError(
        "Training Content asset was not found.",
        404,
        "training_content_asset_not_found"
      );
    }
    return {
      asset: toPublicAsset(asset),
      replacedAssetId: asset.replacementForAssetId,
    };
  }

  async createAdminPreviewAccess(params: {
    context: TrainingContentManagementRequestContext;
    contentId: string;
    assetId: string;
    now?: Date;
  }): Promise<TrainingContentAssetAccessResponse> {
    const now = params.now ?? new Date();
    await this.authorizeManagement(params.context);
    await this.requireStorageAvailable();
    const contentId = requiredId(params.contentId, "Content id");
    const assetId = requiredId(params.assetId, "Asset id");
    const content = await this.dependencies.assetStore.getContentItemForOrg(
      params.context.orgId,
      contentId
    );
    if (!content) {
      throw new TrainingContentAssetServiceError(
        "Training Content item was not found.",
        404,
        "training_content_not_found"
      );
    }
    const asset = await this.dependencies.assetStore.getAssetForOrg(
      params.context.orgId,
      contentId,
      assetId
    );
    if (
      !asset
      || asset.uploadState !== "ready"
      || !asset.isCurrent
      || !asset.finalObjectKey
      || asset.objectDeletedAt
    ) {
      throw new TrainingContentAssetServiceError(
        "Training Content asset is not available.",
        404,
        "training_content_asset_not_available"
      );
    }
    const isMedia = content.contentType === "video" || content.contentType === "audio";
    const expiresInSeconds = isMedia
      ? Math.min(3600, this.dependencies.config.mediaAccessUrlTtlSeconds)
      : Math.min(900, this.dependencies.config.downloadUrlTtlSeconds);
    try {
      const access = await this.dependencies.objectStorage.createPresignedAccess({
        key: asset.finalObjectKey,
        expiresInSeconds,
        now,
      });
      return {
        access: {
          url: access.url,
          expiresAt: access.expiresAt,
          requiredHeaders: access.requiredHeaders,
        },
      };
    } catch {
      throw storageUnavailableError();
    }
  }

  private async authorizeManagement(
    context: TrainingContentManagementRequestContext
  ): Promise<void> {
    const entitlement = await this.dependencies.entitlementStore.getOrgModuleEntitlement(
      requiredId(context.orgId, "Organization id"),
      "training_content"
    );
    if (!entitlement.enabled) {
      throw new TrainingContentAssetServiceError(
        "Training Content is not enabled for this organization.",
        403,
        "module_disabled",
        { moduleKey: "training_content" }
      );
    }
    if (!canManageTrainingContent(context, entitlement)) {
      throw new TrainingContentAssetServiceError(
        "Training Content administration is not available for this account.",
        403,
        "dashboard_scope_denied"
      );
    }
  }

  private async requireStorageAvailable(): Promise<void> {
    if (!this.dependencies.readiness.isAvailable()) {
      await this.dependencies.readiness.refresh();
    }
    if (!this.dependencies.readiness.isAvailable()) {
      throw storageUnavailableError();
    }
  }

  private async safeHeadObject(key: string): Promise<TrainingContentStoredObject | null> {
    try {
      return await this.dependencies.objectStorage.headObject(key);
    } catch {
      throw storageUnavailableError();
    }
  }

  private async validateStoredObjectOrReject(params: {
    asset: TrainingContentAssetRecord;
    object: TrainingContentStoredObject;
    objectKey: string;
    declaredFile: TrainingContentDeclaredFile;
    actor: TrainingContentAuditActor;
    now: Date;
    reasonPrefix: "temporary" | "final";
  }): Promise<void> {
    let rejectionCategory: string | null = null;
    try {
      if (
        params.object.byteSize !== params.declaredFile.byteSize
        || params.object.byteSize > this.dependencies.config.fileSizeLimits[params.declaredFile.kind]
      ) {
        rejectionCategory = `${params.reasonPrefix}_size_mismatch`;
        throw new TrainingContentAssetServiceError(
          "The uploaded object size does not match the declared size.",
          422,
          "training_content_upload_size_mismatch"
        );
      }
      if (
        !params.object.contentType
        || params.object.contentType.trim().toLowerCase() !== params.declaredFile.mimeType
      ) {
        rejectionCategory = `${params.reasonPrefix}_mime_mismatch`;
        throw new TrainingContentAssetServiceError(
          "The uploaded object MIME type does not match the declared type.",
          422,
          "training_content_upload_mime_mismatch"
        );
      }
      const readSize = getTrainingContentSignatureReadSize(params.declaredFile);
      const bytes = params.declaredFile.kind === "docx"
        ? await this.dependencies.objectStorage.readObjectBytes(params.objectKey, readSize)
        : await this.dependencies.objectStorage.readObjectRange(
          params.objectKey,
          0,
          Math.max(0, readSize - 1)
        );
      await validateTrainingContentFileSignature({
        declaredFile: params.declaredFile,
        bytes,
      });
    } catch (error) {
      if (error instanceof TrainingContentFilePolicyError) {
        rejectionCategory = `${params.reasonPrefix}_${error.category}`;
      } else if (!(error instanceof TrainingContentAssetServiceError)) {
        throw storageUnavailableError();
      }
      await this.dependencies.assetStore.rejectAsset({
        orgId: params.asset.orgId,
        contentId: params.asset.contentId,
        assetId: params.asset.id,
        reasonCategory: rejectionCategory ?? `${params.reasonPrefix}_validation_failed`,
        actor: params.actor,
        now: params.now,
      });
      if (error instanceof TrainingContentAssetServiceError) {
        throw error;
      }
      throw new TrainingContentAssetServiceError(
        "The uploaded file signature does not match the declared type.",
        422,
        "training_content_upload_signature_mismatch"
      );
    }
  }

  private async tryDeleteTemporaryObject(
    asset: TrainingContentAssetRecord,
    now: Date
  ): Promise<void> {
    if (!asset.temporaryObjectKey || asset.uploadState !== "ready") {
      return;
    }
    try {
      await this.dependencies.objectStorage.deleteObject(asset.temporaryObjectKey);
      await this.dependencies.assetStore.clearTemporaryObject({
        orgId: asset.orgId,
        assetId: asset.id,
        expectedTemporaryObjectKey: asset.temporaryObjectKey,
        now,
      });
    } catch {
      // The committed ready asset remains valid; cleanup will retry the private temporary object.
    }
  }
}

function normalizeAssetRole(value: unknown): TrainingContentAssetRole {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!ASSET_ROLES.has(normalized as TrainingContentAssetRole)) {
    throw new TrainingContentAssetServiceError(
      "assetRole must be primary, thumbnail, or inline.",
      400,
      "training_content_asset_role_invalid"
    );
  }
  return normalized as TrainingContentAssetRole;
}

function normalizeOptionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new TrainingContentAssetServiceError(`${label} is invalid.`, 400, "invalid_request");
  }
  return value.trim();
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TrainingContentAssetServiceError(`${label} is required.`, 400, "invalid_request");
  }
  return normalized;
}

function buildActor(
  context: TrainingContentManagementRequestContext
): TrainingContentAuditActor {
  return {
    actorType: "web_user",
    actorId: requiredId(context.actorId, "Actor id"),
  };
}

function toPublicAsset(asset: TrainingContentAssetRecord): TrainingContentAssetPublicRecord {
  return {
    id: asset.id,
    contentId: asset.contentId,
    assetRole: asset.assetRole,
    version: asset.version,
    uploadState: asset.uploadState,
    originalFilename: asset.originalFilename,
    declaredMimeType: asset.declaredMimeType,
    detectedMimeType: asset.detectedMimeType,
    fileExtension: asset.fileExtension,
    declaredByteSize: asset.declaredByteSize,
    byteSize: asset.byteSize,
    checksumOrEtag: asset.checksumOrEtag,
    uploadExpiresAt: asset.uploadExpiresAt,
    processingAttemptCount: asset.processingAttemptCount,
    processingNextAttemptAt: asset.processingNextAttemptAt,
    processingErrorCategory: asset.processingErrorCategory,
    rejectionReasonCategory: asset.rejectionReasonCategory,
    finalizedAt: asset.finalizedAt,
    supersededAt: asset.supersededAt,
    replacementForAssetId: asset.replacementForAssetId,
    isCurrent: asset.isCurrent,
    cleanupPending: asset.cleanupPending,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function storageUnavailableError(
  message = "Training Content storage is temporarily unavailable."
): TrainingContentAssetServiceError {
  return new TrainingContentAssetServiceError(
    message,
    503,
    "training_content_storage_unavailable"
  );
}

export function mapTrainingContentAssetServiceError(error: unknown): TrainingContentAssetServiceError {
  if (error instanceof TrainingContentAssetServiceError) {
    return error;
  }
  if (error instanceof TrainingContentFilePolicyError) {
    return new TrainingContentAssetServiceError(error.message, 400, error.category);
  }
  if (error instanceof TrainingContentAssetStoreError) {
    const status = error.code.endsWith("_not_found") ? 404 : 409;
    const publicCode = {
      content_not_found: "training_content_not_found",
      content_archived: "training_content_archived",
      asset_not_found: "training_content_asset_not_found",
      asset_state_conflict: "training_content_asset_state_conflict",
      replacement_conflict: "training_content_replacement_conflict",
      pending_upload_limit_exceeded: "training_content_pending_upload_limit_exceeded",
    }[error.code];
    return new TrainingContentAssetServiceError(error.message, status, publicCode);
  }
  return new TrainingContentAssetServiceError(
    "Training Content asset operation failed.",
    500,
    "training_content_asset_operation_failed"
  );
}

export function createTrainingContentAssetService(
  params: TrainingContentAssetServiceParams
): TrainingContentAssetService {
  return new DefaultTrainingContentAssetService(params);
}
