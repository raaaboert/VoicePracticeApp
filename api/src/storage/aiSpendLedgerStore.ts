import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { AiUsageEvent } from "@voicepractice/shared";
import { isOpenAiRequestNotDispatched } from "../services/aiProviderDispatch.js";
import {
  AI_USAGE_GLOBAL_BUDGET_ADVISORY_LOCK_KEY, reserveAiUsageBudgetOnClient,
  type AiUsageBudgetLimits,
} from "./aiUsageEventStore.js";

export type SpendScope = "platform" | "org" | "user";
export type SpendMetric = "requests" | "calls" | "text_tokens" | "tts_characters" | "stt_milliseconds" | "estimated_cost_microusd";
export type SpendUnits = Partial<Record<SpendMetric, number>>;
type State = "reserved" | "dispatched" | "succeeded" | "failed" | "unknown";
export interface SpendRule { scope: SpendScope; metric: SpendMetric; window: "day" | "quarter_hour" | "minute"; limit?: number }
export interface SpendAttempt {
  id: string; actor_id: string; org_id: string | null; state: State; usage_event_id: string;
  request_fingerprint: string; reserved_at: Date; dispatched_at: Date | null; lease_expires_at: Date;
  settlement_fingerprint: string | null;
}
export class AiSpendLedgerError extends Error {
  constructor(readonly code: "idempotency_conflict" | "attempt_unavailable" | "invalid_transition" | "settlement_conflict" | "invalid_input") {
    super(`AI spending operation rejected: ${code}.`); this.name = "AiSpendLedgerError";
  }
}
export class AiSpendLimitError extends Error {
  constructor(readonly scope: SpendScope, readonly metric: SpendMetric | "concurrency") {
    super("AI capacity is temporarily unavailable."); this.name = "AiSpendLimitError";
  }
}
const SCOPES: SpendScope[] = ["platform", "org", "user"];
const METRICS: SpendMetric[] = ["requests", "calls", "text_tokens", "tts_characters", "stt_milliseconds", "estimated_cost_microusd"];
const WINDOW_MS = { day: 86_400_000, quarter_hour: 900_000, minute: 60_000 };
const integer = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new AiSpendLedgerError("invalid_input");
  return value;
};

/** No DDL, no app_state writes, no provider work inside these transactions. */
export class AiSpendLedgerStore {
  private readonly pool: Pool;
  constructor(private readonly options: {
    databaseUrl: string; environment: "development" | "staging" | "production"; fingerprintSecret: string;
    pgPoolMax?: number; pgConnectTimeoutMs?: number; pgIdleTimeoutMs?: number;
    /** Local tests only; production timestamps always come from PostgreSQL. */
    clock?: () => Date;
  }) {
    if (options.fingerprintSecret.length < 32 || (options.clock && process.env.NODE_ENV !== "test")) throw new AiSpendLedgerError("invalid_input");
    this.pool = new Pool({ connectionString: options.databaseUrl, max: options.pgPoolMax ?? 5,
      connectionTimeoutMillis: options.pgConnectTimeoutMs ?? 8000, idleTimeoutMillis: options.pgIdleTimeoutMs ?? 30000 });
  }
  async close() { await this.pool.end(); }
  async initialize() {
    // Operators apply 025 explicitly. Missing schema/permissions fail closed.
    await this.pool.query(`SELECT id, environment, request_fingerprint, settlement_fingerprint FROM ai_provider_attempts LIMIT 0`);
    await this.pool.query(`SELECT id, reserved, consumed, window_start, window_end FROM ai_limit_buckets LIMIT 0`);
    await this.pool.query(`SELECT attempt_id, bucket_id, reserved_units, settled_units FROM ai_attempt_claims LIMIT 0`);
    await this.pool.query(`SELECT id, total_tokens, created_at FROM ai_usage_events LIMIT 0`);
  }
  fingerprint(material: unknown): string {
    const canonical = JSON.stringify(["peritio.ai.spend.v1", material], (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    return createHmac("sha256", this.options.fingerprintSecret).update(canonical).digest("hex");
  }
  private equal(left: string, right: string) {
    return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
  }
  private async transaction<T>(work: (client: PoolClient, now: Date) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Shared lock serializes claims, but OLD binaries can still use a stale
      // pre-lock cutoff. Deployment must exclude unprotected old/new overlap.
      // Order is global lock -> attempt -> sorted scope/window/metric buckets.
      await client.query("SELECT pg_advisory_xact_lock($1::integer)", [AI_USAGE_GLOBAL_BUDGET_ADVISORY_LOCK_KEY]);
      const now = this.options.clock?.() ?? (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
      const result = await work(client, now);
      await client.query("COMMIT"); return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve original failure. */ }
      throw error;
    } finally { client.release(); }
  }
  async reserve(input: {
    event: AiUsageEvent; userTimeZone: string; legacyLimits: AiUsageBudgetLimits;
    idempotencyKey: string; requestMaterial: unknown; sessionId?: string | null;
    policyVersion: string; leaseMs: number; units?: SpendUnits; rules?: readonly SpendRule[];
    concurrency?: Partial<Record<SpendScope, number>>;
  }): Promise<{ duplicate: boolean; attempt: SpendAttempt }> {
    if (!/^[A-Za-z0-9:_-]{1,200}$/.test(input.idempotencyKey) || !input.event.userId
      || integer(input.leaseMs) < 1 || input.leaseMs > 600_000) throw new AiSpendLedgerError("invalid_input");
    const units: SpendUnits = { ...input.units, requests: 1, calls: 1, text_tokens: integer(input.event.totalTokens) };
    for (const metric of Object.keys(units)) {
      if (!METRICS.includes(metric as SpendMetric)) throw new AiSpendLedgerError("invalid_input");
      integer(units[metric as SpendMetric]!);
    }
    const fingerprint = this.fingerprint([this.options.environment, input.event.userId, input.event.orgId,
      input.event.kind, input.event.model, input.sessionId ?? null, input.policyVersion, input.requestMaterial]);
    return this.transaction(async (client, now) => {
      const existing = (await client.query<SpendAttempt>(`SELECT * FROM ai_provider_attempts
        WHERE environment=$1 AND actor_id=$2 AND idempotency_key=$3 FOR UPDATE`,
      [this.options.environment, input.event.userId, input.idempotencyKey])).rows[0];
      if (existing) {
        if (!this.equal(existing.request_fingerprint, fingerprint)) throw new AiSpendLedgerError("idempotency_conflict");
        return { duplicate: true, attempt: existing };
      }
      // Reap before claims so crashed executions cannot occupy slots forever.
      await this.reapOnClient(client, now);
      for (const scope of SCOPES) {
        const limit = input.concurrency?.[scope];
        if (limit === undefined || (scope === "org" && !input.event.orgId)) continue;
        integer(limit);
        const count = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ai_provider_attempts
          WHERE environment=$1 AND state IN ('reserved','dispatched','unknown') AND lease_expires_at>$2
          AND ($3='platform' OR ($3='user' AND actor_id=$4) OR ($3='org' AND org_id=$5))`,
        [this.options.environment, now, scope, input.event.userId, input.event.orgId]);
        if (BigInt(count.rows[0].n) >= BigInt(limit)) throw new AiSpendLimitError(scope, "concurrency");
      }
      const event = { ...input.event, createdAt: now.toISOString() };
      if ((await client.query("SELECT id FROM ai_usage_events WHERE id=$1", [event.id])).rowCount) throw new AiSpendLedgerError("idempotency_conflict");
      const legacy = await reserveAiUsageBudgetOnClient(client, {
        event, userTimeZone: input.userTimeZone, limits: input.legacyLimits, now,
      }, now);
      if (!legacy.reserved) throw new LegacyAiSpendLimitError(legacy.limitCode);
      const id = randomUUID();
      const result = await client.query<SpendAttempt>(`INSERT INTO ai_provider_attempts
        (id,environment,actor_id,org_id,kind,session_id,idempotency_key,request_fingerprint,model,policy_version,
         state,reserved_at,lease_expires_at,usage_event_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reserved',$11,$12,$13) RETURNING *`,
      [id, this.options.environment, event.userId, event.orgId, event.kind, input.sessionId ?? null,
        input.idempotencyKey, fingerprint, event.model, input.policyVersion, now, new Date(now.getTime() + input.leaseMs), event.id]);
      const rules = input.rules ?? SCOPES.flatMap((scope) => METRICS.filter((metric) => units[metric] !== undefined)
        .map((metric): SpendRule => ({ scope, metric, window: "day" })));
      const keys = new Set<string>();
      const claims: Array<Record<string, unknown>> = [];
      for (const rule of [...rules].sort((a, b) => SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope)
        || a.window.localeCompare(b.window) || a.metric.localeCompare(b.metric))) {
        const scopeId = rule.scope === "user" ? event.userId : rule.scope === "org" ? event.orgId : "platform";
        if (!scopeId) continue;
        if (!SCOPES.includes(rule.scope) || !METRICS.includes(rule.metric) || !(rule.window in WINDOW_MS)) throw new AiSpendLedgerError("invalid_input");
        const width = WINDOW_MS[rule.window], start = new Date(Math.floor(now.getTime() / width) * width);
        const key = `${rule.scope}:${rule.metric}:${rule.window}`;
        if (keys.has(key)) throw new AiSpendLedgerError("invalid_input"); keys.add(key);
        const amount = integer(units[rule.metric] ?? 0);
        if (rule.limit !== undefined && amount > integer(rule.limit)) throw new AiSpendLimitError(rule.scope, rule.metric);
        claims.push({ id: randomUUID(), scope: rule.scope, scope_id: scopeId, metric: rule.metric,
          start: start.toISOString(), end: new Date(start.getTime() + width).toISOString(), amount,
          ceiling: rule.limit ?? null, ordinal: claims.length });
      }
      // One ordered upsert + claim insert. Check limits before COMMIT; any
      // exceeded limit throws and rolls back ALL old/new claims atomically.
      const exceeded = await client.query<{ scope: SpendScope; metric: SpendMetric }>(`
        WITH requested AS MATERIALIZED (SELECT * FROM jsonb_to_recordset($1::jsonb)
          AS r(id uuid,scope text,scope_id text,metric text,start timestamptz,"end" timestamptz,amount bigint,ceiling bigint,ordinal int)),
        buckets AS (INSERT INTO ai_limit_buckets (id,environment,scope_type,scope_id,metric,window_start,window_end,reserved)
          SELECT id,$2,scope,scope_id,metric,start,"end",amount FROM requested ORDER BY ordinal
          ON CONFLICT (environment,scope_type,scope_id,metric,window_start,window_end)
          DO UPDATE SET reserved=ai_limit_buckets.reserved+EXCLUDED.reserved RETURNING *),
        claims AS (INSERT INTO ai_attempt_claims (attempt_id,bucket_id,reserved_units)
          SELECT $3,b.id,r.amount FROM requested r JOIN buckets b ON b.scope_type=r.scope AND b.scope_id=r.scope_id
            AND b.metric=r.metric AND b.window_start=r.start AND b.window_end=r."end" RETURNING bucket_id)
        SELECT r.scope,r.metric FROM requested r JOIN buckets b ON b.scope_type=r.scope AND b.scope_id=r.scope_id
          AND b.metric=r.metric AND b.window_start=r.start AND b.window_end=r."end"
        WHERE r.ceiling IS NOT NULL AND b.reserved+b.consumed>r.ceiling ORDER BY r.ordinal`,
      [JSON.stringify(claims), this.options.environment, id]);
      if (exceeded.rows[0]) throw new AiSpendLimitError(exceeded.rows[0].scope, exceeded.rows[0].metric);
      return { duplicate: false, attempt: result.rows[0] };
    });
  }
  private async owned(client: PoolClient, id: string, actorId: string, orgId: string | null) {
    const attempt = (await client.query<SpendAttempt>(`SELECT * FROM ai_provider_attempts
      WHERE id=$1 AND environment=$2 AND actor_id=$3 AND org_id IS NOT DISTINCT FROM $4 FOR UPDATE`,
    [id, this.options.environment, actorId, orgId])).rows[0];
    if (!attempt) throw new AiSpendLedgerError("attempt_unavailable");
    return attempt;
  }
  async dispatch(id: string, actorId: string, orgId: string | null) {
    await this.transaction(async (client, now) => {
      // A duplicate dispatch must never authorize a second provider invocation.
      const result = await client.query(`UPDATE ai_provider_attempts SET state='dispatched',dispatched_at=$5
        WHERE id=$1 AND environment=$2 AND actor_id=$3 AND org_id IS NOT DISTINCT FROM $4
          AND state='reserved' AND lease_expires_at>$5 RETURNING id`, [id, this.options.environment, actorId, orgId, now]);
      if (!result.rowCount) {
        await this.owned(client, id, actorId, orgId); // Preserve ownership error classification.
        throw new AiSpendLedgerError("invalid_transition");
      }
    });
  }
  async settle(input: {
    id: string; actorId: string; orgId: string | null; outcome: "succeeded" | "failed" | "unknown";
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    units?: SpendUnits;
    providerRequestId?: string;
    /** Only evidence from the provider adapter's local pre-fetch preparation. */
    notDispatchedError?: unknown;
  }): Promise<void> {
    if (input.usage) Object.values(input.usage).forEach(integer);
    if (input.units) Object.values(input.units).forEach((value) => integer(value!));
    if (input.providerRequestId && !/^req_[A-Za-z0-9_-]{1,190}$/.test(input.providerRequestId)) throw new AiSpendLedgerError("invalid_input");
    const notDispatched = isOpenAiRequestNotDispatched(input.notDispatchedError);
    if (input.notDispatchedError !== undefined && (!notDispatched || input.outcome !== "failed" || input.usage || input.units)) throw new AiSpendLedgerError("invalid_input");
    await this.transaction(async (client, now) => {
      const attempt = await this.owned(client, input.id, input.actorId, input.orgId);
      const digest = this.fingerprint([input.outcome, input.usage ?? null,
        METRICS.map((metric) => input.units?.[metric] ?? null), ...(notDispatched ? ["not_dispatched"] : [])]);
      if (attempt.state === "succeeded" || attempt.state === "failed") {
        if (attempt.settlement_fingerprint !== digest) throw new AiSpendLedgerError("settlement_conflict");
        return;
      }
      if (input.outcome === "unknown") {
        if (!attempt.dispatched_at) throw new AiSpendLedgerError("invalid_transition");
        if (attempt.state === "unknown") return;
        await client.query(`UPDATE ai_provider_attempts SET state='unknown',finished_at=$2,failure_code='provider_unknown' WHERE id=$1`, [attempt.id, now]);
        return; // Both ledgers retain the conservative reservation.
      }
      if (input.outcome === "succeeded" && (!attempt.dispatched_at || !input.usage)) throw new AiSpendLedgerError("invalid_transition");
      // A post-dispatch failure without measured usage may have been billed.
      if (input.outcome === "failed" && attempt.dispatched_at && !input.usage && !notDispatched) throw new AiSpendLedgerError("invalid_transition");
      const chargeDispatch = Boolean(attempt.dispatched_at) && !notDispatched;
      const charged: SpendUnits = { ...input.units, requests: 1, calls: chargeDispatch ? 1 : 0,
        text_tokens: input.usage?.totalTokens ?? 0 };
      await this.settleClaims(client, attempt.id, charged, chargeDispatch);
      if (input.usage) {
        const updated = await client.query(`UPDATE ai_usage_events SET input_tokens=$2,output_tokens=$3,total_tokens=$4 WHERE id=$1`,
          [attempt.usage_event_id, input.usage.inputTokens, input.usage.outputTokens, input.usage.totalTokens]);
        if (updated.rowCount !== 1) throw new AiSpendLedgerError("attempt_unavailable");
      } else await client.query("DELETE FROM ai_usage_events WHERE id=$1", [attempt.usage_event_id]);
      await client.query(`UPDATE ai_provider_attempts SET state=$2,finished_at=$3,input_tokens=$4,output_tokens=$5,total_tokens=$6,
        tts_characters=$7,stt_milliseconds=$8,estimated_cost_microusd=$9,settlement_fingerprint=$10,failure_code=$11,
        provider_request_id=$12 WHERE id=$1`,
      [attempt.id, input.outcome, now, input.usage?.inputTokens ?? null, input.usage?.outputTokens ?? null, input.usage?.totalTokens ?? null,
        charged.tts_characters ?? null, charged.stt_milliseconds ?? null, charged.estimated_cost_microusd ?? null, digest,
        input.outcome === "failed" ? (chargeDispatch ? "provider_failed" : "pre_dispatch") : null,
        input.providerRequestId ?? null]);
    });
  }
  private async settleClaims(client: PoolClient, id: string, units: SpendUnits, retainUnmeasured = false) {
    await client.query(`WITH claims AS MATERIALIZED (
      SELECT c.bucket_id,c.reserved_units,coalesce(($2::jsonb->>b.metric)::bigint,
        CASE WHEN $3::boolean THEN c.reserved_units ELSE 0 END) AS amount
      FROM ai_attempt_claims c JOIN ai_limit_buckets b ON b.id=c.bucket_id
      WHERE c.attempt_id=$1 AND c.settled_units IS NULL ORDER BY c.bucket_id FOR UPDATE OF b,c),
    buckets AS (UPDATE ai_limit_buckets b SET reserved=b.reserved-c.reserved_units,consumed=b.consumed+c.amount
      FROM claims c WHERE b.id=c.bucket_id RETURNING b.id)
    UPDATE ai_attempt_claims c SET settled_units=s.amount FROM claims s
      WHERE c.attempt_id=$1 AND c.bucket_id=s.bucket_id`, [id, JSON.stringify(units), retainUnmeasured]);
  }
  private async reapOnClient(client: PoolClient, now: Date) {
    const expired = await client.query<SpendAttempt>(`SELECT * FROM ai_provider_attempts
      WHERE environment=$1 AND state IN ('reserved','dispatched') AND lease_expires_at<=$2
      ORDER BY lease_expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`, [this.options.environment, now]);
    for (const attempt of expired.rows) {
      if (!attempt.dispatched_at) {
        await this.settleClaims(client, attempt.id, { requests: 1 });
        await client.query("DELETE FROM ai_usage_events WHERE id=$1", [attempt.usage_event_id]);
      }
      await client.query(`UPDATE ai_provider_attempts SET state=$2,finished_at=$3,failure_code='lease_expired',settlement_fingerprint=$4 WHERE id=$1`,
        [attempt.id, attempt.dispatched_at ? "unknown" : "failed", now,
          attempt.dispatched_at ? null : this.fingerprint(["failed", null, METRICS.map(() => null)])]);
    }
    return expired.rowCount ?? 0;
  }
  async reconcileExpired() { return this.transaction((client, now) => this.reapOnClient(client, now)); }
}

export class LegacyAiSpendLimitError extends Error {
  constructor(readonly limitCode: "user_calls" | "user_tokens" | "global_calls" | "global_tokens") {
    super("Existing AI budget limit reached."); this.name = "LegacyAiSpendLimitError";
  }
}
