import {
  isExpiredSubmittedTurnAwait,
  isUsableAwaitedAssistantReply,
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
  assert(isUsableSimulationTranscript("I") === false, "near-empty transcripts should remain unusable");
  assert(
    isUsableSimulationTranscript("\u713c\u304d\u305d\u3070\u3092\u4f5c\u308a\u307e\u3059\u3002") === false,
    "non-English auto-detected transcripts should remain unusable",
  );
});

runTest("assistant-await recovery retries only when the await route is unavailable", () => {
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Request failed (404): Not Found")),
    "missing await routes should retain the mixed-version compatibility fallback",
  );
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Request failed (405): Method Not Allowed")),
    "method-unavailable await routes should retain the mixed-version compatibility fallback",
  );
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Request failed (501): Not Implemented")),
    "unimplemented await routes should retain the mixed-version compatibility fallback",
  );
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Request timed out after 75 seconds.")) === false,
    "await timeouts should exit processing instead of starting a second generation request",
  );
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Request failed (503): OpenAI unavailable")) === false,
    "provider failures should exit processing instead of starting a second generation request",
  );
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("OpenAI model not found")) === false,
    "provider not-found failures should not be mistaken for a missing compatibility route",
  );
  assert(
    shouldFallbackToLegacyAssistantReply(new Error("Unified submit endpoint not found")),
    "explicit endpoint-not-found compatibility responses should retain the legacy fallback",
  );
});

runTest("expired duplicate awaits are classified separately from compatibility fallback", () => {
  const expiredAwait = new Error("Simulation assistant reply is no longer pending for this correlationId.");
  assert(isExpiredSubmittedTurnAwait(expiredAwait), "expired await responses should be recognized as stale/duplicate");
  assert(
    shouldFallbackToLegacyAssistantReply(expiredAwait) === false,
    "expired awaits should not be mistaken for a missing compatibility route",
  );
});

runTest("rejects malformed awaited assistant replies before legacy generation", () => {
  assert(
    isUsableAwaitedAssistantReply({ outcome: "assistant_reply", assistantText: "A valid reply." }),
    "non-empty assistant replies should remain usable",
  );
  assert(
    isUsableAwaitedAssistantReply({ outcome: "assistant_reply", assistantText: "   " }) === false,
    "empty assistant replies should surface recovery instead of triggering legacy generation",
  );
  assert(
    isUsableAwaitedAssistantReply({ outcome: "unexpected", assistantText: "A reply." }) === false,
    "malformed await outcomes should surface recovery instead of triggering legacy generation",
  );
});
