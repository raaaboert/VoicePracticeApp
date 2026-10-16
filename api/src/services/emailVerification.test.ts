import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmailForExactMatch, timingSafeEqualText } from "./emailVerification.js";
test("email identity trims and case-folds without merging distinct mailboxes", () => {
  assert.equal(normalizeEmailForExactMatch("  ReviewER@Example.Test  "), "reviewer@example.test");
  assert.notEqual(normalizeEmailForExactMatch("a.b@example.test"), normalizeEmailForExactMatch("ab@example.test"));
  assert.notEqual(normalizeEmailForExactMatch("a+tag@example.test"), normalizeEmailForExactMatch("a@example.test"));
});
test("constant-time comparison rejects mismatches and different lengths", () => {
  assert.equal(timingSafeEqualText("123456", "123456"), true);
  assert.equal(timingSafeEqualText("123456", "123457"), false);
  assert.equal(timingSafeEqualText("123456", "12345"), false);
});
