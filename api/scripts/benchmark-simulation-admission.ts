// Disposable LOCAL PostgreSQL only; no provider calls or ledger migration.
// Compare the unchanged reservation/accounting algorithm with baseline finite
// limits versus the null technical limits used for verified simulation admission.
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";
import type { AiUsageEvent } from "@voicepractice/shared";
import { createAiUsageEventStore } from "../src/storage/aiUsageEventStore.js";

const url = new URL(process.env.AI_SPEND_INTEGRATION_DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/test|integration/i.test(url.pathname)) {
  throw Error("Disposable LOCAL test database required");
}
const root = new pg.Pool({ connectionString: url.href });
const schema = `admission_benchmark_${randomBytes(8).toString("hex")}`;
await root.query(`CREATE SCHEMA ${schema}`);
url.searchParams.set("options", `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.href });
const store = createAiUsageEventStore({ provider: "postgres", databaseUrl: url.href, dbPath: "",
  pgPoolMax: 4, pgConnectTimeoutMs: 30000, pgIdleTimeoutMs: 100 });
const finite = { userCalls: 100000, userTokens: 10000000, globalCalls: 100000, globalTokens: 10000000 };
const continuity = { userCalls: null, userTokens: null, globalCalls: null, globalTokens: null };
const originalQuery = pg.Client.prototype.query;
let measuring = false, queries = 0, returnedRows = 0;
pg.Client.prototype.query = function (this: unknown, ...args: any[]) {
  const count = measuring;
  if (count) queries++;
  const pending = (originalQuery as any).apply(this, args);
  if (!count || !pending?.then) return pending;
  return pending.then((result: any) => { returnedRows += result.rows?.length ?? 0; return result; });
} as typeof originalQuery;
const median = (values: number[]) => +[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!.toFixed(2);
const run = async (policy: "baseline" | "continuity") => {
  const event: AiUsageEvent = { id: `ai_${randomUUID()}`, userId: "benchmark-user", orgId: "benchmark-org", kind: "turn",
    model: "mock", promptVersion: "mock", rubricVersion: null, segmentId: null, scenarioId: null,
    inputTokens: 0, outputTokens: 0, totalTokens: 100, createdAt: new Date().toISOString() };
  const start = performance.now();
  const result = await store.reserveBudget({ event, userTimeZone: "America/Denver", limits: policy === "baseline" ? finite : continuity, now: new Date() });
  if (!result.reserved) throw Error("Unexpected benchmark denial");
  await store.appendEvent({ ...event, inputTokens: 1, outputTokens: 1, totalTokens: 2 });
  return performance.now() - start;
};
try {
  await store.initialize();
  for (const distribution of ["many-users", "one-user"]) for (const records of [0, 2700, 9000, 27000]) {
    for (const policy of ["baseline", "continuity"] as const) {
      await pool.query("TRUNCATE ai_usage_events");
      await pool.query(`INSERT INTO ai_usage_events (id,kind,user_id,org_id,model,prompt_version,input_tokens,output_tokens,total_tokens,created_at)
        SELECT 'seed-'||i,'turn',CASE WHEN $2::boolean OR i%1000=0 THEN 'benchmark-user' ELSE 'other-'||(i%1000) END,
        'benchmark-org','mock','mock',50,50,100,clock_timestamp()-((i%43200)+1)*interval '1 second'
        FROM generate_series(1,$1::int) i`, [records, distribution === "one-user"]);
      await pool.query("ANALYZE ai_usage_events");
      await run(policy);
      queries = 0; returnedRows = 0; measuring = true;
      const serial: number[] = [];
      for (let i = 0; i < 7; i++) serial.push(await run(policy));
      const serialQueries = queries / 7, serialRows = returnedRows / 7;
      queries = 0; returnedRows = 0;
      const concurrent = await Promise.all(Array.from({ length: 4 }, () => run(policy)));
      measuring = false;
      console.log(JSON.stringify({ distribution, records, policy, serialMedianMs: median(serial), concurrentMedianMs: median(concurrent),
        serialQueries, serialRows, concurrentQueries: queries / 4, concurrentRows: returnedRows / 4 }));
    }
  }
} finally {
  measuring = false;
  pg.Client.prototype.query = originalQuery;
  await pool.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
}
