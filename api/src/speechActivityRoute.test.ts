import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, readdir, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startPromptRouteHarness, ROUTE_USER_ID, STANDARD_SCENARIO_ID } from "./simulationPromptRoutes.testSupport.js";
import { setSpeechActivityOptionsForTest, speechActivityCapacityForTest } from "./services/speechActivity.js";

test("both actual upload routes gate ASR on decoded speech, with no mobile meter evidence", async (t) => {
  const harness = await startPromptRouteHarness({ modularEnvironmentEnabled: false });
  const harnessFetch = globalThis.fetch;
  let asrCalls = 0, assistantCalls = 0;
  // This stub is deliberately ready to fabricate a sentence for ANY audio.
  // The gate must stop it, not reject its wording after the fact.
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      asrCalls++; return Response.json({ text: "Thank you for watching.", languages: [{ code: "en" }] });
    }
    if (url.startsWith("https://api.openai.com/")) assistantCalls++;
    return harnessFetch(input, init);
  };
  function request(route: string, bytes: Buffer, responseMode?: string, signal?: AbortSignal) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/m4a" }), "synthetic.m4a");
    if (route === "submit-turn") form.append("payload", JSON.stringify({ scenarioId: STANDARD_SCENARIO_ID, industryId: "technology",
      difficulty: "medium", personaStyle: "skeptical", ...(responseMode ? { responseMode } : {}) }));
    return harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/${route}`, { method: "POST", body: form, signal });
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "peritio-speech-route-test-"));
  const temporaryRoot = path.join(root, "inputs"); await mkdir(temporaryRoot);
  try {
    setSpeechActivityOptionsForTest({ temporaryRoot });
    for (const route of ["transcribe", "submit-turn"]) {
      for (const [name, speech] of [["digital-silence", false], ["hiss", false], ["room-noise-surrogate", false],
        ["mechanical-noise-surrogate", false], ["quiet-speech", true], ["short-word", true], ["normal-speech", true]] as const) {
        await t.test(`${route}: ${name}`, async () => {
          const beforeAsr = asrCalls, beforeAssistant = assistantCalls;
          const bytes = await readFile(new URL(`../test-fixtures/speech/${name}.m4a`, import.meta.url));
          const response = await request(route, bytes);
          assert.equal(response.status, 200, await response.clone().text());
          const body = await response.json() as any;
          assert.equal(asrCalls - beforeAsr, speech ? 1 : 0);
          assert.equal(assistantCalls - beforeAssistant, speech && route === "submit-turn" ? 1 : 0);
          if (route === "transcribe") assert.equal(body.text, speech ? "Thank you for watching." : "");
          else if (speech) {
            assert.equal(body.outcome, "assistant_reply");
            assert.equal(body.transcriptText, "Thank you for watching.", "genuinely spoken phrases are not blocklisted");
          } else {
            assert.equal(body.outcome, "no_clear_speech"); assert.equal(body.transcriptText, "");
            assert.equal(body.assistantText, undefined); assert.equal(body.speechPrefetch, undefined);
          }
          assert.deepEqual(await harness.readPersistedScoreRecords(), []);
          assert.deepEqual(await readdir(temporaryRoot), []);
        });
      }
      for (const bytes of [Buffer.from("not audio"), (await readFile(new URL("../test-fixtures/speech/normal-speech.m4a", import.meta.url))).subarray(0, 128)]) {
        const before = asrCalls;
        const response = await request(route, bytes);
        assert.equal(response.status, 200);
        const body = await response.json() as any;
        assert.equal(route === "transcribe" ? body.text : body.transcriptText, "");
        assert.equal(asrCalls, before);
      }
    }
    await t.test("transcript-first silence retry cannot start duplicate assistant work", async () => {
      const beforeAsr = asrCalls, beforeAssistant = assistantCalls;
      const bytes = await readFile(new URL("../test-fixtures/speech/digital-silence.m4a", import.meta.url));
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request("submit-turn", bytes, "transcript_first_v1");
        assert.equal((await response.json() as any).outcome, "no_clear_speech");
      }
      assert.equal(asrCalls, beforeAsr); assert.equal(assistantCalls, beforeAssistant);
      assert.deepEqual(await harness.readPersistedScoreRecords(), []);
    });
    await t.test("185-second M4A is rejected on both routes before ASR can receive an unverified tail", async () => {
      const output = path.join(root, "long-control.m4a");
      const converted = spawnSync(createRequire(import.meta.url)("ffmpeg-static"), ["-nostdin", "-v", "error", "-i",
        fileURLToPath(new URL("../test-fixtures/speech/normal-speech.m4a", import.meta.url)),
        "-af", "apad", "-t", "185", "-ar", "16000", "-ac", "1", "-c:a", "aac", output],
        { windowsHide: true, timeout: 10000, maxBuffer: 65536 });
      assert.equal(converted.status, 0);
      const bytes = await readFile(output), beforeAsr = asrCalls, beforeAssistant = assistantCalls;
      for (const route of ["transcribe", "submit-turn"]) {
        const response = await request(route, bytes);
        assert.equal(response.status, 200);
        const body = await response.json() as any;
        assert.equal(route === "transcribe" ? body.text : body.transcriptText, "");
        if (route === "submit-turn") assert.equal(body.outcome, "no_clear_speech");
      }
      assert.equal(asrCalls, beforeAsr); assert.equal(assistantCalls, beforeAssistant);
      assert.deepEqual(await harness.readPersistedScoreRecords(), []);
      assert.deepEqual(await readdir(temporaryRoot), []);
    });
    await t.test("decoder/VAD errors and timeouts remain retryable and fail closed on both routes", async () => {
      const broken = path.join(root, "broken.mjs"), hanging = path.join(root, "hanging.mjs");
      await writeFile(broken, "throw Error('PRIVATE_AUDIO_ERROR');");
      await writeFile(hanging, "process.stdin.resume();setInterval(()=>{},1000);");
      const bytes = await readFile(new URL("../test-fixtures/speech/normal-speech.m4a", import.meta.url));
      for (const options of [{ decoderPath: path.join(root, "missing-decoder") }, { vadWorkerPath: broken },
        { vadWorkerPath: hanging, vadTimeoutMs: 150 }]) {
        setSpeechActivityOptionsForTest({ ...options, temporaryRoot });
        for (const route of ["transcribe", "submit-turn"]) {
          const before = asrCalls;
          const response = await request(route, bytes);
          assert.equal(response.status, 503);
          const body = await response.json() as any;
          assert.equal(body.code, "ai_unavailable");
          assert.ok(body.error.includes("try again"));
          assert.equal(JSON.stringify(body).includes("PRIVATE_AUDIO_ERROR"), false);
          assert.equal(asrCalls, before); assert.deepEqual(await readdir(temporaryRoot), []);
          assert.equal(speechActivityCapacityForTest().active, 0);
        }
      }
      setSpeechActivityOptionsForTest({ temporaryRoot });
      assert.equal((await request("transcribe", bytes)).status, 200, "normal operation recovers after failure");
    });
    await t.test("real HTTP disconnect cancels active VAD, releases capacity and creates no provider work", async () => {
      for (const route of ["transcribe", "submit-turn"]) {
      const hanging = path.join(root, "disconnect.mjs");
      await writeFile(hanging, "process.stdin.resume();setInterval(()=>{},1000);");
      // A synthetic request reaches the real authenticated route using the harness's
      // own request adapter. Abort its fetch after the VAD child starts.
      const bytes = await readFile(new URL("../test-fixtures/speech/normal-speech.m4a", import.meta.url));
      const controller = new AbortController();
      let sawVad!: () => void;
      const entered = new Promise<void>(resolve => { sawVad = resolve; });
      setSpeechActivityOptionsForTest({ temporaryRoot, vadWorkerPath: hanging,
        onProcessStarted: (_pid, stage) => { if (stage === "vad") { sawVad(); controller.abort(); } } });
      const before = asrCalls;
      const call = request(route, bytes, undefined, controller.signal);
      const rejected = assert.rejects(call);
      await entered; await rejected;
      // Queue a real analysis behind the disconnect; it cannot enter until the
      // abandoned child's close/finally has released the one active slot.
      setSpeechActivityOptionsForTest({ temporaryRoot });
      assert.equal((await request("transcribe", bytes)).status, 200);
      assert.equal(asrCalls, before + 1);
      assert.deepEqual(await readdir(temporaryRoot), []);
      assert.deepEqual(speechActivityCapacityForTest(), { active: 0, queued: 0, queuedBytes: 0 });
      }
    });
  } finally {
    setSpeechActivityOptionsForTest(); globalThis.fetch = harnessFetch; await harness.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("peritio-speech-route-test-"));
    await rm(root, { recursive: true, force: true });
  }
});
