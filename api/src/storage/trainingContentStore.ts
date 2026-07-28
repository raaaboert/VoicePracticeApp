import { promises as fs } from "node:fs";

import { Pool } from "pg";

import {
  TrainingContentItem,
  TrainingContentPublicationState,
  TrainingContentType,
} from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

export interface TrainingContentStore {
  initialize(): Promise<void>;
  listContentItemsForOrg(orgId: string): Promise<TrainingContentItem[]>;
  getContentItemForOrg(orgId: string, contentId: string): Promise<TrainingContentItem | null>;
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

interface TrainingContentItemRow {
  id: string;
  org_id: string;
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

class NullTrainingContentStore implements TrainingContentStore {
  async initialize(): Promise<void> {
    // Training Content is relational and unavailable for non-postgres providers.
  }

  async listContentItemsForOrg(_orgId: string): Promise<TrainingContentItem[]> {
    return [];
  }

  async getContentItemForOrg(_orgId: string, _contentId: string): Promise<TrainingContentItem | null> {
    return null;
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
      this.ensureSchemaPromise = (async () => {
        const migrationUrl = new URL("../../sql/008_training_content.sql", import.meta.url);
        const migrationSql = await fs.readFile(migrationUrl, "utf8");
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('peritio_training_content_schema_v1', 0))"
          );
          await client.query(migrationSql);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      })();
    }

    await this.ensureSchemaPromise;
  }

  async listContentItemsForOrg(orgId: string): Promise<TrainingContentItem[]> {
    await this.initialize();
    const normalizedOrgId = normalizeRequiredId(orgId, "Organization id");
    const result = await this.pool.query<TrainingContentItemRow>(
      `
        SELECT *
        FROM org_content_items
        WHERE org_id = $1
        ORDER BY display_order ASC, updated_at DESC, id ASC
      `,
      [normalizedOrgId]
    );
    return result.rows.map(mapContentItemRow);
  }

  async getContentItemForOrg(orgId: string, contentId: string): Promise<TrainingContentItem | null> {
    await this.initialize();
    const normalizedOrgId = normalizeRequiredId(orgId, "Organization id");
    const normalizedContentId = normalizeRequiredId(contentId, "Content id");
    const result = await this.pool.query<TrainingContentItemRow>(
      `
        SELECT *
        FROM org_content_items
        WHERE org_id = $1 AND id = $2
        LIMIT 1
      `,
      [normalizedOrgId, normalizedContentId]
    );
    return result.rows[0] ? mapContentItemRow(result.rows[0]) : null;
  }
}

function normalizeRequiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function toIsoString(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Training Content timestamp is invalid.");
  }
  return parsed.toISOString();
}

function mapContentItemRow(row: TrainingContentItemRow): TrainingContentItem {
  return {
    id: row.id,
    orgId: row.org_id,
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
    createdAt: toIsoString(row.created_at) ?? "",
    updatedAt: toIsoString(row.updated_at) ?? "",
    publishedAt: toIsoString(row.published_at),
    archivedAt: toIsoString(row.archived_at),
  };
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
