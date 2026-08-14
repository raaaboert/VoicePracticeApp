import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardShellSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardShell.tsx"),
  "utf8"
);
const brandMarkBytes = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../public/brand/peritio-mark.jpg")
);
const removedWarningCopy = [
  "You are limited to your own customer account",
  " and its reporting views.",
].join("");

test("Dashboard shell does not render the customer Access warning card", () => {
  assert.equal(dashboardShellSource.includes(removedWarningCopy), false);
  assert.equal(dashboardShellSource.includes('className="sidebar-note"'), false);
});

test("Dashboard shell uses server-derived capabilities for Admin navigation", () => {
  assert.equal(dashboardShellSource.includes("viewer.capabilities.viewOrganizationUsers"), true);
  assert.equal(dashboardShellSource.includes("viewer.capabilities.approveRejectAccessRequests"), true);
  assert.equal(dashboardShellSource.includes("viewer.orgRole ==="), false);
  assert.equal(dashboardShellSource.includes('{ href: "/app/admin", label: "Admin" }'), true);
});

test("Dashboard shell uses the deployed square brand mark without duplicating its wordmark", () => {
  assert.equal(dashboardShellSource.includes('src="/brand/peritio-mark.jpg"'), true);
  assert.equal(dashboardShellSource.includes('src="/peritio-logo-061526.png"'), false);
  assert.equal(dashboardShellSource.includes('<p className="eyebrow">Peritio</p>'), true);
  assert.deepEqual([...brandMarkBytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.deepEqual([...brandMarkBytes.subarray(-2)], [0xff, 0xd9]);
});
