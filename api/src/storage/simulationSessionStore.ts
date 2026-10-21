import path from "node:path";
import { promises as fs } from "node:fs";
import { Pool } from "pg";

import { SimulationSessionRecord, UsageSessionRecord } from "@voicepractice/shared";

import { applyConfirmedActivity, type ConfirmedActivityParams } from "../services/simulationActivity.js";
import { mapUsageSessionRow } from "./usageSessionStore.js";
import { StorageProvider } from "../runtimeConfig.js";
import { parseSimulationSessionIndustrySnapshot } from "../services/simulationSessionIndustrySnapshot.js";

export class SimulationSessionConflictError extends Error {}

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

export interface SimulationSessionIndustrySelectionLockParams {
  simulationSessionId: string;
  industryId: string;
  lockedAt: string;
}

export interface SessionUsageSettlement {
  simulationSessionId: string;
  userId: string;
  orgId: string | null;
  source: "client_completed" | "server_abandoned";
  now: Date;
  notBefore?: Date;
  buildRecord(session: SimulationSessionRecord): UsageSessionRecord | null;
  appendFile(record: UsageSessionRecord): Promise<{ created: boolean; record: UsageSessionRecord }>;
}
export interface AccountableSessionQuery {
  userId?: string;
  orgId?: string | null;
  expiredBefore?: Date;
  limit?: number;
}

export interface SimulationSessionStore {
  recordConfirmedActivity(params: ConfirmedActivityParams): Promise<void>;
  listAccountableSessions(query: AccountableSessionQuery): Promise<SimulationSessionRecord[]>;
  settleUsage(params: SessionUsageSettlement): Promise<{ created: boolean; record: UsageSessionRecord } | null>;
  initialize(): Promise<void>;
  getById(simulationSessionId: string): Promise<SimulationSessionRecord | null>;
  listSessions(): Promise<SimulationSessionRecord[]>;
  upsertStartedSession(record: SimulationSessionRecord): Promise<SimulationSessionRecord>;
  lockIndustrySelection(params: SimulationSessionIndustrySelectionLockParams): Promise<SimulationSessionRecord | null>;
  touchSession(params: SimulationSessionTouchParams): Promise<SimulationSessionRecord | null>;
  markUsageRecorded(params: SimulationSessionFinalizeParams): Promise<SimulationSessionRecord | null>;
  pruneStartedSessionsLastSeenBefore(cutoff: Date): Promise<number>;
  deleteSessionsForUser(userId: string): Promise<number>;
  deidentifySessionsForUser(userId: string, replacementUserId: string): Promise<number>;
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
  division_id: string | null;
  segment_id: string;
  scenario_id: string;
  scenario_version_id: string | null;
  industry_snapshot: unknown;
  training_id: string | null;
  origin_topic_id?: string | null;
  training_pack_id: string | null;
  client_started_at: string | Date | null;
  server_started_at: string | Date;
  last_seen_at: string | Date;
  status: string;
  usage_recorded_at: string | Date | null;
  usage_session_record_id: string | null;
  confirmed_activity: SimulationSessionRecord["confirmedActivity"];
  usage_source: SimulationSessionRecord["usageSource"];
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
    divisionId: normalizeNullableString((candidate as { divisionId?: unknown }).divisionId) ?? undefined,
    segmentId,
    scenarioId,
    scenarioVersionId: normalizeNullableString((candidate as { scenarioVersionId?: unknown }).scenarioVersionId) ?? undefined,
    industrySnapshot: (() => {
      const raw = (candidate as { industrySnapshot?: unknown }).industrySnapshot;
      // NULL/missing is a legitimate legacy session. Undefined after this
      // branch is reserved for a non-null malformed/unsupported snapshot.
      if (raw === undefined || raw === null) return null;
      return parseSimulationSessionIndustrySnapshot(raw) ?? undefined;
    })(),
    originTopicId: normalizeNullableString((candidate as SimulationSessionRecord).originTopicId) ?? undefined,
    trainingId: normalizeNullableString((candidate as { trainingId?: unknown }).trainingId) ?? undefined,
    trainingPackId: normalizeNullableString((candidate as { trainingPackId?: unknown }).trainingPackId) ?? undefined,
    clientStartedAt: normalizeIsoString((candidate as { clientStartedAt?: unknown }).clientStartedAt) ?? undefined,
    serverStartedAt,
    lastSeenAt,
    status,
    confirmedActivity: (candidate as SimulationSessionRecord).confirmedActivity ?? null,
    usageSource: (candidate as SimulationSessionRecord).usageSource ?? null,
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
    divisionId: row.division_id,
    segmentId: row.segment_id,
    scenarioId: row.scenario_id,
    scenarioVersionId: row.scenario_version_id,
    industrySnapshot: row.industry_snapshot,
    trainingId: row.training_id,
    originTopicId: row.origin_topic_id,
    trainingPackId: row.training_pack_id,
    clientStartedAt: row.client_started_at,
    serverStartedAt: row.server_started_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
    usageRecordedAt: row.usage_recorded_at,
    confirmedActivity: row.confirmed_activity,
    usageSource: row.usage_source,
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
    (existing.scenarioVersionId ?? null) !== (incoming.scenarioVersionId ?? null) ||
    existingTrainingId !== incomingTrainingId ||
    (incoming.originTopicId != null && (existing.originTopicId ?? null) !== incoming.originTopicId)
  ) {
    throw new SimulationSessionConflictError("Simulation session identity does not match the previously recognized session.");
  }

  const existingTrainingPackId = existing.trainingPackId ?? null;
  const incomingTrainingPackId = incoming.trainingPackId ?? null;
  if (existingTrainingPackId && incomingTrainingPackId && existingTrainingPackId !== incomingTrainingPackId) {
    throw new SimulationSessionConflictError("Simulation session training-pack context does not match the previously recognized session.");
  }
}

function mergeStartedSession(existing: SimulationSessionRecord, incoming: SimulationSessionRecord): SimulationSessionRecord {
  assertSessionIdentityCompatibility(existing, incoming);

  return {
    ...existing,
    industrySnapshot: existing.industrySnapshot,
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
    throw new SimulationSessionConflictError("Simulation session was already finalized with a different usage record.");
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
  abstract recordConfirmedActivity(params: ConfirmedActivityParams): Promise<void>;
  abstract settleUsage(params: SessionUsageSettlement): Promise<{ created: boolean; record: UsageSessionRecord } | null>;
  async listAccountableSessions(query: AccountableSessionQuery): Promise<SimulationSessionRecord[]> {
    return (await this.listSessions()).filter(s => s.status === "started" && s.confirmedActivity
      && (!query.userId || s.userId === query.userId)
      && (query.orgId === undefined || s.orgId === query.orgId)
      && (!query.expiredBefore || Date.parse(s.confirmedActivity.settleAfter) <= query.expiredBefore.getTime()))
      .slice(0, query.limit ?? Infinity);
  }
  abstract initialize(): Promise<void>;
  abstract getById(simulationSessionId: string): Promise<SimulationSessionRecord | null>;
  abstract listSessions(): Promise<SimulationSessionRecord[]>;
  abstract upsertStartedSession(record: SimulationSessionRecord): Promise<SimulationSessionRecord>;
  abstract lockIndustrySelection(params: SimulationSessionIndustrySelectionLockParams): Promise<SimulationSessionRecord | null>;
  abstract touchSession(params: SimulationSessionTouchParams): Promise<SimulationSessionRecord | null>;
  abstract markUsageRecorded(params: SimulationSessionFinalizeParams): Promise<SimulationSessionRecord | null>;
  abstract pruneStartedSessionsLastSeenBefore(cutoff: Date): Promise<number>;
  abstract deleteSessionsForUser(userId: string): Promise<number>;
  abstract deidentifySessionsForUser(userId: string, replacementUserId: string): Promise<number>;
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
      throw new SimulationSessionConflictError("Simulation session is invalid.");
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

  async recordConfirmedActivity(params: ConfirmedActivityParams): Promise<void> {
    await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const record = payload.records.find(s => s.simulationSessionId === params.simulationSessionId);
      if (!record) return;
      const next = applyConfirmedActivity(record, params);
      if (next === record) return;
      await this.savePayload({ records: payload.records.map(s => s === record ? next : s) });
    });
  }

  async settleUsage(p: SessionUsageSettlement): Promise<{ created: boolean; record: UsageSessionRecord } | null> {
    return this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const session = payload.records.find(s => s.simulationSessionId === p.simulationSessionId);
      if (!session || session.userId !== p.userId || session.orgId !== p.orgId) return null;
      if (session.status === "started" && session.confirmedActivity && p.notBefore && p.now < p.notBefore) {
        const confirmedActivity = { ...session.confirmedActivity, settleAfter: p.notBefore.toISOString() };
        await this.savePayload({ records: payload.records.map(s => s === session ? { ...s, confirmedActivity } : s) });
        return null;
      }
      const record = p.buildRecord(session);
      if (!record) return null;
      // File mode is append-first: deterministic identity heals a crash between
      // the two file replacements on retry. Hosted PostgreSQL is atomic below.
      const result = await p.appendFile({ ...record, usageSource: p.source });
      const next = { ...applyUsageRecorded(session, { simulationSessionId: p.simulationSessionId,
        usageRecordedAt: p.now.toISOString(), usageSessionRecordId: result.record.id,
        lastSeenAt: p.source === "client_completed" ? p.now.toISOString() : session.lastSeenAt }),
        usageSource: session.usageSource ?? result.record.usageSource ?? (result.created ? p.source : "client_completed") };
      await this.savePayload({ records: payload.records.map(s => s === session ? next : s) });
      return result;
    });
  }

  async lockIndustrySelection(params: SimulationSessionIndustrySelectionLockParams): Promise<SimulationSessionRecord | null> {
    const normalizedId = normalizeNullableString(params.simulationSessionId);
    const industryId = normalizeNullableString(params.industryId);
    const lockedAt = normalizeIsoString(params.lockedAt);
    if (!normalizedId || !industryId || !lockedAt) return null;
    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const existing = payload.records.find((entry) => entry.simulationSessionId === normalizedId) ?? null;
      const snapshot = existing?.industrySnapshot ? parseSimulationSessionIndustrySnapshot(existing.industrySnapshot) : null;
      if (!existing || !snapshot || snapshot.selection.industryId) return existing;
      if (!snapshot.eligibleIndustries.some((industry) => industry.id === industryId)) return existing;
      const nextRecord: SimulationSessionRecord = {
        ...existing,
        industrySnapshot: {
          ...snapshot,
          selection: { industryId, lockedAt },
        },
      };
      await this.savePayload({ records: payload.records.map((entry) => (
        entry.simulationSessionId === normalizedId ? nextRecord : entry
      )) });
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

  async deidentifySessionsForUser(userId: string, replacementUserId: string): Promise<number> {
    const normalizedUserId = normalizeNullableString(userId);
    const normalizedReplacementUserId = normalizeNullableString(replacementUserId);
    if (!normalizedUserId || !normalizedReplacementUserId || normalizedUserId === normalizedReplacementUserId) {
      return 0;
    }

    return await this.withLock(async () => {
      await this.ensureInitialized();
      const payload = await this.loadPayload();
      const matchedCount = payload.records.filter((entry) => entry.userId === normalizedUserId).length;
      if (matchedCount > 0) {
        await this.savePayload({
          records: payload.records.map((entry) => (
            entry.userId === normalizedUserId ? { ...entry, userId: normalizedReplacementUserId } : entry
          ))
        });
      }
      return matchedCount;
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
          division_id,
          segment_id,
          scenario_id,
          scenario_version_id,
          industry_snapshot,
          training_id, origin_topic_id,
          training_pack_id,
          client_started_at,
          server_started_at,
          last_seen_at,
          status,
          usage_recorded_at,
          usage_session_record_id, confirmed_activity, usage_source
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
          division_id,
          segment_id,
          scenario_id,
          scenario_version_id,
          industry_snapshot,
          training_id, origin_topic_id,
          training_pack_id,
          client_started_at,
          server_started_at,
          last_seen_at,
          status,
          usage_recorded_at,
          usage_session_record_id, confirmed_activity, usage_source
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
      throw new SimulationSessionConflictError("Simulation session is invalid.");
    }

    await this.ensureTable();
    const existing = await this.getById(normalized.simulationSessionId);
    const nextRecord = existing ? mergeStartedSession(existing, normalized) : normalized;
    const written = await this.pool.query(
      `
        INSERT INTO simulation_sessions (
          simulation_session_id,
          user_id,
          org_id,
          division_id,
          segment_id,
          scenario_id,
          scenario_version_id,
          industry_snapshot,
          training_id,
          training_pack_id,
          client_started_at,
          server_started_at,
          last_seen_at,
          status,
          usage_recorded_at,
          usage_session_record_id, origin_topic_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9,
          $10, $11::timestamptz, $12::timestamptz, $13::timestamptz, $14, $15::timestamptz, $16, $17
        )
        ON CONFLICT (simulation_session_id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              org_id = EXCLUDED.org_id,
              division_id = EXCLUDED.division_id,
              segment_id = EXCLUDED.segment_id,
              scenario_id = EXCLUDED.scenario_id,
              scenario_version_id = EXCLUDED.scenario_version_id,
              industry_snapshot = simulation_sessions.industry_snapshot,
              training_id = EXCLUDED.training_id,
              training_pack_id = COALESCE(simulation_sessions.training_pack_id, EXCLUDED.training_pack_id),
              client_started_at = COALESCE(simulation_sessions.client_started_at, EXCLUDED.client_started_at),
              server_started_at = LEAST(simulation_sessions.server_started_at, EXCLUDED.server_started_at),
              last_seen_at = GREATEST(simulation_sessions.last_seen_at, EXCLUDED.last_seen_at),
              status = simulation_sessions.status,
              usage_recorded_at = simulation_sessions.usage_recorded_at,
              usage_session_record_id = simulation_sessions.usage_session_record_id
        WHERE EXCLUDED.origin_topic_id IS NULL OR simulation_sessions.origin_topic_id IS NOT DISTINCT FROM EXCLUDED.origin_topic_id
      `,
      [
        nextRecord.simulationSessionId,
        nextRecord.userId,
        nextRecord.orgId ?? null,
        nextRecord.divisionId ?? null,
        nextRecord.segmentId,
        nextRecord.scenarioId,
        nextRecord.scenarioVersionId ?? null,
        nextRecord.industrySnapshot ? JSON.stringify(nextRecord.industrySnapshot) : null,
        nextRecord.trainingId ?? null,
        nextRecord.trainingPackId ?? null,
        nextRecord.clientStartedAt ?? null,
        nextRecord.serverStartedAt,
        nextRecord.lastSeenAt,
        nextRecord.status,
        nextRecord.usageRecordedAt ?? null,
        nextRecord.usageSessionRecordId ?? null,
        nextRecord.originTopicId ?? null
      ]
    );
    if (!written.rowCount) throw new SimulationSessionConflictError("Simulation session Topic origin does not match.");
    return (await this.getById(nextRecord.simulationSessionId)) ?? nextRecord;
  }

  async listAccountableSessions(q: AccountableSessionQuery): Promise<SimulationSessionRecord[]> {
    await this.ensureTable();
    const result = await this.pool.query<SimulationSessionRow>(`
      SELECT * FROM simulation_sessions WHERE status = 'started' AND confirmed_activity IS NOT NULL
        AND ($1::text IS NULL OR user_id = $1)
        AND ($2::boolean = false OR org_id IS NOT DISTINCT FROM $3::text)
        AND ($4::timestamptz IS NULL OR activity_settle_after <= $4)
      ORDER BY activity_settle_after, simulation_session_id LIMIT $5`,
      [q.userId ?? null, q.orgId !== undefined, q.orgId ?? null, q.expiredBefore?.toISOString() ?? null, q.limit ?? null]);
    return result.rows.map(mapSimulationSessionRow).filter((s): s is SimulationSessionRecord => s !== null);
  }

  async recordConfirmedActivity(p: ConfirmedActivityParams): Promise<void> {
    await this.ensureTable();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<SimulationSessionRow>("SELECT * FROM simulation_sessions WHERE simulation_session_id=$1 FOR UPDATE", [p.simulationSessionId]);
      const session = rows.rows[0] && mapSimulationSessionRow(rows.rows[0]);
      if (session) {
        const next = applyConfirmedActivity(session, p);
        if (next !== session) await client.query(`UPDATE simulation_sessions
          SET confirmed_activity=$2::jsonb, activity_settle_after=$3::timestamptz
          WHERE simulation_session_id=$1`, [p.simulationSessionId, JSON.stringify(next.confirmedActivity), next.confirmedActivity!.settleAfter]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async settleUsage(p: SessionUsageSettlement): Promise<{ created: boolean; record: UsageSessionRecord } | null> {
    await this.ensureTable();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<SimulationSessionRow>("SELECT * FROM simulation_sessions WHERE simulation_session_id=$1 FOR UPDATE", [p.simulationSessionId]);
      const session = rows.rows[0] && mapSimulationSessionRow(rows.rows[0]);
      if (!session || session.userId !== p.userId || session.orgId !== p.orgId) { await client.query("COMMIT"); return null; }
      if (session.status === "usage_recorded") {
        const existing = await client.query("SELECT * FROM usage_sessions WHERE id=$1", [session.usageSessionRecordId]);
        if (!existing.rows[0]) throw new SimulationSessionConflictError("Finalized usage record is missing.");
        await client.query("COMMIT");
        return { created: false, record: mapUsageSessionRow(existing.rows[0])! };
      }
      if (session.confirmedActivity && p.notBefore && p.now < p.notBefore) {
        // A later organization maximum can extend the existing runtime deadline.
        // Move this candidate back in the due index rather than starving a batch.
        const confirmedActivity = { ...session.confirmedActivity, settleAfter: p.notBefore.toISOString() };
        await client.query("UPDATE simulation_sessions SET confirmed_activity=$2::jsonb, activity_settle_after=$3 WHERE simulation_session_id=$1",
          [p.simulationSessionId, JSON.stringify(confirmedActivity), p.notBefore.toISOString()]);
        await client.query("COMMIT"); return null;
      }
      const r = p.buildRecord(session);
      if (!r) { await client.query("COMMIT"); return null; }
      const inserted = await client.query(`INSERT INTO usage_sessions
        (id,user_id,org_id,division_id,segment_id,scenario_id,scenario_version_id,training_id,training_pack_id,
         started_at,ended_at,raw_duration_seconds,billed_seconds_added,created_at,usage_source,origin_topic_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING RETURNING *`,
        [r.id,r.userId,r.orgId,r.divisionId ?? null,r.segmentId,r.scenarioId,r.scenarioVersionId ?? null,
         r.trainingId ?? null,r.trainingPackId ?? null,r.startedAt,r.endedAt,r.rawDurationSeconds,r.billedSecondsAdded ?? null,r.createdAt,p.source,r.originTopicId ?? null]);
      const existing = inserted.rows[0] ?? (await client.query("SELECT * FROM usage_sessions WHERE id=$1", [r.id])).rows[0];
      const record = mapUsageSessionRow(existing)!;
      if (record.userId !== session.userId || record.orgId !== session.orgId) throw new SimulationSessionConflictError("Usage ownership mismatch.");
      await client.query(`UPDATE simulation_sessions SET status='usage_recorded', usage_recorded_at=$2,
        usage_session_record_id=$3, usage_source=COALESCE(usage_source,$4),
        last_seen_at=CASE WHEN $4='client_completed' THEN GREATEST(last_seen_at,$2::timestamptz) ELSE last_seen_at END
        WHERE simulation_session_id=$1`,
        [p.simulationSessionId,p.now.toISOString(),record.id,record.usageSource ?? (inserted.rows.length ? p.source : "client_completed")]);
      await client.query("COMMIT");
      return { created: inserted.rows.length > 0, record };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async lockIndustrySelection(params: SimulationSessionIndustrySelectionLockParams): Promise<SimulationSessionRecord | null> {
    const simulationSessionId = normalizeNullableString(params.simulationSessionId);
    const industryId = normalizeNullableString(params.industryId);
    const lockedAt = normalizeIsoString(params.lockedAt);
    if (!simulationSessionId || !industryId || !lockedAt) return null;
    await this.ensureTable();
    await this.pool.query(
      `
        UPDATE simulation_sessions
        SET industry_snapshot = jsonb_set(
          jsonb_set(industry_snapshot, '{selection,industryId}', to_jsonb($2::text), true),
          '{selection,lockedAt}', to_jsonb($3::text), true
        )
        WHERE simulation_session_id = $1
          AND industry_snapshot IS NOT NULL
          AND industry_snapshot #>> '{selection,industryId}' IS NULL
          AND industry_snapshot #>> '{selection,lockedAt}' IS NULL
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(industry_snapshot->'eligibleIndustries') AS industry
            WHERE industry->>'id' = $2
          )
      `,
      [simulationSessionId, industryId, lockedAt],
    );
    return await this.getById(simulationSessionId);
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

  async deidentifySessionsForUser(userId: string, replacementUserId: string): Promise<number> {
    const normalizedUserId = normalizeNullableString(userId);
    const normalizedReplacementUserId = normalizeNullableString(replacementUserId);
    if (!normalizedUserId || !normalizedReplacementUserId || normalizedUserId === normalizedReplacementUserId) {
      return 0;
    }

    await this.ensureTable();
    const result = await this.pool.query<{ simulation_session_id: string }>(
      "UPDATE simulation_sessions SET user_id = $2 WHERE user_id = $1 RETURNING simulation_session_id",
      [normalizedUserId, normalizedReplacementUserId]
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
              division_id TEXT NULL,
              segment_id TEXT NOT NULL,
              scenario_id TEXT NOT NULL,
              scenario_version_id TEXT NULL,
              industry_snapshot JSONB NULL,
              training_id TEXT NULL,
              training_pack_id TEXT NULL,
              client_started_at TIMESTAMPTZ NULL,
              server_started_at TIMESTAMPTZ NOT NULL,
              last_seen_at TIMESTAMPTZ NOT NULL,
              status TEXT NOT NULL,
              usage_recorded_at TIMESTAMPTZ NULL,
              usage_session_record_id TEXT NULL
            );

            ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS confirmed_activity JSONB NULL;
            ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS activity_settle_after TIMESTAMPTZ NULL;
            ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS usage_source TEXT NULL;
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_activity_due
              ON simulation_sessions (activity_settle_after) WHERE status='started' AND confirmed_activity IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_activity_org
              ON simulation_sessions (org_id, user_id) WHERE status='started' AND confirmed_activity IS NOT NULL;
            ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS division_id TEXT NULL;
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_user_id ON simulation_sessions (user_id);
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_org_id ON simulation_sessions (org_id);
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_scenario_id ON simulation_sessions (scenario_id);
            ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS scenario_version_id TEXT NULL;
            ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS origin_topic_id TEXT NULL;
            ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS industry_snapshot JSONB NULL;
            CREATE INDEX IF NOT EXISTS idx_simulation_sessions_scenario_version_id
              ON simulation_sessions (scenario_version_id) WHERE scenario_version_id IS NOT NULL;
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
  async recordConfirmedActivity(): Promise<void> { throw new Error("Simulation session storage provider is not supported."); }
  async settleUsage(): Promise<null> { throw new Error("Simulation session storage provider is not supported."); }
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

  async lockIndustrySelection(): Promise<SimulationSessionRecord | null> {
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

  async deidentifySessionsForUser(): Promise<number> {
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
