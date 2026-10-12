import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { createUserNotificationStore } from "./userNotificationStore.js";

const databaseUrl = process.env.USER_NOTIFICATION_INTEGRATION_DATABASE_URL?.trim() ?? "";

function assertThrowawayDatabase(url: string): void {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").toLowerCase();
  assert.match(name, /(test|integration|throwaway)/);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase()));
  assert.doesNotMatch(url.toLowerCase(), /peritio[-_]db[-_]prod/);
}

function scopedUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

test("real PostgreSQL migration 023 initializes repeatedly and preserves dismissed notification history", { skip: !databaseUrl }, async () => {
  assertThrowawayDatabase(databaseUrl);
  const setup = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `notification_inbox_${randomBytes(8).toString("hex")}`;
  const quotedSchema = `"${schema}"`;
  let pool: Pool | null = null;
  try {
    await setup.query(`CREATE SCHEMA ${quotedSchema}`);
    const url = scopedUrl(databaseUrl, schema);
    pool = new Pool({ connectionString: url, max: 2 });
    const create = () => createUserNotificationStore({
      provider: "postgres", databaseUrl: url, pgPoolMax: 2,
      pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool!,
    });
    const first = create();
    await first.initialize();
    await first.enqueueOne({ orgId: "org", recipientUserId: "recipient", kind: "access_request",
      subjectType: "request", subjectId: "request_1", dedupKey: "request:1", payload: { title: "Request" } });
    const dismissed = await first.dismiss({ id: (await first.listForRecipient({ recipientUserId: "recipient", limit: 1 }))[0]!.id, recipientUserId: "recipient" });
    assert.ok(dismissed?.dismissedAt);
    assert.equal((await first.listForRecipient({ recipientUserId: "recipient", limit: 10 })).length, 0);
    assert.equal((await first.listForRecipient({ recipientUserId: "recipient", limit: 10, includeDismissed: true })).length, 1);
    await create().initialize();
    await create().initialize();
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='user_notifications' AND column_name='dismissed_at'",
    );
    assert.equal(columns.rowCount, 1);
    const row = await pool.query<{ read_at: string | null; dismissed_at: string | null }>("SELECT read_at,dismissed_at FROM user_notifications");
    assert.ok(row.rows[0]?.read_at); assert.ok(row.rows[0]?.dismissed_at);
  } finally {
    await pool?.end();
    await setup.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await setup.end();
  }
});
