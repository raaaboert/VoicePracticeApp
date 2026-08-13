import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const appSource = readFileSync(resolve(mobileRoot, "App.tsx"), "utf8");
const apiSource = readFileSync(resolve(mobileRoot, "src/lib/api.ts"), "utf8");

test("normal Simulation Setup omits organization usage and contract details", () => {
  assert.doesNotMatch(appSource, />Usage Check</);
  assert.doesNotMatch(appSource, /Resets at next renewal:/);
  assert.doesNotMatch(appSource, /Org allotment used:/);
});

test("mobile org-admin UI exposes only the delegated daily default and complete temporary overage controls", () => {
  assert.match(appSource, />Default Per-User Daily Minutes</);
  assert.match(appSource, />Use Organization Default</);
  assert.match(appSource, />Custom Daily Minutes</);
  assert.match(appSource, />Duration \(days\)</);
  assert.match(appSource, />Unlimited Within Organization</);
  assert.match(appSource, />Extra Minutes Total</);
  assert.match(appSource, /Effective expiration:/);
  assert.doesNotMatch(apiSource, /patch:\s*\{\s*maxSimulationMinutes\?: number;/);
  assert.doesNotMatch(apiSource, /patch:\s*\{[\s\S]{0,120}monthlyMinutesAllotted\?: number;/);
});
