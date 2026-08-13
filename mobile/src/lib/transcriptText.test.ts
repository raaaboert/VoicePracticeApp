import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeTranscriptText } from "./transcriptText";

test("transcript normalization preserves ordinary visible prose", () => {
  const prose = "Ordinary spaces stay.\nCurly apostrophes don’t change — nor do en–dashes, quotes, or café.";

  assert.equal(normalizeTranscriptText(prose), prose);
});

test("transcript normalization restores ordinary wrapping opportunities", () => {
  assert.equal(normalizeTranscriptText("no\u00a0break"), "no break");
  assert.equal(normalizeTranscriptText("narrow\u202fspace"), "narrow space");
  assert.equal(normalizeTranscriptText("figure\u2007space"), "figure space");
  assert.equal(normalizeTranscriptText("zero\u200bwidth"), "zerowidth");
  assert.equal(normalizeTranscriptText("word\u2060joiner"), "wordjoiner");
});

test("transcript normalization is idempotent", () => {
  const value = "one\u00a0two\u202fthree\u2007four\u200bfive\u2060six";
  const normalized = normalizeTranscriptText(value);

  assert.equal(normalizeTranscriptText(normalized), normalized);
});

test("simulation transcript renders normalized content without mutating stored messages", () => {
  const simulationSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../screens/SimulationScreen.tsx"),
    "utf8"
  );

  assert.match(
    simulationSource,
    /import \{ normalizeTranscriptText \} from "\.\.\/lib\/transcriptText";/
  );
  assert.match(simulationSource, /\{normalizeTranscriptText\(message\.content\)\}/);
  assert.doesNotMatch(simulationSource, /message\.content\s*=\s*normalizeTranscriptText/);
});
