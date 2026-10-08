import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { DashboardAdminAccessRequestRow } from "@voicepractice/shared";

import { partitionAdminAccessRequests } from "./adminAccessRequestPresentation";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(join(componentsDir, "AdminWorkspace.tsx"), "utf8");
const pageSource = readFileSync(join(componentsDir, "../../app/app/admin/page.tsx"), "utf8");

function request(id: string, status: DashboardAdminAccessRequestRow["status"]): DashboardAdminAccessRequestRow {
  return {
    id,
    status,
    userId: `user_${id}`,
    displayName: `Person ${id}`,
    email: `${id}@example.test`,
    orgId: "org_1",
    orgName: "Example Org",
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    decidedAt: status === "pending" ? null : "2026-10-02T00:00:00.000Z",
    decisionReason: null,
  };
}

test("Access Requests synchronizes newly refreshed authoritative membership requests", () => {
  assert.equal(workspaceSource.includes("useEffect, useMemo, useState, useTransition"), true);
  assert.equal(workspaceSource.includes("setRequests(accessRequestsPayload.requests)"), true);
  assert.equal(workspaceSource.includes("[accessRequestsPayload.requests]"), true);
  assert.equal(workspaceSource.includes("startTransition(() => router.refresh())"), true);
  assert.equal(pageSource.includes("getDashboardAdminAccessRequests(orgId)"), true);
});

test("Access Requests separates pending work from every permanently closed status", () => {
  const partitioned = partitionAdminAccessRequests([
    request("pending", "pending"),
    request("approved", "approved"),
    request("rejected", "rejected"),
    request("expired", "expired"),
  ]);
  assert.deepEqual(partitioned.pendingRequests.map((row) => row.id), ["pending"]);
  assert.deepEqual(partitioned.requestHistory.map((row) => row.id), ["approved", "rejected", "expired"]);
  assert.deepEqual(partitionAdminAccessRequests([]), { pendingRequests: [], requestHistory: [] });
  assert.equal(workspaceSource.includes("pendingRequests.map((request) =>"), true);
  assert.equal(workspaceSource.includes("requestHistory.map((request) =>"), true);
  assert.equal(workspaceSource.includes("Pending Requests"), true);
  assert.equal(workspaceSource.includes("Request History ({requestHistory.length})"), true);
  assert.equal(workspaceSource.includes("No pending requests."), true);
  assert.equal(workspaceSource.includes("No previous requests."), true);
  assert.equal(workspaceSource.includes("statusLabel(request.status)"), true);
});

test("request history is collapsed and has no decision-action column", () => {
  const historyStart = workspaceSource.indexOf('className="section-card admin-section admin-request-history"');
  const history = workspaceSource.slice(historyStart, workspaceSource.indexOf("</details>", historyStart));
  assert.ok(historyStart >= 0);
  assert.equal(history.includes("<th>Actions</th>"), false);
  assert.equal(history.includes("decideRequest("), false);
  assert.equal(history.includes(">Approve<"), false);
  assert.equal(history.includes(">Deny<"), false);
  assert.equal(workspaceSource.includes("canManageAccessRequests ? ("), true);
  assert.equal(workspaceSource.includes("Approve Membership as Org Admin"), false);
});
