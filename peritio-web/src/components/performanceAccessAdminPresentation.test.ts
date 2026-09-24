import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(componentsDir, "AdminWorkspace.tsx"), "utf8");

test("customer Admin performance access editor uses the server capability and blocks self editing", () => {
  assert.equal(source.includes("viewer.capabilities.managePerformanceAccess"), true);
  assert.equal(source.includes("canManagePerformanceAccess && !user.isSelf"), true);
  assert.equal(source.includes("body.performanceAccess = draft.performanceAccess"), true);
  assert.equal(source.includes("Another org admin or platform administrator must change this."), true);
});

test("customer Admin performance access editor offers only the supported values", () => {
  assert.equal(source.includes('<option value="none">None</option>'), true);
  assert.equal(source.includes('<option value="team">Team</option>'), true);
  assert.equal(source.includes('<option value="organization">Organization</option>'), true);
});

test("customer Admin manager confirmation copy follows report relationships instead of role", () => {
  assert.equal(
    source.includes("Demote ${user.email} to User? Dashboard access will be removed and sessions revoked."),
    true
  );
  assert.equal(source.includes('status === "disabled" && user.assignedReportCount > 0'), true);
  assert.equal(source.includes('status === "disabled" && user.orgRole === "user_admin"'), false);
  assert.equal(
    source.includes("Demote ${user.email} to User? Dashboard access will be removed, sessions revoked, and"),
    false
  );
});
