import type {
  DashboardCoachingInsights,
  DashboardCustomerScenarioSummary,
  DashboardCustomerSummary,
  DashboardOverviewResponse,
  DashboardPortfolioScenarioSummary,
  DashboardTrainingWorkspaceResponse,
  DashboardTrainingWorkspaceRow,
  DashboardTrainingWorkspaceScenarioRow,
  DashboardTrainingWorkspaceUserRow,
  DashboardUserReportResponse,
  DashboardUserReportRow,
  DashboardViewer,
  OrgTrainingStatus,
  OrgUserRole,
  UserStatus,
} from "@voicepractice/shared";

export const DASHBOARD_DEMO_ACCOUNT_ID = "demo_sampleco_training";

const DEMO_CREATED_AT = "2026-02-03T15:00:00.000Z";
const DEMO_UPDATED_AT = "2026-06-11T19:20:00.000Z";
const DEMO_LAST_ACTIVITY_AT = "2026-06-11T19:20:00.000Z";
const DEMO_RENEWAL_AT = "2027-04-30T23:59:59.000Z";
const DEMO_MONTHLY_MINUTES_ALLOTTED = 3600;
const DEMO_USED_MINUTES_THIS_PERIOD = 2840;

interface DemoUserSeed {
  name: string;
  email: string;
  status: UserStatus;
  orgRole: OrgUserRole;
  dashboardAccessEnabled: boolean;
  simulationsLast30Days: number;
  usedMinutesLast30Days: number;
  averageScoreLast30Days: number | null;
  latestActivityAt: string | null;
  lastScenarioTitle: string | null;
}

const DEMO_USER_SEEDS: DemoUserSeed[] = [
  {
    name: "Avery Morgan",
    email: "avery.morgan@sampleco.test",
    status: "active",
    orgRole: "org_admin",
    dashboardAccessEnabled: true,
    simulationsLast30Days: 24,
    usedMinutesLast30Days: 240,
    averageScoreLast30Days: 88,
    latestActivityAt: "2026-06-11T19:20:00.000Z",
    lastScenarioTitle: "Executive Renewal Risk",
  },
  {
    name: "Jordan Lee",
    email: "jordan.lee@sampleco.test",
    status: "active",
    orgRole: "user_admin",
    dashboardAccessEnabled: true,
    simulationsLast30Days: 22,
    usedMinutesLast30Days: 214,
    averageScoreLast30Days: 86,
    latestActivityAt: "2026-06-11T17:05:00.000Z",
    lastScenarioTitle: "Price Objection Renewal",
  },
  {
    name: "Priya Shah",
    email: "priya.shah@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 20,
    usedMinutesLast30Days: 198,
    averageScoreLast30Days: 84,
    latestActivityAt: "2026-06-10T22:45:00.000Z",
    lastScenarioTitle: "Discovery Call With Skeptical VP",
  },
  {
    name: "Marcus Bennett",
    email: "marcus.bennett@sampleco.test",
    status: "active",
    orgRole: "user_admin",
    dashboardAccessEnabled: true,
    simulationsLast30Days: 19,
    usedMinutesLast30Days: 186,
    averageScoreLast30Days: 83,
    latestActivityAt: "2026-06-10T20:15:00.000Z",
    lastScenarioTitle: "Support Escalation Timing",
  },
  {
    name: "Elena Fischer",
    email: "elena.fischer@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 18,
    usedMinutesLast30Days: 174,
    averageScoreLast30Days: 85,
    latestActivityAt: "2026-06-10T18:30:00.000Z",
    lastScenarioTitle: "Clinical Intake Anxiety",
  },
  {
    name: "Noah Kim",
    email: "noah.kim@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 18,
    usedMinutesLast30Days: 169,
    averageScoreLast30Days: 82,
    latestActivityAt: "2026-06-09T21:10:00.000Z",
    lastScenarioTitle: "Follow-Up Clarity After Demo",
  },
  {
    name: "Sofia Ramirez",
    email: "sofia.ramirez@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 17,
    usedMinutesLast30Days: 158,
    averageScoreLast30Days: 84,
    latestActivityAt: "2026-06-09T19:30:00.000Z",
    lastScenarioTitle: "Customer Success Risk Check-In",
  },
  {
    name: "Taylor Chen",
    email: "taylor.chen@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 17,
    usedMinutesLast30Days: 155,
    averageScoreLast30Days: 81,
    latestActivityAt: "2026-06-09T16:05:00.000Z",
    lastScenarioTitle: "People Leader Coaching Specificity",
  },
  {
    name: "Maya Patel",
    email: "maya.patel@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 16,
    usedMinutesLast30Days: 146,
    averageScoreLast30Days: 86,
    latestActivityAt: "2026-06-08T22:00:00.000Z",
    lastScenarioTitle: "Summarizing Next Steps",
  },
  {
    name: "Liam Brooks",
    email: "liam.brooks@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 16,
    usedMinutesLast30Days: 142,
    averageScoreLast30Days: 80,
    latestActivityAt: "2026-06-08T18:40:00.000Z",
    lastScenarioTitle: "Support Escalation Timing",
  },
  {
    name: "Grace Turner",
    email: "grace.turner@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 15,
    usedMinutesLast30Days: 134,
    averageScoreLast30Days: 83,
    latestActivityAt: "2026-06-07T17:35:00.000Z",
    lastScenarioTitle: "Discovery Call With Skeptical VP",
  },
  {
    name: "Owen Reed",
    email: "owen.reed@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 15,
    usedMinutesLast30Days: 128,
    averageScoreLast30Days: 82,
    latestActivityAt: "2026-06-07T15:00:00.000Z",
    lastScenarioTitle: "Manager Feedback Session",
  },
  {
    name: "Hannah Park",
    email: "hannah.park@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 14,
    usedMinutesLast30Days: 121,
    averageScoreLast30Days: 79,
    latestActivityAt: "2026-06-06T20:15:00.000Z",
    lastScenarioTitle: "Concise Closing Practice",
  },
  {
    name: "Daniel Silva",
    email: "daniel.silva@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 14,
    usedMinutesLast30Days: 116,
    averageScoreLast30Days: 85,
    latestActivityAt: "2026-06-06T17:50:00.000Z",
    lastScenarioTitle: "Price Objection Renewal",
  },
  {
    name: "Chloe Martin",
    email: "chloe.martin@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 13,
    usedMinutesLast30Days: 108,
    averageScoreLast30Days: 84,
    latestActivityAt: "2026-06-05T21:30:00.000Z",
    lastScenarioTitle: "Clinical Intake Anxiety",
  },
  {
    name: "Natalie Brooks",
    email: "natalie.brooks@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 12,
    usedMinutesLast30Days: 102,
    averageScoreLast30Days: 81,
    latestActivityAt: "2026-06-05T19:15:00.000Z",
    lastScenarioTitle: "Customer Success Risk Check-In",
  },
  {
    name: "Ethan Ward",
    email: "ethan.ward@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 12,
    usedMinutesLast30Days: 96,
    averageScoreLast30Days: 80,
    latestActivityAt: "2026-06-04T22:05:00.000Z",
    lastScenarioTitle: "Follow-Up Clarity After Demo",
  },
  {
    name: "Amelia Grant",
    email: "amelia.grant@sampleco.test",
    status: "active",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 10,
    usedMinutesLast30Days: 84,
    averageScoreLast30Days: 82,
    latestActivityAt: "2026-06-04T16:45:00.000Z",
    lastScenarioTitle: "People Leader Coaching Specificity",
  },
  {
    name: "Victor Chen",
    email: "victor.chen@sampleco.test",
    status: "disabled",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 6,
    usedMinutesLast30Days: 62,
    averageScoreLast30Days: 78,
    latestActivityAt: "2026-06-02T18:20:00.000Z",
    lastScenarioTitle: "Manager Feedback Session",
  },
  {
    name: "Nina Alvarez",
    email: "nina.alvarez@sampleco.test",
    status: "disabled",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 5,
    usedMinutesLast30Days: 46,
    averageScoreLast30Days: 77,
    latestActivityAt: "2026-06-01T16:10:00.000Z",
    lastScenarioTitle: "Support Escalation Timing",
  },
  {
    name: "Caleb Wright",
    email: "caleb.wright@sampleco.test",
    status: "disabled",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 4,
    usedMinutesLast30Days: 36,
    averageScoreLast30Days: 76,
    latestActivityAt: "2026-05-30T21:00:00.000Z",
    lastScenarioTitle: "Discovery Call With Skeptical VP",
  },
  {
    name: "Leah Rosen",
    email: "leah.rosen@sampleco.test",
    status: "disabled",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 3,
    usedMinutesLast30Days: 25,
    averageScoreLast30Days: 75,
    latestActivityAt: "2026-05-29T18:45:00.000Z",
    lastScenarioTitle: "Summarizing Next Steps",
  },
  {
    name: "Samira Hassan",
    email: "samira.hassan@sampleco.test",
    status: "disabled",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 2,
    usedMinutesLast30Days: 0,
    averageScoreLast30Days: null,
    latestActivityAt: null,
    lastScenarioTitle: null,
  },
  {
    name: "Mateo Rivera",
    email: "mateo.rivera@sampleco.test",
    status: "disabled",
    orgRole: "user",
    dashboardAccessEnabled: false,
    simulationsLast30Days: 0,
    usedMinutesLast30Days: 0,
    averageScoreLast30Days: null,
    latestActivityAt: null,
    lastScenarioTitle: null,
  },
];

const DEMO_SCENARIOS: DashboardCustomerScenarioSummary[] = [
  {
    scenarioId: "demo_sampleco_scenario_discovery_vp",
    title: "Discovery Call With Skeptical VP",
    summary: "A buyer questions fit and wants proof before agreeing to a deeper evaluation.",
    segmentId: "sales_representative",
    segmentLabel: "Sales",
    source: "standard",
    attemptsLast30Days: 58,
    learnerCountLast30Days: 15,
    averageScoreLast30Days: 86,
    scoreDeltaLast30Days: 4.8,
    latestActivityAt: "2026-06-11T19:20:00.000Z",
    topUserEmail: "demo.admin@sampleco.test",
    topUserAverageScore: 91,
  },
  {
    scenarioId: "demo_sampleco_custom_renewal_objection",
    title: "Price Objection Renewal",
    summary: "A renewal sponsor is pushing for a discount and needs a value-based next step.",
    segmentId: "sales_representative",
    segmentLabel: "Sales",
    source: "custom",
    attemptsLast30Days: 47,
    learnerCountLast30Days: 13,
    averageScoreLast30Days: 84,
    scoreDeltaLast30Days: 5.1,
    latestActivityAt: "2026-06-11T17:05:00.000Z",
    topUserEmail: "jordan.lee@sampleco.test",
    topUserAverageScore: 88,
  },
  {
    scenarioId: "demo_sampleco_custom_support_escalation",
    title: "Support Escalation Timing",
    summary: "A frustrated customer needs empathy, ownership, and a clear escalation boundary.",
    segmentId: "support",
    segmentLabel: "Support",
    source: "custom",
    attemptsLast30Days: 42,
    learnerCountLast30Days: 11,
    averageScoreLast30Days: 82,
    scoreDeltaLast30Days: 2.7,
    latestActivityAt: "2026-06-10T20:15:00.000Z",
    topUserEmail: "marcus.bennett@sampleco.test",
    topUserAverageScore: 86,
  },
  {
    scenarioId: "demo_sampleco_custom_clinical_intake",
    title: "Clinical Intake Anxiety",
    summary: "An anxious patient needs calm intake questions, clear expectations, and next-step reassurance.",
    segmentId: "medical",
    segmentLabel: "Clinical Intake",
    source: "custom",
    attemptsLast30Days: 39,
    learnerCountLast30Days: 10,
    averageScoreLast30Days: 83,
    scoreDeltaLast30Days: 3.3,
    latestActivityAt: "2026-06-10T18:30:00.000Z",
    topUserEmail: "elena.fischer@sampleco.test",
    topUserAverageScore: 88,
  },
  {
    scenarioId: "demo_sampleco_scenario_manager_feedback",
    title: "Manager Feedback Session",
    summary: "A direct report needs candid feedback delivered with specificity and ownership.",
    segmentId: "people_management",
    segmentLabel: "People Leaders",
    source: "standard",
    attemptsLast30Days: 34,
    learnerCountLast30Days: 9,
    averageScoreLast30Days: 84,
    scoreDeltaLast30Days: 4.0,
    latestActivityAt: "2026-06-09T16:05:00.000Z",
    topUserEmail: "owen.reed@sampleco.test",
    topUserAverageScore: 87,
  },
  {
    scenarioId: "demo_sampleco_custom_risk_checkin",
    title: "Customer Success Risk Check-In",
    summary: "A customer success manager practices surfacing risk, aligning on priority, and clarifying ownership.",
    segmentId: "customer_success",
    segmentLabel: "Customer Success",
    source: "custom",
    attemptsLast30Days: 31,
    learnerCountLast30Days: 9,
    averageScoreLast30Days: 84,
    scoreDeltaLast30Days: 4.6,
    latestActivityAt: "2026-06-09T19:30:00.000Z",
    topUserEmail: "sofia.ramirez@sampleco.test",
    topUserAverageScore: 89,
  },
  {
    scenarioId: "demo_sampleco_custom_followup_clarity",
    title: "Follow-Up Clarity After Demo",
    summary: "A learner practices concise recap, stakeholder mapping, and a specific mutual action plan.",
    segmentId: "sales_engineer",
    segmentLabel: "Sales Engineering",
    source: "custom",
    attemptsLast30Days: 26,
    learnerCountLast30Days: 8,
    averageScoreLast30Days: 85,
    scoreDeltaLast30Days: 6.2,
    latestActivityAt: "2026-06-09T21:10:00.000Z",
    topUserEmail: "noah.kim@sampleco.test",
    topUserAverageScore: 90,
  },
  {
    scenarioId: "demo_sampleco_custom_coaching_specificity",
    title: "People Leader Coaching Specificity",
    summary: "A manager practices behavior-based coaching, clear expectations, and a follow-up commitment.",
    segmentId: "people_management",
    segmentLabel: "People Leaders",
    source: "custom",
    attemptsLast30Days: 20,
    learnerCountLast30Days: 7,
    averageScoreLast30Days: 81,
    scoreDeltaLast30Days: 1.9,
    latestActivityAt: "2026-06-08T18:40:00.000Z",
    topUserEmail: "taylor.chen@sampleco.test",
    topUserAverageScore: 85,
  },
  {
    scenarioId: "demo_sampleco_scenario_next_steps",
    title: "Summarizing Next Steps",
    summary: "A conversation needs a tight close, a decision path, and named follow-up owners.",
    segmentId: "project_manager",
    segmentLabel: "Operations",
    source: "standard",
    attemptsLast30Days: 15,
    learnerCountLast30Days: 6,
    averageScoreLast30Days: 80,
    scoreDeltaLast30Days: 0.8,
    latestActivityAt: "2026-06-07T15:00:00.000Z",
    topUserEmail: "maya.patel@sampleco.test",
    topUserAverageScore: 84,
  },
];

function buildTheme(themeId: string, theme: string, current: number, prior: number) {
  return {
    themeId,
    theme,
    countLast30Days: current,
    countPrior30Days: prior,
    deltaCount: current - prior,
  };
}

const DEMO_COACHING_INSIGHTS: DashboardCoachingInsights = {
  mode: "artifact_only",
  totalScoredAttemptsLast30Days: 246,
  artifactBackedScoresLast30Days: 232,
  artifactCoveragePercentLast30Days: 94.3,
  normalizedThemeScoresLast30Days: 226,
  normalizedThemeCoveragePercentLast30Days: 97.4,
  topImprovementAreas: [
    buildTheme("concise_closing", "Concise closing", 32, 24),
    buildTheme("escalation_timing", "Escalation timing", 29, 20),
    buildTheme("coaching_specificity", "Coaching specificity", 24, 18),
    buildTheme("summarizing_next_steps", "Summarizing next steps", 21, 17),
  ],
  topStrengths: [
    buildTheme("discovery_questions", "Discovery questions", 45, 31),
    buildTheme("empathy", "Empathy", 41, 29),
    buildTheme("follow_up_clarity", "Follow-up clarity", 35, 25),
    buildTheme("objection_handling", "Objection handling", 30, 21),
  ],
  topCoachingPriorities: [
    buildTheme("concise_closing", "Concise closing", 32, 24),
    buildTheme("escalation_timing", "Escalation timing", 29, 20),
    buildTheme("coaching_specificity", "Coaching specificity", 24, 18),
  ],
  repeatedFocusArea: "Concise closing",
};

const DEMO_SCORE_DELTAS = [
  7.2, 6.1, 5.8, 4.9, 4.3, 3.8, 3.6, 3.1, 2.8, 2.4, 2.2, 1.9, 1.3, 0.8, 0.5, 0.2, -0.6, -1.1, -1.8,
  -2.2, -2.9, -3.4, null, null,
] as const;

const DEMO_TRAINING_CONFIGS: Array<{
  id: string;
  name: string;
  status: OrgTrainingStatus;
  description: string;
  attachedTrainingPackIds: string[];
  attachedCustomScenarioIds: string[];
  summary: DashboardTrainingWorkspaceRow["summary"];
  insights: DashboardTrainingWorkspaceRow["insights"];
  scenarioIds: string[];
  userAttemptCounts: number[];
  createdAt: string;
  updatedAt: string;
}> = [
  {
    id: "demo_sampleco_training_sales_discovery",
    name: "Sales Discovery and Objection Handling",
    status: "active",
    description:
      "Sales and Customer Success teams practice discovery depth, pricing pushback, objection handling, and crisp follow-up.",
    attachedTrainingPackIds: ["demo_sampleco_pack_sales_discovery"],
    attachedCustomScenarioIds: [
      "demo_sampleco_custom_renewal_objection",
      "demo_sampleco_custom_risk_checkin",
      "demo_sampleco_custom_followup_clarity",
    ],
    summary: {
      totalAttemptsLast30Days: 132,
      averageScoreLast30Days: 85,
      activeLearnerCountLast30Days: 15,
      totalScenarioCount: 4,
      latestActivityAt: "2026-06-11T19:20:00.000Z",
    },
    insights: {
      strongestArea: { label: "Discovery questions", averageScoreLast30Days: 88 },
      weakestArea: { label: "Concise closing", averageScoreLast30Days: 78 },
      mostUsedScenario: {
        scenarioId: "demo_sampleco_scenario_discovery_vp",
        title: "Discovery Call With Skeptical VP",
        attemptsLast30Days: 58,
      },
      lowestPerformingScenario: {
        scenarioId: "demo_sampleco_custom_renewal_objection",
        title: "Price Objection Renewal",
        averageScoreLast30Days: 84,
      },
    },
    scenarioIds: [
      "demo_sampleco_scenario_discovery_vp",
      "demo_sampleco_custom_renewal_objection",
      "demo_sampleco_custom_risk_checkin",
      "demo_sampleco_custom_followup_clarity",
    ],
    userAttemptCounts: [14, 13, 12, 11, 10, 10, 9, 9, 8, 8, 7, 7, 6, 5, 2, 1],
    createdAt: "2026-02-05T16:30:00.000Z",
    updatedAt: DEMO_UPDATED_AT,
  },
  {
    id: "demo_sampleco_training_support_empathy",
    name: "Support Escalation and Empathy",
    status: "active",
    description:
      "Support and clinical intake teams practice calm escalation timing, empathy, and specific next-step ownership.",
    attachedTrainingPackIds: ["demo_sampleco_pack_support_empathy"],
    attachedCustomScenarioIds: [
      "demo_sampleco_custom_support_escalation",
      "demo_sampleco_custom_clinical_intake",
    ],
    summary: {
      totalAttemptsLast30Days: 96,
      averageScoreLast30Days: 82,
      activeLearnerCountLast30Days: 11,
      totalScenarioCount: 3,
      latestActivityAt: "2026-06-10T20:15:00.000Z",
    },
    insights: {
      strongestArea: { label: "Empathy", averageScoreLast30Days: 87 },
      weakestArea: { label: "Escalation timing", averageScoreLast30Days: 76 },
      mostUsedScenario: {
        scenarioId: "demo_sampleco_custom_support_escalation",
        title: "Support Escalation Timing",
        attemptsLast30Days: 42,
      },
      lowestPerformingScenario: {
        scenarioId: "demo_sampleco_custom_support_escalation",
        title: "Support Escalation Timing",
        averageScoreLast30Days: 82,
      },
    },
    scenarioIds: [
      "demo_sampleco_custom_support_escalation",
      "demo_sampleco_custom_clinical_intake",
      "demo_sampleco_scenario_next_steps",
    ],
    userAttemptCounts: [12, 11, 10, 9, 9, 8, 8, 7, 7, 5, 5, 5],
    createdAt: "2026-02-12T14:00:00.000Z",
    updatedAt: "2026-06-10T20:15:00.000Z",
  },
  {
    id: "demo_sampleco_training_people_leaders",
    name: "People Leader Coaching Conversations",
    status: "active",
    description:
      "People Leaders practice feedback, coaching specificity, summarizing next steps, and accountable follow-through.",
    attachedTrainingPackIds: ["demo_sampleco_pack_leaders_coaching"],
    attachedCustomScenarioIds: [
      "demo_sampleco_custom_coaching_specificity",
    ],
    summary: {
      totalAttemptsLast30Days: 68,
      averageScoreLast30Days: 84,
      activeLearnerCountLast30Days: 8,
      totalScenarioCount: 3,
      latestActivityAt: "2026-06-09T16:05:00.000Z",
    },
    insights: {
      strongestArea: { label: "Follow-up clarity", averageScoreLast30Days: 86 },
      weakestArea: { label: "Coaching specificity", averageScoreLast30Days: 79 },
      mostUsedScenario: {
        scenarioId: "demo_sampleco_scenario_manager_feedback",
        title: "Manager Feedback Session",
        attemptsLast30Days: 34,
      },
      lowestPerformingScenario: {
        scenarioId: "demo_sampleco_custom_coaching_specificity",
        title: "People Leader Coaching Specificity",
        averageScoreLast30Days: 81,
      },
    },
    scenarioIds: [
      "demo_sampleco_scenario_manager_feedback",
      "demo_sampleco_custom_coaching_specificity",
      "demo_sampleco_scenario_next_steps",
    ],
    userAttemptCounts: [10, 9, 8, 8, 7, 7, 6, 5, 4, 4],
    createdAt: "2026-03-01T18:00:00.000Z",
    updatedAt: "2026-06-09T16:05:00.000Z",
  },
  {
    id: "demo_sampleco_training_renewal_refresh",
    name: "Renewal Conversation Refresh",
    status: "archived",
    description: "A completed refresh for high-stakes renewal and executive sponsor conversations.",
    attachedTrainingPackIds: ["demo_sampleco_pack_renewal_refresh"],
    attachedCustomScenarioIds: ["demo_sampleco_custom_renewal_objection"],
    summary: {
      totalAttemptsLast30Days: 16,
      averageScoreLast30Days: 79,
      activeLearnerCountLast30Days: 5,
      totalScenarioCount: 2,
      latestActivityAt: "2026-06-02T18:20:00.000Z",
    },
    insights: {
      strongestArea: { label: "Objection handling", averageScoreLast30Days: 83 },
      weakestArea: { label: "Summarizing next steps", averageScoreLast30Days: 74 },
      mostUsedScenario: {
        scenarioId: "demo_sampleco_custom_renewal_objection",
        title: "Price Objection Renewal",
        attemptsLast30Days: 10,
      },
      lowestPerformingScenario: {
        scenarioId: "demo_sampleco_scenario_next_steps",
        title: "Summarizing Next Steps",
        averageScoreLast30Days: 80,
      },
    },
    scenarioIds: ["demo_sampleco_custom_renewal_objection", "demo_sampleco_scenario_next_steps"],
    userAttemptCounts: [3, 3, 2, 2, 2, 2, 1, 1],
    createdAt: "2026-02-20T16:00:00.000Z",
    updatedAt: "2026-05-20T16:00:00.000Z",
  },
];

function buildDemoCustomerFacingViewer(viewer: DashboardViewer): DashboardViewer {
  return {
    accessType: "customer_dashboard_user",
    userId: viewer.userId,
    email: viewer.email,
    isSuperUser: false,
    orgId: DASHBOARD_DEMO_ACCOUNT_ID,
    orgName: "SampleCo Training",
  };
}

function buildDemoUserReportRows(): DashboardUserReportRow[] {
  return DEMO_USER_SEEDS.map((seed, index): DashboardUserReportRow => {
    const scoredAttempts = seed.simulationsLast30Days > 0
      ? Math.max(0, seed.simulationsLast30Days - 3 + (index < 2 ? 1 : 0))
      : 0;
    const latestTrainingPackTitle =
      seed.lastScenarioTitle === "Support Escalation Timing" || seed.lastScenarioTitle === "Clinical Intake Anxiety"
        ? "Support Escalation and Empathy"
        : seed.lastScenarioTitle === "Manager Feedback Session" ||
            seed.lastScenarioTitle === "People Leader Coaching Specificity" ||
            seed.lastScenarioTitle === "Summarizing Next Steps"
          ? "People Leader Coaching Conversations"
          : seed.lastScenarioTitle === "Executive Renewal Risk"
            ? "Renewal Conversation Refresh"
            : "Sales Discovery and Objection Handling";

    return {
      userId: `demo_sampleco_user_${String(index + 1).padStart(2, "0")}`,
      email: seed.email,
      orgId: DASHBOARD_DEMO_ACCOUNT_ID,
      orgName: "SampleCo Training",
      status: seed.status,
      orgRole: seed.orgRole,
      dashboardAccessEnabled: seed.dashboardAccessEnabled,
      simulationsLast30Days: seed.simulationsLast30Days,
      usedMinutesLast30Days: seed.usedMinutesLast30Days,
      scoredAttemptsLast30Days: scoredAttempts,
      averageScoreLast30Days: seed.averageScoreLast30Days,
      scoreDeltaLast30Days: DEMO_SCORE_DELTAS[index] ?? null,
      uniqueScenariosLast30Days: seed.simulationsLast30Days > 0 ? Math.min(7, Math.max(1, Math.ceil(seed.simulationsLast30Days / 4))) : 0,
      trainingPackAttemptsLast30Days: seed.simulationsLast30Days > 0 ? Math.max(0, seed.simulationsLast30Days - 2) : 0,
      latestActivityAt: seed.latestActivityAt,
      latestScenarioTitle: seed.lastScenarioTitle,
      latestTrainingPackTitle,
    };
  });
}

function buildTrainingUsers(userAttemptCounts: number[], trainingIndex: number): DashboardTrainingWorkspaceUserRow[] {
  const reportRows = buildDemoUserReportRows();
  return userAttemptCounts.map((attemptsLast30Days, index): DashboardTrainingWorkspaceUserRow => {
    const user = reportRows[index] ?? reportRows[0]!;
    const latestScenario = DEMO_TRAINING_CONFIGS[trainingIndex]?.scenarioIds[index % DEMO_TRAINING_CONFIGS[trainingIndex].scenarioIds.length];
    const scenarioTitle = DEMO_SCENARIOS.find((scenario) => scenario.scenarioId === latestScenario)?.title ?? user.latestScenarioTitle;

    return {
      userId: user.userId,
      email: user.email,
      orgId: DASHBOARD_DEMO_ACCOUNT_ID,
      orgName: "SampleCo Training",
      status: user.status,
      orgRole: user.orgRole,
      attemptsLast30Days,
      averageScoreLast30Days:
        user.averageScoreLast30Days === null ? null : Math.max(68, Math.min(94, user.averageScoreLast30Days + (trainingIndex === 0 ? 1 : 0))),
      latestActivityAt: user.latestActivityAt,
      latestScenarioTitle: scenarioTitle,
    };
  });
}

function buildTrainingScenarios(scenarioIds: string[]): DashboardTrainingWorkspaceScenarioRow[] {
  return scenarioIds.map((scenarioId): DashboardTrainingWorkspaceScenarioRow => {
    const scenario = DEMO_SCENARIOS.find((entry) => entry.scenarioId === scenarioId);
    return {
      scenarioId,
      title: scenario?.title ?? scenarioId,
      segmentId: scenario?.segmentId ?? "demo",
      segmentLabel: scenario?.segmentLabel ?? "Demo",
      source: scenario?.source ?? "custom",
      attemptsLast30Days: scenario?.attemptsLast30Days ?? 0,
      averageScoreLast30Days: scenario?.averageScoreLast30Days ?? null,
      latestActivityAt: scenario?.latestActivityAt ?? null,
    };
  });
}

function buildDemoTrainingWorkspaceRows(): DashboardTrainingWorkspaceRow[] {
  return DEMO_TRAINING_CONFIGS.map((training, index): DashboardTrainingWorkspaceRow => ({
    id: training.id,
    orgId: DASHBOARD_DEMO_ACCOUNT_ID,
    orgName: "SampleCo Training",
    name: training.name,
    status: training.status,
    description: training.description,
    divisionId: null,
    createdAt: training.createdAt,
    updatedAt: training.updatedAt,
    attachedTrainingPackIds: training.attachedTrainingPackIds,
    attachedCustomScenarioIds: training.attachedCustomScenarioIds,
    attachedTrainingPackCount: training.attachedTrainingPackIds.length,
    attachedCustomScenarioCount: training.attachedCustomScenarioIds.length,
    summary: training.summary,
    insights: training.insights,
    users: buildTrainingUsers(training.userAttemptCounts, index),
    scenarios: buildTrainingScenarios(training.scenarioIds),
  }));
}

export function isDashboardDemoAccountId(accountId: string): boolean {
  return accountId === DASHBOARD_DEMO_ACCOUNT_ID;
}

export function canDashboardViewerAccessDemoAccount(viewer: DashboardViewer): boolean {
  return viewer.accessType === "super_user" && viewer.isSuperUser === true;
}

export function buildDashboardDemoCustomerSummary(): DashboardCustomerSummary {
  return {
    orgId: DASHBOARD_DEMO_ACCOUNT_ID,
    orgName: "SampleCo Training",
    orgStatus: "active",
    contactName: "Avery Morgan",
    contactEmail: "avery.morgan@sampleco.test",
    industryLabels: ["Sales", "Customer Success", "People Leaders", "Clinical Intake", "Support"],
    createdAt: DEMO_CREATED_AT,
    nextRenewalAt: DEMO_RENEWAL_AT,
    monthlyMinutesAllotted: DEMO_MONTHLY_MINUTES_ALLOTTED,
    activeUserCount: 18,
    totalUserCount: 24,
    dashboardUserCount: 4,
    simulationsLast30Days: 312,
    usedMinutesThisPeriod: DEMO_USED_MINUTES_THIS_PERIOD,
    averageScoreThisPeriod: 84,
    scoreDeltaLast30Days: 5.2,
    trainingPackCount: 4,
    activeTrainingPackCount: 3,
    customScenarioCount: 7,
    latestActivityAt: DEMO_LAST_ACTIVITY_AT,
    customerUserEmails: DEMO_USER_SEEDS.map((seed) => seed.email),
  };
}

export function buildDashboardDemoOverview(viewer: DashboardViewer): DashboardOverviewResponse {
  const customer = buildDashboardDemoCustomerSummary();
  const demoViewer = buildDemoCustomerFacingViewer(viewer);
  const topScenarios: DashboardPortfolioScenarioSummary[] = DEMO_SCENARIOS.slice(0, 6).map((scenario) => ({
    ...scenario,
    orgId: DASHBOARD_DEMO_ACCOUNT_ID,
    orgName: "SampleCo Training",
  }));

  return {
    viewer: demoViewer,
    summary: {
      activeCustomers: 1,
      activeUsers: 18,
      dashboardUsers: 4,
      monthlyUsageMinutes: DEMO_USED_MINUTES_THIS_PERIOD,
      simulationsLast30Days: 312,
      averageScoreThisPeriod: 84,
      activeTrainingPackCount: 3,
      customScenarioCount: 7,
    },
    customers: [customer],
    topScenarios,
    trainingPackAttribution: {
      mode: "forward_only",
      attributedUsageSessionsLast30Days: 286,
      unattributedUsageSessionsLast30Days: 26,
      attributedScoresLast30Days: 232,
      unattributedScoresLast30Days: 14,
    },
    coachingInsights: DEMO_COACHING_INSIGHTS,
  };
}

export function buildDashboardDemoTrainingWorkspace(viewer: DashboardViewer): DashboardTrainingWorkspaceResponse {
  return {
    viewer: buildDemoCustomerFacingViewer(viewer),
    generatedAt: DEMO_LAST_ACTIVITY_AT,
    trainings: buildDemoTrainingWorkspaceRows(),
  };
}

export function buildDashboardDemoUserReport(viewer: DashboardViewer): DashboardUserReportResponse {
  const users = buildDemoUserReportRows();
  return {
    viewer: buildDemoCustomerFacingViewer(viewer),
    summary: {
      userCount: users.length,
      activeUserCount: users.filter((user) => user.status === "active").length,
      dashboardUserCount: users.filter((user) => user.dashboardAccessEnabled).length,
      simulationsLast30Days: users.reduce((total, user) => total + user.simulationsLast30Days, 0),
      averageScoreLast30Days: 84,
    },
    users,
  };
}
