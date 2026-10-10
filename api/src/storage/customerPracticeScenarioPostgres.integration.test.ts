import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { createCustomerPracticeScenarioStore } from "./customerPracticeScenarioStore.js";

const databaseUrl = process.env.CUSTOMER_SCENARIO_INTEGRATION_DATABASE_URL?.trim() || "";
const allowNonLocal = process.env.CUSTOMER_SCENARIO_ALLOW_NON_LOCAL_INTEGRATION_TESTS === "true";

function assertSafeDatabase(url: string): void {
  const normalized = url.toLowerCase();
  if (normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod")) {
    throw new Error("Customer Practice Scenario integration tests refuse production databases.");
  }
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").toLowerCase();
  if (!/(test|integration|throwaway)/.test(databaseName)) {
    throw new Error("Customer Practice Scenario tests require an explicitly named test database.");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase()) && !allowNonLocal) {
    throw new Error("Use a local throwaway PostgreSQL database for Customer Practice Scenario tests.");
  }
}

function scopedDatabaseUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

const draft = {
  title: "Discovery call",
  description: "Practice a customer discovery conversation.",
  desiredOutcome: "Agree on the next step.",
  aiRole: "A skeptical operations leader",
  scoringGuidance: "Assess discovery and next-step clarity.",
  segmentId: "sales",
  applicableIndustryIds: ["technology"],
  sourceReferences: [{ kind: "training_content" as const, referenceId: "content_1", label: "Customer playbook" }],
};

test("real PostgreSQL preserves stable scenario identity across immutable approved versions", {
  skip: !databaseUrl,
}, async () => {
  assertSafeDatabase(databaseUrl);
  const setup = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `customer_scenario_${randomBytes(8).toString("hex")}`;
  const quoted = `"${schema}"`;
  let pool: Pool | null = null;
  try {
    await setup.query(`CREATE SCHEMA ${quoted}`);
    const scopedUrl = scopedDatabaseUrl(databaseUrl, schema);
    pool = new Pool({ connectionString: scopedUrl, max: 2 });
    await pool.query("CREATE TABLE simulation_sessions (simulation_session_id TEXT PRIMARY KEY)");
    await pool.query("CREATE TABLE usage_sessions (id TEXT PRIMARY KEY)");
    const store = createCustomerPracticeScenarioStore({
      provider: "postgres", databaseUrl: scopedUrl, pgPoolMax: 2,
      pgConnectTimeoutMs: 15_000, pgIdleTimeoutMs: 10_000, pool,
    });
    await store.initialize();
    const pinnedColumns = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema=current_schema() AND column_name='scenario_version_id'
         AND table_name IN ('simulation_sessions','usage_sessions')
       ORDER BY table_name`,
    );
    assert.deepEqual(pinnedColumns.rows.map((row) => row.table_name), [
      "simulation_sessions", "usage_sessions",
    ]);

    const created = await store.createDraft({
      orgId: "org_a", scenarioId: "scenario_stable", versionId: "version_1",
      homeFocusTopicId: "topic_a", actorId: "scoped_author", draft,
      now: new Date("2026-10-09T10:00:00Z"),
    });
    assert.equal(created.status, "draft");
    assert.equal(created.currentVersion.versionNumber, 1);
    assert.deepEqual(created.history.map((event) => event.eventType), ["created"]);

    const submitted = await store.submit({
      orgId: "org_a", scenarioId: created.id, actorId: "scoped_author",
      approvalRequired: true, now: new Date("2026-10-09T10:05:00Z"),
    });
    assert.equal(submitted.status, "in_review");
    assert.equal(submitted.approvedVersionId, null);

    const approved = await store.review({
      orgId: "org_a", scenarioId: created.id, actorId: "org_admin",
      decision: "approve", reviewNote: "Ready", now: new Date("2026-10-09T10:10:00Z"),
    });
    assert.equal(approved.approvedVersionId, "version_1");

    const publishedV1 = await store.publish({
      orgId: "org_a", scenarioId: created.id, actorId: "org_admin",
      now: new Date("2026-10-09T10:15:00Z"),
    });
    assert.equal(publishedV1.publishedVersionId, "version_1");
    assert.equal(publishedV1.status, "published");

    const revised = await store.createRevision({
      orgId: "org_a", scenarioId: created.id, versionId: "version_2", actorId: "scoped_author",
      draft: { ...draft, title: "Discovery call revision" },
      now: new Date("2026-10-09T11:00:00Z"),
    });
    assert.equal(revised.id, created.id);
    assert.equal(revised.currentVersion.versionNumber, 2);
    assert.equal(revised.publishedVersion?.id, "version_1");
    assert.equal(revised.publishedVersion?.title, "Discovery call");

    const submittedV2 = await store.submit({
      orgId: "org_a", scenarioId: created.id, actorId: "scoped_author",
      approvalRequired: true, now: new Date("2026-10-09T11:05:00Z"),
    });
    assert.equal(submittedV2.status, "in_review");
    const rejectedV2 = await store.review({
      orgId: "org_a", scenarioId: created.id, actorId: "org_admin",
      decision: "reject", reviewNote: "Clarify the objective", now: new Date("2026-10-09T11:06:00Z"),
    });
    assert.equal(rejectedV2.status, "rejected");
    assert.equal(rejectedV2.history.at(-1)?.comment, "Clarify the objective");
    await store.submit({
      orgId: "org_a", scenarioId: created.id, actorId: "scoped_author",
      approvalRequired: true, now: new Date("2026-10-09T11:07:00Z"),
    });
    const approvedV2 = await store.review({
      orgId: "org_a", scenarioId: created.id, actorId: "org_admin",
      decision: "approve", reviewNote: "Ready now", now: new Date("2026-10-09T11:08:00Z"),
    });
    assert.equal(approvedV2.approvedVersionId, "version_2");
    const publishedV2 = await store.publish({
      orgId: "org_a", scenarioId: created.id, actorId: "org_admin",
      now: new Date("2026-10-09T11:10:00Z"),
    });
    assert.equal(publishedV2.publishedVersionId, "version_2");
    assert.deepEqual(publishedV2.versions.map((version) => version.id), ["version_1", "version_2"]);
    assert.deepEqual(publishedV2.history.map((event) => event.eventType), [
      "created", "submitted", "approved", "published", "created", "submitted", "rejected",
      "submitted", "approved", "published",
    ]);
    assert.equal((await store.getVersion("org_a", created.id, "version_1"))?.title, "Discovery call");
    assert.equal(await store.get("org_b", created.id), null);

    await assert.rejects(
      pool.query("UPDATE customer_practice_scenario_versions SET title='changed' WHERE id='version_1'"),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );

    const archived = await store.archive({
      orgId: "org_a", scenarioId: created.id, actorId: "org_admin",
      now: new Date("2026-10-09T12:00:00Z"),
    });
    assert.equal(archived.status, "archived");
    assert.equal(archived.publishedVersionId, "version_2");
  } finally {
    if (pool) await pool.end();
    await setup.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
    await setup.end();
  }
});
