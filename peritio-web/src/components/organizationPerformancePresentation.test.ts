import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { OrganizationPerformanceMetricGroup, OrganizationPerformanceResponse } from "../lib/organizationPerformance";
import { PerformanceDimensionGroups, PerformanceNotices } from "./OrganizationPerformanceOverview";
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

function renderNotes(data: OrganizationPerformanceResponse): string {
  return renderToStaticMarkup(createElement(PerformanceNotices, {
    data,
    evidenceNotices: collectOrganizationPerformanceEvidenceNotices(data),
  }));
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

test("applicable notes form one conditional summary footer with exact copy", () => {
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
  const markup = renderNotes(data);
  assert.equal((markup.match(/class="performance-summary-notes"/g) ?? []).length, 1);
  assert.equal((markup.match(/class="performance-summary-note"/g) ?? []).length, 4);
  assert.equal(markup.includes("Important notes about this summary"), true);
  assert.equal(markup.includes("Limited evidence"), true);
  assert.equal(markup.includes("Results are based on a small amount of practice and may change as more sessions are completed."), true);
  assert.equal(markup.includes("Activity concentration"), true);
  assert.equal(markup.includes("A small number of highly active participants account for a large share of this activity."), true);
  assert.equal(markup.includes("Historical data included"), true);
  assert.equal(markup.includes("Historical privacy adjustment"), true);
  assert.equal(markup.includes("This organization view can include eligible historical performance contributions."), true);
  assert.equal(markup.includes("Some historical contributions are excluded from this view to protect participant privacy."), true);
  assert.equal(markup.includes("performance-context-chip"), false);
  assert.equal(renderNotes(response({ historicalScope: "current_population" })), "");
});

test("each summary note follows its existing evidence or historical condition", () => {
  const activity = response().activity!;
  const limited = renderNotes(response({
    historicalScope: "current_population",
    activity: { ...activity, evidenceStrength: { conservativeContributorCount: 1, limitedEvidence: true } },
  }));
  assert.equal(limited.includes("Limited evidence"), true);
  assert.equal(limited.includes("Activity concentration"), false);
  assert.equal(limited.includes("Historical data included"), false);

  const concentrated = renderNotes(response({
    historicalScope: "current_population",
    activity: { ...activity, concentration: { concentrationWarning: true } },
  }));
  assert.equal(concentrated.includes("Activity concentration"), true);
  assert.equal(concentrated.includes("Limited evidence"), false);
  assert.equal(concentrated.includes("Historical data included"), false);

  const historical = renderNotes(response());
  assert.equal(historical.includes("Historical data included"), true);
  assert.equal(historical.includes("Historical privacy adjustment"), false);

  const adjusted = renderNotes(response({ historicalPrivacyAdjustmentApplied: true }));
  assert.equal(adjusted.includes("Historical privacy adjustment"), true);
  assert.equal(renderNotes(response({
    historicalScope: "current_population",
    historicalPrivacyAdjustmentApplied: true,
  })), "");
});

test("notes follow the performance content instead of the month header", () => {
  const footer = componentSource.indexOf("<PerformanceNotices data={data}");
  assert.ok(footer > componentSource.indexOf("Performance dimensions"));
  assert.ok(footer > componentSource.indexOf("{data.activity ?"));
  assert.ok(footer < componentSource.indexOf("function PerformanceLoadingState"));
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
  const notesStart = css.indexOf(".performance-summary-notes {");
  const notesCss = css.slice(notesStart, css.indexOf(".performance-loading-state {", notesStart));
  assert.equal(notesCss.includes("border-top: 1px solid var(--border)"), true);
  assert.equal(notesCss.includes("display: grid"), true);
  assert.equal(notesCss.includes("font-size: 0.95rem"), true);
  assert.equal(notesCss.includes("border-radius"), false);
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

test("dimension cards retain every metric and distinct profiles in separate core and composite grids", () => {
  const base = {
    scoringGeneration: "generation_a",
    qualifyingObservationCount: 2,
    evidenceStrength: { conservativeContributorCount: 2, limitedEvidence: false },
    concentration: { concentrationWarning: false },
    historicalPrivacyAdjustmentApplied: false,
  };
  const metrics: OrganizationPerformanceMetricGroup[] = [
    { ...base, metric: "overall", mean: 82, qualifyingObservationCount: 1,
      weightProfile: { kind: "unknown", profileKey: "unknown" } },
    { ...base, metric: "outcome", mean: 67 },
    { ...base, metric: "communication", mean: 71,
      weightProfile: { kind: "known", profileKey: "internal_known",
        weights: { persuasion: 0.25, clarity: 0.25, empathy: 0.25, assertiveness: 0.25 } } },
    { ...base, metric: "assertiveness", mean: 7 },
    { ...base, metric: "empathy", mean: 8 },
    { ...base, metric: "clarity", mean: 9 },
    { ...base, metric: "persuasion", mean: 6 },
    { ...base, metric: "overall", mean: 88,
      weightProfile: { kind: "known", profileKey: "second_profile",
        weights: { persuasion: 0.4, clarity: 0.2, empathy: 0.2, assertiveness: 0.2 } } },
  ];
  const markup = renderToStaticMarkup(createElement(PerformanceDimensionGroups, { metrics }));
  const coreStart = markup.indexOf('aria-label="Core dimensions"');
  const compositeStart = markup.indexOf('aria-label="Composite / outcome metrics"');
  assert.ok(coreStart >= 0 && compositeStart > coreStart);
  const core = markup.slice(coreStart, compositeStart);
  const composite = markup.slice(compositeStart);
  assert.equal((core.match(/class="performance-dimension-card"/g) ?? []).length, 4);
  assert.equal((composite.match(/class="performance-dimension-card"/g) ?? []).length, 4);
  assert.deepEqual([...core.matchAll(/class="metric-label">([^<]+)/g)].map((match) => match[1]),
    ["Persuasion", "Clarity", "Empathy", "Assertiveness"]);
  assert.deepEqual([...composite.matchAll(/class="metric-label">([^<]+)/g)].map((match) => match[1]),
    ["Communication", "Outcome", "Overall", "Overall"]);
  assert.equal(core.includes("6 / 10"), true);
  assert.equal(composite.includes("71 / 100"), true);
  assert.equal(composite.includes("1 qualifying observation</span>"), true);
  assert.equal(core.includes("2 qualifying observations</span>"), true);
  assert.equal(composite.includes("Weighting: Persuasion 25%"), true);
  assert.equal(composite.includes("Weighting: Persuasion 40%"), true);
  assert.equal((composite.match(/Weighting not recorded/g) ?? []).length, 1);
  assert.equal(markup.includes("internal_known"), false);
  assert.equal(markup.includes("second_profile"), false);
  assert.equal(componentSource.includes("<PerformanceDimensionGroups metrics={generation.metrics} />"), true);
});

test("dimension grid and card styles use responsive columns and a vertical information hierarchy", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"), "utf8");
  assert.equal(css.includes(".performance-dimension-grid--core {\n  grid-template-columns: repeat(4, minmax(0, 1fr));"), true);
  assert.equal(css.includes(".performance-dimension-grid--composite {\n  grid-template-columns: repeat(3, minmax(0, 1fr));"), true);
  assert.match(css, /@media \(max-width: 1360px\)\s*\{\s*\.performance-dimension-grid--core,\s*\.performance-dimension-grid--composite\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.performance-dimension-grid--core,\s*\.performance-dimension-grid--composite\s*\{\s*grid-template-columns: 1fr/);
  const cardCss = css.slice(css.indexOf(".performance-dimension-card {"), css.indexOf(".performance-summary-notes {"));
  assert.equal(cardCss.includes("display: grid"), true);
  assert.equal(cardCss.includes("display: flex"), false);
  assert.equal(cardCss.includes("white-space: nowrap"), true);
  assert.equal(cardCss.includes("overflow-wrap: anywhere"), true);
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
