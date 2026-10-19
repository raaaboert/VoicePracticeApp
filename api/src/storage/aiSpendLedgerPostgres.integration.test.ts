import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import test from "node:test";
import { Pool } from "pg";
import type { AiUsageEvent } from "@voicepractice/shared";
import { AiSpendLedgerStore, AiSpendLedgerError, AiSpendLimitError, LegacyAiSpendLimitError, type SpendRule } from "./aiSpendLedgerStore.js";
import { createAiUsageEventStore } from "./aiUsageEventStore.js";
import { invokeWithAiSpendLedger } from "../services/aiSpendLedger.js";

const databaseUrl = process.env.AI_SPEND_INTEGRATION_DATABASE_URL?.trim()
  || process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim() || "";
const unlimited = { userCalls: null, userTokens: null, globalCalls: null, globalTokens: null };
const secret = "local-test-ai-spend-fingerprint-key-32-characters";
const event = (actor = "a", org: string | null = "org_a", kind: AiUsageEvent["kind"] = "turn"): AiUsageEvent => ({
  id: `ai_${randomUUID()}`, userId: actor, orgId: org, kind, segmentId: "sales", scenarioId: "scenario",
  model: "test-model", promptVersion: "test-prompt", rubricVersion: null,
  inputTokens: 0, outputTokens: 0, totalTokens: kind === "tts" ? 0 : 10, createdAt: new Date().toISOString(),
});

test("real PostgreSQL AI spending foundation is atomic across processes and compatible with usage events", { skip: !databaseUrl }, async (t) => {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) && /test|integration/i.test(parsed.pathname), "LOCAL disposable PostgreSQL required");
  const root = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `ai_spend_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const scopedUrl = parsed.toString();
  const pool = new Pool({ connectionString: scopedUrl, max: 4 });
  let now = new Date("2026-10-20T23:59:59.000Z");
  const options = { databaseUrl: scopedUrl, environment: "staging" as const, fingerprintSecret: secret,
    clock: () => now, pgIdleTimeoutMs: 100, pgConnectTimeoutMs: 1000 };
  const a = new AiSpendLedgerStore(options), b = new AiSpendLedgerStore(options);
  const usage = createAiUsageEventStore({ provider: "postgres", dbPath: "", databaseUrl: scopedUrl,
    pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100, preserveCreatedAt: true });
  const reserveInput = (e = event(), extra: Partial<Parameters<typeof a.reserve>[0]> = {}) => ({
    event: e, userTimeZone: "UTC", legacyLimits: unlimited, idempotencyKey: e.id,
    requestMaterial: { text: "PRIVATE_SOURCE_SENTINEL", audio: "PRIVATE_AUDIO_SENTINEL" },
    policyVersion: "test-v1", leaseMs: 60_000, ...extra,
  });
  const reset = async () => { await pool.query("TRUNCATE ai_attempt_claims,ai_provider_attempts,ai_limit_buckets,ai_usage_events"); now = new Date("2026-10-20T23:59:59.000Z"); };
  const identity = (attempt: { id: string }, actorId = "a", orgId: string | null = "org_a") => ({ id: attempt.id, actorId, orgId });
  const success = (id: string, actorId = "a", orgId: string | null = "org_a") => a.settle({ id, actorId, orgId, outcome: "succeeded", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } });
  const bucket = async (metric = "calls", scope = "platform") => (await pool.query("SELECT * FROM ai_limit_buckets WHERE metric=$1 AND scope_type=$2 ORDER BY window_start", [metric, scope])).rows;
  try {
    await t.test("missing migration fails closed; 025 preserves populated legacy events and reruns safely", async () => {
      await usage.initialize(); const e = event(); await usage.appendEvent(e);
      await assert.rejects(a.initialize(), /ai_provider_attempts/);
      const sql = await readFile(new URL("../../sql/025_ai_spend_ledger.sql", import.meta.url), "utf8");
      await pool.query(sql); await a.initialize(); await pool.query(sql); await b.initialize();
      assert.equal((await usage.listEvents()).length, 1);
      assert.equal((await usage.listEvents())[0].id, e.id);
    });
    await t.test("independent API processes reserve the exact shared platform limit atomically", async () => {
      await reset();
      const moduleUrl = new URL("./aiSpendLedgerStore.ts", import.meta.url).href;
      const childCode = `import { AiSpendLedgerStore } from ${JSON.stringify(moduleUrl)};
        const p=JSON.parse(process.env.AI_SPEND_CHILD_INPUT); const s=new AiSpendLedgerStore({databaseUrl:process.env.AI_SPEND_CHILD_URL,environment:'staging',fingerprintSecret:process.env.AI_SPEND_CHILD_SECRET,clock:()=>new Date(p.now)});
        try { await s.reserve(p.input); process.stdout.write('reserved'); }
        catch(e) { if(e.name!=='AiSpendLimitError') throw e; process.stdout.write('limited'); } finally { await s.close(); }`;
      const results = await Promise.all(Array.from({ length: 6 }, (_, index) => new Promise<string>((resolve, reject) => {
        const input = reserveInput(event(`actor_${index}`, index % 2 ? "org_b" : "org_a"), {
          rules: [{ scope: "platform", metric: "calls", window: "day", limit: 2 }],
        });
        const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childCode], {
          env: { ...process.env, NODE_ENV: "test", AI_SPEND_CHILD_URL: scopedUrl, AI_SPEND_CHILD_SECRET: secret,
            AI_SPEND_CHILD_INPUT: JSON.stringify({ now: now.toISOString(), input }) }, stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "", errors = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { errors += chunk; });
        child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`Child test failed: ${errors}`)));
      })));
      assert.equal(results.filter((r) => r === "reserved").length, 2);
      assert.equal(results.filter((r) => r === "limited").length, 4);
      assert.equal((await pool.query("SELECT * FROM ai_usage_events")).rowCount, 2);
      assert.equal((await bucket())[0].reserved, "2");
    });
    await t.test("user A/B share org bounds; separate orgs share platform bounds without attribution leakage", async () => {
      await reset();
      const rules: SpendRule[] = [{ scope: "user", metric: "calls", window: "day", limit: 1 },
        { scope: "org", metric: "calls", window: "day", limit: 2 }, { scope: "platform", metric: "calls", window: "day", limit: 3 }];
      await a.reserve(reserveInput(event("a"), { rules }));
      await assert.rejects(b.reserve(reserveInput(event("a"), { rules })), (e: any) => e instanceof AiSpendLimitError && e.scope === "user");
      await b.reserve(reserveInput(event("b"), { rules }));
      await assert.rejects(a.reserve(reserveInput(event("c"), { rules })), (e: any) => e.scope === "org");
      await a.reserve(reserveInput(event("c", "org_b"), { rules }));
      await assert.rejects(b.reserve(reserveInput(event("d", "org_b"), { rules })), (e: any) => e.scope === "platform");
      const orgs = await bucket("calls", "org");
      assert.deepEqual(orgs.map((r: any) => [r.scope_id, r.reserved]).sort(), [["org_a", "2"], ["org_b", "1"]]);
    });
    await t.test("legacy call/token limits remain authoritative and rejected claims roll back both ledgers", async () => {
      await reset();
      await a.reserve(reserveInput(event(), { legacyLimits: { ...unlimited, globalCalls: 1 } }));
      await assert.rejects(b.reserve(reserveInput(event("b"), { legacyLimits: { ...unlimited, globalCalls: 1 } })), LegacyAiSpendLimitError);
      assert.equal((await pool.query("SELECT * FROM ai_provider_attempts")).rowCount, 1);
      await reset();
      await assert.rejects(a.reserve(reserveInput(event(), { legacyLimits: { ...unlimited, userTokens: 9 } })), LegacyAiSpendLimitError);
      assert.equal((await pool.query("SELECT * FROM ai_usage_events")).rowCount, 0);
      assert.equal((await pool.query("SELECT * FROM ai_attempt_claims")).rowCount, 0);
    });
    await t.test("each token/audio/cost metric reserves its actual units at the exact configured boundary", async () => {
      for (const metric of ["text_tokens", "tts_characters", "stt_milliseconds", "estimated_cost_microusd"] as const) {
        await reset();
        const rules: SpendRule[] = [{ scope: "platform", metric, window: "quarter_hour", limit: 14 }];
        const inputs = Array.from({ length: 3 }, (_, i) => reserveInput({ ...event(`actor_${i}`), totalTokens: 7 }, { rules, units: { [metric]: 7 } }));
        const results = await Promise.allSettled(inputs.map((input) => a.reserve(input)));
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
        assert.equal(results.filter((r) => r.status === "rejected" && r.reason instanceof AiSpendLimitError).length, 1);
        assert.equal((await bucket(metric))[0].reserved, "14");
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM ai_usage_events")).rows[0].n, 2);
      }
    });
    await t.test("production timestamps use the database clock and ignore backdated caller event timestamps", async () => {
      await reset(); const live = new AiSpendLedgerStore({ ...options, clock: undefined });
      try {
        const before = (await pool.query("SELECT clock_timestamp() AS now")).rows[0].now;
        const { attempt } = await live.reserve(reserveInput({ ...event(), createdAt: "2001-01-01T00:00:00Z" }));
        const after = (await pool.query("SELECT clock_timestamp() AS now")).rows[0].now;
        assert.ok(attempt.reserved_at >= before && attempt.reserved_at <= after);
        assert.equal(attempt.lease_expires_at.getTime() - attempt.reserved_at.getTime(), 60_000);
        assert.equal((await usage.listEvents())[0].createdAt, attempt.reserved_at.toISOString());
      } finally { await live.close(); }
    });
    await t.test("duplicate identical keys create one attempt/event; changed body/org/model/session cannot reuse the key", async () => {
      await reset(); const input = reserveInput();
      const results = await Promise.all([a.reserve(input), b.reserve(input)]);
      assert.equal(results.filter((r) => !r.duplicate).length, 1);
      assert.equal(results[0].attempt.id, results[1].attempt.id);
      const reordered = await b.reserve({ ...input, event: { ...input.event, id: `ai_${randomUUID()}` },
        requestMaterial: { audio: "PRIVATE_AUDIO_SENTINEL", text: "PRIVATE_SOURCE_SENTINEL" } });
      assert.equal(reordered.duplicate, true); assert.equal(reordered.attempt.id, results[0].attempt.id);
      for (const change of [{ requestMaterial: { text: "different" } }, { event: { ...input.event, orgId: "org_b" } },
        { event: { ...input.event, model: "different" } }, { sessionId: "another-session" }]) {
        await assert.rejects(b.reserve({ ...input, ...change }), (e: any) => e.code === "idempotency_conflict");
      }
      const raw = JSON.stringify((await pool.query("SELECT * FROM ai_provider_attempts")).rows);
      assert.doesNotMatch(raw, /PRIVATE_SOURCE_SENTINEL|PRIVATE_AUDIO_SENTINEL/);
      assert.equal((await pool.query("SELECT * FROM ai_usage_events")).rowCount, 1);
    });
    await t.test("pre-dispatch failure releases spending, retains request count and cannot later dispatch", async () => {
      await reset(); const { attempt } = await a.reserve(reserveInput());
      const params = { ...identity(attempt), outcome: "failed" as const };
      await a.settle(params); await b.settle(params);
      assert.equal((await bucket())[0].reserved, "0"); assert.equal((await bucket())[0].consumed, "0");
      assert.equal((await bucket("requests"))[0].consumed, "1");
      assert.equal((await pool.query("SELECT * FROM ai_usage_events")).rowCount, 0);
      await assert.rejects(a.dispatch(attempt.id, "a", "org_a"), AiSpendLedgerError);
    });
    await t.test("successful settlement is idempotent, original reporting has one event, conflicting settlement fails", async () => {
      await reset(); const { attempt } = await a.reserve(reserveInput());
      await a.dispatch(attempt.id, "a", "org_a"); await success(attempt.id); await success(attempt.id);
      assert.equal((await bucket())[0].consumed, "1"); assert.equal((await bucket("text_tokens"))[0].consumed, "3");
      const events = await usage.listEvents(); assert.equal(events.length, 1); assert.equal(events[0].totalTokens, 3);
      await assert.rejects(a.settle({ ...identity(attempt), outcome: "succeeded", usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 } }), (e: any) => e.code === "settlement_conflict");
    });
    await t.test("timeout retains uncertain usage and does not occupy execution slots forever", async () => {
      await reset(); const { attempt } = await a.reserve(reserveInput(event(), { concurrency: { platform: 1 } }));
      await a.dispatch(attempt.id, "a", "org_a");
      await assert.rejects(a.settle({ ...identity(attempt), outcome: "failed" }), AiSpendLedgerError);
      await a.settle({ ...identity(attempt), outcome: "unknown" });
      const firstFinished = (await pool.query("SELECT finished_at FROM ai_provider_attempts WHERE id=$1", [attempt.id])).rows[0].finished_at;
      now = new Date(now.getTime() + 20_000); await b.settle({ ...identity(attempt), outcome: "unknown" });
      assert.deepEqual((await pool.query("SELECT finished_at FROM ai_provider_attempts WHERE id=$1", [attempt.id])).rows[0].finished_at, firstFinished);
      await assert.rejects(b.reserve(reserveInput(event("b"), { concurrency: { platform: 1 } })), AiSpendLimitError);
      now = new Date(now.getTime() + 41_000);
      await b.reserve(reserveInput(event("b"), { concurrency: { platform: 1 } }));
      assert.equal((await usage.listEvents()).length, 2); assert.equal((await bucket())[0].reserved, "1");
      await success(attempt.id); assert.equal((await bucket())[0].consumed, "1");
    });
    await t.test("crashed reserved leases release only unspent claims; dispatched leases become unknown and retain spending", async () => {
      await reset();
      const unspent = (await a.reserve(reserveInput())).attempt;
      const dispatched = (await b.reserve(reserveInput(event("b")))).attempt;
      await b.dispatch(dispatched.id, "b", "org_a"); now = new Date(now.getTime() + 61_000);
      assert.equal(await a.reconcileExpired(), 2); assert.equal(await b.reconcileExpired(), 0);
      assert.deepEqual((await pool.query("SELECT state FROM ai_provider_attempts ORDER BY actor_id")).rows.map((r) => r.state), ["failed", "unknown"]);
      assert.equal((await usage.listEvents()).length, 1); assert.equal((await usage.listEvents())[0].userId, "b");
      assert.equal((await bucket())[0].reserved, "1");
      await assert.rejects(a.dispatch(unspent.id, "a", "org_a"), AiSpendLedgerError);
      await a.reserve(reserveInput(event("c"), { concurrency: { platform: 1 } }));
    });
    await t.test("concurrent execution claims at exact user/org/platform bound are atomic", async () => {
      for (const scope of ["user", "org", "platform"] as const) {
        await reset();
        const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => (index % 2 ? a : b).reserve(reserveInput(event(), { concurrency: { [scope]: 2 } }))));
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
        assert.equal(results.filter((r) => r.status === "rejected" && r.reason instanceof AiSpendLimitError).length, 6);
      }
    });
    await t.test("delayed and post-response settlement stays in the original UTC window across midnight", async () => {
      await reset(); const e = event(); const { attempt } = await a.reserve(reserveInput(e));
      await a.dispatch(attempt.id, "a", "org_a"); now = new Date("2026-10-21T00:01:00Z"); await success(attempt.id);
      await usage.appendEvent({ ...e, inputTokens: 2, outputTokens: 1, totalTokens: 3, createdAt: now.toISOString() });
      await b.reserve(reserveInput(event("b")));
      const days = await bucket(); assert.equal(days.length, 2);
      assert.equal(days[0].window_start.toISOString(), "2026-10-20T00:00:00.000Z");
      assert.equal(days[0].consumed, "1"); assert.equal(days[1].reserved, "1");
      const old = (await usage.listEvents()).find((row) => row.id === e.id)!;
      assert.equal(old.createdAt, "2026-10-20T23:59:59.000Z");
    });
    await t.test("partial settlement failure rolls back claims and event together; retry commits once", async () => {
      await reset(); const { attempt } = await a.reserve(reserveInput()); await a.dispatch(attempt.id, "a", "org_a");
      await pool.query(`CREATE FUNCTION fail_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;
        CREATE TRIGGER fail_settlement BEFORE UPDATE ON ai_usage_events FOR EACH ROW EXECUTE FUNCTION fail_settlement()`);
      await assert.rejects(success(attempt.id), /injected/);
      assert.equal((await bucket("text_tokens"))[0].reserved, "10");
      assert.equal((await usage.listEvents())[0].totalTokens, 10);
      await pool.query("DROP TRIGGER fail_settlement ON ai_usage_events; DROP FUNCTION fail_settlement()");
      await success(attempt.id); await success(attempt.id);
      assert.equal((await bucket("text_tokens"))[0].consumed, "3");
    });
    await t.test("successful score and TTS adapter accounting preserves old events and measures only known audio units", async () => {
      await reset(); let calls = 0;
      for (const kind of ["score", "tts"] as const) {
        const e = event("a", "org_a", kind);
        const result = await invokeWithAiSpendLedger({ store: a, event: e, userTimeZone: "UTC", legacyLimits: unlimited,
          requestMaterial: { text: "PRIVATE_GENERATED_SENTINEL" }, units: kind === "tts" ? { tts_characters: 72 } : undefined,
          invoke: async () => { calls++; return { value: "existing-contract" }; },
          resolveUsage: kind === "score" ? () => ({ inputTokens: 2, outputTokens: 1, totalTokens: 3 }) : undefined,
          budgetMessage: () => "safe budget message" });
        assert.equal(result.value.value, "existing-contract");
      }
      assert.equal(calls, 2); const events = await usage.listEvents(); assert.equal(events.length, 2);
      assert.equal(events.find((e) => e.kind === "tts")!.totalTokens, 0);
      const rows = (await pool.query("SELECT * FROM ai_provider_attempts")).rows;
      assert.equal(rows.find((r) => r.kind === "tts").tts_characters, "72");
      assert.ok(rows.every((r) => r.stt_milliseconds === null && r.estimated_cost_microusd === null));
      assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_GENERATED_SENTINEL/);
    });
    await t.test("adapter budget refusal and database outage cannot dispatch the provider", async () => {
      await reset(); let calls = 0;
      const input = { store: a, event: event(), userTimeZone: "UTC", legacyLimits: { ...unlimited, globalCalls: 0 },
        requestMaterial: null, invoke: async () => { calls++; return "must not run"; }, budgetMessage: () => "Approved budget explanation" };
      await assert.rejects(invokeWithAiSpendLedger(input), /Approved budget explanation/);
      const badUrl = new URL(scopedUrl); badUrl.port = "1";
      const offline = new AiSpendLedgerStore({ ...options, databaseUrl: badUrl.toString(), pgConnectTimeoutMs: 100 });
      try { await assert.rejects(invokeWithAiSpendLedger({ ...input, store: offline, legacyLimits: unlimited })); }
      finally { await offline.close(); }
      assert.equal(calls, 0); assert.equal((await usage.listEvents()).length, 0);
    });
    await t.test("provider work executes without the transaction/advisory lock and a dispatch response loss fails closed", async () => {
      await reset();
      const invoke = async () => {
        const verifier = await pool.connect();
        try {
          await verifier.query("BEGIN");
          assert.equal((await verifier.query("SELECT pg_try_advisory_xact_lock($1::integer) AS available", [0x504149])).rows[0].available, true);
        } finally { await verifier.query("ROLLBACK"); verifier.release(); }
        return "existing response";
      };
      const input = { store: a, event: event(), userTimeZone: "UTC", legacyLimits: unlimited, requestMaterial: null,
        invoke, budgetMessage: () => "safe" };
      await invokeWithAiSpendLedger(input);
      let calls = 0;
      const lostCommit = new Proxy(a, { get(target, property) {
        if (property === "dispatch") return async (...args: Parameters<typeof a.dispatch>) => { await target.dispatch(...args); throw Error("lost dispatch commit response"); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
      await assert.rejects(invokeWithAiSpendLedger({ ...input, store: lostCommit, event: event("b"), invoke: async () => { calls++; } }), /lost dispatch commit response/);
      assert.equal(calls, 0);
      assert.equal((await pool.query("SELECT state FROM ai_provider_attempts WHERE actor_id='b'")).rows[0].state, "dispatched");
      now = new Date(now.getTime() + 121_000); await b.reconcileExpired();
      assert.equal((await pool.query("SELECT state FROM ai_provider_attempts WHERE actor_id='b'")).rows[0].state, "unknown");
    });
    await t.test("unmeasured cost reservations are retained conservatively; explicit zero usage and safe request IDs can reconcile", async () => {
      await reset();
      const { attempt } = await a.reserve(reserveInput(event(), { units: { estimated_cost_microusd: 100, stt_milliseconds: 2000 } }));
      await a.dispatch(attempt.id, "a", "org_a");
      await a.settle({ ...identity(attempt), outcome: "succeeded", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 }, providerRequestId: "req_test" });
      assert.equal((await bucket("estimated_cost_microusd"))[0].consumed, "100");
      assert.equal((await bucket("stt_milliseconds"))[0].consumed, "2000");
      const row = (await pool.query("SELECT * FROM ai_provider_attempts WHERE id=$1", [attempt.id])).rows[0];
      assert.equal(row.provider_request_id, "req_test"); assert.equal(row.stt_milliseconds, null, "retained estimate is not a fabricated measurement");
      const next = (await a.reserve(reserveInput(event("b")))).attempt; await b.dispatch(next.id, "b", "org_a");
      await b.settle({ ...identity(next, "b"), outcome: "failed", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
      assert.equal((await pool.query("SELECT state FROM ai_provider_attempts WHERE id=$1", [next.id])).rows[0].state, "failed");
    });
    await t.test("adapter provider timeout retains one unknown attempt and conservative existing usage", async () => {
      await reset(); const failure = new Error("simulated timeout after dispatch");
      await assert.rejects(invokeWithAiSpendLedger({ store: a, event: event(), userTimeZone: "UTC", legacyLimits: unlimited,
        requestMaterial: null, invoke: async () => { throw failure; }, budgetMessage: () => "safe" }), (e) => e === failure);
      assert.equal((await pool.query("SELECT state FROM ai_provider_attempts")).rows[0].state, "unknown");
      assert.equal((await usage.listEvents()).length, 1); assert.equal((await bucket())[0].reserved, "1");
    });
    await t.test("ownership and organization are rechecked for dispatch and settlement", async () => {
      await reset(); const { attempt } = await a.reserve(reserveInput());
      await assert.rejects(b.dispatch(attempt.id, "b", "org_a"), (e: any) => e.code === "attempt_unavailable");
      await assert.rejects(b.dispatch(attempt.id, "a", "org_b"), (e: any) => e.code === "attempt_unavailable");
      await a.dispatch(attempt.id, "a", "org_a");
      await assert.rejects(success(attempt.id, "b"), (e: any) => e.code === "attempt_unavailable");
      await success(attempt.id);
    });
  } finally { await a.close(); await b.close(); await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); }
});
