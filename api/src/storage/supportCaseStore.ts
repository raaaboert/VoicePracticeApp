import path from "node:path";
import { promises as fs } from "node:fs";
import { Pool, PoolClient } from "pg";

import {
  SupportCaseRecord,
  SupportCaseStatus
} from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

export interface SupportCaseStore {
  initialize(options?: { now?: Date }): Promise<void>;
  importLegacyCases(
    records: SupportCaseRecord[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number }>;
  saveCase(record: SupportCaseRecord, options?: { now?: Date }): Promise<void>;
  listCases(options?: { now?: Date }): Promise<SupportCaseRecord[]>;
  getCaseById(caseId: string, options?: { now?: Date }): Promise<SupportCaseRecord | null>;
  deleteCasesForUser(userId: string): Promise<number>;
}

interface CreateSupportCaseStoreParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface SupportCaseFilePayload {
  cases: SupportCaseRecord[];
}

interface SupportCaseRow {
  id: string;
  status: string;
  user_id: string;
  org_id: string | null;
  segment_id: string | null;
  scenario_id: string | null;
  message: string;
  transcript_encrypted: string | null;
  transcript_expires_at: string | Date | null;
  transcript_file_name: string | null;
  transcript_meta: Record<string, unknown> | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const SUPPORT_CASE_STATUS_SET = new Set<SupportCaseStatus>(["open", "closed"]);

function buildSupportCaseFilePath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.support-cases${extension}`);
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

function normalizeSupportCaseStatus(value: unknown): SupportCaseStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim() as SupportCaseStatus;
  return SUPPORT_CASE_STATUS_SET.has(trimmed) ? trimmed : null;
}

function normalizeTranscriptMeta(value: unknown): SupportCaseRecord["transcriptMeta"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const normalizeOptionalValue = (entry: unknown): string | null =>
    typeof entry === "string" && entry.trim() ? entry.trim() : null;

  const difficulty = normalizeOptionalValue(candidate.difficulty);
  const personaStyle = normalizeOptionalValue(candidate.personaStyle);

  return {
    scenarioTitle: normalizeOptionalValue(candidate.scenarioTitle),
    segmentLabel: normalizeOptionalValue(candidate.segmentLabel),
    difficulty:
      difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? difficulty : null,
    personaStyle:
      personaStyle === "defensive" || personaStyle === "frustrated" || personaStyle === "skeptical"
        ? personaStyle
        : null,
    startedAt: normalizeOptionalValue(candidate.startedAt),
    endedAt: normalizeOptionalValue(candidate.endedAt),
    model: normalizeOptionalValue(candidate.model),
    promptVersion: normalizeOptionalValue(candidate.promptVersion),
    rubricVersion: normalizeOptionalValue(candidate.rubricVersion)
  };
}

function clearExpiredTranscript(record: SupportCaseRecord, now: Date): { record: SupportCaseRecord; changed: boolean } {
  if (!record.transcriptEncrypted || !record.transcriptExpiresAt) {
    return { record, changed: false };
  }

  const expiresAtMs = new Date(record.transcriptExpiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs > now.getTime()) {
    return { record, changed: false };
  }

  return {
    record: {
      ...record,
      transcriptEncrypted: null,
      transcriptExpiresAt: null,
      transcriptFileName: null
    },
    changed: true
  };
}

function normalizeSupportCaseRecord(candidate: unknown, now?: Date): SupportCaseRecord | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const id = normalizeNullableString((candidate as { id?: unknown }).id);
  const status = normalizeSupportCaseStatus((candidate as { status?: unknown }).status);
  const userId = normalizeNullableString((candidate as { userId?: unknown }).userId);
  const message = normalizeNullableString((candidate as { message?: unknown }).message);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);
  const updatedAt = normalizeIsoString((candidate as { updatedAt?: unknown }).updatedAt);

  if (!id || !status || !userId || !message || !createdAt || !updatedAt) {
    return null;
  }

  const normalized: SupportCaseRecord = {
    id,
    status,
    userId,
    orgId: normalizeNullableString((candidate as { orgId?: unknown }).orgId),
    segmentId: normalizeNullableString((candidate as { segmentId?: unknown }).segmentId),
    scenarioId: normalizeNullableString((candidate as { scenarioId?: unknown }).scenarioId),
    message,
    transcriptEncrypted: normalizeNullableString(
      (candidate as { transcriptEncrypted?: unknown }).transcriptEncrypted
    ),
    transcriptExpiresAt: normalizeIsoString(
      (candidate as { transcriptExpiresAt?: unknown }).transcriptExpiresAt
    ),
    transcriptFileName: normalizeNullableString(
      (candidate as { transcriptFileName?: unknown }).transcriptFileName
    ),
    transcriptMeta: normalizeTranscriptMeta((candidate as { transcriptMeta?: unknown }).transcriptMeta),
    createdAt,
    updatedAt,
  };

  if (!now) {
    return normalized;
  }

  return clearExpiredTranscript(normalized, now).record;
}

function compareSupportCasesAscending(left: SupportCaseRecord, right: SupportCaseRecord): number {
  const leftMs = new Date(left.createdAt).getTime();
  const rightMs = new Date(right.createdAt).getTime();
  const normalizedLeftMs = Number.isNaN(leftMs) ? Number.NEGATIVE_INFINITY : leftMs;
  const normalizedRightMs = Number.isNaN(rightMs) ? Number.NEGATIVE_INFINITY : rightMs;
  if (normalizedLeftMs !== normalizedRightMs) {
    return normalizedLeftMs - normalizedRightMs;
  }
  return left.id.localeCompare(right.id);
}

function dedupeSupportCases(records: SupportCaseRecord[]): SupportCaseRecord[] {
  const merged = new Map<string, SupportCaseRecord>();
  for (const record of records) {
    const existing = merged.get(record.id);
    if (!existing) {
      merged.set(record.id, record);
      continue;
    }

    const existingUpdatedAt = new Date(existing.updatedAt).getTime();
    const nextUpdatedAt = new Date(record.updatedAt).getTime();
    if (Number.isNaN(existingUpdatedAt) || (!Number.isNaN(nextUpdatedAt) && nextUpdatedAt >= existingUpdatedAt)) {
      merged.set(record.id, record);
    }
  }

  return Array.from(merged.values()).sort(compareSupportCasesAscending);
}

function normalizeSupportCaseCollection(
  records: SupportCaseRecord[],
  now: Date
): { cases: SupportCaseRecord[]; changed: boolean } {
  let changed = false;
  const normalized = dedupeSupportCases(
    records
      .map((entry) => normalizeSupportCaseRecord(entry, now))
      .filter((entry): entry is SupportCaseRecord => entry !== null)
  ).map((entry) => {
    const cleared = clearExpiredTranscript(entry, now);
    changed = changed || cleared.changed;
    return cleared.record;
  });

  if (normalized.length !== records.length) {
    changed = true;
  }

  return { cases: normalized, changed };
}

function ensureFilePayload(candidate: unknown, now: Date): { payload: SupportCaseFilePayload; changed: boolean } {
  const cases = Array.isArray((candidate as { cases?: unknown } | null)?.cases)
    ? ((candidate as { cases?: unknown[] }).cases ?? [])
        .map((entry) => normalizeSupportCaseRecord(entry, now))
        .filter((entry): entry is SupportCaseRecord => entry !== null)
    : [];

  const normalized = normalizeSupportCaseCollection(cases, now);
  return {
    payload: { cases: normalized.cases },
    changed: normalized.changed
  };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

class FileSupportCaseStore implements SupportCaseStore {
  private readonly filePath: string;
  private operationQueue = Promise.resolve();

  constructor(dbPath: string) {
    this.filePath = buildSupportCaseFilePath(dbPath);
  }

  async initialize(options?: { now?: Date }): Promise<void> {
    await this.withLock(async () => {
      await this.loadPayload(options?.now ?? new Date());
    });
  }

  async importLegacyCases(
    records: SupportCaseRecord[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number }> {
    const now = options?.now ?? new Date();
    return await this.withLock(async () => {
      const payload = await this.loadPayload(now);
      const existingIds = new Set(payload.cases.map((entry) => entry.id));
      const normalizedLegacy = records
        .map((entry) => normalizeSupportCaseRecord(entry, now))
        .filter((entry): entry is SupportCaseRecord => entry !== null);
      const importedCount = normalizedLegacy.filter((entry) => !existingIds.has(entry.id)).length;
      const next = normalizeSupportCaseCollection([...payload.cases, ...normalizedLegacy], now);
      const payloadById = new Map(payload.cases.map((entry) => [entry.id, entry] as const));
      const contentChanged = next.cases.some((entry) => {
        const existing = payloadById.get(entry.id);
        return !existing || JSON.stringify(existing) !== JSON.stringify(entry);
      });
      if (next.changed || next.cases.length !== payload.cases.length || contentChanged) {
        await this.savePayload({ cases: next.cases });
      }
      return { importedCount };
    });
  }

  async saveCase(record: SupportCaseRecord, options?: { now?: Date }): Promise<void> {
    const now = options?.now ?? new Date();
    const normalizedRecord = normalizeSupportCaseRecord(record, now);
    if (!normalizedRecord) {
      throw new Error("Support case record is invalid.");
    }

    await this.withLock(async () => {
      const payload = await this.loadPayload(now);
      const next = normalizeSupportCaseCollection(
        [...payload.cases.filter((entry) => entry.id !== normalizedRecord.id), normalizedRecord],
        now
      );
      await this.savePayload({ cases: next.cases });
    });
  }

  async listCases(options?: { now?: Date }): Promise<SupportCaseRecord[]> {
    const now = options?.now ?? new Date();
    return await this.withLock(async () => {
      const payload = await this.loadPayload(now);
      return payload.cases
        .slice()
        .sort((left, right) => compareSupportCasesAscending(right, left));
    });
  }

  async getCaseById(caseId: string, options?: { now?: Date }): Promise<SupportCaseRecord | null> {
    const normalizedCaseId = caseId.trim();
    if (!normalizedCaseId) {
      return null;
    }

    const now = options?.now ?? new Date();
    return await this.withLock(async () => {
      const payload = await this.loadPayload(now);
      const record = payload.cases.find((entry) => entry.id === normalizedCaseId) ?? null;
      return record ? { ...record } : null;
    });
  }

  async deleteCasesForUser(userId: string): Promise<number> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return 0;
    }

    return await this.withLock(async () => {
      const payload = await this.loadPayload(new Date());
      const next = payload.cases.filter((entry) => entry.userId !== normalizedUserId);
      const deletedCount = payload.cases.length - next.length;
      if (deletedCount > 0) {
        await this.savePayload({ cases: next });
      }
      return deletedCount;
    });
  }

  private async loadPayload(now: Date): Promise<SupportCaseFilePayload> {
    const readAndParse = async (): Promise<{ payload: SupportCaseFilePayload; changed: boolean }> => {
      const raw = await fs.readFile(this.filePath, "utf8");
      return ensureFilePayload(JSON.parse(raw), now);
    };

    try {
      const loaded = await readAndParse();
      if (loaded.changed) {
        await this.savePayload(loaded.payload);
      }
      return loaded.payload;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "ENOENT") {
        const emptyPayload = { cases: [] };
        await this.savePayload(emptyPayload);
        return emptyPayload;
      }
      throw error;
    }
  }

  private async savePayload(payload: SupportCaseFilePayload): Promise<void> {
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

function mapSupportCaseRow(row: SupportCaseRow, now: Date): SupportCaseRecord | null {
  return normalizeSupportCaseRecord(
    {
      id: row.id,
      status: row.status,
      userId: row.user_id,
      orgId: row.org_id,
      segmentId: row.segment_id,
      scenarioId: row.scenario_id,
      message: row.message,
      transcriptEncrypted: row.transcript_encrypted,
      transcriptExpiresAt: row.transcript_expires_at,
      transcriptFileName: row.transcript_file_name,
      transcriptMeta: row.transcript_meta,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    now
  );
}

class PostgresSupportCaseStore implements SupportCaseStore {
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

  async initialize(options?: { now?: Date }): Promise<void> {
    await this.ensureTable();
    await this.purgeExpiredTranscripts(options?.now ?? new Date());
  }

  async importLegacyCases(
    records: SupportCaseRecord[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number }> {
    const now = options?.now ?? new Date();
    const normalizedLegacy = dedupeSupportCases(
      records
        .map((entry) => normalizeSupportCaseRecord(entry, now))
        .filter((entry): entry is SupportCaseRecord => entry !== null)
    );
    if (normalizedLegacy.length === 0) {
      return { importedCount: 0 };
    }

    await this.ensureTable();
    const existingIds = new Set<string>();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        "SELECT id FROM support_cases WHERE id = ANY($1::text[])",
        [normalizedLegacy.map((entry) => entry.id)]
      );
      for (const row of result.rows) {
        existingIds.add(row.id);
      }

      for (const record of normalizedLegacy) {
        await this.upsertCase(client, record);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.purgeExpiredTranscripts(now);
    return {
      importedCount: normalizedLegacy.filter((entry) => !existingIds.has(entry.id)).length
    };
  }

  async saveCase(record: SupportCaseRecord, options?: { now?: Date }): Promise<void> {
    const normalizedRecord = normalizeSupportCaseRecord(record, options?.now ?? new Date());
    if (!normalizedRecord) {
      throw new Error("Support case record is invalid.");
    }

    await this.ensureTable();
    await this.upsertCase(this.pool, normalizedRecord);
  }

  async listCases(options?: { now?: Date }): Promise<SupportCaseRecord[]> {
    const now = options?.now ?? new Date();
    await this.ensureTable();
    await this.purgeExpiredTranscripts(now);
    const result = await this.pool.query<SupportCaseRow>(
      `
        SELECT
          id,
          status,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          message,
          transcript_encrypted,
          transcript_expires_at,
          transcript_file_name,
          transcript_meta,
          created_at,
          updated_at
        FROM support_cases
        ORDER BY created_at DESC, id DESC
      `
    );
    return result.rows
      .map((row) => mapSupportCaseRow(row, now))
      .filter((entry): entry is SupportCaseRecord => entry !== null);
  }

  async getCaseById(caseId: string, options?: { now?: Date }): Promise<SupportCaseRecord | null> {
    const normalizedCaseId = caseId.trim();
    if (!normalizedCaseId) {
      return null;
    }

    const now = options?.now ?? new Date();
    await this.ensureTable();
    await this.purgeExpiredTranscripts(now);
    const result = await this.pool.query<SupportCaseRow>(
      `
        SELECT
          id,
          status,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          message,
          transcript_encrypted,
          transcript_expires_at,
          transcript_file_name,
          transcript_meta,
          created_at,
          updated_at
        FROM support_cases
        WHERE id = $1
        LIMIT 1
      `,
      [normalizedCaseId]
    );
    if (result.rows.length === 0) {
      return null;
    }

    return mapSupportCaseRow(result.rows[0], now);
  }

  async deleteCasesForUser(userId: string): Promise<number> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return 0;
    }

    await this.ensureTable();
    const result = await this.pool.query<{ id: string }>(
      "DELETE FROM support_cases WHERE user_id = $1 RETURNING id",
      [normalizedUserId]
    );
    return result.rowCount ?? result.rows.length;
  }

  private async ensureTable(): Promise<void> {
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = this.pool
        .query(
          `
            CREATE TABLE IF NOT EXISTS support_cases (
              id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              user_id TEXT NOT NULL,
              org_id TEXT NULL,
              segment_id TEXT NULL,
              scenario_id TEXT NULL,
              message TEXT NOT NULL,
              transcript_encrypted TEXT NULL,
              transcript_expires_at TIMESTAMPTZ NULL,
              transcript_file_name TEXT NULL,
              transcript_meta JSONB NULL,
              created_at TIMESTAMPTZ NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_support_cases_created_at ON support_cases (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_support_cases_user_id ON support_cases (user_id);
            CREATE INDEX IF NOT EXISTS idx_support_cases_org_id ON support_cases (org_id);
          `
        )
        .then(() => undefined);
    }

    await this.ensureTablePromise;
  }

  private async purgeExpiredTranscripts(now: Date): Promise<void> {
    await this.pool.query(
      `
        UPDATE support_cases
        SET
          transcript_encrypted = NULL,
          transcript_expires_at = NULL,
          transcript_file_name = NULL
        WHERE transcript_encrypted IS NOT NULL
          AND transcript_expires_at IS NOT NULL
          AND transcript_expires_at <= $1
      `,
      [now.toISOString()]
    );
  }

  private async upsertCase(client: Pool | PoolClient, record: SupportCaseRecord): Promise<void> {
    await client.query(
      `
        INSERT INTO support_cases (
          id,
          status,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          message,
          transcript_encrypted,
          transcript_expires_at,
          transcript_file_name,
          transcript_meta,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13
        )
        ON CONFLICT (id) DO UPDATE
          SET
            status = EXCLUDED.status,
            user_id = EXCLUDED.user_id,
            org_id = EXCLUDED.org_id,
            segment_id = EXCLUDED.segment_id,
            scenario_id = EXCLUDED.scenario_id,
            message = EXCLUDED.message,
            transcript_encrypted = EXCLUDED.transcript_encrypted,
            transcript_expires_at = EXCLUDED.transcript_expires_at,
            transcript_file_name = EXCLUDED.transcript_file_name,
            transcript_meta = EXCLUDED.transcript_meta,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
      `,
      [
        record.id,
        record.status,
        record.userId,
        record.orgId,
        record.segmentId,
        record.scenarioId,
        record.message,
        record.transcriptEncrypted,
        record.transcriptExpiresAt,
        record.transcriptFileName,
        record.transcriptMeta ? JSON.stringify(record.transcriptMeta) : null,
        record.createdAt,
        record.updatedAt
      ]
    );
  }
}

class UnsupportedSupportCaseStore implements SupportCaseStore {
  async initialize(): Promise<void> {
    throw new Error("Support case storage provider is not supported.");
  }

  async importLegacyCases(): Promise<{ importedCount: number }> {
    throw new Error("Support case storage provider is not supported.");
  }

  async saveCase(): Promise<void> {
    throw new Error("Support case storage provider is not supported.");
  }

  async listCases(): Promise<SupportCaseRecord[]> {
    throw new Error("Support case storage provider is not supported.");
  }

  async getCaseById(): Promise<SupportCaseRecord | null> {
    throw new Error("Support case storage provider is not supported.");
  }

  async deleteCasesForUser(): Promise<number> {
    throw new Error("Support case storage provider is not supported.");
  }
}

export function createSupportCaseStore(params: CreateSupportCaseStoreParams): SupportCaseStore {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresSupportCaseStore(params.databaseUrl, {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs
    });
  }

  if (params.provider === "file") {
    return new FileSupportCaseStore(params.dbPath);
  }

  return new UnsupportedSupportCaseStore();
}
