import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAiProcessingConsent,
  getAiProcessingConsentStorageKey,
  hasAiProcessingConsent,
  recordAiProcessingConsent,
  type AiProcessingConsentStorage,
} from "./aiProcessingConsent";

function createStorage(): AiProcessingConsentStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

test("AI processing consent is persisted only for the consenting user", async () => {
  const storage = createStorage();
  await recordAiProcessingConsent("user_a", storage);

  assert.equal(await hasAiProcessingConsent("user_a", storage), true);
  assert.equal(await hasAiProcessingConsent("user_b", storage), false);
  assert.notEqual(getAiProcessingConsentStorageKey("user_a"), getAiProcessingConsentStorageKey("user_b"));
});

test("clearing one user's AI processing consent does not affect another user", async () => {
  const storage = createStorage();
  await recordAiProcessingConsent("user_a", storage);
  await recordAiProcessingConsent("user_b", storage);

  await clearAiProcessingConsent("user_a", storage);

  assert.equal(await hasAiProcessingConsent("user_a", storage), false);
  assert.equal(await hasAiProcessingConsent("user_b", storage), true);
});

test("missing or unreadable consent fails closed", async () => {
  const storage = createStorage();
  assert.equal(await hasAiProcessingConsent("", storage), false);
  assert.equal(await hasAiProcessingConsent("user_a", {
    ...storage,
    async getItem() { throw new Error("unavailable"); },
  }), false);
});
