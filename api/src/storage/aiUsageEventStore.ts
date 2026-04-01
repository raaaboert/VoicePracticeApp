import path from "node:path";
import { promises as fs } from "node:fs";
import { Pool, PoolClient } from "pg";

import {
  AiUsageEvent,
  AiUsageEventKind,
  getDayKey,
  getMonthKey
} from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";

export const AI_USAGE_EVENT_RETENTION_DAYS = 3650;

const AI_USAGE_EVENT_BUDGET_LOOKBACK_DAYS = 3;
const AI_USAGE_EVENT_CURRENT_PERIOD_LOOKBACK_DAYS = 40;
const AI_USAGE_EVENT_KIND_SET = new Set<AiUsageEventKind>(["opening", "turn", "score", "transcribe"]);

export interface AiUsageBudgetSnapshot {
  userCallsToday: number;
  userTokensToday: number;
  globalCallsToday: number;
  globalTokensToday: number;
}

export interface AiUsageCurrentPeriodTotals {
  tokensUsedToday: number;
  tokensUsedThisMonth: number;
}

export interface AiUsageEventQuery {
  userId?: string | null;
  orgId?: string | null;
  segmentId?: string | null;
  kind?: AiUsageEventKind | null;
  createdAtFrom?: Date | null;
  createdAtBefore?: Date | null;
}

export interface AiUsageEventStore {
  initialize(options?: { now?: Date }): Promise<void>;
  importLegacyEvents(
    events: AiUsageEvent[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number; prunedCount: number }>;
  appendEvent(event: AiUsageEvent, options?: { now?: Date }): Promise<void>;
  listEvents(query?: AiUsageEventQuery, options?: { now?: Date }): Promise<AiUsageEvent[]>;
  computeBudgetSnapshot(params: { userId: string; now: Date; userTimeZone: string }): Promise<AiUsageBudgetSnapshot>;
  computeCurrentPeriodTotals(params: { userId: string; now: Date; timeZone: string }): Promise<AiUsageCurrentPeriodTotals>;
  deleteEventsForUser(userId: string): Promise<number>;
}

interface CreateAiUsageEventStoreParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
}

interface AiUsageEventFilePayload {
  events: AiUsageEvent[];
}

interface AiUsageEventRow {
  id: string;
  kind: string;
  user_id: string;
  org_id: string | null;
  segment_id: string | null;
  scenario_id: string | null;
  model: string;
  prompt_version: string;
  rubric_version: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string | Date;
}

function buildAiUsageEventFilePath(dbPath: string): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.ai-usage-events${extension}`);
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredString(value: unknown): string | null {
  return normalizeNullableString(value);
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

function clampNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }

  return Math.max(0, Math.floor(fallback));
}

function normalizeAiUsageEventKind(value: unknown): AiUsageEventKind | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim() as AiUsageEventKind;
  return AI_USAGE_EVENT_KIND_SET.has(trimmed) ? trimmed : null;
}

function normalizeAiUsageEvent(candidate: unknown): AiUsageEvent | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const id = normalizeRequiredString((candidate as { id?: unknown }).id);
  const kind = normalizeAiUsageEventKind((candidate as { kind?: unknown }).kind);
  const userId = normalizeRequiredString((candidate as { userId?: unknown }).userId);
  const model = normalizeRequiredString((candidate as { model?: unknown }).model);
  const promptVersion = normalizeRequiredString((candidate as { promptVersion?: unknown }).promptVersion);
  const createdAt = normalizeIsoString((candidate as { createdAt?: unknown }).createdAt);

  if (!id || !kind || !userId || !model || !promptVersion || !createdAt) {
    return null;
  }

  return {
    id,
    kind,
    userId,
    orgId: normalizeNullableString((candidate as { orgId?: unknown }).orgId),
    segmentId: normalizeNullableString((candidate as { segmentId?: unknown }).segmentId),
    scenarioId: normalizeNullableString((candidate as { scenarioId?: unknown }).scenarioId),
    model,
    promptVersion,
    rubricVersion: normalizeNullableString((candidate as { rubricVersion?: unknown }).rubricVersion),
    inputTokens: clampNonNegativeInteger((candidate as { inputTokens?: unknown }).inputTokens, 0),
    outputTokens: clampNonNegativeInteger((candidate as { outputTokens?: unknown }).outputTokens, 0),
    totalTokens: clampNonNegativeInteger((candidate as { totalTokens?: unknown }).totalTokens, 0),
    createdAt
  };
}

function compareAiUsageEventsAscending(left: AiUsageEvent, right: AiUsageEvent): number {
  const leftMs = new Date(left.createdAt).getTime();
  const rightMs = new Date(right.createdAt).getTime();
  const normalizedLeftMs = Number.isNaN(leftMs) ? Number.NEGATIVE_INFINITY : leftMs;
  const normalizedRightMs = Number.isNaN(rightMs) ? Number.NEGATIVE_INFINITY : rightMs;
  if (normalizedLeftMs !== normalizedRightMs) {
    return normalizedLeftMs - normalizedRightMs;
  }
  return left.id.localeCompare(right.id);
}

function getRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - AI_USAGE_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function isWithinRetention(event: AiUsageEvent, now: Date): boolean {
  const createdAtMs = new Date(event.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) {
    return false;
  }

  return createdAtMs >= getRetentionCutoff(now).getTime();
}

function normalizeAiUsageEventCollection(
  events: AiUsageEvent[],
  now: Date
): { events: AiUsageEvent[]; prunedCount: number } {
  const deduped = new Map<string, AiUsageEvent>();
  for (const event of events) {
    deduped.set(event.id, event);
  }

  const sorted = Array.from(deduped.values()).sort(compareAiUsageEventsAscending);
  const retained = sorted.filter((event) => isWithinRetention(event, now));
  return {
    events: retained,
    prunedCount: sorted.length - retained.length
  };
}

function ensureFilePayload(candidate: unknown, now: Date): { payload: AiUsageEventFilePayload; changed: boolean; prunedCount: number } {
  const normalizedEvents = Array.isArray((candidate as { events?: unknown } | null)?.events)
    ? ((candidate as { events?: unknown[] }).events ?? [])
        .map((entry) => normalizeAiUsageEvent(entry))
        .filter((entry): entry is AiUsageEvent => entry !== null)
    : [];
  const normalized = normalizeAiUsageEventCollection(normalizedEvents, now);
  return {
    payload: { events: normalized.events },
    changed: normalized.prunedCount > 0 || normalized.events.length !== normalizedEvents.length,
    prunedCount: normalized.prunedCount
  };
}

function matchesAiUsageEventQuery(event: AiUsageEvent, query: AiUsageEventQuery): boolean {
  if (query.userId && event.userId !== query.userId) {
    return false;
  }
  if (query.orgId && event.orgId !== query.orgId) {
    return false;
  }
  if (query.segmentId && event.segmentId !== query.segmentId) {
    return false;
  }
  if (query.kind && event.kind !== query.kind) {
    return false;
  }

  if (query.createdAtFrom || query.createdAtBefore) {
    const createdAtMs = new Date(event.createdAt).getTime();
    if (Number.isNaN(createdAtMs)) {
      return false;
    }
    if (query.createdAtFrom && createdAtMs < query.createdAtFrom.getTime()) {
      return false;
    }
    if (query.createdAtBefore && createdAtMs >= query.createdAtBefore.getTime()) {
      return false;
    }
  }

  return true;
}

function getUsageTokens(event: AiUsageEvent): number {
  return Math.max(0, clampNonNegativeInteger(event.totalTokens, 0));
}

function computeBudgetSnapshotFromEvents(
  events: readonly AiUsageEvent[],
  params: { userId: string; now: Date; userTimeZone: string }
): AiUsageBudgetSnapshot {
  const userDayKey = getDayKey(params.now, params.userTimeZone);
  const globalDayKey = getDayKey(params.now, "UTC");

  let userCallsToday = 0;
  let userTokensToday = 0;
  let globalCallsToday = 0;
  let globalTokensToday = 0;

  for (const event of events) {
    const createdAt = new Date(event.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      continue;
    }

    const tokens = getUsageTokens(event);
    if (getDayKey(createdAt, "UTC") === globalDayKey) {
      globalCallsToday += 1;
      globalTokensToday += tokens;
    }

    if (event.userId !== params.userId) {
      continue;
    }

    if (getDayKey(createdAt, params.userTimeZone) === userDayKey) {
      userCallsToday += 1;
      userTokensToday += tokens;
    }
  }

  return {
    userCallsToday,
    userTokensToday,
    globalCallsToday,
    globalTokensToday
  };
}

function computeCurrentPeriodTotalsFromEvents(
  events: readonly AiUsageEvent[],
  params: { userId: string; now: Date; timeZone: string }
): AiUsageCurrentPeriodTotals {
  const dayKey = getDayKey(params.now, params.timeZone);
  const monthKey = getMonthKey(params.now, params.timeZone);
  let tokensUsedToday = 0;
  let tokensUsedThisMonth = 0;

  for (const event of events) {
    if (event.userId !== params.userId) {
      continue;
    }

    const createdAt = new Date(event.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      continue;
    }

    const tokens = getUsageTokens(event);
    if (getDayKey(createdAt, params.timeZone) === dayKey) {
      tokensUsedToday += tokens;
    }
    if (getMonthKey(createdAt, params.timeZone) === monthKey) {
      tokensUsedThisMonth += tokens;
    }
  }

  return {
    tokensUsedToday,
    tokensUsedThisMonth
  };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

class FileAiUsageEventStore implements AiUsageEventStore {
  private readonly filePath: string;
  private operationQueue = Promise.resolve();

  constructor(dbPath: string) {
    this.filePath = buildAiUsageEventFilePath(dbPath);
  }

  async initialize(options?: { now?: Date }): Promise<void> {
    await this.withLock(async () => {
      await this.loadPayload(options?.now ?? new Date());
    });
  }

  async importLegacyEvents(
    events: AiUsageEvent[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number; prunedCount: number }> {
    const now = options?.now ?? new Date();
    return await this.withLock(async () => {
      const payload = await this.loadPayload(now);
      const existingIds = new Set(payload.events.map((entry) => entry.id));
      const normalizedLegacy = normalizeAiUsageEventCollection(
        events
          .map((entry) => normalizeAiUsageEvent(entry))
          .filter((entry): entry is AiUsageEvent => entry !== null),
        now
      );
      const next = normalizeAiUsageEventCollection([...payload.events, ...normalizedLegacy.events], now);
      const changed =
        next.events.length !== payload.events.length
        || next.events.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(payload.events[index]));
      if (changed) {
        await this.savePayload({ events: next.events });
      }

      return {
        importedCount: normalizedLegacy.events.filter((entry) => !existingIds.has(entry.id)).length,
        prunedCount: normalizedLegacy.prunedCount
      };
    });
  }

  async appendEvent(event: AiUsageEvent, options?: { now?: Date }): Promise<void> {
    const now = options?.now ?? new Date();
    const normalized = normalizeAiUsageEvent(event);
    if (!normalized) {
      throw new Error("AI usage event is invalid.");
    }
    if (!isWithinRetention(normalized, now)) {
      return;
    }

    await this.withLock(async () => {
      const payload = await this.loadPayload(now);
      const next = normalizeAiUsageEventCollection(
        [...payload.events.filter((entry) => entry.id !== normalized.id), normalized],
        now
      );
      await this.savePayload({ events: next.events });
    });
  }

  async listEvents(query: AiUsageEventQuery = {}, options?: { now?: Date }): Promise<AiUsageEvent[]> {
    const now = options?.now ?? new Date();
    return await this.withLock(async () => {
      const payload = await this.loadPayload(now);
      return payload.events.filter((event) => matchesAiUsageEventQuery(event, query));
    });
  }

  async computeBudgetSnapshot(params: { userId: string; now: Date; userTimeZone: string }): Promise<AiUsageBudgetSnapshot> {
    const lookbackStart = new Date(params.now.getTime() - AI_USAGE_EVENT_BUDGET_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const events = await this.listEvents(
      {
        createdAtFrom: lookbackStart,
        createdAtBefore: params.now
      },
      { now: params.now }
    );
    return computeBudgetSnapshotFromEvents(events, params);
  }

  async computeCurrentPeriodTotals(params: { userId: string; now: Date; timeZone: string }): Promise<AiUsageCurrentPeriodTotals> {
    const lookbackStart = new Date(
      params.now.getTime() - AI_USAGE_EVENT_CURRENT_PERIOD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    );
    const events = await this.listEvents(
      {
        userId: params.userId,
        createdAtFrom: lookbackStart,
        createdAtBefore: params.now
      },
      { now: params.now }
    );
    return computeCurrentPeriodTotalsFromEvents(events, params);
  }

  async deleteEventsForUser(userId: string): Promise<number> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return 0;
    }

    return await this.withLock(async () => {
      const payload = await this.loadPayload(new Date());
      const next = payload.events.filter((entry) => entry.userId !== normalizedUserId);
      const deletedCount = payload.events.length - next.length;
      if (deletedCount > 0) {
        await this.savePayload({ events: next });
      }
      return deletedCount;
    });
  }

  private async loadPayload(now: Date): Promise<AiUsageEventFilePayload> {
    await ensureParentDirectory(this.filePath);

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const loaded = ensureFilePayload(JSON.parse(raw), now);
      if (loaded.changed) {
        await this.savePayload(loaded.payload);
      }
      return loaded.payload;
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

  private async savePayload(payload: AiUsageEventFilePayload): Promise<void> {
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

function mapAiUsageEventRow(row: AiUsageEventRow): AiUsageEvent | null {
  return normalizeAiUsageEvent({
    id: row.id,
    kind: row.kind,
    userId: row.user_id,
    orgId: row.org_id,
    segmentId: row.segment_id,
    scenarioId: row.scenario_id,
    model: row.model,
    promptVersion: row.prompt_version,
    rubricVersion: row.rubric_version,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    createdAt: row.created_at
  });
}

class PostgresAiUsageEventStore implements AiUsageEventStore {
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
    await this.pruneRetainedEvents(options?.now ?? new Date());
  }

  async importLegacyEvents(
    events: AiUsageEvent[],
    options?: { now?: Date }
  ): Promise<{ importedCount: number; prunedCount: number }> {
    const now = options?.now ?? new Date();
    const normalizedLegacy = normalizeAiUsageEventCollection(
      events
        .map((entry) => normalizeAiUsageEvent(entry))
        .filter((entry): entry is AiUsageEvent => entry !== null),
      now
    );
    if (normalizedLegacy.events.length === 0) {
      return { importedCount: 0, prunedCount: normalizedLegacy.prunedCount };
    }

    await this.ensureTable();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM ai_usage_events WHERE id = ANY($1::text[])",
        [normalizedLegacy.events.map((entry) => entry.id)]
      );
      const existingIds = new Set(existing.rows.map((entry) => entry.id));

      for (const event of normalizedLegacy.events) {
        await upsertAiUsageEventRow(client, event);
      }
      await pruneAiUsageEventRows(client, now);
      await client.query("COMMIT");

      return {
        importedCount: normalizedLegacy.events.filter((entry) => !existingIds.has(entry.id)).length,
        prunedCount: normalizedLegacy.prunedCount
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendEvent(event: AiUsageEvent, options?: { now?: Date }): Promise<void> {
    const now = options?.now ?? new Date();
    const normalized = normalizeAiUsageEvent(event);
    if (!normalized) {
      throw new Error("AI usage event is invalid.");
    }
    if (!isWithinRetention(normalized, now)) {
      return;
    }

    await this.ensureTable();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await upsertAiUsageEventRow(client, normalized);
      await pruneAiUsageEventRows(client, now);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listEvents(query: AiUsageEventQuery = {}, _options?: { now?: Date }): Promise<AiUsageEvent[]> {
    await this.ensureTable();

    const whereClauses: string[] = [];
    const values: unknown[] = [];
    if (query.userId) {
      whereClauses.push(`user_id = $${values.length + 1}`);
      values.push(query.userId);
    }
    if (query.orgId) {
      whereClauses.push(`org_id = $${values.length + 1}`);
      values.push(query.orgId);
    }
    if (query.segmentId) {
      whereClauses.push(`segment_id = $${values.length + 1}`);
      values.push(query.segmentId);
    }
    if (query.kind) {
      whereClauses.push(`kind = $${values.length + 1}`);
      values.push(query.kind);
    }
    if (query.createdAtFrom) {
      whereClauses.push(`created_at >= $${values.length + 1}::timestamptz`);
      values.push(query.createdAtFrom.toISOString());
    }
    if (query.createdAtBefore) {
      whereClauses.push(`created_at < $${values.length + 1}::timestamptz`);
      values.push(query.createdAtBefore.toISOString());
    }

    const result = await this.pool.query<AiUsageEventRow>(
      `
        SELECT
          id,
          kind,
          user_id,
          org_id,
          segment_id,
          scenario_id,
          model,
          prompt_version,
          rubric_version,
          input_tokens,
          output_tokens,
          total_tokens,
          created_at
        FROM ai_usage_events
        ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
        ORDER BY created_at ASC, id ASC
      `,
      values
    );

    return result.rows
      .map((row) => mapAiUsageEventRow(row))
      .filter((entry): entry is AiUsageEvent => entry !== null);
  }

  async computeBudgetSnapshot(params: { userId: string; now: Date; userTimeZone: string }): Promise<AiUsageBudgetSnapshot> {
    const lookbackStart = new Date(params.now.getTime() - AI_USAGE_EVENT_BUDGET_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const events = await this.listEvents({
      createdAtFrom: lookbackStart,
      createdAtBefore: params.now
    });
    return computeBudgetSnapshotFromEvents(events, params);
  }

  async computeCurrentPeriodTotals(params: { userId: string; now: Date; timeZone: string }): Promise<AiUsageCurrentPeriodTotals> {
    const lookbackStart = new Date(
      params.now.getTime() - AI_USAGE_EVENT_CURRENT_PERIOD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    );
    const events = await this.listEvents({
      userId: params.userId,
      createdAtFrom: lookbackStart,
      createdAtBefore: params.now
    });
    return computeCurrentPeriodTotalsFromEvents(events, params);
  }

  async deleteEventsForUser(userId: string): Promise<number> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return 0;
    }

    await this.ensureTable();
    const result = await this.pool.query<{ id: string }>(
      "DELETE FROM ai_usage_events WHERE user_id = $1 RETURNING id",
      [normalizedUserId]
    );
    return result.rowCount ?? result.rows.length;
  }

  private async ensureTable(): Promise<void> {
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = this.pool
        .query(
          `
            CREATE TABLE IF NOT EXISTS ai_usage_events (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              user_id TEXT NOT NULL,
              org_id TEXT NULL,
              segment_id TEXT NULL,
              scenario_id TEXT NULL,
              model TEXT NOT NULL,
              prompt_version TEXT NOT NULL,
              rubric_version TEXT NULL,
              input_tokens INTEGER NOT NULL,
              output_tokens INTEGER NOT NULL,
              total_tokens INTEGER NOT NULL,
              created_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_id ON ai_usage_events (user_id);
            CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_id ON ai_usage_events (org_id);
            CREATE INDEX IF NOT EXISTS idx_ai_usage_events_segment_id ON ai_usage_events (segment_id);
            CREATE INDEX IF NOT EXISTS idx_ai_usage_events_kind ON ai_usage_events (kind);
          `
        )
        .then(() => undefined);
    }

    await this.ensureTablePromise;
  }

  private async pruneRetainedEvents(now: Date): Promise<void> {
    await pruneAiUsageEventRows(this.pool, now);
  }
}

async function upsertAiUsageEventRow(
  client: Pick<PoolClient, "query"> | Pick<Pool, "query">,
  event: AiUsageEvent
): Promise<void> {
  await client.query(
    `
      INSERT INTO ai_usage_events (
        id,
        kind,
        user_id,
        org_id,
        segment_id,
        scenario_id,
        model,
        prompt_version,
        rubric_version,
        input_tokens,
        output_tokens,
        total_tokens,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz)
      ON CONFLICT (id) DO UPDATE
        SET kind = EXCLUDED.kind,
            user_id = EXCLUDED.user_id,
            org_id = EXCLUDED.org_id,
            segment_id = EXCLUDED.segment_id,
            scenario_id = EXCLUDED.scenario_id,
            model = EXCLUDED.model,
            prompt_version = EXCLUDED.prompt_version,
            rubric_version = EXCLUDED.rubric_version,
            input_tokens = EXCLUDED.input_tokens,
            output_tokens = EXCLUDED.output_tokens,
            total_tokens = EXCLUDED.total_tokens,
            created_at = EXCLUDED.created_at
    `,
    [
      event.id,
      event.kind,
      event.userId,
      event.orgId,
      event.segmentId,
      event.scenarioId,
      event.model,
      event.promptVersion,
      event.rubricVersion,
      event.inputTokens,
      event.outputTokens,
      event.totalTokens,
      event.createdAt
    ]
  );
}

async function pruneAiUsageEventRows(
  client: Pick<PoolClient, "query"> | Pick<Pool, "query">,
  now: Date
): Promise<number> {
  const result = await client.query<{ deleted_count: string }>(
    `
      WITH deleted AS (
        DELETE FROM ai_usage_events
        WHERE created_at < $1::timestamptz
        RETURNING id
      )
      SELECT COUNT(*)::text AS deleted_count
      FROM deleted
    `,
    [getRetentionCutoff(now).toISOString()]
  );
  const row = result.rows[0];
  return row ? Number(row.deleted_count) || 0 : 0;
}

class UnsupportedAiUsageEventStore implements AiUsageEventStore {
  async initialize(): Promise<void> {
    throw new Error("AI usage event storage provider is not supported.");
  }

  async importLegacyEvents(): Promise<{ importedCount: number; prunedCount: number }> {
    throw new Error("AI usage event storage provider is not supported.");
  }

  async appendEvent(): Promise<void> {
    throw new Error("AI usage event storage provider is not supported.");
  }

  async listEvents(): Promise<AiUsageEvent[]> {
    throw new Error("AI usage event storage provider is not supported.");
  }

  async computeBudgetSnapshot(): Promise<AiUsageBudgetSnapshot> {
    throw new Error("AI usage event storage provider is not supported.");
  }

  async computeCurrentPeriodTotals(): Promise<AiUsageCurrentPeriodTotals> {
    throw new Error("AI usage event storage provider is not supported.");
  }

  async deleteEventsForUser(): Promise<number> {
    throw new Error("AI usage event storage provider is not supported.");
  }
}

export function createAiUsageEventStore(params: CreateAiUsageEventStoreParams): AiUsageEventStore {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresAiUsageEventStore(params.databaseUrl, {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs
    });
  }

  if (params.provider === "file") {
    return new FileAiUsageEventStore(params.dbPath);
  }

  return new UnsupportedAiUsageEventStore();
}
