import assert from "node:assert/strict";
import test from "node:test";

import {
  createMobileApiError,
  isOrganizationAccessRequiredError,
  MobileApiError,
  isTransientRequestError,
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

test("transient classification recognizes safe codes, statuses, and legacy network failures", () => {
  for (const code of ["ai_timeout", "ai_budget_limit", "ai_unavailable", "score_generation_failed"]) {
    assert.equal(isTransientRequestError(new MobileApiError("Safe explanation", 503, code)), true);
  }
  for (const status of [408, 429, 502, 503, 504]) {
    assert.equal(isTransientRequestError(createMobileApiError(status, { error: "Safe explanation" })), true);
  }
  for (const message of ["Request timed out after 15 seconds.", "Request failed (503)", "Network request failed", "Failed to fetch"]) {
    assert.equal(isTransientRequestError(new Error(message)), true);
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isTransientRequestError(new MobileApiError("Request failed (503)", status, "invalid_request")), false);
  }
  for (const error of [null, {}, new Error("Unknown"), Object.assign(new Error("Cancelled"), { name: "AbortError" })]) {
    assert.equal(isTransientRequestError(error), false);
  }
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
