import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(sourceDirectory, "api.ts"), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = apiSource.indexOf(start);
  const endIndex = apiSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return apiSource.slice(startIndex, endIndex);
}

const requestFormDataSource = sourceBetween(
  "async function requestFormData<T>",
  "export function getApiBaseUrl"
);
const transcribeSource = sourceBetween(
  "export async function transcribeAudioViaApi",
  "function normalizeUnifiedTurnRuntime"
);
const submitTurnSource = sourceBetween(
  "export async function submitSimulationTurnViaApi",
  "export async function awaitSimulationTurnResultViaApi"
);

test("native audio multipart uploads use SDK56 Expo File parts", () => {
  assert.match(apiSource, /import \{ File \} from "expo-file-system";/);

  for (const source of [transcribeSource, submitTurnSource]) {
    assert.match(source, /formData\.append\("file", new File\(params\.audioUri\) as any\);/);
    assert.doesNotMatch(source, /uri:\s*params\.audioUri/);
    assert.match(source, /formData\.append\("file", blob, "voice-input\.webm"\);/);
  }
});

test("submit-turn retains its string payload and fetch-owned multipart headers", () => {
  assert.match(submitTurnSource, /formData\.append\(\s*"payload",\s*JSON\.stringify\(/);
  assert.doesNotMatch(requestFormDataSource, /["']Content-Type["']/i);
  assert.match(requestFormDataSource, /body:\s*formData/);
});
