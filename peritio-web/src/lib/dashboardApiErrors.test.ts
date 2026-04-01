import assert from "node:assert/strict";
import test from "node:test";

import { isDashboardScopeDeniedStatus, isDashboardSessionInvalidStatus } from "./dashboardApiErrors";

test("dashboard API status helpers recognize invalid sessions", () => {
  assert.equal(isDashboardSessionInvalidStatus(401, null), true);
  assert.equal(isDashboardSessionInvalidStatus(403, "dashboard_session_invalid"), true);
  assert.equal(isDashboardSessionInvalidStatus(403, "dashboard_scope_denied"), false);
  assert.equal(isDashboardSessionInvalidStatus(404, "dashboard_session_invalid"), true);
});

test("dashboard API status helpers recognize scope denials only for explicit dashboard scope errors", () => {
  assert.equal(isDashboardScopeDeniedStatus(403, "dashboard_scope_denied"), true);
  assert.equal(isDashboardScopeDeniedStatus(403, "dashboard_session_invalid"), false);
  assert.equal(isDashboardScopeDeniedStatus(401, "dashboard_scope_denied"), false);
  assert.equal(isDashboardScopeDeniedStatus(404, "dashboard_scope_denied"), false);
});
