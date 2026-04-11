import path from "node:path";
import { promises as fs } from "node:fs";
import { Pool, PoolClient } from "pg";

import { UsageSessionRecord } from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

export interface UsageSessionQuery {
  userId?: string;
  orgId?: string | null;
  segmentId?: string;
  scenarioId?: string;
  trainingId?: string | null;
  trainingPackId?: string | null;
  startedAtFrom?: Date | null;
  startedAtBefore?: Date | null;
  endedAtFrom?: Date | null;
  endedAtBefore?: Date | null;
}

export interface UsageSessionAppendResult {
  created: boolean;
  record: UsageSessionRecord;
}

export interface UsageSessionStore {
  initialize(): Promise<void>;
  refreshSnapshot(): Promise<void>;
  importLegacyRecords(records: UsageSessionRecord[]): Promise<{ importedCount: number }>;
  appendRecord(record: UsageSessionRecord): Promise<UsageSessionAppendResult>;
  getRecordById(sessionId: string): UsageSessionRecord | null;
  listRecords(query?: UsageSessionQuery): UsageSessionRecord[];
  deleteRecordsForUser(userId: string): Promise<number>;
}

interface CreateUsageSessionStoreParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface UsageSessionFilePayload {
  records: UsageSessionRecord[];
}

interface UsageSessionRow {
  id: string;
  user_id: string;
  org_id: string | null;
  segment_id: string;
  scenario_id: string;
  training_id: string | null;
  training_pack_id: string | null;
  started_at: string | Date;
  ended_at: string | Date;
  raw_duration_seconds: number | string;
  billed_seconds_added: number | string | null;
  created_at: string | Date;
}

function buildUsageSessionFilePath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.usage-sessions${extension}`);
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }

  return null;
}

function normalizeUsageSessionRecord(candidate: unknown): UsageSessionRecord | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const id = normalizeNullableString((candidate as { id?: unknown }).id);
  const userId = normalizeNullableString((candidate as { userId?: unknown }).userId);
  const segmentId = normalizeNullableString((candidate as { segmentId?: unknown }).segmentId);
  const scenarioId = normalizeNullableString((candidate as { scenarioId?: unknown }).scenarioId);
  const startedAt = normalizeIsoString((candidate as { startedAt?: unknown }).startedAt);
  const endedAt = normalizeIsoString((candidate as { endedAt?: unknown }).endedAt);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);
  const rawDurationSeconds = normalizeNonNegativeInteger(
    (candidate as { rawDurationSeconds?: unknown }).rawDurationSeconds
  );

  if (!id || !userId || !segmentId || !scenarioId || !startedAt || !endedAt || !createdAt || rawDurationSeconds === null) {
    return null;
  }

  const billedSecondsAdded = normalizeNonNegativeInteger(
    (candidate as { billedSecondsAdded?: unknown }).billedSecondsAdded
  );

  return {
    id,
    userId,
    orgId: normalizeNullableString((candidate as { orgId?: unknown }).orgId),
    segmentId,
    scenarioId,
    trainingId: normalizeNullableString((candidate as { trainingId?: unknown }).trainingId) ?? undefined,
    trainingPackId: normalizeNullableString((candidate as { trainingPackId?: unknown }).trainingPackId) ?? undefined,
    startedAt,
    endedAt,
    rawDurationSeconds,
    billedSecondsAdded: billedSecondsAdded ?? undefined,
    createdAt
  };
}

function matchesDateLowerBound(value: string, lowerBound: Date | null | undefined): boolean {
  if (!lowerBound) {
    return true;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed >= lowerBound.getTime();
}

function matchesDateUpperBound(value: string, upperBound: Date | null | undefined): boolean {
  if (!upperBound) {
    return true;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed < upperBound.getTime();
}

export function matchesUsageSessionQuery(record: UsageSessionRecord, query: UsageSessionQuery): boolean {
  if (query.userId && record.userId !== query.userId) {
    return false;
  }
  if (query.orgId !== undefined && record.orgId !== query.orgId) {
    return false;
  }
  if (query.segmentId && record.segmentId !== query.segmentId) {
    return false;
  }
  if (query.scenarioId && record.scenarioId !== query.scenarioId) {
    return false;
  }
  if (query.trainingId !== undefined && (record.trainingId ?? null) !== query.trainingId) {
    return false;
  }
  if (query.trainingPackId !== undefined && (record.trainingPackId ?? null) !== query.trainingPackId) {
    return false;
  }
  if (!matchesDateLowerBound(record.startedAt, query.startedAtFrom)) {
    return false;
  }
  if (!matchesDateUpperBound(record.startedAt, query.startedAtBefore)) {
    return false;
  }
  if (!matchesDateLowerBound(record.endedAt, query.endedAtFrom)) {
    return false;
  }
  if (!matchesDateUpperBound(record.endedAt, query.endedAtBefore)) {
    return false;
  }
  return true;
}

function compareUsageSessionsAscending(left: UsageSessionRecord, right: UsageSessionRecord): number {
  const leftCreatedAtMs = new Date(left.createdAt).getTime();
  const rightCreatedAtMs = new Date(right.createdAt).getTime();
  const normalizedLeftCreatedAtMs = Number.isNaN(leftCreatedAtMs) ? Number.NEGATIVE_INFINITY : leftCreatedAtMs;
  const normalizedRightCreatedAtMs = Number.isNaN(rightCreatedAtMs) ? Number.NEGATIVE_INFINITY : rightCreatedAtMs;
  if (normalizedLeftCreatedAtMs !== normalizedRightCreatedAtMs) {
    return normalizedLeftCreatedAtMs - normalizedRightCreatedAtMs;
  }

  const leftEndedAtMs = new Date(left.endedAt).getTime();
  const rightEndedAtMs = new Date(right.endedAt).getTime();
  const normalizedLeftEndedAtMs = Number.isNaN(leftEndedAtMs) ? Number.NEGATIVE_INFINITY : leftEndedAtMs;
  const normalizedRightEndedAtMs = Number.isNaN(rightEndedAtMs) ? Number.NEGATIVE_INFINITY : rightEndedAtMs;
  if (normalizedLeftEndedAtMs !== normalizedRightEndedAtMs) {
    return normalizedLeftEndedAtMs - normalizedRightEndedAtMs;
  }

  return left.id.localeCompare(right.id);
}

function normalizeUsageSessionCollection(records: UsageSessionRecord[]): UsageSessionRecord[] {
  const deduped = new Map<string, UsageSessionRecord>();
  for (const record of records) {
    const existing = deduped.get(record.id);
    if (!existing) {
      deduped.set(record.id, record);
      continue;
    }

    const existingCreatedAtMs = new Date(existing.createdAt).getTime();
    const nextCreatedAtMs = new Date(record.createdAt).getTime();
    if (Number.isNaN(existingCreatedAtMs) || (!Number.isNaN(nextCreatedAtMs) && nextCreatedAtMs >= existingCreatedAtMs)) {
      deduped.set(record.id, record);
    }
  }

  return Array.from(deduped.values()).sort(compareUsageSessionsAscending);
}

function ensureFilePayload(candidate: unknown): { payload: UsageSessionFilePayload; changed: boolean } {
  const normalizedRecords = Array.isArray((candidate as { records?: unknown } | null)?.records)
    ? ((candidate as { records?: unknown[] }).records ?? [])
        .map((entry) => normalizeUsageSessionRecord(entry))
        .filter((entry): entry is UsageSessionRecord => entry !== null)
    : [];

  const records = normalizeUsageSessionCollection(normalizedRecords);
  return {
    payload: { records },
    changed:
      records.length !== normalizedRecords.length
      || records.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(normalizedRecords[index]))
  };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function mapUsageSessionRow(row: UsageSessionRow): UsageSessionRecord | null {
  return normalizeUsageSessionRecord({
    id: row.id,
    userId: row.user_id,
    orgId: row.org_id,
    segmentId: row.segment_id,
    scenarioId: row.scenario_id,
    trainingId: row.training_id,
    trainingPackId: row.training_pack_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    rawDurationSeconds: row.raw_duration_seconds,
    billedSecondsAdded: row.billed_seconds_added,
    createdAt: row.created_at
  });
}

abstract class BaseUsageSessionStore implements UsageSessionStore {
  protected records: UsageSessionRecord[] = [];
  protected recordsById = new Map<string, UsageSessionRecord>();

  getRecordById(sessionId: string): UsageSessionRecord | null {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return null;
    }

    return this.recordsById.get(normalizedSessionId) ?? null;
  }

  listRecords(query: UsageSessionQuery = {}): UsageSessionRecord[] {
    return this.records.filter((record) => matchesUsageSessionQuery(record, query));
  }

  /**
   * Reads stay snapshot-backed so entitlement/billing/reporting code can remain synchronous.
   * That keeps behavior stable, but it also means extracted usage-session truth assumes a single
   * API process unless a future design adds explicit cross-process refresh/invalidation.
   */
  protected setSnapshot(records: UsageSessionRecord[]): void {
    this.records = normalizeUsageSessionCollection(records);
    this.recordsById = new Map(this.records.map((record) => [record.id, record] as const));
  }

  abstract initialize(): Promise<void>;
  abstract refreshSnapshot(): Promise<void>;
  abstract importLegacyRecords(records: UsageSessionRecord[]): Promise<{ importedCount: number }>;
  abstract appendRecord(record: UsageSessionRecord): Promise<UsageSessionAppendResult>;
  abstract deleteRecordsForUser(userId: string): Promise<number>;
}

class FileUsageSessionStore extends BaseUsageSessionStore {
  private readonly filePath: string;
  private initialized = false;
  private operationQueue = Promise.resolve();

  constructor(dbPath: string) {
    super();
    this.filePath = buildUsageSessionFilePath(dbPath);
  }

  async initialize(): Promise<void> {
    await this.withLock(async () => {
      if (this.initialized) {
        return;
      }

      const payload = await this.loadPayload();
      this.setSnapshot(payload.records);
      this.initialized = true;
    });
  }

  async refreshSnapshot(): Promise<void> {
    await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      this.setSnapshot(payload.records);
    });
  }

  async importLegacyRecords(records: UsageSessionRecord[]): Promise<{ importedCount: number }> {
    return await this.withLock(async () => {
      await this.ensureInitialized();
      const existingIds = new Set(this.records.map((record) => record.id));
      const normalizedLegacy = normalizeUsageSessionCollection(
        records
          .map((entry) => normalizeUsageSessionRecord(entry))
          .filter((entry): entry is UsageSessionRecord => entry !== null)
      );
      const next = normalizeUsageSessionCollection([...this.records, ...normalizedLegacy]);
      await this.savePayload({ records: next });
      this.setSnapshot(next);
      return {
        importedCount: normalizedLegacy.filter((record) => !existingIds.has(record.id)).length
      };
    });
  }

  async appendRecord(record: UsageSessionRecord): Promise<UsageSessionAppendResult> {
    const normalized = normalizeUsageSessionRecord(record);
    if (!normalized) {
      throw new Error("Usage session is invalid.");
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const existing = this.recordsById.get(normalized.id);
      if (existing) {
        return {
          created: false,
          record: existing
        };
      }

      const next = normalizeUsageSessionCollection([...this.records, normalized]);
      await this.savePayload({ records: next });
      this.setSnapshot(next);
      return {
        created: true,
        record: normalized
      };
    });
  }

  async deleteRecordsForUser(userId: string): Promise<number> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return 0;
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const next = this.records.filter((record) => record.userId !== normalizedUserId);
      const deletedCount = this.records.length - next.length;
      if (deletedCount > 0) {
        await this.savePayload({ records: next });
        this.setSnapshot(next);
      }
      return deletedCount;
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const payload = await this.loadPayload();
    this.setSnapshot(payload.records);
    this.initialized = true;
  }

  private async loadPayload(): Promise<UsageSessionFilePayload> {
    await ensureParentDirectory(this.filePath);

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const loaded = ensureFilePayload(JSON.parse(raw));
      if (loaded.changed) {
        await this.savePayload(loaded.payload);
      }
      return loaded.payload;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "ENOENT") {
        const payload = { records: [] };
        await this.savePayload(payload);
        return payload;
      }
      throw error;
    }
  }

  private async savePayload(payload: UsageSessionFilePayload): Promise<void> {
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

class PostgresUsageSessionStore extends BaseUsageSessionStore {
  private readonly pool: Pool;
  private ensureTablePromise: Promise<void> | null = null;
  private initialized = false;
  private operationQueue = Promise.resolve();

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number }
  ) {
    super();
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: options.pgPoolMax,
      connectionTimeoutMillis: options.pgConnectTimeoutMs,
      idleTimeoutMillis: options.pgIdleTimeoutMs,
      keepAlive: true
    });
  }

  async initialize(): Promise<void> {
    await this.withLock(async () => {
      if (this.initialized) {
        return;
      }

      await this.ensureTable();
      this.setSnapshot(await this.loadSnapshotFromDatabase());
      this.initialized = true;
    });
  }

  async refreshSnapshot(): Promise<void> {
    await this.withLock(async () => {
      await this.ensureInitialized();
      this.setSnapshot(await this.loadSnapshotFromDatabase());
    });
  }

  async importLegacyRecords(records: UsageSessionRecord[]): Promise<{ importedCount: number }> {
    return await this.withLock(async () => {
      await this.ensureInitialized();
      const normalizedLegacy = normalizeUsageSessionCollection(
        records
          .map((entry) => normalizeUsageSessionRecord(entry))
          .filter((entry): entry is UsageSessionRecord => entry !== null)
      );
      if (normalizedLegacy.length === 0) {
        return { importedCount: 0 };
      }

      const existingIds = new Set(this.records.map((record) => record.id));
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        for (const record of normalizedLegacy) {
          await upsertUsageSessionRow(client, record);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      this.setSnapshot(normalizeUsageSessionCollection([...this.records, ...normalizedLegacy]));
      return {
        importedCount: normalizedLegacy.filter((record) => !existingIds.has(record.id)).length
      };
    });
  }

  async appendRecord(record: UsageSessionRecord): Promise<UsageSessionAppendResult> {
    const normalized = normalizeUsageSessionRecord(record);
    if (!normalized) {
      throw new Error("Usage session is invalid.");
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const existing = this.recordsById.get(normalized.id);
      if (existing) {
        return {
          created: false,
          record: existing
        };
      }

      const result = await this.pool.query<UsageSessionRow>(
        `
          INSERT INTO usage_sessions (
            id,
            user_id,
            org_id,
            segment_id,
            scenario_id,
            training_id,
            training_pack_id,
            started_at,
            ended_at,
            raw_duration_seconds,
            billed_seconds_added,
            created_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8::timestamptz, $9::timestamptz, $10, $11, $12::timestamptz
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING
            id,
            user_id,
            org_id,
            segment_id,
            scenario_id,
            training_id,
            training_pack_id,
            started_at,
            ended_at,
            raw_duration_seconds,
            billed_seconds_added,
            created_at
        `,
        [
          normalized.id,
          normalized.userId,
          normalized.orgId ?? null,
          normalized.segmentId,
          normalized.scenarioId,
          normalized.trainingId ?? null,
          normalized.trainingPackId ?? null,
          normalized.startedAt,
          normalized.endedAt,
          normalized.rawDurationSeconds,
          normalized.billedSecondsAdded ?? null,
          normalized.createdAt
        ]
      );

      const inserted = result.rows[0] ? mapUsageSessionRow(result.rows[0]) : null;
      if (inserted) {
        this.setSnapshot(normalizeUsageSessionCollection([...this.records, inserted]));
        return {
          created: true,
          record: inserted
        };
      }

      const current = this.recordsById.get(normalized.id);
      if (!current) {
        throw new Error("Usage session already exists but could not be loaded from snapshot.");
      }

      return {
        created: false,
        record: current
      };
    });
  }

  async deleteRecordsForUser(userId: string): Promise<number> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return 0;
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const result = await this.pool.query<{ id: string }>(
        "DELETE FROM usage_sessions WHERE user_id = $1 RETURNING id",
        [normalizedUserId]
      );
      const deletedCount = result.rowCount ?? result.rows.length;
      if (deletedCount > 0) {
        this.setSnapshot(this.records.filter((record) => record.userId !== normalizedUserId));
      }
      return deletedCount;
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.ensureTable();
    this.setSnapshot(await this.loadSnapshotFromDatabase());
    this.initialized = true;
  }

  private async ensureTable(): Promise<void> {
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = this.pool
        .query(
          `
            CREATE TABLE IF NOT EXISTS usage_sessions (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              org_id TEXT NULL,
              segment_id TEXT NOT NULL,
              scenario_id TEXT NOT NULL,
              training_id TEXT NULL,
              training_pack_id TEXT NULL,
              started_at TIMESTAMPTZ NOT NULL,
              ended_at TIMESTAMPTZ NOT NULL,
              raw_duration_seconds INTEGER NOT NULL,
              billed_seconds_added INTEGER NULL,
              created_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_usage_sessions_user_id ON usage_sessions (user_id);
            CREATE INDEX IF NOT EXISTS idx_usage_sessions_org_id ON usage_sessions (org_id);
            CREATE INDEX IF NOT EXISTS idx_usage_sessions_training_pack_id ON usage_sessions (training_pack_id);
            CREATE INDEX IF NOT EXISTS idx_usage_sessions_scenario_id ON usage_sessions (scenario_id);
            CREATE INDEX IF NOT EXISTS idx_usage_sessions_segment_id ON usage_sessions (segment_id);
            CREATE INDEX IF NOT EXISTS idx_usage_sessions_started_at ON usage_sessions (started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_usage_sessions_ended_at ON usage_sessions (ended_at DESC);
            CREATE INDEX IF NOT EXISTS idx_usage_sessions_created_at ON usage_sessions (created_at DESC);
          `
        )
        .then(() => undefined);
    }

    await this.ensureTablePromise;
  }

  private async loadSnapshotFromDatabase(): Promise<UsageSessionRecord[]> {
    const result = await this.pool.query<UsageSessionRow>(
      `
        SELECT
          id,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          training_id,
          training_pack_id,
          started_at,
          ended_at,
          raw_duration_seconds,
          billed_seconds_added,
          created_at
        FROM usage_sessions
        ORDER BY created_at ASC, ended_at ASC, id ASC
      `
    );

    return result.rows
      .map((row) => mapUsageSessionRow(row))
      .filter((entry): entry is UsageSessionRecord => entry !== null);
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

async function upsertUsageSessionRow(
  client: Pick<PoolClient, "query"> | Pick<Pool, "query">,
  record: UsageSessionRecord
): Promise<void> {
  await client.query(
    `
      INSERT INTO usage_sessions (
        id,
        user_id,
        org_id,
        segment_id,
        scenario_id,
        training_id,
        training_pack_id,
        started_at,
        ended_at,
        raw_duration_seconds,
        billed_seconds_added,
        created_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::timestamptz, $9::timestamptz, $10, $11, $12::timestamptz
      )
      ON CONFLICT (id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            org_id = EXCLUDED.org_id,
            segment_id = EXCLUDED.segment_id,
            scenario_id = EXCLUDED.scenario_id,
            training_id = EXCLUDED.training_id,
            training_pack_id = EXCLUDED.training_pack_id,
            started_at = EXCLUDED.started_at,
            ended_at = EXCLUDED.ended_at,
            raw_duration_seconds = EXCLUDED.raw_duration_seconds,
            billed_seconds_added = EXCLUDED.billed_seconds_added,
            created_at = EXCLUDED.created_at
    `,
    [
      record.id,
      record.userId,
      record.orgId ?? null,
      record.segmentId,
      record.scenarioId,
      record.trainingId ?? null,
      record.trainingPackId ?? null,
      record.startedAt,
      record.endedAt,
      record.rawDurationSeconds,
      record.billedSecondsAdded ?? null,
      record.createdAt
    ]
  );
}

class UnsupportedUsageSessionStore extends BaseUsageSessionStore {
  async initialize(): Promise<void> {
    throw new Error("Usage session storage provider is not supported.");
  }

  async refreshSnapshot(): Promise<void> {
    throw new Error("Usage session storage provider is not supported.");
  }

  async importLegacyRecords(): Promise<{ importedCount: number }> {
    throw new Error("Usage session storage provider is not supported.");
  }

  async appendRecord(): Promise<UsageSessionAppendResult> {
    throw new Error("Usage session storage provider is not supported.");
  }

  async deleteRecordsForUser(): Promise<number> {
    throw new Error("Usage session storage provider is not supported.");
  }
}

export function createUsageSessionStore(params: CreateUsageSessionStoreParams): UsageSessionStore {
  // `usageSessions` now have extracted persistence authority, but current reads are still served
  // from an in-process snapshot to preserve synchronous entitlement semantics.
  // Reporting-critical routes should refresh this snapshot before composing payloads.
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresUsageSessionStore(params.databaseUrl, {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs
    });
  }

  if (params.provider === "file") {
    return new FileUsageSessionStore(params.dbPath);
  }

  return new UnsupportedUsageSessionStore();
}
