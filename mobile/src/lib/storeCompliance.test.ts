import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../App.tsx");
const apiPath = resolve(dirname(fileURLToPath(import.meta.url)), "api.ts");

async function source(path: string): Promise<string> {
  return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
}

test("Profile exposes account deletion with the required confirmation and safe external links", async () => {
  const app = await source(appPath);
  const resetIndex = app.indexOf("Reset Local User");
  const deleteIndex = app.indexOf("Delete Account", resetIndex);

  assert.ok(resetIndex >= 0 && deleteIndex > resetIndex);
  assert.match(app, /Delete your Peritio account\?/);
  assert.match(app, /Your account and personal information will be deleted, and you'll be signed out on this device\./);
  assert.match(app, /Certain usage and training records may be retained according to your organization's governing agreements/);
  assert.match(app, /text: "Cancel", style: "cancel"/);
  assert.match(app, /text: "Delete Account",\n\s+style: "destructive"/);
  for (const [label, url] of [
    ["Privacy", "https://peritio.ai/privacy"],
    ["Terms", "https://peritio.ai/terms"],
    ["Support", "https://peritio.ai/support"],
  ]) {
    assert.match(app, new RegExp(`label: "${label}", url: "${url.replace(/[.]/g, "\\.")}"`));
  }
  assert.match(app, /confirmAndOpenExternalLink\(item\.url\)/);
});

test("Delete confirmation cancel performs no request and failure preserves local identity", async () => {
  const app = await source(appPath);
  const confirmBlock = app.slice(app.indexOf("const confirmDeleteCurrentAccount"), app.indexOf("const startSimulation"));
  assert.match(confirmBlock, /\{ text: "Cancel", style: "cancel" \}/);
  assert.doesNotMatch(confirmBlock.match(/\{ text: "Cancel"[^}]*\}/)?.[0] ?? "", /onPress/);

  const deleteBlock = app.slice(app.indexOf("const deleteCurrentAccount"), app.indexOf("const confirmDeleteCurrentAccount"));
  assert.ok(deleteBlock.indexOf("await deleteMobileAccount") < deleteBlock.indexOf("await resetSessionToOnboarding"));
  assert.match(deleteBlock, /catch \(caught\)[\s\S]*setSettingsError/);

  const api = await source(apiPath);
  assert.match(api, /export async function deleteMobileAccount/);
  assert.match(api, /method: "DELETE"/);
});

test("AI processing consent gates simulation mounting and is cleared on reset and deletion", async () => {
  const app = await source(appPath);
  assert.match(app, /"AI Processing"/);
  assert.match(app, /OpenAI, a third-party AI service, to process your practice audio and conversation content/);
  assert.match(app, /Peritio does not store your practice audio\./);

  const startBlock = app.slice(app.indexOf("const startSimulation"), app.indexOf("const handleSessionComplete"));
  const consentIndex = startBlock.indexOf("await requestAiProcessingConsent(user.id)");
  const mountIndex = startBlock.indexOf("setSimulationConfig");
  assert.ok(consentIndex >= 0 && mountIndex > consentIndex);
  assert.match(startBlock, /if \(!await requestAiProcessingConsent\(user\.id\)\) \{\n\s+return;/);

  const consentBlock = app.slice(app.indexOf("const requestAiProcessingConsent"), app.indexOf("const deleteCurrentAccount"));
  assert.match(consentBlock, /text: "Cancel"[\s\S]*resolve\(false\)/);
  assert.match(consentBlock, /text: "Continue"[\s\S]*recordAiProcessingConsent\(userId\)[\s\S]*resolve\(true\)/);
  assert.ok((app.match(/clearAiProcessingConsent\(/g) ?? []).length >= 2);
});
