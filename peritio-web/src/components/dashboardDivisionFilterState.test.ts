import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardDivisionScope } from "@voicepractice/shared";

import {
  buildDashboardDivisionSearch,
  canRenderDashboardWorkspaceDivisionFilter,
  canRenderSingleScopeDivisionFilter,
  formatDashboardDivisionOptionLabel,
} from "./dashboardDivisionFilterState";

const sampleScope: DashboardDivisionScope = {
  appliedDivisionId: null,
  divisions: [
    { id: "division_a", name: "Division A", active: true, deletedAt: null },
    { id: "division_b", name: "Division B", active: false, deletedAt: "2026-04-16T00:00:00.000Z" },
  ],
};

test("buildDashboardDivisionSearch defaults to Company Total by removing the division query", () => {
  assert.equal(buildDashboardDivisionSearch("tab=company&divisionId=division_a", null), "?tab=company");
});

test("buildDashboardDivisionSearch applies the selected division without dropping other params", () => {
  assert.equal(
    buildDashboardDivisionSearch("tab=users", "division_a"),
    "?tab=users&divisionId=division_a"
  );
});

test("canRenderSingleScopeDivisionFilter only returns true when options exist", () => {
  assert.equal(canRenderSingleScopeDivisionFilter(sampleScope), true);
  assert.equal(canRenderSingleScopeDivisionFilter({ appliedDivisionId: null, divisions: [] }), false);
  assert.equal(canRenderSingleScopeDivisionFilter(null), false);
});

test("canRenderDashboardWorkspaceDivisionFilter stays off for aggregate super-user views", () => {
  assert.equal(
    canRenderDashboardWorkspaceDivisionFilter({
      viewer: {
        accessType: "super_user",
        userId: "user_1",
        email: "admin@example.com",
        isSuperUser: true,
        orgId: null,
        orgName: null,
      },
      divisionScope: sampleScope,
    }),
    false
  );

  assert.equal(
    canRenderDashboardWorkspaceDivisionFilter({
      viewer: {
        accessType: "customer_dashboard_user",
        userId: "user_2",
        email: "customer@example.com",
        isSuperUser: false,
        orgId: "org_1",
        orgName: "Org 1",
      },
      divisionScope: sampleScope,
    }),
    true
  );
});

test("formatDashboardDivisionOptionLabel marks deleted divisions clearly", () => {
  assert.equal(formatDashboardDivisionOptionLabel(sampleScope.divisions[0]!), "Division A");
  assert.equal(formatDashboardDivisionOptionLabel(sampleScope.divisions[1]!), "Division B (Deleted)");
});
