import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { before, after } from "node:test";
import type { SupportCaseRecord } from "@voicepractice/shared";
import { startPromptRouteHarness, ROUTE_USER_ID, type PromptRouteHarness } from "./simulationPromptRoutes.testSupport.js";
import { createSupportCaseStore } from "./storage/supportCaseStore.js";

let harness: PromptRouteHarness;
let dbPath: string;
const transcript = "PRIVATE_TRANSCRIPT_SENTINEL Alice alice@private.test said she needs help.";
const meta = { scenarioTitle: "Private scenario context", segmentLabel: "Private segment", difficulty: "medium" };
function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
function storagePath(suffix: string) {
  const parsed = path.parse(dbPath);
  return path.join(parsed.dir, `${parsed.name}.${suffix}${parsed.ext}`);
}
async function storedCases(): Promise<SupportCaseRecord[]> {
  return (JSON.parse(await readFile(storagePath("support-cases"), "utf8")) as { cases: SupportCaseRecord[] }).cases;
}
before(async () => {
  harness = await startPromptRouteHarness({ modularEnvironmentEnabled: false });
  dbPath = process.env.DB_PATH!;
});
after(async () => { await harness.close(); });

test("support transcript consent, encryption, ten-day retention and admin-only access survive expiration cleanup", async () => {
  const endpoint = `/mobile/users/${ROUTE_USER_ID}/support/cases`;
  const missing = await harness.request(endpoint, json({ message: "Help", includeTranscript: true }));
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: "Transcript text is required when consent is enabled." });
  const denied = await harness.request(endpoint, { ...json({ message: "Help", includeTranscript: true,
    transcript: { text: transcript, fileName: "private.txt", meta } }), headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" } });
  assert.equal(denied.status, 401);

  const noConsent = await harness.request(endpoint, json({ message: "Case without transcript", includeTranscript: false,
    transcript: { text: transcript, fileName: "private.txt", meta } }));
  assert.equal(noConsent.status, 201);
  const noConsentId = (await noConsent.json() as { caseId: string }).caseId;
  const omitted = (await storedCases()).find((row) => row.id === noConsentId)!;
  assert.equal(omitted.transcriptEncrypted, null);
  assert.equal(omitted.transcriptExpiresAt, null);
  assert.equal(omitted.transcriptFileName, null);
  assert.equal(omitted.transcriptMeta, null);
  assert.equal(JSON.stringify(omitted).includes("PRIVATE_TRANSCRIPT_SENTINEL"), false);

  const before = Date.now();
  const consent = await harness.request(endpoint, json({ message: "Case with consent", includeTranscript: true,
    transcript: { text: transcript, fileName: "private.txt", meta } }));
  assert.equal(consent.status, 201);
  const consentId = (await consent.json() as { caseId: string }).caseId;
  const encrypted = (await storedCases()).find((row) => row.id === consentId)!;
  assert.ok(encrypted.transcriptEncrypted);
  assert.notEqual(encrypted.transcriptEncrypted, transcript);
  assert.equal(JSON.stringify(encrypted).includes("PRIVATE_TRANSCRIPT_SENTINEL"), false);
  const expiry = new Date(encrypted.transcriptExpiresAt!).getTime();
  const tenDays = 10 * 24 * 60 * 60 * 1000;
  assert.ok(expiry >= before + tenDays && expiry <= Date.now() + tenDays);
  assert.equal((await harness.request(`/support/cases/${consentId}`)).status, 401);

  const login = await harness.request("/auth/login", json({ password: "prompt-route-admin-password" }));
  assert.equal(login.status, 200);
  const token = (await login.json() as { token: string }).token;
  const headers = { Authorization: `Bearer ${token}` };
  const detail = await harness.request(`/support/cases/${consentId}`, { headers });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json() as { transcript: { text: string } }).transcript.text, transcript);

  const store = createSupportCaseStore({ provider: "file", dbPath, databaseUrl: null,
    pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 1000 });
  await store.purgeExpiredTranscripts(new Date(expiry));
  const purged = (await storedCases()).find((row) => row.id === consentId)!;
  assert.deepEqual(purged, { ...encrypted, transcriptEncrypted: null, transcriptExpiresAt: null,
    transcriptFileName: null, transcriptMeta: null });
  const after = await harness.request(`/support/cases/${consentId}`, { headers });
  const afterBody = await after.json() as { message: string; transcript: { text: null; available: boolean }; meta: null };
  assert.equal(afterBody.message, "Case with consent");
  assert.equal(afterBody.transcript.text, null);
  assert.equal(afterBody.transcript.available, false);
  assert.equal(afterBody.meta, null);
  const auditText = await readFile(storagePath("audit-events"), "utf8");
  assert.ok(auditText.includes("support.case_created"));
  assert.equal(auditText.includes("PRIVATE_TRANSCRIPT_SENTINEL"), false);
});
