import assert from "node:assert/strict";
import test from "node:test";

import { SimulationScoreRecord } from "@voicepractice/shared";

import { createScoreRecordAccess } from "./scoreRecordAccess.js";

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
    summary: overrides.summary,
    coachingArtifact: overrides.coachingArtifact,
    normalizedCoachingThemes: overrides.normalizedCoachingThemes,
    rubricVersion: overrides.rubricVersion,
    model: overrides.model,
    promptVersion: overrides.promptVersion,
    inputTokens: overrides.inputTokens,
    outputTokens: overrides.outputTokens,
    totalTokens: overrides.totalTokens,
    createdAt: overrides.createdAt ?? "2026-03-31T10:05:00.000Z"
  };
}

test("scoreRecordAccess appends, queries, gets by id, and deletes by user", async () => {
  const access = createScoreRecordAccess();
  const db = {
    scoreRecords: [
      createScore(),
      createScore({
        id: "score_2",
        userId: "user_2",
        orgId: "org_2",
        segmentId: "segment_2",
        scenarioId: "scenario_2",
        endedAt: "2026-04-01T08:00:00.000Z"
      })
    ]
  };

  await access.append(
    db,
    createScore({
      id: "score_3",
      userId: "user_1",
      trainingPackId: "pack_1",
      endedAt: "2026-04-02T08:00:00.000Z"
    })
  );

  assert.equal(access.getById(db, "score_3")?.trainingPackId, "pack_1");
  assert.equal(access.listByUserRange(db, { userId: "user_1" }).length, 2);
  assert.equal(access.listByOrgRange(db, { orgId: "org_2" }).length, 1);
  assert.equal(await access.deleteForUser(db, "user_1"), 2);
  assert.equal(db.scoreRecords.length, 1);
});

test("scoreRecordAccess builds user score summaries with the current mobile semantics", () => {
  const access = createScoreRecordAccess();
  const db = {
    scoreRecords: [
      createScore({
        id: "score_a",
        segmentId: "segment_1",
        industryId: "industry_a",
        overallScore: 80,
        endedAt: "2026-03-30T10:00:00.000Z"
      }),
      createScore({
        id: "score_b",
        segmentId: "segment_1",
        industryId: "industry_b",
        overallScore: 90,
        endedAt: "2026-03-31T10:00:00.000Z"
      }),
      createScore({
        id: "score_c",
        userId: "user_2",
        orgId: "org_2",
        overallScore: 100,
        endedAt: "2026-03-31T10:00:00.000Z"
      })
    ]
  };

  const summary = access.buildUserScoreSummary({
    db,
    userId: "user_1",
    periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
    periodEndAt: new Date("2026-04-01T00:00:00.000Z"),
    segmentLabelById: new Map([["segment_1", "Segment One"]]),
    industryLabelById: new Map([
      ["industry_a", "Industry A"],
      ["industry_b", "Industry B"]
    ])
  });

  assert.equal(summary.totals.sessions, 2);
  assert.equal(summary.totals.avgOverallScore, 85);
  assert.equal(summary.byDay.length, 2);
  assert.deepEqual(summary.bySegment, [
    {
      segmentId: "segment_1",
      segmentLabel: "Segment One",
      sessions: 2,
      avgOverallScore: 85
    }
  ]);
  assert.equal(summary.byIndustry.length, 2);
  assert.equal(summary.recent[0]?.id, "score_b");
});

test("scoreRecordAccess builds org analytics with top users and trend lines", () => {
  const access = createScoreRecordAccess();
  const db = {
    scoreRecords: [
      createScore({
        id: "score_a",
        userId: "user_1",
        industryId: "industry_a",
        overallScore: 80,
        endedAt: "2026-03-30T10:00:00.000Z"
      }),
      createScore({
        id: "score_b",
        userId: "user_2",
        industryId: "industry_a",
        overallScore: 90,
        endedAt: "2026-03-31T10:00:00.000Z"
      }),
      createScore({
        id: "score_c",
        userId: "user_2",
        industryId: "industry_b",
        overallScore: 70,
        endedAt: "2026-03-31T12:00:00.000Z"
      })
    ]
  };

  const analytics = access.buildOrgScoreAnalytics({
    db,
    orgId: "org_1",
    periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
    periodEndAt: new Date("2026-04-01T00:00:00.000Z"),
    segmentLabelById: new Map([["segment_1", "Segment One"]]),
    industryLabelById: new Map([
      ["industry_a", "Industry A"],
      ["industry_b", "Industry B"]
    ]),
    userEmailById: new Map([
      ["user_1", "one@example.com"],
      ["user_2", "two@example.com"]
    ])
  });

  assert.equal(analytics.orgAvgOverallScore, 80);
  assert.deepEqual(
    analytics.topUsers.map((entry) => entry.userId).sort(),
    ["user_1", "user_2"]
  );
  assert.equal(analytics.bySegment[0]?.sessions, 3);
  assert.equal(analytics.trendByDay.length, 2);
});
