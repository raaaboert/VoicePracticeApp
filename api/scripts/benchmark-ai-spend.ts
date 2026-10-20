// LOCAL disposable PostgreSQL only. No provider calls. Run from api with node --import tsx.
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import pg from "pg";
import type { AiUsageEvent } from "@voicepractice/shared";
import * as currentUsage from "../src/storage/aiUsageEventStore.js";
import * as currentLedger from "../src/storage/aiSpendLedgerStore.js";
import { invokeWithAiSpendLedger } from "../src/services/aiSpendLedger.js";

const apiDir = fileURLToPath(new URL("../", import.meta.url));
const url = new URL(process.env.AI_SPEND_INTEGRATION_DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/test|integration/i.test(url.pathname)) throw Error("Disposable LOCAL test database required");
const revision = process.argv.find(a => a.startsWith("--revision="))?.slice(11) ?? "working-tree";
const historical = ["5e26167d7592179fc7b4f047a7fea4c8255f2dba", "31c9329e50b77aef0ebf095449458c9ea02fd5e6"];
if (revision !== "working-tree" && !historical.includes(revision)) throw Error("Only the two audited local baseline revisions are allowed");
let fixtureDir: string | undefined;
let usageModule = currentUsage, ledgerModule = currentLedger;
if (revision !== "working-tree") {
  // Read only the two historical stores; no checkout, remote or dependency changes.
  fixtureDir = await mkdtemp(path.join(apiDir, ".spend-benchmark-"));
  await mkdir(path.join(fixtureDir, "storage"));
  for (const name of ["aiUsageEventStore", "aiSpendLedgerStore"]) {
    let source = execFileSync("git", ["show", `${revision}:api/src/storage/${name}.ts`], { cwd: apiDir, encoding: "utf8" });
    source = source.replace('"../runtimeConfig.js"', JSON.stringify(pathToFileURL(path.join(apiDir, "src/runtimeConfig.ts")).href))
      .replace('"../services/aiProviderDispatch.js"', JSON.stringify(pathToFileURL(path.join(apiDir, "src/services/aiProviderDispatch.ts")).href));
    await writeFile(path.join(fixtureDir, "storage", `${name}.ts`), source);
  }
  usageModule = await import(pathToFileURL(path.join(fixtureDir, "storage/aiUsageEventStore.ts")).href);
  ledgerModule = await import(pathToFileURL(path.join(fixtureDir, "storage/aiSpendLedgerStore.ts")).href);
}
const root = new pg.Pool({ connectionString: url.href });
const schema = `spend_benchmark_${randomBytes(8).toString("hex")}`;
await root.query(`CREATE SCHEMA ${schema}`);
url.searchParams.set("options", `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.href });
const usage = usageModule.createAiUsageEventStore({ provider: "postgres", databaseUrl: url.href, dbPath: "",
  pgPoolMax: 4, pgConnectTimeoutMs: 30000, pgIdleTimeoutMs: 100 });
const ledger = new ledgerModule.AiSpendLedgerStore({ databaseUrl: url.href, environment: "staging",
  fingerprintSecret: "local-benchmark-only-fingerprint-secret", pgPoolMax: 4, pgConnectTimeoutMs: 30000, pgIdleTimeoutMs: 100 });
const limits = { userCalls: null, userTokens: null, globalCalls: null, globalTokens: null };
const event = (): AiUsageEvent => ({ id: `ai_${randomUUID()}`, userId: "benchmark-user", orgId: "benchmark-org", kind: "turn",
  model: "mock", promptVersion: "mock", rubricVersion: null, segmentId: null, scenarioId: null,
  inputTokens: 0, outputTokens: 0, totalTokens: 100, createdAt: new Date().toISOString() });
let measuring = false, queries = 0, userRows = 0;
let budgetQuery: { text: string; values: unknown[] } | undefined;
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: unknown, ...args: any[]) {
  const count = measuring;
  if (count) queries++;
  if (count && typeof args[0]==="string" && args[0].includes("WITH valid AS MATERIALIZED")) budgetQuery = { text: args[0], values: args[1] };
  const pending = (originalQuery as any).apply(this, args);
  if (!count || !pending?.then) return pending;
  return pending.then((result: any) => {
    userRows += result.rows?.filter((r: any) => r.budget_scope === "user").length ?? 0;
    return result;
  });
} as typeof originalQuery;
const run = async (mode: "off" | "record") => {
  const e = event(), start = performance.now();
  if (mode === "record") await invokeWithAiSpendLedger({ store: ledger, event: e, userTimeZone: "America/Denver",
    legacyLimits: limits, requestMaterial: { mock: true }, invoke: async () => "mock-result",
    resolveUsage: () => ({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }), budgetMessage: () => "limit" });
  else {
    await usage.reserveBudget({ event: e, userTimeZone: "America/Denver", limits, now: new Date() });
    await usage.appendEvent({ ...e, inputTokens: 1, outputTokens: 1, totalTokens: 2 });
  }
  return performance.now()-start;
};
const median = (values: number[]) => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
try {
  await usage.initialize();
  await pool.query(await readFile(new URL("../sql/025_ai_spend_ledger.sql", import.meta.url), "utf8"));
  await ledger.initialize();
  for (const distribution of ["many-users", "one-user"] as const) for (const records of [0, 2700, 9000, 27000]) {
    for (const mode of ["off", "record"] as const) {
      await pool.query("TRUNCATE ai_attempt_claims,ai_provider_attempts,ai_limit_buckets,ai_usage_events");
      await pool.query(`INSERT INTO ai_usage_events (id,kind,user_id,org_id,model,prompt_version,input_tokens,output_tokens,total_tokens,created_at)
        SELECT 'seed-'||i,'turn',CASE WHEN $2::boolean OR i%1000=0 THEN 'benchmark-user' ELSE 'other-'||(i%1000) END,
        'benchmark-org','mock','mock',50,50,100,clock_timestamp()-((i%43200)+1)*interval '1 second'
        FROM generate_series(1,$1::int) i`, [records, distribution === "one-user"]);
      await pool.query("ANALYZE ai_usage_events");
      await run(mode);
      await pool.query("TRUNCATE ai_attempt_claims,ai_provider_attempts,ai_limit_buckets");
      await pool.query("DELETE FROM ai_usage_events WHERE id NOT LIKE 'seed-%'");
      queries = 0; userRows = 0; measuring = true;
      let start = performance.now(); const samples: number[] = [];
      for (let i=0; i<3; i++) samples.push(await run(mode));
      const serialMs = performance.now()-start, serialQueries = queries, serialUserRows = userRows;
      queries = 0; userRows = 0; start = performance.now();
      const concurrent = await Promise.all(Array.from({ length: 4 }, async () => [await run(mode), await run(mode)]));
      const concurrentMs = performance.now()-start; measuring = false;
      const queryPlan = records===27000 && budgetQuery
        ? (await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${budgetQuery.text}`,budgetQuery.values)).rows[0]["QUERY PLAN"][0] : undefined;
      let retainedHistoryQueryPlan;
      if (records===27000 && budgetQuery) {
        // Plans only, after timings: demonstrate selectivity with retained older
        // history too, not just a synthetic table where every row is recent.
        await pool.query(`INSERT INTO ai_usage_events (id,kind,user_id,model,prompt_version,input_tokens,output_tokens,total_tokens,created_at)
          SELECT 'retained-'||i,'turn','retained-user','mock','mock',0,0,1,clock_timestamp()-interval '30 days'
          FROM generate_series(1,100000) i`);
        await pool.query("ANALYZE ai_usage_events");
        retainedHistoryQueryPlan = (await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${budgetQuery.text}`,budgetQuery.values)).rows[0]["QUERY PLAN"][0];
      }
      console.log(JSON.stringify({ revision, distribution, records, mode, samplesMs: samples.map(n=>+n.toFixed(2)),
        medianMs: +median(samples).toFixed(2), serialCallsPerSecond: +(3000/serialMs).toFixed(2), queriesPerCall: serialQueries/3,
        userRowsPerCall: serialUserRows/3, concurrentMedianMs: +median(concurrent.flat()).toFixed(2),
        concurrentCallsPerSecond: +(8000/concurrentMs).toFixed(2), concurrentQueriesPerCall: queries/8, concurrentUserRowsPerCall: userRows/8, queryPlan,retainedHistoryQueryPlan }));
    }
  }
} finally {
  measuring = false; pg.Client.prototype.query = originalQuery;
  await ledger.close(); await pool.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  if (fixtureDir) {
    if (path.dirname(path.resolve(fixtureDir)) !== path.resolve(apiDir) || !path.basename(fixtureDir).startsWith(".spend-benchmark-")) throw Error("Unexpected benchmark fixture path");
    await rm(fixtureDir, { recursive: true, force: true });
  }
}
