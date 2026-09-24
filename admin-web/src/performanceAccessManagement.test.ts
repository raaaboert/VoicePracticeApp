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
const landingPageSource = readFileSync(resolve(sourceRoot, "app/page.tsx"), "utf8");
const globalStylesSource = readFileSync(resolve(sourceRoot, "app/globals.css"), "utf8");

test("Admin Utility exposes explicit performance access management on the existing user editor", () => {
  assert.equal(enterpriseUsersSource.includes("Performance Access"), true);
  assert.equal(enterpriseUsersSource.includes("performanceAccess: event.target.value as PerformanceAccessLevel"), true);
  assert.equal(enterpriseUsersSource.includes('<option value="none">None</option>'), true);
  assert.equal(enterpriseUsersSource.includes('<option value="team">Team</option>'), true);
  assert.equal(enterpriseUsersSource.includes('<option value="organization">Organization</option>'), true);
});

test("Admin Utility preserves its user controls in a readable wide-table layout", () => {
  assert.equal(enterpriseUsersSource.includes("enterprise-user-table"), true);
  assert.equal(enterpriseUsersSource.includes("enterprise-user-performance-column"), true);
  assert.equal(globalStylesSource.includes(".enterprise-user-table"), true);
  assert.equal(globalStylesSource.includes("min-width: 1700px"), true);
});

test("Web Admin landing page keeps the login action inside the composed landing panel", () => {
  assert.equal(landingPageSource.includes("login-landing"), true);
  assert.equal(landingPageSource.includes('href="/login"'), true);
  assert.equal(globalStylesSource.includes(".login-landing-card"), true);
});
