import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { createUserNotificationStore } from "../storage/userNotificationStore.js";
import { runFocusTopicReminderSweep } from "./focusTopicReminderWorker.js";

const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim() ?? "";
function scopedUrl(url: string, schema: string): string { const parsed = new URL(url); parsed.searchParams.set("options", `-c search_path=${schema}`); return parsed.toString(); }

test("real PostgreSQL Focus Topic reminder deduplication is durable", { skip: !databaseUrl }, async () => {
  const setup = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `focus_reminder_${randomBytes(8).toString("hex")}`;
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString: scopedUrl(databaseUrl, schema), max: 2 });
    try {
      const store = createUserNotificationStore({ provider: "postgres", databaseUrl: scopedUrl(databaseUrl, schema), pgPoolMax: 2, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool });
      await store.initialize();
      const params: any = { db: { orgs: [{ id: "org", status: "active" }], orgTrainings: [{ id: "topic", orgId: "org", name: "Due", status: "active" }], users: [{ id: "learner", accountType: "enterprise", orgId: "org", orgRole: "user", status: "active", emailVerifiedAt: "2026-01-01T00:00:00.000Z", timezone: "UTC" }] }, authority: { assignments: [{ id: "assignment", orgId: "org", topicId: "topic", audience: "individual", subjectUserId: "learner", grantsManagement: false, dueDate: "2026-06-10", createdBy: "admin", createdAt: "2026-01-01T00:00:00.000Z", revokedBy: null, revokedAt: null }], scenarioAttachments: [], contentAttachments: [] }, store, now: new Date("2026-06-03T08:00:00.000Z") };
      const [first, second] = await Promise.all([runFocusTopicReminderSweep(params), runFocusTopicReminderSweep(params)]);
      assert.equal(first.inserted + second.inserted, 1);
      assert.equal((await pool.query("SELECT 1 FROM user_notifications")).rowCount, 1);
    } finally { await pool.end(); }
  } finally { await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await setup.end(); }
});
