import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { SupportCaseRecord } from "@voicepractice/shared";
import { createSupportCaseStore } from "./supportCaseStore.js";

const databaseUrl = process.env.SUPPORT_CASE_INTEGRATION_DATABASE_URL?.trim()
  || process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim() || "";

test("real PostgreSQL support expiration clears sensitive fields without reads and preserves live cases and case metadata", { skip: !databaseUrl }, async () => {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /test|integration|throwaway/);
  const setup = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `support_expiration_${randomBytes(8).toString("hex")}`;
  let pool: Pool | undefined;
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    const params = { provider: "postgres" as const, dbPath: "unused", databaseUrl: scoped.toString(),
      pgPoolMax: 1, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 100 };
    pool = new Pool({ connectionString: scoped.toString(), max: 1 });
    const store = createSupportCaseStore(params);
    const before = new Date("2026-10-01T00:00:00.000Z");
    const boundary = new Date("2026-10-11T00:00:00.000Z");
    await store.initialize({ now: before });
    const expired: SupportCaseRecord = { id: "expired", status: "closed", userId: "user_1", orgId: "org_1",
      segmentId: "segment_1", scenarioId: "scenario_1", message: "Legitimate case description",
      transcriptEncrypted: "encrypted-private-transcript", transcriptExpiresAt: boundary.toISOString(), transcriptFileName: "private.txt",
      transcriptMeta: { scenarioTitle: "Private context", segmentLabel: "Segment", difficulty: "medium", personaStyle: "skeptical",
        startedAt: before.toISOString(), endedAt: before.toISOString(), model: "test", promptVersion: "historical", rubricVersion: "unchanged" },
      createdAt: before.toISOString(), updatedAt: before.toISOString() };
    const live = { ...expired, id: "live", transcriptExpiresAt: new Date(boundary.getTime() + 1).toISOString() };
    const metaOnly = { ...expired, id: "metadata_only", transcriptEncrypted: null };
    for (const row of [expired, live, metaOnly]) await store.saveCase(row, { now: before });
    const rows = async () => (await pool!.query("SELECT * FROM support_cases ORDER BY id")).rows;
    const original = await rows();
    await store.purgeExpiredTranscripts(boundary);
    const purged = await rows();
    for (const row of original) {
      assert.deepEqual(purged.find((entry) => entry.id === row.id), row.id === "live" ? row : {
        ...row, transcript_encrypted: null, transcript_expires_at: null, transcript_file_name: null, transcript_meta: null,
      });
    }
    await store.purgeExpiredTranscripts(boundary);
    assert.deepEqual(await rows(), purged);
    // Startup/on-access still purge; no migration or historical score rewrite.
    await createSupportCaseStore(params).initialize({ now: new Date(boundary.getTime() + 1) });
    assert.equal((await rows()).find((row) => row.id === "live").transcript_meta, null);
    await store.saveCase(expired, { now: before });
    assert.equal((await store.getCaseById(expired.id, { now: boundary }))?.transcriptEncrypted, null);
    assert.equal((await rows()).find((row) => row.id === expired.id).transcript_encrypted, null);
    assert.equal(await store.deleteCasesForUser("user_1"), 3);
    assert.deepEqual(await rows(), []);
  } finally {
    await pool?.end();
    try { await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await setup.end(); }
  }
});
