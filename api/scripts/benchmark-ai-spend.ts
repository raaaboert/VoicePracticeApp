// LOCAL disposable PostgreSQL only. No provider calls. Run with node --import tsx.
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import pg from "pg";
import type { AiUsageEvent } from "@voicepractice/shared";
import { createAiUsageEventStore } from "../src/storage/aiUsageEventStore.js";
import { AiSpendLedgerStore } from "../src/storage/aiSpendLedgerStore.js";
import { invokeWithAiSpendLedger } from "../src/services/aiSpendLedger.js";

const url = new URL(process.env.AI_SPEND_INTEGRATION_DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/test|integration/i.test(url.pathname)) throw Error("Disposable LOCAL test database required");
const root = new pg.Pool({ connectionString: url.href });
const schema = `spend_benchmark_${randomBytes(8).toString("hex")}`;
await root.query(`CREATE SCHEMA ${schema}`);
url.searchParams.set("options", `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.href });
const usage = createAiUsageEventStore({ provider: "postgres", databaseUrl: url.href, dbPath: "",
  pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100 });
const ledger = new AiSpendLedgerStore({ databaseUrl: url.href, environment: "staging",
  fingerprintSecret: "local-benchmark-only-fingerprint-secret", pgIdleTimeoutMs: 100 });
const limits = { userCalls: null, userTokens: null, globalCalls: null, globalTokens: null };
const event = (): AiUsageEvent => ({ id: `ai_${randomUUID()}`, userId: "benchmark-user", orgId: "benchmark-org", kind: "turn",
  model: "mock", promptVersion: "mock", rubricVersion: null, segmentId: null, scenarioId: null,
  inputTokens: 0, outputTokens: 0, totalTokens: 100, createdAt: new Date().toISOString() });
let measuring = false, queries = 0;
const originalQuery = pg.Client.prototype.query;
// Count actual driver submissions, including BEGIN/COMMIT/clock/lock statements.
pg.Client.prototype.query = function (this: unknown, ...args: any[]) {
  if (measuring) queries++;
  return (originalQuery as any).apply(this, args);
} as typeof originalQuery;
try {
  await usage.initialize();
  await pool.query(await readFile(new URL("../sql/025_ai_spend_ledger.sql", import.meta.url), "utf8"));
  await ledger.initialize();
  for (const records of [0, 2700, 9000, 27000]) {
    await pool.query("TRUNCATE ai_attempt_claims,ai_provider_attempts,ai_limit_buckets,ai_usage_events");
    await pool.query(`INSERT INTO ai_usage_events (id,kind,user_id,org_id,model,prompt_version,input_tokens,output_tokens,total_tokens,created_at)
      SELECT 'seed-'||i,'turn',CASE WHEN i%2=0 THEN 'benchmark-user' ELSE 'other-user' END,'benchmark-org','mock','mock',50,50,100,
      clock_timestamp()-((i%43200)+1)*interval '1 second' FROM generate_series(1,$1::int) i`, [records]);
    for (const mode of ["off", "record"] as const) {
      const samples: number[] = [], counts: number[] = [];
      for (let sample = 0; sample < 3; sample++) {
        const e = event(); queries = 0; measuring = true; const start = performance.now();
        if (mode === "record") await invokeWithAiSpendLedger({ store: ledger, event: e, userTimeZone: "America/Denver",
          legacyLimits: limits, requestMaterial: { mock: true }, invoke: async () => "mock-result",
          resolveUsage: () => ({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }), budgetMessage: () => "limit" });
        else {
          await usage.reserveBudget({ event: e, userTimeZone: "America/Denver", limits, now: new Date() });
          await usage.appendEvent({ ...e, inputTokens: 1, outputTokens: 1, totalTokens: 2 });
        }
        samples.push(performance.now() - start); measuring = false; counts.push(queries);
      }
      const sorted = [...samples].sort((a,b) => a-b);
      console.log(JSON.stringify({ records, mode, samplesMs: samples.map(n => +n.toFixed(2)), queries: counts,
        medianMs: +sorted[1].toFixed(2), serialCallsPerSecond: +(3000/samples.reduce((a,b)=>a+b,0)).toFixed(2) }));
    }
  }
} finally {
  measuring = false; pg.Client.prototype.query = originalQuery;
  await ledger.close(); await pool.end();
  // The usage-store pool has its normal short idle expiry; no persistent settings.
  await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
}
