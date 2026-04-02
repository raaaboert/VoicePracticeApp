import {
  createSimulationCorrelationId,
  getPrimarySimulationAction,
  getSimulationStartPlan,
  getTurnFinalizeFallbackReason,
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
    }),
    {
      kind: "submit",
      label: "Submit Response",
      disabled: false,
    },
    "recording mode should surface submit as the primary action",
  );
});

runTest("busy simulation states disable the primary button instead of ending the session", () => {
  assertDeepEqual(
    getPrimarySimulationAction({
      sessionActive: true,
      isInitializing: false,
      mode: "thinking",
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
    }),
    {
      kind: "busy",
      label: "AI Responding...",
      disabled: true,
    },
    "speaking mode should disable the primary action",
  );
});

runTest("fallback turn finalization no longer fires on short silence", () => {
  const noFallback = getTurnFinalizeFallbackReason({
    elapsedMs: 8_000,
    silenceMs: 2_300,
    heardVoice: true,
    meteringSeen: true,
    minTurnDurationMs: 1_600,
    backupSilenceCutoffMs: 6_500,
    softMaxTurnDurationMs: 35_000,
    absoluteMaxTurnDurationMs: 60_000,
  });
  assert(noFallback === null, "short silence should not end the turn anymore");

  const backupSilence = getTurnFinalizeFallbackReason({
    elapsedMs: 9_000,
    silenceMs: 6_700,
    heardVoice: true,
    meteringSeen: true,
    minTurnDurationMs: 1_600,
    backupSilenceCutoffMs: 6_500,
    softMaxTurnDurationMs: 35_000,
    absoluteMaxTurnDurationMs: 60_000,
  });
  assert(backupSilence === "backup-silence", "long silence should still trigger the backup path");
});

runTest("turn duration fallback wins before absolute safety cap", () => {
  assert(
    getTurnFinalizeFallbackReason({
      elapsedMs: 35_000,
      silenceMs: 0,
      heardVoice: false,
      meteringSeen: false,
      minTurnDurationMs: 1_600,
      backupSilenceCutoffMs: 6_500,
      softMaxTurnDurationMs: 35_000,
      absoluteMaxTurnDurationMs: 60_000,
    }) === "soft-limit",
    "soft turn limit should trigger before the absolute cap",
  );

  assert(
    getTurnFinalizeFallbackReason({
      elapsedMs: 60_000,
      silenceMs: 0,
      heardVoice: false,
      meteringSeen: false,
      minTurnDurationMs: 1_600,
      backupSilenceCutoffMs: 6_500,
      softMaxTurnDurationMs: 35_000,
      absoluteMaxTurnDurationMs: 60_000,
    }) === "absolute-limit",
    "absolute limit should still be the final safety stop",
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
