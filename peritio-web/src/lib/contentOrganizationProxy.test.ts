import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import {
  handleFocusTopicOrderUpdate,
  handleTrainingPackOrderUpdate,
} from "./contentOrganizationProxyHandlers";

process.env.PERITIO_APP_HOST = "app.peritio.ai";
process.env.PERITIO_PUBLIC_HOST = "peritio.ai";

function request(pathname: string, body: unknown, host = "app.peritio.ai") {
  return new NextRequest(`https://${host}${pathname}`, {
    method: "PUT",
    headers: { host, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("content organization proxies forward explicit org scope and full revision-guarded order bodies", async () => {
  const calls: unknown[] = [];
  const focusBody = { expectedOrderRevision: "focus-rev", trainingIds: ["topic-b", "topic-a"] };
  const packBody = { expectedOrderRevision: "pack-rev", trainingPackIds: ["pack-b", "pack-a"] };
  const focusResponse = await handleFocusTopicOrderUpdate(
    request("/api/admin/content-organization/focus-topics?orgId=org_1", focusBody),
    async (orgId, input) => {
      calls.push({ kind: "focus", orgId, input });
      return { generatedAt: "2026-10-03T00:00:00.000Z", orgId, trainings: [], orderRevision: "next-focus" };
    }
  );
  const packResponse = await handleTrainingPackOrderUpdate(
    request("/api/admin/content-organization/training-packs?orgId=org_1", packBody),
    async (orgId, input) => {
      calls.push({ kind: "pack", orgId, input });
      return {
        generatedAt: "2026-10-03T00:00:00.000Z",
        orgId,
        packs: [{
          id: "pack-b",
          title: "Pack B",
          active: true,
          displayOrder: 0,
          scoringWeightOverrides: { persuasion: 1 },
          failurePatterns: ["internal"],
          complianceConstraints: "internal",
          requiredBehavioralTriggers: ["internal"],
        }],
        orderRevision: "next-pack",
      };
    }
  );
  const packResponseBody = await packResponse.json();

  assert.equal(focusResponse.status, 200);
  assert.equal(packResponse.status, 200);
  assert.equal(focusResponse.headers.get("Cache-Control"), "no-store");
  assert.equal(packResponse.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(packResponseBody, {
    generatedAt: "2026-10-03T00:00:00.000Z",
    orgId: "org_1",
    packs: [{ id: "pack-b", title: "Pack B", active: true, displayOrder: 0 }],
    orderRevision: "next-pack",
  });
  assert.deepEqual(calls, [
    { kind: "focus", orgId: "org_1", input: focusBody },
    { kind: "pack", orgId: "org_1", input: packBody },
  ]);
});

test("content organization proxies reject public-host and missing-organization requests", async () => {
  let calls = 0;
  const reorder = async () => {
    calls += 1;
    return { generatedAt: "2026-10-03T00:00:00.000Z", orgId: "org_1", trainings: [], orderRevision: "next" };
  };
  const publicResponse = await handleFocusTopicOrderUpdate(
    request("/api/admin/content-organization/focus-topics?orgId=org_1", {}, "peritio.ai"),
    reorder
  );
  const missingOrgResponse = await handleFocusTopicOrderUpdate(
    request("/api/admin/content-organization/focus-topics", {}),
    reorder
  );
  assert.equal(publicResponse.status, 404);
  assert.equal(missingOrgResponse.status, 400);
  assert.equal(calls, 0);
});
