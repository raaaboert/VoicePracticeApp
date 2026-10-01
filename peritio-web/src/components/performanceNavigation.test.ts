import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardUserReportRow } from "@voicepractice/shared";

import { PerformanceNavigation } from "./PerformanceNavigation";
import { DashboardUsersView } from "./DashboardUsersView";
import { isDashboardSidebarItemActive } from "./dashboardSidebarState";
import { buildPerformanceIndividualDetailHref, buildPerformanceViewHref } from "./performanceViewRoutes";

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

test("only Performance-origin person detail keeps the Performance sidebar active", () => {
  assert.equal(isDashboardSidebarItemActive("/app/performance/individuals", "/app/performance", null), true);
  assert.equal(isDashboardSidebarItemActive("/app/users/user_1", "/app/performance", "individuals"), true);
  assert.equal(isDashboardSidebarItemActive("/app/users/user_1", "/app/performance", null), false);
  assert.equal(isDashboardSidebarItemActive("/app/users/user_1", "/app/performance", "other"), false);
  assert.equal(isDashboardSidebarItemActive("/app/dashboard", "/app/dashboard", null), true);
  assert.equal(isDashboardSidebarItemActive("/app/users/user_1", "/app/dashboard", "individuals"), false);
});

test("Performance person links carry origin and detail offers a scoped back link", () => {
  assert.equal(buildPerformanceIndividualDetailHref("user/1", null),
    "/app/users/user%2F1?performanceOrigin=individuals");
  assert.equal(buildPerformanceIndividualDetailHref("user_1", "division_2"),
    "/app/users/user_1?divisionId=division_2&performanceOrigin=individuals");
  assert.equal(buildPerformanceViewHref("individuals", { orgId: "org_1", divisionId: "division_2" }),
    "/app/performance/individuals?orgId=org_1&divisionId=division_2");
  const detail = read("../../app/app/users/[userId]/page.tsx");
  assert.equal(detail.includes('query.performanceOrigin === "individuals"'), true);
  assert.equal(detail.includes("Back to Individuals"), true);
  assert.equal(detail.includes("<ArrowLeft size={17}"), true);
  assert.equal(detail.includes('buildPerformanceViewHref("individuals", { orgId: user.orgId, divisionId: appliedDivisionId })'), true);
  assert.equal(detail.includes("{fromPerformance ? (\n        <PerformanceNavigation"), true);
  const headerAt = detail.indexOf("<PageHeader");
  const tabsAt = detail.indexOf('<PerformanceNavigation activeView="individuals"');
  const backAt = detail.indexOf('className="performance-detail-back-row"');
  const contentAt = detail.indexOf("<DashboardDivisionFilter", backAt);
  assert.equal(headerAt < tabsAt && tabsAt < backAt && backAt < contentAt, true);
  assert.equal(detail.includes('className="training-content-back-link"'), true);
});

test("the Individuals list is a primary section while dashboard reporting keeps its evidence view", () => {
  const user: DashboardUserReportRow = {
    userId: "user_1", email: "person@example.test", employeeId: null,
    orgId: "org_1", orgName: "Example", status: "active", orgRole: "user",
    dashboardAccessEnabled: false, simulationsLast30Days: 1, usedMinutesLast30Days: 2,
    scoredAttemptsLast30Days: 1, averageScoreLast30Days: 80, scoreDeltaLast30Days: null,
    uniqueScenariosLast30Days: 1, trainingPackAttemptsLast30Days: 0,
    latestActivityAt: null, latestScenarioTitle: null, latestTrainingPackTitle: null,
  };
  const props = { users: [user], trainingCountByUser: new Map<string, number>(), divisionId: "division_2", isSuperUser: false };
  const individuals = renderToStaticMarkup(createElement(DashboardUsersView, { ...props, primary: true }));
  const dashboard = renderToStaticMarkup(createElement(DashboardUsersView, props));
  assert.equal(individuals.includes("People in scope"), true);
  assert.equal(individuals.includes("Select a person to review their practice activity and performance."), true);
  for (const old of ["Supporting evidence", "User detail", "User table"]) {
    assert.equal(individuals.includes(old), false, old);
  }
  assert.equal(dashboard.includes("Supporting evidence"), true);
  assert.equal(dashboard.includes("User detail"), true);
  assert.equal(individuals.includes("/app/users/user_1?divisionId=division_2&amp;performanceOrigin=individuals"), true);
  assert.equal(dashboard.includes("performanceOrigin=individuals"), false);
  assert.equal(read("../../app/app/performance/individuals/page.tsx").includes("primary"), true);
});
