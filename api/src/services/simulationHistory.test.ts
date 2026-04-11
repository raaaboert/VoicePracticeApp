import assert from "node:assert/strict";
import test from "node:test";

import {
  SimulationScoreRecord,
  TrainingPackAssignmentRecord,
  UsageSessionRecord
} from "@voicepractice/shared";

import { createScoreRecordAccess } from "./scoreRecordAccess.js";
import { createSimulationHistoryAccess } from "./simulationHistory.js";
import { createUsageSessionAccess } from "./usageSessionAccess.js";

function createSession(overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    id: overrides.id ?? "sess_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    startedAt: overrides.startedAt ?? "2026-03-31T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-31T10:05:00.000Z",
    rawDurationSeconds: overrides.rawDurationSeconds ?? 300,
    createdAt: overrides.createdAt ?? "2026-03-31T10:05:00.000Z"
  };
}

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
    overallScore: overrides.overallScore ?? 84,
    completionLevel: overrides.completionLevel,
    objectiveAchieved: overrides.objectiveAchieved,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 8,
    empathy: overrides.empathy ?? 8,
    assertiveness: overrides.assertiveness ?? 8,
    createdAt: overrides.createdAt ?? "2026-03-31T10:05:00.000Z"
  };
}

function createAssignment(overrides: Partial<TrainingPackAssignmentRecord> = {}): TrainingPackAssignmentRecord {
  return {
    id: overrides.id ?? "assignment_1",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_1",
    trainingPackId: overrides.trainingPackId ?? "pack_1",
    requiredScenarioIds: overrides.requiredScenarioIds ?? ["scenario_1", "scenario_2"],
    completionRule: overrides.completionRule ?? "scored_required_scenarios_v1",
    active: overrides.active ?? true,
    assignedAt: overrides.assignedAt ?? "2026-03-01T00:00:00.000Z",
    assignedByUserId: overrides.assignedByUserId ?? null,
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-01T00:00:00.000Z"
  };
}

test("simulationHistoryAccess correlates usage sessions to scores with exact and fuzzy matching", () => {
  const access = createSimulationHistoryAccess({
    usageSessionAccess: createUsageSessionAccess(),
    scoreRecordAccess: createScoreRecordAccess()
  });

  const exactSession = createSession();
  const fuzzySession = createSession({
    id: "sess_fuzzy",
    startedAt: "2026-03-31T11:00:10.000Z",
    endedAt: "2026-03-31T11:05:08.000Z"
  });
  const exactScore = createScore();
  const fuzzyScore = createScore({
    id: "score_fuzzy",
    startedAt: "2026-03-31T11:00:00.000Z",
    endedAt: "2026-03-31T11:05:00.000Z"
  });

  assert.equal(access.findRelatedUsageSessionForScore([exactSession, fuzzySession], exactScore)?.id, "sess_1");
  assert.equal(access.findRelatedUsageSessionForScore([fuzzySession], fuzzyScore)?.id, "sess_fuzzy");
});

test("simulationHistoryAccess composes assignment progress and lifecycle from sessions and scores", () => {
  const access = createSimulationHistoryAccess({
    usageSessionAccess: createUsageSessionAccess(),
    scoreRecordAccess: createScoreRecordAccess()
  });
  const assignment = createAssignment();
  const sessions = [
    createSession({
      id: "sess_1",
      trainingPackId: "pack_1",
      scenarioId: "scenario_1",
      startedAt: "2026-03-10T09:00:00.000Z",
      endedAt: "2026-03-10T09:05:00.000Z"
    })
  ];
  const scores = [
    createScore({
      id: "score_1",
      trainingPackId: "pack_1",
      scenarioId: "scenario_1",
      endedAt: "2026-03-10T09:05:00.000Z",
      overallScore: 80
    }),
    createScore({
      id: "score_2",
      trainingPackId: "pack_1",
      scenarioId: "scenario_2",
      endedAt: "2026-03-11T09:05:00.000Z",
      overallScore: 92
    })
  ];

  const progress = access.computeTrainingPackAssignmentProgress({
    assignment,
    user: { email: "user@example.com", status: "active" },
    scenarioCatalog: new Map([
      ["scenario_1", { title: "Scenario One" }],
      ["scenario_2", { title: "Scenario Two" }]
    ]),
    allSessions: sessions,
    allScores: scores,
    recentSessions: sessions,
    recentScores: scores
  });

  assert.equal(progress.status, "completed");
  assert.equal(progress.startedAt, "2026-03-10T09:00:00.000Z");
  assert.equal(progress.completedAt, "2026-03-11T09:05:00.000Z");
  assert.equal(progress.completedScenarioCount, 2);
  assert.equal(progress.averageScoreLast30Days, 86);

  const db = {
    usageSessions: sessions,
    scoreRecords: scores
  };
  const projected = access.projectTrainingPackAssignmentLifecycle(db, assignment);
  assert.equal(projected.startedAt, "2026-03-10T09:00:00.000Z");
  assert.equal(projected.completedAt, "2026-03-11T09:05:00.000Z");
});

test("simulationHistoryAccess returns aligned activity windows across sessions and scores", () => {
  const access = createSimulationHistoryAccess({
    usageSessionAccess: createUsageSessionAccess(),
    scoreRecordAccess: createScoreRecordAccess()
  });
  const db = {
    usageSessions: [
      createSession({
        id: "sess_1",
        userId: "user_1",
        orgId: "org_1",
        segmentId: "segment_1",
        trainingPackId: "pack_1",
        startedAt: "2026-03-15T10:00:00.000Z",
        endedAt: "2026-03-15T10:05:00.000Z"
      }),
      createSession({
        id: "sess_2",
        userId: "user_2",
        orgId: "org_2",
        segmentId: "segment_1",
        startedAt: "2026-03-15T10:00:00.000Z",
        endedAt: "2026-03-15T10:05:00.000Z"
      })
    ],
    scoreRecords: [
      createScore({
        id: "score_1",
        userId: "user_1",
        orgId: "org_1",
        segmentId: "segment_1",
        trainingPackId: "pack_1",
        endedAt: "2026-03-15T10:05:00.000Z"
      }),
      createScore({
        id: "score_2",
        userId: "user_2",
        orgId: "org_2",
        segmentId: "segment_2",
        endedAt: "2026-03-15T10:05:00.000Z"
      })
    ]
  };

  const window = access.listActivityWindow(db, {
    orgId: "org_1",
    segmentId: "segment_1",
    trainingPackId: "pack_1",
    periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
    periodEndAt: new Date("2026-04-01T00:00:00.000Z")
  });

  assert.equal(window.usageSessions.length, 1);
  assert.equal(window.scoreRecords.length, 1);
  assert.equal(window.usageSessions[0]?.id, "sess_1");
  assert.equal(window.scoreRecords[0]?.id, "score_1");
});

test("simulationHistoryAccess counts only conclusive scores toward assignment completion and scored-attempt summaries", () => {
  const access = createSimulationHistoryAccess({
    usageSessionAccess: createUsageSessionAccess(),
    scoreRecordAccess: createScoreRecordAccess()
  });
  const assignment = createAssignment();
  const scores = [
    createScore({
      id: "score_partial",
      trainingPackId: "pack_1",
      scenarioId: "scenario_1",
      completionLevel: "partial",
      objectiveAchieved: false,
      overallScore: 65
    }),
    createScore({
      id: "score_complete",
      trainingPackId: "pack_1",
      scenarioId: "scenario_2",
      completionLevel: "complete",
      objectiveAchieved: true,
      overallScore: 92
    })
  ];

  const progress = access.computeTrainingPackAssignmentProgress({
    assignment,
    user: { email: "user@example.com", status: "active" },
    scenarioCatalog: new Map([
      ["scenario_1", { title: "Scenario One" }],
      ["scenario_2", { title: "Scenario Two" }]
    ]),
    allSessions: [],
    allScores: scores,
    recentSessions: [],
    recentScores: scores
  });

  assert.equal(progress.completedScenarioCount, 1);
  assert.equal(progress.scoredAttemptsLast30Days, 1);
  assert.equal(progress.status, "in_progress");
});
