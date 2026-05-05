import assert from "node:assert/strict";
import test from "node:test";

import { buildScorecardViewModel } from "./scorecardViewModel";
import type { SimulationScorecard } from "../types";

const scorecard: SimulationScorecard = {
  communicationScore: 82,
  outcomeScore: 76,
  overallScore: 80,
  completionLevel: "complete",
  objectiveAchieved: true,
  persuasion: 8,
  clarity: 9,
  empathy: 7,
  assertiveness: 8,
  strengths: ["Clear framing"],
  improvements: ["Tighter close"],
  summary: "Handled the conversation well.",
};

test("scored state displays verified score content and compatibility rubric", () => {
  const model = buildScorecardViewModel({
    scoringStatus: "scored",
    scorecard,
    error: null,
  });

  assert.equal(model.showVerifiedScore, true);
  assert.equal(model.showLegacyRubric, true);
  assert.equal(model.showScoreUnavailable, false);
  assert.equal(model.showSupportActions, true);
  assert.equal(model.showRunAnother, true);
});

test("score unavailable state renders the final review shell without score or legacy rubric cards", () => {
  const model = buildScorecardViewModel({
    scoringStatus: "score_unavailable",
    scorecard: null,
    error:
      "Your simulation completed, but the scoring service failed before a verified score could be created. No score was saved or reported.",
  });

  assert.equal(model.showLoading, false);
  assert.equal(model.showVerifiedScore, false);
  assert.equal(model.showLegacyRubric, false);
  assert.equal(model.showScoreUnavailable, true);
  assert.equal(model.showTranscriptActions, true);
  assert.equal(model.showSupportActions, true);
  assert.equal(model.showRunAnother, true);
  assert.equal(model.scoreUnavailableTitle, "We couldn't generate a score for this session.");
  assert.match(model.scoreUnavailableBody ?? "", /scoring service failed/i);
  assert.doesNotMatch(`${model.scoreUnavailableTitle} ${model.scoreUnavailableBody}`, /fallback score|practice-only|77|50/i);
});

test("not scored state uses no-scorecard-created copy without service failure wording", () => {
  const model = buildScorecardViewModel({
    scoringStatus: "not_scored",
    scorecard: null,
    error: null,
  });

  assert.equal(model.showLoading, false);
  assert.equal(model.showVerifiedScore, false);
  assert.equal(model.showLegacyRubric, false);
  assert.equal(model.showScoreUnavailable, true);
  assert.equal(model.showTranscriptActions, true);
  assert.equal(model.showSupportActions, true);
  assert.equal(model.showRunAnother, true);
  assert.equal(model.scoreUnavailableTitle, "No scorecard created");
  assert.match(model.scoreUnavailableBody ?? "", /at least 3 user responses/i);
  assert.doesNotMatch(`${model.scoreUnavailableTitle} ${model.scoreUnavailableBody}`, /scoring service failed|fallback score|practice-only|77|50/i);
  assert.equal(model.supportButtonLabel, "Share feedback about this session");
  assert.doesNotMatch(model.supportCopy, /went wrong/i);
});

test("scoring in progress does not expose score, support, or transcript actions before the final state", () => {
  const model = buildScorecardViewModel({
    scoringStatus: "scoring_in_progress",
    scorecard: null,
    error: null,
  });

  assert.equal(model.showLoading, true);
  assert.equal(model.showVerifiedScore, false);
  assert.equal(model.showScoreUnavailable, false);
  assert.equal(model.showTranscriptActions, false);
  assert.equal(model.showSupportActions, false);
  assert.equal(model.showRunAnother, true);
});

test("recovered persisted authoritative score uses the scored state", () => {
  const model = buildScorecardViewModel({
    scoringStatus: "scored",
    scorecard,
    error:
      "A temporary scoring service problem interrupted the live response, but the saved scorecard for this session was recovered successfully.",
  });

  assert.equal(model.showVerifiedScore, true);
  assert.equal(model.showScoreWarning, true);
  assert.equal(model.showScoreUnavailable, false);
});
