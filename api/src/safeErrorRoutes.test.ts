import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { startPromptRouteHarness, ROUTE_USER_ID, STANDARD_ORG_ID, STANDARD_SCENARIO_ID,
  type PromptRouteHarness } from "./simulationPromptRoutes.testSupport.js";
import { AiBudgetLimitError, classifyAiRouteError, safeErrorDiagnostics } from "./services/safeErrors.js";
import { createTrainingPackStore } from "./storage/trainingPackStore.js";
import { AuthCodeDeliveryError } from "./services/authCodeDelivery.js";

const secret = "sk-proj-DO_NOT_DISCLOSE_PROVIDER_CREDENTIAL";
const privateText = "PRIVATE_UTTERANCE_AND_PROVIDER_JSON_FRAGMENT";
const internal = `constraint private_schema.accounts_password_key C:\\private\\db.sql ${secret} ${privateText}`;
let harness: PromptRouteHarness;
let api: typeof import("./index.js");
let masterToken: string;
let harnessFetch: typeof fetch;
let providerMode: "failure" | "malformed_score" | "invalid_score" | "non_json_score" | "transcribe_success" | "timeout" = "failure";
const logs: unknown[][] = [];
const savedConsole = { log: console.log, warn: console.warn, error: console.error };
const history = [
  { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
  { role: "assistant", content: "We need a plan." }, { role: "user", content: "Let us agree on a date and owner." },
  { role: "assistant", content: "What next?" }, { role: "user", content: "I will follow up tomorrow." },
];
const common = { scenarioId: STANDARD_SCENARIO_ID, industryId: "technology", difficulty: "medium", personaStyle: "skeptical", history };

function json(body: unknown, headers?: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}
function audio(responseMode?: string): RequestInit {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(2048)], { type: "audio/mp4" }), "voice.m4a");
  form.append("payload", JSON.stringify({ scenarioId: STANDARD_SCENARIO_ID, industryId: "technology",
    difficulty: "medium", personaStyle: "skeptical", ...(responseMode ? { responseMode } : {}) }));
  return { method: "POST", body: form };
}
function assertSafe(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [secret, privateText, "private_schema", "accounts_password_key", "db.sql"]) {
    assert.equal(serialized.includes(forbidden), false, `must not disclose ${forbidden}`);
  }
}
async function checkFailure(response: Response, status: number, code: string) {
  assert.equal(response.status, status, response.status === status ? undefined : await response.text());
  const body = await response.json() as { error: string; code: string; correlationId: string };
  assert.equal(body.code, code);
  assert.ok(body.error);
  assert.ok(body.correlationId);
  assert.equal(response.headers.get("x-correlation-id"), body.correlationId);
  assert.ok(logs.some(([label, detail]) => label === "[api-error]"
    && (detail as { correlationId: string }).correlationId === body.correlationId));
  assertSafe(body);
  assertSafe(logs);
  return body;
}

before(async () => {
  harness = await startPromptRouteHarness({ modularEnvironmentEnabled: false, remoteTtsEnabled: true });
  api = await import("./index.js");
  const login = await harness.request("/auth/login", json({ password: "prompt-route-admin-password" }));
  assert.equal(login.status, 200);
  masterToken = (await login.json() as { token: string }).token;
  harnessFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.openai.com/")) return harnessFetch(input, init);
    if (providerMode === "timeout") throw Object.assign(new Error(internal), { name: "OpenAiChatRequestTimeoutError" });
    if ((providerMode === "transcribe_success") && url.endsWith("/audio/transcriptions")) {
      return new Response(JSON.stringify({ text: "I would like to discuss a concrete next step." }), { status: 200 });
    }
    if (providerMode === "malformed_score" || providerMode === "invalid_score" || providerMode === "non_json_score") {
      return new Response(JSON.stringify({ output_text: providerMode === "malformed_score"
        ? `{"summary":"${internal}", INVALID}` : providerMode === "non_json_score" ? internal
          : JSON.stringify({ summary: internal }), model: "mock-model" }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: internal, type: secret, code: secret } }), { status: 401 });
  }) as typeof fetch;
  for (const level of ["log", "warn", "error"] as const) console[level] = (...args) => { logs.push(args); };
});
after(async () => {
  Object.assign(console, savedConsole);
  api.setDatabaseSaveBarrierForTest(null);
  globalThis.fetch = harnessFetch;
  await harness.close();
});

test("global database-style exceptions return generic 500 with matching safe diagnostics and correlation", async () => {
  api.setDatabaseSaveBarrierForTest(async () => { throw Object.assign(new Error(internal), { code: "23505" }); });
  try {
    const result = await harness.request("/config", { ...json({ defaultDifficulty: "hard" }, { Authorization: `Bearer ${masterToken}` }), method: "PATCH" });
    await checkFailure(result, 500, "internal_error");
    assert.ok(logs.some(([label, detail]) => label === "[api-error]" && (detail as { databaseCode?: string }).databaseCode === "23505"));
  } finally { api.setDatabaseSaveBarrierForTest(null); }
});

test("authentication delivery server failures retain status without disclosing upstream text", async () => {
  api.setDatabaseSaveBarrierForTest(async () => { throw new AuthCodeDeliveryError(internal, 502); });
  try {
    await checkFailure(await harness.request("/config", { ...json({ defaultDifficulty: "hard" },
      { Authorization: `Bearer ${masterToken}` }), method: "PATCH" }), 502, "internal_error");
  } finally { api.setDatabaseSaveBarrierForTest(null); }
});

test("training-pack create and update sanitize unexpected storage failures while preserving validation", async () => {
  const store = createTrainingPackStore({ provider: "file", databaseUrl: null,
    pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 1000 });
  const fail = async (): Promise<never> => { throw Object.assign(new Error(internal), { code: "23505" }); };
  store.createTrainingPackForOrg = fail;
  store.updateTrainingPackForOrg = fail;
  api.setContentManagementTrainingPackStoreForTest(store);
  try {
    const path = `/orgs/${STANDARD_ORG_ID}/training-packs`;
    const headers = { Authorization: `Bearer ${masterToken}` };
    await checkFailure(await harness.request(path, json({ title: "Example", trainingTopic: "Practice discussion",
      requiredBehavioralTriggers: [] }, headers)), 503, "internal_error");
    await checkFailure(await harness.request(`${path}/example`, { ...json({ title: "Updated" }, headers), method: "PATCH" }), 503, "internal_error");
    const invalid = await harness.request(path, json({ title: "" }, headers));
    assert.equal(invalid.status, 400);
  } finally { api.setContentManagementTrainingPackStoreForTest(null); }
});

for (const route of ["turn", "opening", "transcribe", "tts", "score", "submit-turn", "scenario generation"]) {
  test(`provider 401 secrets are absent from ${route} HTTP responses and logs`, async () => {
    providerMode = "failure";
    const path = route === "scenario generation" ? `/orgs/${STANDARD_ORG_ID}/custom-scenarios/generate`
      : `/mobile/users/${ROUTE_USER_ID}/ai/${route}`;
    const init = route === "transcribe" || route === "submit-turn" ? audio()
      : route === "tts" ? json({ text: "A short reply.", preset: "female-balanced" })
      : route === "scenario generation" ? json({ sourceMode: "scratch", segmentId: "account_executive", applicableIndustryIds: ["technology"] }, { Authorization: `Bearer ${masterToken}` })
      : json({ ...common, startedAt: new Date(Date.now() - 3000).toISOString(), endedAt: new Date().toISOString() });
    await checkFailure(await harness.request(path, init), 503, "ai_unavailable");
  });
}

test("unified submit after successful transcription and deferred reply errors remain safe", async () => {
  providerMode = "transcribe_success";
  await checkFailure(await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/submit-turn`, audio()), 503, "ai_unavailable");
  const initial = await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/submit-turn`, audio("transcript_first_v1"));
  assert.equal(initial.status, 200);
  const body = await initial.json() as { correlationId: string };
  const id = body.correlationId ?? initial.headers.get("x-correlation-id");
  assert.ok(id);
  // Observe the pending operation settling before polling; this also avoids
  // leaving the existing long-poll timeout alive in the test process.
  const deadline = Date.now() + 5000;
  while (!logs.some(([, detail]) => (detail as { stage?: string; correlationId?: string })?.stage === "pending_turn_rejected"
    && (detail as { correlationId?: string }).correlationId === id)) {
    assert.ok(Date.now() < deadline, "mocked pending provider failure did not settle");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await checkFailure(await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/submit-turn-await/${id}`), 503, "ai_unavailable");
});

for (const mode of ["malformed_score", "invalid_score", "non_json_score"] as const) {
  test(`${mode} returns 502 without exposing generated JSON excerpts`, async () => {
    providerMode = mode;
    await checkFailure(await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/score`, json({ ...common,
      startedAt: new Date(Date.now() - 3000).toISOString(), endedAt: new Date().toISOString() })), 502, "score_generation_failed");
  });
}
test("known provider timeout returns 504 with a safe distinguishable code", async () => {
  providerMode = "timeout";
  await checkFailure(await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/turn`, json(common)), 504, "ai_timeout");
});
test("budget classification preserves approved 429 explanation and does not misclassify provider 401", () => {
  assert.deepEqual(classifyAiRouteError(new AiBudgetLimitError("Daily AI request limit reached for this account.")), {
    status: 429, code: "ai_budget_limit", error: "Daily AI request limit reached for this account.",
  });
  assert.equal(classifyAiRouteError(Object.assign(new Error(internal), { statusCode: 401 })).status, 503);
  assertSafe(safeErrorDiagnostics(Object.assign(new Error(internal), { name: internal, code: secret, statusCode: 401 })));
});
test("JSON parsing, request authentication and expected scenario validation keep useful 4xx responses", async () => {
  const invalidJson = await harness.request("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await invalidJson.json(), { error: "Request body must be valid JSON." });
  const denied = await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/turn`, json(common, { Authorization: "Bearer invalid" }));
  assert.equal(denied.status, 401);
  const invalid = await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/opening`, json({ ...common, scenarioId: "missing" }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid scenario for this account." });
});
