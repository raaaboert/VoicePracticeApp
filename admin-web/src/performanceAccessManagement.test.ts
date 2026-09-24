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

test("Admin Utility exposes explicit performance access management on the existing user editor", () => {
  assert.equal(enterpriseUsersSource.includes("Performance Access"), true);
  assert.equal(enterpriseUsersSource.includes("performanceAccess: event.target.value as PerformanceAccessLevel"), true);
  assert.equal(enterpriseUsersSource.includes('<option value="none">None</option>'), true);
  assert.equal(enterpriseUsersSource.includes('<option value="team">Team</option>'), true);
  assert.equal(enterpriseUsersSource.includes('<option value="organization">Organization</option>'), true);
});
