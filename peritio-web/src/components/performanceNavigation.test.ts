import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PerformanceNavigation } from "./PerformanceNavigation";
import { buildPerformanceViewHref } from "./performanceViewRoutes";

const root = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the three peer views have one active tab and preserve supported context", () => {
  const routes = {
    group: "/app/performance?orgId=org_2&divisionId=division_3",
    individuals: "/app/performance/individuals?orgId=org_2&divisionId=division_3",
    goals: "/app/performance/goals?orgId=org_2&divisionId=division_3",
  } as const;
  for (const [view, href] of Object.entries(routes)) {
    const markup = renderToStaticMarkup(createElement(PerformanceNavigation, {
      activeView: view as keyof typeof routes,
      orgId: "org_2",
      divisionId: "division_3",
    }));
    for (const label of ["Group Summary", "Individuals", "Goals"]) {
      assert.equal(markup.includes(`>${label}</a>`), true);
    }
    assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
    const activeLink = markup.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0];
    assert.equal(activeLink?.includes(`href="${href.replaceAll("&", "&amp;")}"`), true);
  }
});

test("navigation omits stale empty context and encodes customer IDs", () => {
  assert.equal(buildPerformanceViewHref("group", { orgId: " " }), "/app/performance");
  assert.equal(buildPerformanceViewHref("individuals", { orgId: "old org", divisionId: null }),
    "/app/performance/individuals?orgId=old+org");
  const previous = renderToStaticMarkup(createElement(PerformanceNavigation, {
    activeView: "group", orgId: "org_previous",
  }));
  const current = renderToStaticMarkup(createElement(PerformanceNavigation, {
    activeView: "group", orgId: "org_current",
  }));
  assert.equal(previous.includes("org_previous"), true);
  assert.equal(current.includes("org_previous"), false);
  assert.equal(current.includes("org_current"), true);
});

test("individuals reuses the authorized dashboard user report and detail route", () => {
  const individuals = read("../../app/app/performance/individuals/page.tsx");
  const users = read("DashboardUsersView.tsx");
  const detail = read("../../app/app/users/[userId]/page.tsx");
  assert.equal(individuals.includes("getDashboardUserReport(divisionId)"), true);
  assert.equal(individuals.includes("getDashboardTrainingWorkspace(divisionId)"), true);
  assert.equal(individuals.includes("user.orgId === orgId"), true);
  assert.equal(individuals.includes("getOrganizationPerformance"), false);
  assert.equal(individuals.includes('viewer.accessType === "super_user" && !orgId'), true);
  assert.equal(individuals.includes("divisionId={appliedDivisionId}"), true);
  assert.equal(users.includes("buildDashboardScopedUserDetailHref(user.userId, divisionId)"), true);
  assert.equal(detail.includes("getDashboardUserDetail(userId, divisionId)"), true);
  assert.equal(detail.includes('activeView="individuals"'), true);
});

test("group and goals retain their existing routes and remove the bottom Goals action", () => {
  const group = read("../../app/app/performance/page.tsx");
  const goals = read("../../app/app/performance/goals/page.tsx");
  const overview = read("OrganizationPerformanceOverview.tsx");
  assert.equal(group.includes('<PerformanceNavigation activeView="group"'), true);
  assert.equal(group.includes('scope.kind === "team_pending"'), true);
  assert.equal(group.includes('scope.kind === "organization"'), true);
  assert.equal(goals.includes('activeView="goals"'), true);
  assert.equal(goals.includes("<PerformanceWorkspace workspace={workspace} divisionId={divisionId} />"), true);
  assert.equal(overview.includes("Open Performance Goals"), false);
});
