import {
  DashboardCustomerDetailResponse,
  DashboardOverviewResponse,
  DashboardTrainingPackDetailResponse,
  DashboardTrainingWorkspaceRow,
  DashboardUserDetailResponse,
  DashboardUserReportResponse,
} from "@voicepractice/shared";

import { formatDateTime, formatSignedPercent } from "@/src/lib/formatters";

export interface DashboardNarrativeFactSet {
  subject: string;
  activityLevel: "none" | "light" | "active" | "concentrated";
  evidenceLevel: "none" | "limited" | "developing" | "strong";
  volumeLabel: string;
  focusLabel: string | null;
  watchLabel: string | null;
}

export interface DashboardNarrativeSignal {
  label: string;
  value: string;
  context?: string;
}

export interface DashboardNarrativePriority {
  title: string;
  detail: string;
}

export interface DashboardNarrative {
  summary: string;
  signals: DashboardNarrativeSignal[];
  priorities: DashboardNarrativePriority[];
  note?: string | null;
  facts: DashboardNarrativeFactSet;
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

function joinSentences(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function compactSignals(signals: DashboardNarrativeSignal[]): DashboardNarrativeSignal[] {
  return signals.filter((signal) => signal.value.trim().length > 0).slice(0, 3);
}

function compactPriorities(priorities: DashboardNarrativePriority[]): DashboardNarrativePriority[] {
  return priorities.filter((item) => item.detail.trim().length > 0).slice(0, 3);
}

function buildMovementSummary(delta: number | null): string {
  if (delta === null) {
    return "More scored activity is needed before trend direction is reliable.";
  }

  if (delta > 0) {
    return `Recent scored movement is positive (${formatSignedPercent(delta)} versus the prior 30 days).`;
  }

  if (delta < 0) {
    return `Recent scored movement is softer (${formatSignedPercent(delta)} versus the prior 30 days).`;
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
      summary: "No training is selected yet. Choose a training to review current activity, scored evidence, and scenario coverage.",
      signals: compactSignals([
        { label: "Activity", value: "No training selected", context: "Choose a training above" },
      ]),
      priorities: compactPriorities([
        {
          title: "Next step",
          detail: "Select a training to see the current practice pattern and the supporting proof below.",
        },
      ]),
      facts: {
        subject: "training",
        activityLevel: "none",
        evidenceLevel: "none",
        volumeLabel: "No training selected",
        focusLabel: null,
        watchLabel: "Choose a training",
      },
    };
  }

  const totalAttempts = training.summary.totalAttemptsLast30Days;
  const activeLearners = training.summary.activeLearnerCountLast30Days;
  const scoredScenarioCount = countScoredScenarios(training);
  const enoughFocusEvidence = hasEnoughTrainingFocusEvidence(training);
  const underusedScenarioCount = training.scenarios.filter((scenario) => scenario.attemptsLast30Days === 0).length;
  const topScenario = training.insights.mostUsedScenario;
  const topScenarioAttempts = topScenario?.attemptsLast30Days ?? 0;
  const topScenarioShare = totalAttempts > 0 ? topScenarioAttempts / totalAttempts : 0;
  const strongestArea = training.insights.strongestArea?.label ?? null;
  const weakestArea = training.insights.weakestArea?.label ?? null;
  const lowestScenario = training.insights.lowestPerformingScenario?.title ?? null;

  const summary = joinSentences([
    totalAttempts === 0
      ? "This training has not produced recent practice yet."
      : activeLearners <= 1
        ? `Recent practice is visible, but it is concentrated in one learner with ${totalAttempts} attempts in the last 30 days.`
        : totalAttempts >= 8 && activeLearners >= 2
          ? `This training is generating repeat practice across ${activeLearners} learners, with ${totalAttempts} attempts recorded in the last 30 days.`
          : `This training is active, but recent volume is still modest at ${totalAttempts} attempts across ${activeLearners} learners.`,
    topScenario
      ? topScenarioShare >= 0.5
        ? `Practice is currently centered on ${topScenario.title}, which accounts for most of the recent activity.`
        : `${topScenario.title} is the clearest current usage driver, but practice is not fully concentrated in one scenario.`
      : "There is not yet enough recent activity to identify a clear scenario leader.",
    enoughFocusEvidence && strongestArea && weakestArea && strongestArea !== weakestArea
      ? `On the scored evidence available, ${strongestArea} is the strongest area while ${weakestArea} is the weakest.`
      : "Scored coverage is still limited, so the safest read today is activity and scenario breadth rather than score movement.",
    underusedScenarioCount > 0
      ? `${underusedScenarioCount} ${pluralize(underusedScenarioCount, "scenario")} still show no recent activity, so adoption across the full training remains uneven.`
      : null,
  ]);

  return {
    summary,
    signals: compactSignals([
      {
        label: "Activity",
        value: `${totalAttempts} attempts / ${activeLearners} learners`,
        context: "Last 30 days",
      },
      {
        label: "Evidence",
        value: `${scoredScenarioCount}/${training.summary.totalScenarioCount} scenarios scored`,
        context: enoughFocusEvidence ? "Enough coverage for cautious score reads" : "Coverage is still thin",
      },
      {
        label: "Main focus",
        value: topScenario?.title ?? "No dominant scenario",
        context: topScenario ? `${topScenarioAttempts} recent attempts` : "Activity has not concentrated yet",
      },
    ]),
    priorities: compactPriorities([
      {
        title: "Practice concentration",
        detail: topScenario
          ? `${topScenario.title} is currently carrying the most practice${topScenarioShare >= 0.5 ? " and is taking a majority share of activity" : ""}.`
          : "No single scenario is carrying enough recent traffic to define the training yet.",
      },
      {
        title: "Performance read",
        detail:
          enoughFocusEvidence && strongestArea && weakestArea && strongestArea !== weakestArea
            ? `${strongestArea} is the clearest strength signal, while ${weakestArea} is the weakest scored area on current evidence.`
            : "More completed scored attempts are needed before a score-led coaching focus is trustworthy.",
      },
      {
        title: "Coverage gap",
        detail:
          underusedScenarioCount > 0
            ? `${underusedScenarioCount} ${pluralize(underusedScenarioCount, "scenario")} remain quiet and may need a stronger rollout or clearer learner routing.`
            : "Every scenario has at least some recent activity, so the main question is depth rather than coverage.",
      },
    ]),
    note: enoughFocusEvidence && lowestScenario
      ? `Watch next: ${lowestScenario} is the weakest scored scenario on the current evidence.`
      : "Reliable time-based movement still needs more conclusive scored attempts.",
    facts: {
      subject: training.name,
      activityLevel: totalAttempts === 0 ? "none" : activeLearners <= 1 ? "concentrated" : totalAttempts >= 8 ? "active" : "light",
      evidenceLevel: scoredScenarioCount === 0 ? "none" : enoughFocusEvidence ? "strong" : "limited",
      volumeLabel: `${totalAttempts} attempts across ${activeLearners} learners`,
      focusLabel: topScenario?.title ?? null,
      watchLabel: underusedScenarioCount > 0 ? `${underusedScenarioCount} quiet scenarios` : lowestScenario,
    },
  };
}

export function buildAggregateUsersNarrative(userReport: DashboardUserReportResponse | null): DashboardNarrative {
  const users = userReport?.users ?? [];
  const userCount = userReport?.summary.userCount ?? users.length;
  const activeUsers = userReport?.summary.activeUserCount ?? 0;
  const totalAttempts = userReport?.summary.simulationsLast30Days ?? 0;
  const highlights = buildUserHighlights(users);
  const comparisonCount = highlights.comparisonUsers.length;
  const mostEngaged = highlights.mostEngaged;
  const engagedUserAttemptShare =
    totalAttempts > 0 && mostEngaged ? mostEngaged.simulationsLast30Days / totalAttempts : 0;

  if (users.length === 0 || totalAttempts === 0) {
    return {
      summary: "No user reporting is available in the current 30-day window. User effort, score movement, and coaching signals will appear here once practice is recorded.",
      signals: compactSignals([
        { label: "Activity", value: "No recent attempts", context: "Last 30 days" },
        { label: "Evidence", value: "No comparison set", context: "Scored history has not formed yet" },
      ]),
      priorities: compactPriorities([
        {
          title: "What to watch",
          detail: "Return here once users begin practicing so the dashboard can separate effort from score-backed progress.",
        },
      ]),
      facts: {
        subject: "users",
        activityLevel: "none",
        evidenceLevel: "none",
        volumeLabel: "No recent attempts",
        focusLabel: null,
        watchLabel: "Wait for recent practice",
      },
    };
  }

  const summary = joinSentences([
    engagedUserAttemptShare >= 0.4 && mostEngaged
      ? `Recent learner effort is concentrated in a small set of people, led by ${mostEngaged.email}.`
      : `Recent learner effort is spread across the visible user set, with ${activeUsers} active ${pluralize(activeUsers, "user")} generating ${totalAttempts} attempts in the last 30 days.`,
    mostEngaged
      ? `${mostEngaged.email} is currently putting in the most recent practice with ${mostEngaged.simulationsLast30Days} simulations.`
      : null,
    highlights.improvingUser
      ? `${highlights.improvingUser.email} shows the clearest positive score movement among users with enough scored history to compare.`
      : comparisonCount >= 2
        ? `There is enough scored history to compare a subset of users, but no one is separating clearly on positive score movement yet.`
        : `Only ${comparisonCount} ${pluralize(comparisonCount, "user")} currently have enough scored history for reliable score comparison.`,
    highlights.needsAttention && comparisonCount >= 2 && (highlights.needsAttention.scoreDeltaLast30Days ?? 0) < 0
      ? `${highlights.needsAttention.email} deserves closer coaching review because recent scored movement is negative.`
      : null,
  ]);

  return {
    summary,
    signals: compactSignals([
      {
        label: "Activity",
        value: `${totalAttempts} attempts / ${activeUsers} active users`,
        context: `${userCount} users in scope`,
      },
      {
        label: "Evidence",
        value: `${comparisonCount} comparable users`,
        context: "Users with at least 2 conclusive scored attempts",
      },
      {
        label: "Most engaged",
        value: mostEngaged?.email ?? "No clear leader",
        context: mostEngaged ? `${mostEngaged.simulationsLast30Days} recent simulations` : "Recent effort is still forming",
      },
    ]),
    priorities: compactPriorities([
      {
        title: "Effort leader",
        detail: mostEngaged
          ? `${mostEngaged.email} is driving the most recent practice volume and is the clearest engagement anchor right now.`
          : "No individual user has separated clearly on effort yet.",
      },
      {
        title: "Positive movement",
        detail: highlights.improvingUser
          ? `${highlights.improvingUser.email} has the clearest upward score signal in the current comparable set.`
          : "Score history is still too thin to call a clear improvement leader confidently.",
      },
      {
        title: "Coaching attention",
        detail:
          highlights.needsAttention && comparisonCount >= 2
            ? (highlights.needsAttention.scoreDeltaLast30Days ?? 0) < 0
              ? `${highlights.needsAttention.email} is the clearest review candidate because recent scored movement has softened.`
              : `${highlights.needsAttention.email} is on the lower end of the current comparison set and may need closer coaching attention.`
            : "Keep attention on practice volume first until more users build a comparable scored history.",
      },
    ]),
    note: "Users with fewer than 2 conclusive scored attempts are kept out of score-comparison language.",
    facts: {
      subject: "users",
      activityLevel: engagedUserAttemptShare >= 0.4 ? "concentrated" : totalAttempts > 0 ? "active" : "none",
      evidenceLevel: comparisonCount === 0 ? "none" : comparisonCount < 2 ? "limited" : "developing",
      volumeLabel: `${totalAttempts} attempts across ${activeUsers} active users`,
      focusLabel: mostEngaged?.email ?? null,
      watchLabel: highlights.needsAttention?.email ?? highlights.improvingUser?.email ?? null,
    },
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
  const topScenario = params.overview?.topScenarios[0] ?? null;

  if (totalAttempts === 0) {
    return {
      summary: "The product is currently quiet in this reporting scope. No recent training activity, user effort, or scored evidence was recorded in the last 30 days.",
      signals: compactSignals([
        { label: "Activity", value: "No recent attempts", context: "Last 30 days" },
        { label: "Breadth", value: "0 active trainings", context: "No training has recent usage" },
      ]),
      priorities: compactPriorities([
        {
          title: "What to watch",
          detail: "Return once usage starts so the dashboard can separate adoption breadth from score-backed performance signals.",
        },
      ]),
      facts: {
        subject: "company",
        activityLevel: "none",
        evidenceLevel: "none",
        volumeLabel: "No recent attempts",
        focusLabel: null,
        watchLabel: "Wait for usage",
      },
    };
  }

  const summary = joinSentences([
    activeTrainings.length === 1 && topTraining
      ? `Usage is real, but it is currently concentrated in ${topTraining.name}.`
      : topTraining && topTrainingShare >= 0.6
        ? `Usage is broad enough to see traction, but most recent practice is still concentrated in ${topTraining.name}.`
        : activeTrainings.length <= 3
          ? "Usage is active, but it is still concentrated in a small set of trainings."
          : "Usage is spread across the current training footprint rather than resting on a single program.",
    `${activeUsers} active ${pluralize(activeUsers, "user")} generated ${totalAttempts} attempts in the last 30 days.`,
    scoredAttemptsLast30Days < MIN_COMPANY_SCORE_EVIDENCE || comparisonUsers.length < 2
      ? "Scored evidence is still limited, so company-wide performance movement is too early to call with confidence."
      : positiveMovementUsers > negativeMovementUsers
        ? "Across the users who have enough comparable history, the recent score signal is net positive."
        : negativeMovementUsers > positiveMovementUsers
          ? "Across the users who have enough comparable history, the recent score signal is net negative."
          : "Across the users who have enough comparable history, the recent score signal is mixed.",
    underusedActiveTrainings > 0
      ? `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} show little or no recent activity and may need rollout attention.`
      : null,
  ]);

  return {
    summary,
    signals: compactSignals([
      {
        label: "Activity",
        value: `${totalAttempts} attempts / ${activeUsers} active users`,
        context: "Last 30 days",
      },
      {
        label: "Adoption breadth",
        value: `${activeTrainings.length} active trainings`,
        context: `${params.trainings.length} trainings in scope`,
      },
      {
        label: "Evidence",
        value: `${comparisonUsers.length} comparable users`,
        context: scoredAttemptsLast30Days > 0 ? `${scoredAttemptsLast30Days} conclusive scored attempts` : "Scored history is still limited",
      },
    ]),
    priorities: compactPriorities([
      {
        title: "Concentration",
        detail: topTraining
          ? `${topTraining.name} is the clearest activity center right now${topTrainingShare >= 0.6 ? " and is carrying most recent practice" : ""}.`
          : "No single training is active enough to define the current usage pattern.",
      },
      {
        title: "Performance confidence",
        detail:
          scoredAttemptsLast30Days < MIN_COMPANY_SCORE_EVIDENCE || comparisonUsers.length < 2
            ? "Keep the read focused on usage and rollout for now because score-backed movement is still thin."
            : positiveMovementUsers > negativeMovementUsers
              ? "The current comparable user set leans positive on recent scored movement."
              : negativeMovementUsers > positiveMovementUsers
                ? "The current comparable user set leans negative on recent scored movement and deserves leadership attention."
                : "The current comparable user set is mixed, so coaching follow-up should stay targeted rather than broad.",
      },
      {
        title: "What to watch next",
        detail:
          underusedActiveTrainings > 0
            ? `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} remain underused, which suggests a rollout or enablement gap.`
            : topScenario
              ? `${topScenario.title} is the most active scenario in the current window and is the clearest live usage signal.`
              : "There is no single scenario or rollout risk strong enough yet to outrank the broader usage picture.",
      },
    ]),
    note: topScenario ? `${topScenario.title} is the most active scenario in the current reporting window.` : null,
    facts: {
      subject: "company",
      activityLevel:
        activeTrainings.length === 0 ? "none" : activeTrainings.length <= 1 || topTrainingShare >= 0.6 ? "concentrated" : "active",
      evidenceLevel:
        scoredAttemptsLast30Days === 0 ? "none" : scoredAttemptsLast30Days < MIN_COMPANY_SCORE_EVIDENCE ? "limited" : "developing",
      volumeLabel: `${totalAttempts} attempts across ${activeUsers} active users`,
      focusLabel: topTraining?.name ?? topScenario?.title ?? null,
      watchLabel: underusedActiveTrainings > 0 ? `${underusedActiveTrainings} underused active trainings` : null,
    },
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
  const topScenario =
    insights.scenarios
      .slice()
      .sort((left, right) => right.attemptsLast30Days - left.attemptsLast30Days)[0] ?? null;

  if (customer.simulationsLast30Days === 0) {
    return {
      summary: "This account has not produced recent simulation usage yet. Use the rollout detail below to confirm whether the customer is configured but not yet active.",
      signals: compactSignals([
        { label: "Activity", value: "No recent simulations", context: "Last 30 days" },
        { label: "Evidence", value: "No score signal", context: "Scored history has not formed yet" },
      ]),
      priorities: compactPriorities([
        {
          title: "Immediate takeaway",
          detail: "This page is currently more about rollout readiness than performance because recent usage is not yet present.",
        },
      ]),
      facts: {
        subject: customer.orgName,
        activityLevel: "none",
        evidenceLevel: "none",
        volumeLabel: "No recent simulations",
        focusLabel: null,
        watchLabel: "Check rollout readiness",
      },
    };
  }

  const summary = joinSentences([
    activeTrainingRows.length === 1 && topTraining
      ? `This account is active, but most recent usage is concentrated in ${topTraining.title}.`
      : topTraining && topTrainingShare >= 0.6
        ? `This account is active, but a majority of recent practice is concentrated in ${topTraining.title}.`
        : "This account is active and usage is spread across more than one training area.",
    `${customer.activeUserCount} active ${pluralize(customer.activeUserCount, "user")} generated ${customer.simulationsLast30Days} simulations in the last 30 days.`,
    totalScoredAttemptsLast30Days < MIN_CUSTOMER_SCORE_EVIDENCE
      ? "Scored evidence is still limited, so performance conclusions should stay cautious."
      : buildMovementSummary(customer.scoreDeltaLast30Days),
    underusedActiveTrainings > 0
      ? `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} show little or no recent engagement and may need a stronger rollout.`
      : null,
  ]);

  return {
    summary,
    signals: compactSignals([
      {
        label: "Activity",
        value: `${customer.simulationsLast30Days} simulations`,
        context: `${customer.activeUserCount} active users in the last 30 days`,
      },
      {
        label: "Evidence",
        value: `${totalScoredAttemptsLast30Days} scored attempts`,
        context:
          totalScoredAttemptsLast30Days >= MIN_CUSTOMER_SCORE_EVIDENCE
            ? "Enough volume for cautious score reads"
            : "Keep the score read cautious",
      },
      {
        label: "Main focus",
        value: topTraining?.title ?? topScenario?.title ?? "No dominant focus yet",
        context: topTraining ? "Most active training" : topScenario ? "Most active scenario" : "Recent usage is still forming",
      },
    ]),
    priorities: compactPriorities([
      {
        title: "Usage center",
        detail: topTraining
          ? `${topTraining.title} is the clearest live training signal in this account right now.`
          : "No training pack has separated clearly enough yet to define the account's usage center.",
      },
      {
        title: "Performance confidence",
        detail:
          totalScoredAttemptsLast30Days < MIN_CUSTOMER_SCORE_EVIDENCE
            ? "Use score data cautiously for now because the recent conclusive attempt count is still limited."
            : buildMovementSummary(customer.scoreDeltaLast30Days),
      },
      {
        title: "Leadership watchpoint",
        detail:
          underusedActiveTrainings > 0
            ? `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} remain quiet and are the clearest rollout risk.`
            : insights.coachingInsights.repeatedFocusArea
              ? `${insights.coachingInsights.repeatedFocusArea} is the most repeated coaching theme in artifact-backed scoring.`
              : `Latest recorded activity was ${formatDateTime(customer.latestActivityAt)}.`,
      },
    ]),
    note: insights.coachingInsights.repeatedFocusArea
      ? `${insights.coachingInsights.repeatedFocusArea} is the most repeated coaching theme in artifact-backed scoring.`
      : null,
    facts: {
      subject: customer.orgName,
      activityLevel:
        customer.simulationsLast30Days === 0 ? "none" : activeTrainingRows.length === 1 || topTrainingShare >= 0.6 ? "concentrated" : "active",
      evidenceLevel:
        totalScoredAttemptsLast30Days === 0 ? "none" : totalScoredAttemptsLast30Days < MIN_CUSTOMER_SCORE_EVIDENCE ? "limited" : "developing",
      volumeLabel: `${customer.simulationsLast30Days} simulations across ${customer.activeUserCount} active users`,
      focusLabel: topTraining?.title ?? topScenario?.title ?? null,
      watchLabel: underusedActiveTrainings > 0 ? `${underusedActiveTrainings} underused active trainings` : insights.coachingInsights.repeatedFocusArea,
    },
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

  const summary = joinSentences([
    pack.attemptsLast30Days === 0
      ? "This training pack is assigned, but it is not yet producing recent practice."
      : scoredAttempts < MIN_PACK_SCORE_EVIDENCE
        ? "This training pack is active, but scored evidence is still too thin for a reliable performance call."
        : (pack.scoreDeltaLast30Days ?? 0) > 0
          ? "This training pack is active and the recent scored trend is positive."
          : (pack.scoreDeltaLast30Days ?? 0) < 0
            ? "This training pack is active, but recent scored performance has softened."
            : "This training pack is active and generating repeat practice, but score movement is still mixed.",
    `${pack.startedLearnerCount} of ${pack.assignedLearnerCount} assigned ${pluralize(pack.assignedLearnerCount, "learner")} have started, and ${pack.completedLearnerCount} have completed the pack.`,
    mostUsedScenario && mostUsedScenario.attemptsLast30Days > 0
      ? `${mostUsedScenario.title} is driving the most recent practice inside this pack.`
      : "No single required scenario has separated clearly yet on recent activity.",
    neglectedRequiredScenarios > 0
      ? `${neglectedRequiredScenarios} required ${pluralize(neglectedRequiredScenarios, "scenario")} show no recent activity.`
      : null,
  ]);

  return {
    summary,
    signals: compactSignals([
      {
        label: "Adoption",
        value: `${pack.startedLearnerCount}/${pack.assignedLearnerCount} started`,
        context: `${pack.completedLearnerCount} completed`,
      },
      {
        label: "Evidence",
        value: `${scoredAttempts} scored attempts`,
        context: scoredAttempts >= MIN_PACK_SCORE_EVIDENCE ? "Enough for cautious score reads" : "Trend remains thin",
      },
      {
        label: "Main focus",
        value: mostUsedScenario?.title ?? "No dominant scenario",
        context: mostUsedScenario ? `${mostUsedScenario.attemptsLast30Days} recent attempts` : "Recent practice is still dispersed",
      },
    ]),
    priorities: compactPriorities([
      {
        title: "Adoption signal",
        detail: `${pack.startedLearnerCount} of ${pack.assignedLearnerCount} assigned learners have started, so the main adoption question is ${pack.assignedLearnerCount > 0 && pack.startedLearnerCount < pack.assignedLearnerCount ? "start coverage" : "depth of repeat practice"}.`,
      },
      {
        title: "Performance confidence",
        detail:
          scoredAttempts >= MIN_PACK_SCORE_EVIDENCE
            ? buildMovementSummary(pack.scoreDeltaLast30Days)
            : "Score direction is still too thin to treat as a reliable trend.",
      },
      {
        title: "Coverage gap",
        detail:
          neglectedRequiredScenarios > 0
            ? `${neglectedRequiredScenarios} required ${pluralize(neglectedRequiredScenarios, "scenario")} remain quiet and are the clearest follow-up area.`
            : "Every required scenario shows at least some recent activity, so the next question is quality rather than coverage.",
      },
    ]),
    note: pack.coachingInsights.repeatedFocusArea
      ? `${pack.coachingInsights.repeatedFocusArea} is the most repeated coaching theme in artifact-backed pack scoring.`
      : buildMovementSummary(pack.scoreDeltaLast30Days),
    facts: {
      subject: pack.title,
      activityLevel: pack.attemptsLast30Days === 0 ? "none" : pack.startedLearnerCount <= 1 ? "light" : "active",
      evidenceLevel: scoredAttempts === 0 ? "none" : scoredAttempts < MIN_PACK_SCORE_EVIDENCE ? "limited" : "developing",
      volumeLabel: `${pack.attemptsLast30Days} attempts across ${pack.startedLearnerCount} started learners`,
      focusLabel: mostUsedScenario?.title ?? null,
      watchLabel: neglectedRequiredScenarios > 0 ? `${neglectedRequiredScenarios} quiet required scenarios` : pack.coachingInsights.repeatedFocusArea,
    },
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
  const startedAssignments = assignments.filter((assignment) => assignment.status !== "not_started").length;

  const summary = joinSentences([
    user.simulationsLast30Days === 0
      ? "This user does not yet have recent visible practice in the dashboard scope."
      : `This user has recorded ${user.simulationsLast30Days} simulations across ${user.uniqueScenariosLast30Days} ${pluralize(user.uniqueScenariosLast30Days, "scenario")} in the last 30 days.`,
    dominantTraining || dominantScenario
      ? joinSentences([
          dominantTraining ? `Recent scored practice is centered on ${dominantTraining}.` : null,
          dominantScenario ? `${dominantScenario} appears most often in the recent scored attempt set.` : null,
        ])
      : "Recent scored practice is not yet concentrated enough to call a dominant training or scenario.",
    user.simulationsLast30Days > 0 && user.scoredAttemptsLast30Days < MIN_USER_COMPARISON_SCORED_ATTEMPTS
      ? "There is still too little scored history to call improvement reliably, so the safest read is effort and practice focus."
      : (user.scoreDeltaLast30Days ?? 0) > 0 && user.scoredAttemptsLast30Days >= MIN_USER_COMPARISON_SCORED_ATTEMPTS
        ? "Recent scored movement is positive enough to treat as an early improvement signal."
        : (user.scoreDeltaLast30Days ?? 0) < 0 && user.scoredAttemptsLast30Days >= MIN_USER_COMPARISON_SCORED_ATTEMPTS
          ? "Recent scored performance has softened, so this user deserves closer coaching attention."
          : user.simulationsLast30Days > 0
            ? "Score movement is still inconclusive, so the current takeaway should stay cautious."
            : null,
    topStrength || topPriority
      ? `${topStrength ? `The clearest repeated strength is ${topStrength}` : "A repeated strength is not yet established"}${topPriority ? `, while the main coaching priority is ${topPriority}` : ""}.`
      : null,
  ]);

  return {
    summary,
    signals: compactSignals([
      {
        label: "Effort",
        value: `${user.simulationsLast30Days} simulations`,
        context: `${user.uniqueScenariosLast30Days} scenarios in the last 30 days`,
      },
      {
        label: "Evidence",
        value: `${user.scoredAttemptsLast30Days} scored attempts`,
        context:
          user.scoredAttemptsLast30Days >= MIN_USER_COMPARISON_SCORED_ATTEMPTS
            ? "Enough for cautious score movement reads"
            : "Trend remains too thin",
      },
      {
        label: "Main focus",
        value: dominantTraining ?? dominantScenario ?? user.latestScenarioTitle ?? "No dominant focus yet",
        context: dominantTraining ? "Most frequent recent training" : dominantScenario ? "Most frequent recent scenario" : "Latest visible activity",
      },
    ]),
    priorities: compactPriorities([
      {
        title: "Repeated strength",
        detail: topStrength
          ? `${topStrength} is the clearest recurring positive signal in the artifact-backed coaching record.`
          : "There is not yet enough artifact-backed coverage to name a repeated strength confidently.",
      },
      {
        title: "Coaching priority",
        detail: topPriority
          ? `${topPriority} is the clearest repeated coaching need in the current visible history.`
          : "The coaching record is still too thin to name one repeated priority confidently.",
      },
      {
        title: "Execution context",
        detail:
          assignments.length > 0
            ? `${startedAssignments} of ${assignments.length} active ${pluralize(assignments.length, "assignment")} have been started in the visible scope.`
            : "This user does not currently have an active visible assignment, so practice should be read as broader behavior rather than pack progress.",
      },
    ]),
    note:
      topPriority && topStrength
        ? `Repeated strength: ${topStrength}. Repeated coaching priority: ${topPriority}.`
        : topPriority
          ? `Repeated coaching priority: ${topPriority}.`
          : null,
    facts: {
      subject: user.email,
      activityLevel:
        user.simulationsLast30Days === 0 ? "none" : user.scoredAttemptsLast30Days < MIN_USER_COMPARISON_SCORED_ATTEMPTS ? "light" : "active",
      evidenceLevel:
        user.scoredAttemptsLast30Days === 0 ? "none" : user.scoredAttemptsLast30Days < MIN_USER_COMPARISON_SCORED_ATTEMPTS ? "limited" : "developing",
      volumeLabel: `${user.simulationsLast30Days} simulations across ${user.uniqueScenariosLast30Days} scenarios`,
      focusLabel: dominantTraining ?? dominantScenario ?? null,
      watchLabel: topPriority,
    },
  };
}
