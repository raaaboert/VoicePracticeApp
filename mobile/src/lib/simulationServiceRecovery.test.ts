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
import type { DialogueMessage, SessionTiming } from "../types";

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
  const events = { registrations: 0, openings: 0, capture: 0, stopped: 0, cancelled: 0, completions: [] as SessionTiming[], histories: [] as DialogueMessage[][], exits: [] as string[] };
  const state: Record<string, any> = {};
  class LifecycleInterrupted extends Error {}
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
    SimulationLifecycleInterruptedError: LifecycleInterrupted,
    isSimulationLifecycleInterruptedError: (error: unknown) => error instanceof LifecycleInterrupted,
    isAssistantSpeechIncompleteError: () => false,
    clearLifecyclePause: () => { context.lifecyclePauseReasonRef.current = null; },
    endSession: async () => { startup.conversationClosed = true; }, onExit: (message: string) => events.exits.push(message),
    onSessionComplete: (history: DialogueMessage[], _config: unknown, timing: SessionTiming) => {
      events.histories.push(history); events.completions.push(timing);
    },
  };
  for (const ref of new Set(screen.match(/\b\w+Ref\b/g))) context[ref] = { current: null };
  context.serviceRecoveryRef.current = startup.serviceRecovery;
  context.messagesRef.current = startup.messages;
  context.startSimulationAttemptRef.current = 0; context.sessionLifecycleGenerationRef.current = 0;
  context.submittedRecordingInstanceIdsRef.current = new Set();
  for (const setter of new Set(screen.match(/\bset[A-Z]\w+/g))) context[setter] = (value: unknown) => { state[setter] = value; };
  context.storePendingOpeningPayload = (payload: any) => {
    context.pendingOpeningLineRef.current = payload.assistantText;
    context.pendingOpeningSpeechPrefetchRef.current = payload.speechPrefetch;
  };
  context.commitAssistantMessage = ({ message }: any) => startup.messages.push(message);
  context.appendMessage = (message: any) => { context.messagesRef.current.push(message); startup.messages = context.messagesRef.current; };
  context.appearsToEchoAssistantReply = () => false;
  context.requestConversationCompletion = () => { startup.conversationClosed = true; state.ended = true; };
  context.startOpeningPrefetch = (params: any) => callback(screen, "startOpeningPrefetch", context)(params);
  context.completeSessionRef.current = { startup };
  context.pauseForServiceFailure = (error: unknown, phase: string) => callback(screen, "pauseForServiceFailure", context)(error, phase);
  context.discardClearedSubmittedTurn = () => callback(screen, "discardClearedSubmittedTurn", context)();
  context.settlePendingSubmittedTurnRecovery = (params: unknown) => callback(screen, "settlePendingSubmittedTurnRecovery", context)(params);
  context.isSessionGenerationCurrent = (generation: number) => callback(screen, "isSessionGenerationCurrent", context)(generation);
  context.isForegroundSessionGenerationCurrent = (generation: number) => callback(screen, "isForegroundSessionGenerationCurrent", context)(generation);
  context.clearLifecyclePause = (now?: number) => callback(screen, "clearLifecyclePause", context)(now);
  context.abortActiveTurnRequests = () => callback(screen, "abortActiveTurnRequests", context)();
  context.clearTurnMonitoring = () => callback(screen, "clearTurnMonitoring", context)();
  context.endSession = (show: boolean) => callback(screen, "endSession", context)(show);
  context.assertForegroundSessionGenerationCurrent = () => startup.assertConversationAvailable();
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

const clearedTurn = () => failure(410, null, "Simulation assistant reply is no longer pending for this correlationId.");
const awaitTimeout = () => failure(504, null, "Timed out waiting for simulation assistant reply.");

function addInterruptedTurn(h: ReturnType<typeof screenHarness>) {
  for (let i = 1; i <= 2; i++) {
    h.context.appendMessage({ id: `confirmed-user-${i}`, role: "user", content: `Confirmed learner response ${i}` });
    h.context.appendMessage({ id: `confirmed-ai-${i}`, role: "assistant", content: `Confirmed server reply ${i}` });
  }
  const provisional = { id: "discarded-user", role: "user", content: "Unconfirmed failed response" };
  h.context.appendMessage(provisional);
  h.context.pendingUnifiedTurnRecoveryRef.current = { correlationId: "original-turn", userMessage: provisional, assistantMessage: null };
  // Any accidental POST or legacy reply generation fails the callback test.
  h.context.submitRecordedSimulationTurn = h.context.generateAssistantReply = () => { throw Error("must not re-POST the interrupted turn"); };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("lost submit and repeated 504s can explicitly End Without Score once, without another recovery read", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  h.context.messagesRef.current.splice(h.context.messagesRef.current.length - 1, 0,
    { id: "confirmed-user-3", role: "user", content: "Earlier confirmed third response" },
    { id: "confirmed-ai-3", role: "assistant", content: "Earlier confirmed third reply" });
  const deadline = h.startup.absoluteDeadlineMs;
  await h.run("pauseForServiceFailure", new TypeError("Network request failed"), "turn");
  let reads = 0;
  h.context.awaitSubmittedSimulationTurnReply = async ({ correlationId }: { correlationId: string }) => {
    assert.equal(correlationId, "original-turn"); reads++; throw awaitTimeout();
  };
  await h.run("resumeLifecyclePausedTurn"); await h.run("resumeLifecyclePausedTurn");
  assert.equal(reads, 2); assert.equal(h.events.capture, 1);
  await Promise.all([h.run("completeSessionAndScore", true), h.run("completeSessionAndScore", true), h.run("completeSessionAndScore", true)]);
  assert.equal(reads, 2, "End must not request another 75-second await");
  assert.equal(h.events.completions.length, 1); assert.equal(h.events.registrations, 1); assert.equal(h.events.openings, 1);
  assert.equal(h.events.completions[0].scoringBlocked, true);
  assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current, null);
  assert.ok(h.events.stopped >= 2); assert.ok(h.events.cancelled >= 2);
  assert.equal(h.startup.absoluteDeadlineMs, deadline);
  assert.equal(h.startup.completionDelivered, true); assert.equal(h.startup.conversationClosed, true);
  assert.equal(h.events.histories[0].some((m) => m.id === "discarded-user"), false);
  assert.deepEqual(h.events.histories[0].map((m) => m.id), ["message-1", "confirmed-user-1", "confirmed-ai-1", "confirmed-user-2", "confirmed-ai-2", "confirmed-user-3", "confirmed-ai-3"]);
  const completed = completionHarness();
  await completed.complete(h.events.completions[0], h.events.histories[0]);
  await completed.complete(h.events.completions[0], h.events.histories[0]);
  assert.equal(completed.calls.usage, 1); assert.equal(completed.calls.scoring, 0); assert.equal(completed.calls.recovered, 0);
  assert.equal(completed.state.setScorecard, null);
});

test("network recovery failure can end with a usage attempt, and offline usage is never acknowledged as saved", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  await h.run("pauseForServiceFailure", new TypeError("Network request failed"), "turn");
  let reads = 0;
  h.context.awaitSubmittedSimulationTurnReply = async () => { reads++; throw new TypeError("Network request failed"); };
  await h.run("resumeLifecyclePausedTurn"); await h.run("completeSessionAndScore", true);
  assert.equal(reads, 1); assert.equal(h.events.completions.length, 1);
  const usage = deferred<{ entitlements: object }>();
  const completed = completionHarness({ usage: () => usage.promise });
  await completed.complete(h.events.completions[0], h.events.histories[0]);
  assert.equal(completed.calls.usage, 1); assert.equal(completed.state.setEntitlements, undefined);
  usage.reject(new TypeError("Network request failed")); await new Promise((r) => setImmediate(r));
  assert.equal(completed.state.setEntitlements, undefined);
  assert.equal(completed.calls.scoring, 0); assert.equal(completed.state.setScorecard, null);
  assert.match(completed.state.setScorecardError, /Network request failed/);
  assert.doesNotMatch(completed.state.setScorecardError, /success|saved|recorded/i);
  await completed.complete(h.events.completions[0], h.events.histories[0]);
  assert.equal(completed.calls.usage, 1, "duplicate completion must not replay usage submission");
});

test("unscored completion applies usage acknowledgement only after the server response", async () => {
  const usage = deferred<{ entitlements: object }>();
  const completed = completionHarness({ usage: () => usage.promise });
  await completed.complete({ ...timing, scoringBlocked: true });
  assert.equal(completed.calls.usage, 1); assert.equal(completed.state.setEntitlements, undefined);
  assert.equal(completed.calls.scoring, 0); assert.equal(completed.state.setScorecard, null);
  usage.resolve({ entitlements: { dailyUsedSeconds: 60 } }); await new Promise((r) => setImmediate(r));
  assert.deepEqual(completed.state.setEntitlements, { dailyUsedSeconds: 60 });
});

for (const late of ["reply", "504", "401", "session_expired", "session_completed"] as const) {
  test(`End during an in-flight recovery ignores late ${late} without state resurrection`, { timeout: 3_000 }, async () => {
    const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
    await h.run("pauseForServiceFailure", failure(503, "ai_unavailable"), "turn");
    const response = deferred<unknown>(); const entered = deferred<void>();
    let signal: AbortSignal | undefined; let reads = 0;
    h.context.awaitSubmittedSimulationTurnReply = (params: { signal: AbortSignal }) => {
      reads++; signal = params.signal; entered.resolve(); return response.promise; // Deliberately ignores abort.
    };
    const resume = h.run("resumeLifecyclePausedTurn"); await entered.promise;
    await Promise.all([h.run("completeSessionAndScore", true), h.run("completeSessionAndScore", true)]);
    assert.equal(signal?.aborted, true); assert.equal(h.events.completions.length, 1);
    assert.equal(h.events.capture, 1); assert.equal(reads, 1);
    const finalState = { ...h.state }; const finalHistory = [...h.startup.messages];
    if (late === "reply") response.resolve({ outcome: "assistant_reply", transcriptText: "Late learner text", assistantText: "Late AI text" });
    else response.reject(late === "504" ? awaitTimeout() : late === "401" ? failure(401) : failure(409, late));
    await resume;
    assert.deepEqual(h.state, finalState, "even late errors must not overwrite the finalized UI");
    assert.deepEqual(h.startup.messages, finalHistory);
    assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current, null);
    assert.equal(h.startup.completionDelivered, true); assert.equal(h.startup.serviceRecovery.scoringBlocked, true);
    await h.run("completeSessionAndScore", true); await h.run("startListeningTurn");
    assert.equal(h.events.completions.length, 1); assert.equal(h.events.capture, 1);
  });
}

test("75 seconds of unresolved recovery and earlier paused time do not count as practice on explicit End", { timeout: 3_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 19, 12) });
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  const deadline = h.startup.absoluteDeadlineMs;
  t.mock.timers.tick(60_000);
  await h.run("pauseForServiceFailure", new TypeError("Network request failed"), "turn");
  t.mock.timers.tick(30_000);
  const response = deferred<unknown>(); const entered = deferred<void>();
  h.context.awaitSubmittedSimulationTurnReply = () => { entered.resolve(); return response.promise; };
  const resume = h.run("resumeLifecyclePausedTurn"); await entered.promise;
  t.mock.timers.tick(75_000); // No real sleep, and no provider completion.
  await h.run("completeSessionAndScore", true);
  assert.equal(h.events.completions.length, 1);
  assert.equal(h.events.completions[0].rawDurationSeconds, 60);
  assert.equal(h.startup.absoluteDeadlineMs, deadline);
  response.reject(awaitTimeout()); await resume;
  assert.equal(h.events.completions.length, 1);
});

test("successful reconciliation excludes the wait but preserves real resumed voice time as practice", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 19, 12) });
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  t.mock.timers.tick(60_000); await h.run("pauseForServiceFailure", failure(503), "turn");
  t.mock.timers.tick(30_000);
  h.context.awaitSubmittedSimulationTurnReply = async () => {
    t.mock.timers.tick(75_000);
    return { outcome: "assistant_reply", transcriptText: "Real learner response", assistantText: "Real AI reply" };
  };
  h.context.speakAssistantResponse = async (_text: string, _time: number, start: () => void) => { start(); t.mock.timers.tick(10_000); };
  await h.run("resumeLifecyclePausedTurn"); await h.run("completeSessionAndScore", true);
  assert.equal(h.events.completions[0].rawDurationSeconds, 70);
  assert.equal(h.events.completions[0].scoringBlocked, false);
});

test("explicit End releases an already-running completion wait, including a deadline-driven recovery", { timeout: 3_000 }, async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  const response = deferred<unknown>(); const entered = deferred<void>();
  h.context.awaitSubmittedSimulationTurnReply = () => { entered.resolve(); return response.promise; };
  const complete = () => h.run("completeSessionAndScore");
  h.context.completeSessionRef.current = { startup: h.startup, run: complete };
  h.context.requestConversationCompletion = (serverEnded = false) => h.run("requestConversationCompletion", serverEnded);
  h.startup.absoluteDeadlineMs = Date.now() - 1;
  await h.run("startListeningTurn"); await entered.promise;
  assert.equal(h.context.sessionCompletionInProgressRef.current, true);
  await Promise.all([h.run("completeSessionAndScore", true), h.run("completeSessionAndScore", true)]);
  assert.equal(h.events.completions.length, 1); assert.equal(h.events.completions[0].scoringBlocked, true);
  assert.equal(h.events.capture, 1); assert.equal(h.startup.completionDelivered, true);
  response.reject(awaitTimeout()); await new Promise((r) => setImmediate(r));
  assert.equal(h.events.completions.length, 1);
});

test("unmount during recovery cannot change screen state, insert late text, or restart capture", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  await h.run("pauseForServiceFailure", failure(503), "turn");
  const response = deferred<unknown>(); const entered = deferred<void>();
  h.context.awaitSubmittedSimulationTurnReply = () => { entered.resolve(); return response.promise; };
  const resume = h.run("resumeLifecyclePausedTurn"); await entered.promise;
  h.context.unmountedRef.current = true; h.context.sessionLifecycleGenerationRef.current++;
  const state = { ...h.state }; const history = [...h.startup.messages];
  response.resolve({ outcome: "assistant_reply", transcriptText: "Late text", assistantText: "Late reply" }); await resume;
  assert.deepEqual(h.state, state); assert.deepEqual(h.startup.messages, history);
  assert.equal(h.events.capture, 1); assert.equal(h.events.completions.length, 0);
});

test("unmount releases an automatic completion wait without starting new recovery or delivering completion", { timeout: 3_000 }, async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  const response = deferred<unknown>(); const entered = deferred<void>();
  h.context.awaitSubmittedSimulationTurnReply = () => { entered.resolve(); return response.promise; };
  const completing = h.run("completeSessionAndScore"); await entered.promise;
  h.context.unmountedRef.current = true; h.context.sessionLifecycleGenerationRef.current++;
  h.context.interruptCompletionWaitRef.current();
  await completing;
  const state = { ...h.state };
  response.reject(awaitTimeout()); await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.state, state); assert.equal(h.events.completions.length, 0); assert.equal(h.events.capture, 1);
  assert.match(screen, /unmountedRef.current = true;[\s\S]*?interruptCompletionWaitRef.current\?\.\(\)/);
});

test("audio cleanup rejection cannot prevent stopping capture and completing deliberate End without a score", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  h.context.cancelPendingTts = async () => { throw Error("native playback already disposed"); };
  await h.run("completeSessionAndScore", true);
  assert.equal(h.events.stopped, 1); assert.equal(h.events.completions.length, 1);
  assert.equal(h.events.completions[0].scoringBlocked, true);
});

test("503 then settled recovery 410 offers explicit Record Again, removes only provisional evidence, and replacement remains scoreable", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  await h.run("pauseForServiceFailure", failure(503, "ai_unavailable"), "turn");
  let reads = 0;
  h.context.awaitSubmittedSimulationTurnReply = async ({ correlationId }: { correlationId: string }) => {
    reads++; assert.equal(correlationId, "original-turn"); throw clearedTurn();
  };
  await Promise.all([h.run("resumeLifecyclePausedTurn"), h.run("resumeLifecyclePausedTurn")]);
  assert.equal(reads, 1); assert.equal(h.events.capture, 1, "terminal recovery must not start recording");
  assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current, null);
  assert.equal(h.startup.serviceRecovery.failure?.retry, "record_again");
  assert.match(h.state.setError, /could not be recovered.*Record Again/);
  assert.doesNotMatch(h.state.setError, /access|permission|Setup/);
  assert.equal(h.startup.serviceRecovery.scoringBlocked, false);
  assert.deepEqual(h.startup.messages.map((m) => m.id), ["message-1", "confirmed-user-1", "confirmed-ai-1", "confirmed-user-2", "confirmed-ai-2"]);
  const beforeReplacement = completionHarness();
  await beforeReplacement.complete(timing, h.startup.messages);
  assert.equal(beforeReplacement.calls.scoring, 0, "discarded transcript cannot supply the missing third response");

  await Promise.all([h.run("resumeLifecyclePausedTurn"), h.run("resumeLifecyclePausedTurn")]);
  assert.equal(h.events.capture, 2, "explicit Record Again starts just one new capture");
  assert.equal(reads, 1, "recording again never replays the original request");
  assert.equal(h.startup.serviceRecovery.failure, null);
  h.context.pendingUnifiedTurnRecoveryRef.current = { correlationId: "replacement-turn", userMessage: null, assistantMessage: null };
  // The replacement contributes only once the server confirms its actual exchange.
  h.context.awaitSubmittedSimulationTurnReply = async ({ correlationId }: { correlationId: string }) => {
    reads++; assert.equal(correlationId, "replacement-turn");
    return { outcome: "assistant_reply", transcriptText: "New confirmed replacement response", assistantText: "New confirmed server reply" };
  };
  await h.run("settlePendingSubmittedTurnRecovery", { sessionLifecycleGeneration: h.context.sessionLifecycleGenerationRef.current, replayAssistant: false });
  await Promise.all([h.run("completeSessionAndScore", true), h.run("completeSessionAndScore", true)]);
  assert.equal(reads, 2); assert.equal(h.events.completions.length, 1);
  assert.equal(h.events.registrations, 1); assert.equal(h.events.openings, 1);
  const evidence = h.events.histories[0];
  assert.equal(new Set(evidence.map((m) => m.id)).size, evidence.length);
  assert.equal(evidence.filter((m) => m.role === "user").length, 3);
  assert.ok(!evidence.some((m) => m.id === "discarded-user"));
  assert.deepEqual(recovery.getSimulationCompletionPolicy(h.events.completions[0]), { recordUsage: true, requestScore: true });
  const scored = completionHarness(); await scored.complete(h.events.completions[0], evidence);
  await scored.complete(h.events.completions[0], evidence);
  assert.equal(scored.calls.usage, 1); assert.equal(scored.calls.scoring, 1);
  assert.deepEqual(scored.calls.scoredHistory, evidence);
});

for (const [name, error] of [["deployed await 504", awaitTimeout()], ["gateway 504", failure(504)],
  ["temporary 503", failure(503)], ["network loss", new TypeError("Network request failed")]] as const) {
  test(`lost submit then ${name} keeps read-only reconciliation and prevents unconfirmed scoring`, async () => {
    const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
    await h.run("pauseForServiceFailure", new TypeError("Network request failed"), "turn");
    let reads = 0;
    h.context.awaitSubmittedSimulationTurnReply = async ({ correlationId }: { correlationId: string }) => {
      reads++; assert.equal(correlationId, "original-turn"); throw error;
    };
    await Promise.all([h.run("resumeLifecyclePausedTurn"), h.run("resumeLifecyclePausedTurn")]);
    assert.equal(reads, 1); assert.equal(h.events.capture, 1);
    assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current.correlationId, "original-turn");
    assert.equal(h.startup.serviceRecovery.failure?.retry, "submitted");
    assert.equal(h.startup.serviceRecovery.scoringBlocked, false, "recoverable pending work must not cause a permanent block");
    await h.run("completeSessionAndScore");
    assert.equal(reads, 2); assert.equal(h.events.completions.length, 0, "ambiguous work cannot enter scored evidence");
    assert.equal(h.events.registrations, 1); assert.equal(h.events.openings, 1);
  });
}

test("504 can reconcile a later real reply without re-recording or duplicating transcript/audio entries", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  await h.run("pauseForServiceFailure", new TypeError("Network request failed"), "turn");
  let reads = 0;
  h.context.awaitSubmittedSimulationTurnReply = async () => {
    if (++reads === 1) throw awaitTimeout();
    return { outcome: "assistant_reply", transcriptText: "Unconfirmed failed response", assistantText: "Late real server reply" };
  };
  await h.run("resumeLifecyclePausedTurn"); assert.equal(h.events.capture, 1);
  await Promise.all([h.run("resumeLifecyclePausedTurn"), h.run("resumeLifecyclePausedTurn")]);
  assert.equal(reads, 2); assert.equal(h.events.capture, 2);
  assert.equal(h.startup.messages.filter((m) => m.id === "discarded-user").length, 1);
  assert.equal(h.startup.messages.filter((m) => m.content === "Late real server reply").length, 1);
  assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current, null);
  assert.equal(h.startup.serviceRecovery.failure, null);
});

test("a later confirmed 410 can release a previously ambiguous 504 for explicit re-recording", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  await h.run("pauseForServiceFailure", new TypeError("Network request failed"), "turn");
  let reads = 0;
  h.context.awaitSubmittedSimulationTurnReply = async () => { if (++reads === 1) throw awaitTimeout(); throw clearedTurn(); };
  await h.run("resumeLifecyclePausedTurn"); await h.run("resumeLifecyclePausedTurn");
  assert.equal(h.events.capture, 1); assert.equal(h.startup.serviceRecovery.failure?.retry, "record_again");
  assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current, null);
  assert.equal(h.startup.serviceRecovery.scoringBlocked, false);
});

test("known cleared turn received in the active submit path also pauses without fresh legacy generation", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  await h.run("pauseForServiceFailure", clearedTurn(), "turn");
  assert.equal(h.events.capture, 1); assert.equal(h.startup.serviceRecovery.failure?.retry, "record_again");
  assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current, null);
  assert.equal(h.startup.messages.some((m) => m.id === "discarded-user"), false);
  assert.doesNotMatch(screen, /Assistant reply expired\. Preparing a fresh reply/);
  assert.match(screen, /if \(expiredSubmittedTurnAwait \|\| !shouldFallbackToLegacyReply\)\s*\{\s*throw awaitError/);
});

for (const status of [401, 403]) {
  test(`recovery ${status} preserves real authorization denial and cannot authorize Record Again`, async () => {
    const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
    await h.run("pauseForServiceFailure", failure(503), "turn");
    h.context.awaitSubmittedSimulationTurnReply = async () => { throw failure(status); };
    await h.run("resumeLifecyclePausedTurn"); await h.run("onPrimaryButton", null);
    assert.equal(h.startup.serviceRecovery.failure?.retry, "none");
    assert.equal(h.startup.serviceRecovery.failure?.kind, status === 401 ? "auth" : "denied");
    assert.equal(h.context.pendingUnifiedTurnRecoveryRef.current.correlationId, "original-turn");
    assert.equal(h.events.capture, 1);
  });
}

for (const closed of [false, true]) {
  test(`Record Again cannot restart an ${closed ? "already completed" : "expired"} session`, async () => {
    const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
    await h.run("pauseForServiceFailure", clearedTurn(), "turn");
    if (closed) h.startup.conversationClosed = true;
    else h.startup.absoluteDeadlineMs = Date.now() - 1;
    await h.run("resumeLifecyclePausedTurn");
    assert.equal(h.events.capture, 1); assert.equal(h.events.registrations, 1); assert.equal(h.events.openings, 1);
    assert.equal(h.state.ended, true);
  });
}

test("safe discard does not remove an independent prior scoring block, and blocked/pending completion does not promise scoring", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  h.startup.serviceRecovery.scoringBlocked = true;
  await h.run("pauseForServiceFailure", clearedTurn(), "turn");
  assert.equal(h.startup.serviceRecovery.scoringBlocked, true);
  assert.match(screen, /label: "Record Again"/);
  assert.match(screen, /serviceRecoveryRef.current.scoringBlocked \|\| hasUnresolvedSubmittedTurn\s*\? "End Without Score" : "End Session and Score"/);
  assert.match(screen, /void completeSessionAndScore\(true\)/);
});

test("explicit End after settled 410 scores only earlier confirmed turns, without recording or poisoning eligibility", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  h.context.appendMessage({ id: "confirmed-user-3", role: "user", content: "Earlier third confirmed response" });
  h.context.appendMessage({ id: "confirmed-ai-3", role: "assistant", content: "Earlier third server reply" });
  await h.run("pauseForServiceFailure", failure(503), "turn");
  h.context.awaitSubmittedSimulationTurnReply = async () => { throw clearedTurn(); };
  await h.run("resumeLifecyclePausedTurn");
  assert.equal(h.startup.serviceRecovery.failure?.retry, "record_again");
  await h.run("completeSessionAndScore", true);
  assert.equal(h.events.completions.length, 1); assert.equal(h.events.capture, 1);
  assert.equal(h.events.completions[0].scoringBlocked, false);
  const scored = completionHarness(); await scored.complete(h.events.completions[0], h.events.histories[0]);
  assert.equal(scored.calls.scoring, 1); assert.equal(scored.calls.usage, 1);
  assert.equal(scored.calls.scoredHistory.some((m) => m.id === "discarded-user"), false);
});

test("real interrupted-audio resume replays the confirmed assistant once without duplicating its transcript", async () => {
  const h = screenHarness(); await h.run("startSession");
  const opening = h.startup.messages[0];
  h.context.lifecyclePauseReasonRef.current = "tts_recovery";
  h.context.activeAssistantSpeechRef.current = { message: opening, committed: true };
  const spoken: string[] = [];
  h.context.speakAssistantResponse = async (text: string, _time: number, start: () => void) => { spoken.push(text); start(); };
  await Promise.all([h.run("resumeLifecyclePausedTurn"), h.run("resumeLifecyclePausedTurn")]);
  assert.deepEqual(spoken, [opening.content]); assert.equal(h.startup.messages.length, 1);
  assert.equal(h.events.capture, 2); assert.equal(h.events.registrations, 1); assert.equal(h.events.openings, 1);
  assert.equal(h.startup.serviceRecovery.scoringBlocked, false);
});

for (const code of ["session_expired", "session_completed"]) {
  test(`${code} during recovery cannot turn an unconfirmed third response into scored evidence`, async () => {
    const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
    await h.run("pauseForServiceFailure", failure(503), "turn");
    h.context.awaitSubmittedSimulationTurnReply = async () => { throw failure(409, code); };
    await h.run("completeSessionAndScore");
    assert.equal(h.events.capture, 1); assert.equal(h.events.completions.length, 1);
    assert.equal(h.events.completions[0].scoringBlocked, true);
    const completed = completionHarness(); await completed.complete(h.events.completions[0], h.events.histories[0]);
    assert.equal(completed.calls.scoring, 0); assert.equal(completed.calls.usage, 1);
    assert.equal(completed.state.setScorecard, null);
  });
}

test("background recovery of the confirmed cleared turn also waits for an explicit Record Again", async () => {
  const h = screenHarness(); await h.run("startSession"); addInterruptedTurn(h);
  h.context.lifecyclePauseReasonRef.current = "background";
  h.context.awaitSubmittedSimulationTurnReply = async () => { throw clearedTurn(); };
  await h.run("resumeLifecyclePausedTurn");
  assert.equal(h.events.capture, 1); assert.equal(h.startup.serviceRecovery.failure?.retry, "record_again");
  assert.equal(h.startup.serviceRecovery.scoringBlocked, false);
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

test("automatic completion preserves unresolved work; explicit End can abandon it instead of requiring another read", async () => {
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
  await h.run("completeSessionAndScore", true);
  assert.equal(recoveryReads, 2); assert.equal(h.events.completions.length, 1);
  assert.equal(h.events.completions[0].scoringBlocked, true);
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

function completionHarness(options: { usage?: () => Promise<{ entitlements: object }> } = {}) {
  const calls = { usage: 0, scoring: 0, recovered: 0, scoredHistory: [] as DialogueMessage[] };
  const state: Record<string, any> = {};
  const context: Record<string, any> = { ...scoring, ...recovery, user: { id: "learner" }, mobileAuthToken: "auth", apiConfigured: true,
    config: { featureFlags: { scoringEnabled: true } }, lastHandledSimulationCompletionRef: { current: null },
    buildScorecardSupportDiagnostics: () => ({}), getMissingUsageRecordFields: () => [],
    createSimulationCorrelationId: interaction.createSimulationCorrelationId,
    DIFFICULTY_LABELS: { medium: "Medium" }, PERSONA_LABELS: { skeptical: "Skeptical" },
    recordUsageSession: async () => { calls.usage++; return options.usage ? options.usage() : { entitlements: {} }; },
    getErrorMessage: (error: Error, fallback: string) => error.message || fallback,
    evaluateSimulation: async (params: { history: DialogueMessage[] }) => { calls.scoring++; calls.scoredHistory = params.history;
      return { status: "scored", scorecard: { overallScore: 84 }, record: {} }; },
    recoverPersistedAiScore: async () => { calls.recovered++; return null; }, submitAutoErrorReport: async () => {},
  };
  for (const setter of new Set(app.match(/\bset[A-Z]\w+/g))) context[setter] = (value: unknown) => { state[setter] = value; };
  const run = callback(app, "handleSessionComplete", context);
  const history = Array.from({ length: 3 }, (_, i) => ({ id: String(i), role: "user", content: "Real submitted response" }));
  const config = { scenario: { id: "scenario", segmentId: "role", title: "Scenario" }, difficulty: "medium", personaStyle: "skeptical" };
  return { calls, state, async complete(timing: SessionTiming, evidence = history) { run(evidence, config, timing); await new Promise((r) => setImmediate(r)); } };
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
