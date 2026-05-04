import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { SimulationScoreRecord } from "@voicepractice/shared";

import { buildRecoveredSimulationEvaluationResult } from "../services/mobileScoreRecovery.js";
import { createScoreRecordStore } from "./scoreRecordStore.js";

function createScore(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_1",
    simulationSessionId: Object.prototype.hasOwnProperty.call(overrides, "simulationSessionId")
      ? overrides.simulationSessionId
      : "sim_1",
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
    communicationScore: Object.prototype.hasOwnProperty.call(overrides, "communicationScore")
      ? overrides.communicationScore
      : 82,
    outcomeScore: Object.prototype.hasOwnProperty.call(overrides, "outcomeScore")
      ? overrides.outcomeScore
      : 76,
    overallScore: overrides.overallScore ?? 82,
    completionLevel: Object.prototype.hasOwnProperty.call(overrides, "completionLevel")
      ? overrides.completionLevel
      : "complete",
    objectiveAchieved: Object.prototype.hasOwnProperty.call(overrides, "objectiveAchieved")
      ? overrides.objectiveAchieved
      : true,
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

test("file score record store appends a representative full score and recovers it by simulationSessionId", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-score-record-store-recovery-"));
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
        id: "score_recoverable",
        simulationSessionId: "sim_recoverable",
        communicationScore: 86,
        outcomeScore: 84,
        overallScore: 85,
        completionLevel: "complete",
        objectiveAchieved: true
      })
    );

    const recoveredRecord = store.listRecords({ simulationSessionId: "sim_recoverable" }).at(-1) ?? null;
    assert.equal(recoveredRecord?.id, "score_recoverable");
    const recovered = buildRecoveredSimulationEvaluationResult(recoveredRecord as SimulationScoreRecord);
    assert.equal(recovered.status, "scored");
    assert.equal(recovered.scorecard.overallScore, 85);
    assert.equal(recovered.scorecard.communicationScore, 86);
    assert.equal(recovered.scorecard.outcomeScore, 84);
    assert.equal(recovered.scorecard.completionLevel, "complete");
    assert.equal(recovered.scorecard.objectiveAchieved, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file score record store rejects invalid records before they become recoverable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-score-record-store-invalid-"));
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

    const invalid = {
      ...createScore({ id: "score_invalid", simulationSessionId: "sim_invalid" }),
      overallScore: undefined
    } as unknown as SimulationScoreRecord;

    await assert.rejects(() => store.appendRecord(invalid), /Score record is invalid/);
    assert.equal(store.listRecords({ simulationSessionId: "sim_invalid" }).length, 0);
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
    assert.equal(insert.values.length, 31);
    assert.equal(insert.values[1], "sim_123");
    assert.equal(insert.values[12], 81);
    assert.equal(insert.values[13], 74);
    assert.equal(insert.values[15], "complete");
    assert.equal(insert.values[16], true);
    assert.deepEqual(insert.values[22], {
      strengths: ["Clear structure"],
      improvementAreas: ["Stronger close"],
      coachingPriority: "clarity"
    });
    assert.deepEqual(insert.values[23], {
      strengths: [{ id: "clarity", label: "Clarity" }],
      improvementAreas: [{ id: "close", label: "Closing" }],
      coachingPriority: { id: "clarity", label: "Clarity" }
    });
    assert.equal(insert.values[30], "2026-03-31T10:05:00.000Z");
    assert.match(insert.text, /\$23::jsonb,\s*\$24::jsonb,\s*\$25,/);
    assert.match(insert.text, /\$31::timestamptz/);
  } finally {
    Pool.prototype.query = originalPoolQuery;
    Pool.prototype.connect = originalPoolConnect;
  }
});

test("postgres score record store migration covers all columns used by append and recovery", async () => {
  const originalPoolQuery = Pool.prototype.query;
  const originalPoolConnect = Pool.prototype.connect;
  let capturedMigration = "";

  try {
    Pool.prototype.query = (async function query(
      this: Pool,
      text: string,
      values?: unknown[]
    ): Promise<{ rows: unknown[]; rowCount: number }> {
      void this;
      void values;
      if (text.includes("CREATE TABLE IF NOT EXISTS score_records")) {
        capturedMigration = text;
      }
      return { rows: [], rowCount: 0 };
    }) as typeof Pool.prototype.query;

    Pool.prototype.connect = (async function connect(this: Pool) {
      void this;
      return {
        async query() {
          return { rows: [], rowCount: 0 };
        },
        release() {
          return undefined;
        }
      };
    }) as unknown as typeof Pool.prototype.connect;

    const store = createScoreRecordStore({
      provider: "postgres",
      dbPath: "ignored-for-postgres.json",
      databaseUrl: "postgres://example.invalid/test",
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });

    await store.initialize();

    for (const column of [
      "simulation_session_id",
      "user_id",
      "org_id",
      "division_id",
      "segment_id",
      "scenario_id",
      "training_id",
      "training_pack_id",
      "industry_id",
      "started_at",
      "ended_at",
      "communication_score",
      "outcome_score",
      "overall_score",
      "completion_level",
      "objective_achieved",
      "persuasion",
      "clarity",
      "empathy",
      "assertiveness",
      "summary",
      "coaching_artifact",
      "normalized_coaching_themes",
      "rubric_version",
      "model",
      "prompt_version",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "created_at"
    ]) {
      assert.match(
        capturedMigration,
        new RegExp(`ALTER TABLE score_records ADD COLUMN IF NOT EXISTS ${column}\\b`),
        `expected migration to cover ${column}`
      );
    }
  } finally {
    Pool.prototype.query = originalPoolQuery;
    Pool.prototype.connect = originalPoolConnect;
  }
});

test("postgres score record store does not expose a recoverable score when append fails", async () => {
  const originalPoolQuery = Pool.prototype.query;
  const originalPoolConnect = Pool.prototype.connect;

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
        async query(text: string) {
          if (text.includes("INSERT INTO score_records")) {
            throw new Error("forced score append failure");
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

    await assert.rejects(
      () =>
        store.appendRecord(
          createScore({
            id: "score_failed_append",
            simulationSessionId: "sim_failed_append"
          })
        ),
      /forced score append failure/
    );
    assert.equal(store.listRecords({ simulationSessionId: "sim_failed_append" }).length, 0);
  } finally {
    Pool.prototype.query = originalPoolQuery;
    Pool.prototype.connect = originalPoolConnect;
  }
});
