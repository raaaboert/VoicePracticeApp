import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import type {
  AuditActorType,
  TrainingContentAssignment,
  TrainingContentAssignmentType,
  TrainingContentAssetRole,
  TrainingContentAssetUploadState,
  TrainingContentCategory,
  TrainingContentItem,
  TrainingContentListSort,
  TrainingContentPublicationState,
  TrainingContentType,
} from "@voicepractice/shared";

import type { StorageProvider } from "../runtimeConfig.js";
import { initializeTrainingContentSchema } from "./trainingContentMigrations.js";

export type TrainingContentStoreErrorCode =
  | "training_content_not_found"
  | "training_content_category_not_found"
  | "training_content_archived"
  | "training_content_conflict"
  | "training_content_invalid"
  | "training_content_publish_invalid";

export class TrainingContentStoreError extends Error {
  constructor(
    message: string,
    readonly code: TrainingContentStoreErrorCode,
    readonly details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "TrainingContentStoreError";
  }
}

export interface TrainingContentMutationActor {
  actorType: AuditActorType;
  actorId: string;
}

export interface TrainingContentCurrentAssetRecord {
  id: string;
  orgId: string;
  contentId: string;
  assetRole: TrainingContentAssetRole;
  version: number;
  uploadState: TrainingContentAssetUploadState;
  originalFilename: string | null;
  declaredMimeType: string | null;
  detectedMimeType: string | null;
  fileExtension: string | null;
  declaredByteSize: number | null;
  byteSize: number | null;
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

export interface TrainingContentAssignmentCounts {
  organization: number;
  user: number;
  manager: number;
  managerTeam: number;
}

export interface TrainingContentManagementListRow {
  content: TrainingContentItem;
  categoryName: string;
  currentAsset: TrainingContentCurrentAssetRecord | null;
  hasActiveVideoProcessing?: boolean;
  assignmentCounts: TrainingContentAssignmentCounts;
}

export interface TrainingContentManagementDetail extends TrainingContentManagementListRow {
  latestVideoUploadAsset?: TrainingContentCurrentAssetRecord | null;
  assignments: TrainingContentAssignment[];
}

export interface TrainingContentManagementListResult {
  items: TrainingContentManagementListRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TrainingContentMobileAssetRecord {
  id: string;
  orgId: string;
  contentId: string;
  uploadState: TrainingContentAssetUploadState;
  originalFilename: string | null;
  detectedMimeType: string | null;
  fileExtension: string | null;
  byteSize: number | null;
  isCurrent: boolean;
  finalObjectKey: string | null;
  objectDeletedAt: string | null;
}

export interface TrainingContentMobileReadRecord {
  content: TrainingContentItem;
  category: TrainingContentCategory;
  currentAsset: TrainingContentMobileAssetRecord | null;
  assignments: TrainingContentAssignment[];
}

export interface TrainingContentMobileReadResult {
  items: TrainingContentMobileReadRecord[];
  truncated: boolean;
}

export interface TrainingContentListFilters {
  query?: string | null;
  categoryId?: string | null;
  focusTopicId?: string | null;
  contentType?: TrainingContentType | null;
  publicationState?: TrainingContentPublicationState | null;
  sort?: TrainingContentListSort;
  page?: number;
  pageSize?: number;
}

export interface CreateTrainingContentInput {
  orgId: string;
  categoryId: string;
  title: string;
  description: string;
  focusTopicId: string | null;
  focusTopicNameSnapshot: string | null;
  contentType: TrainingContentType;
  nativeBody: string | null;
  externalUrl: string | null;
  actor: TrainingContentMutationActor;
  now?: Date;
}

export interface UpdateTrainingContentInput {
  orgId: string;
  contentId: string;
  expectedUpdatedAt: string;
  categoryId?: string;
  title?: string;
  description?: string;
  focusTopicId?: string | null;
  focusTopicNameSnapshot?: string | null;
  nativeBody?: string | null;
  externalUrl?: string | null;
  actor: TrainingContentMutationActor;
  now?: Date;
}

export interface ReplaceTrainingContentAssignmentsInput {
  orgId: string;
  contentId: string;
  expectedUpdatedAt: string;
  assignments: Array<{
    assignmentType: TrainingContentAssignmentType;
    subjectUserId: string | null;
  }>;
  actor: TrainingContentMutationActor;
  now?: Date;
}

export interface TransitionTrainingContentInput {
  orgId: string;
  contentId: string;
  expectedUpdatedAt: string;
  action: "publish" | "unpublish" | "archive";
  actor: TrainingContentMutationActor;
  now?: Date;
}

export interface TrainingContentStore {
  initialize(): Promise<void>;
  listContentItemsForOrg(orgId: string): Promise<TrainingContentItem[]>;
  getContentItemForOrg(orgId: string, contentId: string): Promise<TrainingContentItem | null>;
  listPublishedContentForMobile(
    orgId: string,
    maximumItems?: number
  ): Promise<TrainingContentMobileReadResult>;
  getPublishedContentForMobile(
    orgId: string,
    contentId: string
  ): Promise<TrainingContentMobileReadRecord | null>;
  listContentForManagement(
    orgId: string,
    filters?: TrainingContentListFilters
  ): Promise<TrainingContentManagementListResult>;
  getContentDetailForOrg(
    orgId: string,
    contentId: string
  ): Promise<TrainingContentManagementDetail | null>;
  createContent(input: CreateTrainingContentInput): Promise<TrainingContentManagementDetail>;
  updateContent(input: UpdateTrainingContentInput): Promise<TrainingContentManagementDetail>;
  replaceAssignments(
    input: ReplaceTrainingContentAssignmentsInput
  ): Promise<TrainingContentManagementDetail>;
  transitionContent(input: TransitionTrainingContentInput): Promise<TrainingContentManagementDetail>;
}

interface CreateTrainingContentStoreParams {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: TrainingContentQueryPool;
}

type TrainingContentQueryPool = Pick<Pool, "query" | "connect">;
type TrainingContentQueryable = Pick<PoolClient, "query"> | Pick<Pool, "query">;

interface TrainingContentItemRow {
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

interface TrainingContentAssetRow {
  id: string;
  org_id: string;
  content_id: string;
  asset_role: TrainingContentAssetRole;
  version: number;
  upload_state: TrainingContentAssetUploadState;
  original_filename: string | null;
  declared_mime_type: string | null;
  detected_mime_type: string | null;
  file_extension: string | null;
  declared_byte_size: string | number | null;
  byte_size: string | number | null;
  upload_expires_at: string | Date | null;
  processing_attempt_count: string | number;
  processing_next_attempt_at: string | Date | null;
  processing_error_category: string | null;
  rejection_reason_category: string | null;
  finalized_at: string | Date | null;
  superseded_at: string | Date | null;
  replacement_for_asset_id: string | null;
  is_current: boolean;
  cleanup_pending: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

interface TrainingContentAssignmentRow {
  id: string;
  org_id: string;
  content_id: string;
  assignment_type: TrainingContentAssignmentType;
  subject_user_id: string | null;
  created_by_actor_id: string;
  created_at: string | Date;
  revoked_by_actor_id: string | null;
  revoked_at: string | Date | null;
}

interface TrainingContentManagementRow extends TrainingContentItemRow {
  total_count: string | number;
  category_name: string;
  current_asset_id: string | null;
  current_asset_org_id: string | null;
  current_asset_content_id: string | null;
  current_asset_role: TrainingContentAssetRole | null;
  current_asset_version: number | null;
  current_asset_upload_state: TrainingContentAssetUploadState | null;
  current_asset_original_filename: string | null;
  current_asset_declared_mime_type: string | null;
  current_asset_detected_mime_type: string | null;
  current_asset_file_extension: string | null;
  current_asset_declared_byte_size: string | number | null;
  current_asset_byte_size: string | number | null;
  current_asset_upload_expires_at: string | Date | null;
  current_asset_processing_attempt_count: string | number | null;
  current_asset_processing_next_attempt_at: string | Date | null;
  current_asset_processing_error_category: string | null;
  current_asset_rejection_reason_category: string | null;
  current_asset_finalized_at: string | Date | null;
  current_asset_superseded_at: string | Date | null;
  current_asset_replacement_for_asset_id: string | null;
  current_asset_is_current: boolean | null;
  current_asset_cleanup_pending: boolean | null;
  current_asset_created_at: string | Date | null;
  current_asset_updated_at: string | Date | null;
  has_active_video_processing: boolean;
  organization_assignment_count: string | number;
  user_assignment_count: string | number;
  manager_assignment_count: string | number;
  manager_team_assignment_count: string | number;
}

interface TrainingContentMobileRow extends TrainingContentItemRow {
  category_name: string;
  category_description: string;
  category_display_order: number;
  category_is_default: boolean;
  category_created_by_actor_id: string;
  category_updated_by_actor_id: string;
  category_created_at: string | Date;
  category_updated_at: string | Date;
  category_archived_at: string | Date | null;
  current_asset_id: string | null;
  current_asset_org_id: string | null;
  current_asset_content_id: string | null;
  current_asset_upload_state: TrainingContentAssetUploadState | null;
  current_asset_original_filename: string | null;
  current_asset_detected_mime_type: string | null;
  current_asset_file_extension: string | null;
  current_asset_byte_size: string | number | null;
  current_asset_is_current: boolean | null;
  current_asset_final_object_key: string | null;
  current_asset_object_deleted_at: string | Date | null;
}

interface TrainingContentCategoryIdentityRow {
  id: string;
  org_id: string;
}

const CONTENT_COLUMNS = `
  id,
  org_id,
  category_id,
  title,
  description,
  focus_topic_id,
  focus_topic_name_snapshot,
  content_type,
  publication_state,
  native_body,
  external_url,
  display_order,
  content_version,
  created_by_actor_id,
  updated_by_actor_id,
  created_at,
  updated_at,
  published_at,
  archived_at
`;

const CURRENT_ASSET_COLUMNS = `
  id,
  org_id,
  content_id,
  asset_role,
  version,
  upload_state,
  original_filename,
  declared_mime_type,
  detected_mime_type,
  file_extension,
  declared_byte_size,
  byte_size,
  upload_expires_at,
  processing_attempt_count,
  processing_next_attempt_at,
  processing_error_category,
  rejection_reason_category,
  finalized_at,
  superseded_at,
  replacement_for_asset_id,
  is_current,
  cleanup_pending,
  created_at,
  updated_at
`;

const ASSIGNMENT_COLUMNS = `
  id,
  org_id,
  content_id,
  assignment_type,
  subject_user_id,
  created_by_actor_id,
  created_at,
  revoked_by_actor_id,
  revoked_at
`;

class NullTrainingContentStore implements TrainingContentStore {
  async initialize(): Promise<void> {
    // Training Content is relational and unavailable for non-postgres providers.
  }

  async listContentItemsForOrg(): Promise<TrainingContentItem[]> {
    return [];
  }

  async getContentItemForOrg(): Promise<TrainingContentItem | null> {
    return null;
  }

  async listPublishedContentForMobile(): Promise<TrainingContentMobileReadResult> {
    return { items: [], truncated: false };
  }

  async getPublishedContentForMobile(): Promise<TrainingContentMobileReadRecord | null> {
    return null;
  }

  async listContentForManagement(): Promise<TrainingContentManagementListResult> {
    return this.unavailable();
  }

  async getContentDetailForOrg(): Promise<TrainingContentManagementDetail | null> {
    return this.unavailable();
  }

  async createContent(): Promise<TrainingContentManagementDetail> {
    return this.unavailable();
  }

  async updateContent(): Promise<TrainingContentManagementDetail> {
    return this.unavailable();
  }

  async replaceAssignments(): Promise<TrainingContentManagementDetail> {
    return this.unavailable();
  }

  async transitionContent(): Promise<TrainingContentManagementDetail> {
    return this.unavailable();
  }

  private unavailable<T>(): T {
    throw new Error("Training Content management requires PostgreSQL storage.");
  }
}

class PostgresTrainingContentStore implements TrainingContentStore {
  private readonly pool: TrainingContentQueryPool;
  private ensureSchemaPromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    queryPool?: TrainingContentQueryPool
  ) {
    this.pool =
      queryPool ??
      new Pool({
        connectionString: databaseUrl,
        max: options.pgPoolMax,
        connectionTimeoutMillis: options.pgConnectTimeoutMs,
        idleTimeoutMillis: options.pgIdleTimeoutMs,
        keepAlive: true,
      });
  }

  async initialize(): Promise<void> {
    if (!this.ensureSchemaPromise) {
      this.ensureSchemaPromise = initializeTrainingContentSchema(this.pool);
    }
    await this.ensureSchemaPromise;
  }

  async listContentItemsForOrg(orgId: string): Promise<TrainingContentItem[]> {
    await this.initialize();
    const result = await this.pool.query<TrainingContentItemRow>(
      `
        SELECT ${CONTENT_COLUMNS}
        FROM org_content_items
        WHERE org_id = $1
        ORDER BY display_order ASC, updated_at DESC, id ASC
      `,
      [requiredId(orgId, "Organization id")]
    );
    return result.rows.map(mapContentItemRow);
  }

  async getContentItemForOrg(orgId: string, contentId: string): Promise<TrainingContentItem | null> {
    await this.initialize();
    return getContentItem(this.pool, orgId, contentId);
  }

  async listPublishedContentForMobile(
    orgId: string,
    maximumItems = 500
  ): Promise<TrainingContentMobileReadResult> {
    await this.initialize();
    const normalizedOrgId = requiredId(orgId, "Organization id");
    const limit = boundedInteger(maximumItems, 1, 500, 500);
    const result = await this.pool.query<TrainingContentMobileRow>(
      mobilePublishedContentQuery(""),
      [normalizedOrgId, limit + 1]
    );
    const selectedRows = result.rows.slice(0, limit);
    const assignments = await listActiveAssignments(
      this.pool,
      normalizedOrgId,
      selectedRows.map((row) => row.id)
    );
    return {
      items: selectedRows.map((row) => mapMobileReadRow(row, assignments.get(row.id) ?? [])),
      truncated: result.rows.length > limit,
    };
  }

  async getPublishedContentForMobile(
    orgId: string,
    contentId: string
  ): Promise<TrainingContentMobileReadRecord | null> {
    await this.initialize();
    const normalizedOrgId = requiredId(orgId, "Organization id");
    const normalizedContentId = requiredId(contentId, "Content id");
    const result = await this.pool.query<TrainingContentMobileRow>(
      mobilePublishedContentQuery("AND c.id = $2", "LIMIT 1"),
      [normalizedOrgId, normalizedContentId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const assignments = await listActiveAssignments(this.pool, normalizedOrgId, [row.id]);
    return mapMobileReadRow(row, assignments.get(row.id) ?? []);
  }

  async listContentForManagement(
    orgId: string,
    filters: TrainingContentListFilters = {}
  ): Promise<TrainingContentManagementListResult> {
    await this.initialize();
    const normalizedOrgId = requiredId(orgId, "Organization id");
    const page = boundedInteger(filters.page, 1, 10_000, 1);
    const pageSize = boundedInteger(filters.pageSize, 1, 100, 25);
    const values: unknown[] = [normalizedOrgId];
    const conditions = ["c.org_id = $1"];

    const query = filters.query?.trim();
    if (query) {
      values.push(query);
      const parameter = `$${values.length}`;
      conditions.push(`(
        STRPOS(LOWER(c.title), LOWER(${parameter})) > 0
        OR STRPOS(LOWER(c.description), LOWER(${parameter})) > 0
        OR STRPOS(LOWER(category.name), LOWER(${parameter})) > 0
        OR STRPOS(LOWER(COALESCE(c.focus_topic_name_snapshot, '')), LOWER(${parameter})) > 0
      )`);
    }
    if (filters.categoryId?.trim()) {
      values.push(filters.categoryId.trim());
      conditions.push(`c.category_id = $${values.length}`);
    }
    if (filters.focusTopicId?.trim()) {
      values.push(filters.focusTopicId.trim());
      conditions.push(`c.focus_topic_id = $${values.length}`);
    }
    if (filters.contentType) {
      values.push(filters.contentType);
      conditions.push(`c.content_type = $${values.length}`);
    }
    if (filters.publicationState) {
      values.push(filters.publicationState);
      conditions.push(`c.publication_state = $${values.length}`);
    } else {
      conditions.push("c.publication_state <> 'archived'");
    }

    const whereClause = conditions.join("\n          AND ");
    const filterValues = [...values];
    values.push(pageSize, (page - 1) * pageSize);
    const limitParameter = `$${values.length - 1}`;
    const offsetParameter = `$${values.length}`;
    const orderBy = filters.sort === "title_asc"
      ? "LOWER(c.title) ASC, c.updated_at DESC, c.id ASC"
      : filters.sort === "library_order"
        ? "category.display_order ASC, c.display_order ASC, LOWER(c.title) ASC, c.id ASC"
        : "c.updated_at DESC, LOWER(c.title) ASC, c.id ASC";

    const result = await this.pool.query<TrainingContentManagementRow>(
      `
        SELECT
          c.*,
          COUNT(*) OVER() AS total_count,
          category.name AS category_name,
          asset.id AS current_asset_id,
          asset.org_id AS current_asset_org_id,
          asset.content_id AS current_asset_content_id,
          asset.asset_role AS current_asset_role,
          asset.version AS current_asset_version,
          asset.upload_state AS current_asset_upload_state,
          asset.original_filename AS current_asset_original_filename,
          asset.declared_mime_type AS current_asset_declared_mime_type,
          asset.detected_mime_type AS current_asset_detected_mime_type,
          asset.file_extension AS current_asset_file_extension,
          asset.declared_byte_size AS current_asset_declared_byte_size,
          asset.byte_size AS current_asset_byte_size,
          asset.upload_expires_at AS current_asset_upload_expires_at,
          asset.processing_attempt_count AS current_asset_processing_attempt_count,
          asset.processing_next_attempt_at AS current_asset_processing_next_attempt_at,
          asset.processing_error_category AS current_asset_processing_error_category,
          asset.rejection_reason_category AS current_asset_rejection_reason_category,
          asset.finalized_at AS current_asset_finalized_at,
          asset.superseded_at AS current_asset_superseded_at,
          asset.replacement_for_asset_id AS current_asset_replacement_for_asset_id,
          asset.is_current AS current_asset_is_current,
          asset.cleanup_pending AS current_asset_cleanup_pending,
          asset.created_at AS current_asset_created_at,
          asset.updated_at AS current_asset_updated_at,
          EXISTS (
            SELECT 1
            FROM org_content_assets processing_asset
            WHERE processing_asset.org_id = c.org_id
              AND processing_asset.content_id = c.id
              AND processing_asset.asset_role = 'primary'
              AND processing_asset.upload_state = 'processing'
          ) AS has_active_video_processing,
          COALESCE(assignments.organization_count, 0) AS organization_assignment_count,
          COALESCE(assignments.user_count, 0) AS user_assignment_count,
          COALESCE(assignments.manager_count, 0) AS manager_assignment_count,
          COALESCE(assignments.manager_team_count, 0) AS manager_team_assignment_count
        FROM org_content_items c
        INNER JOIN org_content_categories category
          ON category.org_id = c.org_id
         AND category.id = c.category_id
        LEFT JOIN LATERAL (
          SELECT ${CURRENT_ASSET_COLUMNS}
          FROM org_content_assets
          WHERE org_id = c.org_id
            AND content_id = c.id
            AND asset_role = 'primary'
            AND is_current = TRUE
          LIMIT 1
        ) asset ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE assignment_type = 'organization') AS organization_count,
            COUNT(*) FILTER (WHERE assignment_type = 'user') AS user_count,
            COUNT(*) FILTER (WHERE assignment_type = 'manager') AS manager_count,
            COUNT(*) FILTER (WHERE assignment_type = 'manager_team') AS manager_team_count
          FROM org_content_assignments
          WHERE org_id = c.org_id
            AND content_id = c.id
            AND revoked_at IS NULL
        ) assignments ON TRUE
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ${limitParameter}
        OFFSET ${offsetParameter}
      `,
      values
    );
    let total = result.rows[0]
      ? databaseInteger(result.rows[0].total_count, "Content total")
      : 0;
    if (result.rows.length === 0 && page > 1) {
      const countResult = await this.pool.query<{ count: string | number }>(
        `
          SELECT COUNT(*) AS count
          FROM org_content_items c
          INNER JOIN org_content_categories category
            ON category.org_id = c.org_id
           AND category.id = c.category_id
          WHERE ${whereClause}
        `,
        filterValues
      );
      total = databaseInteger(countResult.rows[0]?.count ?? 0, "Content total");
    }

    return {
      items: result.rows.map(mapManagementRow),
      page,
      pageSize,
      total,
    };
  }

  async getContentDetailForOrg(
    orgId: string,
    contentId: string
  ): Promise<TrainingContentManagementDetail | null> {
    await this.initialize();
    return readContentDetail(this.pool, orgId, contentId);
  }

  async createContent(input: CreateTrainingContentInput): Promise<TrainingContentManagementDetail> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = input.now ?? new Date();
    const contentId = randomUUID();
    try {
      await client.query("BEGIN");
      const category = await lockActiveCategory(client, input.orgId, input.categoryId);
      const orderResult = await client.query<{ max_order: string | number | null }>(
        `
          SELECT MAX(display_order) AS max_order
          FROM org_content_items
          WHERE org_id = $1 AND category_id = $2
        `,
        [category.orgId, category.id]
      );
      const displayOrder =
        (optionalDatabaseInteger(orderResult.rows[0]?.max_order ?? null, "Display order") ?? -1) + 1;
      const inserted = await client.query<TrainingContentItemRow>(
        `
          INSERT INTO org_content_items (
            id,
            org_id,
            category_id,
            title,
            description,
            focus_topic_id,
            focus_topic_name_snapshot,
            content_type,
            publication_state,
            native_body,
            external_url,
            display_order,
            content_version,
            created_by_actor_id,
            updated_by_actor_id,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, 1, $12, $12, $13, $13
          )
          RETURNING ${CONTENT_COLUMNS}
        `,
        [
          contentId,
          category.orgId,
          category.id,
          input.title,
          input.description,
          input.focusTopicId,
          input.focusTopicNameSnapshot,
          input.contentType,
          input.nativeBody,
          input.externalUrl,
          displayOrder,
          requiredId(input.actor.actorId, "Actor id"),
          now,
        ]
      );
      const content = mapRequiredContentRow(inserted.rows[0]);
      await insertAuditEvent(client, {
        actor: input.actor,
        action: "training_content_created",
        orgId: content.orgId,
        contentId: content.id,
        contentType: content.contentType,
        contentVersion: content.contentVersion,
        metadata: {
          publicationState: content.publicationState,
          categoryId: content.categoryId,
          focusTopicId: content.focusTopicId,
        },
        now,
      });
      const detail = await readRequiredContentDetail(client, content.orgId, content.id);
      await client.query("COMMIT");
      return detail;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateContent(input: UpdateTrainingContentInput): Promise<TrainingContentManagementDetail> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const requestedCategory = input.categoryId
        ? await lockActiveCategory(client, input.orgId, input.categoryId)
        : null;
      const current = await lockContent(client, input.orgId, input.contentId);
      assertExpectedUpdatedAt(current, input.expectedUpdatedAt);
      if (current.publicationState === "archived") {
        throw new TrainingContentStoreError(
          "Archived Training Content cannot be edited.",
          "training_content_archived"
        );
      }

      const next = {
        categoryId: requestedCategory?.id ?? current.categoryId,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        focusTopicId: input.focusTopicId === undefined ? current.focusTopicId : input.focusTopicId,
        focusTopicNameSnapshot: input.focusTopicNameSnapshot === undefined
          ? current.focusTopicNameSnapshot
          : input.focusTopicNameSnapshot,
        nativeBody: input.nativeBody === undefined ? current.nativeBody : input.nativeBody,
        externalUrl: input.externalUrl === undefined ? current.externalUrl : input.externalUrl,
      };
      const categoryChanged = next.categoryId !== current.categoryId;
      let nextDisplayOrder = current.displayOrder;
      if (categoryChanged) {
        const orderResult = await client.query<{ max_order: string | number | null }>(
          `
            SELECT MAX(display_order) AS max_order
            FROM org_content_items
            WHERE org_id = $1 AND category_id = $2
          `,
          [current.orgId, next.categoryId]
        );
        nextDisplayOrder =
          (optionalDatabaseInteger(orderResult.rows[0]?.max_order ?? null, "Display order") ?? -1)
          + 1;
      }
      const changedFields = [
        categoryChanged ? "category" : null,
        next.title !== current.title ? "title" : null,
        next.description !== current.description ? "description" : null,
        next.focusTopicId !== current.focusTopicId
          || next.focusTopicNameSnapshot !== current.focusTopicNameSnapshot
          ? "focusTopic"
          : null,
        next.nativeBody !== current.nativeBody ? "nativeBody" : null,
        next.externalUrl !== current.externalUrl ? "externalUrl" : null,
      ].filter((field): field is string => Boolean(field));

      if (changedFields.length === 0) {
        const detail = await readRequiredContentDetail(client, current.orgId, current.id);
        await client.query("COMMIT");
        return detail;
      }

      const sourceChanged = changedFields.includes("nativeBody") || changedFields.includes("externalUrl");
      const now = nextMutationTime(current.updatedAt, input.now ?? new Date());
      const updated = await client.query<TrainingContentItemRow>(
        `
          UPDATE org_content_items
          SET category_id = $3,
              title = $4,
              description = $5,
              focus_topic_id = $6,
              focus_topic_name_snapshot = $7,
              native_body = $8,
              external_url = $9,
              display_order = $10,
              content_version = content_version + $11,
              updated_by_actor_id = $12,
              updated_at = $13
          WHERE org_id = $1 AND id = $2
          RETURNING ${CONTENT_COLUMNS}
        `,
        [
          current.orgId,
          current.id,
          next.categoryId,
          next.title,
          next.description,
          next.focusTopicId,
          next.focusTopicNameSnapshot,
          next.nativeBody,
          next.externalUrl,
          nextDisplayOrder,
          sourceChanged ? 1 : 0,
          requiredId(input.actor.actorId, "Actor id"),
          now,
        ]
      );
      const content = mapRequiredContentRow(updated.rows[0]);
      if (content.publicationState === "published") {
        await assertPublishable(client, content);
      }
      const metadataFields = changedFields.filter(
        (field) => field !== "nativeBody" && field !== "externalUrl"
      );
      if (metadataFields.length > 0) {
        await insertAuditEvent(client, {
          actor: input.actor,
          action: "training_content_metadata_updated",
          orgId: content.orgId,
          contentId: content.id,
          contentType: content.contentType,
          contentVersion: content.contentVersion,
          metadata: {
            changedFields: metadataFields,
            categoryId: content.categoryId,
            focusTopicId: content.focusTopicId,
          },
          now,
        });
      }
      if (changedFields.includes("nativeBody")) {
        await insertAuditEvent(client, {
          actor: input.actor,
          action: "training_content_native_body_updated",
          orgId: content.orgId,
          contentId: content.id,
          contentType: content.contentType,
          contentVersion: content.contentVersion,
          metadata: { changedFields: ["nativeBody"] },
          now,
        });
      }
      if (changedFields.includes("externalUrl")) {
        await insertAuditEvent(client, {
          actor: input.actor,
          action: "training_content_external_url_updated",
          orgId: content.orgId,
          contentId: content.id,
          contentType: content.contentType,
          contentVersion: content.contentVersion,
          metadata: { changedFields: ["externalUrl"] },
          now,
        });
      }
      const detail = await readRequiredContentDetail(client, content.orgId, content.id);
      await client.query("COMMIT");
      return detail;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceAssignments(
    input: ReplaceTrainingContentAssignmentsInput
  ): Promise<TrainingContentManagementDetail> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const content = await lockContent(client, input.orgId, input.contentId);
      assertExpectedUpdatedAt(content, input.expectedUpdatedAt);
      if (content.publicationState === "archived") {
        throw new TrainingContentStoreError(
          "Archived Training Content assignments cannot be changed.",
          "training_content_archived"
        );
      }

      const activeResult = await client.query<TrainingContentAssignmentRow>(
        `
          SELECT ${ASSIGNMENT_COLUMNS}
          FROM org_content_assignments
          WHERE org_id = $1 AND content_id = $2 AND revoked_at IS NULL
          FOR UPDATE
        `,
        [content.orgId, content.id]
      );
      const active = activeResult.rows.map(mapAssignmentRow);
      const desired = deduplicateAssignments(input.assignments);
      const activeByKey = new Map(active.map((assignment) => [assignmentKey(assignment), assignment]));
      const desiredByKey = new Map(desired.map((assignment) => [assignmentKey(assignment), assignment]));
      const removed = active.filter((assignment) => !desiredByKey.has(assignmentKey(assignment)));
      const added = desired.filter((assignment) => !activeByKey.has(assignmentKey(assignment)));

      if (removed.length === 0 && added.length === 0) {
        const detail = await readRequiredContentDetail(client, content.orgId, content.id);
        await client.query("COMMIT");
        return detail;
      }

      const now = nextMutationTime(content.updatedAt, input.now ?? new Date());
      const actorId = requiredId(input.actor.actorId, "Actor id");
      if (removed.length > 0) {
        await client.query(
          `
            UPDATE org_content_assignments
            SET revoked_by_actor_id = $4,
                revoked_at = $5
            WHERE org_id = $1
              AND content_id = $2
              AND id = ANY($3::uuid[])
              AND revoked_at IS NULL
          `,
          [content.orgId, content.id, removed.map((assignment) => assignment.id), actorId, now]
        );
      }
      for (const assignment of added) {
        await client.query(
          `
            INSERT INTO org_content_assignments (
              id,
              org_id,
              content_id,
              assignment_type,
              subject_user_id,
              created_by_actor_id,
              created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            randomUUID(),
            content.orgId,
            content.id,
            assignment.assignmentType,
            assignment.subjectUserId,
            actorId,
            now,
          ]
        );
      }
      if (content.publicationState === "published") {
        await assertPublishable(client, content);
      }
      await client.query(
        `
          UPDATE org_content_items
          SET updated_by_actor_id = $3,
              updated_at = $4
          WHERE org_id = $1 AND id = $2
        `,
        [content.orgId, content.id, actorId, now]
      );
      const counts = countAssignmentInputs(desired);
      await insertAuditEvent(client, {
        actor: input.actor,
        action: "training_content_assignments_changed",
        orgId: content.orgId,
        contentId: content.id,
        contentType: content.contentType,
        contentVersion: content.contentVersion,
        metadata: {
          assignmentTypeCounts: counts,
          addedCount: added.length,
          revokedCount: removed.length,
        },
        now,
      });
      const detail = await readRequiredContentDetail(client, content.orgId, content.id);
      await client.query("COMMIT");
      return detail;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionContent(
    input: TransitionTrainingContentInput
  ): Promise<TrainingContentManagementDetail> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const content = await lockContent(client, input.orgId, input.contentId);
      assertExpectedUpdatedAt(content, input.expectedUpdatedAt);
      if (content.publicationState === "archived") {
        throw new TrainingContentStoreError(
          "Archived Training Content cannot change publication state.",
          "training_content_archived"
        );
      }

      const nextState: TrainingContentPublicationState =
        input.action === "publish"
          ? "published"
          : input.action === "archive"
            ? "archived"
            : "draft";
      if (content.publicationState === nextState) {
        const detail = await readRequiredContentDetail(client, content.orgId, content.id);
        await client.query("COMMIT");
        return detail;
      }

      if (input.action === "publish") {
        await assertPublishable(client, content);
      }
      const now = nextMutationTime(content.updatedAt, input.now ?? new Date());
      const actorId = requiredId(input.actor.actorId, "Actor id");
      if (input.action === "archive") {
        await client.query(
          `
            UPDATE org_content_assignments
            SET revoked_by_actor_id = $3,
                revoked_at = $4
            WHERE org_id = $1 AND content_id = $2 AND revoked_at IS NULL
          `,
          [content.orgId, content.id, actorId, now]
        );
      }
      const updated = await client.query<TrainingContentItemRow>(
        `
          UPDATE org_content_items
          SET publication_state = $3,
              published_at = CASE WHEN $3 = 'published' THEN $4 ELSE published_at END,
              archived_at = CASE WHEN $3 = 'archived' THEN $4 ELSE archived_at END,
              updated_by_actor_id = $5,
              updated_at = $4
          WHERE org_id = $1 AND id = $2
          RETURNING ${CONTENT_COLUMNS}
        `,
        [content.orgId, content.id, nextState, now, actorId]
      );
      const next = mapRequiredContentRow(updated.rows[0]);
      const action = input.action === "publish"
        ? "training_content_published"
        : input.action === "archive"
          ? "training_content_archived"
          : "training_content_unpublished";
      await insertAuditEvent(client, {
        actor: input.actor,
        action,
        orgId: next.orgId,
        contentId: next.id,
        contentType: next.contentType,
        contentVersion: next.contentVersion,
        metadata: {
          previousPublicationState: content.publicationState,
          newPublicationState: next.publicationState,
        },
        now,
      });
      const detail = await readRequiredContentDetail(client, next.orgId, next.id);
      await client.query("COMMIT");
      return detail;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function getContentItem(
  queryable: TrainingContentQueryable,
  orgId: string,
  contentId: string
): Promise<TrainingContentItem | null> {
  const result = await queryable.query<TrainingContentItemRow>(
    `
      SELECT ${CONTENT_COLUMNS}
      FROM org_content_items
      WHERE org_id = $1 AND id = $2
      LIMIT 1
    `,
    [requiredId(orgId, "Organization id"), requiredId(contentId, "Content id")]
  );
  return result.rows[0] ? mapContentItemRow(result.rows[0]) : null;
}

async function lockContent(
  client: Pick<PoolClient, "query">,
  orgId: string,
  contentId: string
): Promise<TrainingContentItem> {
  const result = await client.query<TrainingContentItemRow>(
    `
      SELECT ${CONTENT_COLUMNS}
      FROM org_content_items
      WHERE org_id = $1 AND id = $2
      FOR UPDATE
    `,
    [requiredId(orgId, "Organization id"), requiredId(contentId, "Content id")]
  );
  if (!result.rows[0]) {
    throw new TrainingContentStoreError(
      "Training Content item was not found.",
      "training_content_not_found"
    );
  }
  return mapContentItemRow(result.rows[0]);
}

async function lockActiveCategory(
  client: Pick<PoolClient, "query">,
  orgId: string,
  categoryId: string
): Promise<{ id: string; orgId: string }> {
  const result = await client.query<TrainingContentCategoryIdentityRow>(
    `
      SELECT id, org_id
      FROM org_content_categories
      WHERE org_id = $1 AND id = $2 AND archived_at IS NULL
      FOR UPDATE
    `,
    [requiredId(orgId, "Organization id"), requiredId(categoryId, "Category id")]
  );
  const row = result.rows[0];
  if (!row) {
    throw new TrainingContentStoreError(
      "Content Category was not found.",
      "training_content_category_not_found"
    );
  }
  return { id: row.id, orgId: row.org_id };
}

async function readContentDetail(
  queryable: TrainingContentQueryable,
  orgId: string,
  contentId: string
): Promise<TrainingContentManagementDetail | null> {
  const content = await getContentItem(queryable, orgId, contentId);
  if (!content) {
    return null;
  }
  const [categoryResult, assetResult, latestVideoUploadResult, assignmentResult] =
    await Promise.all([
    queryable.query<{ name: string }>(
      `
        SELECT name
        FROM org_content_categories
        WHERE org_id = $1 AND id = $2
        LIMIT 1
      `,
      [content.orgId, content.categoryId]
    ),
    queryable.query<TrainingContentAssetRow>(
      `
        SELECT ${CURRENT_ASSET_COLUMNS}
        FROM org_content_assets
        WHERE org_id = $1
          AND content_id = $2
          AND asset_role = 'primary'
          AND is_current = TRUE
        LIMIT 1
      `,
      [content.orgId, content.id]
    ),
    content.contentType === "video"
      ? queryable.query<TrainingContentAssetRow>(
        `
          SELECT ${CURRENT_ASSET_COLUMNS}
          FROM org_content_assets candidate
          WHERE candidate.org_id = $1
            AND candidate.content_id = $2
            AND candidate.asset_role = 'primary'
            AND candidate.upload_state IN ('processing', 'rejected')
            AND candidate.version > COALESCE((
              SELECT MAX(current_asset.version)
              FROM org_content_assets current_asset
              WHERE current_asset.org_id = candidate.org_id
                AND current_asset.content_id = candidate.content_id
                AND current_asset.asset_role = candidate.asset_role
                AND current_asset.is_current = TRUE
            ), 0)
          ORDER BY candidate.version DESC
          LIMIT 1
        `,
        [content.orgId, content.id]
      )
      : Promise.resolve({ rows: [] as TrainingContentAssetRow[] }),
    queryable.query<TrainingContentAssignmentRow>(
      `
        SELECT ${ASSIGNMENT_COLUMNS}
        FROM org_content_assignments
        WHERE org_id = $1 AND content_id = $2 AND revoked_at IS NULL
        ORDER BY assignment_type ASC, subject_user_id ASC NULLS FIRST, created_at ASC, id ASC
      `,
      [content.orgId, content.id]
    ),
  ]);
  const categoryName = categoryResult.rows[0]?.name;
  if (!categoryName) {
    throw new Error("Training Content category row is missing.");
  }
  const assignments = assignmentResult.rows.map(mapAssignmentRow);
  return {
    content,
    categoryName,
    currentAsset: assetResult.rows[0] ? mapCurrentAssetRow(assetResult.rows[0]) : null,
    hasActiveVideoProcessing:
      latestVideoUploadResult.rows[0]?.upload_state === "processing",
    latestVideoUploadAsset: latestVideoUploadResult.rows[0]
      ? mapCurrentAssetRow(latestVideoUploadResult.rows[0])
      : null,
    assignments,
    assignmentCounts: countAssignments(assignments),
  };
}

async function readRequiredContentDetail(
  queryable: TrainingContentQueryable,
  orgId: string,
  contentId: string
): Promise<TrainingContentManagementDetail> {
  const detail = await readContentDetail(queryable, orgId, contentId);
  if (!detail) {
    throw new TrainingContentStoreError(
      "Training Content item was not found.",
      "training_content_not_found"
    );
  }
  return detail;
}

async function assertPublishable(
  client: Pick<PoolClient, "query">,
  content: TrainingContentItem
): Promise<void> {
  const reasons: string[] = [];
  const assignmentResult = await client.query<{ count: string | number }>(
    `
      SELECT COUNT(*) AS count
      FROM org_content_assignments
      WHERE org_id = $1 AND content_id = $2 AND revoked_at IS NULL
    `,
    [content.orgId, content.id]
  );
  if (databaseInteger(assignmentResult.rows[0]?.count ?? 0, "Assignment count") === 0) {
    reasons.push("assignment_required");
  }
  if (content.contentType === "native" && !content.nativeBody?.trim()) {
    reasons.push("native_body_required");
  }
  if (content.contentType === "external_url" && !isValidStoredHttpsUrl(content.externalUrl)) {
    reasons.push("https_url_required");
  }
  if (isUploadedContentType(content.contentType)) {
    const assetResult = await client.query<{ count: string | number }>(
      `
        SELECT COUNT(*) AS count
        FROM org_content_assets
        WHERE org_id = $1
          AND content_id = $2
          AND asset_role = 'primary'
          AND upload_state = 'ready'
          AND is_current = TRUE
          AND object_deleted_at IS NULL
      `,
      [content.orgId, content.id]
    );
    if (databaseInteger(assetResult.rows[0]?.count ?? 0, "Ready asset count") === 0) {
      reasons.push("ready_asset_required");
    }
  }
  if (reasons.length > 0) {
    throw new TrainingContentStoreError(
      "Training Content is not ready to publish.",
      "training_content_publish_invalid",
      { reasons }
    );
  }
}

function isUploadedContentType(contentType: TrainingContentType): boolean {
  return ["video", "audio", "pdf", "docx", "image"].includes(contentType);
}

function isValidStoredHttpsUrl(value: string | null): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function mobilePublishedContentQuery(
  additionalCondition: string,
  limitClause = "LIMIT $2"
): string {
  return `
    SELECT
      c.*,
      category.name AS category_name,
      category.description AS category_description,
      category.display_order AS category_display_order,
      category.is_default AS category_is_default,
      category.created_by_actor_id AS category_created_by_actor_id,
      category.updated_by_actor_id AS category_updated_by_actor_id,
      category.created_at AS category_created_at,
      category.updated_at AS category_updated_at,
      category.archived_at AS category_archived_at,
      asset.id AS current_asset_id,
      asset.org_id AS current_asset_org_id,
      asset.content_id AS current_asset_content_id,
      asset.upload_state AS current_asset_upload_state,
      asset.original_filename AS current_asset_original_filename,
      asset.detected_mime_type AS current_asset_detected_mime_type,
      asset.file_extension AS current_asset_file_extension,
      asset.byte_size AS current_asset_byte_size,
      asset.is_current AS current_asset_is_current,
      asset.final_object_key AS current_asset_final_object_key,
      asset.object_deleted_at AS current_asset_object_deleted_at
    FROM org_content_items c
    INNER JOIN org_content_categories category
      ON category.org_id = c.org_id
     AND category.id = c.category_id
     AND category.archived_at IS NULL
    LEFT JOIN LATERAL (
      SELECT
        id,
        org_id,
        content_id,
        upload_state,
        original_filename,
        detected_mime_type,
        file_extension,
        byte_size,
        is_current,
        final_object_key,
        object_deleted_at
      FROM org_content_assets
      WHERE org_id = c.org_id
        AND content_id = c.id
        AND asset_role = 'primary'
        AND upload_state = 'ready'
        AND is_current = TRUE
        AND object_deleted_at IS NULL
      LIMIT 1
    ) asset ON TRUE
    WHERE c.org_id = $1
      AND c.publication_state = 'published'
      AND c.archived_at IS NULL
      ${additionalCondition}
    ORDER BY
      category.display_order ASC,
      c.display_order ASC,
      LOWER(c.title) ASC,
      c.id ASC
    ${limitClause}
  `;
}

async function listActiveAssignments(
  queryable: TrainingContentQueryable,
  orgId: string,
  contentIds: string[]
): Promise<Map<string, TrainingContentAssignment[]>> {
  const byContentId = new Map<string, TrainingContentAssignment[]>();
  if (contentIds.length === 0) {
    return byContentId;
  }
  const result = await queryable.query<TrainingContentAssignmentRow>(
    `
      SELECT ${ASSIGNMENT_COLUMNS}
      FROM org_content_assignments
      WHERE org_id = $1
        AND content_id = ANY($2::uuid[])
        AND revoked_at IS NULL
      ORDER BY content_id ASC, assignment_type ASC, subject_user_id ASC NULLS FIRST, id ASC
    `,
    [orgId, contentIds]
  );
  for (const row of result.rows) {
    const mapped = mapAssignmentRow(row);
    const assignments = byContentId.get(mapped.contentId) ?? [];
    assignments.push(mapped);
    byContentId.set(mapped.contentId, assignments);
  }
  return byContentId;
}

function mapMobileReadRow(
  row: TrainingContentMobileRow,
  assignments: TrainingContentAssignment[]
): TrainingContentMobileReadRecord {
  return {
    content: mapContentItemRow(row),
    category: {
      id: row.category_id,
      orgId: row.org_id,
      name: row.category_name,
      description: row.category_description,
      displayOrder: row.category_display_order,
      isDefault: row.category_is_default,
      createdByActorId: row.category_created_by_actor_id,
      updatedByActorId: row.category_updated_by_actor_id,
      createdAt: requiredIso(row.category_created_at, "Category created time"),
      updatedAt: requiredIso(row.category_updated_at, "Category updated time"),
      archivedAt: optionalIso(row.category_archived_at),
    },
    currentAsset: mapMobileAssetRow(row),
    assignments,
  };
}

function mapMobileAssetRow(
  row: TrainingContentMobileRow
): TrainingContentMobileAssetRecord | null {
  if (!row.current_asset_id) {
    return null;
  }
  if (
    !row.current_asset_org_id
    || !row.current_asset_content_id
    || !row.current_asset_upload_state
  ) {
    throw new Error("Current Training Content mobile asset row is incomplete.");
  }
  return {
    id: row.current_asset_id,
    orgId: row.current_asset_org_id,
    contentId: row.current_asset_content_id,
    uploadState: row.current_asset_upload_state,
    originalFilename: row.current_asset_original_filename,
    detectedMimeType: row.current_asset_detected_mime_type,
    fileExtension: row.current_asset_file_extension,
    byteSize: optionalDatabaseInteger(row.current_asset_byte_size, "Byte size"),
    isCurrent: row.current_asset_is_current === true,
    finalObjectKey: row.current_asset_final_object_key,
    objectDeletedAt: optionalIso(row.current_asset_object_deleted_at),
  };
}

function mapManagementRow(row: TrainingContentManagementRow): TrainingContentManagementListRow {
  return {
    content: mapContentItemRow(row),
    categoryName: row.category_name,
    currentAsset: mapPrefixedCurrentAssetRow(row),
    hasActiveVideoProcessing: row.has_active_video_processing === true,
    assignmentCounts: {
      organization: databaseInteger(row.organization_assignment_count, "Organization assignment count"),
      user: databaseInteger(row.user_assignment_count, "User assignment count"),
      manager: databaseInteger(row.manager_assignment_count, "Manager assignment count"),
      managerTeam: databaseInteger(row.manager_team_assignment_count, "Manager team assignment count"),
    },
  };
}

function mapPrefixedCurrentAssetRow(
  row: TrainingContentManagementRow
): TrainingContentCurrentAssetRecord | null {
  if (!row.current_asset_id) {
    return null;
  }
  if (
    !row.current_asset_org_id
    || !row.current_asset_content_id
    || !row.current_asset_role
    || row.current_asset_version === null
    || !row.current_asset_upload_state
    || !row.current_asset_created_at
    || !row.current_asset_updated_at
  ) {
    throw new Error("Current Training Content asset row is incomplete.");
  }
  return {
    id: row.current_asset_id,
    orgId: row.current_asset_org_id,
    contentId: row.current_asset_content_id,
    assetRole: row.current_asset_role,
    version: row.current_asset_version,
    uploadState: row.current_asset_upload_state,
    originalFilename: row.current_asset_original_filename,
    declaredMimeType: row.current_asset_declared_mime_type,
    detectedMimeType: row.current_asset_detected_mime_type,
    fileExtension: row.current_asset_file_extension,
    declaredByteSize: optionalDatabaseInteger(
      row.current_asset_declared_byte_size,
      "Declared byte size"
    ),
    byteSize: optionalDatabaseInteger(row.current_asset_byte_size, "Byte size"),
    uploadExpiresAt: optionalIso(row.current_asset_upload_expires_at),
    processingAttemptCount: optionalDatabaseInteger(
      row.current_asset_processing_attempt_count,
      "Processing attempt count"
    ) ?? 0,
    processingNextAttemptAt: optionalIso(row.current_asset_processing_next_attempt_at),
    processingErrorCategory: row.current_asset_processing_error_category,
    rejectionReasonCategory: row.current_asset_rejection_reason_category,
    finalizedAt: optionalIso(row.current_asset_finalized_at),
    supersededAt: optionalIso(row.current_asset_superseded_at),
    replacementForAssetId: row.current_asset_replacement_for_asset_id,
    isCurrent: row.current_asset_is_current === true,
    cleanupPending: row.current_asset_cleanup_pending === true,
    createdAt: requiredIso(row.current_asset_created_at, "Asset created time"),
    updatedAt: requiredIso(row.current_asset_updated_at, "Asset updated time"),
  };
}

function mapCurrentAssetRow(row: TrainingContentAssetRow): TrainingContentCurrentAssetRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    contentId: row.content_id,
    assetRole: row.asset_role,
    version: row.version,
    uploadState: row.upload_state,
    originalFilename: row.original_filename,
    declaredMimeType: row.declared_mime_type,
    detectedMimeType: row.detected_mime_type,
    fileExtension: row.file_extension,
    declaredByteSize: optionalDatabaseInteger(row.declared_byte_size, "Declared byte size"),
    byteSize: optionalDatabaseInteger(row.byte_size, "Byte size"),
    uploadExpiresAt: optionalIso(row.upload_expires_at),
    processingAttemptCount: databaseInteger(
      row.processing_attempt_count,
      "Processing attempt count"
    ),
    processingNextAttemptAt: optionalIso(row.processing_next_attempt_at),
    processingErrorCategory: row.processing_error_category,
    rejectionReasonCategory: row.rejection_reason_category,
    finalizedAt: optionalIso(row.finalized_at),
    supersededAt: optionalIso(row.superseded_at),
    replacementForAssetId: row.replacement_for_asset_id,
    isCurrent: row.is_current === true,
    cleanupPending: row.cleanup_pending === true,
    createdAt: requiredIso(row.created_at, "Asset created time"),
    updatedAt: requiredIso(row.updated_at, "Asset updated time"),
  };
}

function mapContentItemRow(row: TrainingContentItemRow): TrainingContentItem {
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

function mapRequiredContentRow(row: TrainingContentItemRow | undefined): TrainingContentItem {
  if (!row) {
    throw new Error("Training Content mutation did not return a row.");
  }
  return mapContentItemRow(row);
}

function mapAssignmentRow(row: TrainingContentAssignmentRow): TrainingContentAssignment {
  return {
    id: row.id,
    orgId: row.org_id,
    contentId: row.content_id,
    assignmentType: row.assignment_type,
    subjectUserId: row.subject_user_id,
    createdByActorId: row.created_by_actor_id,
    createdAt: requiredIso(row.created_at, "Assignment created time"),
    revokedByActorId: row.revoked_by_actor_id,
    revokedAt: optionalIso(row.revoked_at),
  };
}

function countAssignments(
  assignments: readonly TrainingContentAssignment[]
): TrainingContentAssignmentCounts {
  return countAssignmentInputs(assignments);
}

function countAssignmentInputs(
  assignments: readonly {
    assignmentType: TrainingContentAssignmentType;
  }[]
): TrainingContentAssignmentCounts {
  return {
    organization: assignments.filter((entry) => entry.assignmentType === "organization").length,
    user: assignments.filter((entry) => entry.assignmentType === "user").length,
    manager: assignments.filter((entry) => entry.assignmentType === "manager").length,
    managerTeam: assignments.filter((entry) => entry.assignmentType === "manager_team").length,
  };
}

function deduplicateAssignments(
  assignments: readonly {
    assignmentType: TrainingContentAssignmentType;
    subjectUserId: string | null;
  }[]
): Array<{
  assignmentType: TrainingContentAssignmentType;
  subjectUserId: string | null;
}> {
  const byKey = new Map<string, {
    assignmentType: TrainingContentAssignmentType;
    subjectUserId: string | null;
  }>();
  for (const assignment of assignments) {
    byKey.set(assignmentKey(assignment), assignment);
  }
  return [...byKey.values()].sort((left, right) =>
    assignmentKey(left).localeCompare(assignmentKey(right))
  );
}

function assignmentKey(assignment: {
  assignmentType: TrainingContentAssignmentType;
  subjectUserId: string | null;
}): string {
  return `${assignment.assignmentType}:${assignment.subjectUserId ?? ""}`;
}

function assertExpectedUpdatedAt(content: TrainingContentItem, expectedUpdatedAt: string): void {
  const expected = requiredIso(expectedUpdatedAt, "Expected updated time");
  if (expected !== content.updatedAt) {
    throw new TrainingContentStoreError(
      "Training Content changed in another session. Reload before saving.",
      "training_content_conflict",
      { currentUpdatedAt: content.updatedAt }
    );
  }
}

function nextMutationTime(currentUpdatedAt: string, requested: Date): Date {
  const currentTime = new Date(currentUpdatedAt).getTime();
  const requestedTime = requested.getTime();
  if (!Number.isFinite(requestedTime)) {
    throw new Error("Training Content mutation time is invalid.");
  }
  return requestedTime > currentTime ? requested : new Date(currentTime + 1);
}

async function insertAuditEvent(
  client: Pick<PoolClient, "query">,
  params: {
    actor: TrainingContentMutationActor;
    action: string;
    orgId: string;
    contentId: string;
    contentType: TrainingContentType;
    contentVersion: number;
    metadata: Record<string, unknown>;
    now: Date;
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
      "Changed Training Content.",
      JSON.stringify({
        orgId: params.orgId,
        contentId: params.contentId,
        contentType: params.contentType,
        contentVersion: params.contentVersion,
        ...params.metadata,
      }),
      params.now,
    ]
  );
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return Number.isInteger(value) && value! >= minimum && value! <= maximum ? value! : fallback;
}

function databaseInteger(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is outside the supported integer range.`);
  }
  return parsed;
}

function optionalDatabaseInteger(
  value: string | number | null,
  label: string
): number | null {
  return value === null ? null : databaseInteger(value, label);
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

export function createTrainingContentStore(params: CreateTrainingContentStoreParams): TrainingContentStore {
  if (params.provider !== "postgres") {
    return new NullTrainingContentStore();
  }
  if (!params.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }
  return new PostgresTrainingContentStore(
    params.databaseUrl,
    {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs,
    },
    params.queryPool
  );
}
