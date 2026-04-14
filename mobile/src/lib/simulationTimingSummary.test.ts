import { buildSimulationTurnTimingSummary } from "./simulationTimingSummary";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[simulation-timing-summary.test] PASS ${name}`);
}

runTest("builds a readable turn summary from phase timestamps", () => {
  const summary = buildSimulationTurnTimingSummary({
    simulationSessionId: "sim_123",
    correlationId: "sim-123-turn-1",
    trigger: "submit",
    mode: "remote",
    outcome: "playback_started",
    submitStartedAtMs: 1_000,
    recordingFinalizeCompletedAtMs: 1_240,
    unifiedSubmitRequestStartedAtMs: 1_260,
    unifiedSubmitResponseAtMs: 3_180,
    transcribeRequestStartedAtMs: 1_260,
    transcribeResponseAtMs: 2_020,
    assistantRequestStartedAtMs: 2_040,
    assistantResponseAtMs: 3_180,
    assistantTextCommittedAtMs: 3_980,
    ttsPipelineStartedAtMs: 3_220,
    audioModeResetAwaitStartedAtMs: 3_230,
    audioModeResetCompletedAtMs: 3_310,
    playbackStartedAtMs: 4_090,
    speakingCompletedAtMs: 5_020,
    transcriptChars: 89,
    replyChars: 132,
  });

  assert(summary.submitToFinalizeMs === 240, "submitToFinalizeMs should be derived from the finalize phase");
  assert(summary.unifiedSubmitRoundTripMs === 1920, "unified submit round trip should be computed");
  assert(summary.transcribeRoundTripMs === 760, "transcribe round trip should be computed");
  assert(summary.assistantRoundTripMs === 1140, "assistant round trip should be computed");
  assert(summary.assistantReadyToPlaybackMs === 910, "assistant-ready-to-playback should be computed");
  assert(summary.assistantReadyToVisibleMs === 800, "assistant-ready-to-visible should be computed");
  assert(summary.submitToAssistantVisibleMs === 2980, "submitToAssistantVisibleMs should be computed");
  assert(summary.visibleLeadBeforePlaybackMs === 110, "visibleLeadBeforePlaybackMs should be computed");
  assert(summary.ttsStartupMs === 870, "tts startup should be computed");
  assert(summary.audioModeResetWaitMs === 80, "audio mode reset wait should be computed");
  assert(summary.submitToPlaybackMs === 3090, "submitToPlaybackMs should cover the full turn");
  assert(summary.submitToSpeakingCompleteMs === 4020, "submitToSpeakingCompleteMs should cover full speech");
  assert(summary.playbackToSpeakingCompleteMs === 930, "playbackToSpeakingCompleteMs should be computed");
});

runTest("omits missing phase durations cleanly", () => {
  const summary = buildSimulationTurnTimingSummary({
    simulationSessionId: "sim_123",
    correlationId: "sim-123-turn-2",
    trigger: "submit",
    mode: "local_mock",
    outcome: "no_clear_speech",
    submitStartedAtMs: 5_000,
  });

  assert(summary.submitToFinalizeMs === undefined, "missing phases should remain undefined");
  assert(summary.submitToPlaybackMs === undefined, "missing playback should remain undefined");
  assert(summary.transcriptChars === 0, "transcriptChars should default to zero");
});
