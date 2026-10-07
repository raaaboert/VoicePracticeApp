import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMemoryUserNotificationStoreForTest } from "./userNotificationStore.js";

function input(recipientUserId: string, dedupKey: string, createdAt = "2026-10-06T12:00:00.000Z") {
  return {
    id: `notification_${recipientUserId}_${dedupKey}`,
    orgId: "org_1",
    recipientUserId,
    kind: "access_request" as const,
    subjectType: "organization_access_request",
    subjectId: `request_${dedupKey}`,
    dedupKey,
    payload: { title: "New access request", destination: "/app/admin?tab=access" },
    createdAt: new Date(createdAt),
  };
}

test("notification migration defines durable recipient rows and recipient-scoped deduplication", async () => {
  const sql = await readFile(new URL("../../sql/016_user_notifications.sql", import.meta.url), "utf8");
  for (const column of ["org_id", "recipient_user_id", "kind", "subject_type", "subject_id", "dedup_key", "payload", "created_at", "read_at", "resolved_at", "resolution"]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(sql, /UNIQUE\s*\(recipient_user_id, dedup_key\)/i);
  assert.match(sql, /payload JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
});

test("recipient dedup is idempotent while the same semantic key is allowed for another recipient", async () => {
  const store = createMemoryUserNotificationStoreForTest();
  assert.equal((await store.enqueueMany([input("admin_a", "access-request:1"), input("admin_a", "access-request:1")])).length, 1);
  assert.ok(await store.enqueueOne(input("admin_b", "access-request:1")));
  assert.equal((await store.listForRecipient({ recipientUserId: "admin_a", limit: 10 })).length, 1);
  assert.equal((await store.listForRecipient({ recipientUserId: "admin_b", limit: 10 })).length, 1);
});

test("recipient list is isolated, newest-first, and bounded", async () => {
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueMany([
    input("admin_a", "one", "2026-10-01T00:00:00.000Z"),
    input("admin_a", "two", "2026-10-02T00:00:00.000Z"),
    input("admin_b", "three", "2026-10-03T00:00:00.000Z"),
  ]);
  const rows = await store.listForRecipient({ recipientUserId: "admin_a", limit: 1 });
  assert.deepEqual(rows.map((row) => row.dedupKey), ["two"]);
  const next = await store.listForRecipient({ recipientUserId: "admin_a", limit: 1, offset: 1 });
  assert.deepEqual(next.map((row) => row.dedupKey), ["one"]);
  assert.equal(await store.getForRecipient({ id: "notification_admin_b_three", recipientUserId: "admin_a" }), null);
});

test("read and resolved state remain distinct and resolved rows stop actionable unread count", async () => {
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueMany([input("admin_a", "one"), input("admin_a", "two")]);
  assert.equal(await store.countActionableUnread({ recipientUserId: "admin_a", orgId: "org_1", kinds: ["access_request"] }), 2);
  const read = await store.markRead({ id: "notification_admin_a_one", recipientUserId: "admin_a", readAt: new Date("2026-10-07T00:00:00Z") });
  assert.ok(read?.readAt);
  assert.equal(read?.resolvedAt, null);
  assert.equal(await store.countActionableUnread({ recipientUserId: "admin_a", orgId: "org_1", kinds: ["access_request"] }), 1);
  const resolved = await store.resolveOne({ id: "notification_admin_a_two", recipientUserId: "admin_a", resolution: "approved" });
  assert.equal(resolved?.resolution, "approved");
  assert.equal(resolved?.readAt, null);
  assert.equal(await store.countActionableUnread({ recipientUserId: "admin_a", orgId: "org_1", kinds: ["access_request"] }), 0);
  assert.equal((await store.listForRecipient({ recipientUserId: "admin_a", limit: 10 })).length, 2);
});

test("unknown recipients and cross-recipient mutations are non-disclosing", async () => {
  const store = createMemoryUserNotificationStoreForTest();
  await store.enqueueOne(input("admin_a", "one"));
  assert.equal(await store.getForRecipient({ id: "notification_admin_a_one", recipientUserId: "unknown" }), null);
  assert.equal(await store.markRead({ id: "notification_admin_a_one", recipientUserId: "admin_b" }), null);
  assert.equal(await store.resolveOne({ id: "notification_admin_a_one", recipientUserId: "admin_b", resolution: "dismissed" }), null);
});

test("notification payloads accept only small internal navigation snapshots", async () => {
  const store = createMemoryUserNotificationStoreForTest();
  await assert.rejects(
    store.enqueueOne({ ...input("admin_a", "external"), payload: { destination: "https://example.com/private" } }),
    /internal dashboard path/,
  );
  await assert.rejects(
    store.enqueueOne({ ...input("admin_a", "unknown"), kind: "unknown_kind" as "access_request" }),
    /kind is not recognized/,
  );
});
