import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const accountsSource = readFileSync(join(adminRoot, "app", "users", "page.tsx"), "utf8");
const detailSource = readFileSync(join(adminRoot, "app", "users", "enterprise", "[orgId]", "page.tsx"), "utf8");

test("Admin Utility organization creation and listing omit organization email domains", () => {
  assert.equal(accountsSource.includes("Org Email Domain"), false);
  assert.equal(accountsSource.includes("orgForm.emailDomain"), false);
  assert.equal(accountsSource.includes("<th>Domain</th>"), false);
});

test("Admin Utility organization detail preserves join-code editing without a domain control", () => {
  assert.equal(detailSource.includes("orgDomainInput"), false);
  assert.equal(detailSource.includes("<label>Email Domain</label>"), false);
  assert.equal(detailSource.includes("joinCode: orgJoinCodeInput"), true);
  assert.equal(detailSource.includes("Save Join Code"), true);
});
