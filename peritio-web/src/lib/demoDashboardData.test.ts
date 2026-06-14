import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer } from "@voicepractice/shared";

import {
  DASHBOARD_DEMO_ACCOUNT_ID,
  buildDashboardDemoCustomerSummary,
  buildDashboardDemoOverview,
  buildDashboardDemoTrainingWorkspace,
  buildDashboardDemoUserReport,
  canDashboardViewerAccessDemoAccount,
  isDashboardDemoAccountId,
} from "./demoDashboardData";

function createViewer(overrides?: Partial<DashboardViewer>): DashboardViewer {
  return {
    accessType: "super_user",
    userId: "super_1",
    email: "super@peritio.test",
    isSuperUser: true,
    orgId: null,
    orgName: null,
    ...overrides,
  };
}

test("demo account id is namespaced and recognized deterministically", () => {
  assert.equal(DASHBOARD_DEMO_ACCOUNT_ID, "demo_sampleco_training");
  assert.equal(isDashboardDemoAccountId("demo_sampleco_training"), true);
  assert.equal(isDashboardDemoAccountId("org_real_customer"), false);
});

test("demo account authorization follows the dashboard super-user viewer projection", () => {
  assert.equal(canDashboardViewerAccessDemoAccount(createViewer()), true);
  assert.equal(
    canDashboardViewerAccessDemoAccount(
      createViewer({
        accessType: "customer_dashboard_user",
        isSuperUser: false,
        orgId: "org_a",
        orgName: "Org A",
      })
    ),
    false
  );
});

test("demo account summary is populated without real customer records", () => {
  const summary = buildDashboardDemoCustomerSummary();

  assert.equal(summary.orgId, DASHBOARD_DEMO_ACCOUNT_ID);
  assert.equal(summary.orgName, "SampleCo Training");
  assert.equal(summary.contactEmail.endsWith(".test"), true);
  assert.equal(summary.contactEmail, "avery.morgan@sampleco.test");
  assert.equal(summary.activeUserCount, 18);
  assert.equal(summary.totalUserCount, 24);
  assert.equal(summary.usedMinutesThisPeriod, 2840);
  assert.equal(summary.averageScoreThisPeriod, 84);
  assert.equal(summary.simulationsLast30Days, 312);
});

test("demo customer-facing dashboard responses use overview, training, and users contracts", () => {
  const viewer = createViewer();
  const overview = buildDashboardDemoOverview(viewer);
  const trainingWorkspace = buildDashboardDemoTrainingWorkspace(viewer);
  const userReport = buildDashboardDemoUserReport(viewer);

  assert.equal(overview.viewer.accessType, "customer_dashboard_user");
  assert.equal(overview.viewer.orgId, DASHBOARD_DEMO_ACCOUNT_ID);
  assert.equal(overview.customers.length, 1);
  assert.equal(overview.customers[0]?.contactEmail, "avery.morgan@sampleco.test");
  assert.equal(overview.summary.simulationsLast30Days, 312);
  assert.equal(overview.summary.activeTrainingPackCount, 3);
  assert.equal(overview.summary.activeUsers, 18);
  assert.equal(overview.trainingPackAttribution.attributedScoresLast30Days + overview.trainingPackAttribution.unattributedScoresLast30Days, 246);

  assert.equal(trainingWorkspace.viewer.accessType, "customer_dashboard_user");
  assert.equal(trainingWorkspace.trainings.length, 4);
  assert.equal(trainingWorkspace.trainings.filter((training) => training.status === "active").length, 3);
  assert.ok(trainingWorkspace.trainings.some((training) => training.name === "Sales Discovery and Objection Handling"));
  assert.ok(trainingWorkspace.trainings.every((training) => training.users.length > 0));
  assert.ok(trainingWorkspace.trainings.every((training) => training.scenarios.length > 0));

  assert.equal(userReport.viewer.accessType, "customer_dashboard_user");
  assert.equal(userReport.summary.userCount, 24);
  assert.equal(userReport.summary.activeUserCount, 18);
  assert.equal(userReport.summary.simulationsLast30Days, 312);
  assert.equal(userReport.users.reduce((total, user) => total + user.scoredAttemptsLast30Days, 0), 246);
  assert.ok(userReport.users.some((user) => (user.scoreDeltaLast30Days ?? 0) > 0));
  assert.ok(userReport.users.some((user) => (user.scoreDeltaLast30Days ?? 0) < 0));
});
