import assert from "node:assert/strict";
import test from "node:test";

import { evaluateTurnFinalizeRequest } from "./simulationTurnIntegrity";

const ACTIVE_RECORDING = "recording-2";

function decision(overrides: Partial<Parameters<typeof evaluateTurnFinalizeRequest>[0]> = {}) {
  return evaluateTurnFinalizeRequest({
    activeRecordingInstanceId: ACTIVE_RECORDING,
    requestedRecordingInstanceId: ACTIVE_RECORDING,
    finalizationReason: "user_submit",
    explicitUserAction: true,
    submissionAlreadyRequested: false,
    turnProcessing: false,
    ...overrides,
  });
}

test("normal and very short explicit user submissions are accepted without a duration rule", () => {
  assert.deepEqual(decision(), { allowed: true });
});

test("recording stops and lifecycle cleanup cannot imply user submission", () => {
  for (const finalizationReason of [
    "recording_interruption",
    "app_background",
    "session_end",
    "component_cleanup",
    "audio_error",
  ] as const) {
    assert.deepEqual(decision({ finalizationReason, explicitUserAction: false }), {
      allowed: false,
      reason: "non_user_finalization",
    });
  }
});

test("a stale recording callback cannot finalize the active recording", () => {
  assert.deepEqual(decision({ requestedRecordingInstanceId: "recording-1" }), {
    allowed: false,
    reason: "stale_recording",
  });
});

test("duplicate submission and processing races are rejected", () => {
  assert.deepEqual(decision({ submissionAlreadyRequested: true }), {
    allowed: false,
    reason: "duplicate_submission",
  });
  assert.deepEqual(decision({ turnProcessing: true }), {
    allowed: false,
    reason: "turn_processing",
  });
});

test("an absent recorder and a non-explicit submit fail closed", () => {
  assert.deepEqual(decision({ activeRecordingInstanceId: null }), {
    allowed: false,
    reason: "no_active_recording",
  });
  assert.deepEqual(decision({ explicitUserAction: false }), {
    allowed: false,
    reason: "non_user_finalization",
  });
});
