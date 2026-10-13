import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardUserReportResponse } from "@voicepractice/shared";

import { DashboardUsersView, filterDashboardUsers } from "./DashboardUsersView";

const users: DashboardUserReportResponse["users"] = [
  {
    userId: "ada", displayName: "Ada Lovelace", email: "ada@example.test", employeeId: null,
    orgId: "org_a", orgName: "Analytical Engines", status: "active", orgRole: "user",
    dashboardAccessEnabled: false, simulationsLast30Days: 2, usedMinutesLast30Days: 4,
    scoredAttemptsLast30Days: 2, averageScoreLast30Days: 88, scoreDeltaLast30Days: null,
    uniqueScenariosLast30Days: 1, trainingPackAttemptsLast30Days: 0, latestActivityAt: null,
    latestScenarioTitle: null, latestTrainingPackTitle: null,
  },
  {
    userId: "grace", displayName: "Grace Hopper", email: "compiler@example.test", employeeId: null,
    orgId: "org_b", orgName: "Navy Systems", status: "active", orgRole: "user",
    dashboardAccessEnabled: false, simulationsLast30Days: 1, usedMinutesLast30Days: 2,
    scoredAttemptsLast30Days: 1, averageScoreLast30Days: 84, scoreDeltaLast30Days: null,
    uniqueScenariosLast30Days: 1, trainingPackAttemptsLast30Days: 0, latestActivityAt: null,
    latestScenarioTitle: null, latestTrainingPackTitle: null,
  },
];

test("authorized dashboard users filter instantly by name and email without changing the source set", () => {
  assert.deepEqual(filterDashboardUsers(users, "LOVELACE", false).map((user) => user.userId), ["ada"]);
  assert.deepEqual(filterDashboardUsers(users, "Compiler@", false).map((user) => user.userId), ["grace"]);
  assert.equal(filterDashboardUsers(users, "navy", false).length, 0);
  assert.deepEqual(filterDashboardUsers(users, "navy", true).map((user) => user.userId), ["grace"]);
  assert.equal(filterDashboardUsers(users, "", false), users);
});

test("users view exposes a labeled search, full-result count, and no-results feedback", () => {
  const markup = renderToStaticMarkup(createElement(DashboardUsersView, {
    users,
    trainingCountByUser: { ada: 3 },
    divisionId: null,
    isSuperUser: false,
    primary: true,
  }));
  assert.equal(markup.includes("Search users"), true);
  assert.equal(markup.includes('type="search"'), true);
  assert.equal(markup.includes("Showing 2 of 2"), true);
  assert.equal(markup.includes("Ada Lovelace"), true);
  assert.equal(markup.includes("ada@example.test"), true);
  assert.equal(markup.includes("No users match your search"), false);

  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "DashboardUsersView.tsx"), "utf8");
  assert.equal(source.includes("No users match your search"), true);
  assert.equal(source.includes("filteredUsers.map"), true);
});
