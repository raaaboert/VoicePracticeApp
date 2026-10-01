import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LeadershipInsights, buildLeadershipMetricMovementRows } from "./LeadershipInsights";
import type {
  TeamPerformanceMetricComparison,
  TeamPerformanceMetricMovement,
  TeamPerformanceRelativeDimension,
} from "../lib/teamPerformanceIntelligence";
import type { OrganizationPerformanceIntelligenceResponse } from "../lib/organizationPerformanceIntelligence";

const componentRoot = dirname(fileURLToPath(import.meta.url));
const overviewSource = readFileSync(join(componentRoot, "OrganizationPerformanceOverview.tsx"), "utf8");
const leadershipSource = readFileSync(join(componentRoot, "LeadershipInsights.tsx"), "utf8");
const pageSource = readFileSync(join(componentRoot, "../../app/app/performance/page.tsx"), "utf8");
const globalStyles = readFileSync(join(componentRoot, "../../app/globals.css"), "utf8");

const basePeriod = {
  observationCount: 4,
  evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false },
  concentrationWarning: false,
};

function metricComparison(
  metric: TeamPerformanceMetricComparison["metric"],
  previous: number,
  current: number,
  overrides: Partial<TeamPerformanceMetricComparison> = {},
): TeamPerformanceMetricComparison {
  return {
    metric,
    scoringGeneration: "generation_a",
    previous: { ...basePeriod, mean: previous },
    current: { ...basePeriod, mean: current },
    delta: current - previous,
    comparable: true,
    nonComparableReason: null,
    ...overrides,
  };
}

function metricMovement(
  metric: TeamPerformanceMetricMovement["metric"],
  direction: "up" | "down" | "unchanged",
  overrides: Partial<TeamPerformanceMetricMovement> = {},
): TeamPerformanceMetricMovement {
  return {
    metric,
    scoringGeneration: "generation_a",
    movement: { available: true, direction, reason: null },
    qualifiers: {
      current: { limitedEvidence: false, concentrationWarning: false },
      previous: { limitedEvidence: false, concentrationWarning: false },
    },
    ...overrides,
  };
}

function differentiated(overrides: Partial<TeamPerformanceRelativeDimension> = {}): TeamPerformanceRelativeDimension {
  return {
    scoringGeneration: "generation_a",
    available: true,
    relativePosition: "differentiated",
    reason: null,
    dimensions: [
      { dimension: "persuasion", mean: 7.8, qualifiers: { limitedEvidence: false, concentrationWarning: false } },
      { dimension: "clarity", mean: 8.4, qualifiers: { limitedEvidence: false, concentrationWarning: false } },
      { dimension: "empathy", mean: 8.4, qualifiers: { limitedEvidence: false, concentrationWarning: false } },
      { dimension: "assertiveness", mean: 7.1, qualifiers: { limitedEvidence: false, concentrationWarning: false } },
    ],
    qualifiers: { limitedEvidence: false, concentrationWarning: false },
    highestDimensions: ["clarity", "empathy"],
    lowestDimensions: ["assertiveness"],
    ...overrides,
  } as TeamPerformanceRelativeDimension;
}

function response(overrides: Partial<OrganizationPerformanceIntelligenceResponse> = {}): OrganizationPerformanceIntelligenceResponse {
  const comparisons = [
    metricComparison("persuasion", 7.8, 8.2),
    metricComparison("clarity", 8.4, 8.4),
    metricComparison("empathy", 8.7, 8.4),
    metricComparison("assertiveness", 7, 7.1),
    metricComparison("communication", 78, 82),
    metricComparison("outcome", 72, 70),
    metricComparison("overall", 80, 80),
  ];
  return {
    scope: "organization",
    populationBasis: "current_members",
    asOf: "2026-10-01T00:00:00.000Z",
    currentMonth: { year: 2026, month: 9, timeZone: "UTC" },
    comparisonMonth: { year: 2026, month: 8, timeZone: "UTC" },
    population: { currentMemberCount: 3, hasCurrentMembers: true },
    facts: {
      activity: {
        current: { attemptCount: 12, conclusiveAttemptCount: 9, evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false }, concentrationWarning: false },
        previous: { attemptCount: 10, conclusiveAttemptCount: 8, evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false }, concentrationWarning: false },
        attemptDelta: 2,
        conclusiveAttemptDelta: 1,
      },
      metricComparisons: comparisons,
      completionComparisons: [{
        scoringGeneration: "generation_a",
        completion: {
          current: { availableObservationCount: 10, completeCount: 8, partialCount: 1, inconclusiveCount: 1, completionRate: 0.8, evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false }, concentrationWarning: false },
          previous: { availableObservationCount: 10, completeCount: 7, partialCount: 2, inconclusiveCount: 1, completionRate: 0.7, evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false }, concentrationWarning: false },
          delta: 0.1, comparable: true, nonComparableReason: null,
        },
        objective: {
          current: { availableObservationCount: 10, achievedCount: 6, objectiveAchievementRate: 0.6, evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false }, concentrationWarning: false },
          previous: { availableObservationCount: 10, achievedCount: 6, objectiveAchievementRate: 0.6, evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false }, concentrationWarning: false },
          delta: 0, comparable: true, nonComparableReason: null,
        },
      }],
      focusReadiness: { available: false, reason: "historical_focus_topic_mapping_unavailable" },
    },
    signals: {
      monthCompleteness: { complete: true, completesAt: "2026-10-01T00:00:00.000Z" },
      activityMovement: {
        attempts: { available: true, direction: "up", reason: null },
        conclusiveAttempts: { available: true, direction: "up", reason: null },
        qualifiers: { current: { limitedEvidence: false, concentrationWarning: false }, previous: { limitedEvidence: false, concentrationWarning: false } },
      },
      metricMovement: [
        metricMovement("persuasion", "up"), metricMovement("clarity", "unchanged"),
        metricMovement("empathy", "down"), metricMovement("assertiveness", "up"),
        metricMovement("communication", "up"), metricMovement("outcome", "down"),
        metricMovement("overall", "unchanged"),
      ],
      relativeDimensions: [differentiated()],
      completionMovement: [{
        scoringGeneration: "generation_a",
        completion: { movement: { available: true, direction: "up", reason: null }, qualifiers: { current: { limitedEvidence: false, concentrationWarning: false }, previous: { limitedEvidence: false, concentrationWarning: false } } },
        objective: { movement: { available: true, direction: "unchanged", reason: null }, qualifiers: { current: { limitedEvidence: false, concentrationWarning: false }, previous: { limitedEvidence: false, concentrationWarning: false } } },
      }],
      focus: { available: false, reason: "historical_focus_topic_mapping_unavailable" },
    },
    ...overrides,
  };
}

function render(data: OrganizationPerformanceIntelligenceResponse): string {
  return renderToStaticMarkup(createElement(LeadershipInsights, { state: { kind: "success", data } }));
}

test("current-members basis and Group Summary population distinction are explicit", () => {
  const markup = render(response());
  assert.equal(markup.includes("Organization intelligence"), true);
  assert.equal(markup.includes("Leadership insights"), true);
  assert.equal(markup.includes("Based on current members"), true);
  assert.equal(markup.includes("including their qualifying earlier activity in this organization"), true);
  assert.equal(markup.includes("may differ from Group Summary"), true);
  assert.equal(markup.includes("eligible historical contributions"), true);
  assert.equal(markup.includes('class="leadership-insights-basis"'), false);
  for (const internal of [
    "protected contributors", "five-person", "dominance", "historicalPrivacyAdjustmentApplied",
  ]) {
    assert.equal(markup.includes(internal), false, internal);
  }
});

test("differentiated dimensions preserve high and low ties using only /10 core metrics", () => {
  const markup = render(response());
  assert.equal(markup.includes("Highest-scoring dimensions"), true);
  assert.equal(markup.includes("Clarity</span><strong>8.4 / 10"), true);
  assert.equal(markup.includes("Empathy</span><strong>8.4 / 10"), true);
  assert.equal(markup.includes("Lowest-scoring dimension"), true);
  assert.equal(markup.includes("Assertiveness</span><strong>7.1 / 10"), true);
  const relative = markup.slice(markup.indexOf('aria-label="Relative core dimensions"'), markup.indexOf('aria-labelledby="leadership-movement-title"'));
  assert.equal(relative.includes("/ 100"), false);

  const lowTie = differentiated({
    dimensions: differentiated().dimensions.map((entry) =>
      entry.dimension === "persuasion" ? { ...entry, mean: 7.1 } : entry),
    lowestDimensions: ["persuasion", "assertiveness"],
  });
  const lowTieMarkup = render(response({
    signals: { ...response().signals, relativeDimensions: [lowTie] },
  }));
  assert.equal(lowTieMarkup.includes("Lowest-scoring dimensions"), true);
  assert.equal(lowTieMarkup.includes("Persuasion</span><strong>7.1 / 10"), true);
  assert.equal(lowTieMarkup.includes("Assertiveness</span><strong>7.1 / 10"), true);
});

test("balanced and incomplete dimensions show neutral states without high or low lists", () => {
  const balanced = render(response({ signals: {
    ...response().signals,
    relativeDimensions: [{
      ...differentiated(),
      relativePosition: "balanced",
      dimensions: differentiated().dimensions.map((entry) => ({ ...entry, mean: 8 })),
      highestDimensions: [],
      lowestDimensions: [],
    } as TeamPerformanceRelativeDimension],
  } }));
  assert.equal(balanced.includes("Balanced across dimensions"), true);
  assert.equal(balanced.includes('class="leadership-balanced-score">8.0 / 10'), true);
  assert.equal(balanced.includes("Highest-scoring dimensions"), false);

  const incomplete = render(response({ signals: {
    ...response().signals,
    relativeDimensions: [{
      ...differentiated(), available: false, relativePosition: null, reason: "incomplete_dimension_set", highestDimensions: [], lowestDimensions: [],
    } as TeamPerformanceRelativeDimension],
  } }));
  assert.equal(incomplete.includes("Relative dimension comparison isn&#x27;t available yet."), true);
  assert.equal(incomplete.includes("More complete scored evidence"), true);
  assert.equal(incomplete.includes("incomplete_dimension_set"), false);
});

test("complete-month movement uses backend direction and factual deltas on the correct scales", () => {
  const data = response();
  const rows = buildLeadershipMetricMovementRows(data);
  assert.deepEqual(rows.map((row) => [row.metric, row.direction]), [
    ["persuasion", "up"], ["clarity", "unchanged"], ["empathy", "down"],
    ["assertiveness", "up"], ["communication", "up"], ["outcome", "down"], ["overall", "unchanged"],
  ]);
  const markup = render(data);
  assert.equal(markup.includes("Movement vs August"), true);
  assert.equal(markup.includes("Core dimensions"), true);
  assert.equal(markup.includes("Outcomes"), true);
  assert.equal(markup.includes('class="leadership-movement-previous">7.8'), true);
  assert.equal(markup.includes('class="leadership-movement-current">8.2 / 10'), true);
  assert.equal(markup.includes('class="leadership-movement-previous">78'), true);
  assert.equal(markup.includes('class="leadership-movement-current">82 / 100'), true);
  assert.equal(markup.includes("Up 0.4"), true);
  assert.equal(markup.includes("Down 0.3"), true);
  assert.equal(markup.includes("No change"), true);
  assert.equal(markup.includes('class="leadership-movement-previous">70%'), true);
  assert.equal(markup.includes('class="leadership-movement-current">80%'), true);
  assert.equal(markup.includes("Up 10 pts"), true);
  assert.equal(markup.includes("improved"), false);
  assert.equal(markup.includes("declined"), false);
  assert.equal(markup.includes("significant"), false);
});

test("incomplete month shows one compact contextual message and non-comparable metrics are omitted", () => {
  const incomplete = response({
    currentMonth: { year: 2026, month: 10, timeZone: "UTC" },
    comparisonMonth: { year: 2026, month: 9, timeZone: "UTC" },
    signals: { ...response().signals, monthCompleteness: { complete: false, completesAt: "2026-11-01T00:00:00.000Z" } },
  });
  const markup = render(incomplete);
  assert.equal(markup.includes("Movement vs September"), true);
  assert.equal((markup.match(/Available after October closes\./g) ?? []).length, 1);
  assert.equal(markup.includes("leadership-movement-stories"), false);
  assert.equal(markup.includes("Up 0.4"), false);

  const base = response();
  const nonComparable = response({ signals: {
    ...base.signals,
    metricMovement: base.signals.metricMovement.map((entry) => ({
      ...entry,
      movement: { available: false as const, direction: null, reason: "unknown_weight_profile" as const },
    })),
    completionMovement: [],
  } });
  const noComparisonMarkup = render(nonComparable);
  assert.equal(noComparisonMarkup.includes("No comparable prior-month performance data is available."), true);
  assert.equal(noComparisonMarkup.includes("unknown_weight_profile"), false);
});

test("tiny nonzero movement preserves backend direction without displaying zero", () => {
  const base = response();
  const markup = render(response({
    facts: {
      ...base.facts,
      metricComparisons: [
        metricComparison("persuasion", 8, 8.04),
        metricComparison("empathy", 8, 7.96),
      ],
    },
    signals: {
      ...base.signals,
      metricMovement: [metricMovement("persuasion", "up"), metricMovement("empathy", "down")],
      completionMovement: [],
    },
  }));
  assert.equal(markup.includes("Up &lt;0.1"), true);
  assert.equal(markup.includes("Down &lt;0.1"), true);
  assert.equal(markup.includes("Up 0"), false);
  assert.equal(markup.includes("Down 0"), false);
});

test("zero current members and current members without evidence remain distinct", () => {
  const zero = render(response({ population: { currentMemberCount: 0, hasCurrentMembers: false } }));
  assert.equal(zero.includes("No current organization members are in scope."), true);
  assert.equal(zero.includes("Balanced across dimensions"), false);
  assert.equal(zero.includes("Movement vs previous month"), false);

  const base = response();
  const noEvidence = render(response({
    facts: { ...base.facts, metricComparisons: [], completionComparisons: [] },
    signals: { ...base.signals, metricMovement: [], relativeDimensions: [], completionMovement: [] },
  }));
  assert.equal(noEvidence.includes("No leadership performance insights for this month yet."), true);
  assert.equal(noEvidence.includes("No current organization members are in scope."), false);
});

test("evidence qualifiers remain visible without suppressing insights", () => {
  const base = response();
  const data = response({ facts: {
    ...base.facts,
    activity: {
      ...base.facts.activity,
      current: {
        ...base.facts.activity.current,
        evidenceStrength: { conservativeContributorCount: 1, limitedEvidence: true },
        concentrationWarning: true,
      },
    },
  } });
  const markup = render(data);
  assert.equal(markup.includes("Limited evidence"), true);
  assert.equal(markup.includes("Activity concentration"), true);
  assert.equal(markup.includes("Highest-scoring dimensions"), true);
});

test("zero observations never produce a standalone Limited evidence label", () => {
  const base = response();
  const markup = render(response({
    facts: {
      ...base.facts,
      activity: {
        ...base.facts.activity,
        current: {
          ...base.facts.activity.current,
          attemptCount: 0,
          conclusiveAttemptCount: 0,
          evidenceStrength: { conservativeContributorCount: 0, limitedEvidence: true },
        },
      },
      metricComparisons: [],
      completionComparisons: [],
    },
    signals: {
      ...base.signals,
      metricMovement: [],
      relativeDimensions: [],
      completionMovement: [],
    },
  }));
  assert.equal(markup.includes("No leadership performance insights for this month yet."), true);
  assert.equal(markup.includes("Limited evidence"), false);
});

test("multiple generations and known profiles remain separate without internal profile keys", () => {
  const base = response();
  const weights = {
    kind: "known" as const,
    weights: { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 },
  };
  const secondComparison = metricComparison("communication", 70, 74, {
    scoringGeneration: "generation_b",
    weightProfile: weights,
  });
  const secondMovement = metricMovement("communication", "up", {
    scoringGeneration: "generation_b",
    weightProfile: weights,
  });
  const markup = render(response({
    facts: {
      ...base.facts,
      metricComparisons: [...base.facts.metricComparisons, secondComparison],
    },
    signals: {
      ...base.signals,
      metricMovement: [...base.signals.metricMovement, secondMovement],
      relativeDimensions: [
        ...base.signals.relativeDimensions,
        { ...differentiated(), scoringGeneration: "generation_b" },
      ],
    },
  }));
  assert.equal(markup.includes("Scoring generation: generation a"), true);
  assert.equal(markup.includes("Scoring generation: generation b"), true);
  assert.equal(markup.includes("Weighting: Persuasion 40%"), true);
  assert.equal(markup.includes("profileKey"), false);
});

test("loading and error are isolated inside Leadership insights", () => {
  const loading = renderToStaticMarkup(createElement(LeadershipInsights, { state: { kind: "loading" } }));
  const error = renderToStaticMarkup(createElement(LeadershipInsights, { state: { kind: "error" } }));
  assert.equal(loading.includes("Loading leadership insights"), true);
  assert.equal(error.includes("Leadership insights are temporarily unavailable."), true);
  assert.equal(error.includes("Organization Group Summary above is still available"), true);
  assert.equal(overviewSource.includes("<LeadershipInsights state={leadershipInsightsState}"), true);
  assert.ok(overviewSource.indexOf("<LeadershipInsights state={leadershipInsightsState}") > overviewSource.indexOf("Performance dimensions"));
  assert.ok(overviewSource.indexOf("<LeadershipInsights state={leadershipInsightsState}") < overviewSource.indexOf("<PerformanceNotices"));
});

test("Organization is the only scope that requests leadership intelligence and stale results are ignored", () => {
  assert.equal(overviewSource.includes('if (scope !== "organization" || !selectedMonth)'), true);
  assert.equal(overviewSource.includes("getOrganizationPerformanceIntelligence({"), true);
  assert.equal(overviewSource.includes("year: selectedMonth.year"), true);
  assert.equal(overviewSource.includes("month: selectedMonth.month"), true);
  assert.equal(overviewSource.includes("isOrganizationPerformanceIntelligenceRequestCurrent(controller.signal)"), true);
  assert.equal(overviewSource.includes("return () => controller.abort()"), true);
  assert.equal(overviewSource.includes('setLeadershipInsightsState(scope === "organization" ? { kind: "loading" } : null)'), true);
  assert.equal(pageSource.includes('<PerformanceGroupSummary scope="organization"'), true);
  assert.equal(pageSource.includes('<PerformanceGroupSummary scope="team"'), true);
  assert.equal(overviewSource.includes('scope === "organization" && leadershipInsightsState'), true);
  assert.equal(overviewSource.includes('scope === "team" && intelligenceState'), true);
});

test("presentation omits Focus, activity movement, internal keys, identities, and recommendation language", () => {
  const markup = render(response());
  for (const forbidden of [
    "Recent focus", "Focus unavailable", "Practice activity", "profileKey", "unknown_weight_profile",
    "userId", "email", "recommendation", "best", "worst", "strongest", "weakest", "good", "bad",
    "improved", "declined", "better", "worse", "significant", "meaningful improvement", "priority",
  ]) {
    assert.equal(markup.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  assert.equal(leadershipSource.includes("signals.activityMovement"), false);
  assert.equal(leadershipSource.includes("signals.focus"), false);
});

test("Performance summary avoids backdrop-filter layer promotion without repaint hacks", () => {
  assert.match(globalStyles, /\.organization-performance-overview \.section-card,\s*\.organization-performance-overview \.metric-card\s*{\s*backdrop-filter: none;/);
  assert.equal(leadershipSource.includes("requestAnimationFrame"), false);
  assert.equal(leadershipSource.includes("setTimeout"), false);
  assert.equal(globalStyles.includes("translateZ("), false);
  assert.equal(globalStyles.includes("will-change:"), false);
});

test("Leadership movement uses bounded responsive grids without horizontal scrolling", () => {
  assert.match(globalStyles, /\.leadership-movement-stories\s*{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*width: min\(100%, 68rem\);/s);
  assert.match(globalStyles, /\.manager-movement-row,\s*\.leadership-movement-stories\s*{\s*grid-template-columns: 1fr;/);
  const movementStyles = globalStyles.slice(
    globalStyles.indexOf(".leadership-movement-stories"),
    globalStyles.indexOf(".manager-insights-content"),
  );
  assert.equal(movementStyles.includes("overflow-x"), false);
  assert.doesNotMatch(movementStyles, /(^|\n)\s*position:/);
  assert.doesNotMatch(movementStyles, /(^|\n)\s*transform:/);
});
