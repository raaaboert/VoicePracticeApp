import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import type {
  AuditActorType,
  TrainingContentAssetRole,
  TrainingContentAssetUploadState,
  TrainingContentItem,
  TrainingContentPublicationState,
  TrainingContentType,
} from "@voicepractice/shared";

import type { StorageProvider } from "../runtimeConfig.js";
import {
  assertTrainingContentAssetTransition,
  assertTrainingContentFinalizationTransition,
} from "../services/trainingContentAssetStateMachine.js";
import {
  createTrainingContentFinalizationNonce,
  createTrainingContentFinalObjectKey,
  createTrainingContentTemporaryObjectKey,
} from "./trainingContentObjectKeys.js";
import { initializeTrainingContentSchema } from "./trainingContentMigrations.js";

export type TrainingContentAssetStoreErrorCode =
  | "content_not_found"
  | "content_archived"
  | "asset_not_found"
  | "asset_state_conflict"
  | "replacement_conflict"
  | "pending_upload_limit_exceeded";

export class TrainingContentAssetStoreError extends Error {
  constructor(message: string, readonly code: TrainingContentAssetStoreErrorCode) {
    super(message);
    this.name = "TrainingContentAssetStoreError";
  }
}

export interface TrainingContentAssetRecord {
  id: string;
  orgId: string;
  contentId: string;
  assetRole: TrainingContentAssetRole;
  version: number;
  uploadState: TrainingContentAssetUploadState;
  storageProvider: "r2" | null;
  temporaryObjectKey: string | null;
  finalObjectKey: string | null;
  originalFilename: string | null;
  declaredMimeType: string | null;
  detectedMimeType: string | null;
  fileExtension: string | null;
  declaredByteSize: number | null;
  byteSize: number | null;
  checksumOrEtag: string | null;
  uploadExpiresAt: string | null;
  finalizationNonce: string | null;
  finalizationStartedAt: string | null;
  processingAttemptCount: number;
  processingLeaseToken: string | null;
  processingLeaseExpiresAt: string | null;
  processingNextAttemptAt: string | null;
  processingErrorCategory: string | null;
  backedUpAt: string | null;
  backupAttemptCount: number;
  replacementForAssetId: string | null;
  isCurrent: boolean;
  cleanupPending: boolean;
  rejectionReasonCategory: string | null;
  finalizedAt: string | null;
  supersededAt: string | null;
  objectDeletedAt: string | null;
  createdByActorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingContentAuditActor {
  actorType: AuditActorType;
  actorId: string;
}

export interface CreatePendingTrainingContentAssetInput {
  orgId: string;
  contentId: string;
  assetRole: TrainingContentAssetRole;
  originalFilename: string;
  declaredMimeType: string;
  fileExtension: string;
  declaredByteSize: number;
  replacementAssetId: string | null;
  uploadTtlSeconds: number;
  maxPendingBytesForOrganization: number;
  actor: TrainingContentAuditActor;
  now?: Date;
}

export type ClaimTrainingContentAssetFinalizationResult =
  | { status: "claimed"; asset: TrainingContentAssetRecord; recovered: boolean }
  | { status: "busy"; asset: TrainingContentAssetRecord; recovered: false }
  | { status: "ready"; asset: TrainingContentAssetRecord; recovered: false }
  | { status: "expired"; asset: TrainingContentAssetRecord; recovered: false }
  | { status: "terminal"; asset: TrainingContentAssetRecord; recovered: false };

export type QueueTrainingContentVideoProcessingResult =
  | { status: "queued"; asset: TrainingContentAssetRecord }
  | { status: "ready"; asset: TrainingContentAssetRecord }
  | { status: "expired"; asset: TrainingContentAssetRecord }
  | { status: "terminal"; asset: TrainingContentAssetRecord };

export interface ClaimedTrainingContentVideoProcessing {
  asset: TrainingContentAssetRecord;
  leaseToken: string;
}

export interface TrainingContentAssetCleanupCandidate {
  asset: TrainingContentAssetRecord;
  reason:
    | "expired_pending"
    | "temporary_after_finalization"
    | "terminal_temporary"
    | "terminal_final"
    | "superseded_retention";
}

export interface TrainingContentAssetStore {
  initialize(): Promise<void>;
  getContentItemForOrg(orgId: string, contentId: string): Promise<TrainingContentItem | null>;
  getAssetForOrg(
    orgId: string,
    contentId: string,
    assetId: string
  ): Promise<TrainingContentAssetRecord | null>;
  createPendingAsset(
    input: CreatePendingTrainingContentAssetInput
  ): Promise<{ content: TrainingContentItem; asset: TrainingContentAssetRecord }>;
  rejectAsset(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    reasonCategory: string;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<TrainingContentAssetRecord>;
  claimFinalization(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    actualByteSize: number;
    detectedMimeType: string;
    checksumOrEtag: string | null;
    leaseSeconds: number;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<ClaimTrainingContentAssetFinalizationResult>;
  queueVideoProcessing(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    actualByteSize: number;
    detectedMimeType: string;
    checksumOrEtag: string | null;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<QueueTrainingContentVideoProcessingResult>;
  claimNextVideoProcessing(params: {
    leaseSeconds: number;
    maximumAttempts: number;
    now?: Date;
  }): Promise<ClaimedTrainingContentVideoProcessing | null>;
  rejectExhaustedVideoProcessing(params: {
    maximumAttempts: number;
    actor: TrainingContentAuditActor;
    now?: Date;
    limit?: number;
  }): Promise<number>;
  recordVideoProcessingFailure(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    leaseToken: string;
    errorCategory: string;
    retryAt: Date | null;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<TrainingContentAssetRecord>;
  completeFinalization(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    finalObjectKey: string;
    actualByteSize: number;
    detectedMimeType: string;
    checksumOrEtag: string | null;
    processingLeaseToken?: string;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<{ asset: TrainingContentAssetRecord; replacedAsset: TrainingContentAssetRecord | null }>;
  markAssetBackedUp(assetId: string, backedUpAt: Date): Promise<TrainingContentAssetRecord>;
  recordBackupFailure(assetId: string, now?: Date): Promise<TrainingContentAssetRecord>;
  listAssetsPendingBackup(limit: number): Promise<TrainingContentAssetRecord[]>;
  countAssetsPendingBackup(): Promise<number>;
  clearTemporaryObject(params: {
    orgId: string;
    assetId: string;
    expectedTemporaryObjectKey: string;
    now?: Date;
  }): Promise<void>;
  listCleanupCandidates(params: {
    now?: Date;
    supersededBefore: Date;
    limit?: number;
  }): Promise<TrainingContentAssetCleanupCandidate[]>;
  expirePendingAsset(params: {
    orgId: string;
    assetId: string;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<TrainingContentAssetRecord | null>;
  markFinalObjectDeleted(params: {
    orgId: string;
    assetId: string;
    expectedFinalObjectKey: string;
    now?: Date;
  }): Promise<void>;
  listReferencedFinalObjectKeys(): Promise<Set<string>>;
}

interface TrainingContentAssetStoreParams {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: AssetQueryPool;
}

type AssetQueryPool = Pick<Pool, "query" | "connect">;

interface ContentRow {
  id: string;
  org_id: string;
  category_id: string;
  title: string;
  description: string;
  focus_topic_id: string | null;
  focus_topic_name_snapshot: string | null;
  content_type: TrainingContentType;
  publication_state: TrainingContentPublicationState;
  native_body: string | null;
  external_url: string | null;
  display_order: number;
  content_version: number;
  created_by_actor_id: string;
  updated_by_actor_id: string;
  created_at: string | Date;
  updated_at: string | Date;
  published_at: string | Date | null;
  archived_at: string | Date | null;
}

interface AssetRow {
  id: string;
  org_id: string;
  content_id: string;
  asset_role: TrainingContentAssetRole;
  version: number;
  upload_state: TrainingContentAssetUploadState;
  storage_provider: "r2" | null;
  temporary_object_key: string | null;
  final_object_key: string | null;
  original_filename: string | null;
  declared_mime_type: string | null;
  detected_mime_type: string | null;
  file_extension: string | null;
  declared_byte_size: string | number | null;
  byte_size: string | number | null;
  checksum_or_etag: string | null;
  upload_expires_at: string | Date | null;
  finalization_nonce: string | null;
  finalization_started_at: string | Date | null;
  processing_attempt_count: string | number;
  processing_lease_token: string | null;
  processing_lease_expires_at: string | Date | null;
  processing_next_attempt_at: string | Date | null;
  processing_error_category: string | null;
  backed_up_at: string | Date | null;
  backup_attempt_count: string | number;
  replacement_for_asset_id: string | null;
  is_current: boolean;
  cleanup_pending: boolean;
  rejection_reason_category: string | null;
  finalized_at: string | Date | null;
  superseded_at: string | Date | null;
  object_deleted_at: string | Date | null;
  created_by_actor_id: string;
  created_at: string | Date;
  updated_at: string | Date;
}

const ASSET_COLUMNS = `
  id,
  org_id,
  content_id,
  asset_role,
  version,
  upload_state,
  storage_provider,
  temporary_object_key,
  final_object_key,
  original_filename,
  declared_mime_type,
  detected_mime_type,
  file_extension,
  declared_byte_size,
  byte_size,
  checksum_or_etag,
  upload_expires_at,
  finalization_nonce,
  finalization_started_at,
  processing_attempt_count,
  processing_lease_token,
  processing_lease_expires_at,
  processing_next_attempt_at,
  processing_error_category,
  backed_up_at,
  backup_attempt_count,
  replacement_for_asset_id,
  is_current,
  cleanup_pending,
  rejection_reason_category,
  finalized_at,
  superseded_at,
  object_deleted_at,
  created_by_actor_id,
  created_at,
  updated_at
`;

class UnavailableTrainingContentAssetStore implements TrainingContentAssetStore {
  async initialize(): Promise<void> {}

  async getContentItemForOrg(): Promise<TrainingContentItem | null> {
    return this.unavailable();
  }

  async getAssetForOrg(): Promise<TrainingContentAssetRecord | null> {
    return this.unavailable();
  }

  async createPendingAsset(): Promise<{ content: TrainingContentItem; asset: TrainingContentAssetRecord }> {
    return this.unavailable();
  }

  async rejectAsset(): Promise<TrainingContentAssetRecord> {
    return this.unavailable();
  }

  async claimFinalization(): Promise<ClaimTrainingContentAssetFinalizationResult> {
    return this.unavailable();
  }

  async queueVideoProcessing(): Promise<QueueTrainingContentVideoProcessingResult> {
    return this.unavailable();
  }

  async claimNextVideoProcessing(): Promise<ClaimedTrainingContentVideoProcessing | null> {
    return this.unavailable();
  }

  async rejectExhaustedVideoProcessing(): Promise<number> {
    return this.unavailable();
  }

  async recordVideoProcessingFailure(): Promise<TrainingContentAssetRecord> {
    return this.unavailable();
  }

  async completeFinalization(): Promise<{
    asset: TrainingContentAssetRecord;
    replacedAsset: TrainingContentAssetRecord | null;
  }> {
    return this.unavailable();
  }

  async markAssetBackedUp(): Promise<TrainingContentAssetRecord> {
    return this.unavailable();
  }

  async recordBackupFailure(): Promise<TrainingContentAssetRecord> {
    return this.unavailable();
  }

  async listAssetsPendingBackup(): Promise<TrainingContentAssetRecord[]> {
    return this.unavailable();
  }

  async countAssetsPendingBackup(): Promise<number> {
    return this.unavailable();
  }

  async clearTemporaryObject(): Promise<void> {
    return this.unavailable();
  }

  async listCleanupCandidates(): Promise<TrainingContentAssetCleanupCandidate[]> {
    return this.unavailable();
  }

  async expirePendingAsset(): Promise<TrainingContentAssetRecord | null> {
    return this.unavailable();
  }

  async markFinalObjectDeleted(): Promise<void> {
    return this.unavailable();
  }

  async listReferencedFinalObjectKeys(): Promise<Set<string>> {
    return this.unavailable();
  }

  private unavailable<T>(): T {
    throw new Error("Training Content assets require PostgreSQL storage.");
  }
}

class PostgresTrainingContentAssetStore implements TrainingContentAssetStore {
  private readonly pool: AssetQueryPool;
  private initialization: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    queryPool?: AssetQueryPool
  ) {
    this.pool = queryPool ?? new Pool({
      connectionString: databaseUrl,
      max: options.pgPoolMax,
      connectionTimeoutMillis: options.pgConnectTimeoutMs,
      idleTimeoutMillis: options.pgIdleTimeoutMs,
      keepAlive: true,
    });
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = initializeTrainingContentSchema(this.pool);
    }
    await this.initialization;
  }

  async getContentItemForOrg(orgId: string, contentId: string): Promise<TrainingContentItem | null> {
    await this.initialize();
    const result = await this.pool.query<ContentRow>(
      `
        SELECT *
        FROM org_content_items
        WHERE org_id = $1 AND id = $2
        LIMIT 1
      `,
      [requiredId(orgId, "Organization id"), requiredId(contentId, "Content id")]
    );
    return result.rows[0] ? mapContentRow(result.rows[0]) : null;
  }

  async getAssetForOrg(
    orgId: string,
    contentId: string,
    assetId: string
  ): Promise<TrainingContentAssetRecord | null> {
    await this.initialize();
    const result = await this.pool.query<AssetRow>(
      `
        SELECT ${ASSET_COLUMNS}
        FROM org_content_assets
        WHERE org_id = $1 AND content_id = $2 AND id = $3
        LIMIT 1
      `,
      [
        requiredId(orgId, "Organization id"),
        requiredId(contentId, "Content id"),
        requiredId(assetId, "Asset id"),
      ]
    );
    return result.rows[0] ? mapAssetRow(result.rows[0]) : null;
  }

  async createPendingAsset(
    input: CreatePendingTrainingContentAssetInput
  ): Promise<{ content: TrainingContentItem; asset: TrainingContentAssetRecord }> {
    await this.initialize();
    const orgId = requiredId(input.orgId, "Organization id");
    const contentId = requiredId(input.contentId, "Content id");
    const actorId = requiredId(input.actor.actorId, "Actor id");
    const now = input.now ?? new Date();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`training-content-upload:${orgId}`]
      );
      const contentResult = await client.query<ContentRow>(
        "SELECT * FROM org_content_items WHERE org_id = $1 AND id = $2 FOR UPDATE",
        [orgId, contentId]
      );
      const contentRow = contentResult.rows[0];
      if (!contentRow) {
        throw new TrainingContentAssetStoreError("Training Content item was not found.", "content_not_found");
      }
      if (contentRow.publication_state === "archived") {
        throw new TrainingContentAssetStoreError(
          "Archived Training Content cannot accept uploads.",
          "content_archived"
        );
      }

      const currentResult = await client.query<AssetRow>(
        `
          SELECT ${ASSET_COLUMNS}
          FROM org_content_assets
          WHERE org_id = $1
            AND content_id = $2
            AND asset_role = $3
            AND is_current = TRUE
          FOR UPDATE
        `,
        [orgId, contentId, input.assetRole]
      );
      const currentAsset = currentResult.rows[0] ? mapAssetRow(currentResult.rows[0]) : null;
      validateReplacementRequest(currentAsset, input.replacementAssetId);
      const activeUpload = await client.query<{ id: string }>(
        `
          SELECT id
          FROM org_content_assets
          WHERE org_id = $1
            AND content_id = $2
            AND asset_role = $3
            AND upload_state IN ('pending', 'uploaded', 'processing')
          LIMIT 1
        `,
        [orgId, contentId, input.assetRole]
      );
      if (activeUpload.rows[0]) {
        throw new TrainingContentAssetStoreError(
          "An upload is already active for this Training Content asset role.",
          "asset_state_conflict"
        );
      }
      if (currentAsset && input.replacementAssetId) {
        const activeReplacement = await client.query<{ id: string }>(
          `
            SELECT id
            FROM org_content_assets
            WHERE org_id = $1
              AND replacement_for_asset_id = $2
              AND upload_state IN ('pending', 'uploaded', 'processing')
            LIMIT 1
          `,
          [orgId, input.replacementAssetId]
        );
        if (activeReplacement.rows[0]) {
          throw new TrainingContentAssetStoreError(
            "A replacement upload is already active for this asset.",
            "replacement_conflict"
          );
        }
      }

      const pendingResult = await client.query<{ pending_bytes: string | number }>(
        `
          SELECT COALESCE(SUM(declared_byte_size), 0) AS pending_bytes
          FROM org_content_assets
          WHERE org_id = $1
            AND upload_state IN ('pending', 'uploaded', 'processing')
        `,
        [orgId]
      );
      const pendingBytes = parseDatabaseInteger(
        pendingResult.rows[0]?.pending_bytes ?? 0,
        "Pending upload bytes"
      );
      if (pendingBytes + input.declaredByteSize > input.maxPendingBytesForOrganization) {
        throw new TrainingContentAssetStoreError(
          "The organization pending-upload limit would be exceeded.",
          "pending_upload_limit_exceeded"
        );
      }

      const versionResult = await client.query<{ next_version: string | number }>(
        `
          SELECT COALESCE(MAX(version), 0) + 1 AS next_version
          FROM org_content_assets
          WHERE org_id = $1 AND content_id = $2 AND asset_role = $3
        `,
        [orgId, contentId, input.assetRole]
      );
      const version = parseDatabaseInteger(
        versionResult.rows[0]?.next_version ?? 1,
        "Asset version"
      );
      const assetId = randomUUID();
      const temporaryObjectKey = createTrainingContentTemporaryObjectKey({
        orgId,
        contentId,
        assetId,
      });
      const uploadExpiresAt = new Date(now.getTime() + input.uploadTtlSeconds * 1000);
      const inserted = await client.query<AssetRow>(
        `
          INSERT INTO org_content_assets (
            id,
            org_id,
            content_id,
            asset_role,
            version,
            upload_state,
            storage_provider,
            temporary_object_key,
            original_filename,
            declared_mime_type,
            file_extension,
            declared_byte_size,
            upload_expires_at,
            finalization_nonce,
            replacement_for_asset_id,
            created_by_actor_id,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, 'pending', 'r2', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15
          )
          RETURNING ${ASSET_COLUMNS}
        `,
        [
          assetId,
          orgId,
          contentId,
          input.assetRole,
          version,
          temporaryObjectKey,
          input.originalFilename,
          input.declaredMimeType,
          input.fileExtension,
          input.declaredByteSize,
          uploadExpiresAt,
          createTrainingContentFinalizationNonce(),
          input.replacementAssetId,
          actorId,
          now,
        ]
      );
      const assetRow = inserted.rows[0];
      if (!assetRow) {
        throw new Error("Pending Training Content asset insert did not return a row.");
      }
      await insertTechnicalAudit(client, {
        actor: input.actor,
        action: "training_content_upload_initiated",
        orgId,
        contentId,
        asset: mapAssetRow(assetRow),
        now,
      });
      await client.query("COMMIT");
      return {
        content: mapContentRow(contentRow),
        asset: mapAssetRow(assetRow),
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectAsset(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    reasonCategory: string;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<TrainingContentAssetRecord> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      const locked = await lockAsset(client, params.orgId, params.contentId, params.assetId);
      if (locked.uploadState === "rejected") {
        await client.query("COMMIT");
        return locked;
      }
      if (!["pending", "uploaded", "processing"].includes(locked.uploadState)) {
        throw new TrainingContentAssetStoreError(
          "Training Content asset cannot be rejected from its current state.",
          "asset_state_conflict"
        );
      }
      assertTrainingContentAssetTransition(locked.uploadState, "rejected");
      const updated = await client.query<AssetRow>(
        `
          UPDATE org_content_assets
          SET upload_state = 'rejected',
              is_current = FALSE,
              cleanup_pending = TRUE,
              rejection_reason_category = $4,
              finalization_started_at = NULL,
              processing_lease_token = NULL,
              processing_lease_expires_at = NULL,
              processing_next_attempt_at = NULL,
              updated_at = $5
          WHERE org_id = $1 AND content_id = $2 AND id = $3
          RETURNING ${ASSET_COLUMNS}
        `,
        [
          requiredId(params.orgId, "Organization id"),
          requiredId(params.contentId, "Content id"),
          requiredId(params.assetId, "Asset id"),
          normalizeReasonCategory(params.reasonCategory),
          now,
        ]
      );
      const asset = mapRequiredAssetRow(updated.rows[0]);
      await insertTechnicalAudit(client, {
        actor: params.actor,
        action: "training_content_asset_rejected",
        orgId: asset.orgId,
        contentId: asset.contentId,
        asset,
        now,
        extraMetadata: { rejectionReasonCategory: asset.rejectionReasonCategory },
      });
      await client.query("COMMIT");
      return asset;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimFinalization(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    actualByteSize: number;
    detectedMimeType: string;
    checksumOrEtag: string | null;
    leaseSeconds: number;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<ClaimTrainingContentAssetFinalizationResult> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      await lockFinalizableContent(client, params.orgId, params.contentId);
      const asset = await lockAsset(client, params.orgId, params.contentId, params.assetId);
      if (asset.uploadState === "ready") {
        await client.query("COMMIT");
        return { status: "ready", asset, recovered: false };
      }
      if (asset.uploadState === "pending" || asset.uploadState === "uploaded") {
        if (!asset.uploadExpiresAt || new Date(asset.uploadExpiresAt).getTime() <= now.getTime()) {
          const expired = await expireLockedAsset(client, asset, params.actor, now);
          await client.query("COMMIT");
          return { status: "expired", asset: expired, recovered: false };
        }
      }
      if (asset.uploadState === "processing" && asset.finalizationStartedAt) {
        const leaseAgeMs = now.getTime() - new Date(asset.finalizationStartedAt).getTime();
        if (leaseAgeMs < params.leaseSeconds * 1000) {
          await client.query("COMMIT");
          return { status: "busy", asset, recovered: false };
        }
      } else if (!["pending", "uploaded"].includes(asset.uploadState)) {
        await client.query("COMMIT");
        return { status: "terminal", asset, recovered: false };
      }

      let assetForProcessing = asset;
      if (asset.uploadState === "pending") {
        assertTrainingContentAssetTransition("pending", "uploaded");
        const uploaded = await client.query<AssetRow>(
          `
            UPDATE org_content_assets
            SET upload_state = 'uploaded',
                byte_size = $4,
                detected_mime_type = $5,
                checksum_or_etag = $6,
                updated_at = $7
            WHERE org_id = $1 AND content_id = $2 AND id = $3
            RETURNING ${ASSET_COLUMNS}
          `,
          [
            asset.orgId,
            asset.contentId,
            asset.id,
            params.actualByteSize,
            params.detectedMimeType,
            params.checksumOrEtag,
            now,
          ]
        );
        assetForProcessing = mapRequiredAssetRow(uploaded.rows[0]);
      }
      const recovered = assetForProcessing.uploadState === "processing";
      if (!recovered) {
        assertTrainingContentFinalizationTransition(assetForProcessing.uploadState);
      }
      if (!assetForProcessing.finalizationNonce) {
        throw new TrainingContentAssetStoreError(
          "Training Content asset is missing finalization metadata.",
          "asset_state_conflict"
        );
      }
      const finalObjectKey = assetForProcessing.finalObjectKey ?? createTrainingContentFinalObjectKey({
        orgId: assetForProcessing.orgId,
        contentId: assetForProcessing.contentId,
        assetRole: assetForProcessing.assetRole,
        version: assetForProcessing.version,
        finalizationNonce: assetForProcessing.finalizationNonce,
      });
      const result = await client.query<AssetRow>(
        `
          UPDATE org_content_assets
          SET upload_state = 'processing',
              final_object_key = $4,
              finalization_started_at = $5,
              byte_size = $6,
              detected_mime_type = $7,
              checksum_or_etag = $8,
              updated_at = $5
          WHERE org_id = $1 AND content_id = $2 AND id = $3
          RETURNING ${ASSET_COLUMNS}
        `,
        [
          assetForProcessing.orgId,
          assetForProcessing.contentId,
          assetForProcessing.id,
          finalObjectKey,
          now,
          params.actualByteSize,
          params.detectedMimeType,
          params.checksumOrEtag,
        ]
      );
      const claimed = mapRequiredAssetRow(result.rows[0]);
      await client.query("COMMIT");
      return { status: "claimed", asset: claimed, recovered };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async queueVideoProcessing(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    actualByteSize: number;
    detectedMimeType: string;
    checksumOrEtag: string | null;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<QueueTrainingContentVideoProcessingResult> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      await lockFinalizableContent(client, params.orgId, params.contentId);
      const asset = await lockAsset(client, params.orgId, params.contentId, params.assetId);
      if (asset.uploadState === "ready") {
        await client.query("COMMIT");
        return { status: "ready", asset };
      }
      if (asset.uploadState === "processing") {
        await client.query("COMMIT");
        return { status: "queued", asset };
      }
      if (asset.uploadState === "pending" || asset.uploadState === "uploaded") {
        if (!asset.uploadExpiresAt || new Date(asset.uploadExpiresAt).getTime() <= now.getTime()) {
          const expired = await expireLockedAsset(client, asset, params.actor, now);
          await client.query("COMMIT");
          return { status: "expired", asset: expired };
        }
      } else {
        await client.query("COMMIT");
        return { status: "terminal", asset };
      }
      if (!asset.finalizationNonce) {
        throw new TrainingContentAssetStoreError(
          "Training Content asset is missing finalization metadata.",
          "asset_state_conflict"
        );
      }

      let uploaded = asset;
      if (asset.uploadState === "pending") {
        assertTrainingContentAssetTransition("pending", "uploaded");
        const result = await client.query<AssetRow>(
          `
            UPDATE org_content_assets
            SET upload_state = 'uploaded',
                byte_size = $4,
                detected_mime_type = $5,
                checksum_or_etag = $6,
                updated_at = $7
            WHERE org_id = $1 AND content_id = $2 AND id = $3
            RETURNING ${ASSET_COLUMNS}
          `,
          [
            asset.orgId,
            asset.contentId,
            asset.id,
            params.actualByteSize,
            params.detectedMimeType,
            params.checksumOrEtag,
            now,
          ]
        );
        uploaded = mapRequiredAssetRow(result.rows[0]);
      }
      assertTrainingContentAssetTransition("uploaded", "processing");
      const finalObjectKey = createTrainingContentFinalObjectKey({
        orgId: uploaded.orgId,
        contentId: uploaded.contentId,
        assetRole: uploaded.assetRole,
        version: uploaded.version,
        finalizationNonce: uploaded.finalizationNonce!,
      });
      const queuedResult = await client.query<AssetRow>(
        `
          UPDATE org_content_assets
          SET upload_state = 'processing',
              final_object_key = $4,
              finalization_started_at = NULL,
              byte_size = $5,
              detected_mime_type = $6,
              checksum_or_etag = $7,
              processing_lease_token = NULL,
              processing_lease_expires_at = NULL,
              processing_next_attempt_at = NULL,
              processing_error_category = NULL,
              updated_at = $8
          WHERE org_id = $1 AND content_id = $2 AND id = $3
          RETURNING ${ASSET_COLUMNS}
        `,
        [
          uploaded.orgId,
          uploaded.contentId,
          uploaded.id,
          finalObjectKey,
          params.actualByteSize,
          params.detectedMimeType,
          params.checksumOrEtag,
          now,
        ]
      );
      const queued = mapRequiredAssetRow(queuedResult.rows[0]);
      await insertTechnicalAudit(client, {
        actor: params.actor,
        action: "training_content_video_processing_queued",
        orgId: queued.orgId,
        contentId: queued.contentId,
        asset: queued,
        now,
      });
      await client.query("COMMIT");
      return { status: "queued", asset: queued };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimNextVideoProcessing(params: {
    leaseSeconds: number;
    maximumAttempts: number;
    now?: Date;
  }): Promise<ClaimedTrainingContentVideoProcessing | null> {
    await this.initialize();
    const now = params.now ?? new Date();
    const leaseSeconds = requirePositiveInteger(params.leaseSeconds, "Processing lease seconds");
    const maximumAttempts = requirePositiveInteger(
      params.maximumAttempts,
      "Maximum processing attempts"
    );
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
    const result = await this.pool.query<AssetRow>(
      `
        WITH candidate AS (
          SELECT asset.id AS candidate_asset_id
          FROM org_content_assets asset
          INNER JOIN org_content_items content
            ON content.org_id = asset.org_id
           AND content.id = asset.content_id
          WHERE asset.upload_state = 'processing'
            AND content.content_type = 'video'
            AND asset.processing_attempt_count < $1
            AND (
              asset.processing_next_attempt_at IS NULL
              OR asset.processing_next_attempt_at <= $2
            )
            AND (
              asset.processing_lease_expires_at IS NULL
              OR asset.processing_lease_expires_at <= $2
            )
          ORDER BY asset.processing_next_attempt_at NULLS FIRST, asset.created_at, asset.id
          FOR UPDATE OF asset SKIP LOCKED
          LIMIT 1
        )
        UPDATE org_content_assets asset
        SET processing_attempt_count = asset.processing_attempt_count + 1,
            processing_lease_token = $3,
            processing_lease_expires_at = $4,
            processing_next_attempt_at = NULL,
            processing_error_category = NULL,
            finalization_started_at = $2,
            updated_at = $2
        FROM candidate
        WHERE asset.id = candidate.candidate_asset_id
        RETURNING ${ASSET_COLUMNS}
      `,
      [maximumAttempts, now, leaseToken, leaseExpiresAt]
    );
    const row = result.rows[0];
    return row ? { asset: mapAssetRow(row), leaseToken } : null;
  }

  async rejectExhaustedVideoProcessing(params: {
    maximumAttempts: number;
    actor: TrainingContentAuditActor;
    now?: Date;
    limit?: number;
  }): Promise<number> {
    await this.initialize();
    const maximumAttempts = requirePositiveInteger(
      params.maximumAttempts,
      "Maximum processing attempts"
    );
    const limit = Math.max(1, Math.min(100, params.limit ?? 25));
    const now = params.now ?? new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const exhausted = await client.query<AssetRow>(
        `
          SELECT asset.*
          FROM org_content_assets asset
          INNER JOIN org_content_items content
            ON content.org_id = asset.org_id
           AND content.id = asset.content_id
          WHERE asset.upload_state = 'processing'
            AND content.content_type = 'video'
            AND asset.processing_attempt_count >= $1
            AND (
              asset.processing_lease_expires_at IS NULL
              OR asset.processing_lease_expires_at <= $2
            )
          ORDER BY asset.updated_at, asset.id
          FOR UPDATE OF asset SKIP LOCKED
          LIMIT $3
        `,
        [maximumAttempts, now, limit]
      );
      for (const row of exhausted.rows) {
        const asset = mapAssetRow(row);
        assertTrainingContentAssetTransition("processing", "rejected");
        const updated = await client.query<AssetRow>(
          `
            UPDATE org_content_assets
            SET upload_state = 'rejected',
                is_current = FALSE,
                cleanup_pending = TRUE,
                rejection_reason_category = 'video_processing_attempts_exhausted',
                processing_lease_token = NULL,
                processing_lease_expires_at = NULL,
                processing_next_attempt_at = NULL,
                processing_error_category = 'attempts_exhausted',
                finalization_started_at = NULL,
                updated_at = $4
            WHERE org_id = $1 AND content_id = $2 AND id = $3
            RETURNING ${ASSET_COLUMNS}
          `,
          [asset.orgId, asset.contentId, asset.id, now]
        );
        const failed = mapRequiredAssetRow(updated.rows[0]);
        await insertTechnicalAudit(client, {
          actor: params.actor,
          action: "training_content_video_processing_failed",
          orgId: failed.orgId,
          contentId: failed.contentId,
          asset: failed,
          now,
          extraMetadata: { processingErrorCategory: "attempts_exhausted" },
        });
      }
      await client.query("COMMIT");
      return exhausted.rows.length;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordVideoProcessingFailure(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    leaseToken: string;
    errorCategory: string;
    retryAt: Date | null;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<TrainingContentAssetRecord> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = params.now ?? new Date();
    const errorCategory = normalizeReasonCategory(params.errorCategory);
    try {
      await client.query("BEGIN");
      const asset = await lockAsset(client, params.orgId, params.contentId, params.assetId);
      if (
        asset.uploadState !== "processing"
        || asset.processingLeaseToken !== requiredId(params.leaseToken, "Processing lease token")
        || !asset.processingLeaseExpiresAt
        || new Date(asset.processingLeaseExpiresAt).getTime() <= now.getTime()
      ) {
        throw new TrainingContentAssetStoreError(
          "Training Content video processing lease is no longer owned.",
          "asset_state_conflict"
        );
      }

      let result;
      if (params.retryAt) {
        result = await client.query<AssetRow>(
          `
            UPDATE org_content_assets
            SET processing_lease_token = NULL,
                processing_lease_expires_at = NULL,
                processing_next_attempt_at = $4,
                processing_error_category = $5,
                finalization_started_at = NULL,
                updated_at = $6
            WHERE org_id = $1 AND content_id = $2 AND id = $3
            RETURNING ${ASSET_COLUMNS}
          `,
          [
            asset.orgId,
            asset.contentId,
            asset.id,
            params.retryAt,
            errorCategory,
            now,
          ]
        );
      } else {
        assertTrainingContentAssetTransition("processing", "rejected");
        result = await client.query<AssetRow>(
          `
            UPDATE org_content_assets
            SET upload_state = 'rejected',
                is_current = FALSE,
                cleanup_pending = TRUE,
                rejection_reason_category = $4,
                processing_lease_token = NULL,
                processing_lease_expires_at = NULL,
                processing_next_attempt_at = NULL,
                processing_error_category = $5,
                finalization_started_at = NULL,
                updated_at = $6
            WHERE org_id = $1 AND content_id = $2 AND id = $3
            RETURNING ${ASSET_COLUMNS}
          `,
          [
            asset.orgId,
            asset.contentId,
            asset.id,
            `video_processing_${errorCategory}`.slice(0, 80),
            errorCategory,
            now,
          ]
        );
      }
      const updated = mapRequiredAssetRow(result.rows[0]);
      await insertTechnicalAudit(client, {
        actor: params.actor,
        action: params.retryAt
          ? "training_content_video_processing_retry_scheduled"
          : "training_content_video_processing_failed",
        orgId: updated.orgId,
        contentId: updated.contentId,
        asset: updated,
        now,
        extraMetadata: { processingErrorCategory: errorCategory },
      });
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeFinalization(params: {
    orgId: string;
    contentId: string;
    assetId: string;
    finalObjectKey: string;
    actualByteSize: number;
    detectedMimeType: string;
    checksumOrEtag: string | null;
    processingLeaseToken?: string;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<{ asset: TrainingContentAssetRecord; replacedAsset: TrainingContentAssetRecord | null }> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      await lockFinalizableContent(client, params.orgId, params.contentId);
      const asset = await lockAsset(client, params.orgId, params.contentId, params.assetId);
      if (asset.uploadState === "ready") {
        if (asset.finalObjectKey !== params.finalObjectKey) {
          throw new TrainingContentAssetStoreError(
            "Finalized Training Content asset key does not match.",
            "asset_state_conflict"
          );
        }
        await client.query("COMMIT");
        return { asset, replacedAsset: null };
      }
      if (asset.uploadState !== "processing" || asset.finalObjectKey !== params.finalObjectKey) {
        throw new TrainingContentAssetStoreError(
          "Training Content asset is not ready to commit finalization.",
          "asset_state_conflict"
        );
      }
      if (
        params.processingLeaseToken
        && (
          asset.processingLeaseToken !== params.processingLeaseToken
          || !asset.processingLeaseExpiresAt
          || new Date(asset.processingLeaseExpiresAt).getTime() <= now.getTime()
        )
      ) {
        throw new TrainingContentAssetStoreError(
          "Training Content video processing lease is no longer owned.",
          "asset_state_conflict"
        );
      }
      assertTrainingContentAssetTransition("processing", "ready");

      const currentResult = await client.query<AssetRow>(
        `
          SELECT ${ASSET_COLUMNS}
          FROM org_content_assets
          WHERE org_id = $1
            AND content_id = $2
            AND asset_role = $3
            AND is_current = TRUE
            AND id <> $4
          FOR UPDATE
        `,
        [asset.orgId, asset.contentId, asset.assetRole, asset.id]
      );
      const current = currentResult.rows[0] ? mapAssetRow(currentResult.rows[0]) : null;
      validateReplacementCommit(asset, current);

      let replacedAsset: TrainingContentAssetRecord | null = null;
      if (current) {
        assertTrainingContentAssetTransition(current.uploadState, "superseded");
        const replaced = await client.query<AssetRow>(
          `
            UPDATE org_content_assets
            SET upload_state = 'superseded',
                is_current = FALSE,
                superseded_at = $4,
                updated_at = $4
            WHERE org_id = $1 AND content_id = $2 AND id = $3
            RETURNING ${ASSET_COLUMNS}
          `,
          [current.orgId, current.contentId, current.id, now]
        );
        replacedAsset = mapRequiredAssetRow(replaced.rows[0]);
      }

      const finalized = await client.query<AssetRow>(
        `
          UPDATE org_content_assets
          SET upload_state = 'ready',
              is_current = TRUE,
              finalized_at = $4,
              finalization_started_at = NULL,
              processing_lease_token = NULL,
              processing_lease_expires_at = NULL,
              processing_next_attempt_at = NULL,
              processing_error_category = NULL,
              byte_size = $5,
              detected_mime_type = $6,
              checksum_or_etag = $7,
              cleanup_pending = (temporary_object_key IS NOT NULL),
              updated_at = $4
          WHERE org_id = $1 AND content_id = $2 AND id = $3
          RETURNING ${ASSET_COLUMNS}
        `,
        [
          asset.orgId,
          asset.contentId,
          asset.id,
          now,
          params.actualByteSize,
          params.detectedMimeType,
          params.checksumOrEtag,
        ]
      );
      const readyAsset = mapRequiredAssetRow(finalized.rows[0]);
      await client.query(
        `
          UPDATE org_content_items
          SET content_version = content_version + $3,
              updated_by_actor_id = $4,
              updated_at = GREATEST(updated_at + INTERVAL '1 millisecond', $5)
          WHERE org_id = $1 AND id = $2
        `,
        [
          readyAsset.orgId,
          readyAsset.contentId,
          replacedAsset ? 1 : 0,
          requiredId(params.actor.actorId, "Actor id"),
          now,
        ]
      );
      await insertTechnicalAudit(client, {
        actor: params.actor,
        action: "training_content_asset_finalized",
        orgId: readyAsset.orgId,
        contentId: readyAsset.contentId,
        asset: readyAsset,
        now,
      });
      if (replacedAsset) {
        await insertTechnicalAudit(client, {
          actor: params.actor,
          action: "training_content_asset_replaced",
          orgId: readyAsset.orgId,
          contentId: readyAsset.contentId,
          asset: readyAsset,
          now,
          extraMetadata: { replacedAssetId: replacedAsset.id },
        });
      }
      await client.query("COMMIT");
      return { asset: readyAsset, replacedAsset };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markAssetBackedUp(
    assetId: string,
    backedUpAt: Date
  ): Promise<TrainingContentAssetRecord> {
    await this.initialize();
    const result = await this.pool.query<AssetRow>(
      `
        UPDATE org_content_assets
        SET backed_up_at = COALESCE(backed_up_at, $2),
            updated_at = CASE WHEN backed_up_at IS NULL THEN $2 ELSE updated_at END
        WHERE id = $1
          AND upload_state = 'ready'
          AND final_object_key IS NOT NULL
        RETURNING ${ASSET_COLUMNS}
      `,
      [requiredId(assetId, "Asset id"), backedUpAt]
    );
    if (!result.rows[0]) {
      throw new TrainingContentAssetStoreError(
        "Only ready Training Content assets can be marked as backed up.",
        "asset_state_conflict"
      );
    }
    return mapAssetRow(result.rows[0]);
  }

  async recordBackupFailure(
    assetId: string,
    now: Date = new Date()
  ): Promise<TrainingContentAssetRecord> {
    await this.initialize();
    const result = await this.pool.query<AssetRow>(
      `
        UPDATE org_content_assets
        SET backup_attempt_count = backup_attempt_count + 1,
            updated_at = $2
        WHERE id = $1
          AND upload_state = 'ready'
          AND backed_up_at IS NULL
          AND final_object_key IS NOT NULL
        RETURNING ${ASSET_COLUMNS}
      `,
      [requiredId(assetId, "Asset id"), now]
    );
    if (!result.rows[0]) {
      throw new TrainingContentAssetStoreError(
        "Only ready unbacked Training Content assets can record a backup failure.",
        "asset_state_conflict"
      );
    }
    return mapAssetRow(result.rows[0]);
  }

  async listAssetsPendingBackup(limit: number): Promise<TrainingContentAssetRecord[]> {
    await this.initialize();
    const boundedLimit = Math.max(1, Math.min(1000, requirePositiveInteger(limit, "Backup limit")));
    const result = await this.pool.query<AssetRow>(
      `
        SELECT ${ASSET_COLUMNS}
        FROM org_content_assets
        WHERE upload_state = 'ready'
          AND backed_up_at IS NULL
          AND final_object_key IS NOT NULL
        ORDER BY updated_at ASC, id ASC
        LIMIT $1
      `,
      [boundedLimit]
    );
    return result.rows.map(mapAssetRow);
  }

  async countAssetsPendingBackup(): Promise<number> {
    await this.initialize();
    const result = await this.pool.query<{ pending_count: string | number }>(
      `
        SELECT COUNT(*) AS pending_count
        FROM org_content_assets
        WHERE upload_state = 'ready'
          AND backed_up_at IS NULL
          AND final_object_key IS NOT NULL
      `
    );
    return parseDatabaseInteger(result.rows[0]?.pending_count ?? 0, "Pending backup count");
  }

  async clearTemporaryObject(params: {
    orgId: string;
    assetId: string;
    expectedTemporaryObjectKey: string;
    now?: Date;
  }): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
        UPDATE org_content_assets
        SET temporary_object_key = NULL,
            cleanup_pending = CASE
              WHEN final_object_key IS NOT NULL
                AND upload_state IN ('rejected', 'expired')
                AND object_deleted_at IS NULL
              THEN TRUE
              ELSE FALSE
            END,
            updated_at = $4
        WHERE org_id = $1
          AND id = $2
          AND temporary_object_key = $3
      `,
      [
        requiredId(params.orgId, "Organization id"),
        requiredId(params.assetId, "Asset id"),
        requiredId(params.expectedTemporaryObjectKey, "Temporary object key"),
        params.now ?? new Date(),
      ]
    );
  }

  async listCleanupCandidates(params: {
    now?: Date;
    supersededBefore: Date;
    limit?: number;
  }): Promise<TrainingContentAssetCleanupCandidate[]> {
    await this.initialize();
    const now = params.now ?? new Date();
    const limit = Math.max(1, Math.min(1000, params.limit ?? 250));
    const result = await this.pool.query<AssetRow>(
      `
        SELECT ${ASSET_COLUMNS}
        FROM org_content_assets
        WHERE (
          upload_state = 'pending' AND upload_expires_at <= $1
        ) OR (
          temporary_object_key IS NOT NULL
          AND upload_state IN ('ready', 'rejected', 'expired')
        ) OR (
          final_object_key IS NOT NULL
          AND object_deleted_at IS NULL
          AND is_current = FALSE
          AND (
            upload_state IN ('rejected', 'expired')
            OR (upload_state = 'superseded' AND superseded_at <= $2)
          )
        )
        ORDER BY updated_at ASC, id ASC
        LIMIT $3
      `,
      [now, params.supersededBefore, limit]
    );
    return result.rows.flatMap((row) => buildCleanupCandidates(mapAssetRow(row), now));
  }

  async expirePendingAsset(params: {
    orgId: string;
    assetId: string;
    actor: TrainingContentAuditActor;
    now?: Date;
  }): Promise<TrainingContentAssetRecord | null> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      const result = await client.query<AssetRow>(
        `
          SELECT ${ASSET_COLUMNS}
          FROM org_content_assets
          WHERE org_id = $1 AND id = $2
          FOR UPDATE
        `,
        [requiredId(params.orgId, "Organization id"), requiredId(params.assetId, "Asset id")]
      );
      const asset = result.rows[0] ? mapAssetRow(result.rows[0]) : null;
      if (!asset || asset.uploadState !== "pending" || !asset.uploadExpiresAt) {
        await client.query("COMMIT");
        return asset;
      }
      if (new Date(asset.uploadExpiresAt).getTime() > now.getTime()) {
        await client.query("COMMIT");
        return asset;
      }
      const expired = await expireLockedAsset(client, asset, params.actor, now);
      await client.query("COMMIT");
      return expired;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markFinalObjectDeleted(params: {
    orgId: string;
    assetId: string;
    expectedFinalObjectKey: string;
    now?: Date;
  }): Promise<void> {
    await this.initialize();
    const result = await this.pool.query(
      `
        UPDATE org_content_assets
        SET object_deleted_at = $4,
            cleanup_pending = (temporary_object_key IS NOT NULL),
            updated_at = $4
        WHERE org_id = $1
          AND id = $2
          AND final_object_key = $3
          AND is_current = FALSE
          AND upload_state IN ('rejected', 'expired', 'superseded')
      `,
      [
        requiredId(params.orgId, "Organization id"),
        requiredId(params.assetId, "Asset id"),
        requiredId(params.expectedFinalObjectKey, "Final object key"),
        params.now ?? new Date(),
      ]
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new TrainingContentAssetStoreError(
        "Current or active Training Content assets cannot be physically deleted.",
        "asset_state_conflict"
      );
    }
  }

  async listReferencedFinalObjectKeys(): Promise<Set<string>> {
    await this.initialize();
    const result = await this.pool.query<{ final_object_key: string }>(
      `
        SELECT final_object_key
        FROM org_content_assets
        WHERE final_object_key IS NOT NULL
          AND object_deleted_at IS NULL
      `
    );
    return new Set(result.rows.map((row) => row.final_object_key));
  }
}

function validateReplacementRequest(
  currentAsset: TrainingContentAssetRecord | null,
  requestedReplacementAssetId: string | null
): void {
  const replacementAssetId = requestedReplacementAssetId?.trim() || null;
  if (!currentAsset && replacementAssetId) {
    throw new TrainingContentAssetStoreError(
      "The replacement asset is not the current asset.",
      "replacement_conflict"
    );
  }
  if (currentAsset && !replacementAssetId) {
    throw new TrainingContentAssetStoreError(
      "A current asset already exists; replacement must be explicit.",
      "replacement_conflict"
    );
  }
  if (currentAsset && replacementAssetId !== currentAsset.id) {
    throw new TrainingContentAssetStoreError(
      "The replacement asset is not the current asset.",
      "replacement_conflict"
    );
  }
}

function validateReplacementCommit(
  asset: TrainingContentAssetRecord,
  current: TrainingContentAssetRecord | null
): void {
  if (!asset.replacementForAssetId && current) {
    throw new TrainingContentAssetStoreError(
      "A current asset appeared while finalization was in progress.",
      "replacement_conflict"
    );
  }
  if (asset.replacementForAssetId && (!current || current.id !== asset.replacementForAssetId)) {
    throw new TrainingContentAssetStoreError(
      "The asset selected for replacement is no longer current.",
      "replacement_conflict"
    );
  }
}

async function lockAsset(
  client: Pick<PoolClient, "query">,
  orgId: string,
  contentId: string,
  assetId: string
): Promise<TrainingContentAssetRecord> {
  const result = await client.query<AssetRow>(
    `
      SELECT ${ASSET_COLUMNS}
      FROM org_content_assets
      WHERE org_id = $1 AND content_id = $2 AND id = $3
      FOR UPDATE
    `,
    [
      requiredId(orgId, "Organization id"),
      requiredId(contentId, "Content id"),
      requiredId(assetId, "Asset id"),
    ]
  );
  if (!result.rows[0]) {
    throw new TrainingContentAssetStoreError("Training Content asset was not found.", "asset_not_found");
  }
  return mapAssetRow(result.rows[0]);
}

async function lockFinalizableContent(
  client: Pick<PoolClient, "query">,
  orgId: string,
  contentId: string
): Promise<void> {
  const result = await client.query<{
    publication_state: TrainingContentPublicationState;
  }>(
    `
      SELECT publication_state
      FROM org_content_items
      WHERE org_id = $1 AND id = $2
      FOR UPDATE
    `,
    [requiredId(orgId, "Organization id"), requiredId(contentId, "Content id")]
  );
  if (!result.rows[0]) {
    throw new TrainingContentAssetStoreError(
      "Training Content item was not found.",
      "content_not_found"
    );
  }
  if (result.rows[0].publication_state === "archived") {
    throw new TrainingContentAssetStoreError(
      "Archived Training Content cannot be finalized.",
      "content_archived"
    );
  }
}

async function expireLockedAsset(
  client: Pick<PoolClient, "query">,
  asset: TrainingContentAssetRecord,
  actor: TrainingContentAuditActor,
  now: Date
): Promise<TrainingContentAssetRecord> {
  assertTrainingContentAssetTransition(asset.uploadState, "expired");
  const result = await client.query<AssetRow>(
    `
      UPDATE org_content_assets
      SET upload_state = 'expired',
          is_current = FALSE,
          cleanup_pending = TRUE,
          finalization_started_at = NULL,
          updated_at = $4
      WHERE org_id = $1 AND content_id = $2 AND id = $3
      RETURNING ${ASSET_COLUMNS}
    `,
    [asset.orgId, asset.contentId, asset.id, now]
  );
  const expired = mapRequiredAssetRow(result.rows[0]);
  await insertTechnicalAudit(client, {
    actor,
    action: "training_content_asset_expired",
    orgId: expired.orgId,
    contentId: expired.contentId,
    asset: expired,
    now,
  });
  return expired;
}

function buildCleanupCandidates(
  asset: TrainingContentAssetRecord,
  now: Date
): TrainingContentAssetCleanupCandidate[] {
  const candidates: TrainingContentAssetCleanupCandidate[] = [];
  if (
    asset.uploadState === "pending"
    && asset.uploadExpiresAt
    && new Date(asset.uploadExpiresAt).getTime() <= now.getTime()
  ) {
    candidates.push({ asset, reason: "expired_pending" });
  }
  if (asset.temporaryObjectKey && asset.uploadState === "ready") {
    candidates.push({ asset, reason: "temporary_after_finalization" });
  }
  if (
    asset.temporaryObjectKey
    && (asset.uploadState === "rejected" || asset.uploadState === "expired")
  ) {
    candidates.push({ asset, reason: "terminal_temporary" });
  }
  if (
    asset.finalObjectKey
    && !asset.objectDeletedAt
    && !asset.isCurrent
    && (asset.uploadState === "rejected" || asset.uploadState === "expired")
  ) {
    candidates.push({ asset, reason: "terminal_final" });
  }
  if (
    asset.finalObjectKey
    && !asset.objectDeletedAt
    && !asset.isCurrent
    && asset.uploadState === "superseded"
  ) {
    candidates.push({ asset, reason: "superseded_retention" });
  }
  return candidates;
}

async function insertTechnicalAudit(
  client: Pick<PoolClient, "query">,
  params: {
    actor: TrainingContentAuditActor;
    action: string;
    orgId: string;
    contentId: string;
    asset: TrainingContentAssetRecord;
    now: Date;
    extraMetadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO audit_events (
        id,
        actor_type,
        actor_id,
        action,
        org_id,
        user_id,
        message,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NULL, $6, $7::jsonb, $8)
    `,
    [
      `audit_${randomUUID()}`,
      params.actor.actorType,
      requiredId(params.actor.actorId, "Actor id"),
      params.action,
      params.orgId,
      "Changed Training Content asset state.",
      JSON.stringify({
        orgId: params.orgId,
        contentId: params.contentId,
        assetId: params.asset.id,
        assetRole: params.asset.assetRole,
        version: params.asset.version,
        uploadState: params.asset.uploadState,
        mimeType: params.asset.detectedMimeType ?? params.asset.declaredMimeType,
        byteSize: params.asset.byteSize ?? params.asset.declaredByteSize,
        ...(params.extraMetadata ?? {}),
      }),
      params.now,
    ]
  );
}

function mapContentRow(row: ContentRow): TrainingContentItem {
  return {
    id: row.id,
    orgId: row.org_id,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    focusTopicId: row.focus_topic_id,
    focusTopicNameSnapshot: row.focus_topic_name_snapshot,
    contentType: row.content_type,
    publicationState: row.publication_state,
    nativeBody: row.native_body,
    externalUrl: row.external_url,
    displayOrder: row.display_order,
    contentVersion: row.content_version,
    createdByActorId: row.created_by_actor_id,
    updatedByActorId: row.updated_by_actor_id,
    createdAt: requiredIso(row.created_at, "Content created time"),
    updatedAt: requiredIso(row.updated_at, "Content updated time"),
    publishedAt: optionalIso(row.published_at),
    archivedAt: optionalIso(row.archived_at),
  };
}

function mapAssetRow(row: AssetRow): TrainingContentAssetRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    contentId: row.content_id,
    assetRole: row.asset_role,
    version: row.version,
    uploadState: row.upload_state,
    storageProvider: row.storage_provider,
    temporaryObjectKey: row.temporary_object_key,
    finalObjectKey: row.final_object_key,
    originalFilename: row.original_filename,
    declaredMimeType: row.declared_mime_type,
    detectedMimeType: row.detected_mime_type,
    fileExtension: row.file_extension,
    declaredByteSize: optionalDatabaseInteger(row.declared_byte_size, "Declared byte size"),
    byteSize: optionalDatabaseInteger(row.byte_size, "Byte size"),
    checksumOrEtag: row.checksum_or_etag,
    uploadExpiresAt: optionalIso(row.upload_expires_at),
    finalizationNonce: row.finalization_nonce,
    finalizationStartedAt: optionalIso(row.finalization_started_at),
    processingAttemptCount: parseDatabaseInteger(
      row.processing_attempt_count,
      "Processing attempt count"
    ),
    processingLeaseToken: row.processing_lease_token,
    processingLeaseExpiresAt: optionalIso(row.processing_lease_expires_at),
    processingNextAttemptAt: optionalIso(row.processing_next_attempt_at),
    processingErrorCategory: row.processing_error_category,
    backedUpAt: optionalIso(row.backed_up_at),
    backupAttemptCount: parseDatabaseInteger(
      row.backup_attempt_count,
      "Backup attempt count"
    ),
    replacementForAssetId: row.replacement_for_asset_id,
    isCurrent: row.is_current === true,
    cleanupPending: row.cleanup_pending === true,
    rejectionReasonCategory: row.rejection_reason_category,
    finalizedAt: optionalIso(row.finalized_at),
    supersededAt: optionalIso(row.superseded_at),
    objectDeletedAt: optionalIso(row.object_deleted_at),
    createdByActorId: row.created_by_actor_id,
    createdAt: requiredIso(row.created_at, "Asset created time"),
    updatedAt: requiredIso(row.updated_at, "Asset updated time"),
  };
}

function mapRequiredAssetRow(row: AssetRow | undefined): TrainingContentAssetRecord {
  if (!row) {
    throw new Error("Training Content asset update did not return a row.");
  }
  return mapAssetRow(row);
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeReasonCategory(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 80);
  return normalized || "validation_failed";
}

function parseDatabaseInteger(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is outside the supported integer range.`);
  }
  return parsed;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function optionalDatabaseInteger(
  value: string | number | null,
  label: string
): number | null {
  return value === null ? null : parseDatabaseInteger(value, label);
}

function requiredIso(value: string | Date, label: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed.toISOString();
}

function optionalIso(value: string | Date | null): string | null {
  return value === null ? null : requiredIso(value, "Timestamp");
}

async function rollbackQuietly(client: Pick<PoolClient, "query">): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction failure.
  }
}

export function createTrainingContentAssetStore(
  params: TrainingContentAssetStoreParams
): TrainingContentAssetStore {
  if (params.provider !== "postgres") {
    return new UnavailableTrainingContentAssetStore();
  }
  if (!params.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }
  return new PostgresTrainingContentAssetStore(
    params.databaseUrl,
    {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs,
    },
    params.queryPool
  );
}
