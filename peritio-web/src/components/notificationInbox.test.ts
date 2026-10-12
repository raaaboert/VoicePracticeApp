import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const inboxSource = readFileSync(join(directory, "NotificationInbox.tsx"), "utf8");
const historySource = readFileSync(join(directory, "NotificationHistory.tsx"), "utf8");
const shellSource = readFileSync(join(directory, "DashboardShell.tsx"), "utf8");
const adminSource = readFileSync(join(directory, "../../app/app/admin/page.tsx"), "utf8");
const styles = readFileSync(join(directory, "../../app/globals.css"), "utf8");

test("customer dashboard shell renders the notification bell without a master-dashboard duplicate", () => {
  assert.match(inboxSource, /<Bell[^>]+aria-hidden="true"/);
  assert.match(shellSource, /!hasCrossAccountAccess \? <NotificationInbox \/> : null/);
  assert.equal(shellSource.match(/<NotificationInbox/g)?.length, 1);
});

test("inbox renders unread state, timestamps, accessible dismissal, and compact actions", () => {
  assert.match(inboxSource, /notification-badge/);
  assert.match(inboxSource, /unreadCount/);
  assert.match(inboxSource, /formatNotificationTime\(notification\.createdAt\)/);
  assert.match(inboxSource, /className="notification-dismiss"/);
  assert.match(inboxSource, /aria-label=\{`Dismiss \$\{notification\.payload\.title/);
  assert.match(inboxSource, /event\.stopPropagation\(\)/);
  assert.match(inboxSource, /Mark all read/);
  assert.match(inboxSource, /View all notifications/);
  assert.match(styles, /\.notification-row\.is-unread/);
  assert.match(styles, /\.notification-dismiss:focus-visible/);
});

test("opening a notification marks it read and routes to the existing access-request administration tab", () => {
  assert.match(inboxSource, /\/api\/notifications\/\$\{encodeURIComponent\(notification\.id\)\}\/read/);
  assert.match(inboxSource, /router\.push\(notification\.payload\.destination \?\? "\/app\/admin\?tab=access"\)/);
  assert.match(adminSource, /initialTab=\{params\.tab === "access" \? "access" : "users"\}/);
});

test("inbox uses the lightweight active feed while history requests dismissed rows with paging", () => {
  assert.match(inboxSource, /\/api\/notifications\?limit=20/);
  assert.match(inboxSource, /POLL_INTERVAL_MS = 60_000/);
  assert.match(historySource, /view=all/);
  assert.match(historySource, /Load more/);
  assert.match(historySource, /notification\.dismissedAt/);
});
