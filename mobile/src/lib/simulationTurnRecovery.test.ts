import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { countUserResponsesForVerifiedScorecard } from "./simulationScoreHandling";
import {
  getPendingSubmittedTurnRecoveryAfterAwaitFailure,
  mergeSubmittedTurnRecovery,
  settleSimulationBeforeCompletion,
  type PendingSubmittedTurnRecovery,
} from "./simulationTurnRecovery";
import type { DialogueMessage } from "../types";

const simulationScreenSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../screens/SimulationScreen.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

function completedHistory(userResponses: number): DialogueMessage[] {
  const history: DialogueMessage[] = [
    { id: "opening", role: "assistant", content: "Opening prompt" },
  ];
  for (let index = 1; index <= userResponses; index += 1) {
    history.push({ id: `user-${index}`, role: "user", content: `User response ${index}` });
    history.push({ id: `assistant-${index}`, role: "assistant", content: `Assistant response ${index}` });
  }
  return history;
}

test("score eligibility matrix preserves the three legitimate-response threshold", () => {
  assert.equal(countUserResponsesForVerifiedScorecard(completedHistory(2)), 2);
  assert.equal(countUserResponsesForVerifiedScorecard(completedHistory(3)), 3);

  const historyAfterBackgroundForeground = completedHistory(3);
  assert.equal(countUserResponsesForVerifiedScorecard(historyAfterBackgroundForeground), 3);

  const interruptedHistory = completedHistory(2);
  const pending: PendingSubmittedTurnRecovery = {
    correlationId: "sim-1-turn-3",
    userMessage: { id: "user-3", role: "user", content: "Recovered third response" },
    assistantMessage: { id: "assistant-3", role: "assistant", content: "Recovered reply" },
  };
  assert.equal(
    countUserResponsesForVerifiedScorecard(mergeSubmittedTurnRecovery(interruptedHistory, pending)),
    3,
  );
  assert.equal(countUserResponsesForVerifiedScorecard(completedHistory(4)), 4);
});

test("submitted-turn recovery does not duplicate an already committed user response", () => {
  const history = completedHistory(3).filter((message) => message.id !== "assistant-3");
  const pending: PendingSubmittedTurnRecovery = {
    correlationId: "sim-1-turn-3",
    userMessage: { id: "user-3", role: "user", content: "User response 3" },
    assistantMessage: { id: "assistant-3", role: "assistant", content: "Recovered reply" },
  };
  const merged = mergeSubmittedTurnRecovery(history, pending);

  assert.equal(merged.filter((message) => message.id === "user-3").length, 1);
  assert.equal(merged.filter((message) => message.id === "assistant-3").length, 1);
  assert.equal(countUserResponsesForVerifiedScorecard(merged), 3);
});

test("a recovery without a legitimate user transcript cannot create score eligibility", () => {
  const pending: PendingSubmittedTurnRecovery = {
    correlationId: "sim-1-turn-3",
    userMessage: null,
    assistantMessage: { id: "assistant-3", role: "assistant", content: "Unpaired reply" },
  };

  assert.equal(countUserResponsesForVerifiedScorecard(mergeSubmittedTurnRecovery(completedHistory(2), pending)), 2);
});

test("terminal recovery failure clears pending state while unrelated failure remains retryable", () => {
  const pending: PendingSubmittedTurnRecovery = {
    correlationId: "sim-1-turn-3",
    userMessage: { id: "user-3", role: "user", content: "Uncommitted third response" },
    assistantMessage: null,
  };

  assert.equal(getPendingSubmittedTurnRecoveryAfterAwaitFailure(pending, true), null);
  assert.equal(getPendingSubmittedTurnRecoveryAfterAwaitFailure(pending, false), pending);
  assert.equal(countUserResponsesForVerifiedScorecard(completedHistory(2)), 2);
});

test("the simulation preserves a submitted turn for lifecycle recovery", () => {
  assert.match(
    simulationScreenSource,
    /pendingUnifiedTurnRecoveryRef\.current = \{\s*correlationId,\s*userMessage: null,\s*assistantMessage: null/,
  );
  assert.match(
    simulationScreenSource,
    /awaitSubmittedSimulationTurnReply\(\{\s*userId,\s*authToken,\s*correlationId: recoveryCorrelationId/,
  );
  assert.match(simulationScreenSource, /getMissingSubmittedTurnMessages\(\s*messagesRef\.current/);
});

test("ending and scoring waits for an explicitly submitted turn before snapshotting history", () => {
  const completionStart = simulationScreenSource.indexOf("const completeSessionAndScore = useCallback");
  const settlementAwait = simulationScreenSource.indexOf("await settleSimulationBeforeCompletion({", completionStart);
  const historySnapshot = simulationScreenSource.indexOf("const completedHistory = [...messagesRef.current];", completionStart);
  const endSession = simulationScreenSource.indexOf("await endSession(false);", completionStart);
  const scoreCompletion = simulationScreenSource.indexOf("onSessionComplete(completedHistory", completionStart);

  assert.ok(completionStart >= 0);
  assert.ok(settlementAwait > completionStart);
  assert.ok(historySnapshot > settlementAwait);
  assert.ok(endSession > historySnapshot);
  assert.ok(scoreCompletion > endSession);
});

test("End Session waits for an in-flight resume recovery before history can be scored", async () => {
  let resolveRecovery!: () => void;
  const history = completedHistory(2);
  const pending: PendingSubmittedTurnRecovery = {
    correlationId: "sim-1-turn-3",
    userMessage: { id: "user-3", role: "user", content: "Recovered third response" },
    assistantMessage: { id: "assistant-3", role: "assistant", content: "Recovered reply" },
  };
  const activeRecovery = new Promise<void>((resolve) => {
    resolveRecovery = () => {
      history.push(...mergeSubmittedTurnRecovery(history, pending).slice(history.length));
      resolve();
    };
  });
  let completionSettled = false;
  const completion = settleSimulationBeforeCompletion({
    getActiveTurnSettlement: () => null,
    getActiveRecoverySettlement: () => activeRecovery,
    hasPendingRecovery: () => true,
    recoverPending: async () => assert.fail("Must reuse the active recovery."),
  }).then(() => {
    completionSettled = true;
  });

  await Promise.resolve();
  assert.equal(completionSettled, false);
  assert.equal(countUserResponsesForVerifiedScorecard(history), 2);
  resolveRecovery();
  await completion;
  assert.equal(countUserResponsesForVerifiedScorecard(history), 3);
});

test("End Session actively settles a recoverable paused turn before scoring", async () => {
  let pending = true;
  let recoverCalls = 0;
  const history = completedHistory(2);
  const recovered: PendingSubmittedTurnRecovery = {
    correlationId: "sim-1-turn-3",
    userMessage: { id: "user-3", role: "user", content: "Recovered third response" },
    assistantMessage: { id: "assistant-3", role: "assistant", content: "Recovered reply" },
  };

  await settleSimulationBeforeCompletion({
    getActiveTurnSettlement: () => null,
    getActiveRecoverySettlement: () => null,
    hasPendingRecovery: () => pending,
    recoverPending: async () => {
      recoverCalls += 1;
      history.push(...mergeSubmittedTurnRecovery(history, recovered).slice(history.length));
      pending = false;
    },
  });

  assert.equal(recoverCalls, 1);
  assert.equal(countUserResponsesForVerifiedScorecard(history), 3);
  assert.equal(countUserResponsesForVerifiedScorecard(completedHistory(2)), 2);
});
