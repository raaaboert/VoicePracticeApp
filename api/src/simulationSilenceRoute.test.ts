import assert from "node:assert/strict";
import test from "node:test";
import { syntheticSpeechAudio } from "./services/speechActivity.testSupport.js";
import { startPromptRouteHarness, ROUTE_USER_ID, STANDARD_SCENARIO_ID } from "./simulationPromptRoutes.testSupport.js";

test("no-speech ASR result cannot generate a dialogue turn or score, for both submission modes", async () => {
  const harness = await startPromptRouteHarness({ modularEnvironmentEnabled: false });
  const harnessFetch = globalThis.fetch;
  let assistantCalls = 0;
  let transcript = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.openai.com/v1/audio/transcriptions") return Response.json({ text: transcript, languages: [] });
    if (url.startsWith("https://api.openai.com/")) assistantCalls++;
    return harnessFetch(input, init);
  };
  function audio(responseMode?: string): RequestInit {
    const form = new FormData();
    form.append("file", new Blob([syntheticSpeechAudio()], { type: "audio/mp4" }), "synthetic.m4a");
    form.append("payload", JSON.stringify({ scenarioId: STANDARD_SCENARIO_ID, industryId: "technology",
      difficulty: "medium", personaStyle: "skeptical", ...(responseMode ? { responseMode } : {}) }));
    return { method: "POST", body: form };
  }
  try {
    for (const mode of [undefined, "transcript_first_v1"]) {
      const response = await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/submit-turn`, audio(mode));
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json() as any;
      assert.equal(body.outcome, "no_clear_speech");
      assert.equal(body.transcriptText, "");
      assert.equal(body.assistantReply, undefined);
      assert.equal(assistantCalls, 0);
      assert.deepEqual(await harness.readPersistedScoreRecords(), []);
    }
    transcript = "I will identify the concern and agree a clear next step.";
    const ordinary = await harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/submit-turn`, audio());
    assert.equal(ordinary.status, 200, await ordinary.clone().text());
    assert.equal((await ordinary.json() as any).transcriptText, transcript);
    assert.equal(assistantCalls, 1, "ordinary speech still generates the assistant reply");
  } finally {
    globalThis.fetch = harnessFetch;
    await harness.close();
  }
});
