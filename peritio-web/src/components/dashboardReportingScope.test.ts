import assert from "node:assert/strict";
import test from "node:test";

import { DashboardCustomerSummary } from "@voicepractice/shared";

import { buildDashboardAggregateScopeContext } from "./dashboardReportingScope";

function createCustomer(overrides?: Partial<DashboardCustomerSummary>): DashboardCustomerSummary {
  return {
    orgId: "org_a",
    orgName: "Alpha Health",
    orgStatus: "active",
    contactName: "Alice Smith",
    contactEmail: "alice@alphahealth.com",
    industryLabels: ["Medical"],
    createdAt: "2026-01-01T00:00:00.000Z",
    nextRenewalAt: "2026-04-01T00:00:00.000Z",
    monthlyMinutesAllotted: 1200,
    activeUserCount: 5,
    totalUserCount: 6,
    dashboardUserCount: 2,
    simulationsLast30Days: 12,
    usedMinutesThisPeriod: 180,
    averageScoreThisPeriod: 84,
    scoreDeltaLast30Days: 6,
    trainingPackCount: 3,
    activeTrainingPackCount: 2,
    customScenarioCount: 1,
    latestActivityAt: "2026-03-29T10:00:00.000Z",
    customerUsers: [],
    ...overrides,
  };
}

test("aggregate scope context describes account count and recent concentration", () => {
  const context = buildDashboardAggregateScopeContext([
    createCustomer({
      orgId: "org_a",
      orgName: "Alpha Health",
      simulationsLast30Days: 24,
    }),
    createCustomer({
      orgId: "org_b",
      orgName: "Beta Logistics",
      orgStatus: "disabled",
      simulationsLast30Days: 8,
    }),
    createCustomer({
      orgId: "org_c",
      orgName: "Gamma Retail",
      simulationsLast30Days: 4,
    }),
  ]);

  assert.equal(context.customerCount, 3);
  assert.equal(context.activeCustomerCount, 2);
  assert.equal(context.inactiveCustomerCount, 1);
  assert.match(context.description, /3 customer accounts/);
  assert.match(context.detail, /2 active and 1 inactive/);
  assert.equal(context.activityNote, "Most recent activity is concentrated in Alpha Health.");
});

test("aggregate scope context explains quiet or single-account activity naturally", () => {
  const quietContext = buildDashboardAggregateScopeContext([
    createCustomer({
      orgId: "org_a",
      orgName: "Quiet Account",
      simulationsLast30Days: 0,
    }),
  ]);

  assert.match(quietContext.description, /single customer account/);
  assert.equal(quietContext.activityNote, "Recent activity is quiet across the customer accounts currently in scope.");

  const singleActiveContext = buildDashboardAggregateScopeContext([
    createCustomer({
      orgId: "org_a",
      orgName: "Alpha Health",
      simulationsLast30Days: 5,
    }),
    createCustomer({
      orgId: "org_b",
      orgName: "Beta Logistics",
      simulationsLast30Days: 0,
    }),
  ]);

  assert.equal(singleActiveContext.activityNote, "Recent activity is currently coming from Alpha Health.");
});
