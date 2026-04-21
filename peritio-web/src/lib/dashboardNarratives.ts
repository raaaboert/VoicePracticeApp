import {
  DashboardCustomerDetailResponse,
  DashboardOverviewResponse,
  DashboardTrainingPackDetailResponse,
  DashboardTrainingWorkspaceRow,
  DashboardUserDetailResponse,
  DashboardUserReportResponse,
} from "@voicepractice/shared";

import { formatSignedPercent } from "@/src/lib/formatters";

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

export type DashboardNarrativePriorityTone = "primary" | "caution" | "watch";

export interface DashboardNarrativePriority {
  tone: DashboardNarrativePriorityTone;
  label: string;
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

function makePriority(
  tone: DashboardNarrativePriorityTone,
  title: string,
  detail: string
): DashboardNarrativePriority {
  return {
    tone,
    label: tone === "primary" ? "Primary takeaway" : tone === "caution" ? "Key caution" : "Watch next",
    title,
    detail,
  };
}

function buildMovementSummary(delta: number | null): string {
  if (delta === null) {
    return "Trend confidence is still limited.";
  }

  if (delta > 0) {
    return `The recent score signal is improving (${formatSignedPercent(delta)} versus the prior 30 days).`;
  }

  if (delta < 0) {
    return `The recent score signal has softened (${formatSignedPercent(delta)} versus the prior 30 days).`;
  }

  return "The recent score signal is flat versus the prior 30 days.";
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
      summary: "No training is selected. Choose one to review live activity, confidence, and supporting proof.",
      signals: compactSignals([
        { label: "Activity", value: "No training selected", context: "Choose a training above" },
      ]),
      priorities: compactPriorities([
        makePriority("primary", "Select a training", "Pick one training first. The dashboard only becomes meaningful once the scope is concrete."),
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

  const summary =
    totalAttempts === 0
      ? "This training is not getting real practice yet. Until activity shows up, the useful read is adoption rather than performance."
      : activeLearners <= 1
        ? joinSentences([
            "Practice is active, but still concentrated in one learner.",
            enoughFocusEvidence && strongestArea && weakestArea && strongestArea !== weakestArea
              ? `The score read is usable, but it is still being shaped mostly by activity in ${topScenario?.title ?? "a narrow scenario set"}.`
              : "It is too early to judge score movement confidently, so the safest read is where activity is appearing and where it is absent.",
          ])
        : totalAttempts >= 8 && activeLearners >= 2
          ? joinSentences([
              `This training has real repeat practice across ${activeLearners} learners.`,
              topScenario
                ? topScenarioShare >= 0.5
                  ? `${topScenario.title} is doing most of the work right now.`
                  : `${topScenario.title} is the clearest usage center, but practice is not stuck in one scenario.`
                : null,
              enoughFocusEvidence && strongestArea && weakestArea && strongestArea !== weakestArea
                ? `${strongestArea} is currently the clearest strength signal, while ${weakestArea} is the main weakness to watch.`
                : "Score coverage is still thin enough that activity breadth matters more than trend language.",
            ])
          : joinSentences([
              "Practice is visible, but still early.",
              topScenario ? `${topScenario.title} is the clearest activity center so far.` : "No single scenario is defining the training yet.",
              "For now, the safest conclusion is about where practice is showing up rather than whether performance is moving.",
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
        label: "Confidence",
        value: `${scoredScenarioCount}/${training.summary.totalScenarioCount} scenarios scored`,
        context: enoughFocusEvidence ? "Enough coverage for a cautious score read" : "Still too thin for a strong score read",
      },
      {
        label: "Focus",
        value: topScenario?.title ?? "No dominant scenario yet",
        context: topScenario ? `${topScenarioAttempts} recent attempts` : "Practice has not concentrated yet",
      },
    ]),
    priorities: compactPriorities([
      makePriority(
        "primary",
        topScenario ? "Practice is concentrating" : "Practice is still forming",
        topScenario
          ? `${topScenario.title} is the clearest center of gravity${topScenarioShare >= 0.5 ? " and is taking most of the recent volume" : ""}.`
          : "No single scenario is active enough yet to define how this training is really being used."
      ),
      makePriority(
        "caution",
        "Confidence is still limited",
        enoughFocusEvidence && strongestArea && weakestArea && strongestArea !== weakestArea
          ? `${strongestArea} looks strongest and ${weakestArea} weakest, but the scored evidence is still early enough to keep that read cautious.`
          : "There still are not enough completed scored attempts to treat the performance read as stable."
      ),
      makePriority(
        "watch",
        "Watch the quiet edge",
        underusedScenarioCount > 0
          ? `${underusedScenarioCount} ${pluralize(underusedScenarioCount, "scenario")} remain quiet, which is the clearest rollout gap in this training.`
          : lowestScenario
            ? `${lowestScenario} is the weakest scored scenario on current evidence and is the best next place to look.`
            : "The next useful question is whether practice broadens beyond the current active scenarios."
      ),
    ]),
    note: null,
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
      summary: "No meaningful user pattern is visible yet. Once practice starts, this page will separate effort from score-backed movement.",
      signals: compactSignals([
        { label: "Activity", value: "No recent attempts", context: "Last 30 days" },
        { label: "Confidence", value: "No comparison set", context: "Scored history has not formed yet" },
      ]),
      priorities: compactPriorities([
        makePriority(
          "primary",
          "Wait for live usage",
          "There is not enough user activity yet to say anything reliable beyond the absence of recent practice."
        ),
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
      ? `Practice is being carried by a small slice of users, led by ${mostEngaged.email}.`
      : "Practice is distributed across the visible users rather than resting on one person.",
    comparisonCount >= 2
      ? highlights.improvingUser
        ? `${highlights.improvingUser.email} shows the clearest upward score signal in the current comparable set.`
        : "A comparable score set is starting to form, but no one is separating clearly on improvement yet."
      : "Score comparisons are still thin, so the safest read is effort first and score movement second.",
    highlights.needsAttention && comparisonCount >= 2 && (highlights.needsAttention.scoreDeltaLast30Days ?? 0) < 0
      ? `${highlights.needsAttention.email} is the clearest coaching watchpoint right now.`
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
        label: "Confidence",
        value: `${comparisonCount} comparable users`,
        context: "At least 2 conclusive scored attempts each",
      },
      {
        label: "Engagement lead",
        value: mostEngaged?.email ?? "No clear leader",
        context: mostEngaged ? `${mostEngaged.simulationsLast30Days} recent simulations` : "Recent effort is still forming",
      },
    ]),
    priorities: compactPriorities([
      makePriority(
        "primary",
        "Effort is the main signal",
        mostEngaged
          ? `${mostEngaged.email} is setting the pace on recent practice and is the clearest engagement anchor in scope.`
          : "No single user is separating enough on effort to anchor the story yet."
      ),
      makePriority(
        "caution",
        "Do not overread score movement",
        comparisonCount >= 2
          ? highlights.improvingUser
            ? "There is enough history to name an early improvement leader, but the comparison set is still small."
            : "There is enough history for cautious comparison, but not enough separation to make a strong improvement claim."
          : "Most users still do not have enough scored history for a reliable movement read."
      ),
      makePriority(
        "watch",
        "Watch who needs follow-up",
        highlights.needsAttention && comparisonCount >= 2
          ? (highlights.needsAttention.scoreDeltaLast30Days ?? 0) < 0
            ? `${highlights.needsAttention.email} is the clearest coaching watchpoint because the recent score signal has softened.`
            : `${highlights.needsAttention.email} sits at the weaker end of the current comparable set and is worth closer review.`
          : "The next useful question is whether more users build enough scored history to make the comparison set real."
      ),
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
  const hasBroadTraction = activeTrainings.length >= 4 || (activeTrainings.length >= 2 && topTrainingShare < 0.6);

  if (totalAttempts === 0) {
    return {
      summary: "There is no meaningful traction yet. Without recent practice, this is still a rollout view rather than a performance view.",
      signals: compactSignals([
        { label: "Traction", value: "No recent attempts", context: "Last 30 days" },
        { label: "Breadth", value: "0 active trainings", context: "No training has recent usage" },
      ]),
      priorities: compactPriorities([
        makePriority(
          "primary",
          "No live traction",
          "This scope is still too quiet to judge adoption or performance. The next question is whether rollout is actually producing practice."
        ),
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

  const scoreRead =
    scoredAttemptsLast30Days < MIN_COMPANY_SCORE_EVIDENCE || comparisonUsers.length < 2
      ? "Score evidence is still thin, so the safest leadership read is adoption breadth rather than performance movement."
      : positiveMovementUsers > negativeMovementUsers
        ? "The early score signal is encouraging across the users who have enough comparable history."
        : negativeMovementUsers > positiveMovementUsers
          ? "The early score signal has softened across the comparable set and deserves leadership attention."
          : "The score signal is mixed, so any coaching action should stay targeted rather than broad.";

  const summary = hasBroadTraction
    ? joinSentences([
        "There is meaningful traction across the program.",
        "Usage is broad enough to look real rather than accidental.",
        scoreRead,
      ])
    : joinSentences([
        topTraining
          ? `There is real traction, but it is still narrow and centered on ${topTraining.name}.`
          : "There is visible usage, but it is still narrow.",
        "Leadership should read this as early rollout rather than broad adoption.",
        scoreRead,
      ]);

  return {
    summary,
    signals: compactSignals([
      {
        label: "Traction",
        value: `${totalAttempts} attempts / ${activeUsers} active users`,
        context: "Last 30 days",
      },
      {
        label: "Breadth",
        value: `${activeTrainings.length} active trainings`,
        context: `${params.trainings.length} trainings in scope`,
      },
      {
        label: "Confidence",
        value: `${comparisonUsers.length} comparable users`,
        context: scoredAttemptsLast30Days > 0 ? `${scoredAttemptsLast30Days} conclusive scored attempts` : "Scored history is still limited",
      },
    ]),
    priorities: compactPriorities([
      makePriority(
        "primary",
        hasBroadTraction ? "Traction is real" : "Traction is narrow",
        hasBroadTraction
          ? "Usage is spread across enough of the program to count as real traction rather than isolated activity."
          : topTraining
            ? `${topTraining.name} is carrying most of the current usage, so rollout breadth is still the main leadership question.`
            : "Usage exists, but not across enough of the program to treat it as broad adoption."
      ),
      makePriority(
        "caution",
        "Confidence depends on scored depth",
        scoredAttemptsLast30Days < MIN_COMPANY_SCORE_EVIDENCE || comparisonUsers.length < 2
          ? "The score read is still too thin to support a strong performance story."
          : positiveMovementUsers > negativeMovementUsers
            ? "The comparable user set leans positive, but the signal is still early rather than settled."
            : negativeMovementUsers > positiveMovementUsers
              ? "The comparable user set leans negative, which is a real caution signal for leadership."
              : "The comparable user set is mixed, so the safe move is focused coaching rather than broad conclusions."
      ),
      makePriority(
        "watch",
        "Leadership watchpoint",
        underusedActiveTrainings > 0
          ? `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} are still quiet, which is the clearest rollout gap.`
          : topScenario
            ? `${topScenario.title} is the strongest live scenario signal; watch whether usage broadens beyond that current center of gravity.`
            : "The next useful question is whether the current activity pattern broadens or stays narrow."
      ),
    ]),
    note: null,
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
      summary: "This account is not showing real usage yet. Until activity appears, this is a rollout-readiness page more than a performance page.",
      signals: compactSignals([
        { label: "Activity", value: "No recent simulations", context: "Last 30 days" },
        { label: "Confidence", value: "No score signal", context: "Scored history has not formed yet" },
      ]),
      priorities: compactPriorities([
        makePriority(
          "primary",
          "No live account traction",
          "The next useful question is whether the account is configured but idle, or whether rollout has not really started."
        ),
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
    activeTrainingRows.length === 1 || topTrainingShare >= 0.6
      ? topTraining
        ? `This account is active, but usage is still concentrated in ${topTraining.title}.`
        : "This account is active, but usage is still narrow."
      : "This account has real usage across more than one training area.",
    totalScoredAttemptsLast30Days < MIN_CUSTOMER_SCORE_EVIDENCE
      ? "The score read is still early, so the safest conclusion is about adoption and focus rather than performance movement."
      : buildMovementSummary(customer.scoreDeltaLast30Days),
    underusedActiveTrainings > 0
      ? `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} remain quiet, which is the clearest rollout gap.`
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
        label: "Confidence",
        value: `${totalScoredAttemptsLast30Days} scored attempts`,
        context:
          totalScoredAttemptsLast30Days >= MIN_CUSTOMER_SCORE_EVIDENCE
            ? "Enough volume for a cautious score read"
            : "Still too thin for a strong score read",
      },
      {
        label: "Focus",
        value: topTraining?.title ?? topScenario?.title ?? "No dominant focus yet",
        context: topTraining ? "Most active training" : topScenario ? "Most active scenario" : "Usage is still forming",
      },
    ]),
    priorities: compactPriorities([
      makePriority(
        "primary",
        "Account traction",
        topTraining
          ? `The account is active, and ${topTraining.title} is the clearest center of gravity right now.`
          : "The account is active, but no single training area has separated clearly yet."
      ),
      makePriority(
        "caution",
        "Score confidence stays limited",
        totalScoredAttemptsLast30Days < MIN_CUSTOMER_SCORE_EVIDENCE
          ? "Keep the score story cautious until the recent conclusive attempt count is larger."
          : buildMovementSummary(customer.scoreDeltaLast30Days)
      ),
      makePriority(
        "watch",
        "Account watchpoint",
        underusedActiveTrainings > 0
          ? `${underusedActiveTrainings} active ${pluralize(underusedActiveTrainings, "training")} remain quiet and deserve rollout attention.`
          : insights.coachingInsights.repeatedFocusArea
            ? `${insights.coachingInsights.repeatedFocusArea} is the strongest repeated coaching theme in the current artifact-backed record.`
            : "The next useful question is whether the current activity pattern broadens or stays narrow."
      ),
    ]),
    note: null,
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

  const summary =
    pack.attemptsLast30Days === 0
      ? "This pack is assigned, but it is not producing real recent practice yet. Until that changes, the only useful read is rollout."
      : joinSentences([
          scoredAttempts < MIN_PACK_SCORE_EVIDENCE
            ? "This pack is active, but the score read is still early."
            : (pack.scoreDeltaLast30Days ?? 0) > 0
              ? "This pack is active and the recent score signal is moving the right way."
              : (pack.scoreDeltaLast30Days ?? 0) < 0
                ? "This pack is active, but the recent score signal has softened."
                : "This pack is active, but the score signal is still mixed.",
          `${pack.startedLearnerCount} of ${pack.assignedLearnerCount} assigned ${pluralize(pack.assignedLearnerCount, "learner")} have started.`,
          mostUsedScenario
            ? `${mostUsedScenario.title} is the clearest current practice center.`
            : "No single required scenario is defining the pack yet.",
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
        label: "Confidence",
        value: `${scoredAttempts} scored attempts`,
        context: scoredAttempts >= MIN_PACK_SCORE_EVIDENCE ? "Enough for a cautious score read" : "Still too thin for a trend call",
      },
      {
        label: "Focus",
        value: mostUsedScenario?.title ?? "No dominant scenario",
        context: mostUsedScenario ? `${mostUsedScenario.attemptsLast30Days} recent attempts` : "Recent practice is still dispersed",
      },
    ]),
    priorities: compactPriorities([
      makePriority(
        "primary",
        "Adoption is the first read",
        `${pack.startedLearnerCount} of ${pack.assignedLearnerCount} assigned learners have started, so the main question is still adoption depth before anything else.`
      ),
      makePriority(
        "caution",
        "Performance is still early",
        scoredAttempts >= MIN_PACK_SCORE_EVIDENCE
          ? buildMovementSummary(pack.scoreDeltaLast30Days)
          : "Score direction is still too thin to treat as stable."
      ),
      makePriority(
        "watch",
        "Watch the coverage gap",
        neglectedRequiredScenarios > 0
          ? `${neglectedRequiredScenarios} required ${pluralize(neglectedRequiredScenarios, "scenario")} remain quiet and are the clearest next follow-up.`
          : "The next useful question is whether repeat practice deepens inside the active scenarios."
      ),
    ]),
    note: pack.coachingInsights.repeatedFocusArea
      ? `${pack.coachingInsights.repeatedFocusArea} is the strongest repeated coaching theme in artifact-backed pack scoring.`
      : null,
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

  const summary =
    user.simulationsLast30Days === 0
      ? "This user has no recent visible practice in the current scope. There is nothing reliable to conclude yet beyond the lack of recent activity."
      : user.scoredAttemptsLast30Days < MIN_USER_COMPARISON_SCORED_ATTEMPTS
        ? joinSentences([
            "This user is practicing, but the scored history is still thin.",
            dominantTraining || dominantScenario
              ? `The safest read is current focus${dominantTraining ? ` in ${dominantTraining}` : ""}${dominantScenario ? `${dominantTraining ? " and" : " in"} ${dominantScenario}` : ""}.`
              : "The safest read is current effort rather than improvement.",
            topPriority ? `${topPriority} is the clearest coaching theme to keep in view.` : null,
          ])
        : (user.scoreDeltaLast30Days ?? 0) > 0
          ? joinSentences([
              "This user is practicing consistently and the recent score signal is moving the right way.",
              dominantTraining || dominantScenario
                ? `Most recent scored practice is centered on ${dominantTraining ?? dominantScenario}.`
                : null,
              topStrength && topPriority
                ? `${topStrength} is the clearest repeated strength, while ${topPriority} remains the main coaching need.`
                : topPriority
                  ? `${topPriority} remains the clearest coaching need.`
                  : null,
            ])
          : (user.scoreDeltaLast30Days ?? 0) < 0
            ? joinSentences([
                "This user is still active, but the recent score signal has softened.",
                dominantTraining || dominantScenario
                  ? `Most recent scored practice is centered on ${dominantTraining ?? dominantScenario}.`
                  : null,
                topPriority ? `${topPriority} is the coaching theme that matters most right now.` : "That makes coaching detail more important than the current average score.",
              ])
            : joinSentences([
                "This user is practicing, but the performance signal is still inconclusive.",
                dominantTraining || dominantScenario
                  ? `Most recent scored practice is centered on ${dominantTraining ?? dominantScenario}.`
                  : null,
                topPriority ? `${topPriority} is the clearest coaching theme currently repeating.` : null,
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
        label: "Confidence",
        value: `${user.scoredAttemptsLast30Days} scored attempts`,
        context:
          user.scoredAttemptsLast30Days >= MIN_USER_COMPARISON_SCORED_ATTEMPTS
            ? "Enough for a cautious movement read"
            : "Still too thin for a trend call",
      },
      {
        label: "Focus",
        value: dominantTraining ?? dominantScenario ?? user.latestScenarioTitle ?? "No dominant focus yet",
        context: dominantTraining ? "Most frequent recent training" : dominantScenario ? "Most frequent recent scenario" : "Latest visible activity",
      },
    ]),
    priorities: compactPriorities([
      makePriority(
        "primary",
        "The clearest positive signal",
        topStrength
          ? `${topStrength} is the strongest repeated positive pattern in the artifact-backed coaching record.`
          : user.simulationsLast30Days > 0
            ? "The most reliable positive signal right now is continued practice rather than a repeated strength theme."
            : "There is not enough recent activity to point to a positive signal yet."
      ),
      makePriority(
        "caution",
        "The main coaching caution",
        topPriority
          ? `${topPriority} is the clearest repeated coaching need in the visible history.`
          : user.scoredAttemptsLast30Days < MIN_USER_COMPARISON_SCORED_ATTEMPTS
            ? "The scored history is still too thin to make a strong coaching call."
            : "No repeated coaching theme is strong enough yet to outrank the broader activity picture."
      ),
      makePriority(
        "watch",
        "What to watch next",
        assignments.length > 0
          ? `${startedAssignments} of ${assignments.length} active ${pluralize(assignments.length, "assignment")} have been started, so the next useful question is whether practice converts into assignment progress.`
          : dominantTraining || dominantScenario
            ? `Watch whether practice keeps deepening in ${dominantTraining ?? dominantScenario} or starts to broaden out.`
            : "Watch whether a clearer practice focus emerges before trying to call a trend."
      ),
    ]),
    note: null,
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
