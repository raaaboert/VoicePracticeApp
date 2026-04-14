import path from "node:path";
import { promises as fs } from "node:fs";
import { Pool, PoolClient } from "pg";

import {
  SIMULATION_COMPLETION_LEVELS,
  SimulationCompletionLevel,
  SimulationScoreCoachingArtifact,
  SimulationScoreNormalizedThemes,
  SimulationScoreRecord
} from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

// scoreRecords extraction note:
// This store is intentionally snapshot-backed so the existing sync reporting/composition seams can
// preserve current behavior while persistence authority moves out of the monolithic app-state blob.
// STORAGE_PROVIDER=file remains a dev/demo/small-scale mode for this domain; postgres is the
// serious hosted path. Reporting-critical routes should refresh this snapshot before composing
// payloads after out-of-band storage changes.

export interface ScoreRecordQuery {
  userId?: string;
  orgId?: string | null;
  segmentId?: string;
  scenarioId?: string;
  simulationSessionId?: string | null;
  trainingId?: string | null;
  trainingPackId?: string | null;
  industryId?: string | null;
  completionLevel?: SimulationCompletionLevel | null;
  objectiveAchieved?: boolean | null;
  conclusiveOnly?: boolean;
  startedAtFrom?: Date | null;
  startedAtBefore?: Date | null;
  endedAtFrom?: Date | null;
  endedAtBefore?: Date | null;
}

export interface ScoreRecordStore {
  initialize(): Promise<void>;
  refreshSnapshot(): Promise<void>;
  importLegacyRecords(records: SimulationScoreRecord[]): Promise<{ importedCount: number }>;
  appendRecord(record: SimulationScoreRecord): Promise<void>;
  getRecordById(scoreId: string): SimulationScoreRecord | null;
  listRecords(query?: ScoreRecordQuery): SimulationScoreRecord[];
  deleteRecordsForUser(userId: string): Promise<number>;
}

interface CreateScoreRecordStoreParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface ScoreRecordFilePayload {
  records: SimulationScoreRecord[];
}

interface ScoreRecordRow {
  id: string;
  simulation_session_id: string | null;
  user_id: string;
  org_id: string | null;
  segment_id: string;
  scenario_id: string;
  training_id: string | null;
  training_pack_id: string | null;
  industry_id: string | null;
  started_at: string | Date;
  ended_at: string | Date;
  communication_score: number | string | null;
  outcome_score: number | string | null;
  overall_score: number | string;
  completion_level: SimulationCompletionLevel | null;
  objective_achieved: boolean | null;
  persuasion: number | string;
  clarity: number | string;
  empathy: number | string;
  assertiveness: number | string;
  summary: string | null;
  coaching_artifact: SimulationScoreCoachingArtifact | null;
  normalized_coaching_themes: SimulationScoreNormalizedThemes | null;
  rubric_version: string | null;
  model: string | null;
  prompt_version: string | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  total_tokens: number | string | null;
  created_at: string | Date;
}

function buildScoreRecordFilePath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.score-records${extension}`);
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

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | undefined {
  const normalized = normalizeNumber(value);
  if (normalized === null) {
    return undefined;
  }

  return Math.max(0, Math.floor(normalized));
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function normalizeCompletionLevel(value: unknown): SimulationCompletionLevel | undefined {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return undefined;
  }

  return (SIMULATION_COMPLETION_LEVELS as readonly string[]).includes(normalized)
    ? (normalized as SimulationCompletionLevel)
    : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeNullableString(entry))
    .filter((entry): entry is string => entry !== null);
}

function normalizeThemeTag(value: unknown): { id: string; label: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const id = normalizeNullableString((value as { id?: unknown }).id);
  const label = normalizeNullableString((value as { label?: unknown }).label);
  if (!id || !label) {
    return null;
  }

  return { id, label };
}

function normalizeCoachingArtifact(value: unknown): SimulationScoreCoachingArtifact | null {
  if (value == null) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    strengths: normalizeStringArray((value as { strengths?: unknown }).strengths),
    improvementAreas: normalizeStringArray((value as { improvementAreas?: unknown }).improvementAreas),
    coachingPriority: normalizeNullableString((value as { coachingPriority?: unknown }).coachingPriority)
  };
}

function normalizeCoachingThemes(value: unknown): SimulationScoreNormalizedThemes | null {
  if (value == null) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    strengths: Array.isArray((value as { strengths?: unknown }).strengths)
      ? ((value as { strengths: unknown[] }).strengths
          .map((entry) => normalizeThemeTag(entry))
          .filter((entry): entry is { id: string; label: string } => entry !== null))
      : [],
    improvementAreas: Array.isArray((value as { improvementAreas?: unknown }).improvementAreas)
      ? ((value as { improvementAreas: unknown[] }).improvementAreas
          .map((entry) => normalizeThemeTag(entry))
          .filter((entry): entry is { id: string; label: string } => entry !== null))
      : [],
    coachingPriority: normalizeThemeTag((value as { coachingPriority?: unknown }).coachingPriority)
  };
}

function normalizeScoreRecord(candidate: unknown): SimulationScoreRecord | null {
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
  const communicationScore = normalizeNumber((candidate as { communicationScore?: unknown }).communicationScore);
  const outcomeScore = normalizeNumber((candidate as { outcomeScore?: unknown }).outcomeScore);
  const overallScore = normalizeNumber((candidate as { overallScore?: unknown }).overallScore);
  const persuasion = normalizeNumber((candidate as { persuasion?: unknown }).persuasion);
  const clarity = normalizeNumber((candidate as { clarity?: unknown }).clarity);
  const empathy = normalizeNumber((candidate as { empathy?: unknown }).empathy);
  const assertiveness = normalizeNumber((candidate as { assertiveness?: unknown }).assertiveness);

  if (
    !id
    || !userId
    || !segmentId
    || !scenarioId
    || !startedAt
    || !endedAt
    || !createdAt
    || overallScore === null
    || persuasion === null
    || clarity === null
    || empathy === null
    || assertiveness === null
  ) {
    return null;
  }

  return {
    id,
    simulationSessionId:
      normalizeNullableString((candidate as { simulationSessionId?: unknown }).simulationSessionId) ?? undefined,
    userId,
    orgId: normalizeNullableString((candidate as { orgId?: unknown }).orgId),
    segmentId,
    scenarioId,
    trainingId: normalizeNullableString((candidate as { trainingId?: unknown }).trainingId) ?? undefined,
    trainingPackId:
      normalizeNullableString((candidate as { trainingPackId?: unknown }).trainingPackId) ?? undefined,
    industryId: normalizeNullableString((candidate as { industryId?: unknown }).industryId) ?? undefined,
    startedAt,
    endedAt,
    communicationScore: communicationScore ?? undefined,
    outcomeScore: outcomeScore ?? undefined,
    overallScore,
    completionLevel: normalizeCompletionLevel((candidate as { completionLevel?: unknown }).completionLevel),
    objectiveAchieved: normalizeOptionalBoolean((candidate as { objectiveAchieved?: unknown }).objectiveAchieved),
    persuasion,
    clarity,
    empathy,
    assertiveness,
    summary: normalizeNullableString((candidate as { summary?: unknown }).summary) ?? undefined,
    coachingArtifact: normalizeCoachingArtifact(
      (candidate as { coachingArtifact?: unknown }).coachingArtifact
    ),
    normalizedCoachingThemes: normalizeCoachingThemes(
      (candidate as { normalizedCoachingThemes?: unknown }).normalizedCoachingThemes
    ),
    rubricVersion: normalizeNullableString((candidate as { rubricVersion?: unknown }).rubricVersion) ?? undefined,
    model: normalizeNullableString((candidate as { model?: unknown }).model) ?? undefined,
    promptVersion: normalizeNullableString((candidate as { promptVersion?: unknown }).promptVersion) ?? undefined,
    inputTokens: normalizeOptionalNonNegativeInteger((candidate as { inputTokens?: unknown }).inputTokens),
    outputTokens: normalizeOptionalNonNegativeInteger((candidate as { outputTokens?: unknown }).outputTokens),
    totalTokens: normalizeOptionalNonNegativeInteger((candidate as { totalTokens?: unknown }).totalTokens),
    createdAt
  };
}

export function matchesScoreRecordQuery(record: SimulationScoreRecord, query: ScoreRecordQuery): boolean {
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
  if (query.simulationSessionId !== undefined && (record.simulationSessionId ?? null) !== query.simulationSessionId) {
    return false;
  }
  if (query.trainingId !== undefined && (record.trainingId ?? null) !== query.trainingId) {
    return false;
  }
  if (query.trainingPackId !== undefined && (record.trainingPackId ?? null) !== query.trainingPackId) {
    return false;
  }
  if (query.industryId !== undefined && (record.industryId ?? null) !== query.industryId) {
    return false;
  }
  if (query.completionLevel !== undefined && (record.completionLevel ?? null) !== query.completionLevel) {
    return false;
  }
  if (query.objectiveAchieved !== undefined && (record.objectiveAchieved ?? null) !== query.objectiveAchieved) {
    return false;
  }
  if (query.conclusiveOnly === true && record.completionLevel && record.completionLevel !== "complete") {
    return false;
  }

  if (query.startedAtFrom || query.startedAtBefore) {
    const startedAtMs = new Date(record.startedAt).getTime();
    if (Number.isNaN(startedAtMs)) {
      return false;
    }
    if (query.startedAtFrom && startedAtMs < query.startedAtFrom.getTime()) {
      return false;
    }
    if (query.startedAtBefore && startedAtMs >= query.startedAtBefore.getTime()) {
      return false;
    }
  }

  if (query.endedAtFrom || query.endedAtBefore) {
    const endedAtMs = new Date(record.endedAt).getTime();
    if (Number.isNaN(endedAtMs)) {
      return false;
    }
    if (query.endedAtFrom && endedAtMs < query.endedAtFrom.getTime()) {
      return false;
    }
    if (query.endedAtBefore && endedAtMs >= query.endedAtBefore.getTime()) {
      return false;
    }
  }

  return true;
}

export function compareScoreRecordsAscending(left: SimulationScoreRecord, right: SimulationScoreRecord): number {
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

function normalizeScoreRecordCollection(records: SimulationScoreRecord[]): SimulationScoreRecord[] {
  const deduped = new Map<string, SimulationScoreRecord>();
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

  return Array.from(deduped.values()).sort(compareScoreRecordsAscending);
}

function ensureFilePayload(candidate: unknown): { payload: ScoreRecordFilePayload; changed: boolean } {
  const normalizedRecords = Array.isArray((candidate as { records?: unknown } | null)?.records)
    ? ((candidate as { records?: unknown[] }).records ?? [])
        .map((entry) => normalizeScoreRecord(entry))
        .filter((entry): entry is SimulationScoreRecord => entry !== null)
    : [];

  const records = normalizeScoreRecordCollection(normalizedRecords);
  return {
    payload: { records },
    changed: records.length !== normalizedRecords.length
      || records.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(normalizedRecords[index]))
  };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function mapScoreRecordRow(row: ScoreRecordRow): SimulationScoreRecord | null {
  return normalizeScoreRecord({
    id: row.id,
    simulationSessionId: row.simulation_session_id,
    userId: row.user_id,
    orgId: row.org_id,
    segmentId: row.segment_id,
    scenarioId: row.scenario_id,
    trainingId: row.training_id,
    trainingPackId: row.training_pack_id,
    industryId: row.industry_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    communicationScore: row.communication_score,
    outcomeScore: row.outcome_score,
    overallScore: row.overall_score,
    completionLevel: row.completion_level,
    objectiveAchieved: row.objective_achieved,
    persuasion: row.persuasion,
    clarity: row.clarity,
    empathy: row.empathy,
    assertiveness: row.assertiveness,
    summary: row.summary,
    coachingArtifact: row.coaching_artifact,
    normalizedCoachingThemes: row.normalized_coaching_themes,
    rubricVersion: row.rubric_version,
    model: row.model,
    promptVersion: row.prompt_version,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    createdAt: row.created_at
  });
}

abstract class BaseScoreRecordStore implements ScoreRecordStore {
  protected records: SimulationScoreRecord[] = [];
  protected recordsById = new Map<string, SimulationScoreRecord>();

  getRecordById(scoreId: string): SimulationScoreRecord | null {
    const normalizedScoreId = scoreId.trim();
    if (!normalizedScoreId) {
      return null;
    }

    return this.recordsById.get(normalizedScoreId) ?? null;
  }

  listRecords(query: ScoreRecordQuery = {}): SimulationScoreRecord[] {
    return this.records.filter((record) => matchesScoreRecordQuery(record, query));
  }

  protected setSnapshot(records: SimulationScoreRecord[]): void {
    this.records = normalizeScoreRecordCollection(records);
    this.recordsById = new Map(this.records.map((record) => [record.id, record] as const));
  }

  abstract initialize(): Promise<void>;
  abstract refreshSnapshot(): Promise<void>;
  abstract importLegacyRecords(records: SimulationScoreRecord[]): Promise<{ importedCount: number }>;
  abstract appendRecord(record: SimulationScoreRecord): Promise<void>;
  abstract deleteRecordsForUser(userId: string): Promise<number>;
}

class FileScoreRecordStore extends BaseScoreRecordStore {
  private readonly filePath: string;
  private initialized = false;
  private operationQueue = Promise.resolve();

  constructor(dbPath: string) {
    super();
    this.filePath = buildScoreRecordFilePath(dbPath);
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

  async importLegacyRecords(records: SimulationScoreRecord[]): Promise<{ importedCount: number }> {
    return await this.withLock(async () => {
      await this.ensureInitialized();
      const existingIds = new Set(this.records.map((record) => record.id));
      const normalizedLegacy = normalizeScoreRecordCollection(
        records
          .map((entry) => normalizeScoreRecord(entry))
          .filter((entry): entry is SimulationScoreRecord => entry !== null)
      );
      const next = normalizeScoreRecordCollection([...this.records, ...normalizedLegacy]);
      await this.savePayload({ records: next });
      this.setSnapshot(next);
      return {
        importedCount: normalizedLegacy.filter((record) => !existingIds.has(record.id)).length
      };
    });
  }

  async appendRecord(record: SimulationScoreRecord): Promise<void> {
    const normalized = normalizeScoreRecord(record);
    if (!normalized) {
      throw new Error("Score record is invalid.");
    }

    await this.withLock(async () => {
      await this.ensureInitialized();
      const next = normalizeScoreRecordCollection([
        ...this.records.filter((entry) => entry.id !== normalized.id),
        normalized
      ]);
      await this.savePayload({ records: next });
      this.setSnapshot(next);
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

  private async loadPayload(): Promise<ScoreRecordFilePayload> {
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

  private async savePayload(payload: ScoreRecordFilePayload): Promise<void> {
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

class PostgresScoreRecordStore extends BaseScoreRecordStore {
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

  async importLegacyRecords(records: SimulationScoreRecord[]): Promise<{ importedCount: number }> {
    return await this.withLock(async () => {
      await this.ensureInitialized();
      const normalizedLegacy = normalizeScoreRecordCollection(
        records
          .map((entry) => normalizeScoreRecord(entry))
          .filter((entry): entry is SimulationScoreRecord => entry !== null)
      );
      if (normalizedLegacy.length === 0) {
        return { importedCount: 0 };
      }

      const existingIds = new Set(this.records.map((record) => record.id));
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        for (const record of normalizedLegacy) {
          await upsertScoreRecordRow(client, record);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      this.setSnapshot(normalizeScoreRecordCollection([...this.records, ...normalizedLegacy]));
      return {
        importedCount: normalizedLegacy.filter((record) => !existingIds.has(record.id)).length
      };
    });
  }

  async appendRecord(record: SimulationScoreRecord): Promise<void> {
    const normalized = normalizeScoreRecord(record);
    if (!normalized) {
      throw new Error("Score record is invalid.");
    }

    await this.withLock(async () => {
      await this.ensureInitialized();
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await upsertScoreRecordRow(client, normalized);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      this.setSnapshot(
        normalizeScoreRecordCollection([
          ...this.records.filter((entry) => entry.id !== normalized.id),
          normalized
        ])
      );
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
        "DELETE FROM score_records WHERE user_id = $1 RETURNING id",
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
            CREATE TABLE IF NOT EXISTS score_records (
              id TEXT PRIMARY KEY,
              simulation_session_id TEXT NULL,
              user_id TEXT NOT NULL,
              org_id TEXT NULL,
              segment_id TEXT NOT NULL,
              scenario_id TEXT NOT NULL,
              training_id TEXT NULL,
              training_pack_id TEXT NULL,
              industry_id TEXT NULL,
              started_at TIMESTAMPTZ NOT NULL,
              ended_at TIMESTAMPTZ NOT NULL,
              communication_score DOUBLE PRECISION NULL,
              outcome_score DOUBLE PRECISION NULL,
              overall_score DOUBLE PRECISION NOT NULL,
              completion_level TEXT NULL,
              objective_achieved BOOLEAN NULL,
              persuasion DOUBLE PRECISION NOT NULL,
              clarity DOUBLE PRECISION NOT NULL,
              empathy DOUBLE PRECISION NOT NULL,
              assertiveness DOUBLE PRECISION NOT NULL,
              summary TEXT NULL,
              coaching_artifact JSONB NULL,
              normalized_coaching_themes JSONB NULL,
              rubric_version TEXT NULL,
              model TEXT NULL,
              prompt_version TEXT NULL,
              input_tokens INTEGER NULL,
              output_tokens INTEGER NULL,
              total_tokens INTEGER NULL,
              created_at TIMESTAMPTZ NOT NULL
            );

            ALTER TABLE score_records ADD COLUMN IF NOT EXISTS simulation_session_id TEXT NULL;
            ALTER TABLE score_records ADD COLUMN IF NOT EXISTS communication_score DOUBLE PRECISION NULL;
            ALTER TABLE score_records ADD COLUMN IF NOT EXISTS outcome_score DOUBLE PRECISION NULL;
            ALTER TABLE score_records ADD COLUMN IF NOT EXISTS completion_level TEXT NULL;
            ALTER TABLE score_records ADD COLUMN IF NOT EXISTS objective_achieved BOOLEAN NULL;

            CREATE INDEX IF NOT EXISTS idx_score_records_user_id ON score_records (user_id);
            CREATE INDEX IF NOT EXISTS idx_score_records_org_id ON score_records (org_id);
            CREATE INDEX IF NOT EXISTS idx_score_records_simulation_session_id ON score_records (simulation_session_id);
            CREATE INDEX IF NOT EXISTS idx_score_records_training_pack_id ON score_records (training_pack_id);
            CREATE INDEX IF NOT EXISTS idx_score_records_scenario_id ON score_records (scenario_id);
            CREATE INDEX IF NOT EXISTS idx_score_records_segment_id ON score_records (segment_id);
            CREATE INDEX IF NOT EXISTS idx_score_records_ended_at ON score_records (ended_at DESC);
            CREATE INDEX IF NOT EXISTS idx_score_records_created_at ON score_records (created_at DESC);
          `
        )
        .then(() => undefined);
    }

    await this.ensureTablePromise;
  }

  private async loadSnapshotFromDatabase(): Promise<SimulationScoreRecord[]> {
    const result = await this.pool.query<ScoreRecordRow>(
      `
        SELECT
          id,
          simulation_session_id,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          training_id,
          training_pack_id,
          industry_id,
          started_at,
          ended_at,
          communication_score,
          outcome_score,
          overall_score,
          completion_level,
          objective_achieved,
          persuasion,
          clarity,
          empathy,
          assertiveness,
          summary,
          coaching_artifact,
          normalized_coaching_themes,
          rubric_version,
          model,
          prompt_version,
          input_tokens,
          output_tokens,
          total_tokens,
          created_at
        FROM score_records
        ORDER BY created_at ASC, id ASC
      `
    );

    return result.rows
      .map((row) => mapScoreRecordRow(row))
      .filter((entry): entry is SimulationScoreRecord => entry !== null);
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

async function upsertScoreRecordRow(
  client: Pick<PoolClient, "query"> | Pick<Pool, "query">,
  record: SimulationScoreRecord
): Promise<void> {
  await client.query(
    `
      INSERT INTO score_records (
        id,
        simulation_session_id,
        user_id,
        org_id,
        segment_id,
        scenario_id,
        training_id,
        training_pack_id,
        industry_id,
        started_at,
        ended_at,
        communication_score,
        outcome_score,
        overall_score,
        completion_level,
        objective_achieved,
        persuasion,
        clarity,
        empathy,
        assertiveness,
        summary,
        coaching_artifact,
        normalized_coaching_themes,
        rubric_version,
        model,
        prompt_version,
        input_tokens,
        output_tokens,
        total_tokens,
        created_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::timestamptz, $11::timestamptz,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21,
        $22::jsonb, $23::jsonb, $24, $25, $26, $27, $28, $29, $30::timestamptz
      )
      ON CONFLICT (id) DO UPDATE
        SET simulation_session_id = EXCLUDED.simulation_session_id,
            user_id = EXCLUDED.user_id,
            org_id = EXCLUDED.org_id,
            segment_id = EXCLUDED.segment_id,
            scenario_id = EXCLUDED.scenario_id,
            training_id = EXCLUDED.training_id,
            training_pack_id = EXCLUDED.training_pack_id,
            industry_id = EXCLUDED.industry_id,
            started_at = EXCLUDED.started_at,
            ended_at = EXCLUDED.ended_at,
            communication_score = EXCLUDED.communication_score,
            outcome_score = EXCLUDED.outcome_score,
            overall_score = EXCLUDED.overall_score,
            completion_level = EXCLUDED.completion_level,
            objective_achieved = EXCLUDED.objective_achieved,
            persuasion = EXCLUDED.persuasion,
            clarity = EXCLUDED.clarity,
            empathy = EXCLUDED.empathy,
            assertiveness = EXCLUDED.assertiveness,
            summary = EXCLUDED.summary,
            coaching_artifact = EXCLUDED.coaching_artifact,
            normalized_coaching_themes = EXCLUDED.normalized_coaching_themes,
            rubric_version = EXCLUDED.rubric_version,
            model = EXCLUDED.model,
            prompt_version = EXCLUDED.prompt_version,
            input_tokens = EXCLUDED.input_tokens,
            output_tokens = EXCLUDED.output_tokens,
            total_tokens = EXCLUDED.total_tokens,
            created_at = EXCLUDED.created_at
    `,
    [
      record.id,
      record.simulationSessionId ?? null,
      record.userId,
      record.orgId ?? null,
      record.segmentId,
      record.scenarioId,
      record.trainingId ?? null,
      record.trainingPackId ?? null,
      record.industryId ?? null,
      record.startedAt,
      record.endedAt,
      record.communicationScore ?? null,
      record.outcomeScore ?? null,
      record.overallScore,
      record.completionLevel ?? null,
      record.objectiveAchieved ?? null,
      record.persuasion,
      record.clarity,
      record.empathy,
      record.assertiveness,
      record.summary ?? null,
      record.coachingArtifact ?? null,
      record.normalizedCoachingThemes ?? null,
      record.rubricVersion ?? null,
      record.model ?? null,
      record.promptVersion ?? null,
      record.inputTokens ?? null,
      record.outputTokens ?? null,
      record.totalTokens ?? null,
      record.createdAt
    ]
  );
}

class UnsupportedScoreRecordStore extends BaseScoreRecordStore {
  async initialize(): Promise<void> {
    throw new Error("Score record storage provider is not supported.");
  }

  async refreshSnapshot(): Promise<void> {
    throw new Error("Score record storage provider is not supported.");
  }

  async importLegacyRecords(): Promise<{ importedCount: number }> {
    throw new Error("Score record storage provider is not supported.");
  }

  async appendRecord(): Promise<void> {
    throw new Error("Score record storage provider is not supported.");
  }

  async deleteRecordsForUser(): Promise<number> {
    throw new Error("Score record storage provider is not supported.");
  }
}

export function createScoreRecordStore(params: CreateScoreRecordStoreParams): ScoreRecordStore {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresScoreRecordStore(params.databaseUrl, {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs
    });
  }

  if (params.provider === "file") {
    return new FileScoreRecordStore(params.dbPath);
  }

  return new UnsupportedScoreRecordStore();
}
