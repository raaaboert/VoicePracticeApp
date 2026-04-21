import {
  DashboardCoachingInsights,
  DashboardCustomerDetailResponse,
  DashboardOverviewResponse,
  DashboardTrainingPackDetailResponse,
  DashboardTrainingWorkspaceRow,
  DashboardUserDetailResponse,
  DashboardUserReportResponse,
} from "@voicepractice/shared";

import { formatDateTime, formatSignedPercent } from "@/src/lib/formatters";

export interface DashboardNarrative {
  lead: string;
  support: string[];
  note?: string | null;
}

export interface DashboardUserHighlights {
  comparisonUsers: DashboardUserReportResponse["users"];
  topPerformer: DashboardUserReportResponse["users"][number] | null;
  needsAttention: DashboardUserReportResponse["users"][number] | null;
  improvingUser: DashboardUserReportResponse["users"][number] | null;
  mostEngaged: DashboardUserReportResponse["users"][number] | null;
}

const MIN_USER_COMPARISON_SCORED_ATTEMPTS = 2;
const MIN_COMPANY_SCORE_EVIDENCE = 3;
const MIN_TRAINING_TOTAL_ATTEMPTS_FOR_FOCUS = 4;
const MIN_TRAINING_SCORED_SCENARIOS_FOR_FOCUS = 2;
const MIN_PACK_SCORE_EVIDENCE = 3;
const MIN_CUSTOMER_SCORE_EVIDENCE = 3;

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function buildMovementSummary(delta: number | null): string {
  if (delta === null) {
    return "More scored activity is needed before trend direction is reliable.";
  }

  if (delta > 0) {
    return `Recent scored movement is positive (${formatSignedPercent(delta)} vs the prior 30 days).`;
  }

  if (delta < 0) {
    return `Recent scored movement is softer (${formatSignedPercent(delta)} vs the prior 30 days).`;
  }

  return "Recent scored movement is flat versus the prior 30 days.";
}

function countScoredScenarios(training: DashboardTrainingWorkspaceRow): number {
  return training.scenarios.filter((scenario) => scenario.averageScoreLast30Days !== null).length;
}

function hasEnoughTrainingFocusEvidence(training: DashboardTrainingWorkspaceRow): boolean {
  return (
    training.summary.totalAttemptsLast30Days >= MIN_TRAINING_TOTAL_ATTEMPTS_FOR_FOCUS &&
    countScoredScenarios(training) >= MIN_TRAINING_SCORED_SCENARIOS_FOR_FOCUS
  );
}

function getTopLabelByCount(rows: Array<{ label: string }>): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = row.label.trim();
    if (!label) {
      continue;
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });

  return sorted[0]?.[0] ?? null;
}

function getRecentAttemptRows(attempts: DashboardUserDetailResponse["attempts"]) {
  const now = Date.now();
  const last30DaysThreshold = now - 30 * 24 * 60 * 60 * 1000;

  return attempts.filter((attempt) => {
    const endedAtMs = new Date(attempt.endedAt).getTime();
    return Number.isFinite(endedAtMs) && endedAtMs >= last30DaysThreshold && endedAtMs < now;
  });
}

export function buildUserHighlights(users: DashboardUserReportResponse["users"]): DashboardUserHighlights {
  const comparisonUsers = users
    .filter(
      (user) =>
        user.averageScoreLast30Days !== null &&
        user.scoredAttemptsLast30Days >= MIN_USER_COMPARISON_SCORED_ATTEMPTS
    )
    .slice()
    .sort((left, right) => {
      if ((right.averageScoreLast30Days ?? 0) !== (left.averageScoreLast30Days ?? 0)) {
        return (right.averageScoreLast30Days ?? 0) - (left.averageScoreLast30Days ?? 0);
      }

      if (right.scoredAttemptsLast30Days !== left.scoredAttemptsLast30Days) {
        return right.scoredAttemptsLast30Days - left.scoredAttemptsLast30Days;
      }

      return left.email.localeCompare(right.email);
    });

  const improvingUser =
    comparisonUsers
      .filter((user) => user.scoreDeltaLast30Days !== null && user.scoreDeltaLast30Days > 0)
      .sort((left, right) => {
        if ((right.scoreDeltaLast30Days ?? 0) !== (left.scoreDeltaLast30Days ?? 0)) {
          return (right.scoreDeltaLast30Days ?? 0) - (left.scoreDeltaLast30Days ?? 0);
        }

        return right.scoredAttemptsLast30Days - left.scoredAttemptsLast30Days;
      })[0] ?? null;

  const attentionCandidates = comparisonUsers
    .filter((user) => (user.scoreDeltaLast30Days ?? 0) < 0)
    .sort((left, right) => {
      if ((left.scoreDeltaLast30Days ?? 0) !== (right.scoreDeltaLast30Days ?? 0)) {
        return (left.scoreDeltaLast30Days ?? 0) - (right.scoreDeltaLast30Days ?? 0);
      }

      return (left.averageScoreLast30Days ?? 0) - (right.averageScoreLast30Days ?? 0);
    });

  const mostEngaged =
    users
      .slice()
      .sort((left, right) => {
        if (right.simulationsLast30Days !== left.simulationsLast30Days) {
          return right.simulationsLast30Days - left.simulationsLast30Days;
        }

        if (right.usedMinutesLast30Days !== left.usedMinutesLast30Days) {
          return right.usedMinutesLast30Days - left.usedMinutesLast30Days;
        }

        return left.email.localeCompare(right.email);
      })[0] ?? null;

  return {
    comparisonUsers,
    topPerformer: comparisonUsers[0] ?? null,
    needsAttention: attentionCandidates[0] ?? comparisonUsers[comparisonUsers.length - 1] ?? null,
    improvingUser,
    mostEngaged,
  };
}

export function buildAggregateTrainingNarrative(training: DashboardTrainingWorkspaceRow | null): DashboardNarrative {
  if (!training) {
    return {
      lead: "No training is selected yet.",
      support: ["Choose a training to review current activity, score signals, and scenario coverage."],
    };
  }

  const totalAttempts = training.summary.totalAttemptsLast30Days;
  const activeLearners = training.summary.activeLearnerCountLast30Days;
  const scoredScenarioCount = countScoredScenarios(training);
  const enoughFocusEvidence = hasEnoughTrainingFocusEvidence(training);
  const underusedScenarioCount = training.scenarios.filter((scenario) => scenario.attemptsLast30Days === 0).length;
  const topScenario = training.insights.mostUsedScenario;
  const strongestArea = training.insights.strongestArea?.label;
  const weakestArea = training.insights.weakestArea?.label;
  const lowestScenario = training.insights.lowestPerformingScenario?.title;

  let lead = "This training has not produced recent practice yet.";
  if (totalAttempts > 0 && activeLearners <= 1) {
    lead = "This training is active, but recent practice is concentrated in one learner.";
  } else if (totalAttempts >= 8 && activeLearners >= 2) {
    lead = `This training is active and generating repeat practice across ${activeLearners} learners.`;
  } else if (totalAttempts > 0) {
    lead = "This training is active, but recent practice volume is still modest.";
  }

  const support: string[] = [];
  if (topScenario) {
    const attemptShare = totalAttempts > 0 ? (topScenario.attemptsLast30Days ?? 0) / totalAttempts : 0;
    support.push(
      attemptShare >= 0.5
        ? `Most recent practice is flowing through ${topScenario.title}.`
        : `${topScenario.title} is currently driving the most visible practice.`
    );
  }

  support.push(
    enoughFocusEvidence && strongestArea && weakestArea && strongestArea !== weakestArea
      ? `${strongestArea} is currently the strongest legacy scoring area, while ${weakestArea} is the weakest.`
      : "Scored evidence is still thin, so the safest read is current usage and coverage rather than performance movement."
  );

  if (underusedScenarioCount > 0) {
    support.push(
      `${underusedScenarioCount} ${pluralize(underusedScenarioCount, "scenario")} in this training have no recent activity.`
    );
  }

  return {
    lead,
    support,
    note: enoughFocusEvidence && lowestScenario
      ? `Next look: ${lowestScenario} is the weakest scored scenario on the current data.`
      : "More completed scored attempts are needed before naming a reliable score-led coaching focus.",
  };
}

export function buildAggregateUsersNarrative(userReport: DashboardUserReportResponse | null): DashboardNarrative {
  const users = userReport?.users ?? [];
  const totalAttempts = userReport?.summary.simulationsLast30Days ?? 0;
  const highlights = buildUserHighlights(users);

  if (users.length === 0 || totalAttempts === 0) {
    return {
      lead: "No user reporting is available in the current 30-day window.",
      support: ["User-level effort, score movement, and training coverage will appear here once practice is recorded."],
    };
  }

  const engagedUserAttemptShare =
    totalAttempts > 0 && highlights.mostEngaged ? highlights.mostEngaged.simulationsLast30Days / totalAttempts : 0;

  let lead = "User activity is visible, but scored history is still too thin for reliable comparison.";
  if (highlights.comparisonUsers.length >= 2 && engagedUserAttemptShare >= 0.4 && highlights.mostEngaged) {
    lead = `User effort is concentrated in a small set of people, led by ${highlights.mostEngaged.email}.`;
  } else if (highlights.comparisonUsers.length >= 2) {
    lead = "Recent learner activity is spread across the visible users, with enough scored history for cautious comparison.";
  }

  const support: string[] = [];
  if (highlights.mostEngaged) {
    support.push(
      `${highlights.mostEngaged.email} is putting in the most recent effort (${highlights.mostEngaged.simulationsLast30Days} simulations in the last 30 days).`
    );
  }

  support.push(
    highlights.improvingUser
      ? `${highlights.improvingUser.email} shows the clearest positive 30-day score movement in the current evidence set.`
      : "Only a small subset of users currently have enough score history to compare movement over time."
  );

  if (highlights.needsAttention && highlights.comparisonUsers.length >= 2) {
    support.push(
      highlights.needsAttention.scoreDeltaLast30Days !== null && highlights.needsAttention.scoreDeltaLast30Days < 0
        ? `${highlights.needsAttention.email} deserves closer coaching review because recent scored movement is negative.`
        : `${highlights.needsAttention.email} is on the lower end of the current scored comparison set and may need more coaching attention.`
    );
  }

  return {
    lead,
    support,
    note: "Users with fewer than 2 conclusive scored attempts are kept out of score-comparison language.",
  };
}

export function buildAggregateCompanyNarrative(params: {
  overview: DashboardOverviewResponse | null;
  trainings: DashboardTrainingWorkspaceRow[];
  userReport: DashboardUserReportResponse | null;
}): DashboardNarrative {
  const totalAttempts = params.overview?.summary.simulationsLast30Days ?? 0;
  const activeUsers = params.overview?.summary.activeUsers ?? 0;
  const activeTrainings = params.trainings.filter((training) => training.summary.totalAttemptsLast30Days > 0);
  const topTraining = activeTrainings
    .slice()
    .sort((left, right) => right.summary.totalAttemptsLast30Days - left.summary.totalAttemptsLast30Days)[0] ?? null;
  const topTrainingShare =
    totalAttempts > 0 && topTraining ? topTraining.summary.totalAttemptsLast30Days / totalAttempts : 0;
  const users = params.userReport?.users ?? [];
  const scoredAttemptsLast30Days = users.reduce((total, user) => total + user.scoredAttemptsLast30Days, 0);
  const comparisonUsers = buildUserHighlights(users).comparisonUsers;
  const positiveMovementUsers = comparisonUsers.filter((user) => (user.scoreDeltaLast30Days ?? 0) > 0).length;
  const negativeMovementUsers = comparisonUsers.filter((user) => (user.scoreDeltaLast30Days ?? 0) < 0).length;
  const underusedActiveTrainings = params.trainings.filter(
    (training) => training.status === "active" && training.summary.totalAttemptsLast30Days === 0
  ).length;

  if (totalAttempts === 0) {
    return {
      lead: "The product is currently quiet in this reporting scope.",
      support: ["No recent training activity, user effort, or score signals were recorded in the last 30 days."],
    };
  }

  let lead = "Usage is spread across the current training footprint.";
  if (activeTrainings.length === 1 && topTraining) {
    lead = `Usage is real, but it is concentrated in ${topTraining.name}.`;
  } else if (topTraining && topTrainingShare >= 0.6) {
    lead = `Usage is broad enough to see traction, but most recent practice is concentrated in ${topTraining.name}.`;
  } else if (activeTrainings.length <= 3) {
    lead = "Usage is active, but it is still concentrated in a small set of trainings.";
  }

  const support: string[] = [
    `${activeUsers} active ${pluralize(activeUsers, "user")} generated ${totalAttempts} attempts in the last 30 days.`,
  ];

  if (scoredAttemptsLast30Days < MIN_COMPANY_SCORE_EVIDENCE || comparisonUsers.length < 2) {
    support.push("Scored evidence is still limited, so company-wide performance movement is too early to call reliably.");
  } else if (positiveMovementUsers > negativeMovementUsers) {
    support.push("Recent user-level score movement is net positive across the learners who have comparable history.");
  } else if (negativeMovementUsers > positiveMovementUsers) {
    support.push("Recent user-level score movement is net negative across the learners who have comparable history.");
  } else {
    support.push("Recent user-level score movement is mixed across the learners who have comparable history.");
  }

  if (underusedActiveTrainings > 0) {
    support.push(
      `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} show little or no recent activity and may need rollout attention.`
    );
  }

  return {
    lead,
    support,
    note:
      params.overview?.topScenarios[0]
        ? `${params.overview.topScenarios[0].title} is the most active scenario in the current reporting window.`
        : null,
  };
}

export function buildCustomerNarrative(payload: DashboardCustomerDetailResponse): DashboardNarrative {
  const { customer, insights } = payload;
  const trainingRows = insights.trainingPacks;
  const activeTrainingRows = trainingRows.filter((trainingPack) => trainingPack.attemptsLast30Days > 0);
  const topTraining =
    activeTrainingRows
      .slice()
      .sort((left, right) => right.attemptsLast30Days - left.attemptsLast30Days)[0] ?? null;
  const topTrainingShare =
    customer.simulationsLast30Days > 0 && topTraining ? topTraining.attemptsLast30Days / customer.simulationsLast30Days : 0;
  const totalScoredAttemptsLast30Days =
    insights.trainingPackAttribution.attributedScoresLast30Days + insights.trainingPackAttribution.unattributedScoresLast30Days;
  const underusedActiveTrainings = trainingRows.filter(
    (trainingPack) => trainingPack.active && trainingPack.attemptsLast30Days === 0
  ).length;

  if (customer.simulationsLast30Days === 0) {
    return {
      lead: "This account has not produced recent simulation usage yet.",
      support: ["Use the rollout and training footprint below to confirm whether the account is configured but not yet active."],
    };
  }

  let lead = "This account is active, and usage is spread across more than one training area.";
  if (activeTrainingRows.length === 1 && topTraining) {
    lead = `This account is active, but most recent usage is concentrated in ${topTraining.title}.`;
  } else if (topTraining && topTrainingShare >= 0.6) {
    lead = `This account is active, but most recent usage is concentrated in ${topTraining.title}.`;
  }

  const support: string[] = [
    `${customer.activeUserCount} active ${pluralize(customer.activeUserCount, "user")} generated ${customer.simulationsLast30Days} simulations in the last 30 days.`,
  ];

  if (totalScoredAttemptsLast30Days < MIN_CUSTOMER_SCORE_EVIDENCE) {
    support.push("Scored evidence is still limited, so performance conclusions should stay cautious.");
  } else {
    support.push(buildMovementSummary(customer.scoreDeltaLast30Days));
  }

  if (underusedActiveTrainings > 0) {
    support.push(
      `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} show little or no recent engagement and may need a stronger rollout.`
    );
  }

  return {
    lead,
    support,
    note: insights.coachingInsights.repeatedFocusArea
      ? `${insights.coachingInsights.repeatedFocusArea} is the most repeated coaching theme in artifact-backed scoring.`
      : `Latest recorded activity was ${formatDateTime(customer.latestActivityAt)}.`,
  };
}

export function buildTrainingPackNarrative(payload: DashboardTrainingPackDetailResponse): DashboardNarrative {
  const { pack } = payload;
  const scoredAttempts = pack.scoredAttemptsLast30Days;
  const mostUsedScenario =
    pack.scenarios
      .slice()
      .sort((left, right) => {
        if (right.attemptsLast30Days !== left.attemptsLast30Days) {
          return right.attemptsLast30Days - left.attemptsLast30Days;
        }
        return (new Date(right.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.latestActivityAt ?? 0).getTime() || 0);
      })[0] ?? null;
  const neglectedRequiredScenarios = pack.scenarios.filter((scenario) => scenario.attemptsLast30Days === 0).length;

  let lead = "This training pack is assigned, but it is not yet producing recent practice.";
  if (pack.attemptsLast30Days > 0 && scoredAttempts < MIN_PACK_SCORE_EVIDENCE) {
    lead = "This training pack is active, but scored evidence is still too thin for a reliable performance call.";
  } else if (pack.attemptsLast30Days > 0 && (pack.scoreDeltaLast30Days ?? 0) > 0) {
    lead = "This training pack is active and the recent scored trend is positive.";
  } else if (pack.attemptsLast30Days > 0 && (pack.scoreDeltaLast30Days ?? 0) < 0) {
    lead = "This training pack is active, but recent scored performance has softened.";
  } else if (pack.attemptsLast30Days > 0) {
    lead = "This training pack is active and generating repeat practice, but score movement is still mixed.";
  }

  const support: string[] = [
    `${pack.startedLearnerCount} of ${pack.assignedLearnerCount} assigned ${pluralize(pack.assignedLearnerCount, "learner")} have started, and ${pack.completedLearnerCount} have completed the pack.`,
  ];

  if (mostUsedScenario && mostUsedScenario.attemptsLast30Days > 0) {
    support.push(`${mostUsedScenario.title} is driving the most recent practice inside this pack.`);
  }

  if (neglectedRequiredScenarios > 0) {
    support.push(
      `${neglectedRequiredScenarios} required ${pluralize(neglectedRequiredScenarios, "scenario")} show no recent activity.`
    );
  }

  return {
    lead,
    support,
    note: pack.coachingInsights.repeatedFocusArea
      ? `${pack.coachingInsights.repeatedFocusArea} is the most repeated coaching theme in artifact-backed pack scoring.`
      : buildMovementSummary(pack.scoreDeltaLast30Days),
  };
}

export function buildUserDetailNarrative(payload: DashboardUserDetailResponse): DashboardNarrative {
  const { user, coachingInsights, assignments, attempts } = payload;
  const recentAttempts = getRecentAttemptRows(attempts);
  const dominantTraining = getTopLabelByCount(
    recentAttempts
      .filter((attempt) => Boolean(attempt.trainingPackTitle))
      .map((attempt) => ({ label: attempt.trainingPackTitle ?? "Unattributed" }))
  );
  const dominantScenario = getTopLabelByCount(
    recentAttempts
      .filter((attempt) => Boolean(attempt.scenarioTitle))
      .map((attempt) => ({ label: attempt.scenarioTitle ?? attempt.scenarioId }))
  );
  const topStrength = coachingInsights.topStrengths[0]?.theme ?? null;
  const topPriority = coachingInsights.topCoachingPriorities[0]?.theme ?? coachingInsights.repeatedFocusArea ?? null;

  let lead = "This user does not yet have recent visible practice in the dashboard scope.";
  if (user.simulationsLast30Days > 0 && user.scoredAttemptsLast30Days < MIN_USER_COMPARISON_SCORED_ATTEMPTS) {
    lead = "This user is putting in effort, but there is still too little scored history to call improvement reliably.";
  } else if ((user.scoreDeltaLast30Days ?? 0) > 0 && user.scoredAttemptsLast30Days >= MIN_USER_COMPARISON_SCORED_ATTEMPTS) {
    lead = "This user has been active and is showing positive recent score movement.";
  } else if ((user.scoreDeltaLast30Days ?? 0) < 0 && user.scoredAttemptsLast30Days >= MIN_USER_COMPARISON_SCORED_ATTEMPTS) {
    lead = "This user is staying active, but recent scored performance has softened.";
  } else if (user.simulationsLast30Days > 0) {
    lead = "This user is practicing consistently, but score movement is still inconclusive.";
  }

  const support: string[] = [
    `${user.simulationsLast30Days} simulations across ${user.uniqueScenariosLast30Days} ${pluralize(user.uniqueScenariosLast30Days, "scenario")} were recorded in the last 30 days.`,
  ];

  if (dominantTraining || dominantScenario) {
    support.push(
      [
        dominantTraining ? `Most recent scored practice is centered on ${dominantTraining}` : null,
        dominantScenario ? `with ${dominantScenario} appearing most often` : null,
      ]
        .filter(Boolean)
        .join(" ")
        .trim()
        .concat(".")
    );
  }

  if (assignments.length > 0) {
    const startedAssignments = assignments.filter((assignment) => assignment.status !== "not_started").length;
    support.push(
      `${startedAssignments} of ${assignments.length} active ${pluralize(assignments.length, "assignment")} have been started in the visible scope.`
    );
  }

  return {
    lead,
    support,
    note:
      topStrength && topPriority
        ? `Repeated strength: ${topStrength}. Repeated coaching priority: ${topPriority}.`
        : topPriority
          ? `Repeated coaching priority: ${topPriority}.`
          : null,
  };
}
