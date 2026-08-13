import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const enterpriseUsersSource = readFileSync(
  resolve(sourceRoot, "app/users/enterprise/[orgId]/page.tsx"),
  "utf8",
);

test("Admin Utility exposes duration, unlimited, and total finite overage controls", () => {
  assert.match(enterpriseUsersSource, /Duration \(days\)/);
  assert.match(enterpriseUsersSource, /Unlimited within org/);
  assert.match(enterpriseUsersSource, /Extra minutes total/);
  assert.match(enterpriseUsersSource, /Total extra minutes/);
  assert.match(enterpriseUsersSource, /min remaining total/);
});
