import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { OrganizationPerformanceResponse } from "../lib/organizationPerformance";
import { PerformanceNotices } from "./OrganizationPerformanceOverview";
import {
  calendarMonthFromLocalDate,
  canNavigateToNextMonth,
  collectOrganizationPerformanceEvidenceNotices,
  formatOrganizationPerformanceScore,
  formatOrganizationPerformanceWeighting,
  getHistoricalContextCopy,
  groupMetricsByScoringGeneration,
  isOrganizationPerformanceRequestCurrent,
  isOrganizationPerformanceEmpty,
  shiftCalendarMonth,
} from "./organizationPerformancePresentation";

const componentSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "OrganizationPerformanceOverview.tsx"),
  "utf8"
);
const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../app/app/performance/page.tsx"),
  "utf8"
);

function response(overrides: Partial<OrganizationPerformanceResponse> = {}): OrganizationPerformanceResponse {
  return {
    calendarMonth: { year: 2026, month: 9, timeZone: "UTC" },
    dimensionFilter: null,
    historicalScope: "organization_history",
    activity: {
      attemptCount: 8,
      conclusiveAttemptCount: 6,
      evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false },
      concentration: { concentrationWarning: false },
      historicalPrivacyAdjustmentApplied: false,
    },
    completionGroups: [],
    metricGroups: [],
    historicalPrivacyAdjustmentApplied: false,
    ...overrides,
  };
}

test("authorized organization activity is non-empty while a valid zero month is empty", () => {
  assert.equal(isOrganizationPerformanceEmpty(response()), false);
  assert.equal(isOrganizationPerformanceEmpty(response({
    activity: {
      attemptCount: 0,
      conclusiveAttemptCount: 0,
      evidenceStrength: { conservativeContributorCount: 0, limitedEvidence: false },
      concentration: { concentrationWarning: false },
      historicalPrivacyAdjustmentApplied: false,
    },
  })), true);
  assert.equal(componentSource.includes("No performance data for this month yet."), true);
});

test("evidence notices cover limited evidence and participant concentration", () => {
  const notices = collectOrganizationPerformanceEvidenceNotices(response({
    activity: {
      attemptCount: 3,
      conclusiveAttemptCount: 2,
      evidenceStrength: { conservativeContributorCount: 1, limitedEvidence: true },
      concentration: { concentrationWarning: true },
      historicalPrivacyAdjustmentApplied: false,
    },
  }));
  assert.deepEqual(notices, { limitedEvidence: true, concentrationWarning: true });
  assert.equal(componentSource.includes("Limited evidence"), true);
  assert.equal(componentSource.includes("A small number of highly active participants"), true);
});

test("historical privacy copy is exact and current-population results do not imply hidden history", () => {
  assert.deepEqual(getHistoricalContextCopy(response({
    historicalPrivacyAdjustmentApplied: true,
  })), [
    "This organization view can include eligible historical performance contributions.",
    "Some historical contributions are excluded from this view to protect participant privacy.",
  ]);
  assert.deepEqual(getHistoricalContextCopy(response({
    historicalScope: "current_population",
    dimensionFilter: { dimension: "division", id: "division_1" },
    historicalPrivacyAdjustmentApplied: true,
  })), []);
});

test("all applicable notices share one compact context area without changing privacy copy", () => {
  const data = response({
    historicalPrivacyAdjustmentApplied: true,
    activity: {
      attemptCount: 3,
      conclusiveAttemptCount: 2,
      evidenceStrength: { conservativeContributorCount: 1, limitedEvidence: true },
      concentration: { concentrationWarning: true },
      historicalPrivacyAdjustmentApplied: true,
    },
  });
  const markup = renderToStaticMarkup(createElement(PerformanceNotices, {
    data,
    evidenceNotices: collectOrganizationPerformanceEvidenceNotices(data),
  }));
  assert.equal((markup.match(/class="performance-context"/g) ?? []).length, 1);
  assert.equal((markup.match(/class="performance-context-item"/g) ?? []).length, 4);
  assert.equal(markup.includes("Limited evidence"), true);
  assert.equal(markup.includes("Activity concentrated"), true);
  assert.equal(markup.includes("Historical data included"), true);
  assert.equal(markup.includes("Historical privacy adjustment"), true);
  assert.equal(markup.includes("This organization view can include eligible historical performance contributions."), true);
  assert.equal(markup.includes("Some historical contributions are excluded from this view to protect participant privacy."), true);
  assert.equal(markup.includes('class="notice"'), false);
  const current = renderToStaticMarkup(createElement(PerformanceNotices, {
    data: response({ historicalScope: "current_population" }),
    evidenceNotices: { limitedEvidence: false, concentrationWarning: false },
  }));
  assert.equal(current, "");
});

test("the organization period and Activity KPIs use the flat report hierarchy without changing values", () => {
  assert.equal(componentSource.includes('<header className="organization-performance-toolbar"'), true);
  assert.equal(componentSource.includes('className="section-card organization-performance-toolbar"'), false);
  assert.equal(componentSource.includes('role="group" aria-label="Calendar month selector"'), true);
  assert.equal(componentSource.includes('onClick={() => moveMonth(-1)}'), true);
  assert.equal(componentSource.includes('onClick={() => moveMonth(1)}'), true);
  assert.equal(componentSource.includes("{data.activity.attemptCount}"), true);
  assert.equal(componentSource.includes("{data.activity.conclusiveAttemptCount}"), true);
  assert.equal((componentSource.match(/className="performance-activity-kpi"/g) ?? []).length, 2);
  assert.equal(componentSource.includes("Scored practice attempts"), true);
  assert.equal(componentSource.includes("Attempts with a conclusive result"), true);
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"), "utf8");
  const contextCss = css.slice(css.indexOf(".performance-context {"), css.indexOf(".performance-context-item {"));
  assert.equal(contextCss.includes("border:"), false);
  assert.equal(contextCss.includes("flex-wrap: wrap"), true);
});

test("metric generations and weight profiles remain separate records", () => {
  const base = {
    evidenceStrength: { conservativeContributorCount: 3, limitedEvidence: false },
    concentration: { concentrationWarning: false },
    historicalPrivacyAdjustmentApplied: false,
    qualifyingObservationCount: 5,
  };
  const groups = groupMetricsByScoringGeneration([
    { ...base, metric: "clarity", scoringGeneration: "generation_a", mean: 70 },
    { ...base, metric: "clarity", scoringGeneration: "generation_b", mean: 80 },
    {
      ...base,
      metric: "overall",
      scoringGeneration: "generation_b",
      mean: 75,
      weightProfile: {
        kind: "known",
        profileKey: "profile_a",
        weights: { persuasion: 0.25, clarity: 0.25, empathy: 0.25, assertiveness: 0.25 },
      },
    },
    {
      ...base,
      metric: "overall",
      scoringGeneration: "generation_b",
      mean: 82,
      weightProfile: {
        kind: "known",
        profileKey: "profile_b",
        weights: { persuasion: 0.4, clarity: 0.2, empathy: 0.2, assertiveness: 0.2 },
      },
    },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[1]?.metrics.length, 3);
  assert.deepEqual(groups[1]?.metrics.map((metric) => metric.mean), [80, 75, 82]);
});

test("weight profiles use returned percentages without rendering their internal profile key", () => {
  const known = {
    kind: "known" as const,
    profileKey: "known:250000000:250000000:250000000:250000000",
    weights: { persuasion: 0.25, clarity: 0.25, empathy: 0.25, assertiveness: 0.25 },
  };
  assert.equal(
    formatOrganizationPerformanceWeighting(known),
    "Weighting: Persuasion 25% · Clarity 25% · Empathy 25% · Assertiveness 25%"
  );
  assert.equal(formatOrganizationPerformanceWeighting({ kind: "unknown", profileKey: "unknown" }), "Weighting not recorded");
  assert.equal(formatOrganizationPerformanceWeighting(undefined), "Weighting not recorded");
  assert.equal(componentSource.includes("profileKey"), false);
});

test("scores retain their source scale in the display value", () => {
  assert.equal(formatOrganizationPerformanceScore("persuasion", 7.4), "7.4 / 10");
  assert.equal(formatOrganizationPerformanceScore("clarity", 8), "8 / 10");
  assert.equal(formatOrganizationPerformanceScore("communication", 71), "71 / 100");
  assert.equal(formatOrganizationPerformanceScore("outcome", 63.5), "63.5 / 100");
  assert.equal(formatOrganizationPerformanceScore("overall", 82), "82 / 100");
});

test("month navigation uses local month values, crosses years, and blocks future navigation", () => {
  assert.deepEqual(calendarMonthFromLocalDate(new Date(2026, 0, 15)), { year: 2026, month: 1 });
  assert.deepEqual(shiftCalendarMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftCalendarMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.equal(canNavigateToNextMonth({ year: 2026, month: 8 }, { year: 2026, month: 9 }), true);
  assert.equal(canNavigateToNextMonth({ year: 2026, month: 9 }, { year: 2026, month: 9 }), false);
});

test("access, unavailable, and loading states are distinct from the empty state", () => {
  assert.equal(componentSource.includes("You don’t have organization performance access."), true);
  assert.equal(componentSource.includes("Performance view unavailable"), true);
  assert.equal(componentSource.includes("Loading performance data…"), true);
  assert.equal(componentSource.includes('role="status"'), true);
});

test("team-only page branch does not mount the organization overview and keeps the primary navigation", () => {
  assert.equal(pageSource.includes('scope.kind === "organization"'), true);
  assert.equal(pageSource.includes('<OrganizationPerformanceOverview orgId={scope.orgId}'), true);
  assert.equal(pageSource.includes('scope.kind === "team_pending"'), true);
  assert.equal(pageSource.includes("Team performance is not available yet."), true);
  assert.equal(pageSource.includes('<PerformanceNavigation activeView="group"'), true);
  assert.equal(pageSource.includes("Open Performance Goals"), false);
  assert.equal(componentSource.includes("Open Performance Goals"), false);
});

test("limited-evidence copy applies to past and current months without calling evidence recent", () => {
  assert.equal(componentSource.includes("small amount of practice and may change"), true);
  assert.equal(componentSource.includes("small amount of recent practice"), false);
});

test("an aborted superseded request cannot apply either a success or failure state", () => {
  const controller = new AbortController();
  assert.equal(isOrganizationPerformanceRequestCurrent(controller.signal), true);
  controller.abort();
  assert.equal(isOrganizationPerformanceRequestCurrent(controller.signal), false);
  assert.equal(componentSource.includes("isOrganizationPerformanceRequestCurrent(controller.signal)"), true);
});
