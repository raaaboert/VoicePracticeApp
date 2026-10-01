import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(join(componentsDir, "AdminWorkspace.tsx"), "utf8");
const pageSource = readFileSync(join(componentsDir, "../../app/app/admin/page.tsx"), "utf8");

test("Access Requests synchronizes newly refreshed authoritative membership requests", () => {
  assert.equal(workspaceSource.includes("useEffect, useMemo, useState, useTransition"), true);
  assert.equal(workspaceSource.includes("setRequests(accessRequestsPayload.requests)"), true);
  assert.equal(workspaceSource.includes("[accessRequestsPayload.requests]"), true);
  assert.equal(workspaceSource.includes("startTransition(() => router.refresh())"), true);
  assert.equal(pageSource.includes("getDashboardAdminAccessRequests(orgId)"), true);
});

test("Access Requests preserves history while limiting actions to pending rows", () => {
  assert.equal(workspaceSource.includes("requests.map((request) =>"), true);
  assert.equal(workspaceSource.includes('request.status === "pending" ? ('), true);
  assert.equal(workspaceSource.includes("statusLabel(request.status)"), true);
  assert.equal(workspaceSource.includes("Approve Membership as Org Admin"), false);
});
