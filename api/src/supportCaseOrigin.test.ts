import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeSupportCaseOrigin,
  decodeSupportCaseMessage,
  encodeSupportCaseMessage,
  normalizeSupportCaseOrigin,
} from "./supportCaseOrigin.js";

test("Organization Plan origin is accepted only for users who can access that screen", () => {
  assert.equal(
    authorizeSupportCaseOrigin("organization_plan", { accountType: "enterprise", orgRole: "org_admin" }),
    "organization_plan",
  );
  assert.equal(authorizeSupportCaseOrigin("organization_plan", { isSuperUser: true }), "organization_plan");
  assert.equal(authorizeSupportCaseOrigin("organization_plan", { isPlatformAdmin: true }), "organization_plan");
  assert.equal(
    authorizeSupportCaseOrigin("organization_plan", { accountType: "enterprise", orgRole: "user_admin" }),
    null,
  );
  assert.equal(
    authorizeSupportCaseOrigin("organization_plan", { accountType: "enterprise", orgRole: "user" }),
    null,
  );
});

test("Organization Plan origin is allowlisted, persisted, and decoded separately from the user message", () => {
  const storedMessage = encodeSupportCaseMessage("  Please help with our allocation.  ", "organization_plan");
  const decoded = decodeSupportCaseMessage(storedMessage);

  assert.equal(decoded.origin, "organization_plan");
  assert.equal(decoded.message, "Please help with our allocation.");
  assert.notEqual(storedMessage, decoded.message);
});

test("existing scorecard and support messages are not labeled as Organization Plan", () => {
  const scorecardMessage = "The score does not reflect the conversation.";

  assert.deepEqual(decodeSupportCaseMessage(scorecardMessage), {
    message: scorecardMessage,
    origin: null,
  });
  assert.equal(encodeSupportCaseMessage(scorecardMessage, null), scorecardMessage);
  assert.equal(normalizeSupportCaseOrigin("scorecard"), null);
  assert.equal(normalizeSupportCaseOrigin(undefined), null);
});

test("a user-written reserved marker cannot spoof Organization Plan origin", () => {
  const attemptedSpoof = "[[PERITIO_SUPPORT_ORIGIN:organization_plan]]\nPlease help.";
  const storedMessage = encodeSupportCaseMessage(attemptedSpoof, null);

  assert.deepEqual(decodeSupportCaseMessage(storedMessage), {
    message: attemptedSpoof,
    origin: null,
  });
});
