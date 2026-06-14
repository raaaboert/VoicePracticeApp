import assert from "node:assert/strict";
import test from "node:test";
import type {
  DashboardCoachingInsights,
  DashboardCustomerDetailResponse,
  DashboardOverviewResponse,
  DashboardTrainingWorkspaceRow,
  DashboardViewer,
  DashboardUserReportResponse,
} from "@voicepractice/shared";

import {
  buildAggregateCompanyNarrative,
  buildAggregateUsersNarrative,
  buildCustomerNarrative,
  buildUserHighlights,
} from "./dashboardNarratives";

function createEmptyCoachingInsights(): DashboardCoachingInsights {
  return {
    mode: "artifact_only",
    totalScoredAttemptsLast30Days: 0,
    artifactBackedScoresLast30Days: 0,
    artifactCoveragePercentLast30Days: null,
    normalizedThemeScoresLast30Days: 0,
    normalizedThemeCoveragePercentLast30Days: null,
    topImprovementAreas: [],
    topStrengths: [],
    topCoachingPriorities: [],
    repeatedFocusArea: null,
    normalizationDiagnostics: null,
  };
}

function createDashboardViewer(): DashboardViewer {
  return {
    accessType: "super_user",
    userId: "super-1",
    email: "super@peritio.test",
    isSuperUser: true,
    orgId: null,
    orgName: null,
  };
}

function createUserReportRow(
  overrides: Partial<DashboardUserReportResponse["users"][number]> = {}
): DashboardUserReportResponse["users"][number] {
  return {
    userId: overrides.userId ?? "user-1",
    email: overrides.email ?? "user-1@example.com",
    orgId: overrides.orgId ?? "org-1",
    orgName: overrides.orgName ?? "Acme Co",
    status: overrides.status ?? "active",
    orgRole: overrides.orgRole ?? "user",
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? true,
    simulationsLast30Days: overrides.simulationsLast30Days ?? 0,
    usedMinutesLast30Days: overrides.usedMinutesLast30Days ?? 0,
    scoredAttemptsLast30Days: overrides.scoredAttemptsLast30Days ?? 0,
    averageScoreLast30Days: overrides.averageScoreLast30Days ?? null,
    scoreDeltaLast30Days: overrides.scoreDeltaLast30Days ?? null,
    uniqueScenariosLast30Days: overrides.uniqueScenariosLast30Days ?? 0,
    trainingPackAttemptsLast30Days: overrides.trainingPackAttemptsLast30Days ?? 0,
    latestActivityAt: overrides.latestActivityAt ?? null,
    latestScenarioTitle: overrides.latestScenarioTitle ?? null,
    latestTrainingPackTitle: overrides.latestTrainingPackTitle ?? null,
  };
}

function createTrainingRow(
  overrides: Partial<DashboardTrainingWorkspaceRow> = {}
): DashboardTrainingWorkspaceRow {
  return {
    id: overrides.id ?? "training-1",
    orgId: overrides.orgId ?? "org-1",
    orgName: overrides.orgName ?? "Acme Co",
    name: overrides.name ?? "Negotiation Foundations",
    status: overrides.status ?? "active",
    description: overrides.description ?? "Practice core negotiation conversations.",
    updatedAt: overrides.updatedAt ?? "2026-04-20T00:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    attachedTrainingPackIds: overrides.attachedTrainingPackIds ?? ["pack-1"],
    attachedCustomScenarioIds: overrides.attachedCustomScenarioIds ?? [],
    attachedTrainingPackCount: overrides.attachedTrainingPackCount ?? 1,
    attachedCustomScenarioCount: overrides.attachedCustomScenarioCount ?? 0,
    summary: overrides.summary ?? {
      totalAttemptsLast30Days: 6,
      averageScoreLast30Days: 78,
      activeLearnerCountLast30Days: 1,
      totalScenarioCount: 3,
      latestActivityAt: "2026-04-20T00:00:00.000Z",
    },
    insights: overrides.insights ?? {
      strongestArea: null,
      weakestArea: null,
      mostUsedScenario: { scenarioId: "scenario-1", title: "Difficult feedback", attemptsLast30Days: 6 },
      lowestPerformingScenario: null,
    },
    users: overrides.users ?? [],
    scenarios: overrides.scenarios ?? [],
  } as DashboardTrainingWorkspaceRow;
}

test("aggregate users narrative uses recent-practice user counts rather than active-account counts", () => {
  const userReport: DashboardUserReportResponse = {
    viewer: createDashboardViewer(),
    summary: {
      userCount: 4,
      activeUserCount: 4,
      dashboardUserCount: 4,
      simulationsLast30Days: 5,
      averageScoreLast30Days: 81,
    },
    users: [
      createUserReportRow({
        userId: "u-1",
        email: "engaged@example.com",
        simulationsLast30Days: 5,
        scoredAttemptsLast30Days: 1,
        latestActivityAt: "2026-04-20T00:00:00.000Z",
      }),
      createUserReportRow({ userId: "u-2", email: "idle-1@example.com" }),
      createUserReportRow({ userId: "u-3", email: "idle-2@example.com" }),
      createUserReportRow({ userId: "u-4", email: "idle-3@example.com" }),
    ],
  } as DashboardUserReportResponse;

  const narrative = buildAggregateUsersNarrative(userReport);

  assert.equal(narrative.signals[0]?.value, "5 recent attempts");
  assert.equal(narrative.signals[0]?.context, "1 user with recent practice out of 4 users in scope");
  assert.match(narrative.facts.volumeLabel, /1 user with recent practice/);
  assert.doesNotMatch(narrative.facts.volumeLabel, /active users/i);
});

test("aggregate company narrative derives traction context from recent-practice users", () => {
  const userReport: DashboardUserReportResponse = {
    viewer: createDashboardViewer(),
    summary: {
      userCount: 6,
      activeUserCount: 6,
      dashboardUserCount: 6,
      simulationsLast30Days: 6,
      averageScoreLast30Days: 80,
    },
    users: [
      createUserReportRow({
        userId: "u-1",
        email: "engaged@example.com",
        simulationsLast30Days: 6,
        scoredAttemptsLast30Days: 2,
        averageScoreLast30Days: 80,
        scoreDeltaLast30Days: 4,
      }),
      createUserReportRow({ userId: "u-2", email: "idle@example.com" }),
    ],
  } as DashboardUserReportResponse;

  const overview: DashboardOverviewResponse = {
    viewer: createDashboardViewer(),
    summary: {
      activeCustomers: 1,
      activeUsers: 25,
      dashboardUsers: 10,
      monthlyUsageMinutes: 60,
      simulationsLast30Days: 6,
      averageScoreThisPeriod: 80,
      activeTrainingPackCount: 1,
      customScenarioCount: 0,
    },
    customers: [],
    topScenarios: [],
    trainingPackAttribution: {
      mode: "forward_only",
      attributedUsageSessionsLast30Days: 6,
      unattributedUsageSessionsLast30Days: 0,
      attributedScoresLast30Days: 2,
      unattributedScoresLast30Days: 0,
    },
    coachingInsights: createEmptyCoachingInsights(),
  } as DashboardOverviewResponse;

  const narrative = buildAggregateCompanyNarrative({
    overview,
    trainings: [createTrainingRow()],
    userReport,
  });

  assert.equal(narrative.signals[0]?.value, "6 recent attempts");
  assert.equal(narrative.signals[0]?.context, "1 user with recent practice");
  assert.match(narrative.facts.volumeLabel, /1 user with recent practice/);
  assert.doesNotMatch(narrative.facts.volumeLabel, /active users/i);
});

test("customer narrative uses visible recent-practice users rather than account-status counts", () => {
  const payload: DashboardCustomerDetailResponse = {
    viewer: createDashboardViewer(),
    customer: {
      orgId: "org-1",
      orgName: "Acme Co",
      orgStatus: "active",
      contactName: "Owner",
      contactEmail: "owner@example.com",
      industryLabels: ["General"],
      createdAt: "2026-01-01T00:00:00.000Z",
      nextRenewalAt: "2026-05-01T00:00:00.000Z",
      monthlyMinutesAllotted: 600,
      activeUserCount: 22,
      totalUserCount: 25,
      dashboardUserCount: 5,
      simulationsLast30Days: 4,
      usedMinutesThisPeriod: 28,
      averageScoreThisPeriod: 79,
      scoreDeltaLast30Days: null,
      trainingPackCount: 2,
      activeTrainingPackCount: 2,
      customScenarioCount: 0,
      latestActivityAt: "2026-04-20T00:00:00.000Z",
      customerUserEmails: [],
    },
    insights: {
      usage: {
        periodStartAt: "2026-04-01T00:00:00.000Z",
        periodEndAt: "2026-05-01T00:00:00.000Z",
        nextRenewalAt: "2026-05-01T00:00:00.000Z",
        usedMinutesThisPeriod: 28,
        allottedMinutesThisPeriod: 600,
        usagePercentThisPeriod: 4.7,
      },
      trend: [],
      trainingPacks: [
        {
          trainingPackId: "pack-1",
          title: "Conflict Practice",
          trainingTopic: "Conflict",
          audienceLevel: "Manager",
          active: true,
          objectiveCount: 1,
          selectedScenarioCount: 1,
          scenarioSelectionMode: "selected",
          scenarioSelectionLabel: "1 selected",
          requiredBehaviorCount: 1,
          completionSupported: true,
          requiredScenarioCount: 1,
          assignedLearnerCount: 3,
          startedLearnerCount: 1,
          completedLearnerCount: 0,
          inProgressLearnerCount: 1,
          notStartedLearnerCount: 2,
          attemptsLast30Days: 4,
          scoredAttemptsLast30Days: 1,
          learnerCountLast30Days: 1,
          averageScoreLast30Days: 79,
          scoreDeltaLast30Days: null,
          latestActivityAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      users: [
        {
          userId: "u-1",
          email: "engaged@example.com",
          status: "active",
          orgRole: "user",
          dashboardAccessEnabled: true,
          simulationsLast30Days: 4,
          usedMinutesLast30Days: 14,
          averageScoreLast30Days: 79,
          latestActivityAt: "2026-04-20T00:00:00.000Z",
          lastScenarioTitle: "Difficult feedback",
        },
        {
          userId: "u-2",
          email: "idle@example.com",
          status: "active",
          orgRole: "user",
          dashboardAccessEnabled: true,
          simulationsLast30Days: 0,
          usedMinutesLast30Days: 0,
          averageScoreLast30Days: null,
          latestActivityAt: null,
          lastScenarioTitle: null,
        },
      ],
      scenarios: [
        {
          scenarioId: "scenario-1",
          title: "Difficult feedback",
          summary: null,
          segmentId: "seg-1",
          segmentLabel: "Conflict",
          source: "standard",
          attemptsLast30Days: 4,
          learnerCountLast30Days: 1,
          averageScoreLast30Days: 79,
          scoreDeltaLast30Days: null,
          latestActivityAt: "2026-04-20T00:00:00.000Z",
          topUserEmail: "engaged@example.com",
          topUserAverageScore: 79,
        },
      ],
      trainingPackAttribution: {
        mode: "forward_only",
        attributedUsageSessionsLast30Days: 4,
        unattributedUsageSessionsLast30Days: 0,
        attributedScoresLast30Days: 1,
        unattributedScoresLast30Days: 0,
      },
      coachingInsights: createEmptyCoachingInsights(),
    },
  } as DashboardCustomerDetailResponse;

  const narrative = buildCustomerNarrative(payload);

  assert.equal(narrative.signals[0]?.value, "4 recent simulations");
  assert.equal(narrative.signals[0]?.context, "1 user with recent practice");
  assert.match(narrative.facts.volumeLabel, /1 user with recent practice/);
  assert.doesNotMatch(narrative.facts.volumeLabel, /active users/i);
});

test("user highlights exclude users with fewer than two scored attempts from comparisons", () => {
  const users: DashboardUserReportResponse["users"] = [
    createUserReportRow({
      userId: "u-1",
      email: "single-score@example.com",
      simulationsLast30Days: 5,
      scoredAttemptsLast30Days: 1,
      averageScoreLast30Days: 84,
    }),
    createUserReportRow({
      userId: "u-2",
      email: "comparable@example.com",
      simulationsLast30Days: 4,
      scoredAttemptsLast30Days: 2,
      averageScoreLast30Days: 78,
      scoreDeltaLast30Days: 3,
    }),
  ];

  const highlights = buildUserHighlights(users);

  assert.equal(highlights.comparisonUsers.length, 1);
  assert.equal(highlights.comparisonUsers[0]?.email, "comparable@example.com");
  assert.equal(highlights.topPerformer?.email, "comparable@example.com");
  assert.equal(highlights.improvingUser?.email, "comparable@example.com");
});
