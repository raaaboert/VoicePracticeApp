import assert from "node:assert/strict";
import test from "node:test";
import { createMobileApiError, MobileApiError } from "./apiError";

import {
  buildInsufficientEvidenceMessage,
  buildScoreUnavailableMessage,
  classifySimulationScoreFailure,
  countUserResponsesForVerifiedScorecard,
  resolveSimulationScoreOutcome,
} from "./simulationScoreHandling";

test("countUserResponsesForVerifiedScorecard counts only real user turns", () => {
  assert.equal(
    countUserResponsesForVerifiedScorecard([
      { id: "1", role: "assistant", content: "Hello." },
      { id: "2", role: "user", content: "I can start with the context." },
      { id: "3", role: "user", content: "   " },
      { id: "4", role: "assistant", content: "What next?" },
      { id: "5", role: "user", content: "Then I will clarify the next step." },
    ]),
    2,
  );
});

test("resolveSimulationScoreOutcome keeps not-scored responses on the non-fallback path", () => {
  const outcome = resolveSimulationScoreOutcome({
    status: "not_scored",
    reason: "insufficient_evidence",
    userTurnCount: 2,
    minimumUserTurns: 3,
    message: "We need at least 3 real user responses to generate a reliable scorecard."
  });

  assert.deepEqual(outcome, {
    kind: "not_scored",
    scorecard: null,
    message:
      "This session ended before there were enough user responses to generate a verified scorecard. Complete at least 3 user responses before ending the session."
  });
});

test("resolveSimulationScoreOutcome preserves scored payloads", () => {
  const outcome = resolveSimulationScoreOutcome({
    status: "scored",
    scorecard: {
      communicationScore: 78,
      outcomeScore: 64,
      overallScore: 73,
      completionLevel: "partial",
      objectiveAchieved: false,
      persuasion: 8,
      clarity: 8,
      empathy: 7,
      assertiveness: 8,
      strengths: ["Clear opener"],
      improvements: ["Resolve the core issue"],
      summary: "Solid communication, but the outcome remained unresolved."
    },
    record: {
      id: "score_1",
      createdAt: "2026-04-09T00:00:00.000Z",
      trainingPackId: null,
      model: "gpt-test",
      promptVersion: "prompt_v1",
      rubricVersion: "rubric_v1",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      }
    }
  });

  assert.equal(outcome.kind, "scored");
  assert.equal(outcome.scorecard?.overallScore, 73);
  assert.equal(outcome.message, null);
});

test("classifySimulationScoreFailure maps transient failures without authorizing fallback scores", () => {
  assert.equal(classifySimulationScoreFailure(new Error("Request failed (502)")), "upstream_scoring_failure");
  assert.equal(
    classifySimulationScoreFailure(
      new Error("Score was generated but could not be saved. Please retry once the service is healthy.")
    ),
    "persistence_failure"
  );
  assert.equal(
    classifySimulationScoreFailure(new Error("No transcribed user text received. Transcription may have failed.")),
    "invalid_input"
  );
  assert.equal(
    classifySimulationScoreFailure(new Error("Scoring is currently disabled for this account.")),
    "auth_or_config"
  );
});

test("buildScoreUnavailableMessage never returns fallback score copy", () => {
  assert.equal(
    buildScoreUnavailableMessage("upstream_scoring_failure"),
    "Your simulation completed, but the scoring service failed before a verified score could be created. No score was saved or reported."
  );
  assert.equal(
    buildScoreUnavailableMessage("local_mode"),
    "This session used local simulation mode, so Peritio could not create a verified score. No score was saved or reported."
  );
  assert.doesNotMatch(buildScoreUnavailableMessage("network_timeout"), /fallback score|practice-only|77|50/i);
});

test("buildInsufficientEvidenceMessage describes a normal no-scorecard state", () => {
  const message = buildInsufficientEvidenceMessage(3);

  assert.match(message, /before there were enough user responses/i);
  assert.match(message, /at least 3 user responses/i);
  assert.doesNotMatch(message, /scoring service failed|fallback score|practice-only|77|50/i);
});

test("scoring prefers structured codes over provider wording and status", () => {
  for (const [code, expected] of [
    ["ai_timeout", "network_timeout"], ["ai_budget_limit", "rate_limited"],
    ["ai_unavailable", "upstream_scoring_failure"], ["score_generation_failed", "upstream_scoring_failure"],
  ] as const) {
    assert.equal(classifySimulationScoreFailure(new MobileApiError("", 500, code)), expected);
    assert.equal(classifySimulationScoreFailure(new MobileApiError("invalid scenario", 400, code)), expected);
  }
});

test("scoring uses HTTP statuses when safe messages and codes are unknown", () => {
  for (const [status, expected] of [
    [401, "auth_or_config"], [403, "auth_or_config"], [400, "invalid_input"],
    [404, "invalid_input"], [422, "invalid_input"], [408, "network_timeout"],
    [504, "network_timeout"], [429, "rate_limited"], [500, "upstream_scoring_failure"],
    [502, "upstream_scoring_failure"], [503, "upstream_scoring_failure"], [409, "unknown"],
  ] as const) {
    assert.equal(classifySimulationScoreFailure(createMobileApiError(status, { error: "Service problem", code: "future_code" })), expected);
  }
});

test("scoring retains legacy and network classifications and fails closed for malformed errors", () => {
  for (const message of ["Request timed out after 45 seconds.", "Network request failed", "Failed to fetch"]) {
    assert.equal(classifySimulationScoreFailure(new Error(message)), "network_timeout");
  }
  assert.equal(classifySimulationScoreFailure(new Error("OpenAI responses request failed")), "upstream_scoring_failure");
  assert.equal(classifySimulationScoreFailure(new Error("Evaluator returned invalid JSON")), "invalid_input");
  assert.equal(classifySimulationScoreFailure(createMobileApiError(500, { error: "Score was generated but could not be saved." })), "persistence_failure");
  for (const error of [null, {}, "ai_timeout", new Error(""), new Error("Unrecognized problem")]) {
    assert.equal(classifySimulationScoreFailure(error), "unknown");
  }
  assert.equal(classifySimulationScoreFailure(createMobileApiError(503, { error: {}, code: [] })), "upstream_scoring_failure");
});
