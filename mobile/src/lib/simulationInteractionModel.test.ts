import {
  createSimulationCorrelationId,
  createSimulationTurnCorrelationId,
  getPrimarySimulationAction,
  getSimulationActionDockFeedback,
  getSimulationLifecycleResumeIntent,
  getSimulationPrimaryButtonRoute,
  getSimulationStartPlan,
  getTurnRecordingSafetySignal,
  shouldCommitResumedAssistantResponse,
  shouldShowUserTurnInstruction,
  SIMULATION_FINALIZE_RETRY_STATUS,
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

runTest("an interrupted assistant turn replays the committed response instead of generating it again", () => {
  assertDeepEqual(
    getSimulationLifecycleResumeIntent({
      activeAssistantSpeech: {
        messageId: "assistant-message-1",
        text: "This is the already-committed assistant response.",
        committed: true,
      },
    }),
    {
      kind: "replay_assistant",
      assistantMessageId: "assistant-message-1",
      assistantText: "This is the already-committed assistant response.",
      assistantMessageCommitted: true,
    },
    "assistant playback interruption should preserve a replay-only resume intent",
  );
});

runTest("an interrupted user turn restarts recording without advancing the dialogue", () => {
  assertDeepEqual(
    getSimulationLifecycleResumeIntent({
      activeAssistantSpeech: null,
    }),
    {
      kind: "restart_recording",
    },
    "a pause outside assistant playback should safely restart the user recording turn",
  );
});

runTest("interruption before playback commits the existing assistant response exactly once on resume", () => {
  const intent = getSimulationLifecycleResumeIntent({
    activeAssistantSpeech: {
      messageId: "assistant-message-before-playback",
      text: "Existing generated response.",
      committed: false,
    },
  });
  const committedMessageIds: string[] = [];

  assert(
    shouldCommitResumedAssistantResponse({ intent, committedMessageIds }),
    "an uncommitted interrupted response should be committed before replay",
  );
  if (intent.kind === "replay_assistant") {
    committedMessageIds.push(intent.assistantMessageId);
  }
  assert(
    !shouldCommitResumedAssistantResponse({ intent, committedMessageIds }),
    "the same response id must not be committed a second time",
  );
  assertDeepEqual(
    committedMessageIds,
    ["assistant-message-before-playback"],
    "resume should preserve one transcript entry for the existing response",
  );
});

runTest("interruption after playback start does not recommit the assistant response", () => {
  const intent = getSimulationLifecycleResumeIntent({
    activeAssistantSpeech: {
      messageId: "assistant-message-after-playback",
      text: "Already committed response.",
      committed: true,
    },
  });

  assert(
    !shouldCommitResumedAssistantResponse({
      intent,
      committedMessageIds: ["assistant-message-after-playback"],
    }),
    "an already-committed response should be replay-only",
  );
});

runTest("a rapid second Resume tap cannot route to recording after the first tap clears the pause", () => {
  const firstTapRoute = getSimulationPrimaryButtonRoute({
    lifecycleResumeInProgress: false,
    sessionActive: true,
    mode: "idle",
    lifecyclePauseActive: true,
  });
  assert(firstTapRoute === "resume_lifecycle", "the first tap should claim lifecycle resume");

  const secondTapRoute = getSimulationPrimaryButtonRoute({
    lifecycleResumeInProgress: true,
    sessionActive: true,
    mode: "idle",
    lifecyclePauseActive: false,
  });
  assert(
    secondTapRoute === "ignore",
    "the synchronous resume guard must block recording even after the pause reason is cleared",
  );
});

runTest("the user-turn instruction appears only while actively recording", () => {
  assert(
    shouldShowUserTurnInstruction({
      sessionActive: true,
      mode: "recording",
      lifecyclePauseActive: false,
      isStartingTurn: false,
    }),
    "active recording should show the user-turn instruction",
  );

  for (const hiddenState of [
    { sessionActive: true, mode: "speaking" as const, lifecyclePauseActive: false, isStartingTurn: false },
    { sessionActive: true, mode: "thinking" as const, lifecyclePauseActive: false, isStartingTurn: false },
    { sessionActive: true, mode: "recording" as const, lifecyclePauseActive: true, isStartingTurn: false },
    { sessionActive: true, mode: "recording" as const, lifecyclePauseActive: false, isStartingTurn: true },
    { sessionActive: false, mode: "recording" as const, lifecyclePauseActive: false, isStartingTurn: false },
  ]) {
    assert(
      !shouldShowUserTurnInstruction(hiddenState),
      `instruction should be hidden for ${JSON.stringify(hiddenState)}`,
    );
  }
});

runTest("fixed action feedback remains available for compact and noncompact recording layouts", () => {
  const retryFeedback = "We received your response, but didn't hear clear speech. Check your microphone and try again.";

  for (const compactLayout of [true, false]) {
    const feedback = getSimulationActionDockFeedback({
      sessionActive: true,
      mode: "recording",
      lifecyclePauseActive: false,
      retryFeedback,
    });

    assert(
      feedback === retryFeedback,
      `${compactLayout ? "compact phone" : "noncompact/tablet"} layout should expose the same fixed-dock feedback`,
    );
  }
});

runTest("generic finalize failures use safe fixed-dock retry copy", () => {
  assert(SIMULATION_FINALIZE_RETRY_STATUS.includes("try again"), "generic retry copy should be actionable");
  assert(
    !/exception|stack|STT|URI|VAD/i.test(SIMULATION_FINALIZE_RETRY_STATUS),
    "generic retry copy should not expose technical details",
  );
  assert(
    getSimulationActionDockFeedback({
      sessionActive: true,
      mode: "thinking",
      lifecyclePauseActive: false,
      retryFeedback: SIMULATION_FINALIZE_RETRY_STATUS,
    }) === SIMULATION_FINALIZE_RETRY_STATUS,
    "generic retry feedback should be visible before recording restarts",
  );
});

runTest("successful or irrelevant states do not retain fixed action feedback", () => {
  assert(
    getSimulationActionDockFeedback({
      sessionActive: true,
      mode: "recording",
      lifecyclePauseActive: false,
      retryFeedback: null,
    }) === null,
    "cleared feedback should stay hidden after a new submission starts",
  );
  assert(
    getSimulationActionDockFeedback({
      sessionActive: true,
      mode: "idle",
      lifecyclePauseActive: false,
      retryFeedback: SIMULATION_FINALIZE_RETRY_STATUS,
    }) === null,
    "recording interruption and other idle recovery states should retain their dedicated UI",
  );
  assert(
    getSimulationActionDockFeedback({
      sessionActive: true,
      mode: "recording",
      lifecyclePauseActive: true,
      retryFeedback: SIMULATION_FINALIZE_RETRY_STATUS,
    }) === null,
    "lifecycle pause UI should not be mislabeled as a finalize failure",
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

runTest("turn correlation ids preserve turn number and add a collision-safe suffix", () => {
  const firstCorrelationId = createSimulationTurnCorrelationId("session_abc_123", 12, "nonce-one");
  const secondCorrelationId = createSimulationTurnCorrelationId("session_abc_123", 12, "nonce-two");

  assert(/^sim-/.test(firstCorrelationId), "turn correlation id should keep the simulation prefix");
  assert(firstCorrelationId.includes("turn-12-nonce-one"), "turn correlation id should include turn number and nonce");
  assert(secondCorrelationId.includes("turn-12-nonce-two"), "turn correlation id should include the supplied nonce");
  assert(firstCorrelationId !== secondCorrelationId, "different nonces should produce different turn correlation ids");
  assert(firstCorrelationId.length <= 80, "turn correlation id should stay within the server header limit");
});
