import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { MobileNotificationRow, MobileNotificationsResponse } from "@voicepractice/shared";
import { MobileApiError } from "../lib/apiError";
import { createNotificationInboxController, notificationTimeLabel } from "./model";

const row = (id: string): MobileNotificationRow => ({ id, kind: "topic_assigned", title: "New Focus Topic",
  createdAt: "2026-10-14T12:00:00Z", readAt: null, dismissedAt: null, resolvedAt: null,
  destination: { type: "focus_topic", topicId: id } });
const page = (ids: string[], nextOffset: number | null = null): MobileNotificationsResponse => ({
  notifications: ids.map(row), unreadCount: 3, nextOffset,
});
const noMutation = { mutate: async (id: string) => ({ notification: row(id) }), markAll: async () => {} };

test("inbox refresh replaces rows and pagination deduplicates repeated items", async () => {
  const options: Array<{ offset: number; history: boolean }> = [];
  const inbox = createNotificationInboxController({ ...noMutation, list: async (input) => {
    options.push(input); return input.offset ? page(["b", "c"]) : page(["a", "b"], 2);
  } });
  await inbox.refresh(); await inbox.more();
  assert.deepEqual(inbox.snapshot().rows.map((item) => item.id), ["a", "b", "c"]);
  await inbox.refresh();
  assert.deepEqual(inbox.snapshot().rows.map((item) => item.id), ["a", "b"]);
  await inbox.history(true);
  assert.equal(options.at(-1)?.history, true);
  assert.equal(options.at(-1)?.offset, 0);
});

test("overlapping refreshes are coalesced and old account results are ignored", async () => {
  let finish!: (value: MobileNotificationsResponse) => void;
  let calls = 0;
  const inbox = createNotificationInboxController({ ...noMutation, list: () => {
    calls++; return new Promise((resolve) => { finish = resolve; });
  } });
  const pending = inbox.refresh(); await inbox.refresh();
  assert.equal(calls, 1);
  inbox.cancel();
  const newScope = createNotificationInboxController({ ...noMutation, list: async () => page([]) });
  finish(page(["private-old-user"])); await pending;
  assert.deepEqual(inbox.snapshot().rows, []);
  assert.deepEqual(newScope.snapshot().rows, []);
  assert.equal(newScope.snapshot().unreadCount, 0);
});

test("unsupported legacy servers, failure and retry have safe empty states", async () => {
  let error: Error | null = new MobileApiError("Not Found", 404, null);
  const inbox = createNotificationInboxController({ ...noMutation, list: async () => {
    if (error) throw error; return page(["a"]);
  } });
  await inbox.refresh(); assert.equal(inbox.snapshot().unsupported, true);
  assert.equal(inbox.snapshot().error, null);
  error = new Error("private provider message"); await inbox.refresh();
  assert.equal(inbox.snapshot().unsupported, false);
  assert.doesNotMatch(inbox.snapshot().error!, /private provider/);
  error = null; await inbox.refresh();
  assert.equal(inbox.snapshot().rows.length, 1);
  assert.equal(inbox.snapshot().loading, false);
});

test("opening requires server authorization; dismiss and mark-all refresh durable state", async () => {
  let calls = 0;
  let revoked = true;
  const inbox = createNotificationInboxController({ list: async () => { calls++; return page([]); },
    markAll: async () => {}, mutate: async (id) => {
      if (revoked) throw new MobileApiError("Not available", 404, null);
      return { notification: row(id) };
    } });
  assert.equal(await inbox.act("a", "open"), null);
  assert.match(inbox.snapshot().error!, /no longer available/);
  revoked = false;
  assert.deepEqual(await inbox.act("a", "open"), row("a").destination);
  await inbox.act("a", "dismiss"); await inbox.act(null, "mark-all");
  assert.equal(calls, 3);
  assert.equal(inbox.snapshot().rows.length, 0);
});

test("cancelled open cannot navigate in a new account or organization", async () => {
  let finish!: (result: { notification: MobileNotificationRow }) => void;
  const inbox = createNotificationInboxController({ ...noMutation, list: async () => page([]),
    mutate: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = inbox.act("a", "open"); inbox.cancel();
  finish({ notification: row("a") });
  assert.equal(await pending, null);
});

test("refresh is bounded to foreground/home/inbox and never modifies updates or audio", () => {
  const hook = readFileSync(new URL("./useNotifications.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(!enabled \|\| !token \|\| !userId\) return/);
  assert.match(hook, /AppState.addEventListener/);
  assert.match(hook, /listener.remove\(\); controller.cancel\(\)/);
  assert.doesNotMatch(hook, /setInterval|setTimeout|\/updates|expo-audio/);
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(app, /screen === "home" \|\| screen === "notifications"/);
  const screen = readFileSync(new URL("./NotificationInboxScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /accessibilityRole="button"/);
  assert.match(screen, /controller.act\(row.id, "open"\)/);
  assert.match(screen, /View all notifications/);
  assert.match(screen, /Notifications are not available on this server yet/);
});

test("relative timestamps handle future and malformed values", () => {
  assert.equal(notificationTimeLabel("bad"), "Date unavailable");
  assert.equal(notificationTimeLabel("2026-10-14T12:00:00Z", Date.parse("2026-10-14T12:02:00Z")), "2 min ago");
});
