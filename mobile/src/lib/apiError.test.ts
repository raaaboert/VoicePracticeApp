import assert from "node:assert/strict";
import test from "node:test";

import {
  createMobileApiError,
  isOrganizationAccessRequiredError,
  MobileApiError,
} from "./apiError";

test("mobile API errors preserve safe server status, code, and message", () => {
  const error = createMobileApiError(403, {
    error: "Training Content is disabled.",
    code: "module_disabled",
  });
  assert.ok(error instanceof MobileApiError);
  assert.equal(error.status, 403);
  assert.equal(error.code, "module_disabled");
  assert.equal(error.message, "Training Content is disabled.");
});

test("mobile API errors fall back safely for malformed bodies", () => {
  const error = createMobileApiError(503, {
    error: { internal: "do not display" },
    code: 503,
  });
  assert.equal(error.message, "Request failed (503)");
  assert.equal(error.code, null);
});

test("organization access denials are recognized by stable server code", () => {
  const error = createMobileApiError(403, {
    error: "Organization access is required to use Peritio AI.",
    code: "ORG_ACCESS_REQUIRED",
  });
  assert.equal(isOrganizationAccessRequiredError(error), true);
  assert.equal(isOrganizationAccessRequiredError(new Error(error.message)), false);
});
