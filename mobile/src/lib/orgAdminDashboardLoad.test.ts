import assert from "node:assert/strict";
import test from "node:test";

import { MobileApiError } from "./apiError";
import { loadOrgAdminDashboardData } from "./orgAdminDashboardLoad";

test("org admin dashboard and analytics load independently when both succeed", async () => {
  const result = await loadOrgAdminDashboardData(
    async () => ({ usage: "admin data" }),
    async () => ({ score: 92 }),
  );

  assert.deepEqual(result, {
    dashboard: { usage: "admin data" },
    analytics: { score: 92 },
    analyticsError: null,
  });
});

test("expected analytics denial retains the admin dashboard without surfacing an error", async () => {
  const result = await loadOrgAdminDashboardData(
    async () => ({ usage: "admin data" }),
    async () => {
      throw new MobileApiError("Performance access required.", 403, "dashboard_scope_denied");
    },
  );

  assert.deepEqual(result, {
    dashboard: { usage: "admin data" },
    analytics: null,
    analyticsError: null,
  });
});

test("unexpected analytics failure remains separate from the successful admin dashboard", async () => {
  const analyticsError = new MobileApiError("Analytics unavailable.", 503, null);
  const result = await loadOrgAdminDashboardData(
    async () => ({ usage: "admin data" }),
    async () => {
      throw analyticsError;
    },
  );

  assert.deepEqual(result.dashboard, { usage: "admin data" });
  assert.equal(result.analytics, null);
  assert.equal(result.analyticsError, analyticsError);
});

test("admin dashboard failure remains a load failure", async () => {
  const dashboardError = new MobileApiError("Dashboard unavailable.", 503, null);

  await assert.rejects(
    loadOrgAdminDashboardData(
      async () => {
        throw dashboardError;
      },
      async () => ({ score: 92 }),
    ),
    (error) => error === dashboardError,
  );
});
