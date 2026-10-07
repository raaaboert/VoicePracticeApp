import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import type { UserNotificationKind, UserNotificationPayload } from "@voicepractice/shared";
import { USER_NOTIFICATION_KINDS } from "@voicepractice/shared";

import type { StorageProvider } from "../runtimeConfig.js";

export interface UserNotificationRecord {
  id: string;
  orgId: string;
  recipientUserId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  dedupKey: string;
  payload: UserNotificationPayload;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface EnqueueUserNotificationInput {
  id?: string;
  orgId: string;
  recipientUserId: string;
  kind: UserNotificationKind;
  subjectType: string;
  subjectId: string;
  dedupKey: string;
  payload?: UserNotificationPayload;
  createdAt?: Date;
}

export interface UserNotificationStore {
  initialize(): Promise<void>;
  enqueueOne(
    input: EnqueueUserNotificationInput,
    options?: { client?: NotificationTransactionClient | null },
  ): Promise<UserNotificationRecord | null>;
  enqueueMany(
    inputs: readonly EnqueueUserNotificationInput[],
    options?: { client?: NotificationTransactionClient | null },
  ): Promise<UserNotificationRecord[]>;
  listForRecipient(input: { recipientUserId: string; limit: number; offset?: number }): Promise<UserNotificationRecord[]>;
  countActionableUnread(input: {
    recipientUserId: string;
    orgId: string;
    kinds: readonly UserNotificationKind[];
    subjectType?: string;
    subjectIds?: readonly string[];
  }): Promise<number>;
  getForRecipient(input: { id: string; recipientUserId: string }): Promise<UserNotificationRecord | null>;
  markRead(input: { id: string; recipientUserId: string; readAt?: Date }): Promise<UserNotificationRecord | null>;
  resolveOne(input: { id: string; recipientUserId: string; resolution: string; resolvedAt?: Date }): Promise<UserNotificationRecord | null>;
  resolveIds(input: { ids: readonly string[]; resolution: string; resolvedAt?: Date }): Promise<number>;
  resolveMatching(input: {
    kind: UserNotificationKind;
    subjectType: string;
    subjectIds: readonly string[];
    resolution: string;
    resolvedAt?: Date;
    client?: NotificationTransactionClient | null;
  }): Promise<number>;
}

export type NotificationTransactionClient = Pick<PoolClient, "query">;
type NotificationQueryPool = Pick<Pool, "query" | "connect">;

interface NotificationRow {
  id: string;
  org_id: string;
  recipient_user_id: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  dedup_key: string;
  payload: unknown;
  created_at: Date | string;
  read_at: Date | string | null;
  resolved_at: Date | string | null;
  resolution: string | null;
}

const KIND_SET = new Set<string>(USER_NOTIFICATION_KINDS);
const SELECT_COLUMNS = `
  id, org_id, recipient_user_id, kind, subject_type, subject_id, dedup_key,
  payload, created_at, read_at, resolved_at, resolution`;

class MemoryUserNotificationStore implements UserNotificationStore {
  private readonly rows = new Map<string, UserNotificationRecord>();
  private readonly idByRecipientDedup = new Map<string, string>();

  async initialize(): Promise<void> {}

  async enqueueOne(input: EnqueueUserNotificationInput): Promise<UserNotificationRecord | null> {
    return (await this.enqueueMany([input]))[0] ?? null;
  }

  async enqueueMany(inputs: readonly EnqueueUserNotificationInput[]): Promise<UserNotificationRecord[]> {
    const inserted: UserNotificationRecord[] = [];
    for (const raw of inputs) {
      const normalized = normalizeEnqueueInput(raw);
      const uniqueKey = `${normalized.recipientUserId}\u0000${normalized.dedupKey}`;
      if (this.idByRecipientDedup.has(uniqueKey)) continue;
      const record: UserNotificationRecord = {
        ...normalized,
        readAt: null,
        resolvedAt: null,
        resolution: null,
      };
      this.rows.set(record.id, record);
      this.idByRecipientDedup.set(uniqueKey, record.id);
      inserted.push(cloneRecord(record));
    }
    return inserted;
  }

  async listForRecipient(input: { recipientUserId: string; limit: number; offset?: number }): Promise<UserNotificationRecord[]> {
    const recipientUserId = requiredText(input.recipientUserId, "Recipient user id");
    const limit = normalizeLimit(input.limit);
    return [...this.rows.values()]
      .filter((row) => row.recipientUserId === recipientUserId)
      .sort(compareNewestFirst)
      .slice(normalizeOffset(input.offset), normalizeOffset(input.offset) + limit)
      .map(cloneRecord);
  }

  async countActionableUnread(input: {
    recipientUserId: string;
    orgId: string;
    kinds: readonly UserNotificationKind[];
    subjectType?: string;
    subjectIds?: readonly string[];
  }): Promise<number> {
    const kinds = new Set(input.kinds);
    const subjectIds = input.subjectIds ? new Set(input.subjectIds) : null;
    return [...this.rows.values()].filter((row) =>
      row.recipientUserId === input.recipientUserId
      && row.orgId === input.orgId
      && kinds.has(row.kind as UserNotificationKind)
      && (!input.subjectType || row.subjectType === input.subjectType)
      && (!subjectIds || subjectIds.has(row.subjectId))
      && row.readAt === null
      && row.resolvedAt === null
    ).length;
  }

  async getForRecipient(input: { id: string; recipientUserId: string }): Promise<UserNotificationRecord | null> {
    const row = this.rows.get(input.id);
    return row?.recipientUserId === input.recipientUserId ? cloneRecord(row) : null;
  }

  async markRead(input: { id: string; recipientUserId: string; readAt?: Date }): Promise<UserNotificationRecord | null> {
    const row = this.rows.get(input.id);
    if (!row || row.recipientUserId !== input.recipientUserId) return null;
    row.readAt ??= validDate(input.readAt ?? new Date(), "Read timestamp").toISOString();
    return cloneRecord(row);
  }

  async resolveOne(input: { id: string; recipientUserId: string; resolution: string; resolvedAt?: Date }): Promise<UserNotificationRecord | null> {
    const row = this.rows.get(input.id);
    if (!row || row.recipientUserId !== input.recipientUserId) return null;
    resolveRecord(row, input.resolution, input.resolvedAt);
    return cloneRecord(row);
  }

  async resolveIds(input: { ids: readonly string[]; resolution: string; resolvedAt?: Date }): Promise<number> {
    const ids = new Set(input.ids.map((id) => requiredText(id, "Notification id")));
    let count = 0;
    for (const row of this.rows.values()) {
      if (!ids.has(row.id) || row.resolvedAt) continue;
      resolveRecord(row, input.resolution, input.resolvedAt);
      count += 1;
    }
    return count;
  }

  async resolveMatching(input: {
    kind: UserNotificationKind;
    subjectType: string;
    subjectIds: readonly string[];
    resolution: string;
    resolvedAt?: Date;
  }): Promise<number> {
    const subjectIds = new Set(input.subjectIds.map((id) => requiredText(id, "Subject id")));
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.kind !== input.kind || row.subjectType !== input.subjectType || !subjectIds.has(row.subjectId) || row.resolvedAt) continue;
      resolveRecord(row, input.resolution, input.resolvedAt);
      count += 1;
    }
    return count;
  }
}

class PostgresUserNotificationStore implements UserNotificationStore {
  private initialized: Promise<void> | null = null;
  constructor(private readonly pool: NotificationQueryPool) {}

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = initializeSchema(this.pool);
    await this.initialized;
  }

  async enqueueOne(
    input: EnqueueUserNotificationInput,
    options?: { client?: NotificationTransactionClient | null },
  ): Promise<UserNotificationRecord | null> {
    return (await this.enqueueMany([input], options))[0] ?? null;
  }

  async enqueueMany(
    inputs: readonly EnqueueUserNotificationInput[],
    options?: { client?: NotificationTransactionClient | null },
  ): Promise<UserNotificationRecord[]> {
    if (inputs.length === 0) return [];
    const normalized = inputs.map(normalizeEnqueueInput);
    const client = options?.client ?? this.pool;
    const inserted: UserNotificationRecord[] = [];
    for (const row of normalized) {
      const result = await client.query<NotificationRow>(
        `INSERT INTO user_notifications (
           id, org_id, recipient_user_id, kind, subject_type, subject_id,
           dedup_key, payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)
         ON CONFLICT (recipient_user_id, dedup_key) DO NOTHING
         RETURNING ${SELECT_COLUMNS}`,
        [row.id, row.orgId, row.recipientUserId, row.kind, row.subjectType,
          row.subjectId, row.dedupKey, JSON.stringify(row.payload), row.createdAt],
      );
      if (result.rows[0]) inserted.push(mapRow(result.rows[0]));
    }
    return inserted;
  }

  async listForRecipient(input: { recipientUserId: string; limit: number; offset?: number }): Promise<UserNotificationRecord[]> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM user_notifications
       WHERE recipient_user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [requiredText(input.recipientUserId, "Recipient user id"), normalizeLimit(input.limit), normalizeOffset(input.offset)],
    );
    return result.rows.map(mapRow);
  }

  async countActionableUnread(input: {
    recipientUserId: string;
    orgId: string;
    kinds: readonly UserNotificationKind[];
    subjectType?: string;
    subjectIds?: readonly string[];
  }): Promise<number> {
    if (input.kinds.length === 0 || (input.subjectIds && input.subjectIds.length === 0)) return 0;
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM user_notifications
       WHERE recipient_user_id = $1 AND org_id = $2 AND kind = ANY($3::text[])
         AND ($4::text IS NULL OR subject_type = $4)
         AND ($5::text[] IS NULL OR subject_id = ANY($5::text[]))
         AND read_at IS NULL AND resolved_at IS NULL`,
      [
        requiredText(input.recipientUserId, "Recipient user id"),
        requiredText(input.orgId, "Organization id"),
        input.kinds,
        input.subjectType ? requiredText(input.subjectType, "Subject type") : null,
        input.subjectIds ? input.subjectIds.map((id) => requiredText(id, "Subject id")) : null,
      ],
    );
    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  async getForRecipient(input: { id: string; recipientUserId: string }): Promise<UserNotificationRecord | null> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT ${SELECT_COLUMNS} FROM user_notifications WHERE id = $1 AND recipient_user_id = $2 LIMIT 1`,
      [requiredText(input.id, "Notification id"), requiredText(input.recipientUserId, "Recipient user id")],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async markRead(input: { id: string; recipientUserId: string; readAt?: Date }): Promise<UserNotificationRecord | null> {
    const result = await this.pool.query<NotificationRow>(
      `UPDATE user_notifications SET read_at = COALESCE(read_at, $3::timestamptz)
       WHERE id = $1 AND recipient_user_id = $2 RETURNING ${SELECT_COLUMNS}`,
      [requiredText(input.id, "Notification id"), requiredText(input.recipientUserId, "Recipient user id"),
        validDate(input.readAt ?? new Date(), "Read timestamp")],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async resolveOne(input: { id: string; recipientUserId: string; resolution: string; resolvedAt?: Date }): Promise<UserNotificationRecord | null> {
    const result = await this.pool.query<NotificationRow>(
      `UPDATE user_notifications
       SET resolved_at = COALESCE(resolved_at, $3::timestamptz),
           resolution = COALESCE(resolution, $4)
       WHERE id = $1 AND recipient_user_id = $2 RETURNING ${SELECT_COLUMNS}`,
      [requiredText(input.id, "Notification id"), requiredText(input.recipientUserId, "Recipient user id"),
        validDate(input.resolvedAt ?? new Date(), "Resolution timestamp"), requiredText(input.resolution, "Resolution")],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async resolveIds(input: { ids: readonly string[]; resolution: string; resolvedAt?: Date }): Promise<number> {
    if (input.ids.length === 0) return 0;
    const result = await this.pool.query(
      `UPDATE user_notifications SET resolved_at = $2::timestamptz, resolution = $3
       WHERE id = ANY($1::text[]) AND resolved_at IS NULL`,
      [input.ids.map((id) => requiredText(id, "Notification id")),
        validDate(input.resolvedAt ?? new Date(), "Resolution timestamp"), requiredText(input.resolution, "Resolution")],
    );
    return result.rowCount ?? 0;
  }

  async resolveMatching(input: {
    kind: UserNotificationKind;
    subjectType: string;
    subjectIds: readonly string[];
    resolution: string;
    resolvedAt?: Date;
    client?: NotificationTransactionClient | null;
  }): Promise<number> {
    if (input.subjectIds.length === 0) return 0;
    const client = input.client ?? this.pool;
    const result = await client.query(
      `UPDATE user_notifications SET resolved_at = $4::timestamptz, resolution = $5
       WHERE kind = $1 AND subject_type = $2 AND subject_id = ANY($3::text[])
         AND resolved_at IS NULL`,
      [normalizeKind(input.kind), requiredText(input.subjectType, "Subject type"),
        input.subjectIds.map((id) => requiredText(id, "Subject id")),
        validDate(input.resolvedAt ?? new Date(), "Resolution timestamp"), requiredText(input.resolution, "Resolution")],
    );
    return result.rowCount ?? 0;
  }
}

function normalizeEnqueueInput(input: EnqueueUserNotificationInput) {
  return {
    id: input.id ? requiredText(input.id, "Notification id") : `notification_${randomUUID()}`,
    orgId: requiredText(input.orgId, "Organization id"),
    recipientUserId: requiredText(input.recipientUserId, "Recipient user id"),
    kind: normalizeKind(input.kind),
    subjectType: requiredText(input.subjectType, "Subject type"),
    subjectId: requiredText(input.subjectId, "Subject id"),
    dedupKey: requiredText(input.dedupKey, "Dedup key"),
    payload: normalizePayload(input.payload),
    createdAt: validDate(input.createdAt ?? new Date(), "Creation timestamp").toISOString(),
  };
}

function normalizeKind(kind: UserNotificationKind): UserNotificationKind {
  if (!KIND_SET.has(kind)) throw new Error("Notification kind is not recognized.");
  return kind;
}

function normalizePayload(payload: UserNotificationPayload | undefined): UserNotificationPayload {
  if (!payload) return {};
  const title = optionalText(payload.title, 120);
  const body = optionalText(payload.body, 240);
  const destination = optionalText(payload.destination, 240);
  if (destination && (!destination.startsWith("/app/") || destination.startsWith("//"))) {
    throw new Error("Notification destination must be an internal dashboard path.");
  }
  return {
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(destination ? { destination } : {}),
  };
}

function mapRow(row: NotificationRow): UserNotificationRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    recipientUserId: row.recipient_user_id,
    kind: row.kind,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    dedupKey: row.dedup_key,
    payload: normalizePayload(row.payload && typeof row.payload === "object" ? row.payload as UserNotificationPayload : {}),
    createdAt: iso(row.created_at, "Notification creation timestamp"),
    readAt: row.read_at ? iso(row.read_at, "Notification read timestamp") : null,
    resolvedAt: row.resolved_at ? iso(row.resolved_at, "Notification resolution timestamp") : null,
    resolution: row.resolution,
  };
}

function resolveRecord(row: UserNotificationRecord, resolution: string, at?: Date): void {
  if (row.resolvedAt) return;
  row.resolvedAt = validDate(at ?? new Date(), "Resolution timestamp").toISOString();
  row.resolution = requiredText(resolution, "Resolution");
}

function cloneRecord(row: UserNotificationRecord): UserNotificationRecord {
  return { ...row, payload: { ...row.payload } };
}

function compareNewestFirst(left: UserNotificationRecord, right: UserNotificationRecord): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error("Notification payload text exceeds its maximum length.");
  return normalized;
}

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) throw new Error(`${label} is invalid.`);
  return value;
}

function iso(value: Date | string, label: string): string {
  return validDate(value instanceof Date ? value : new Date(value), label).toISOString();
}

function normalizeLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("Notification list limit must be a positive integer.");
  return Math.min(value, 101);
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("Notification list offset must be an integer from 0 to 10000.");
  }
  return value;
}

async function readMigration(): Promise<string> {
  const candidates = [
    new URL("../../sql/016_user_notifications.sql", import.meta.url),
    new URL("../sql/016_user_notifications.sql", import.meta.url),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try { return await readFile(candidate, "utf8"); } catch (error) { lastError = error; }
  }
  throw new Error("User notification migration is missing from the runtime artifact.", { cause: lastError });
}

async function initializeSchema(pool: Pick<Pool, "connect">): Promise<void> {
  const sql = await readMigration();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('peritio_user_notifications_v1', 0))");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function createUserNotificationStore(params: {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: NotificationQueryPool;
}): UserNotificationStore {
  if (params.provider !== "postgres") return new MemoryUserNotificationStore();
  if (!params.databaseUrl) throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  const pool = params.queryPool ?? new Pool({
    connectionString: params.databaseUrl,
    max: params.pgPoolMax,
    connectionTimeoutMillis: params.pgConnectTimeoutMs,
    idleTimeoutMillis: params.pgIdleTimeoutMs,
    keepAlive: true,
  });
  return new PostgresUserNotificationStore(pool);
}

export function createMemoryUserNotificationStoreForTest(): UserNotificationStore {
  return new MemoryUserNotificationStore();
}
