import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ManagerInsights, buildManagerMetricMovementRows } from "./ManagerInsights";
import type {
  TeamPerformanceIntelligenceResponse,
  TeamPerformanceMetricComparison,
  TeamPerformanceMetricMovement,
  TeamPerformanceRelativeDimension,
} from "../lib/teamPerformanceIntelligence";

const componentRoot = dirname(fileURLToPath(import.meta.url));
const overviewSource = readFileSync(join(componentRoot, "OrganizationPerformanceOverview.tsx"), "utf8");
const managerSource = readFileSync(join(componentRoot, "ManagerInsights.tsx"), "utf8");
const pageSource = readFileSync(join(componentRoot, "../../app/app/performance/page.tsx"), "utf8");

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

function response(overrides: Partial<TeamPerformanceIntelligenceResponse> = {}): TeamPerformanceIntelligenceResponse {
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
    scope: "team",
    asOf: "2026-10-01T00:00:00.000Z",
    currentMonth: { year: 2026, month: 9, timeZone: "UTC" },
    comparisonMonth: { year: 2026, month: 8, timeZone: "UTC" },
    population: { currentReportCount: 3, hasCurrentReports: true },
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

function render(data: TeamPerformanceIntelligenceResponse): string {
  return renderToStaticMarkup(createElement(ManagerInsights, { state: { kind: "success", data } }));
}

test("differentiated dimensions preserve high and low ties using only /10 core metrics", () => {
  const markup = render(response());
  assert.equal(markup.includes("Highest-scoring dimensions"), true);
  assert.equal(markup.includes("Clarity</span><strong>8.4 / 10"), true);
  assert.equal(markup.includes("Empathy</span><strong>8.4 / 10"), true);
  assert.equal(markup.includes("Lowest-scoring dimensions"), true);
  assert.equal(markup.includes("Assertiveness</span><strong>7.1 / 10"), true);
  const relative = markup.slice(markup.indexOf('aria-label="Relative core dimensions"'), markup.indexOf('aria-labelledby="manager-movement-title"'));
  assert.equal(relative.includes("/ 100"), false);
});

test("balanced and incomplete dimensions show neutral states without high or low lists", () => {
  const balanced = render(response({ signals: {
    ...response().signals,
    relativeDimensions: [{
      ...differentiated(), relativePosition: "balanced", highestDimensions: [], lowestDimensions: [],
    } as TeamPerformanceRelativeDimension],
  } }));
  assert.equal(balanced.includes("Balanced across dimensions"), true);
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
  const rows = buildManagerMetricMovementRows(data);
  assert.deepEqual(rows.map((row) => [row.metric, row.direction]), [
    ["persuasion", "up"], ["clarity", "unchanged"], ["empathy", "down"],
    ["assertiveness", "up"], ["communication", "up"], ["outcome", "down"], ["overall", "unchanged"],
  ]);
  const markup = render(data);
  assert.equal(markup.includes("7.8 / 10 → 8.2 / 10"), true);
  assert.equal(markup.includes("78 / 100 → 82 / 100"), true);
  assert.equal(markup.includes("Up 0.4"), true);
  assert.equal(markup.includes("Down 0.3"), true);
  assert.equal(markup.includes("No change"), true);
  assert.equal(markup.includes("70% → 80%"), true);
  assert.equal(markup.includes("Up 10 pts"), true);
  assert.equal(markup.includes("improved"), false);
  assert.equal(markup.includes("declined"), false);
  assert.equal(markup.includes("significant"), false);
});

test("incomplete month shows one movement message and non-comparable metrics are omitted", () => {
  const incomplete = response({ signals: { ...response().signals, monthCompleteness: { complete: false, completesAt: "2026-10-01T00:00:00.000Z" } } });
  const markup = render(incomplete);
  assert.equal((markup.match(/Month-to-month movement will be available after this month closes\./g) ?? []).length, 1);
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
  assert.equal(noComparisonMarkup.includes("No comparable month-to-month performance is available yet."), true);
  assert.equal(noComparisonMarkup.includes("unknown_weight_profile"), false);
});

test("zero reports and reports without evidence remain distinct", () => {
  const zero = render(response({ population: { currentReportCount: 0, hasCurrentReports: false } }));
  assert.equal(zero.includes("No team members are currently in scope."), true);
  assert.equal(zero.includes("Balanced across dimensions"), false);
  assert.equal(zero.includes("Movement vs previous month"), false);

  const base = response();
  const noEvidence = render(response({
    facts: { ...base.facts, metricComparisons: [], completionComparisons: [] },
    signals: { ...base.signals, metricMovement: [], relativeDimensions: [], completionMovement: [] },
  }));
  assert.equal(noEvidence.includes("No team performance insights for this month yet."), true);
  assert.equal(noEvidence.includes("No team members are currently in scope."), false);
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

test("loading and error are isolated inside Manager insights", () => {
  const loading = renderToStaticMarkup(createElement(ManagerInsights, { state: { kind: "loading" } }));
  const error = renderToStaticMarkup(createElement(ManagerInsights, { state: { kind: "error" } }));
  assert.equal(loading.includes("Loading manager insights"), true);
  assert.equal(error.includes("Manager insights are temporarily unavailable."), true);
  assert.equal(error.includes("team performance summary above is still available"), true);
  assert.equal(overviewSource.includes("<ManagerInsights state={intelligenceState}"), true);
  assert.ok(overviewSource.indexOf("<ManagerInsights state={intelligenceState}") > overviewSource.indexOf("Performance dimensions"));
  assert.ok(overviewSource.indexOf("<ManagerInsights state={intelligenceState}") < overviewSource.indexOf("<PerformanceNotices"));
});

test("Team is the only scope that requests intelligence and month changes cannot apply stale results", () => {
  assert.equal(overviewSource.includes('if (scope !== "team" || !selectedMonth)'), true);
  assert.equal(overviewSource.includes("getTeamPerformanceIntelligence({"), true);
  assert.equal(overviewSource.includes("year: selectedMonth.year"), true);
  assert.equal(overviewSource.includes("month: selectedMonth.month"), true);
  assert.equal(overviewSource.includes("isTeamPerformanceIntelligenceRequestCurrent(controller.signal)"), true);
  assert.equal(overviewSource.includes("return () => controller.abort()"), true);
  assert.equal(overviewSource.includes('setIntelligenceState(scope === "team" ? { kind: "loading" } : null)'), true);
  assert.equal(pageSource.includes('<PerformanceGroupSummary scope="organization"'), true);
  assert.equal(pageSource.includes('<PerformanceGroupSummary scope="team"'), true);
});

test("presentation omits Focus, activity movement, internal keys, identities, and recommendation language", () => {
  const markup = render(response());
  for (const forbidden of [
    "Recent focus", "Focus unavailable", "Practice activity", "profileKey", "unknown_weight_profile",
    "userId", "email", "recommendation", "Best", "Worst", "Deficient",
  ]) {
    assert.equal(markup.includes(forbidden), false, forbidden);
  }
  assert.equal(managerSource.includes("signals.activityMovement"), false);
  assert.equal(managerSource.includes("signals.focus"), false);
});
