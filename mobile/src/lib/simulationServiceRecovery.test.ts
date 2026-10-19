import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as errors from "./apiError";
import * as interaction from "./simulationInteractionModel";
import * as recovery from "./simulationServiceRecovery";
import * as turnRecovery from "./simulationTurnRecovery";
import * as scoring from "./simulationScoreHandling";
import * as unified from "./unifiedSubmit";
import { createSimulationStartupCoordinator } from "./simulationStartup";
import type { SessionTiming } from "../types";

const screen = readFileSync(new URL("../screens/SimulationScreen.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
// Execute real screen/App callbacks with native audio, network and React setters substituted.
function callback(source: string, name: string, context: Record<string, any>) {
  const ast = ts.createSourceFile("screen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      const expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      body = expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(body, name);
  const code = ts.transpileModule(`const run = ${body};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${code}\nreturn run;`)(...Object.values(context));
}

function screenHarness(options: { registrationError?: Error; openingError?: Error; local?: boolean; configured?: boolean } = {}) {
  const startup = createSimulationStartupCoordinator();
  const events = { registrations: 0, openings: 0, capture: 0, stopped: 0, cancelled: 0, completions: [] as SessionTiming[], exits: [] as string[] };
  const state: Record<string, any> = {};
  const context: Record<string, any> = { ...errors, ...interaction, ...turnRecovery, ...unified,
    startup, config: { simulationSessionId: "same-session", scenario: { id: "scenario", segmentId: "role", title: "Scenario" },
      maxSimulationMinutes: 20, difficulty: "medium", personaStyle: "skeptical" },
    userId: "learner", authToken: "auth", apiConfigured: options.configured ?? true,
    localTestMode: options.local ?? false, isInitializing: false, mode: "idle", Platform: { OS: "ios" }, shouldUseFastStartRemoteTts: false,
    logSimulationTiming: () => {}, logSimulationApiCall: () => {}, submitAutoErrorReport: async (_name: string, error: unknown) => {
      if (error instanceof ReferenceError) throw error;
    },
    ensureMicPermission: async () => true, toRemoteTtsPreset: () => "male_balanced",
    isStartupGenerationCurrent: () => true, createTurnCorrelationId: () => "same-turn",
    createMessageId: (() => { let id = 0; return () => `message-${++id}`; })(),
    createLocalOpeningPayload: () => ({ assistantText: "Explicit development mock", trainingPackId: null, speechPrefetch: null }),
    startSimulationSession: async () => { events.registrations++; if (options.registrationError) throw options.registrationError; },
    createOpeningLine: async () => { events.openings++; if (options.openingError) throw options.openingError;
      return { assistantText: "Real server opening", trainingPackId: null, speechPrefetch: null }; },
    prepareIosPlaybackAudioMode: async () => {}, speakAssistantResponse: async (_text: string, _time: number, start: () => void) => { start(); },
    startListeningTurn: async () => { events.capture++; }, stopRecordingSafely: async () => { events.stopped++; },
    cancelPendingTts: async () => { events.cancelled++; }, getErrorMessage: (error: Error, fallback: string) => error.message || fallback,
    onOrganizationAccessRequired: () => { throw Error("unexpected organization redirect"); },
    isSessionGenerationCurrent: () => true, isSimulationLifecycleInterruptedError: () => false,
    clearLifecyclePause: () => { context.lifecyclePauseReasonRef.current = null; },
    endSession: async () => { startup.conversationClosed = true; }, onExit: (message: string) => events.exits.push(message),
    onSessionComplete: (_history: unknown, _config: unknown, timing: SessionTiming) => events.completions.push(timing),
  };
  for (const ref of new Set(screen.match(/\b\w+Ref\b/g))) context[ref] = { current: null };
  context.serviceRecoveryRef.current = startup.serviceRecovery;
  context.messagesRef.current = startup.messages;
  context.startSimulationAttemptRef.current = 0; context.sessionLifecycleGenerationRef.current = 0;
  for (const setter of new Set(screen.match(/\bset[A-Z]\w+/g))) context[setter] = (value: unknown) => { state[setter] = value; };
  context.storePendingOpeningPayload = (payload: any) => {
    context.pendingOpeningLineRef.current = payload.assistantText;
    context.pendingOpeningSpeechPrefetchRef.current = payload.speechPrefetch;
  };
  context.commitAssistantMessage = ({ message }: any) => startup.messages.push(message);
  context.appendMessage = (message: any) => startup.messages.push(message);
  context.appearsToEchoAssistantReply = () => false;
  context.requestConversationCompletion = () => { startup.conversationClosed = true; state.ended = true; };
  context.startOpeningPrefetch = (params: any) => callback(screen, "startOpeningPrefetch", context)(params);
  context.completeSessionRef.current = { startup };
  context.pauseForServiceFailure = (error: unknown, phase: string) => callback(screen, "pauseForServiceFailure", context)(error, phase);
  return { startup, events, state, context, run: (name: string, ...args: unknown[]) => callback(screen, name, context)(...args) };
}

const failure = (status: number, code: string | null = null, message = "Safe service failure") => new errors.MobileApiError(message, status, code);

for (const [name, error, kind] of [
  ["401 authentication", failure(401), "auth"],
  ["429 daily allowance", failure(429, null, "User daily time allotment reached."), "allowance"],
  ["429 service throttle", failure(429), "throttled"],
  ["429 AI budget", failure(429, "ai_budget_limit"), "budget"],
  ["503 unavailable", failure(503, "ai_unavailable"), "unavailable"],
  ["500 internal error", failure(500, "internal_error"), "unavailable"],
  ["502 provider error", failure(502), "unavailable"],
  ["504 timeout", failure(504, "ai_timeout"), "unavailable"],
] as const) {
  test(`real screen startup handles ${name} without mock dialogue or microphone capture`, async () => {
    const h = screenHarness({ openingError: error });
    await h.run("startSession");
    assert.equal(h.startup.registered, true); assert.equal(h.startup.startedAt, null);
    assert.equal(h.startup.serviceRecovery.failure?.kind, kind);
    assert.equal(h.startup.messages.length, 0); assert.equal(h.events.capture, 0);
    assert.equal(h.context.usedMockModeDuringSessionRef.current, null);
    await h.run("completeSessionAndScore");
    assert.equal(h.events.completions.length, 0); assert.equal(h.events.exits.length, 1);
  });
}

test("network failure before registration sends no opening, records no completion, and retry uses the same ID", async () => {
  const options = { registrationError: new TypeError("Network request failed") as Error | undefined };
  const h = screenHarness(options);
  await h.run("startSession");
  assert.equal(h.startup.registered, false); assert.equal(h.events.openings, 0);
  options.registrationError = undefined;
  await h.run("startSession");
  assert.equal(h.events.registrations, 2); assert.equal(h.events.openings, 1);
  assert.equal(h.startup.messages.length, 1); assert.equal(h.events.capture, 1);
  await h.run("startSession");
  assert.equal(h.events.openings, 1, "a duplicate start cannot deliver a second opening");
});

test("startup opening retry preserves registration and never commits a duplicate opening", async () => {
  const options = { openingError: failure(503) as Error | undefined };
  const h = screenHarness(options); await h.run("startSession");
  options.openingError = undefined;
  await Promise.all([h.run("startSession"), h.run("startSession")]);
  assert.equal(h.events.registrations, 1); assert.equal(h.events.openings, 2);
  assert.equal(h.startup.messages.length, 1); assert.equal(h.events.capture, 1);
});

test("release builds cannot opt into mocking, and an unconfigured release cannot start", async () => {
  for (const flag of [undefined, "true", "false"]) assert.equal(recovery.isDevelopmentSimulationMockEnabled(false, flag, false), false);
  assert.equal(recovery.isDevelopmentSimulationMockEnabled(true, undefined, false), false);
  assert.equal(recovery.isDevelopmentSimulationMockEnabled(true, "true", true), false);
  const h = screenHarness({ configured: false }); await h.run("startSession");
  assert.equal(h.events.registrations, 0); assert.equal(h.events.openings, 0); assert.equal(h.events.capture, 0);
  assert.match(h.state.setError, /not configured/);
});

test("explicit offline developer mocking remains labelled and does not register with a real API", async () => {
  assert.equal(recovery.isDevelopmentSimulationMockEnabled(true, "true", false), true);
  const h = screenHarness({ local: true, configured: false }); await h.run("startSession");
  assert.equal(h.events.registrations, 0); assert.equal(h.events.openings, 0);
  assert.equal(h.context.usedMockModeDuringSessionRef.current, true);
  assert.equal(h.startup.messages[0].content, "Explicit development mock");
  await h.run("completeSessionAndScore");
  assert.equal(h.events.completions[0].usedMockMode, true);
  assert.deepEqual(recovery.getSimulationCompletionPolicy(h.events.completions[0]), { recordUsage: false, requestScore: false });
});

test("active service interruption stops audio and capture; only confirmed submitted-turn recovery can resume", async () => {
  const h = screenHarness(); await h.run("startSession");
  h.context.pendingUnifiedTurnRecoveryRef.current = { correlationId: "original-turn", userMessage: null, assistantMessage: null };
  await h.run("pauseForServiceFailure", new TypeError("Network request failed"), "turn");
  assert.equal(h.events.stopped, 1); assert.equal(h.events.cancelled, 1);
  assert.equal(h.startup.serviceRecovery.failure?.retry, "submitted");
  assert.equal(h.events.capture, 1, "failure must not restart capture automatically");
  let awaits = 0;
  h.context.awaitSubmittedSimulationTurnReply = async () => {
    awaits++; assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current.correlationId, "original-turn");
    return { outcome: "assistant_reply", transcriptText: "Confirmed learner response", assistantText: "Server-confirmed reply", speechPrefetch: null };
  };
  h.context.settlePendingSubmittedTurnRecovery = (params: unknown) => h.run("settlePendingSubmittedTurnRecovery", params);
  h.context.assertForegroundSessionGenerationCurrent = () => {};
  h.context.isForegroundSessionGenerationCurrent = () => true;
  await Promise.all([h.run("resumeLifecyclePausedTurn"), h.run("resumeLifecyclePausedTurn")]);
  assert.equal(awaits, 1); assert.equal(h.events.capture, 2); assert.equal(h.startup.serviceRecovery.failure, null);
  assert.equal(h.events.openings, 1); assert.equal(h.events.registrations, 1);
  assert.deepEqual(h.startup.messages.slice(1).map((message) => message.content), ["Confirmed learner response", "Server-confirmed reply"]);
});

test("active session deadline or completion prevents recording and finalizing another turn", async () => {
  for (const completed of [false, true]) {
    const h = screenHarness(); await h.run("startSession");
    if (completed) h.startup.conversationClosed = true;
    else h.startup.absoluteDeadlineMs = Date.now() - 1;
    await h.run("startListeningTurn");
    await h.run("finalizeTurn", { recordingInstanceId: "stale-recording", finalizationReason: "user_submit", explicitUserAction: true });
    assert.equal(h.state.ended, true); assert.equal(h.events.capture, 1);
    assert.equal(h.events.registrations, 1); assert.equal(h.events.openings, 1);
  }
});

test("active authentication failure exposes sign-in recovery and cannot resume capture", async () => {
  const h = screenHarness(); await h.run("startSession");
  await h.run("pauseForServiceFailure", failure(401), "turn");
  await h.run("onPrimaryButton", null);
  assert.equal(h.startup.serviceRecovery.failure?.kind, "auth");
  assert.match(h.state.setError, /sign.in.*expired/i); assert.equal(h.events.capture, 1);
});

test("audio cancellation failure cannot prevent stopping capture or displaying the service interruption", async () => {
  const h = screenHarness(); await h.run("startSession");
  h.context.cancelPendingTts = async () => { throw new Error("native playback already stopped"); };
  await h.run("pauseForServiceFailure", failure(503), "turn");
  assert.equal(h.events.stopped, 1); assert.equal(h.state.setMode, "idle");
  assert.match(h.state.setError, /temporarily unavailable/);
  assert.equal(h.events.capture, 1);
});

test("failed completion recovery preserves its submitted turn and only manual completion retries the recovery read", async () => {
  const h = screenHarness(); await h.run("startSession");
  h.context.pendingUnifiedTurnRecoveryRef.current = { correlationId: "original-turn", userMessage: null, assistantMessage: null };
  let recoveryReads = 0;
  h.context.settlePendingSubmittedTurnRecovery = async () => { recoveryReads++; throw failure(503); };
  await h.run("completeSessionAndScore");
  assert.equal(recoveryReads, 1); assert.equal(h.events.completions.length, 0);
  assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current.correlationId, "original-turn");
  assert.ok(h.startup.serviceRecovery.failure, "deadline timer must stay paused on this failure");
  await h.run("completeSessionAndScore"); assert.equal(recoveryReads, 2);
  assert.equal(h.events.completions.length, 0); assert.equal(h.events.registrations, 1);
});

test("transcription-only network failure permits an explicit new capture without retrying any AI turn", async () => {
  const h = screenHarness(); await h.run("startSession");
  await h.run("pauseForServiceFailure", new TypeError("Network request failed"), "transcription");
  assert.equal(h.startup.serviceRecovery.failure?.retry, "recording");
  h.context.assertForegroundSessionGenerationCurrent = () => {};
  h.context.isForegroundSessionGenerationCurrent = () => true;
  await h.run("resumeLifecyclePausedTurn");
  assert.equal(h.events.capture, 2); assert.equal(h.events.openings, 1); assert.equal(h.events.registrations, 1);
  assert.equal(h.startup.serviceRecovery.scoringBlocked, false);
});

test("legacy daily plan and organization allowance messages remain distinct from service budget and throttle failures", () => {
  for (const message of ["Daily plan limit reached.", "User daily time allotment reached.", "Organization monthly allotment reached."]) {
    for (const status of [403, 429]) {
      const result = recovery.describeSimulationServiceFailure(failure(status, null, message));
      assert.equal(result.kind, "allowance"); assert.ok(result.message.startsWith(message));
      assert.doesNotMatch(result.message, /midnight|remaining|tomorrow|\d+ minutes/i);
    }
  }
});

test("ambiguous legacy turn failure blocks fresh turns and scoring while retaining real usage eligibility", async () => {
  const h = screenHarness(); await h.run("startSession");
  await h.run("pauseForServiceFailure", failure(503), "turn");
  assert.equal(h.startup.serviceRecovery.failure?.retry, "none");
  await h.run("onPrimaryButton", null); assert.equal(h.events.capture, 1);
  assert.equal(h.startup.serviceRecovery.scoringBlocked, true);
  await h.run("completeSessionAndScore");
  assert.deepEqual(recovery.getSimulationCompletionPolicy(h.events.completions[0]), { recordUsage: true, requestScore: false });
});

for (const code of ["session_expired", "session_completed"]) {
  test(`real screen honors ${code} without retrying registration or substituting dialogue`, async () => {
    const h = screenHarness({ openingError: failure(409, code) }); await h.run("startSession");
    assert.equal(h.startup.conversationClosed, true); assert.equal(h.events.capture, 0);
    await h.run("startSession"); assert.equal(h.events.registrations, 1); assert.equal(h.events.openings, 1);
    assert.equal(h.startup.messages.length, 0);
  });
}

function completionHarness() {
  const calls = { usage: 0, scoring: 0, recovered: 0 };
  const state: Record<string, any> = {};
  const context: Record<string, any> = { ...scoring, ...recovery, user: { id: "learner" }, mobileAuthToken: "auth", apiConfigured: true,
    config: { featureFlags: { scoringEnabled: true } }, lastHandledSimulationCompletionRef: { current: null },
    buildScorecardSupportDiagnostics: () => ({}), getMissingUsageRecordFields: () => [],
    createSimulationCorrelationId: interaction.createSimulationCorrelationId,
    DIFFICULTY_LABELS: { medium: "Medium" }, PERSONA_LABELS: { skeptical: "Skeptical" },
    recordUsageSession: async () => { calls.usage++; return { entitlements: {} }; },
    evaluateSimulation: async () => { calls.scoring++; return { status: "scored", scorecard: { overallScore: 84 }, record: {} }; },
    recoverPersistedAiScore: async () => { calls.recovered++; return null; }, submitAutoErrorReport: async () => {},
  };
  for (const setter of new Set(app.match(/\bset[A-Z]\w+/g))) context[setter] = (value: unknown) => { state[setter] = value; };
  const run = callback(app, "handleSessionComplete", context);
  const history = Array.from({ length: 3 }, (_, i) => ({ id: String(i), role: "user", content: "Real submitted response" }));
  const config = { scenario: { id: "scenario", segmentId: "role", title: "Scenario" }, difficulty: "medium", personaStyle: "skeptical" };
  return { calls, state, async complete(timing: SessionTiming) { run(history, config, timing); await new Promise((r) => setImmediate(r)); } };
}

const timing: SessionTiming = { simulationSessionId: "session", startedAt: "2026-10-19T10:00:00Z", endedAt: "2026-10-19T10:01:00Z",
  rawDurationSeconds: 60, usedMockMode: false, conversationStarted: true };

test("actual App completion excludes development mocks and never-started activity from usage and AI scoring", async () => {
  for (const invalid of [{ ...timing, usedMockMode: true }, { ...timing, conversationStarted: false }]) {
    const h = completionHarness(); await h.complete(invalid);
    assert.equal(h.calls.usage, 0); assert.equal(h.calls.scoring, 0); assert.equal(h.state.setScorecard, null);
  }
});

test("actual App completion preserves genuine interrupted usage, blocks unconfirmed scoring and deduplicates callbacks", async () => {
  const h = completionHarness(); await h.complete({ ...timing, scoringBlocked: true });
  await h.complete({ ...timing, scoringBlocked: true });
  assert.equal(h.calls.usage, 1); assert.equal(h.calls.scoring, 0); assert.equal(h.state.setScorecard, null);
});

test("ordinary real completion still records usage and displays the authoritative score exactly once", async () => {
  const h = completionHarness(); await h.complete(timing); await h.complete(timing);
  assert.equal(h.calls.usage, 1); assert.equal(h.calls.scoring, 1); assert.equal(h.calls.recovered, 0);
  assert.deepEqual(h.state.setScorecard, { overallScore: 84 }); assert.equal(h.state.setScorecardStatus, "scored");
});
