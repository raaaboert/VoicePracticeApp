import {
  createSimulationCorrelationId,
  getPrimarySimulationAction,
  getSimulationStartPlan,
  getTurnRecordingSafetySignal,
} from "./simulationInteractionModel";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected=${expectedJson}\nactual=${actualJson}`);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[simulation-interaction-model.test] PASS ${name}`);
}

runTest("recognized start is still required after the opening has already been delivered", () => {
  const plan = getSimulationStartPlan({
    openingDelivered: true,
    recognizedStartRegistered: false,
  });

  assertDeepEqual(
    plan,
    {
      shouldDeliverOpening: false,
      shouldRegisterRecognizedStart: true,
    },
    "start plan should still require recognized registration",
  );
});

runTest("recording state makes explicit submit the primary action", () => {
  assertDeepEqual(
    getPrimarySimulationAction({
      sessionActive: true,
      isInitializing: false,
      mode: "recording",
      isStartingTurn: false,
    }),
    {
      kind: "submit",
      label: "Submit Response",
      disabled: false,
    },
    "recording mode should surface submit as the primary action",
  );
});

runTest("an active session can recover from a paused idle state without pretending the session ended", () => {
  assertDeepEqual(
    getPrimarySimulationAction({
      sessionActive: true,
      isInitializing: false,
      mode: "idle",
      isStartingTurn: false,
    }),
    {
      kind: "start",
      label: "Resume Turn",
      disabled: false,
    },
    "idle active mode should offer a resume action instead of a disabled busy state",
  );
});

runTest("starting a session disables duplicate start taps immediately", () => {
  assertDeepEqual(
    getPrimarySimulationAction({
      sessionActive: false,
      isInitializing: false,
      mode: "idle",
      isStartingSession: true,
    }),
    {
      kind: "busy",
      label: "Starting...",
      disabled: true,
    },
    "startup should switch the primary action into a disabled busy state",
  );
});

runTest("busy simulation states disable the primary button instead of ending the session", () => {
  assertDeepEqual(
    getPrimarySimulationAction({
      sessionActive: true,
      isInitializing: false,
      mode: "thinking",
      isStartingTurn: false,
    }),
    {
      kind: "busy",
      label: "Processing...",
      disabled: true,
    },
    "thinking mode should disable the primary action",
  );

  assertDeepEqual(
    getPrimarySimulationAction({
      sessionActive: true,
      isInitializing: false,
      mode: "speaking",
      isStartingTurn: false,
    }),
    {
      kind: "busy",
      label: "AI Responding...",
      disabled: true,
    },
    "speaking mode should disable the primary action",
  );
});

runTest("restarting a paused session disables duplicate resume taps while the microphone reconnects", () => {
  assertDeepEqual(
    getPrimarySimulationAction({
      sessionActive: true,
      isInitializing: false,
      mode: "idle",
      isStartingTurn: true,
    }),
    {
      kind: "busy",
      label: "Reconnecting...",
      disabled: true,
    },
    "reconnecting an active paused turn should prevent duplicate resume actions",
  );
});

runTest("long pause becomes a guidance signal instead of an auto-submit trigger", () => {
  const noSignal = getTurnRecordingSafetySignal({
    elapsedMs: 8_000,
    silenceMs: 2_300,
    heardVoice: true,
    meteringSeen: true,
    minTurnDurationMs: 1_600,
    longPauseNoticeMs: 6_500,
    softTurnNoticeMs: 35_000,
    absoluteTurnNoticeMs: 60_000,
  });
  assert(noSignal === null, "short silence should not raise a guidance signal yet");

  const longPause = getTurnRecordingSafetySignal({
    elapsedMs: 9_000,
    silenceMs: 6_700,
    heardVoice: true,
    meteringSeen: true,
    minTurnDurationMs: 1_600,
    longPauseNoticeMs: 6_500,
    softTurnNoticeMs: 35_000,
    absoluteTurnNoticeMs: 60_000,
  });
  assert(longPause === "long-pause", "long silence should surface a manual-submit reminder");
});

runTest("long-turn safety signals stay advisory instead of auto-submitting", () => {
  assert(
    getTurnRecordingSafetySignal({
      elapsedMs: 35_000,
      silenceMs: 0,
      heardVoice: false,
      meteringSeen: false,
      minTurnDurationMs: 1_600,
      longPauseNoticeMs: 6_500,
      softTurnNoticeMs: 35_000,
      absoluteTurnNoticeMs: 60_000,
    }) === "soft-limit",
    "soft turn length should surface a reminder before the absolute warning",
  );

  assert(
    getTurnRecordingSafetySignal({
      elapsedMs: 60_000,
      silenceMs: 0,
      heardVoice: false,
      meteringSeen: false,
      minTurnDurationMs: 1_600,
      longPauseNoticeMs: 6_500,
      softTurnNoticeMs: 35_000,
      absoluteTurnNoticeMs: 60_000,
    }) === "absolute-limit",
    "absolute turn length should remain a stronger advisory signal",
  );
});

runTest("correlation ids stay short and readable", () => {
  const correlationId = createSimulationCorrelationId(
    "sim_very_long_session_identifier_that_keeps_going",
    "Turn 12 TTS Start",
  );

  assert(/^sim-/.test(correlationId), "correlation id should keep the simulation prefix");
  assert(correlationId.includes("turn-12-tts-start"), "correlation id should preserve the phase");
  assert(correlationId.length <= 80, "correlation id should stay within the server header limit");
});
