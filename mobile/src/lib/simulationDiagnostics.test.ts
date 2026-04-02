import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTtsCancellation,
  buildNoTranscriptDiagnostics,
  getLongPollFailureReportDecision,
  getMissingUsageRecordFields,
} from "./simulationDiagnostics";

test("analyzeTtsCancellation marks superseded playback as expected", () => {
  const result = analyzeTtsCancellation({
    source: "simulation",
    correlationId: "sim-123-turn-2",
    simulationSessionId: "sim_123",
    sourceKind: "inline",
    playbackStarted: false,
    fallbackAttempted: false,
    fallbackSucceeded: false,
    chunkIndex: 0,
    chunkCount: 2,
    abortSignaled: true,
    superseded: true,
    sessionEnding: false,
    screenChanging: false,
  });

  assert.equal(result.expected, true);
  assert.equal(result.reason, "superseded");
  assert.equal(result.likelyUserFacing, false);
});

test("analyzeTtsCancellation keeps unknown cancellation actionable", () => {
  const result = analyzeTtsCancellation({
    source: "simulation",
    playbackStarted: false,
    fallbackAttempted: true,
    fallbackSucceeded: false,
    abortSignaled: false,
    superseded: false,
    sessionEnding: false,
    screenChanging: false,
  });

  assert.equal(result.expected, false);
  assert.equal(result.reason, "unknown");
  assert.equal(result.likelyUserFacing, true);
});

test("getMissingUsageRecordFields lists all missing required fields", () => {
  assert.deepEqual(
    getMissingUsageRecordFields({
      simulationSessionId: "sim_123",
      userId: "",
      segmentId: null,
      scenarioId: "scenario_1",
    }),
    ["userId", "segmentId"],
  );
});

test("getLongPollFailureReportDecision suppresses transient failures and escalates threshold crossing", () => {
  assert.deepEqual(
    getLongPollFailureReportDecision({
      consecutiveFailures: 2,
      sinceFirstFailureMs: 10_000,
    }),
    { shouldReport: false, reason: "transient" },
  );

  assert.deepEqual(
    getLongPollFailureReportDecision({
      consecutiveFailures: 3,
      sinceFirstFailureMs: 20_000,
    }),
    { shouldReport: true, reason: "threshold_crossed" },
  );

  assert.deepEqual(
    getLongPollFailureReportDecision({
      consecutiveFailures: 10,
      sinceFirstFailureMs: 130_000,
    }),
    { shouldReport: true, reason: "persistent" },
  );
});

test("buildNoTranscriptDiagnostics distinguishes empty transcript result from failed request", () => {
  const emptyTranscript = buildNoTranscriptDiagnostics({
    audioBytes: 24_000,
    recordingDurationSeconds: 6,
    contentType: "audio/m4a",
    fileExtension: ".m4a",
    remoteTranscriptionAttempted: true,
    transcriptionRequestFailed: false,
    transcriptText: "",
    usedLocalFallback: false,
  });

  assert.equal(emptyTranscript.classification, "empty_transcript_result");
  assert.equal(emptyTranscript.suspiciouslyTinyAudio, false);

  const failedRequest = buildNoTranscriptDiagnostics({
    audioBytes: 24_000,
    recordingDurationSeconds: 6,
    contentType: "audio/m4a",
    fileExtension: ".m4a",
    remoteTranscriptionAttempted: true,
    transcriptionRequestFailed: true,
    transcriptionErrorMessage: "Request failed (503)",
    transcriptText: "",
    usedLocalFallback: false,
  });

  assert.equal(failedRequest.classification, "request_failed");
  assert.equal(failedRequest.transcriptionErrorMessage, "Request failed (503)");
});

test("buildNoTranscriptDiagnostics flags tiny recordings conservatively", () => {
  const result = buildNoTranscriptDiagnostics({
    audioBytes: 2_048,
    recordingDurationSeconds: 2,
    contentType: "audio/m4a",
    fileExtension: ".m4a",
    remoteTranscriptionAttempted: true,
    transcriptionRequestFailed: false,
    transcriptText: "",
    usedLocalFallback: false,
  });

  assert.equal(result.classification, "tiny_or_empty_recording");
  assert.equal(result.suspiciouslyTinyAudio, true);
});
