import assert from "node:assert/strict";
import test from "node:test";

import type { SimulationScoreCoachingArtifact, SimulationScoreRecord } from "@voicepractice/shared";

import {
  buildDashboardCoachingInsights,
  buildNormalizedSimulationScoreThemesFromArtifact,
  canonicalizeCoachingTheme,
  getEffectiveNormalizedCoachingThemes,
} from "./coachingThemeNormalization.js";

function makeScoreRecord(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: "score_1",
    userId: "user_1",
    orgId: "org_1",
    segmentId: "segment_1",
    scenarioId: "scenario_1",
    trainingPackId: null,
    industryId: null,
    startedAt: "2026-03-07T11:55:00.000Z",
    endedAt: "2026-03-07T12:00:00.000Z",
    overallScore: 78,
    persuasion: 76,
    clarity: 79,
    empathy: 80,
    assertiveness: 77,
    createdAt: "2026-03-07T12:00:00.000Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<SimulationScoreCoachingArtifact> = {}): SimulationScoreCoachingArtifact {
  return {
    strengths: [],
    improvementAreas: [],
    coachingPriority: null,
    ...overrides,
  };
}

test("canonicalizeCoachingTheme maps known phrases to canonical themes", () => {
  assert.deepEqual(canonicalizeCoachingTheme("Use more evidence and examples to support your recommendation"), {
    id: "evidence_examples",
    label: "Evidence and examples",
  });

  assert.deepEqual(canonicalizeCoachingTheme("Slow your pacing and avoid rambling through the answer"), {
    id: "brevity_pacing",
    label: "Brevity and pacing",
  });
});

test("buildNormalizedSimulationScoreThemesFromArtifact collapses variants and dedupes duplicate mappings", () => {
  const normalized = buildNormalizedSimulationScoreThemesFromArtifact(
    makeArtifact({
      strengths: [
        "Keep the response more concise",
        "Organize the points with a clearer structure",
        "Keep the response more concise",
      ],
      improvementAreas: ["Use more evidence and examples"],
      coachingPriority: "Use more evidence and examples",
    })
  );

  assert.ok(normalized);
  assert.deepEqual(normalized.strengths, [
    {
      id: "clarity_structure",
      label: "Clarity and structure",
    },
  ]);
  assert.deepEqual(normalized.improvementAreas, [
    {
      id: "evidence_examples",
      label: "Evidence and examples",
    },
  ]);
  assert.deepEqual(normalized.coachingPriority, {
    id: "evidence_examples",
    label: "Evidence and examples",
  });
});

test("uncertain coaching phrases remain unmapped", () => {
  assert.equal(canonicalizeCoachingTheme("Maintained executive presence"), null);
  assert.equal(
    buildNormalizedSimulationScoreThemesFromArtifact(
      makeArtifact({
        strengths: ["Maintained executive presence"],
        improvementAreas: ["Executive polish was strong"],
        coachingPriority: "Commanded the room effectively",
      })
    ),
    null
  );
});

test("getEffectiveNormalizedCoachingThemes safely normalizes historical artifact-backed records", () => {
  const record = makeScoreRecord({
    coachingArtifact: makeArtifact({
      strengths: ["Validate the emotion before responding"],
      improvementAreas: ["Use more evidence and examples"],
      coachingPriority: "Clarify the structure of the answer",
    }),
    normalizedCoachingThemes: null,
  });

  assert.deepEqual(getEffectiveNormalizedCoachingThemes(record), {
    strengths: [{ id: "empathy_rapport", label: "Empathy and rapport" }],
    improvementAreas: [{ id: "evidence_examples", label: "Evidence and examples" }],
    coachingPriority: { id: "clarity_structure", label: "Clarity and structure" },
  });
});

test("buildDashboardCoachingInsights preserves coverage and unmapped diagnostics behavior", () => {
  const currentScores = [
    makeScoreRecord({
      id: "current_1",
      createdAt: "2026-03-06T10:00:00.000Z",
      coachingArtifact: makeArtifact({
        strengths: ["Validate the emotion before responding"],
        improvementAreas: [
          "Maintained executive presence",
          "Maintained executive presence",
          "Use more evidence and examples",
        ],
        coachingPriority: "Clarify the structure of the answer",
      }),
    }),
    makeScoreRecord({
      id: "current_2",
      createdAt: "2026-03-05T10:00:00.000Z",
      coachingArtifact: makeArtifact({
        strengths: ["Show more empathy"],
        improvementAreas: ["Maintained executive presence"],
        coachingPriority: "Maintained executive presence",
      }),
    }),
    makeScoreRecord({
      id: "current_3",
      createdAt: "2026-03-04T10:00:00.000Z",
      coachingArtifact: null,
      normalizedCoachingThemes: null,
    }),
  ];

  const previousScores = [
    makeScoreRecord({
      id: "previous_1",
      createdAt: "2026-02-05T10:00:00.000Z",
      coachingArtifact: makeArtifact({
        strengths: ["Validate the emotion before responding"],
        improvementAreas: ["Maintained executive presence"],
        coachingPriority: "Unclear ask",
      }),
    }),
  ];

  const insights = buildDashboardCoachingInsights({
    currentScores,
    previousScores,
    includeNormalizationDiagnostics: true,
  });

  assert.equal(insights.totalScoredAttemptsLast30Days, 3);
  assert.equal(insights.artifactBackedScoresLast30Days, 2);
  assert.equal(insights.artifactCoveragePercentLast30Days, 66.7);
  assert.equal(insights.normalizedThemeScoresLast30Days, 2);
  assert.equal(insights.normalizedThemeCoveragePercentLast30Days, 66.7);
  assert.equal(insights.repeatedFocusArea, "Clarity and structure");

  assert.deepEqual(insights.topStrengths[0], {
    themeId: "empathy_rapport",
    theme: "Empathy and rapport",
    countLast30Days: 2,
    countPrior30Days: 1,
    deltaCount: 1,
  });

  assert.ok(insights.normalizationDiagnostics);
  assert.equal(insights.normalizationDiagnostics.canonicalThemeCount > 0, true);
  assert.equal(insights.normalizationDiagnostics.improvementAreas.totalPhrasesLast30Days, 3);
  assert.equal(insights.normalizationDiagnostics.improvementAreas.mappedPhrasesLast30Days, 1);
  assert.equal(insights.normalizationDiagnostics.improvementAreas.unmappedPhrasesLast30Days, 2);
  assert.equal(insights.normalizationDiagnostics.improvementAreas.mappingCoveragePercentLast30Days, 33.3);
  assert.deepEqual(insights.normalizationDiagnostics.improvementAreas.topUnmappedPhrases[0], {
    phrase: "Maintained executive presence",
    countLast30Days: 2,
    countPrior30Days: 1,
    deltaCount: 1,
  });
});
