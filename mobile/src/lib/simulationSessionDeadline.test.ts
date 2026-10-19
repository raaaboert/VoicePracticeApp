import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MobileApiError, isSimulationSessionEndedError, isTransientRequestError } from "./apiError";
import { createSimulationStartupCoordinator, getSimulationRemainingSeconds } from "./simulationStartup";
import { isExpiredSubmittedTurnAwait, isTerminalSubmittedTurnRecoveryAwait, shouldFallbackToLegacyAssistantReply,
  shouldFallbackToLegacyUnifiedSubmit } from "./unifiedSubmit";

const payload = { assistantText: "Opening", trainingPackId: null, speechPrefetch: null };
const ended = (code: string) => new MobileApiError("Conversation ended", 409, code);

test("registration request start anchors the deadline and opening generation consumes countdown time", async () => {
  let now = 10_000;
  const startup = createSimulationStartupCoordinator(() => now);
  await startup.register(async () => { now += 2_000; }, { maxSimulationMinutes: 1 });
  assert.equal(startup.registrationRequestedAtMs, 10_000);
  assert.equal(startup.absoluteDeadlineMs, 70_000);
  now += 20_000;
  await startup.prepareOpening(async () => { now += 10_000; return payload; });
  assert.equal(getSimulationRemainingSeconds({ maxSessionSeconds: 60, elapsedSeconds: 0,
    absoluteDeadlineMs: startup.absoluteDeadlineMs, nowMs: now }), 23);
  assert.equal(startup.absoluteDeadlineMs, 70_000);
});

for (const minutes of [1, 5, 20, 60]) {
  test(`${minutes}-minute configured maximum ends at the earlier active or conservative absolute limit`, async () => {
    let now = 1_000;
    const startup = createSimulationStartupCoordinator(() => now);
    await startup.register(async () => {}, { maxSimulationMinutes: minutes });
    assert.equal(startup.absoluteDeadlineMs, now + minutes * 60_000);
    now = startup.absoluteDeadlineMs! - 5_000;
    assert.equal(getSimulationRemainingSeconds({ maxSessionSeconds: minutes * 60, elapsedSeconds: 10,
      absoluteDeadlineMs: startup.absoluteDeadlineMs, nowMs: now }), 0);
    assert.throws(() => startup.assertConversationAvailable(), isSimulationSessionEndedError);
    assert.equal(getSimulationRemainingSeconds({ maxSessionSeconds: minutes * 60, elapsedSeconds: minutes * 60,
      absoluteDeadlineMs: now + 60_000, nowMs: now }), 0, "active maximum still applies independently");
  });
}

test("background active-clock adjustment cannot extend the absolute deadline", async () => {
  let now = 10_000;
  const startup = createSimulationStartupCoordinator(() => now);
  await startup.register(async () => {}, { maxSimulationMinutes: 5 });
  const deadline = startup.absoluteDeadlineMs;
  startup.startedAt = new Date(20_000);
  // Existing usage clock shifts forward by the pause duration on resume.
  startup.startedAt = new Date(startup.startedAt.getTime() + 120_000);
  now = 306_000;
  const activeElapsed = Math.floor((now - startup.startedAt.getTime()) / 1_000);
  assert.ok(activeElapsed < 300);
  assert.equal(startup.absoluteDeadlineMs, deadline);
  assert.equal(getSimulationRemainingSeconds({ maxSessionSeconds: 300, elapsedSeconds: activeElapsed,
    absoluteDeadlineMs: deadline, nowMs: now }), 0);
});

test("lost registration response, opening retry and remount reuse the original deadline", async () => {
  let now = 1_000;
  const startup = createSimulationStartupCoordinator(() => now);
  let requests = 0;
  await assert.rejects(startup.register(async () => { requests++; throw new Error("lost response"); },
    { maxSimulationMinutes: 1 }), /lost response/);
  now += 10_000;
  await startup.register(async () => { requests++; }, { maxSimulationMinutes: 60 });
  assert.equal(startup.absoluteDeadlineMs, 61_000, "retry cannot extend the possibly registered server session");
  await assert.rejects(startup.prepareOpening(async () => { throw new Error("opening failed"); }));
  now += 10_000;
  const remounted = startup; // App supplies this same coordinator to the remounted screen.
  await remounted.register(async () => { requests++; }, { maxSimulationMinutes: 60 });
  await remounted.prepareOpening(async () => payload);
  assert.equal(requests, 2);
  assert.equal(remounted.absoluteDeadlineMs, 61_000);
  assert.equal(createSimulationStartupCoordinator(() => now).absoluteDeadlineMs, null, "a different identity gets independent state");
});

test("opening beyond the deadline cannot be delivered and the session ID cannot register again", async () => {
  let now = 0;
  const startup = createSimulationStartupCoordinator(() => now);
  let registrations = 0;
  await startup.register(async () => { registrations++; }, { maxSimulationMinutes: 1 });
  await assert.rejects(startup.prepareOpening(async () => { now = 60_000; return payload; }), isSimulationSessionEndedError);
  assert.equal(startup.opening, null);
  await assert.rejects(startup.register(async () => { registrations++; }, { maxSimulationMinutes: 60 }), isSimulationSessionEndedError);
  assert.equal(registrations, 1);
});

test("late server lifecycle failures stay terminal across remount even when the old screen ignores the response", async () => {
  const registration = createSimulationStartupCoordinator(() => 1_000);
  await assert.rejects(registration.register(async () => { throw ended("session_completed"); },
    { maxSimulationMinutes: 20 }), isSimulationSessionEndedError);
  assert.equal(registration.conversationClosed, true);
  let retries = 0;
  await assert.rejects(registration.register(async () => { retries++; }), isSimulationSessionEndedError);
  assert.equal(retries, 0);

  const opening = createSimulationStartupCoordinator(() => 1_000);
  await opening.register(async () => {}, { maxSimulationMinutes: 20 });
  await assert.rejects(opening.prepareOpening(async () => { throw ended("session_expired"); }), isSimulationSessionEndedError);
  assert.equal(opening.conversationClosed, true);
  assert.equal(opening.absoluteDeadlineMs, 1_201_000);
  await assert.rejects(opening.prepareOpening(async () => { retries++; return payload; }), isSimulationSessionEndedError);
  assert.equal(retries, 0);
});

for (const code of ["session_expired", "session_completed"]) {
  test(`HTTP 409 ${code} is terminal conversation completion without retry or fresh-reply fallback`, () => {
    const error = ended(code);
    assert.equal(isSimulationSessionEndedError(error), true);
    assert.equal(isTransientRequestError(error), false);
    assert.equal(shouldFallbackToLegacyUnifiedSubmit(error), false);
    assert.equal(shouldFallbackToLegacyAssistantReply(error), false);
    assert.equal(isExpiredSubmittedTurnAwait(error), false, "do not generate a fresh reply");
    assert.equal(isTerminalSubmittedTurnRecoveryAwait(error), true, "clear unrecoverable pending conversation request");
  });
}

test("other 409 errors and non-409 responses retain existing classification", () => {
  for (const error of [ended("session_context_mismatch"), ended("industry_locked"), ended("validation_error"),
    new MobileApiError("unavailable", 503, "session_expired"), new Error("session_expired")]) {
    assert.equal(isSimulationSessionEndedError(error), false);
  }
  assert.equal(isExpiredSubmittedTurnAwait(new Error("Submitted turn expired")), true);
});

test("concurrent lifecycle errors and deadline completion finalize usage and deliver scoring once", async () => {
  const startup = createSimulationStartupCoordinator();
  await startup.register(async () => {});
  let usage = 0;
  let scores = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const finish = async () => {
    usage++;
    await gate;
    startup.deliverCompletion(() => { scores++; });
  };
  const fromTurn = isSimulationSessionEndedError(ended("session_expired")) ? startup.complete(finish) : null;
  const fromAwait = isSimulationSessionEndedError(ended("session_completed")) ? startup.complete(finish) : null;
  const fromTimer = startup.complete(finish);
  assert.equal(fromTurn, fromAwait);
  assert.equal(fromTurn, fromTimer);
  await Promise.resolve();
  assert.equal(usage, 1);
  release();
  await Promise.all([fromTurn, fromAwait, fromTimer]);
  await startup.complete(finish);
  startup.deliverCompletion(() => { scores++; });
  assert.equal(usage, 1);
  assert.equal(scores, 1);
  await assert.rejects(startup.register(async () => { throw new Error("must not register"); }), isSimulationSessionEndedError);
  await assert.rejects(startup.prepareOpening(async () => payload), isSimulationSessionEndedError);
});

test("failed completion does not manufacture a score and completion recovery remains possible", async () => {
  const startup = createSimulationStartupCoordinator();
  let score: unknown = null;
  await assert.rejects(startup.complete(async () => { throw new Error("recovery interrupted"); }));
  assert.equal(startup.completionDelivered, false);
  assert.equal(score, null);
  const persisted = { id: "original", overallScore: 80 };
  await startup.complete(async () => { startup.deliverCompletion(() => { score = persisted; }); });
  await startup.complete(async () => { score = { id: "replacement" }; });
  assert.equal(score, persisted);
});

test("an explicit exit closes the session without requesting usage or scoring completion", async () => {
  const startup = createSimulationStartupCoordinator();
  await startup.register(async () => {});
  startup.conversationClosed = true; // Existing Exit/long-background path.
  assert.equal(startup.completionRequested, false);
  assert.equal(startup.completionDelivered, false);
  await assert.rejects(startup.prepareOpening(async () => payload), isSimulationSessionEndedError);
  await assert.rejects(startup.register(async () => {}), isSimulationSessionEndedError);
  assert.equal(startup.completionRequested, false);
});

test("screen binds its existing timer, lifecycle catches and scoped coordinator to the completion path", () => {
  const source = readFileSync(new URL("../screens/SimulationScreen.tsx", import.meta.url), "utf8");
  assert.match(source, /startup\.register\([\s\S]*?maxSimulationMinutes: config\.maxSimulationMinutes/);
  assert.match(source, /absoluteDeadlineMs: startup\.absoluteDeadlineMs, nowMs/);
  assert.equal((source.match(/setInterval\(tick, 500\)/g) ?? []).length, 1);
  assert.match(source, /if \(isSimulationSessionEndedError\(turnError\)\) \{\s*continueLoop = false;\s*requestConversationCompletion\(true\)/);
  assert.match(source, /if \(isSimulationSessionEndedError\(unifiedError\)\) throw unifiedError/);
  assert.match(source, /if \(isSimulationSessionEndedError\(awaitError\)\) throw awaitError/);
  assert.match(source, /if \(isSimulationSessionEndedError\(startError\)\) \{\s*requestConversationCompletion\(true\)/);
  assert.match(source, /completion\?\.startup !== startup/);
  assert.match(source, /if \(startup\.conversationClosed && !startup\.completionRequested\) return/);
  const completion = source.slice(source.indexOf("const completeSessionAndScore ="), source.indexOf("const resumeLifecyclePausedTurn ="));
  assert.match(completion, /await startup\.complete\(/);
  assert.match(completion, /clearLifecyclePause\(endedAt\.getTime\(\)\);\s*const startedAt = sessionStartedAtRef\.current/);
  assert.match(completion, /startup\.deliverCompletion\(\(\) => onSessionComplete/);
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(app, /simulationConfig\?\.simulationSessionId, user\?\.id, mobileAuthToken, activeSuperUserOrgId, user\?\.orgId/);
});
