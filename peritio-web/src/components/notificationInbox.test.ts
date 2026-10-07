import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const inboxSource = readFileSync(join(directory, "NotificationInbox.tsx"), "utf8");
const shellSource = readFileSync(join(directory, "DashboardShell.tsx"), "utf8");
const adminSource = readFileSync(join(directory, "../../app/app/admin/page.tsx"), "utf8");
const styles = readFileSync(join(directory, "../../app/globals.css"), "utf8");

test("customer dashboard shell renders the notification bell without a master-dashboard duplicate", () => {
  assert.match(inboxSource, /<Bell[^>]+aria-hidden="true"/);
  assert.match(shellSource, /!hasCrossAccountAccess \? <NotificationInbox \/> : null/);
  assert.equal(shellSource.match(/<NotificationInbox/g)?.length, 1);
});

test("inbox renders unread count, access-request copy, timestamps, and resolved distinction", () => {
  assert.match(inboxSource, /notification-badge/);
  assert.match(inboxSource, /unreadCount/);
  assert.match(inboxSource, /notification\.payload\.title/);
  assert.match(inboxSource, /formatNotificationTime\(notification\.createdAt\)/);
  assert.match(inboxSource, /notification\.resolvedAt \? " · Resolved"/);
  assert.match(styles, /\.notification-row\.is-unread/);
  assert.match(styles, /\.notification-row\.is-resolved/);
});

test("opening a notification marks it read and routes to the existing access-request administration tab", () => {
  assert.match(inboxSource, /\/api\/notifications\/\$\{encodeURIComponent\(notification\.id\)\}\/read/);
  assert.match(inboxSource, /router\.push\(notification\.payload\.destination \?\? "\/app\/admin\?tab=access"\)/);
  assert.match(adminSource, /initialTab=\{params\.tab === "access" \? "access" : "users"\}/);
});

test("resolved notifications cannot remain in the actionable unread badge", () => {
  assert.match(inboxSource, /notification\.resolvedAt \? current\.unreadCount : Math\.max\(0, current\.unreadCount - 1\)/);
  assert.match(inboxSource, /POLL_INTERVAL_MS = 60_000/);
});
