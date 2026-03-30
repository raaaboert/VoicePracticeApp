import assert from "node:assert/strict";
import test from "node:test";

import { resolveLoginFormRequestCodeSuccess } from "./loginFormState";

test("login form advances to code entry for the generic request-code response", () => {
  const result = resolveLoginFormRequestCodeSuccess({
    ok: true,
    message: "If that account is eligible, a code has been sent. Enter the code below to continue.",
  });

  assert.deepEqual(result, {
    step: "verify_code",
    notice: "If that account is eligible, a code has been sent. Enter the code below to continue.",
  });
});
