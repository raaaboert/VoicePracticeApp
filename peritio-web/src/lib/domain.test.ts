import assert from "node:assert/strict";
import test from "node:test";

import { isAdminApiPath, isAuthApiPath, isPerformanceApiPath } from "./domain";

test("app API path helpers identify dashboard API namespaces", () => {
  assert.equal(isAuthApiPath("/api/auth/session"), true);
  assert.equal(isAdminApiPath("/api/admin/users"), true);
  assert.equal(isAdminApiPath("/api/admin/access-requests/jr_1"), true);
  assert.equal(isPerformanceApiPath("/api/performance/plans"), true);
  assert.equal(isAdminApiPath("/api/unknown"), false);
});
