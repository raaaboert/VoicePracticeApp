import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { ApiDatabase, AuditEvent } from "@voicepractice/shared";

import { FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION, FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION } from "../services/focusTopicAuthorityBackfill.js";
import { buildTopicAssignedNotificationInputs } from "../services/topicAssignedNotifications.js";
import { createAuditEventStore } from "./auditEventStore.js";
import { createFocusTopicAuthorityStore } from "./focusTopicAuthorityStore.js";
import { createUserNotificationStore } from "./userNotificationStore.js";

const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim() ?? "";
const NOW = "2026-10-07T12:00:00.000Z";

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

test("real PostgreSQL assignment governance, notification rollback, revocation history, and cutover guard",
  { skip: !databaseUrl }, async () => {
    assertThrowawayDatabase(databaseUrl);
    const setup = new Pool({ connectionString: databaseUrl, max: 1 });
    const schema = `focus_authority_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    let pool: Pool | null = null;
    try {
      await setup.query(`CREATE SCHEMA ${quotedSchema}`);
      pool = new Pool({ connectionString: scopedUrl(databaseUrl, schema), max: 2 });
      await pool.query(`CREATE TABLE org_content_items (org_id TEXT NOT NULL, id UUID NOT NULL,
        PRIMARY KEY (org_id, id))`);
      const authority = createFocusTopicAuthorityStore({
        provider: "postgres", databaseUrl: scopedUrl(databaseUrl, schema), pgPoolMax: 2,
        pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool,
      });
      const notifications = createUserNotificationStore({
        provider: "postgres", databaseUrl: scopedUrl(databaseUrl, schema), pgPoolMax: 2,
        pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool,
      });
      const audit = createAuditEventStore({ provider: "postgres", dbPath: "unused",
        databaseUrl: scopedUrl(databaseUrl, schema), pgPoolMax: 2,
        pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool });
      await authority.initialize();
      await notifications.initialize();
      await audit.initialize();
      await assert.rejects(authority.assertAssignmentsReady(), /signed-off backfill APPLY/);
      const fingerprint = "a".repeat(64);
      await pool.query(`INSERT INTO focus_topic_backfill_runs
        (id,run_version,mode,schema_generation,input_fingerprint,result_summary,executed_at,
          validated_at,validated_by,signed_off_at,signed_off_by)
        VALUES ($1,$2,'apply',$3,$4,$5::jsonb,$6,$6,'validator',$6,'owner')`,
      ["empty_run", FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION, FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION,
        fingerprint, JSON.stringify({ assignmentCount: 0, scenarioAttachmentCount: 0,
          contentAttachmentCount: 0, issueCount: 0 }), NOW]);
      await assert.rejects(authority.assertAssignmentsReady(), /signed-off backfill APPLY/);
      await pool.query("DELETE FROM focus_topic_backfill_runs WHERE id = 'empty_run'");
      const row = {
        id: "assignment_1", orgId: "org", topicId: "topic", audience: "organization" as const,
        subjectUserId: null, grantsManagement: false, createdBy: "org_admin", createdAt: NOW,
        revokedBy: null, revokedAt: null,
      };
      const auditEvent = (id: string): AuditEvent => ({ id, actorType: "web_user",
        actorId: "org_admin", action: "focus_topic.assignment.created", orgId: "org",
        userId: null, message: "Created Focus Topic learner assignment.",
        metadata: { topicId: "topic", audience: "organization", grantsManagement: false },
        createdAt: NOW });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await authority.createAssignment(row, client);
        await audit.appendEvents([auditEvent("audit_1")], { client });
        await notifications.enqueueOne({ orgId: "org", recipientUserId: "learner",
          kind: "topic_assigned", subjectType: "focus_topic", subjectId: "topic",
          dedupKey: "assignment_1:learner", payload: { title: "New Focus Topic" } }, { client });
        await client.query("COMMIT");
        await client.query("BEGIN");
        await assert.rejects(authority.createAssignment({ ...row, id: "assignment_2" }, client));
        await client.query("ROLLBACK");
        await client.query("BEGIN");
        await authority.revokeAssignment({ orgId: "org", topicId: "topic",
          assignmentId: row.id, actorId: "org_admin", at: new Date(NOW) }, client);
        await client.query("COMMIT");
        await client.query("BEGIN");
        await authority.createAssignment({ ...row, id: "assignment_3" }, client);
        await audit.appendEvents([auditEvent("audit_3")], { client });
        await assert.rejects(notifications.enqueueOne({ orgId: "org", recipientUserId: "learner",
          kind: "topic_assigned", subjectType: "focus_topic", subjectId: "topic",
          dedupKey: "failed", payload: { title: "x".repeat(1000) } }, { client }));
        await client.query("ROLLBACK");
      } finally { client.release(); }
      const snapshot = await authority.listSnapshot("org");
      assert.deepEqual(snapshot.assignments.map((entry) => [entry.id, Boolean(entry.revokedAt)]),
        [["assignment_1", true]]);
      const audits = await pool.query<{ id: string }>("SELECT id FROM audit_events ORDER BY id");
      assert.deepEqual(audits.rows.map((entry) => entry.id), ["audit_1"]);
      assert.equal((await notifications.listForRecipient({ recipientUserId: "learner", limit: 10 })).length, 1);

      const activeAssignment = { ...row, id: "assignment_activation" };
      await pool.query(`CREATE TABLE app_state (id TEXT PRIMARY KEY, state_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      const topic = { id: "topic", orgId: "org", name: "Coaching", status: "draft" as const,
        description: "", createdAt: NOW, updatedAt: NOW };
      const users = ["learner", "peer"].map((id) => ({ id, accountType: "enterprise" as const,
        orgId: "org", orgRole: "user" as const, status: "active" as const,
        emailVerifiedAt: NOW, managerUserId: null }));
      const state = { orgs: [{ id: "org", status: "active" }], users,
        orgTrainings: [topic] } as unknown as ApiDatabase;
      await pool.query("INSERT INTO app_state (id,state_json) VALUES ('primary',$1::jsonb)", [JSON.stringify(state)]);
      const activation: ApiDatabase = { ...state, orgTrainings: [{ ...topic, status: "active" as const }] };
      const activationNotifications = buildTopicAssignedNotificationInputs({
        db: activation, topic: activation.orgTrainings[0]!, topicBefore: topic,
        assignmentsBefore: [activeAssignment], assignmentsAfter: [activeAssignment],
        eventKey: "activation_event", createdAt: new Date(NOW),
      });
      assert.equal(activationNotifications.length, 2);
      const activationClient = await pool.connect();
      try {
        await activationClient.query("BEGIN");
        await authority.createAssignment(activeAssignment, activationClient);
        await activationClient.query("UPDATE app_state SET state_json=$1::jsonb WHERE id='primary'", [JSON.stringify(activation)]);
        await notifications.enqueueMany(activationNotifications, { client: activationClient });
        await activationClient.query("COMMIT");
      } finally { activationClient.release(); }
      const activated = await pool.query<{ state_json: ApiDatabase }>("SELECT state_json FROM app_state WHERE id='primary'");
      assert.equal(activated.rows[0]?.state_json.orgTrainings[0]?.status, "active");
      const fanout = await pool.query<{ recipient_user_id: string }>(
        "SELECT recipient_user_id FROM user_notifications WHERE dedup_key LIKE 'topic-assigned:activation_event:%' ORDER BY recipient_user_id",
      );
      assert.deepEqual(fanout.rows.map((entry) => entry.recipient_user_id), ["learner", "peer"]);
      await notifications.enqueueMany(activationNotifications);
      assert.equal((await pool.query("SELECT 1 FROM user_notifications WHERE dedup_key LIKE 'topic-assigned:activation_event:%'")).rowCount, 2);

      await pool.query(`INSERT INTO focus_topic_backfill_runs
        (id,run_version,mode,schema_generation,input_fingerprint,result_summary,executed_at,
          validated_at,validated_by,signed_off_at,signed_off_by)
        VALUES ($1,$2,'apply',$3,$4,$5::jsonb,$6,$6,'validator',$6,'owner')`,
      ["run", FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION, FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION,
        fingerprint, JSON.stringify({ assignmentCount: 1, scenarioAttachmentCount: 0,
          contentAttachmentCount: 0, issueCount: 0 }), NOW]);
      await authority.assertAssignmentsReady();
      await pool.query(`INSERT INTO focus_topic_backfill_runs
        (id,run_version,mode,schema_generation,input_fingerprint,result_summary,executed_at)
        VALUES ($1,$2,'apply',$3,$4,$5::jsonb,$6)`,
      ["later_unsigned_run", FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION,
        FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION, "b".repeat(64),
        JSON.stringify({ assignmentCount: 1, scenarioAttachmentCount: 0,
          contentAttachmentCount: 0, issueCount: 0 }), "2026-10-08T12:00:00.000Z"]);
      await assert.rejects(authority.assertAssignmentsReady(), /signed-off backfill APPLY/);
    } finally {
      await pool?.end();
      await setup.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      await setup.end();
    }
  });
