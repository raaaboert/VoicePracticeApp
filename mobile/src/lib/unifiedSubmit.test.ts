import { shouldFallbackToLegacyUnifiedSubmit } from "./unifiedSubmit";

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
