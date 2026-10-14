import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";

import { buildSimulationSessionIndustrySnapshot } from "../services/simulationSessionIndustrySnapshot.js";
import { createSimulationSessionStore } from "./simulationSessionStore.js";

const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim() ?? "";

function scopedUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

test("real PostgreSQL simulation-session industry snapshot migration preserves legacy rows and locks once", {
  skip: !databaseUrl,
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase()));
  assert.match(parsed.pathname.toLowerCase(), /(test|integration|throwaway)/);
  const setup = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `simulation_snapshot_${randomBytes(8).toString("hex")}`;
  const quotedSchema = `"${schema}"`;
  let pool: Pool | null = null;
  try {
    await setup.query(`CREATE SCHEMA ${quotedSchema}`);
    const url = scopedUrl(databaseUrl, schema);
    pool = new Pool({ connectionString: url, max: 2 });
    await pool.query(`
      CREATE TABLE simulation_sessions (
        simulation_session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT NULL,
        division_id TEXT NULL, segment_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
        scenario_version_id TEXT NULL, training_id TEXT NULL, training_pack_id TEXT NULL,
        client_started_at TIMESTAMPTZ NULL, server_started_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL,
        usage_recorded_at TIMESTAMPTZ NULL, usage_session_record_id TEXT NULL
      );
      INSERT INTO simulation_sessions (
        simulation_session_id,user_id,org_id,segment_id,scenario_id,server_started_at,last_seen_at,status
      ) VALUES ('legacy','user_1','org_1','segment_1','scenario_1',NOW(),NOW(),'started');
    `);
    const store = createSimulationSessionStore({
      provider: "postgres", dbPath: "unused", databaseUrl: url,
      pgPoolMax: 2, pgConnectTimeoutMs: 2_000, pgIdleTimeoutMs: 2_000,
    });
    await store.initialize();
    const column = await pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'simulation_sessions' AND column_name = 'industry_snapshot'
    `);
    assert.equal(column.rowCount, 1);
    assert.equal((await store.getById("legacy"))?.industrySnapshot, null);

    const snapshot = buildSimulationSessionIndustrySnapshot({
      eligibleIndustryIds: ["industry_a", "industry_b"],
      industries: [
        { id: "industry_a", label: "Industry A", enabled: true, aiBaseline: "Prompt", standardScoringGuidance: "Score" },
        { id: "industry_b", label: "Industry B", enabled: true, aiBaseline: "Prompt B", standardScoringGuidance: "Score B" },
      ],
      capturedAt: new Date("2026-10-13T12:00:00.000Z"),
    });
    await store.upsertStartedSession({
      simulationSessionId: "legacy", userId: "user_1", orgId: "org_1", segmentId: "segment_1", scenarioId: "scenario_1",
      industrySnapshot: snapshot, serverStartedAt: "2026-10-13T12:00:00.000Z", lastSeenAt: "2026-10-13T12:00:00.000Z", status: "started",
    });
    assert.equal((await store.getById("legacy"))?.industrySnapshot, null);
    await store.upsertStartedSession({
      simulationSessionId: "new", userId: "user_1", orgId: "org_1", segmentId: "segment_1", scenarioId: "scenario_1",
      industrySnapshot: snapshot, serverStartedAt: "2026-10-13T12:00:00.000Z", lastSeenAt: "2026-10-13T12:00:00.000Z", status: "started",
    });
    const replacementSnapshot = buildSimulationSessionIndustrySnapshot({
      eligibleIndustryIds: ["industry_b"],
      industries: [
        { id: "industry_b", label: "Industry B", enabled: true, aiBaseline: "Replacement", standardScoringGuidance: "Replacement score" },
      ],
      capturedAt: new Date("2026-10-14T12:00:00.000Z"),
    });
    await store.upsertStartedSession({
      simulationSessionId: "new", userId: "user_1", orgId: "org_1", segmentId: "segment_1", scenarioId: "scenario_1",
      industrySnapshot: replacementSnapshot, serverStartedAt: "2026-10-14T12:00:00.000Z", lastSeenAt: "2026-10-14T12:00:00.000Z", status: "started",
    });
    assert.equal((await store.getById("new"))?.industrySnapshot?.capturedAt, snapshot.capturedAt);
    await pool.query(`
      INSERT INTO simulation_sessions (
        simulation_session_id,user_id,org_id,segment_id,scenario_id,industry_snapshot,server_started_at,last_seen_at,status
      ) VALUES ('malformed','user_1','org_1','segment_1','scenario_1','{"version":999}'::jsonb,NOW(),NOW(),'started')
    `);
    assert.equal((await store.getById("malformed"))?.industrySnapshot, undefined);
    await Promise.all([
      store.lockIndustrySelection({ simulationSessionId: "new", industryId: "industry_a", lockedAt: "2026-10-13T12:01:00.000Z" }),
      store.lockIndustrySelection({ simulationSessionId: "new", industryId: "industry_b", lockedAt: "2026-10-13T12:01:01.000Z" }),
    ]);
    const selected = (await store.getById("new"))?.industrySnapshot?.selection.industryId;
    assert.ok(selected === "industry_a" || selected === "industry_b");
    await store.lockIndustrySelection({ simulationSessionId: "new", industryId: "other", lockedAt: "2026-10-13T12:01:02.000Z" });
    assert.equal((await store.getById("new"))?.industrySnapshot?.selection.industryId, selected);
  } finally {
    await pool?.end();
    try { await setup.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`); }
    finally { await setup.end(); }
  }
});
