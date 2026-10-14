import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DatabaseStorage } from "./storage.js";

// Run the identical HTTP/provider assertions in each authority-mode harness.
export async function assertIndustryCacheParity(params: {
  mode: "legacy" | "assignments";
  storage: DatabaseStorage;
  patch: (path: string, body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
  pool: Pool;
  call: (path: string, body?: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
  userId: string;
  otherUserId: string;
  orgId: string;
  segmentId: string;
  scenarioId: string;
  industryId: string;
  alternateIndustryId: string;
}) {
  const { call, userId, orgId, segmentId, scenarioId, industryId, alternateIndustryId, pool } = params;
  const before = await params.storage.load();
  const originalConfig = structuredClone(before.config);
  const originalSelections = [...before.orgs.find((org) => org.id === orgId)!.activeIndustries];
  const patch = async (path: string, body: Record<string, unknown>) => {
    const result = await params.patch(path, body);
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  const requests: Array<{ system: string; evaluation: boolean }> = [];
  const cacheEvents: Array<{ cacheStatus?: string; cacheReason?: string }> = [];
  const savedFetch = globalThis.fetch;
  const savedLog = console.log;
  console.log = (...args: unknown[]) => {
    const event = args[1] as { route?: string; cacheStatus?: string; cacheReason?: string } | undefined;
    if (args[0] === "[simulation-route]" && event?.route === "turn" && event.cacheStatus) cacheEvents.push(event);
    savedLog(...args);
  };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (target === "https://api.openai.com/v1/responses") {
      const request = JSON.parse(String(init?.body)) as { input: Array<{ role: string; content: string }> };
      const system = request.input.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      assert.ok(system.length > 0);
      const evaluation = system.includes("expert communication coach");
      requests.push({ system, evaluation });
      const output = evaluation ? JSON.stringify({ communicationScore: 80, outcomeScore: 75, overallScore: 78,
        completionLevel: "complete", objectiveAchieved: true, persuasion: 8, clarity: 7, empathy: 9, assertiveness: 8,
        strengths: ["Clear framing"], improvements: ["Tighter close"], summary: "Handled the conversation well." })
        : "Let us discuss the account.";
      return Promise.resolve(new Response(JSON.stringify({ output_text: output, model: "local-test-model",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }), { status: 200 }));
    }
    return savedFetch(input, init);
  }) as typeof fetch;
  const body = { scenarioId, industryId, difficulty: "medium", personaStyle: "skeptical",
    history: [{ role: "user", content: "Please discuss the account." }] };
  const warmId = `cache_parity_${randomUUID()}`;
  const nullSnapshotId = `cache_null_snapshot_${randomUUID()}`;
  const turn = async (sessionId: string, overrides: Record<string, unknown> = {}) => {
    const count = requests.length;
    const result = await call(`/mobile/users/${userId}/ai/turn`, { ...body, simulationSessionId: sessionId, ...overrides });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(requests.length, count + 1);
    return requests.at(-1)!.system;
  };
  const score = async (expectedIndustry: string | null, sessionId = `cache_score_${randomUUID()}`) => {
    const result = await call(`/mobile/users/${userId}/ai/score`, {
      ...body, simulationSessionId: sessionId,
      startedAt: new Date(Date.now() - 2000).toISOString(), endedAt: new Date().toISOString(),
      history: [
        { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
        { role: "assistant", content: "We need a plan." }, { role: "user", content: "Let us set owners and a review date." },
        { role: "assistant", content: "What next?" }, { role: "user", content: "We will follow up tomorrow." },
      ],
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const row = await pool.query("SELECT industry_id FROM score_records WHERE simulation_session_id=$1", [sessionId]);
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].industry_id, expectedIndustry);
    assert.equal(requests.at(-1)!.evaluation, true);
    assert.equal(requests.at(-1)!.system.includes("CACHE_ORIGINAL_BASELINE"), expectedIndustry === industryId);
  };
  try {
    const config = structuredClone(originalConfig);
    config.industries = config.industries.map((industry) => industry.id === industryId
      ? { ...industry, enabled: true, aiBaseline: "CACHE_ORIGINAL_BASELINE" }
      : industry.id === alternateIndustryId ? { ...industry, enabled: true, aiBaseline: "CACHE_OTHER_BASELINE" } : industry);
    config.roleIndustries = config.roleIndustries.filter((row) => row.roleId !== segmentId);
    config.roleIndustries.push(
      { roleId: segmentId, industryId, active: true },
      { roleId: segmentId, industryId: alternateIndustryId, active: true },
    );
    await patch("/config", config as unknown as Record<string, unknown>);
    await patch(`/orgs/${orgId}`, { activeIndustries: [industryId, alternateIndustryId] });
    const active = await turn(warmId);
    assert.match(active, /CACHE_ORIGINAL_BASELINE/);
    assert.equal(await turn(warmId), active);
    assert.equal(cacheEvents.at(-1)?.cacheStatus, "hit");
    await score(industryId);
    if (params.mode === "assignments") {
      const start = await call(`/mobile/users/${userId}/simulation-sessions/start`, {
        simulationSessionId: nullSnapshotId, segmentId, scenarioId,
      });
      assert.equal(start.status, 201, JSON.stringify(start.body));
      await pool.query("UPDATE simulation_sessions SET industry_snapshot=NULL WHERE simulation_session_id=$1", [nullSnapshotId]);
      assert.equal(await turn(nullSnapshotId), active);
    }
    await patch(`/orgs/${orgId}`, { activeIndustries: [alternateIndustryId] });
    const deactivated = await turn(warmId);
    assert.doesNotMatch(deactivated, /CACHE_ORIGINAL_BASELINE|CACHE_OTHER_BASELINE/);
    assert.equal(cacheEvents.at(-1)?.cacheStatus, "miss");
    assert.equal(cacheEvents.at(-1)?.cacheReason, "eligibility_changed");
    assert.equal(await turn(`cold_${randomUUID()}`), deactivated, "cached and uncached system prompts must be byte-identical");
    assert.equal(await turn(warmId), deactivated);
    assert.equal(cacheEvents.at(-1)?.cacheStatus, "hit");
    await score(null);
    if (params.mode === "assignments") {
      assert.equal(await turn(nullSnapshotId), deactivated, "registered NULL-snapshot sessions use live context");
      await score(null, nullSnapshotId);
      assert.equal((await pool.query("SELECT industry_snapshot FROM simulation_sessions WHERE simulation_session_id=$1", [nullSnapshotId])).rows[0].industry_snapshot, null);
    }
    await patch(`/orgs/${orgId}`, { activeIndustries: [industryId, alternateIndustryId] });
    assert.equal(await turn(warmId), active, "reactivation replaces the cached no-industry context");
    assert.equal(cacheEvents.at(-1)?.cacheReason, "eligibility_changed");
    assert.equal(await turn(`reactivated_cold_${randomUUID()}`), active);
    await score(industryId);
    const noIndustryId = `no_industry_${randomUUID()}`;
    const noIndustry = await turn(noIndustryId, { industryId: undefined });
    assert.doesNotMatch(noIndustry, /CACHE_ORIGINAL_BASELINE|CACHE_OTHER_BASELINE/);
    assert.equal(await turn(noIndustryId, { industryId: undefined }), noIndustry);
    assert.equal(cacheEvents.at(-1)?.cacheStatus, "hit");
    assert.equal(await turn(`no_industry_cold_${randomUUID()}`, { industryId: undefined }), noIndustry);
    const providerCount = requests.length;
    const impersonation = await call(`/mobile/users/${params.otherUserId}/ai/turn`, { ...body, simulationSessionId: warmId });
    assert.equal(impersonation.status, 401);
    assert.equal(requests.length, providerCount);
    config.segments.find((segment) => segment.id === segmentId)!.scenarios.find((scenario) => scenario.id === scenarioId)!.enabled = false;
    await patch("/config", config as unknown as Record<string, unknown>);
    for (const simulationSessionId of [warmId, `revoked_cold_${randomUUID()}`]) {
      const result = await call(`/mobile/users/${userId}/ai/turn`, { ...body, simulationSessionId });
      assert.ok([400, 404].includes(result.status), JSON.stringify(result.body));
    }
    assert.equal(requests.length, providerCount, "revoked scenarios must not reach the provider on hits or misses");
  } finally {
    globalThis.fetch = savedFetch;
    console.log = savedLog;
    await patch("/config", originalConfig as unknown as Record<string, unknown>);
    await patch(`/orgs/${orgId}`, { activeIndustries: originalSelections });
  }
}
