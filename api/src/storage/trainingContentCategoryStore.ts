import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import type {
  AuditActorType,
  TrainingContentCategory,
  TrainingContentPublicationState,
} from "@voicepractice/shared";

import type { StorageProvider } from "../runtimeConfig.js";
import { initializeTrainingContentSchema } from "./trainingContentMigrations.js";

export type TrainingContentCategoryStoreErrorCode =
  | "training_content_category_not_found"
  | "training_content_category_conflict"
  | "training_content_category_name_conflict"
  | "training_content_default_category_required"
  | "training_content_category_reorder_invalid"
  | "training_content_reorder_invalid";

export class TrainingContentCategoryStoreError extends Error {
  constructor(
    message: string,
    readonly code: TrainingContentCategoryStoreErrorCode,
    readonly details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "TrainingContentCategoryStoreError";
  }
}

export interface TrainingContentCategoryActor {
  actorType: AuditActorType;
  actorId: string;
}

export interface TrainingContentCategorySummary extends TrainingContentCategory {
  activeItemCount: number;
  archivedItemCount: number;
}

export interface TrainingContentCategoryListResult {
  categories: TrainingContentCategorySummary[];
  orderRevision: string;
}

export interface TrainingContentOrderItem {
  id: string;
  title: string;
  categoryId: string;
  publicationState: Exclude<TrainingContentPublicationState, "archived">;
  displayOrder: number;
  updatedAt: string;
}

export interface TrainingContentOrderGroup {
  categoryId: string;
  categoryName: string;
  items: TrainingContentOrderItem[];
}

export interface TrainingContentOrderResult {
  groups: TrainingContentOrderGroup[];
  orderRevision: string;
}

export interface TrainingContentCategoryMutationResult {
  category: TrainingContentCategorySummary;
  categories: TrainingContentCategorySummary[];
  orderRevision: string;
}

export interface TrainingContentCategoryStore {
  initialize(): Promise<void>;
  ensureDefaultCategory(params: {
    orgId: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentCategory>;
  listCategories(params: {
    orgId: string;
    includeArchived?: boolean;
  }): Promise<TrainingContentCategoryListResult>;
  getActiveCategoryForOrg(
    orgId: string,
    categoryId: string
  ): Promise<TrainingContentCategory | null>;
  createCategory(params: {
    orgId: string;
    name: string;
    description: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentCategoryMutationResult>;
  updateCategory(params: {
    orgId: string;
    categoryId: string;
    expectedUpdatedAt: string;
    name?: string;
    description?: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentCategoryMutationResult>;
  reorderCategories(params: {
    orgId: string;
    categoryIds: string[];
    expectedOrderRevision: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentCategoryListResult>;
  archiveCategory(params: {
    orgId: string;
    categoryId: string;
    destinationCategoryId: string;
    expectedUpdatedAt: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<{
    category: TrainingContentCategorySummary;
    movedItemCount: number;
    categories: TrainingContentCategorySummary[];
    orderRevision: string;
  }>;
  getContentOrder(orgId: string): Promise<TrainingContentOrderResult>;
  reorderContent(params: {
    orgId: string;
    categories: Array<{ categoryId: string; contentIds: string[] }>;
    expectedOrderRevision: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentOrderResult>;
}

interface CreateTrainingContentCategoryStoreParams {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: CategoryQueryPool;
}

type CategoryQueryPool = Pick<Pool, "query" | "connect">;
type CategoryQueryable = Pick<PoolClient, "query"> | Pick<Pool, "query">;

interface CategoryRow {
  id: string;
  org_id: string;
  name: string;
  description: string;
  display_order: number;
  is_default: boolean;
  created_by_actor_id: string;
  updated_by_actor_id: string;
  created_at: string | Date;
  updated_at: string | Date;
  archived_at: string | Date | null;
}

interface CategorySummaryRow extends CategoryRow {
  active_item_count: string | number;
  archived_item_count: string | number;
}

interface ContentOrderRow {
  id: string;
  title: string;
  category_id: string;
  publication_state: Exclude<TrainingContentPublicationState, "archived">;
  display_order: number;
  updated_at: string | Date;
}

const CATEGORY_COLUMNS = `
  id,
  org_id,
  name,
  description,
  display_order,
  is_default,
  created_by_actor_id,
  updated_by_actor_id,
  created_at,
  updated_at,
  archived_at
`;

const CATEGORY_LIMIT = 500;
const CONTENT_ORDER_LIMIT = 2_000;

class NullTrainingContentCategoryStore implements TrainingContentCategoryStore {
  async initialize(): Promise<void> {}

  async ensureDefaultCategory(): Promise<TrainingContentCategory> {
    return this.unavailable();
  }

  async listCategories(): Promise<TrainingContentCategoryListResult> {
    return this.unavailable();
  }

  async getActiveCategoryForOrg(): Promise<TrainingContentCategory | null> {
    return this.unavailable();
  }

  async createCategory(): Promise<TrainingContentCategoryMutationResult> {
    return this.unavailable();
  }

  async updateCategory(): Promise<TrainingContentCategoryMutationResult> {
    return this.unavailable();
  }

  async reorderCategories(): Promise<TrainingContentCategoryListResult> {
    return this.unavailable();
  }

  async archiveCategory(): Promise<{
    category: TrainingContentCategorySummary;
    movedItemCount: number;
    categories: TrainingContentCategorySummary[];
    orderRevision: string;
  }> {
    return this.unavailable();
  }

  async getContentOrder(): Promise<TrainingContentOrderResult> {
    return this.unavailable();
  }

  async reorderContent(): Promise<TrainingContentOrderResult> {
    return this.unavailable();
  }

  private unavailable<T>(): T {
    throw new Error("Training Content category management requires PostgreSQL storage.");
  }
}

class PostgresTrainingContentCategoryStore implements TrainingContentCategoryStore {
  private readonly pool: CategoryQueryPool;
  private ensureSchemaPromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    queryPool?: CategoryQueryPool
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

  async ensureDefaultCategory(params: {
    orgId: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentCategory> {
    await this.initialize();
    const client = await this.pool.connect();
    const orgId = requiredId(params.orgId, "Organization id");
    const actorId = requiredId(params.actor.actorId, "Actor id");
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('peritio_training_content_default:' || $1, 0))",
        [orgId]
      );
      const existing = await findDefaultCategory(client, orgId, true);
      if (existing) {
        await client.query("COMMIT");
        return existing;
      }

      const generalResult = await client.query<CategoryRow>(
        `
          SELECT ${CATEGORY_COLUMNS}
          FROM org_content_categories
          WHERE org_id = $1
            AND archived_at IS NULL
            AND LOWER(BTRIM(name)) = 'general'
          FOR UPDATE
          LIMIT 1
        `,
        [orgId]
      );
      if (generalResult.rows[0]) {
        const promotedResult = await client.query<CategoryRow>(
          `
            UPDATE org_content_categories
            SET is_default = TRUE,
                updated_by_actor_id = $3,
                updated_at = GREATEST(updated_at + INTERVAL '1 millisecond', $4)
            WHERE org_id = $1 AND id = $2
            RETURNING ${CATEGORY_COLUMNS}
          `,
          [orgId, generalResult.rows[0].id, actorId, now]
        );
        const promoted = mapRequiredCategory(promotedResult.rows[0]);
        await insertCategoryAudit(client, {
          actor: params.actor,
          action: "training_content_category_updated",
          orgId,
          categoryId: promoted.id,
          metadata: { changedFields: ["isDefault"] },
          now,
        });
        await client.query("COMMIT");
        return promoted;
      }

      const maxOrderResult = await client.query<{ max_order: string | number | null }>(
        `
          SELECT MAX(display_order) AS max_order
          FROM org_content_categories
          WHERE org_id = $1 AND archived_at IS NULL
        `,
        [orgId]
      );
      const displayOrder = optionalDatabaseInteger(maxOrderResult.rows[0]?.max_order) + 1;
      const categoryId = randomUUID();
      const insertedResult = await client.query<CategoryRow>(
        `
          INSERT INTO org_content_categories (
            id,
            org_id,
            name,
            description,
            display_order,
            is_default,
            created_by_actor_id,
            updated_by_actor_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, 'General', '', $3, TRUE, $4, $4, $5, $5)
          RETURNING ${CATEGORY_COLUMNS}
        `,
        [categoryId, orgId, displayOrder, actorId, now]
      );
      const inserted = mapRequiredCategory(insertedResult.rows[0]);
      await insertCategoryAudit(client, {
        actor: params.actor,
        action: "training_content_category_created",
        orgId,
        categoryId: inserted.id,
        metadata: { isDefault: true },
        now,
      });
      await client.query("COMMIT");
      return inserted;
    } catch (error) {
      await rollbackQuietly(client);
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  }

  async listCategories(params: {
    orgId: string;
    includeArchived?: boolean;
  }): Promise<TrainingContentCategoryListResult> {
    await this.initialize();
    return readCategoryList(this.pool, params.orgId, Boolean(params.includeArchived));
  }

  async getActiveCategoryForOrg(
    orgId: string,
    categoryId: string
  ): Promise<TrainingContentCategory | null> {
    await this.initialize();
    const result = await this.pool.query<CategoryRow>(
      `
        SELECT ${CATEGORY_COLUMNS}
        FROM org_content_categories
        WHERE org_id = $1 AND id = $2 AND archived_at IS NULL
        LIMIT 1
      `,
      [requiredId(orgId, "Organization id"), requiredId(categoryId, "Category id")]
    );
    return result.rows[0] ? mapCategory(result.rows[0]) : null;
  }

  async createCategory(params: {
    orgId: string;
    name: string;
    description: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentCategoryMutationResult> {
    await this.initialize();
    const client = await this.pool.connect();
    const orgId = requiredId(params.orgId, "Organization id");
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('peritio_training_content_categories:' || $1, 0))",
        [orgId]
      );
      const maxOrderResult = await client.query<{ max_order: string | number | null }>(
        `
          SELECT MAX(display_order) AS max_order
          FROM org_content_categories
          WHERE org_id = $1 AND archived_at IS NULL
        `,
        [orgId]
      );
      const displayOrder = optionalDatabaseInteger(maxOrderResult.rows[0]?.max_order) + 1;
      const categoryId = randomUUID();
      await client.query(
        `
          INSERT INTO org_content_categories (
            id,
            org_id,
            name,
            description,
            display_order,
            is_default,
            created_by_actor_id,
            updated_by_actor_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, FALSE, $6, $6, $7, $7)
        `,
        [
          categoryId,
          orgId,
          params.name,
          params.description,
          displayOrder,
          requiredId(params.actor.actorId, "Actor id"),
          now,
        ]
      );
      await insertCategoryAudit(client, {
        actor: params.actor,
        action: "training_content_category_created",
        orgId,
        categoryId,
        metadata: { isDefault: false },
        now,
      });
      const category = await readCategorySummary(client, orgId, categoryId);
      const result = await readCategoryList(client, orgId, false);
      await client.query("COMMIT");
      return { category, ...result };
    } catch (error) {
      await rollbackQuietly(client);
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  }

  async updateCategory(params: {
    orgId: string;
    categoryId: string;
    expectedUpdatedAt: string;
    name?: string;
    description?: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentCategoryMutationResult> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await lockCategory(client, params.orgId, params.categoryId);
      assertExpectedCategoryUpdatedAt(current, params.expectedUpdatedAt);
      if (current.archivedAt) {
        throw categoryNotFoundError();
      }
      const nextName = params.name ?? current.name;
      const nextDescription = params.description ?? current.description;
      const changedFields = [
        nextName !== current.name ? "name" : null,
        nextDescription !== current.description ? "description" : null,
      ].filter((field): field is string => Boolean(field));
      if (changedFields.length > 0) {
        const now = nextMutationTime(current.updatedAt, params.now ?? new Date());
        await client.query(
          `
            UPDATE org_content_categories
            SET name = $3,
                description = $4,
                updated_by_actor_id = $5,
                updated_at = $6
            WHERE org_id = $1 AND id = $2
          `,
          [
            current.orgId,
            current.id,
            nextName,
            nextDescription,
            requiredId(params.actor.actorId, "Actor id"),
            now,
          ]
        );
        await insertCategoryAudit(client, {
          actor: params.actor,
          action: "training_content_category_updated",
          orgId: current.orgId,
          categoryId: current.id,
          metadata: { changedFields },
          now,
        });
      }
      const category = await readCategorySummary(client, current.orgId, current.id);
      const result = await readCategoryList(client, current.orgId, false);
      await client.query("COMMIT");
      return { category, ...result };
    } catch (error) {
      await rollbackQuietly(client);
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  }

  async reorderCategories(params: {
    orgId: string;
    categoryIds: string[];
    expectedOrderRevision: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentCategoryListResult> {
    await this.initialize();
    const client = await this.pool.connect();
    const orgId = requiredId(params.orgId, "Organization id");
    try {
      await client.query("BEGIN");
      const rowsResult = await client.query<CategoryRow>(
        `
          SELECT ${CATEGORY_COLUMNS}
          FROM org_content_categories
          WHERE org_id = $1 AND archived_at IS NULL
          ORDER BY id
          FOR UPDATE
        `,
        [orgId]
      );
      const current = rowsResult.rows.map(mapCategory);
      assertCategoryOrderInput(current, params.categoryIds);
      assertOrderRevision(current.map((entry) => entry.updatedAt), params.expectedOrderRevision);
      const now = nextOrderMutationTime(
        current.map((entry) => entry.updatedAt),
        params.now ?? new Date()
      );
      for (const [displayOrder, categoryId] of params.categoryIds.entries()) {
        await client.query(
          `
            UPDATE org_content_categories
            SET display_order = $3,
                updated_by_actor_id = $4,
                updated_at = $5
            WHERE org_id = $1 AND id = $2 AND archived_at IS NULL
          `,
          [
            orgId,
            categoryId,
            displayOrder,
            requiredId(params.actor.actorId, "Actor id"),
            now,
          ]
        );
      }
      await insertCategoryAudit(client, {
        actor: params.actor,
        action: "training_content_category_reordered",
        orgId,
        categoryId: null,
        metadata: { categoryCount: params.categoryIds.length },
        now,
      });
      const result = await readCategoryList(client, orgId, false);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  }

  async archiveCategory(params: {
    orgId: string;
    categoryId: string;
    destinationCategoryId: string;
    expectedUpdatedAt: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<{
    category: TrainingContentCategorySummary;
    movedItemCount: number;
    categories: TrainingContentCategorySummary[];
    orderRevision: string;
  }> {
    await this.initialize();
    const client = await this.pool.connect();
    const orgId = requiredId(params.orgId, "Organization id");
    const categoryId = requiredId(params.categoryId, "Category id");
    const destinationCategoryId = requiredId(
      params.destinationCategoryId,
      "Destination category id"
    );
    if (categoryId === destinationCategoryId) {
      throw new TrainingContentCategoryStoreError(
        "Choose a different destination Content Category.",
        "training_content_category_reorder_invalid"
      );
    }
    try {
      await client.query("BEGIN");
      const lockedResult = await client.query<CategoryRow>(
        `
          SELECT ${CATEGORY_COLUMNS}
          FROM org_content_categories
          WHERE org_id = $1 AND id = ANY($2::uuid[])
          ORDER BY id
          FOR UPDATE
        `,
        [orgId, [categoryId, destinationCategoryId]]
      );
      const byId = new Map(
        lockedResult.rows.map((row) => {
          const category = mapCategory(row);
          return [category.id, category];
        })
      );
      const source = byId.get(categoryId) ?? null;
      const destination = byId.get(destinationCategoryId) ?? null;
      if (!source || !destination || source.archivedAt || destination.archivedAt) {
        throw categoryNotFoundError();
      }
      assertExpectedCategoryUpdatedAt(source, params.expectedUpdatedAt);
      if (source.isDefault) {
        throw new TrainingContentCategoryStoreError(
          "The default Content Category cannot be archived.",
          "training_content_default_category_required"
        );
      }

      const now = nextOrderMutationTime(
        [source.updatedAt, destination.updatedAt],
        params.now ?? new Date()
      );
      const movedResult = await client.query(
        `
          WITH destination_order AS (
            SELECT COALESCE(MAX(display_order), -1) AS max_order
            FROM org_content_items
            WHERE org_id = $1 AND category_id = $3
          ),
          ranked AS (
            SELECT
              id,
              ROW_NUMBER() OVER (
                ORDER BY display_order ASC, updated_at ASC, id ASC
              ) - 1 AS offset
            FROM org_content_items
            WHERE org_id = $1 AND category_id = $2
          )
          UPDATE org_content_items item
          SET category_id = $3,
              display_order = destination_order.max_order + ranked.offset + 1,
              updated_by_actor_id = $4,
              updated_at = GREATEST(item.updated_at + INTERVAL '1 millisecond', $5)
          FROM ranked, destination_order
          WHERE item.org_id = $1 AND item.id = ranked.id
        `,
        [
          orgId,
          source.id,
          destination.id,
          requiredId(params.actor.actorId, "Actor id"),
          now,
        ]
      );
      const movedItemCount = movedResult.rowCount ?? 0;
      const archivedResult = await client.query<CategoryRow>(
        `
          UPDATE org_content_categories
          SET archived_at = $3,
              updated_by_actor_id = $4,
              updated_at = $3
          WHERE org_id = $1 AND id = $2
          RETURNING ${CATEGORY_COLUMNS}
        `,
        [orgId, source.id, now, requiredId(params.actor.actorId, "Actor id")]
      );
      await insertCategoryAudit(client, {
        actor: params.actor,
        action: "training_content_category_content_moved",
        orgId,
        categoryId: source.id,
        metadata: {
          destinationCategoryId: destination.id,
          itemCountMoved: movedItemCount,
        },
        now,
      });
      await insertCategoryAudit(client, {
        actor: params.actor,
        action: "training_content_category_archived",
        orgId,
        categoryId: source.id,
        metadata: {
          destinationCategoryId: destination.id,
          itemCountMoved: movedItemCount,
        },
        now,
      });
      const archived = mapCategory(archivedResult.rows[0]!);
      const archivedSummary = await readCategorySummary(client, orgId, archived.id);
      const list = await readCategoryList(client, orgId, false);
      await client.query("COMMIT");
      return {
        category: archivedSummary,
        movedItemCount,
        categories: list.categories,
        orderRevision: list.orderRevision,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  }

  async getContentOrder(orgId: string): Promise<TrainingContentOrderResult> {
    await this.initialize();
    return readContentOrder(this.pool, orgId);
  }

  async reorderContent(params: {
    orgId: string;
    categories: Array<{ categoryId: string; contentIds: string[] }>;
    expectedOrderRevision: string;
    actor: TrainingContentCategoryActor;
    now?: Date;
  }): Promise<TrainingContentOrderResult> {
    await this.initialize();
    const client = await this.pool.connect();
    const orgId = requiredId(params.orgId, "Organization id");
    try {
      await client.query("BEGIN");
      const categoryResult = await client.query<CategoryRow>(
        `
          SELECT ${CATEGORY_COLUMNS}
          FROM org_content_categories
          WHERE org_id = $1 AND archived_at IS NULL
          ORDER BY id
          FOR UPDATE
        `,
        [orgId]
      );
      const contentResult = await client.query<ContentOrderRow>(
        `
          SELECT id, title, category_id, publication_state, display_order, updated_at
          FROM org_content_items
          WHERE org_id = $1 AND publication_state <> 'archived'
          ORDER BY id
          FOR UPDATE
        `,
        [orgId]
      );
      if (contentResult.rows.length > CONTENT_ORDER_LIMIT) {
        throw new TrainingContentCategoryStoreError(
          "This organization has too many active items for the current reorder workflow.",
          "training_content_reorder_invalid"
        );
      }
      const activeCategories = categoryResult.rows.map(mapCategory);
      const currentItems = contentResult.rows.map(mapContentOrderItem);
      assertContentOrderInput(activeCategories, currentItems, params.categories);
      assertOrderRevision(
        [
          ...activeCategories.map((entry) => entry.updatedAt),
          ...currentItems.map((entry) => entry.updatedAt),
        ],
        params.expectedOrderRevision
      );
      const now = nextOrderMutationTime(
        [
          ...activeCategories.map((entry) => entry.updatedAt),
          ...currentItems.map((entry) => entry.updatedAt),
        ],
        params.now ?? new Date()
      );
      for (const group of params.categories) {
        for (const [displayOrder, contentId] of group.contentIds.entries()) {
          await client.query(
            `
              UPDATE org_content_items
              SET category_id = $3,
                  display_order = $4,
                  updated_by_actor_id = $5,
                  updated_at = GREATEST(updated_at + INTERVAL '1 millisecond', $6)
              WHERE org_id = $1 AND id = $2 AND publication_state <> 'archived'
            `,
            [
              orgId,
              contentId,
              group.categoryId,
              displayOrder,
              requiredId(params.actor.actorId, "Actor id"),
              now,
            ]
          );
        }
      }
      await insertCategoryAudit(client, {
        actor: params.actor,
        action: "training_content_reordered",
        orgId,
        categoryId: null,
        metadata: {
          categoryCount: params.categories.length,
          itemCount: currentItems.length,
        },
        now,
      });
      const result = await readContentOrder(client, orgId);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  }
}

async function findDefaultCategory(
  queryable: CategoryQueryable,
  orgId: string,
  lock: boolean
): Promise<TrainingContentCategory | null> {
  const result = await queryable.query<CategoryRow>(
    `
      SELECT ${CATEGORY_COLUMNS}
      FROM org_content_categories
      WHERE org_id = $1 AND is_default = TRUE AND archived_at IS NULL
      ${lock ? "FOR UPDATE" : ""}
      LIMIT 1
    `,
    [requiredId(orgId, "Organization id")]
  );
  return result.rows[0] ? mapCategory(result.rows[0]) : null;
}

async function lockCategory(
  queryable: CategoryQueryable,
  orgId: string,
  categoryId: string
): Promise<TrainingContentCategory> {
  const result = await queryable.query<CategoryRow>(
    `
      SELECT ${CATEGORY_COLUMNS}
      FROM org_content_categories
      WHERE org_id = $1 AND id = $2
      FOR UPDATE
    `,
    [requiredId(orgId, "Organization id"), requiredId(categoryId, "Category id")]
  );
  if (!result.rows[0]) {
    throw categoryNotFoundError();
  }
  return mapCategory(result.rows[0]);
}

async function readCategoryList(
  queryable: CategoryQueryable,
  orgId: string,
  includeArchived: boolean
): Promise<TrainingContentCategoryListResult> {
  const result = await queryable.query<CategorySummaryRow>(
    `
      SELECT
        category.*,
        COUNT(item.id) FILTER (WHERE item.publication_state <> 'archived') AS active_item_count,
        COUNT(item.id) FILTER (WHERE item.publication_state = 'archived') AS archived_item_count
      FROM org_content_categories category
      LEFT JOIN org_content_items item
        ON item.org_id = category.org_id
       AND item.category_id = category.id
      WHERE category.org_id = $1
        AND ($2::boolean = TRUE OR category.archived_at IS NULL)
      GROUP BY category.id
      ORDER BY
        category.archived_at NULLS FIRST,
        category.display_order ASC,
        LOWER(category.name) ASC,
        category.id ASC
      LIMIT ${CATEGORY_LIMIT}
    `,
    [requiredId(orgId, "Organization id"), includeArchived]
  );
  const categories = result.rows.map(mapCategorySummary);
  return {
    categories,
    orderRevision: orderRevision(categories.map((entry) => entry.updatedAt)),
  };
}

async function readCategorySummary(
  queryable: CategoryQueryable,
  orgId: string,
  categoryId: string
): Promise<TrainingContentCategorySummary> {
  const result = await queryable.query<CategorySummaryRow>(
    `
      SELECT
        category.*,
        COUNT(item.id) FILTER (WHERE item.publication_state <> 'archived') AS active_item_count,
        COUNT(item.id) FILTER (WHERE item.publication_state = 'archived') AS archived_item_count
      FROM org_content_categories category
      LEFT JOIN org_content_items item
        ON item.org_id = category.org_id
       AND item.category_id = category.id
      WHERE category.org_id = $1 AND category.id = $2
      GROUP BY category.id
    `,
    [requiredId(orgId, "Organization id"), requiredId(categoryId, "Category id")]
  );
  if (!result.rows[0]) {
    throw categoryNotFoundError();
  }
  return mapCategorySummary(result.rows[0]);
}

async function readContentOrder(
  queryable: CategoryQueryable,
  orgId: string
): Promise<TrainingContentOrderResult> {
  const normalizedOrgId = requiredId(orgId, "Organization id");
  const categoryResult = await queryable.query<CategoryRow>(
    `
      SELECT ${CATEGORY_COLUMNS}
      FROM org_content_categories
      WHERE org_id = $1 AND archived_at IS NULL
      ORDER BY display_order ASC, LOWER(name) ASC, id ASC
      LIMIT ${CATEGORY_LIMIT}
    `,
    [normalizedOrgId]
  );
  const contentResult = await queryable.query<ContentOrderRow>(
    `
      SELECT id, title, category_id, publication_state, display_order, updated_at
      FROM org_content_items
      WHERE org_id = $1 AND publication_state <> 'archived'
      ORDER BY category_id, display_order ASC, LOWER(title) ASC, id ASC
      LIMIT ${CONTENT_ORDER_LIMIT + 1}
    `,
    [normalizedOrgId]
  );
  if (contentResult.rows.length > CONTENT_ORDER_LIMIT) {
    throw new TrainingContentCategoryStoreError(
      "This organization has too many active items for the current reorder workflow.",
      "training_content_reorder_invalid"
    );
  }
  const categories = categoryResult.rows.map(mapCategory);
  const items = contentResult.rows.map(mapContentOrderItem);
  return {
    groups: categories.map((category) => ({
      categoryId: category.id,
      categoryName: category.name,
      items: items.filter((item) => item.categoryId === category.id),
    })),
    orderRevision: orderRevision([
      ...categories.map((entry) => entry.updatedAt),
      ...items.map((entry) => entry.updatedAt),
    ]),
  };
}

function assertCategoryOrderInput(
  current: readonly TrainingContentCategory[],
  categoryIds: readonly string[]
): void {
  if (categoryIds.length !== new Set(categoryIds).size) {
    throw new TrainingContentCategoryStoreError(
      "Content Category order contains duplicate IDs.",
      "training_content_category_reorder_invalid"
    );
  }
  const currentIds = new Set(current.map((entry) => entry.id));
  const foreignId = categoryIds.find((categoryId) => !currentIds.has(categoryId));
  if (foreignId) {
    throw categoryNotFoundError();
  }
  if (categoryIds.length !== current.length) {
    throw new TrainingContentCategoryStoreError(
      "Content Category order must include every active category.",
      "training_content_category_reorder_invalid"
    );
  }
}

function assertContentOrderInput(
  categories: readonly TrainingContentCategory[],
  currentItems: readonly TrainingContentOrderItem[],
  groups: readonly { categoryId: string; contentIds: string[] }[]
): void {
  const categoryIds = groups.map((entry) => entry.categoryId);
  if (categoryIds.length !== new Set(categoryIds).size) {
    throw new TrainingContentCategoryStoreError(
      "Content order contains duplicate categories.",
      "training_content_reorder_invalid"
    );
  }
  const activeCategoryIds = new Set(categories.map((entry) => entry.id));
  const foreignCategoryId = categoryIds.find((categoryId) => !activeCategoryIds.has(categoryId));
  if (foreignCategoryId) {
    throw categoryNotFoundError();
  }
  if (categoryIds.length !== categories.length) {
    throw new TrainingContentCategoryStoreError(
      "Content order must include every active Content Category.",
      "training_content_reorder_invalid"
    );
  }
  const contentIds = groups.flatMap((entry) => entry.contentIds);
  if (contentIds.length !== new Set(contentIds).size) {
    throw new TrainingContentCategoryStoreError(
      "Content order contains duplicate item IDs.",
      "training_content_reorder_invalid"
    );
  }
  const currentIds = new Set(currentItems.map((entry) => entry.id));
  const foreignContentId = contentIds.find((contentId) => !currentIds.has(contentId));
  if (foreignContentId) {
    throw new TrainingContentCategoryStoreError(
      "Training Content item was not found.",
      "training_content_category_not_found"
    );
  }
  if (contentIds.length !== currentItems.length) {
    throw new TrainingContentCategoryStoreError(
      "Content order must include every active Training Content item.",
      "training_content_reorder_invalid"
    );
  }
}

function assertExpectedCategoryUpdatedAt(
  category: TrainingContentCategory,
  expectedUpdatedAt: string
): void {
  const expected = requiredIso(expectedUpdatedAt, "Expected updated time");
  if (expected !== category.updatedAt) {
    throw new TrainingContentCategoryStoreError(
      "Content Category changed in another session. Reload before saving.",
      "training_content_category_conflict",
      { currentUpdatedAt: category.updatedAt }
    );
  }
}

function assertOrderRevision(updatedAtValues: readonly string[], expectedRevision: string): void {
  const expected = requiredIso(expectedRevision, "Expected order revision");
  const current = orderRevision(updatedAtValues);
  if (expected !== current) {
    throw new TrainingContentCategoryStoreError(
      "Training Content order changed in another session. Reload before saving.",
      "training_content_category_conflict",
      { currentOrderRevision: current }
    );
  }
}

function orderRevision(updatedAtValues: readonly string[]): string {
  if (updatedAtValues.length === 0) {
    return new Date(0).toISOString();
  }
  return updatedAtValues
    .map((value) => requiredIso(value, "Order timestamp"))
    .sort()
    .at(-1)!;
}

function nextOrderMutationTime(updatedAtValues: readonly string[], requested: Date): Date {
  return nextMutationTime(orderRevision(updatedAtValues), requested);
}

function nextMutationTime(currentUpdatedAt: string, requested: Date): Date {
  const currentTime = new Date(currentUpdatedAt).getTime();
  const requestedTime = requested.getTime();
  if (!Number.isFinite(requestedTime)) {
    throw new Error("Training Content mutation time is invalid.");
  }
  return requestedTime > currentTime ? requested : new Date(currentTime + 1);
}

function mapCategory(row: CategoryRow): TrainingContentCategory {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    displayOrder: row.display_order,
    isDefault: row.is_default === true,
    createdByActorId: row.created_by_actor_id,
    updatedByActorId: row.updated_by_actor_id,
    createdAt: requiredIso(row.created_at, "Category created time"),
    updatedAt: requiredIso(row.updated_at, "Category updated time"),
    archivedAt: optionalIso(row.archived_at),
  };
}

function mapRequiredCategory(row: CategoryRow | undefined): TrainingContentCategory {
  if (!row) {
    throw new Error("Training Content category mutation did not return a row.");
  }
  return mapCategory(row);
}

function mapCategorySummary(row: CategorySummaryRow): TrainingContentCategorySummary {
  return {
    ...mapCategory(row),
    activeItemCount: databaseInteger(row.active_item_count, "Active item count"),
    archivedItemCount: databaseInteger(row.archived_item_count, "Archived item count"),
  };
}

function mapContentOrderItem(row: ContentOrderRow): TrainingContentOrderItem {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.category_id,
    publicationState: row.publication_state,
    displayOrder: row.display_order,
    updatedAt: requiredIso(row.updated_at, "Content updated time"),
  };
}

async function insertCategoryAudit(
  client: Pick<PoolClient, "query">,
  params: {
    actor: TrainingContentCategoryActor;
    action: string;
    orgId: string;
    categoryId: string | null;
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
      "Changed Training Content organization.",
      JSON.stringify({
        orgId: params.orgId,
        categoryId: params.categoryId,
        ...params.metadata,
      }),
      params.now,
    ]
  );
}

function categoryNotFoundError(): TrainingContentCategoryStoreError {
  return new TrainingContentCategoryStoreError(
    "Content Category was not found.",
    "training_content_category_not_found"
  );
}

function mapConstraintError(error: unknown): unknown {
  if (error instanceof TrainingContentCategoryStoreError) {
    return error;
  }
  if ((error as { code?: string } | null)?.code === "23505") {
    return new TrainingContentCategoryStoreError(
      "An active Content Category already uses that name.",
      "training_content_category_name_conflict"
    );
  }
  if ((error as { code?: string } | null)?.code === "23503") {
    return categoryNotFoundError();
  }
  return error;
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function databaseInteger(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is outside the supported integer range.`);
  }
  return parsed;
}

function optionalDatabaseInteger(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return -1;
  }
  return databaseInteger(value, "Display order");
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
    // Preserve the original transaction error.
  }
}

export function createTrainingContentCategoryStore(
  params: CreateTrainingContentCategoryStoreParams
): TrainingContentCategoryStore {
  if (params.provider !== "postgres") {
    return new NullTrainingContentCategoryStore();
  }
  if (!params.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }
  return new PostgresTrainingContentCategoryStore(
    params.databaseUrl,
    {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs,
    },
    params.queryPool
  );
}
