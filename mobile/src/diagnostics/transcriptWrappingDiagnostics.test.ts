import assert from "node:assert/strict";
import test from "node:test";
import {
  compareTranscriptFrames, diagnosticLineHeight, formatDiagnosticNumber, makeTranscriptSweep,
  MAX_SWEEP_PROBES, nextTranscriptSweepStep, STAGING_TRANSCRIPT_API, TRANSCRIPT_PROBES, transcriptDiagnosticsAllowed,
} from "./transcriptWrappingDiagnostics";
import type { ProbeMeasurement } from "./transcriptWrappingDiagnostics";

const frame = (height: number, extra: Partial<ProbeMeasurement> = {}): ProbeMeasurement => ({
  configuration: "width390:font1:standard:baseline", frame: { x: 0, y: 32, width: 300, height }, windowY: 32, lines: 3, ...extra,
});

test("diagnostics require both embedded and resolved API to be exactly staging", () => {
  assert.equal(transcriptDiagnosticsAllowed(STAGING_TRANSCRIPT_API, STAGING_TRANSCRIPT_API), true);
  assert.equal(transcriptDiagnosticsAllowed(`${STAGING_TRANSCRIPT_API}/`, STAGING_TRANSCRIPT_API), true);
  for (const denied of [undefined, "", "https://peritio-api-prod.onrender.com", "http://localhost:3000",
    `${STAGING_TRANSCRIPT_API}.attacker.invalid`, `${STAGING_TRANSCRIPT_API}/other`]) {
    assert.equal(transcriptDiagnosticsAllowed(denied, STAGING_TRANSCRIPT_API), false);
    assert.equal(transcriptDiagnosticsAllowed(STAGING_TRANSCRIPT_API, denied ?? ""), false);
  }
});

test("baseline and comparison are 21/21.001 or compact 19/19.001 only", () => {
  assert.equal(diagnosticLineHeight(false, "baseline"), 21);
  assert.equal(diagnosticLineHeight(false, "comparison"), 21.001);
  assert.equal(diagnosticLineHeight(true, "baseline"), 19);
  assert.equal(diagnosticLineHeight(true, "comparison"), 19.001);
});

test("independent reference detects reported float shortfalls without using the failing line count", () => {
  const result = compareTranscriptFrames(frame(109.9998779296875, { lines: 1 }), frame(110, { lines: 5 }));
  assert.equal(result.status, "SHORT");
  assert.equal(result.shortfall, 0.0001220703125);
  assert.equal(formatDiagnosticNumber(result.shortfall), "0.000122070");
  assert.equal(compareTranscriptFrames(frame(43.9998779296875), frame(44)).status, "SHORT");
  assert.equal(compareTranscriptFrames(frame(62.9999), frame(63)).status, "SHORT");
});

test("equal or taller frames FITS but do not certify glyph drawing", () => {
  for (const height of [63, 63.00000001, 64]) {
    const result = compareTranscriptFrames(frame(height), frame(63));
    assert.equal(result.status, "FITS");
    assert.match(result.reason, /inspect native drawing/);
  }
});

test("missing, stale, wrong-width and off-origin references are INCONCLUSIVE", () => {
  for (const reference of [undefined, frame(63, { configuration: "other-font-or-mode" }),
    frame(63, { frame: { x: 0, y: 0, width: 299, height: 63 } }),
    frame(63, { windowY: 500 }), frame(63, { windowY: -1 }), frame(63, { windowY: undefined }),
    frame(63, { lines: 0 }), frame(NaN), frame(0)]) {
    assert.equal(compareTranscriptFrames(frame(62), reference).status, "INCONCLUSIVE");
  }
  assert.equal(compareTranscriptFrames(undefined, frame(63)).status, "INCONCLUSIVE");
});

test("bounded sweep targets all four boundaries in thirds and terminates for both A/B passes", () => {
  const positions = makeTranscriptSweep(200, 84);
  assert.equal(positions.length, 28);
  for (const boundary of [512, 1024, 2048, 4096]) {
    const near = positions.filter((value) => Math.abs(value + 200 + 42 - boundary) <= 1.000001);
    assert.equal(near.length, 7);
    assert.ok(Math.abs(near[1] - near[0] - 1 / 3) < 1e-9);
  }
  let step: number | null = 0, count = 0;
  while (step !== null) {
    count++;
    assert.ok(count <= MAX_SWEEP_PROBES);
    step = nextTranscriptSweepStep(step, positions.length * 2);
  }
  assert.equal(count, 56);
  assert.equal(nextTranscriptSweepStep(63, 10000), null);
  assert.deepEqual(makeTranscriptSweep(NaN, 84), []);
  assert.deepEqual(makeTranscriptSweep(200, 0), []);
  assert.ok(makeTranscriptSweep(-10000, 84).every((value) => value >= 0 && value <= 4600));
});

test("synthetic corpus includes both roles, short/long, multiline and unbroken text without mutating it", () => {
  const original = JSON.stringify(TRANSCRIPT_PROBES);
  assert.ok(TRANSCRIPT_PROBES.filter((probe) => probe.role === "user").length > 1);
  assert.ok(TRANSCRIPT_PROBES.filter((probe) => probe.role === "assistant").length > 1);
  assert.ok(TRANSCRIPT_PROBES.some((probe) => probe.content.includes("\n")));
  assert.ok(TRANSCRIPT_PROBES.some((probe) => /\S{100}/.test(probe.content)));
  makeTranscriptSweep(200, 84);
  assert.equal(JSON.stringify(TRANSCRIPT_PROBES), original);
});
