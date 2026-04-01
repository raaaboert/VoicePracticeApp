import path from "node:path";
import { promises as fs } from "node:fs";
import { Pool } from "pg";

import {
  DASHBOARD_ACCESS_TYPES,
  DashboardAccessType,
  WebAuthSessionRecord
} from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

export interface WebAuthSessionStore {
  initialize(): Promise<void>;
  importLegacySessions(
    records: WebAuthSessionRecord[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number; skippedExpiredCount: number }>;
  saveSession(record: WebAuthSessionRecord): Promise<void>;
  getActiveSession(sessionId: string, userId: string, now?: Date): Promise<WebAuthSessionRecord | null>;
  revokeSession(sessionId: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<number>;
  revokeSessionsForUsers(userIds: string[]): Promise<number>;
}

interface CreateWebAuthSessionStoreParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface WebAuthSessionFilePayload {
  sessions: WebAuthSessionRecord[];
}

interface WebAuthSessionRow {
  session_id: string;
  user_id: string;
  access_type: string | null;
  org_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  last_seen_at: string | Date;
  expires_at: string | Date;
  created_user_agent: string | null;
  last_seen_user_agent: string | null;
  created_ip: string | null;
  last_seen_ip: string | null;
}

const DASHBOARD_ACCESS_TYPE_SET = new Set<DashboardAccessType>(DASHBOARD_ACCESS_TYPES);

function buildWebAuthSessionFilePath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.web-auth-sessions${extension}`);
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAccessType(value: unknown): DashboardAccessType | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim() as DashboardAccessType;
  return DASHBOARD_ACCESS_TYPE_SET.has(trimmed) ? trimmed : null;
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

function normalizeWebAuthSessionRecord(candidate: unknown): WebAuthSessionRecord | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const sessionId = normalizeNullableString((candidate as { sessionId?: unknown }).sessionId);
  const userId = normalizeNullableString((candidate as { userId?: unknown }).userId);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);
  const updatedAt = normalizeIsoString((candidate as { updatedAt?: unknown }).updatedAt);
  const lastSeenAt = normalizeIsoString((candidate as { lastSeenAt?: unknown }).lastSeenAt);
  const expiresAt = normalizeIsoString((candidate as { expiresAt?: unknown }).expiresAt);

  if (!sessionId || !userId || !createdAt || !updatedAt || !lastSeenAt || !expiresAt) {
    return null;
  }

  return {
    sessionId,
    userId,
    accessType: normalizeAccessType((candidate as { accessType?: unknown }).accessType),
    orgId: normalizeNullableString((candidate as { orgId?: unknown }).orgId),
    createdAt,
    updatedAt,
    lastSeenAt,
    expiresAt,
    createdUserAgent: normalizeNullableString((candidate as { createdUserAgent?: unknown }).createdUserAgent),
    lastSeenUserAgent: normalizeNullableString((candidate as { lastSeenUserAgent?: unknown }).lastSeenUserAgent),
    createdIp: normalizeNullableString((candidate as { createdIp?: unknown }).createdIp),
    lastSeenIp: normalizeNullableString((candidate as { lastSeenIp?: unknown }).lastSeenIp),
  };
}

function ensureFilePayload(candidate: unknown): WebAuthSessionFilePayload {
  const sessions = Array.isArray((candidate as { sessions?: unknown } | null)?.sessions)
    ? ((candidate as { sessions?: unknown[] }).sessions ?? [])
        .map((entry) => normalizeWebAuthSessionRecord(entry))
        .filter((entry): entry is WebAuthSessionRecord => entry !== null)
    : [];

  return { sessions };
}

function isRecordExpired(record: WebAuthSessionRecord, now: Date): boolean {
  const expiresAtMs = new Date(record.expiresAt).getTime();
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime();
}

function dedupeSessions(records: WebAuthSessionRecord[]): WebAuthSessionRecord[] {
  const merged = new Map<string, WebAuthSessionRecord>();
  for (const record of records) {
    const existing = merged.get(record.sessionId);
    if (!existing) {
      merged.set(record.sessionId, record);
      continue;
    }

    const existingUpdatedAt = new Date(existing.updatedAt).getTime();
    const nextUpdatedAt = new Date(record.updatedAt).getTime();
    if (Number.isNaN(existingUpdatedAt) || (!Number.isNaN(nextUpdatedAt) && nextUpdatedAt >= existingUpdatedAt)) {
      merged.set(record.sessionId, record);
    }
  }

  return Array.from(merged.values());
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

class FileWebAuthSessionStore implements WebAuthSessionStore {
  private readonly filePath: string;
  private operationQueue = Promise.resolve();

  constructor(dbPath: string) {
    this.filePath = buildWebAuthSessionFilePath(dbPath);
  }

  async initialize(): Promise<void> {
    await this.withLock(async () => {
      await this.loadPayload();
    });
  }

  async importLegacySessions(
    records: WebAuthSessionRecord[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number; skippedExpiredCount: number }> {
    const now = options?.now ?? new Date();
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const existingIds = new Set(payload.sessions.map((entry) => entry.sessionId));
      const normalizedLegacy = records
        .map((entry) => normalizeWebAuthSessionRecord(entry))
        .filter((entry): entry is WebAuthSessionRecord => entry !== null);
      const nonExpiredLegacy = normalizedLegacy.filter((entry) => !isRecordExpired(entry, now));
      const activeLegacy = dedupeSessions(nonExpiredLegacy);
      const skippedExpiredCount = normalizedLegacy.length - nonExpiredLegacy.length;
      const payloadById = new Map(payload.sessions.map((entry) => [entry.sessionId, entry] as const));
      const importedCount = activeLegacy.filter((entry) => !existingIds.has(entry.sessionId)).length;
      const changed = activeLegacy.some((entry) => {
        const existing = payloadById.get(entry.sessionId);
        return !existing || JSON.stringify(existing) !== JSON.stringify(entry);
      });
      if (changed) {
        const sessions = dedupeSessions([...payload.sessions, ...activeLegacy]);
        await this.savePayload({ sessions });
      }

      return { importedCount, skippedExpiredCount };
    });
  }

  async saveSession(record: WebAuthSessionRecord): Promise<void> {
    await this.withLock(async () => {
      const payload = await this.loadPayload();
      const next = payload.sessions.filter((entry) => entry.sessionId !== record.sessionId);
      next.push(record);
      await this.savePayload({ sessions: next });
    });
  }

  async getActiveSession(sessionId: string, userId: string, now = new Date()): Promise<WebAuthSessionRecord | null> {
    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const record =
        payload.sessions.find((entry) => entry.sessionId === sessionId && entry.userId === userId) ?? null;
      if (!record || isRecordExpired(record, now)) {
        return null;
      }

      return { ...record };
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.withLock(async () => {
      const payload = await this.loadPayload();
      const next = payload.sessions.filter((entry) => entry.sessionId !== sessionId);
      if (next.length === payload.sessions.length) {
        return;
      }

      await this.savePayload({ sessions: next });
    });
  }

  async revokeUserSessions(userId: string): Promise<number> {
    return await this.revokeSessionsForUsers([userId]);
  }

  async revokeSessionsForUsers(userIds: string[]): Promise<number> {
    const normalizedUserIds = Array.from(
      new Set(
        userIds
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
    if (normalizedUserIds.length === 0) {
      return 0;
    }

    return await this.withLock(async () => {
      const payload = await this.loadPayload();
      const targetIds = new Set(normalizedUserIds);
      const next = payload.sessions.filter((entry) => !targetIds.has(entry.userId));
      const revokedCount = payload.sessions.length - next.length;
      if (revokedCount > 0) {
        await this.savePayload({ sessions: next });
      }

      return revokedCount;
    });
  }

  private async loadPayload(): Promise<WebAuthSessionFilePayload> {
    await ensureParentDirectory(this.filePath);

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return ensureFilePayload(JSON.parse(raw));
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "ENOENT") {
        const payload = { sessions: [] };
        await this.savePayload(payload);
        return payload;
      }
      throw error;
    }
  }

  private async savePayload(payload: WebAuthSessionFilePayload): Promise<void> {
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

class PostgresWebAuthSessionStore implements WebAuthSessionStore {
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

  async importLegacySessions(
    records: WebAuthSessionRecord[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number; skippedExpiredCount: number }> {
    const now = options?.now ?? new Date();
    const normalizedLegacy = records
      .map((entry) => normalizeWebAuthSessionRecord(entry))
      .filter((entry): entry is WebAuthSessionRecord => entry !== null);
    const nonExpiredLegacy = normalizedLegacy.filter((entry) => !isRecordExpired(entry, now));
    const activeLegacy = dedupeSessions(nonExpiredLegacy);
    const skippedExpiredCount = normalizedLegacy.length - nonExpiredLegacy.length;
    if (activeLegacy.length === 0) {
      return { importedCount: 0, skippedExpiredCount };
    }

    await this.ensureTable();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ session_id: string }>(
        "SELECT session_id FROM web_auth_sessions WHERE session_id = ANY($1::text[])",
        [activeLegacy.map((entry) => entry.sessionId)]
      );
      const existingIds = new Set(existing.rows.map((entry) => entry.session_id));

      for (const record of dedupeSessions(activeLegacy)) {
        await upsertSessionRow(client, record);
      }

      await client.query("COMMIT");
      const importedCount = activeLegacy.filter((entry) => !existingIds.has(entry.sessionId)).length;
      return { importedCount, skippedExpiredCount };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveSession(record: WebAuthSessionRecord): Promise<void> {
    await this.ensureTable();
    await upsertSessionRow(this.pool, record);
  }

  async getActiveSession(sessionId: string, userId: string, now = new Date()): Promise<WebAuthSessionRecord | null> {
    await this.ensureTable();
    const result = await this.pool.query<WebAuthSessionRow>(
      `
        SELECT
          session_id,
          user_id,
          access_type,
          org_id,
          created_at,
          updated_at,
          last_seen_at,
          expires_at,
          created_user_agent,
          last_seen_user_agent,
          created_ip,
          last_seen_ip
        FROM web_auth_sessions
        WHERE session_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [sessionId, userId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const record = mapRowToSessionRecord(row);
    if (!record || isRecordExpired(record, now)) {
      return null;
    }

    return record;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.ensureTable();
    await this.pool.query("DELETE FROM web_auth_sessions WHERE session_id = $1", [sessionId]);
  }

  async revokeUserSessions(userId: string): Promise<number> {
    return await this.revokeSessionsForUsers([userId]);
  }

  async revokeSessionsForUsers(userIds: string[]): Promise<number> {
    const normalizedUserIds = Array.from(
      new Set(
        userIds
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
    if (normalizedUserIds.length === 0) {
      return 0;
    }

    await this.ensureTable();
    const result = await this.pool.query(
      "DELETE FROM web_auth_sessions WHERE user_id = ANY($1::text[])",
      [normalizedUserIds]
    );
    return result.rowCount ?? 0;
  }

  private async ensureTable(): Promise<void> {
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = (async () => {
        await this.pool.query(
          `
            CREATE TABLE IF NOT EXISTS web_auth_sessions (
              session_id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              access_type TEXT NULL,
              org_id TEXT NULL,
              created_at TIMESTAMPTZ NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL,
              last_seen_at TIMESTAMPTZ NOT NULL,
              expires_at TIMESTAMPTZ NOT NULL,
              created_user_agent TEXT NULL,
              last_seen_user_agent TEXT NULL,
              created_ip TEXT NULL,
              last_seen_ip TEXT NULL
            );
          `
        );
        await this.pool.query(
          "CREATE INDEX IF NOT EXISTS web_auth_sessions_user_id_idx ON web_auth_sessions (user_id)"
        );
        await this.pool.query(
          "CREATE INDEX IF NOT EXISTS web_auth_sessions_expires_at_idx ON web_auth_sessions (expires_at)"
        );
      })();
    }

    await this.ensureTablePromise;
  }
}

function mapRowToSessionRecord(row: WebAuthSessionRow): WebAuthSessionRecord | null {
  return normalizeWebAuthSessionRecord({
    sessionId: row.session_id,
    userId: row.user_id,
    accessType: row.access_type,
    orgId: row.org_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    createdUserAgent: row.created_user_agent,
    lastSeenUserAgent: row.last_seen_user_agent,
    createdIp: row.created_ip,
    lastSeenIp: row.last_seen_ip,
  });
}

async function upsertSessionRow(
  client: Pick<Pool, "query"> | { query: Pool["query"] },
  record: WebAuthSessionRecord
): Promise<void> {
  await client.query(
    `
      INSERT INTO web_auth_sessions (
        session_id,
        user_id,
        access_type,
        org_id,
        created_at,
        updated_at,
        last_seen_at,
        expires_at,
        created_user_agent,
        last_seen_user_agent,
        created_ip,
        last_seen_ip
      )
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9, $10, $11, $12)
      ON CONFLICT (session_id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            access_type = EXCLUDED.access_type,
            org_id = EXCLUDED.org_id,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            last_seen_at = EXCLUDED.last_seen_at,
            expires_at = EXCLUDED.expires_at,
            created_user_agent = EXCLUDED.created_user_agent,
            last_seen_user_agent = EXCLUDED.last_seen_user_agent,
            created_ip = EXCLUDED.created_ip,
            last_seen_ip = EXCLUDED.last_seen_ip
    `,
    [
      record.sessionId,
      record.userId,
      record.accessType,
      record.orgId,
      record.createdAt,
      record.updatedAt,
      record.lastSeenAt,
      record.expiresAt,
      record.createdUserAgent,
      record.lastSeenUserAgent,
      record.createdIp,
      record.lastSeenIp
    ]
  );
}

export function createWebAuthSessionStore(params: CreateWebAuthSessionStoreParams): WebAuthSessionStore {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresWebAuthSessionStore(params.databaseUrl, {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs
    });
  }

  return new FileWebAuthSessionStore(params.dbPath);
}
