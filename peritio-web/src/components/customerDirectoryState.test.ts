import assert from "node:assert/strict";
import test from "node:test";

import { DashboardCustomerSummary } from "@voicepractice/shared";

import { DEFAULT_CUSTOMER_DIRECTORY_CONTROLS, getVisibleCustomers } from "./customerDirectoryState";

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
    customerUserEmails: ["owner@alphahealth.com"],
    ...overrides,
  };
}

test("customer directory search matches org name, contact email, domain, and account user email", () => {
  const customers = [
    createCustomer(),
    createCustomer({
      orgId: "org_b",
      orgName: "Bravo Industrial",
      contactName: "Ben Carter",
      contactEmail: "ops@bravo.example",
      industryLabels: ["Manufacturing"],
      latestActivityAt: "2026-03-28T10:00:00.000Z",
      customerUserEmails: ["manager@bravo.example"],
    }),
  ];

  assert.deepEqual(
    getVisibleCustomers(customers, { ...DEFAULT_CUSTOMER_DIRECTORY_CONTROLS, searchTerm: "alpha" }).map(
      (customer) => customer.orgId
    ),
    ["org_a"]
  );
  assert.deepEqual(
    getVisibleCustomers(customers, { ...DEFAULT_CUSTOMER_DIRECTORY_CONTROLS, searchTerm: "ops@bravo.example" }).map(
      (customer) => customer.orgId
    ),
    ["org_b"]
  );
  assert.deepEqual(
    getVisibleCustomers(customers, { ...DEFAULT_CUSTOMER_DIRECTORY_CONTROLS, searchTerm: "bravo.example" }).map(
      (customer) => customer.orgId
    ),
    ["org_b"]
  );
  assert.deepEqual(
    getVisibleCustomers(customers, { ...DEFAULT_CUSTOMER_DIRECTORY_CONTROLS, searchTerm: "owner@alphahealth.com" }).map(
      (customer) => customer.orgId
    ),
    ["org_a"]
  );
});

test("customer directory filters inactive accounts and sorts by latest activity, usage, or name", () => {
  const customers = [
    createCustomer(),
    createCustomer({
      orgId: "org_b",
      orgName: "Beta Logistics",
      orgStatus: "disabled",
      usedMinutesThisPeriod: 60,
      latestActivityAt: "2026-03-25T10:00:00.000Z",
    }),
    createCustomer({
      orgId: "org_c",
      orgName: "Gamma Retail",
      usedMinutesThisPeriod: 420,
      latestActivityAt: "2026-03-30T09:00:00.000Z",
    }),
  ];

  assert.deepEqual(
    getVisibleCustomers(customers, {
      ...DEFAULT_CUSTOMER_DIRECTORY_CONTROLS,
      statusFilter: "inactive",
    }).map((customer) => customer.orgId),
    ["org_b"]
  );

  assert.deepEqual(
    getVisibleCustomers(customers, DEFAULT_CUSTOMER_DIRECTORY_CONTROLS).map((customer) => customer.orgId),
    ["org_c", "org_a", "org_b"]
  );

  assert.deepEqual(
    getVisibleCustomers(customers, {
      ...DEFAULT_CUSTOMER_DIRECTORY_CONTROLS,
      sortBy: "usage",
    }).map((customer) => customer.orgId),
    ["org_c", "org_a", "org_b"]
  );

  assert.deepEqual(
    getVisibleCustomers(customers, {
      ...DEFAULT_CUSTOMER_DIRECTORY_CONTROLS,
      sortBy: "name",
    }).map((customer) => customer.orgId),
    ["org_a", "org_b", "org_c"]
  );
});
