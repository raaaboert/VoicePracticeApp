import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SimulationScoreRecord } from "@voicepractice/shared";

import { createScoreRecordStore } from "./scoreRecordStore.js";

function createScore(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
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
