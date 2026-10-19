import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as apiErrors from "./apiError";

// Execute the real HTTP/recovery implementation; only native imports, fetch and
// timers are substituted so timeout/retry tests do not sleep or require a device.
function apiHarness(fetch: typeof globalThis.fetch) {
  const timers = new Map<number, { callback: () => void; ms: number }>();
  const delays: number[] = [];
  let timerId = 0;
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./api.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports, fetch, Error, TypeError, AbortController, URL, URLSearchParams, FormData, Blob, Uint8Array,
    process: { env: { EXPO_PUBLIC_API_BASE_URL: "https://test.invalid" } }, __DEV__: false,
    require: (name: string) => {
      if (name === "./apiError") return apiErrors;
      if (name === "react-native") return { Platform: { OS: "web" }, NativeModules: {} };
      if (name === "expo-file-system") return { File: class {} };
      if (name === "./ttsAudioOrigin") return {};
      throw new Error(`Unexpected native dependency: ${name}`);
    },
    setTimeout: (callback: () => void, ms: number) => {
      const id = ++timerId;
      timers.set(id, { callback, ms });
      if (ms < 5000) {
        delays.push(ms);
        queueMicrotask(() => { if (timers.delete(id)) callback(); });
      }
      return id;
    },
    clearTimeout: (id: number) => { timers.delete(id); },
  });
  return {
    api: exports as Pick<typeof import("./api"), "fetchAiScore" | "recoverPersistedAiScore" | "fetchAiOpeningLine" | "fetchAiTurn" | "transcribeAudioViaApi">,
    delays,
    fire(ms: number) {
      const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, `Expected ${ms}ms timeout`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

const params: Parameters<typeof import("./api").fetchAiScore>[0] = {
  userId: "learner", authToken: "test-token", simulationSessionId: "pinned-session",
  scenarioId: "scenario", difficulty: "medium", personaStyle: "skeptical", startedAt: "2026-10-14T10:00:00Z",
  endedAt: "2026-10-14T10:05:00Z", history: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("lost scoring response recovers by session GET without repeating generation POST", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const saved = { status: "scored", scorecard: { overallScore: 80 }, record: { id: "saved-score" } };
  const harness = apiHarness(async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? "GET" });
    if (init?.method === "POST") throw new TypeError("Network request failed");
    if (requests.length === 2) return json({ error: "Try later", code: "ai_unavailable" }, 503);
    if (requests.length === 3) return json({ error: "Score not found for this session" }, 404);
    return json(saved);
  });
  await assert.rejects(harness.api.fetchAiScore(params), /Network request failed/);
  assert.deepEqual(await harness.api.recoverPersistedAiScore(params), saved);
  assert.equal(requests.filter((row) => row.method === "POST").length, 1);
  assert.equal(requests.filter((row) => row.method === "GET").length, 3);
  assert.ok(requests.slice(1).every((row) => row.url.endsWith("/ai/score?simulationSessionId=pinned-session")));
  assert.deepEqual(harness.delays, [600, 1200]);
});

test("local scoring timeout keeps 45 second limit and bounded recovery never fabricates a score", async () => {
  let posts = 0;
  let gets = 0;
  const harness = apiHarness(async (_url, init) => {
    if (init?.method === "POST") {
      posts++;
      queueMicrotask(() => harness.fire(45_000));
      return new Promise<Response>(() => {});
    }
    gets++;
    return json({ error: "Please retry later", code: "ai_timeout" }, 504);
  });
  await assert.rejects(harness.api.fetchAiScore(params), /Request timed out after 45 seconds/);
  assert.equal(await harness.api.recoverPersistedAiScore(params), null);
  assert.equal(posts, 1);
  assert.equal(gets, 5);
  assert.deepEqual(harness.delays, [600, 1200, 1800, 2400]);
});

test("score provider failures are surfaced once; unauthorized recovery stops immediately", async () => {
  for (const [status, code] of [[429, "ai_budget_limit"], [503, "ai_unavailable"], [502, "score_generation_failed"]] as const) {
    let calls = 0;
    const harness = apiHarness(async () => { calls++; return json({ error: "Safe service error", code }, status); });
    await assert.rejects(harness.api.fetchAiScore(params), (error: unknown) => error instanceof apiErrors.MobileApiError && error.code === code);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const harness = apiHarness(async () => { calls++; return json({ error: "Access revoked" }, 403); });
  assert.equal(await harness.api.recoverPersistedAiScore(params), null);
  assert.equal(calls, 1);
});

test("malformed error bodies retain HTTP status; successful score responses remain authoritative", async () => {
  const malformed = apiHarness(async () => new Response("not JSON", { status: 503 }));
  await assert.rejects(malformed.api.fetchAiScore(params), (error: unknown) =>
    error instanceof apiErrors.MobileApiError && error.status === 503 && error.code === null);
  const saved = { status: "not_scored", reason: "insufficient_evidence", minimumUserTurns: 3 };
  const success = apiHarness(async () => json(saved));
  assert.deepEqual(await success.api.fetchAiScore(params), saved);
});

test("opening turn and transcription preserve structured failures without producing substitute replies", async () => {
  for (const code of ["ai_unavailable", "ai_budget_limit", "ai_timeout"]) {
    let calls = 0;
    const harness = apiHarness(async (url) => {
      if (String(url) === "https://audio.invalid/test") return new Response(new Blob(["test audio"]));
      calls++;
      return json({ error: "Safe service error", code }, code === "ai_timeout" ? 504 : 503);
    });
    const invoke = [
      () => harness.api.fetchAiOpeningLine(params),
      () => harness.api.fetchAiTurn(params),
      () => harness.api.transcribeAudioViaApi({ ...params, audioUri: "https://audio.invalid/test", mimeType: "audio/webm" }),
    ];
    for (const run of invoke) {
      await assert.rejects(run(), (error: unknown) => {
        assert.ok(error instanceof apiErrors.MobileApiError);
        assert.equal(error.code, code);
        return true;
      });
    }
    assert.equal(calls, 3);
  }
});

test("lifecycle 409 responses are not retried and score recovery preserves an existing score", async () => {
  for (const code of ["session_expired", "session_completed"]) {
    const requests: string[] = [];
    const persisted = { status: "scored", scorecard: { overallScore: 80 }, record: { id: "original-score" } };
    const harness = apiHarness(async (url, init) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      return init?.method === "POST" ? json({ error: "Simulation session ended", code }, 409) : json(persisted);
    });
    for (const request of [() => harness.api.fetchAiOpeningLine(params), () => harness.api.fetchAiTurn(params),
      () => harness.api.fetchAiScore(params)]) {
      await assert.rejects(request(), apiErrors.isSimulationSessionEndedError);
    }
    assert.equal(requests.length, 3, "one HTTP request per action; no expired-conversation retry");
    assert.deepEqual(await harness.api.recoverPersistedAiScore(params), persisted);
    assert.equal(requests.length, 4);
    assert.ok(requests[3]!.endsWith("/ai/score?simulationSessionId=pinned-session"));
    assert.deepEqual(harness.delays, []);
  }
});
