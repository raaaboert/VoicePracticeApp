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
    communicationScore: overrides.communicationScore,
    outcomeScore: overrides.outcomeScore,
    overallScore: overrides.overallScore ?? 82,
    completionLevel: overrides.completionLevel,
    objectiveAchieved: overrides.objectiveAchieved,
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

test("scoreRecordAccess builds user score summaries from conclusive records only", () => {
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
        id: "score_partial",
        segmentId: "segment_1",
        industryId: "industry_b",
        overallScore: 65,
        completionLevel: "partial",
        objectiveAchieved: false,
        endedAt: "2026-03-31T11:00:00.000Z"
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
  assert.equal(summary.totals.conclusiveSessions, 2);
  assert.equal(summary.totals.outcomeAwareSessions, 0);
  assert.equal(summary.totals.successfulSessions, 0);
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

test("scoreRecordAccess builds org analytics from conclusive records only", () => {
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
      }),
      createScore({
        id: "score_inconclusive",
        userId: "user_2",
        industryId: "industry_b",
        overallScore: 40,
        completionLevel: "inconclusive",
        objectiveAchieved: false,
        endedAt: "2026-03-31T14:00:00.000Z"
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
  assert.equal(analytics.conclusiveSessions, 3);
  assert.equal(analytics.outcomeAwareSessions, 0);
  assert.equal(analytics.successfulSessions, 0);
  assert.deepEqual(
    analytics.topUsers.map((entry) => entry.userId).sort(),
    ["user_1", "user_2"]
  );
  assert.equal(analytics.bySegment[0]?.sessions, 3);
  assert.equal(analytics.trendByDay.length, 2);
});

test("scoreRecordAccess conclusiveOnly filter excludes partial and inconclusive records while preserving legacy records", () => {
  const access = createScoreRecordAccess();
  const db = {
    scoreRecords: [
      createScore({ id: "legacy_score" }),
      createScore({ id: "partial_score", completionLevel: "partial", objectiveAchieved: false }),
      createScore({ id: "complete_score", completionLevel: "complete", objectiveAchieved: true })
    ]
  };

  assert.deepEqual(
    access.list(db, { conclusiveOnly: true }).map((record) => record.id).sort(),
    ["complete_score", "legacy_score"]
  );
});

test("score summaries ignore failed scoring sessions when no score record exists", () => {
  const access = createScoreRecordAccess();
  const db = {
    scoreRecords: [
      createScore({
        id: "verified_score",
        overallScore: 82,
        completionLevel: "complete",
        objectiveAchieved: true,
      })
    ]
  };

  const summary = access.buildUserScoreSummary({
    db,
    userId: "user_1",
    periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
    periodEndAt: new Date("2026-04-01T00:00:00.000Z"),
    segmentLabelById: new Map([["segment_1", "Segment One"]]),
    industryLabelById: new Map()
  });

  assert.equal(summary.totals.sessions, 1);
  assert.equal(summary.totals.avgOverallScore, 82);
  assert.deepEqual(summary.recent.map((record) => record.id), ["verified_score"]);
});

test("score summaries expose successful and outcome-aware counts without treating legacy records as successful", () => {
  const access = createScoreRecordAccess();
  const db = {
    scoreRecords: [
      createScore({
        id: "legacy_score",
        overallScore: 82
      }),
      createScore({
        id: "successful_new",
        overallScore: 88,
        communicationScore: 86,
        outcomeScore: 84,
        completionLevel: "complete",
        objectiveAchieved: true
      }),
      createScore({
        id: "complete_unresolved",
        overallScore: 65,
        communicationScore: 80,
        outcomeScore: 69,
        completionLevel: "complete",
        objectiveAchieved: false
      })
    ]
  };

  const summary = access.buildUserScoreSummary({
    db,
    userId: "user_1",
    periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
    periodEndAt: new Date("2026-04-01T00:00:00.000Z"),
    segmentLabelById: new Map([["segment_1", "Segment One"]]),
    industryLabelById: new Map()
  });

  assert.equal(summary.totals.sessions, 3);
  assert.equal(summary.totals.conclusiveSessions, 3);
  assert.equal(summary.totals.outcomeAwareSessions, 2);
  assert.equal(summary.totals.successfulSessions, 1);
});
