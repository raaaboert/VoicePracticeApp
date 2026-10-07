import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { DashboardNotificationsResponse } from "@voicepractice/shared";

import { handleNotificationList, handleNotificationMarkRead } from "./notificationProxyHandlers";

process.env.PERITIO_APP_HOST = "app.peritio.ai";
process.env.PERITIO_PUBLIC_HOST = "peritio.ai";

const payload: DashboardNotificationsResponse = {
  generatedAt: "2026-10-06T12:00:00.000Z",
  unreadCount: 1,
  hasMore: false,
  nextOffset: null,
  notifications: [{
    id: "notification_1",
    orgId: "org_1",
    kind: "access_request",
    subjectType: "organization_access_request",
    subjectId: "request_1",
    payload: { title: "New access request", destination: "/app/admin?tab=access" },
    createdAt: "2026-10-06T12:00:00.000Z",
    readAt: null,
    resolvedAt: null,
    resolution: null,
  }],
};

function request(path: string, method = "GET") {
  return new NextRequest(`https://app.peritio.ai${path}`, { method, headers: { host: "app.peritio.ai" } });
}

test("notification list proxy validates paging and forwards fresh inbox data", async () => {
  let receivedLimit = 0;
  const response = await handleNotificationList(request("/api/notifications?limit=12"), {
    async list(limit, offset) { receivedLimit = limit; assert.equal(offset, 0); return payload; },
    async markRead() { throw new Error("unused"); },
  });
  assert.equal(response.status, 200);
  assert.equal(receivedLimit, 12);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), payload);

  const invalid = await handleNotificationList(request("/api/notifications?limit=500"), {
    async list() { throw new Error("must not run"); },
    async markRead() { throw new Error("unused"); },
  });
  assert.equal(invalid.status, 400);
});

test("notification read proxy passes only the route-owned identifier", async () => {
  let receivedId = "";
  const response = await handleNotificationMarkRead(request("/api/notifications/notification_1/read", "PATCH"), "notification_1", {
    async list() { return payload; },
    async markRead(id) {
      receivedId = id;
      return { ok: true, notification: { ...payload.notifications[0]!, readAt: "2026-10-06T12:05:00.000Z" } };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(receivedId, "notification_1");
});
