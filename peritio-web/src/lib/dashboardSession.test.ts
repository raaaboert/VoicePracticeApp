import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDashboardLoginPath,
  buildDashboardSessionResetPath,
  parseDashboardLoginReason,
} from "./dashboardSession";

test("dashboard session helpers build the expected reset and login paths", () => {
  assert.equal(buildDashboardSessionResetPath(), "/api/auth/logout?reason=session-expired");
  assert.equal(buildDashboardSessionResetPath("no-dashboard-access"), "/api/auth/logout?reason=no-dashboard-access");
  assert.equal(buildDashboardLoginPath(), "/login?reason=session-expired");
  assert.equal(buildDashboardLoginPath("no-dashboard-access"), "/login?reason=no-dashboard-access");
});

test("dashboard session helpers recognize supported login reasons only", () => {
  assert.equal(parseDashboardLoginReason("session-expired"), "session-expired");
  assert.equal(parseDashboardLoginReason("no-dashboard-access"), "no-dashboard-access");
  assert.equal(parseDashboardLoginReason("unknown"), null);
  assert.equal(parseDashboardLoginReason(undefined), null);
});
