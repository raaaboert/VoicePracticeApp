import path from "node:path";
import { promises as fs } from "node:fs";
import { Pool, PoolClient } from "pg";

import {
  AUDIT_ACTOR_TYPES,
  AuditActorType,
  AuditEvent
} from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

export interface AuditEventQuery {
  orgId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType | null;
  action?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number | null;
}

export interface AuditEventStore {
  initialize(): Promise<void>;
  importLegacyEvents(
    events: AuditEvent[],
    options?: { maxRecords?: number | null }
  ): Promise<{ importedCount: number; trimmedCount: number }>;
  appendEvents(events: AuditEvent[], options?: { maxRecords?: number | null }): Promise<void>;
  listEvents(query?: AuditEventQuery): Promise<AuditEvent[]>;
}

interface CreateAuditEventStoreParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface AuditEventFilePayload {
  events: AuditEvent[];
}

interface AuditEventRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  org_id: string | null;
  user_id: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string | Date;
}

const AUDIT_ACTOR_TYPE_SET = new Set<AuditActorType>(AUDIT_ACTOR_TYPES);

function buildAuditEventFilePath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.audit-events${extension}`);
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAuditActorType(value: unknown): AuditActorType | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim() as AuditActorType;
  return AUDIT_ACTOR_TYPE_SET.has(trimmed) ? trimmed : null;
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return null;
}

function normalizeAuditEvent(candidate: unknown): AuditEvent | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const id = normalizeNullableString((candidate as { id?: unknown }).id);
  const actorType = normalizeAuditActorType((candidate as { actorType?: unknown }).actorType);
  const action = normalizeNullableString((candidate as { action?: unknown }).action);
  const message = normalizeNullableString((candidate as { message?: unknown }).message);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);
  const metadata = (candidate as { metadata?: unknown }).metadata;

  if (!id || !actorType || !action || !message || !createdAt) {
    return null;
  }

  return {
    id,
    actorType,
    actorId: normalizeNullableString((candidate as { actorId?: unknown }).actorId),
    action,
    orgId: normalizeNullableString((candidate as { orgId?: unknown }).orgId),
    userId: normalizeNullableString((candidate as { userId?: unknown }).userId),
    message,
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null,
    createdAt
  };
}

function ensureFilePayload(candidate: unknown): AuditEventFilePayload {
  const events = Array.isArray((candidate as { events?: unknown } | null)?.events)
    ? ((candidate as { events?: unknown[] }).events ?? [])
        .map((entry) => normalizeAuditEvent(entry))
        .filter((entry): entry is AuditEvent => entry !== null)
    : [];

  return { events };
}

function compareAuditEventsAscending(left: AuditEvent, right: AuditEvent): number {
  const leftMs = new Date(left.createdAt).getTime();
  const rightMs = new Date(right.createdAt).getTime();
  const normalizedLeftMs = Number.isNaN(leftMs) ? Number.NEGATIVE_INFINITY : leftMs;
  const normalizedRightMs = Number.isNaN(rightMs) ? Number.NEGATIVE_INFINITY : rightMs;
  if (normalizedLeftMs !== normalizedRightMs) {
    return normalizedLeftMs - normalizedRightMs;
  }
  return left.id.localeCompare(right.id);
}

function normalizeAuditEventCollection(events: AuditEvent[], maxRecords: number | null): { events: AuditEvent[]; trimmedCount: number } {
  const deduped = new Map<string, AuditEvent>();
  for (const event of events) {
    deduped.set(event.id, event);
  }

  const sorted = Array.from(deduped.values()).sort(compareAuditEventsAscending);
  if (!maxRecords || maxRecords <= 0 || sorted.length <= maxRecords) {
    return { events: sorted, trimmedCount: 0 };
  }

  return {
    events: sorted.slice(sorted.length - maxRecords),
    trimmedCount: sorted.length - maxRecords
  };
}

function matchesAuditEventQuery(event: AuditEvent, query: AuditEventQuery): boolean {
  if (query.orgId && event.orgId !== query.orgId) {
    return false;
  }
  if (query.actorId && event.actorId !== query.actorId) {
    return false;
  }
  if (query.actorType && event.actorType !== query.actorType) {
    return false;
  }
  if (query.action && event.action !== query.action) {
    return false;
  }

  const createdAtMs = new Date(event.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) {
    return false;
  }

  if (query.from && createdAtMs < query.from.getTime()) {
    return false;
  }
  if (query.to && createdAtMs > query.to.getTime()) {
    return false;
  }

  return true;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

class FileAuditEventStore implements AuditEventStore {
  private readonly filePath: string;
  private operationQueue = Promise.resolve();

  constructor(dbPath: string) {
    this.filePath = buildAuditEventFilePath(dbPath);
  }

  async initialize(): Promise<void> {
    await this.withLock(async () => {
      await this.loadPayload();
    });
  }

  async importLegacyEvents(
    events: AuditEvent[],
    options?: { maxRecords?: number | null }
  ): Promise<{ importedCount: number; trimmedCount: number }> {
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const existingIds = new Set(payload.events.map((entry) => entry.id));
      const normalizedLegacy = events
        .map((entry) => normalizeAuditEvent(entry))
        .filter((entry): entry is AuditEvent => entry !== null);
      const normalized = normalizeAuditEventCollection(
        [...payload.events, ...normalizedLegacy],
        options?.maxRecords ?? null
      );
      const importedCount = normalizedLegacy.filter((entry) => !existingIds.has(entry.id)).length;
      const changed =
        normalized.events.length !== payload.events.length
        || normalized.events.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(payload.events[index]));
      if (changed) {
        await this.savePayload({ events: normalized.events });
      }

      return { importedCount, trimmedCount: normalized.trimmedCount };
    });
  }

  async appendEvents(events: AuditEvent[], options?: { maxRecords?: number | null }): Promise<void> {
    const normalizedIncoming = events
      .map((entry) => normalizeAuditEvent(entry))
      .filter((entry): entry is AuditEvent => entry !== null);
    if (normalizedIncoming.length === 0) {
      return;
    }

    await this.withLock(async () => {
      const payload = await this.loadPayload();
      const normalized = normalizeAuditEventCollection(
        [...payload.events, ...normalizedIncoming],
        options?.maxRecords ?? null
      );
      await this.savePayload({ events: normalized.events });
    });
  }

  async listEvents(query: AuditEventQuery = {}): Promise<AuditEvent[]> {
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const matched = payload.events
        .filter((event) => matchesAuditEventQuery(event, query))
        .slice()
        .sort((left, right) => compareAuditEventsAscending(right, left));
      const limit = typeof query.limit === "number" && Number.isFinite(query.limit) && query.limit > 0
        ? Math.floor(query.limit)
        : null;
      return limit ? matched.slice(0, limit) : matched;
    });
  }

  private async loadPayload(): Promise<AuditEventFilePayload> {
    await ensureParentDirectory(this.filePath);

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return ensureFilePayload(JSON.parse(raw));
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "ENOENT") {
        const payload = { events: [] };
        await this.savePayload(payload);
        return payload;
      }
      throw error;
    }
  }

  private async savePayload(payload: AuditEventFilePayload): Promise<void> {
    await ensureParentDirectory(this.filePath);
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private async withLock<T>(runner: () => Promise<T>): Promise<T> {
    let releaseLock: () => void = () => {};
    const waitForTurn = this.operationQueue;
    this.operationQueue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await waitForTurn;
    try {
      return await runner();
    } finally {
      releaseLock();
    }
  }
}

class PostgresAuditEventStore implements AuditEventStore {
  private readonly pool: Pool;
  private ensureTablePromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number }
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: options.pgPoolMax,
      connectionTimeoutMillis: options.pgConnectTimeoutMs,
      idleTimeoutMillis: options.pgIdleTimeoutMs,
      keepAlive: true
    });
  }

  async initialize(): Promise<void> {
    await this.ensureTable();
  }

  async importLegacyEvents(
    events: AuditEvent[],
    options?: { maxRecords?: number | null }
  ): Promise<{ importedCount: number; trimmedCount: number }> {
    const normalizedLegacy = events
      .map((entry) => normalizeAuditEvent(entry))
      .filter((entry): entry is AuditEvent => entry !== null);
    if (normalizedLegacy.length === 0) {
      return { importedCount: 0, trimmedCount: 0 };
    }

    await this.ensureTable();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ id: string }>(
        "SELECT id FROM audit_events WHERE id = ANY($1::text[])",
        [normalizedLegacy.map((entry) => entry.id)]
      );
      const existingIds = new Set(existing.rows.map((entry) => entry.id));

      for (const event of normalizedLegacy) {
        await upsertAuditEventRow(client, event);
      }

      const trimmedCount = await trimAuditEventRows(client, options?.maxRecords ?? null);
      await client.query("COMMIT");
      const importedCount = normalizedLegacy.filter((entry) => !existingIds.has(entry.id)).length;
      return { importedCount, trimmedCount };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendEvents(events: AuditEvent[], options?: { maxRecords?: number | null }): Promise<void> {
    const normalizedEvents = events
      .map((entry) => normalizeAuditEvent(entry))
      .filter((entry): entry is AuditEvent => entry !== null);
    if (normalizedEvents.length === 0) {
      return;
    }

    await this.ensureTable();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of normalizedEvents) {
        await upsertAuditEventRow(client, event);
      }
      await trimAuditEventRows(client, options?.maxRecords ?? null);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listEvents(query: AuditEventQuery = {}): Promise<AuditEvent[]> {
    await this.ensureTable();

    const whereClauses: string[] = [];
    const values: unknown[] = [];
    if (query.orgId) {
      whereClauses.push(`org_id = $${values.length + 1}`);
      values.push(query.orgId);
    }
    if (query.actorId) {
      whereClauses.push(`actor_id = $${values.length + 1}`);
      values.push(query.actorId);
    }
    if (query.actorType) {
      whereClauses.push(`actor_type = $${values.length + 1}`);
      values.push(query.actorType);
    }
    if (query.action) {
      whereClauses.push(`action = $${values.length + 1}`);
      values.push(query.action);
    }
    if (query.from) {
      whereClauses.push(`created_at >= $${values.length + 1}::timestamptz`);
      values.push(query.from.toISOString());
    }
    if (query.to) {
      whereClauses.push(`created_at <= $${values.length + 1}::timestamptz`);
      values.push(query.to.toISOString());
    }

    const limit =
      typeof query.limit === "number" && Number.isFinite(query.limit) && query.limit > 0
        ? Math.floor(query.limit)
        : null;

    const result = await this.pool.query<AuditEventRow>(
      `
        SELECT
          id,
          actor_type,
          actor_id,
          action,
          org_id,
          user_id,
          message,
          metadata,
          created_at
        FROM audit_events
        ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC
        ${limit ? `LIMIT ${limit}` : ""}
      `,
      values
    );

    return result.rows
      .map((row) => mapRowToAuditEvent(row))
      .filter((entry): entry is AuditEvent => entry !== null);
  }

  private async ensureTable(): Promise<void> {
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = (async () => {
        await this.pool.query(
          `
            CREATE TABLE IF NOT EXISTS audit_events (
              id TEXT PRIMARY KEY,
              actor_type TEXT NOT NULL,
              actor_id TEXT NULL,
              action TEXT NOT NULL,
              org_id TEXT NULL,
              user_id TEXT NULL,
              message TEXT NOT NULL,
              metadata JSONB NULL,
              created_at TIMESTAMPTZ NOT NULL
            );
          `
        );
        await this.pool.query(
          "CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC)"
        );
        await this.pool.query(
          "CREATE INDEX IF NOT EXISTS audit_events_actor_type_idx ON audit_events (actor_type)"
        );
        await this.pool.query(
          "CREATE INDEX IF NOT EXISTS audit_events_org_id_idx ON audit_events (org_id)"
        );
      })();
    }

    await this.ensureTablePromise;
  }
}

function mapRowToAuditEvent(row: AuditEventRow): AuditEvent | null {
  return normalizeAuditEvent({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    orgId: row.org_id,
    userId: row.user_id,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.created_at
  });
}

async function upsertAuditEventRow(
  client: Pick<PoolClient, "query"> | Pick<Pool, "query">,
  event: AuditEvent
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)
      ON CONFLICT (id) DO UPDATE
        SET actor_type = EXCLUDED.actor_type,
            actor_id = EXCLUDED.actor_id,
            action = EXCLUDED.action,
            org_id = EXCLUDED.org_id,
            user_id = EXCLUDED.user_id,
            message = EXCLUDED.message,
            metadata = EXCLUDED.metadata,
            created_at = EXCLUDED.created_at
    `,
    [
      event.id,
      event.actorType,
      event.actorId,
      event.action,
      event.orgId,
      event.userId,
      event.message,
      JSON.stringify(event.metadata),
      event.createdAt
    ]
  );
}

async function trimAuditEventRows(client: Pick<PoolClient, "query">, maxRecords: number | null): Promise<number> {
  if (!maxRecords || maxRecords <= 0) {
    return 0;
  }

  const result = await client.query<{ trimmed_count: string }>(
    `
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS row_num
        FROM audit_events
      ),
      deleted AS (
        DELETE FROM audit_events
        WHERE id IN (
          SELECT id
          FROM ranked
          WHERE row_num > $1
        )
        RETURNING id
      )
      SELECT COUNT(*)::text AS trimmed_count
      FROM deleted
    `,
    [maxRecords]
  );

  const row = result.rows[0];
  return row ? Number(row.trimmed_count) || 0 : 0;
}

export function createAuditEventStore(params: CreateAuditEventStoreParams): AuditEventStore {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresAuditEventStore(params.databaseUrl, {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs
    });
  }

  return new FileAuditEventStore(params.dbPath);
}
