import {
  isUsableSimulationTranscript,
  shouldFallbackToLegacyAssistantReply,
  shouldFallbackToLegacyUnifiedSubmit,
} from "./unifiedSubmit";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[unified-submit.test] PASS ${name}`);
}

runTest("falls back to the legacy two-hop path when unified submit is unavailable on the server", () => {
  assert(
    shouldFallbackToLegacyUnifiedSubmit(new Error("Request failed (404): Not Found")),
    "404 responses should fall back to the legacy submit path",
  );
  assert(
    shouldFallbackToLegacyUnifiedSubmit(new Error("Request failed (501): unified route not found")),
    "501 responses should fall back to the legacy submit path",
  );
});

runTest("does not hide real unified-submit failures behind the legacy fallback", () => {
  assert(
    shouldFallbackToLegacyUnifiedSubmit(new Error("Request failed (503): OpenAI unavailable")) === false,
    "transient backend failures should surface instead of silently falling back",
  );
  assert(
    shouldFallbackToLegacyUnifiedSubmit(new Error("Request timed out")) === false,
    "timeouts should surface instead of silently falling back",
  );
});

runTest("accepts short but meaningful simulation transcripts", () => {
  for (const transcript of ["ok", "yeah", "that sucks", "I don't know", "I don\u2019t know"]) {
    assert(isUsableSimulationTranscript(transcript), `"${transcript}" should remain a usable transcript`);
  }

  assert(isUsableSimulationTranscript("   ") === false, "whitespace-only transcripts should remain unusable");
});

runTest("assistant-await recovery retries only when the await route is unavailable", () => {
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Request failed (404): Not Found")),
    "missing await routes should retain the mixed-version compatibility fallback",
  );
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Request timed out after 75 seconds.")) === false,
    "await timeouts should exit processing instead of starting a second generation request",
  );
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Request failed (503): OpenAI unavailable")) === false,
    "provider failures should exit processing instead of starting a second generation request",
  );
});
