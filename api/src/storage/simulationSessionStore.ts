import path from "node:path";
import { promises as fs } from "node:fs";
import { Pool } from "pg";

import { SimulationSessionRecord } from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

export interface SimulationSessionTouchParams {
  simulationSessionId: string;
  lastSeenAt: string;
  trainingPackId?: string | null;
}

export interface SimulationSessionFinalizeParams {
  simulationSessionId: string;
  usageRecordedAt: string;
  usageSessionRecordId: string;
  lastSeenAt: string;
}

export interface SimulationSessionStore {
  initialize(): Promise<void>;
  getById(simulationSessionId: string): Promise<SimulationSessionRecord | null>;
  listSessions(): Promise<SimulationSessionRecord[]>;
  upsertStartedSession(record: SimulationSessionRecord): Promise<SimulationSessionRecord>;
  touchSession(params: SimulationSessionTouchParams): Promise<SimulationSessionRecord | null>;
  markUsageRecorded(params: SimulationSessionFinalizeParams): Promise<SimulationSessionRecord | null>;
  pruneStartedSessionsLastSeenBefore(cutoff: Date): Promise<number>;
  deleteSessionsForUser(userId: string): Promise<number>;
}

interface CreateSimulationSessionStoreParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface SimulationSessionFilePayload {
  records: SimulationSessionRecord[];
}

interface SimulationSessionRow {
  simulation_session_id: string;
  user_id: string;
  org_id: string | null;
  segment_id: string;
  scenario_id: string;
  training_id: string | null;
  training_pack_id: string | null;
  client_started_at: string | Date | null;
  server_started_at: string | Date;
  last_seen_at: string | Date;
  status: string;
  usage_recorded_at: string | Date | null;
  usage_session_record_id: string | null;
}

function buildSimulationSessionFilePath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.simulation-sessions${extension}`);
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
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return null;
}

function normalizeSimulationSessionStatus(value: unknown): SimulationSessionRecord["status"] | null {
  return value === "started" || value === "usage_recorded" ? value : null;
}

function normalizeSimulationSessionRecord(candidate: unknown): SimulationSessionRecord | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const simulationSessionId = normalizeNullableString(
    (candidate as { simulationSessionId?: unknown }).simulationSessionId
  );
  const userId = normalizeNullableString((candidate as { userId?: unknown }).userId);
  const segmentId = normalizeNullableString((candidate as { segmentId?: unknown }).segmentId);
  const scenarioId = normalizeNullableString((candidate as { scenarioId?: unknown }).scenarioId);
  const serverStartedAt = normalizeIsoString((candidate as { serverStartedAt?: unknown }).serverStartedAt);
  const lastSeenAt = normalizeIsoString((candidate as { lastSeenAt?: unknown }).lastSeenAt);
  const status = normalizeSimulationSessionStatus((candidate as { status?: unknown }).status);

  if (!simulationSessionId || !userId || !segmentId || !scenarioId || !serverStartedAt || !lastSeenAt || !status) {
    return null;
  }

  return {
    simulationSessionId,
    userId,
    orgId: normalizeNullableString((candidate as { orgId?: unknown }).orgId),
    segmentId,
    scenarioId,
    trainingId: normalizeNullableString((candidate as { trainingId?: unknown }).trainingId) ?? undefined,
    trainingPackId: normalizeNullableString((candidate as { trainingPackId?: unknown }).trainingPackId) ?? undefined,
    clientStartedAt: normalizeIsoString((candidate as { clientStartedAt?: unknown }).clientStartedAt) ?? undefined,
    serverStartedAt,
    lastSeenAt,
    status,
    usageRecordedAt: normalizeIsoString((candidate as { usageRecordedAt?: unknown }).usageRecordedAt) ?? undefined,
    usageSessionRecordId: normalizeNullableString(
      (candidate as { usageSessionRecordId?: unknown }).usageSessionRecordId
    ) ?? undefined
  };
}

function mapSimulationSessionRow(row: SimulationSessionRow): SimulationSessionRecord | null {
  return normalizeSimulationSessionRecord({
    simulationSessionId: row.simulation_session_id,
    userId: row.user_id,
    orgId: row.org_id,
    segmentId: row.segment_id,
    scenarioId: row.scenario_id,
    trainingId: row.training_id,
    trainingPackId: row.training_pack_id,
    clientStartedAt: row.client_started_at,
    serverStartedAt: row.server_started_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
    usageRecordedAt: row.usage_recorded_at,
    usageSessionRecordId: row.usage_session_record_id
  });
}

function compareIsoDescending(left: string | null | undefined, right: string | null | undefined): string | undefined {
  if (!left) {
    return right ?? undefined;
  }
  if (!right) {
    return left ?? undefined;
  }
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function compareIsoAscending(left: string | null | undefined, right: string | null | undefined): string | undefined {
  if (!left) {
    return right ?? undefined;
  }
  if (!right) {
    return left ?? undefined;
  }
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function assertSessionIdentityCompatibility(existing: SimulationSessionRecord, incoming: SimulationSessionRecord): void {
  const existingTrainingId = existing.trainingId ?? null;
  const incomingTrainingId = incoming.trainingId ?? null;
  if (
    existing.userId !== incoming.userId ||
    existing.orgId !== incoming.orgId ||
    existing.segmentId !== incoming.segmentId ||
    existing.scenarioId !== incoming.scenarioId ||
    existingTrainingId !== incomingTrainingId
  ) {
    throw new Error("Simulation session identity does not match the previously recognized session.");
  }

  const existingTrainingPackId = existing.trainingPackId ?? null;
  const incomingTrainingPackId = incoming.trainingPackId ?? null;
  if (existingTrainingPackId && incomingTrainingPackId && existingTrainingPackId !== incomingTrainingPackId) {
    throw new Error("Simulation session training-pack context does not match the previously recognized session.");
  }
}

function mergeStartedSession(existing: SimulationSessionRecord, incoming: SimulationSessionRecord): SimulationSessionRecord {
  assertSessionIdentityCompatibility(existing, incoming);

  return {
    ...existing,
    trainingPackId: existing.trainingPackId ?? incoming.trainingPackId,
    clientStartedAt: compareIsoAscending(existing.clientStartedAt, incoming.clientStartedAt),
    serverStartedAt: compareIsoAscending(existing.serverStartedAt, incoming.serverStartedAt) ?? existing.serverStartedAt,
    lastSeenAt: compareIsoDescending(existing.lastSeenAt, incoming.lastSeenAt) ?? existing.lastSeenAt,
    status: existing.status,
    usageRecordedAt: existing.usageRecordedAt,
    usageSessionRecordId: existing.usageSessionRecordId
  };
}

function applyTouch(existing: SimulationSessionRecord, params: SimulationSessionTouchParams): SimulationSessionRecord {
  return {
    ...existing,
    trainingPackId: existing.trainingPackId ?? params.trainingPackId ?? undefined,
    lastSeenAt: compareIsoDescending(existing.lastSeenAt, params.lastSeenAt) ?? existing.lastSeenAt
  };
}

function applyUsageRecorded(
  existing: SimulationSessionRecord,
  params: SimulationSessionFinalizeParams
): SimulationSessionRecord {
  if (
    existing.status === "usage_recorded" &&
    existing.usageSessionRecordId &&
    existing.usageSessionRecordId !== params.usageSessionRecordId
  ) {
    throw new Error("Simulation session was already finalized with a different usage record.");
  }

  return {
    ...existing,
    lastSeenAt: compareIsoDescending(existing.lastSeenAt, params.lastSeenAt) ?? existing.lastSeenAt,
    status: "usage_recorded",
    usageRecordedAt: existing.usageRecordedAt ?? params.usageRecordedAt,
    usageSessionRecordId: existing.usageSessionRecordId ?? params.usageSessionRecordId
  };
}

function normalizeSimulationSessionCollection(records: SimulationSessionRecord[]): SimulationSessionRecord[] {
  const byId = new Map<string, SimulationSessionRecord>();
  for (const record of records) {
    const normalized = normalizeSimulationSessionRecord(record);
    if (!normalized) {
      continue;
    }

    const existing = byId.get(normalized.simulationSessionId);
    if (!existing) {
      byId.set(normalized.simulationSessionId, normalized);
      continue;
    }

    byId.set(normalized.simulationSessionId, mergeStartedSession(existing, normalized));
  }

  return Array.from(byId.values()).sort((left, right) => left.serverStartedAt.localeCompare(right.serverStartedAt));
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

abstract class BaseSimulationSessionStore implements SimulationSessionStore {
  abstract initialize(): Promise<void>;
  abstract getById(simulationSessionId: string): Promise<SimulationSessionRecord | null>;
  abstract listSessions(): Promise<SimulationSessionRecord[]>;
  abstract upsertStartedSession(record: SimulationSessionRecord): Promise<SimulationSessionRecord>;
  abstract touchSession(params: SimulationSessionTouchParams): Promise<SimulationSessionRecord | null>;
  abstract markUsageRecorded(params: SimulationSessionFinalizeParams): Promise<SimulationSessionRecord | null>;
  abstract pruneStartedSessionsLastSeenBefore(cutoff: Date): Promise<number>;
  abstract deleteSessionsForUser(userId: string): Promise<number>;
}

class FileSimulationSessionStore extends BaseSimulationSessionStore {
  private readonly filePath: string;
  private initialized = false;
  private operationQueue = Promise.resolve();

  constructor(dbPath: string) {
    super();
    this.filePath = buildSimulationSessionFilePath(dbPath);
  }

  async initialize(): Promise<void> {
    await this.withLock(async () => {
      if (this.initialized) {
        return;
      }
      await this.loadPayload();
      this.initialized = true;
    });
  }

  async getById(simulationSessionId: string): Promise<SimulationSessionRecord | null> {
    const normalizedId = normalizeNullableString(simulationSessionId);
    if (!normalizedId) {
      return null;
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      return payload.records.find((record) => record.simulationSessionId === normalizedId) ?? null;
    });
  }

  async listSessions(): Promise<SimulationSessionRecord[]> {
    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      return payload.records.slice();
    });
  }

  async upsertStartedSession(record: SimulationSessionRecord): Promise<SimulationSessionRecord> {
    const normalized = normalizeSimulationSessionRecord(record);
    if (!normalized) {
      throw new Error("Simulation session is invalid.");
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const existing = payload.records.find((entry) => entry.simulationSessionId === normalized.simulationSessionId) ?? null;
      const nextRecord = existing ? mergeStartedSession(existing, normalized) : normalized;
      const nextRecords = payload.records.filter((entry) => entry.simulationSessionId !== normalized.simulationSessionId);
      nextRecords.push(nextRecord);
      await this.savePayload({ records: normalizeSimulationSessionCollection(nextRecords) });
      return nextRecord;
    });
  }

  async touchSession(params: SimulationSessionTouchParams): Promise<SimulationSessionRecord | null> {
    const normalizedId = normalizeNullableString(params.simulationSessionId);
    const normalizedLastSeenAt = normalizeIsoString(params.lastSeenAt);
    if (!normalizedId || !normalizedLastSeenAt) {
      return null;
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const existing = payload.records.find((entry) => entry.simulationSessionId === normalizedId) ?? null;
      if (!existing) {
        return null;
      }

      const nextRecord = applyTouch(existing, {
        ...params,
        simulationSessionId: normalizedId,
        lastSeenAt: normalizedLastSeenAt
      });
      const nextRecords = payload.records.filter((entry) => entry.simulationSessionId !== normalizedId);
      nextRecords.push(nextRecord);
      await this.savePayload({ records: normalizeSimulationSessionCollection(nextRecords) });
      return nextRecord;
    });
  }

  async markUsageRecorded(params: SimulationSessionFinalizeParams): Promise<SimulationSessionRecord | null> {
    const normalizedId = normalizeNullableString(params.simulationSessionId);
    const normalizedUsageRecordedAt = normalizeIsoString(params.usageRecordedAt);
    const normalizedLastSeenAt = normalizeIsoString(params.lastSeenAt);
    const normalizedUsageSessionRecordId = normalizeNullableString(params.usageSessionRecordId);
    if (!normalizedId || !normalizedUsageRecordedAt || !normalizedLastSeenAt || !normalizedUsageSessionRecordId) {
      return null;
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const existing = payload.records.find((entry) => entry.simulationSessionId === normalizedId) ?? null;
      if (!existing) {
        return null;
      }

      const nextRecord = applyUsageRecorded(existing, {
        simulationSessionId: normalizedId,
        usageRecordedAt: normalizedUsageRecordedAt,
        usageSessionRecordId: normalizedUsageSessionRecordId,
        lastSeenAt: normalizedLastSeenAt
      });
      const nextRecords = payload.records.filter((entry) => entry.simulationSessionId !== normalizedId);
      nextRecords.push(nextRecord);
      await this.savePayload({ records: normalizeSimulationSessionCollection(nextRecords) });
      return nextRecord;
    });
  }

  async deleteSessionsForUser(userId: string): Promise<number> {
    const normalizedUserId = normalizeNullableString(userId);
    if (!normalizedUserId) {
      return 0;
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const nextRecords = payload.records.filter((entry) => entry.userId !== normalizedUserId);
      const deletedCount = payload.records.length - nextRecords.length;
      if (deletedCount > 0) {
        await this.savePayload({ records: nextRecords });
      }
      return deletedCount;
    });
  }

  async pruneStartedSessionsLastSeenBefore(cutoff: Date): Promise<number> {
    const cutoffIso = normalizeIsoString(cutoff);
    if (!cutoffIso) {
      return 0;
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const cutoffMs = new Date(cutoffIso).getTime();
      const nextRecords = payload.records.filter((entry) => {
        if (entry.status !== "started") {
          return true;
        }

        const lastSeenAtMs = new Date(entry.lastSeenAt).getTime();
        return !Number.isFinite(lastSeenAtMs) || lastSeenAtMs >= cutoffMs;
      });
      const deletedCount = payload.records.length - nextRecords.length;
      if (deletedCount > 0) {
        await this.savePayload({ records: nextRecords });
      }
      return deletedCount;
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.loadPayload();
    this.initialized = true;
  }

  private async loadPayload(): Promise<SimulationSessionFilePayload> {
    await ensureParentDirectory(this.filePath);

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { records?: unknown };
      const records = Array.isArray(parsed.records)
        ? normalizeSimulationSessionCollection(parsed.records as SimulationSessionRecord[])
        : [];
      const payload = { records };
      if (JSON.stringify(parsed) !== JSON.stringify(payload)) {
        await this.savePayload(payload);
      }
      return payload;
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

  private async savePayload(payload: SimulationSessionFilePayload): Promise<void> {
    await ensureParentDirectory(this.filePath);
    await fs.writeFile(this.filePath, JSON.stringify({ records: normalizeSimulationSessionCollection(payload.records) }, null, 2), "utf8");
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

class PostgresSimulationSessionStore extends BaseSimulationSessionStore {
  private readonly pool: Pool;
  private ensureTablePromise: Promise<void> | null = null;

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
    await this.ensureTable();
  }

  async getById(simulationSessionId: string): Promise<SimulationSessionRecord | null> {
    const normalizedId = normalizeNullableString(simulationSessionId);
    if (!normalizedId) {
      return null;
    }

    await this.ensureTable();
    const result = await this.pool.query<SimulationSessionRow>(
      `
        SELECT
          simulation_session_id,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          training_id,
          training_pack_id,
          client_started_at,
          server_started_at,
          last_seen_at,
          status,
          usage_recorded_at,
          usage_session_record_id
        FROM simulation_sessions
        WHERE simulation_session_id = $1
      `,
      [normalizedId]
    );
    return result.rows[0] ? mapSimulationSessionRow(result.rows[0]) : null;
  }

  async listSessions(): Promise<SimulationSessionRecord[]> {
    await this.ensureTable();
    const result = await this.pool.query<SimulationSessionRow>(
      `
        SELECT
          simulation_session_id,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          training_id,
          training_pack_id,
          client_started_at,
          server_started_at,
          last_seen_at,
          status,
          usage_recorded_at,
          usage_session_record_id
        FROM simulation_sessions
        ORDER BY server_started_at ASC, simulation_session_id ASC
      `
    );
    return result.rows
      .map((row) => mapSimulationSessionRow(row))
      .filter((entry): entry is SimulationSessionRecord => entry !== null);
  }

  async upsertStartedSession(record: SimulationSessionRecord): Promise<SimulationSessionRecord> {
    const normalized = normalizeSimulationSessionRecord(record);
    if (!normalized) {
      throw new Error("Simulation session is invalid.");
    }

    await this.ensureTable();
    const existing = await this.getById(normalized.simulationSessionId);
    const nextRecord = existing ? mergeStartedSession(existing, normalized) : normalized;
    await this.pool.query(
      `
        INSERT INTO simulation_sessions (
          simulation_session_id,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          training_id,
          training_pack_id,
          client_started_at,
          server_started_at,
          last_seen_at,
          status,
          usage_recorded_at,
          usage_session_record_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::timestamptz, $9::timestamptz, $10::timestamptz, $11, $12::timestamptz, $13
        )
        ON CONFLICT (simulation_session_id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              org_id = EXCLUDED.org_id,
              segment_id = EXCLUDED.segment_id,
              scenario_id = EXCLUDED.scenario_id,
              training_id = EXCLUDED.training_id,
              training_pack_id = COALESCE(simulation_sessions.training_pack_id, EXCLUDED.training_pack_id),
              client_started_at = COALESCE(simulation_sessions.client_started_at, EXCLUDED.client_started_at),
              server_started_at = LEAST(simulation_sessions.server_started_at, EXCLUDED.server_started_at),
              last_seen_at = GREATEST(simulation_sessions.last_seen_at, EXCLUDED.last_seen_at),
              status = simulation_sessions.status,
              usage_recorded_at = simulation_sessions.usage_recorded_at,
              usage_session_record_id = simulation_sessions.usage_session_record_id
      `,
      [
        nextRecord.simulationSessionId,
        nextRecord.userId,
        nextRecord.orgId ?? null,
        nextRecord.segmentId,
        nextRecord.scenarioId,
        nextRecord.trainingId ?? null,
        nextRecord.trainingPackId ?? null,
        nextRecord.clientStartedAt ?? null,
        nextRecord.serverStartedAt,
        nextRecord.lastSeenAt,
        nextRecord.status,
        nextRecord.usageRecordedAt ?? null,
        nextRecord.usageSessionRecordId ?? null
      ]
    );
    return (await this.getById(nextRecord.simulationSessionId)) ?? nextRecord;
  }

  async touchSession(params: SimulationSessionTouchParams): Promise<SimulationSessionRecord | null> {
    const existing = await this.getById(params.simulationSessionId);
    if (!existing) {
      return null;
    }

    const nextRecord = applyTouch(existing, params);
    await this.pool.query(
      `
        UPDATE simulation_sessions
        SET training_pack_id = COALESCE(training_pack_id, $2),
            last_seen_at = GREATEST(last_seen_at, $3::timestamptz)
        WHERE simulation_session_id = $1
      `,
      [nextRecord.simulationSessionId, nextRecord.trainingPackId ?? null, nextRecord.lastSeenAt]
    );
    return (await this.getById(nextRecord.simulationSessionId)) ?? nextRecord;
  }

  async markUsageRecorded(params: SimulationSessionFinalizeParams): Promise<SimulationSessionRecord | null> {
    const existing = await this.getById(params.simulationSessionId);
    if (!existing) {
      return null;
    }

    const nextRecord = applyUsageRecorded(existing, params);
    await this.pool.query(
      `
        UPDATE simulation_sessions
        SET last_seen_at = GREATEST(last_seen_at, $2::timestamptz),
            status = $3,
            usage_recorded_at = COALESCE(usage_recorded_at, $4::timestamptz),
            usage_session_record_id = COALESCE(usage_session_record_id, $5)
        WHERE simulation_session_id = $1
      `,
      [
        nextRecord.simulationSessionId,
        nextRecord.lastSeenAt,
        nextRecord.status,
        nextRecord.usageRecordedAt ?? null,
        nextRecord.usageSessionRecordId ?? null
      ]
    );
    return (await this.getById(nextRecord.simulationSessionId)) ?? nextRecord;
  }

  async deleteSessionsForUser(userId: string): Promise<number> {
    const normalizedUserId = normalizeNullableString(userId);
    if (!normalizedUserId) {
      return 0;
    }

    await this.ensureTable();
    const result = await this.pool.query<{ simulation_session_id: string }>(
      "DELETE FROM simulation_sessions WHERE user_id = $1 RETURNING simulation_session_id",
      [normalizedUserId]
    );
    return result.rowCount ?? result.rows.length;
  }

  async pruneStartedSessionsLastSeenBefore(cutoff: Date): Promise<number> {
    const cutoffIso = normalizeIsoString(cutoff);
    if (!cutoffIso) {
      return 0;
    }

    await this.ensureTable();
    const result = await this.pool.query<{ simulation_session_id: string }>(
      `
        DELETE FROM simulation_sessions
        WHERE status = 'started'
          AND last_seen_at < $1::timestamptz
        RETURNING simulation_session_id
      `,
      [cutoffIso]
    );
    return result.rowCount ?? result.rows.length;
  }

  private async ensureTable(): Promise<void> {
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = this.pool
        .query(
          `
            CREATE TABLE IF NOT EXISTS simulation_sessions (
              simulation_session_id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              org_id TEXT NULL,
              segment_id TEXT NOT NULL,
              scenario_id TEXT NOT NULL,
              training_id TEXT NULL,
              training_pack_id TEXT NULL,
              client_started_at TIMESTAMPTZ NULL,
              server_started_at TIMESTAMPTZ NOT NULL,
              last_seen_at TIMESTAMPTZ NOT NULL,
              status TEXT NOT NULL,
              usage_recorded_at TIMESTAMPTZ NULL,
              usage_session_record_id TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_user_id ON simulation_sessions (user_id);
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_org_id ON simulation_sessions (org_id);
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_scenario_id ON simulation_sessions (scenario_id);
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_status ON simulation_sessions (status);
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_last_seen_at ON simulation_sessions (last_seen_at DESC);
          `
        )
        .then(() => undefined);
    }

    await this.ensureTablePromise;
  }
}

class UnsupportedSimulationSessionStore extends BaseSimulationSessionStore {
  async initialize(): Promise<void> {
    throw new Error("Simulation session storage provider is not supported.");
  }

  async getById(): Promise<SimulationSessionRecord | null> {
    throw new Error("Simulation session storage provider is not supported.");
  }

  async listSessions(): Promise<SimulationSessionRecord[]> {
    throw new Error("Simulation session storage provider is not supported.");
  }

  async upsertStartedSession(): Promise<SimulationSessionRecord> {
    throw new Error("Simulation session storage provider is not supported.");
  }

  async touchSession(): Promise<SimulationSessionRecord | null> {
    throw new Error("Simulation session storage provider is not supported.");
  }

  async markUsageRecorded(): Promise<SimulationSessionRecord | null> {
    throw new Error("Simulation session storage provider is not supported.");
  }

  async pruneStartedSessionsLastSeenBefore(): Promise<number> {
    throw new Error("Simulation session storage provider is not supported.");
  }

  async deleteSessionsForUser(): Promise<number> {
    throw new Error("Simulation session storage provider is not supported.");
  }
}

export function createSimulationSessionStore(params: CreateSimulationSessionStoreParams): SimulationSessionStore {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresSimulationSessionStore(params.databaseUrl, {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs
    });
  }

  if (params.provider === "file") {
    return new FileSimulationSessionStore(params.dbPath);
  }

  return new UnsupportedSimulationSessionStore();
}
