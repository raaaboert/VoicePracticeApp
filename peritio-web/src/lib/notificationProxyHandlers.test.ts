import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { DashboardNotificationsResponse } from "@voicepractice/shared";

import { handleNotificationDismiss, handleNotificationList, handleNotificationMarkAllRead, handleNotificationMarkRead, type NotificationProxyDependencies } from "./notificationProxyHandlers";

process.env.PERITIO_APP_HOST = "app.peritio.ai";
process.env.PERITIO_PUBLIC_HOST = "peritio.ai";

const payload: DashboardNotificationsResponse = {
  generatedAt: "2026-10-06T12:00:00.000Z", unreadCount: 1, hasMore: false, nextOffset: null,
  notifications: [{
    id: "notification_1", orgId: "org_1", kind: "access_request", subjectType: "organization_access_request", subjectId: "request_1",
    payload: { title: "New access request", destination: "/app/admin?tab=access" }, createdAt: "2026-10-06T12:00:00.000Z",
    readAt: null, dismissedAt: null, resolvedAt: null, resolution: null,
  }],
};

function request(path: string, method = "GET") {
  return new NextRequest(`https://app.peritio.ai${path}`, { method, headers: { host: "app.peritio.ai" } });
}

function dependencies(overrides: Partial<NotificationProxyDependencies> = {}): NotificationProxyDependencies {
  return {
    async list() { return payload; },
    async markRead() { return { ok: true, notification: { ...payload.notifications[0]!, readAt: "2026-10-06T12:05:00.000Z" } }; },
    async dismiss() { return { ok: true, notification: { ...payload.notifications[0]!, readAt: "2026-10-06T12:05:00.000Z", dismissedAt: "2026-10-06T12:05:00.000Z" } }; },
    async markAllRead() { return { ok: true, markedCount: 1 }; },
    ...overrides,
  };
}

test("notification list proxy validates paging, history view, and forwards fresh inbox data", async () => {
  let received: [number, number, boolean] | null = null;
  const response = await handleNotificationList(request("/api/notifications?limit=12&view=all"), dependencies({
    async list(limit, offset, includeDismissed) { received = [limit, offset, includeDismissed]; return payload; },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(received, [12, 0, true]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), payload);
  assert.equal((await handleNotificationList(request("/api/notifications?limit=500"), dependencies({ async list() { throw new Error("must not run"); } }))).status, 400);
  assert.equal((await handleNotificationList(request("/api/notifications?view=history"), dependencies())).status, 400);
});

test("notification read and dismiss proxies pass only route-owned identifiers", async () => {
  let readId = "";
  let dismissedId = "";
  const read = await handleNotificationMarkRead(request("/api/notifications/notification_1/read", "PATCH"), "notification_1", dependencies({
    async markRead(id) { readId = id; return { ok: true, notification: { ...payload.notifications[0]!, readAt: "2026-10-06T12:05:00.000Z" } }; },
  }));
  const dismissed = await handleNotificationDismiss(request("/api/notifications/notification_1/dismiss", "PATCH"), "notification_1", dependencies({
    async dismiss(id) { dismissedId = id; return { ok: true, notification: { ...payload.notifications[0]!, readAt: "2026-10-06T12:05:00.000Z", dismissedAt: "2026-10-06T12:05:00.000Z" } }; },
  }));
  assert.equal(read.status, 200); assert.equal(dismissed.status, 200);
  assert.equal(readId, "notification_1"); assert.equal(dismissedId, "notification_1");
});

test("mark-all-read proxy is a no-store recipient-scoped mutation", async () => {
  let calls = 0;
  const response = await handleNotificationMarkAllRead(request("/api/notifications", "PATCH"), dependencies({
    async markAllRead() { calls += 1; return { ok: true, markedCount: 2 }; },
  }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls, 1); assert.deepEqual(await response.json(), { ok: true, markedCount: 2 });
});
