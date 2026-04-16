import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { SimulationScoreRecord } from "@voicepractice/shared";

import { createScoreRecordStore } from "./scoreRecordStore.js";

function createScore(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    divisionId: overrides.divisionId ?? null,
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    industryId: overrides.industryId ?? null,
    startedAt: overrides.startedAt ?? "2026-03-31T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-31T10:05:00.000Z",
    overallScore: overrides.overallScore ?? 82,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 9,
    empathy: overrides.empathy ?? 7,
    assertiveness: overrides.assertiveness ?? 8,
    summary: overrides.summary ?? "Solid attempt",
    coachingArtifact: overrides.coachingArtifact ?? {
      strengths: ["Clear structure"],
      improvementAreas: ["Stronger close"],
      coachingPriority: "clarity"
    },
    normalizedCoachingThemes: overrides.normalizedCoachingThemes ?? {
      strengths: [{ id: "clarity", label: "Clarity" }],
      improvementAreas: [{ id: "close", label: "Closing" }],
      coachingPriority: { id: "clarity", label: "Clarity" }
    },
    rubricVersion: overrides.rubricVersion ?? "rubric_v1",
    model: overrides.model ?? "gpt-test",
    promptVersion: overrides.promptVersion ?? "prompt_v1",
    inputTokens: overrides.inputTokens ?? 10,
    outputTokens: overrides.outputTokens ?? 12,
    totalTokens: overrides.totalTokens ?? 22,
    createdAt: overrides.createdAt ?? "2026-03-31T10:05:00.000Z"
  };
}

test("file score record store appends, queries, gets by id, and deletes by user", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-score-record-store-"));
  try {
    const store = createScoreRecordStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize();

    await store.appendRecord(createScore({ id: "score_a" }));
    await store.appendRecord(
      createScore({
        id: "score_b",
        userId: "user_2",
        orgId: "org_2",
        divisionId: "division_2",
        segmentId: "segment_2",
        scenarioId: "scenario_2",
        trainingPackId: "pack_2",
        endedAt: "2026-04-01T10:05:00.000Z",
        createdAt: "2026-04-01T10:05:00.000Z"
      })
    );
    await store.appendRecord(
      createScore({
        id: "score_c",
        userId: "user_1",
        trainingPackId: "pack_1",
        scenarioId: "scenario_3",
        endedAt: "2026-04-02T10:05:00.000Z",
        createdAt: "2026-04-02T10:05:00.000Z"
      })
    );

    assert.equal(store.getRecordById("score_b")?.trainingPackId, "pack_2");
    assert.equal(store.getRecordById("score_b")?.divisionId, "division_2");
    assert.deepEqual(
      store.listRecords({ userId: "user_1" }).map((record) => record.id),
      ["score_a", "score_c"]
    );
    assert.deepEqual(
      store.listRecords({
        orgId: "org_2",
        endedAtFrom: new Date("2026-04-01T00:00:00.000Z"),
        endedAtBefore: new Date("2026-04-02T00:00:00.000Z")
      }).map((record) => record.id),
      ["score_b"]
    );
    assert.deepEqual(
      store.listRecords({
        trainingPackId: "pack_1",
        scenarioId: "scenario_3"
      }).map((record) => record.id),
      ["score_c"]
    );

    const deletedCount = await store.deleteRecordsForUser("user_1");
    assert.equal(deletedCount, 2);
    assert.deepEqual(
      store.listRecords().map((record) => record.id),
      ["score_b"]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file score record store imports legacy score records with immediate authority handoff semantics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-score-record-store-"));
  try {
    const store = createScoreRecordStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize();

    await store.appendRecord(
      createScore({
        id: "score_existing",
        overallScore: 70,
        createdAt: "2026-03-31T08:00:00.000Z"
      })
    );

    const migration = await store.importLegacyRecords([
      createScore({
        id: "score_existing",
        overallScore: 91,
        createdAt: "2026-03-31T09:00:00.000Z"
      }),
      createScore({
        id: "score_new",
        userId: "user_2",
        scenarioId: "scenario_9",
        createdAt: "2026-03-31T11:00:00.000Z"
      })
    ]);

    assert.equal(migration.importedCount, 1);
    assert.equal(store.getRecordById("score_existing")?.overallScore, 91);
    assert.deepEqual(
      store.listRecords().map((record) => record.id),
      ["score_existing", "score_new"]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file score record store refreshSnapshot picks up out-of-band writes and deletes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-score-record-store-refresh-"));
  try {
    const dbPath = path.join(tempDir, "db.local.json");
    const storeA = createScoreRecordStore({
      provider: "file",
      dbPath,
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    const storeB = createScoreRecordStore({
      provider: "file",
      dbPath,
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });

    await storeA.initialize();
    await storeA.appendRecord(createScore({ id: "score_a" }));
    await storeB.initialize();

    await storeB.appendRecord(createScore({ id: "score_b", createdAt: "2026-04-01T10:05:00.000Z" }));

    assert.deepEqual(storeA.listRecords().map((record) => record.id), ["score_a"]);

    await storeA.refreshSnapshot();
    assert.deepEqual(storeA.listRecords().map((record) => record.id), ["score_a", "score_b"]);

    const deletedCount = await storeB.deleteRecordsForUser("user_1");
    assert.equal(deletedCount, 2);
    assert.deepEqual(storeA.listRecords().map((record) => record.id), ["score_a", "score_b"]);

    await storeA.refreshSnapshot();
    assert.deepEqual(storeA.listRecords(), []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("postgres score record store appendRecord uses a valid placeholder set for score upserts", async () => {
  const originalPoolQuery = Pool.prototype.query;
  const originalPoolConnect = Pool.prototype.connect;

  let capturedInsert:
    | {
        text: string;
        values: unknown[];
      }
    | null = null;

  try {
    Pool.prototype.query = (async function query(
      this: Pool,
      text: string,
      values?: unknown[]
    ): Promise<{ rows: unknown[]; rowCount: number }> {
      void this;
      void text;
      void values;
      return { rows: [], rowCount: 0 };
    }) as typeof Pool.prototype.query;

    Pool.prototype.connect = (async function connect(this: Pool) {
      void this;
      return {
        async query(text: string, values?: unknown[]) {
          if (text.includes("INSERT INTO score_records")) {
            capturedInsert = {
              text,
              values: Array.isArray(values) ? values : []
            };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {
          return undefined;
        }
      };
    }) as typeof Pool.prototype.connect;

    const store = createScoreRecordStore({
      provider: "postgres",
      dbPath: "ignored-for-postgres.json",
      databaseUrl: "postgres://example.invalid/test",
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });

    await store.appendRecord(
      createScore({
        id: "score_pg",
        simulationSessionId: "sim_123",
        communicationScore: 81,
        outcomeScore: 74,
        completionLevel: "complete",
        objectiveAchieved: true
      })
    );

    if (!capturedInsert) {
      assert.fail("expected appendRecord to issue a score_records insert");
    }

    const insert = capturedInsert as { text: string; values: unknown[] };
    const placeholderMatches = insert.text.match(/\$(\d+)/g) ?? [];
    const highestPlaceholder = placeholderMatches.reduce((max: number, token: string) => {
      const current = Number(token.slice(1));
      return Number.isFinite(current) ? Math.max(max, current) : max;
    }, 0);

    assert.equal(highestPlaceholder, insert.values.length);
    assert.match(insert.text, /\$23::jsonb,\s*\$24::jsonb,\s*\$25,/);
    assert.match(insert.text, /\$31::timestamptz/);
  } finally {
    Pool.prototype.query = originalPoolQuery;
    Pool.prototype.connect = originalPoolConnect;
  }
});
