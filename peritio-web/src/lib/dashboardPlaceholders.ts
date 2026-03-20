import { DashboardCustomerSummary } from "@voicepractice/shared";

export interface PlaceholderTrendPoint {
  label: string;
  usageMinutes: number;
  averageScore: number;
}

export interface PlaceholderTrainingPack {
  id: string;
  customerId: string;
  customerName: string;
  title: string;
  programWindow: string;
  status: "live" | "scheduled" | "completed";
  participants: number;
  completionRate: number;
  averageScore: number;
  scenarioIds: string[];
  goal: string;
}

export interface PlaceholderUserRow {
  id: string;
  customerId: string;
  customerName: string;
  name: string;
  roleTitle: string;
  orgRoleLabel: string;
  simulationsCompleted: number;
  completionRate: number;
  averageScore: number;
  scoreDelta: number;
  focusArea: string;
  strength: string;
  lastScenarioId: string;
}

export interface PlaceholderScenarioRow {
  id: string;
  customerId: string;
  customerName: string;
  title: string;
  segmentLabel: string;
  trainingPackId: string;
  companyAttempts: number;
  activeLearners: number;
  companyAverageScore: number;
  scoreDelta: number;
  topIssue: string;
  topUserId: string;
  summary: string;
}

export interface PlaceholderCustomerDetail {
  customer: DashboardCustomerSummary;
  industryLabel: string;
  accountWindow: string;
  engagementLabel: string;
  accountLead: string;
  topSkillGain: string;
  coachingPriority: string;
  trend: PlaceholderTrendPoint[];
  notes: string[];
  trainingPacks: PlaceholderTrainingPack[];
  users: PlaceholderUserRow[];
  scenarios: PlaceholderScenarioRow[];
}

export interface PlaceholderOverview {
  activeCustomers: number;
  activeUsers: number;
  monthlyUsageMinutes: number;
  averageScore: number;
  scoreDelta: number;
  liveTrainingPrograms: number;
  simulationsLast30Days: number;
}

const COACHING_PRIORITIES = [
  "Closing conversations with firmer ownership",
  "Reducing overexplaining before the clear ask",
  "Leading with business impact sooner",
  "Holding the standard without sounding rigid",
];

const SKILL_GAINS = [
  "De-escalation and tone control",
  "Objection handling clarity",
  "Confidence under pushback",
  "Clear next-step framing",
];

const USER_FOCUS_AREAS = [
  "Clarifying the next step earlier",
  "Asking sharper follow-up questions",
  "Holding the line without overexplaining",
  "Summarizing the decision at close",
];

const USER_STRENGTHS = [
  "Calm tone under pressure",
  "Empathy in difficult moments",
  "Direct and concise framing",
  "Strong recap discipline",
];

const SCENARIO_TITLES = [
  "High-stakes stakeholder pushback",
  "Late-stage objection recovery",
  "Reset a tense team conversation",
  "Re-anchor the discussion on outcomes",
];

const SEGMENT_LABELS = ["Leadership", "Sales", "Management", "Customer-facing"];

const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short" });
const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

function makeSeed(value: string): number {
  let seed = 0;
  for (const character of value) {
    seed = (seed * 31 + character.charCodeAt(0)) % 1_000_003;
  }

  return seed;
}

function pickFromList(items: string[], seed: number, index: number): string {
  return items[(seed + index) % items.length] ?? items[0] ?? "";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function titleCaseToken(token: string): string {
  return token
    .split(/[\W_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? email;
  return titleCaseToken(localPart);
}

function orgRoleLabel(orgRole: string): string {
  if (orgRole === "org_admin") {
    return "Org Admin";
  }

  if (orgRole === "user_admin") {
    return "User Admin";
  }

  return "User";
}

function roleTitleFromOrgRole(orgRole: string, industryLabel: string): string {
  if (orgRole === "org_admin") {
    return `${industryLabel} Lead`;
  }

  if (orgRole === "user_admin") {
    return `${industryLabel} Manager`;
  }

  return `${industryLabel} User`;
}

function monthLabel(date: Date, offsetMonths: number): string {
  const target = new Date(date.getFullYear(), date.getMonth() + offsetMonths, 1);
  return MONTH_FORMATTER.format(target);
}

function monthYearLabel(isoDate: string): string {
  const parsed = new Date(isoDate);
  return MONTH_YEAR_FORMATTER.format(parsed);
}

export function buildCustomerPlaceholderDetail(customer: DashboardCustomerSummary): PlaceholderCustomerDetail {
  const seed = makeSeed(customer.orgId);
  const industryLabel = customer.industryLabels[0] ?? "General";
  const scoreNow = customer.averageScoreThisPeriod ?? (68 + (seed % 12));
  const usageNow = customer.usedMinutesThisPeriod;
  const now = new Date();

  const trend: PlaceholderTrendPoint[] = [
    {
      label: monthLabel(now, -2),
      usageMinutes: Math.max(0, usageNow - (seed % 160) - 120),
      averageScore: clamp(scoreNow - 6, 55, 99),
    },
    {
      label: monthLabel(now, -1),
      usageMinutes: Math.max(0, usageNow - (seed % 90) - 40),
      averageScore: clamp(scoreNow - 3, 55, 99),
    },
    {
      label: monthLabel(now, 0),
      usageMinutes: usageNow,
      averageScore: clamp(scoreNow, 55, 99),
    },
  ];

  const trainingPacks: PlaceholderTrainingPack[] = [0, 1].map((index) => {
    const livePack = index === 0;
    const scenarioIds = [0, 1, 2].map((offset) => `${customer.orgId}-scenario-${index + 1}-${offset + 1}`);
    return {
      id: `${customer.orgId}-training-${index + 1}`,
      customerId: customer.orgId,
      customerName: customer.orgName,
      title: livePack ? `${industryLabel} Momentum Sprint` : `${industryLabel} Coaching Foundations`,
      programWindow: livePack ? monthYearLabel(new Date().toISOString()) : monthYearLabel(customer.createdAt),
      status: livePack ? "live" : "completed",
      participants: Math.max(1, customer.activeUserCount - index),
      completionRate: clamp(74 + (seed % 18) + index * 4, 0, 100),
      averageScore: clamp(scoreNow - (livePack ? 0 : 2), 55, 99),
      scenarioIds,
      goal: livePack
        ? `Drive stronger ${industryLabel.toLowerCase()} conversations and cleaner close discipline.`
        : `Build a measurable baseline for ${industryLabel.toLowerCase()} communication skills.`,
    };
  });

  const users: PlaceholderUserRow[] = customer.customerUsers.map((user, index) => {
    const userSeed = makeSeed(`${customer.orgId}:${user.userId}`);
    const averageScore = clamp(scoreNow - 6 + (userSeed % 11), 50, 99);
    const lastScenarioId = trainingPacks[index % trainingPacks.length]?.scenarioIds[index % 3] ?? `${customer.orgId}-scenario-1-1`;
    return {
      id: user.userId,
      customerId: customer.orgId,
      customerName: customer.orgName,
      name: displayNameFromEmail(user.email),
      roleTitle: roleTitleFromOrgRole(user.orgRole, industryLabel),
      orgRoleLabel: orgRoleLabel(user.orgRole),
      simulationsCompleted: 6 + (userSeed % 18),
      completionRate: clamp(70 + (userSeed % 26), 0, 100),
      averageScore,
      scoreDelta: 3 + (userSeed % 9),
      focusArea: pickFromList(USER_FOCUS_AREAS, userSeed, index),
      strength: pickFromList(USER_STRENGTHS, userSeed, index + 1),
      lastScenarioId,
    };
  });

  const scenarios: PlaceholderScenarioRow[] = [0, 1, 2].map((index) => {
    const scenarioSeed = makeSeed(`${customer.orgId}:scenario:${index}`);
    const topUser = users[index % Math.max(1, users.length)];
    const pack = trainingPacks[index % trainingPacks.length];
    return {
      id: `${customer.orgId}-scenario-${index + 1}`,
      customerId: customer.orgId,
      customerName: customer.orgName,
      title: pickFromList(SCENARIO_TITLES, seed, index),
      segmentLabel: pickFromList(SEGMENT_LABELS, seed, index),
      trainingPackId: pack.id,
      companyAttempts: Math.max(6, customer.simulationsLast30Days - index * 7),
      activeLearners: Math.max(1, customer.activeUserCount - index),
      companyAverageScore: clamp(scoreNow - 3 + (scenarioSeed % 7), 55, 99),
      scoreDelta: 2 + (scenarioSeed % 10),
      topIssue: pickFromList(USER_FOCUS_AREAS, scenarioSeed, index + 2),
      topUserId: topUser?.id ?? `${customer.orgId}-user-top`,
      summary: `This placeholder drilldown is already scoped to ${customer.orgName} and will be replaced with live scenario analytics next.`,
    };
  });

  return {
    customer,
    industryLabel,
    accountWindow: `${monthYearLabel(customer.createdAt)} - Present`,
    engagementLabel: `${industryLabel} reporting view`,
    accountLead: "Peritio",
    topSkillGain: pickFromList(SKILL_GAINS, seed, 0),
    coachingPriority: pickFromList(COACHING_PRIORITIES, seed, 1),
    trend,
    notes: [
      `${customer.orgName} has ${customer.activeUserCount} active dashboard-eligible users in scope.`,
      `This account view is already tied to the real organization record and user membership model.`,
    ],
    trainingPacks,
    users,
    scenarios,
  };
}

export function buildDashboardOverview(customers: DashboardCustomerSummary[]): PlaceholderOverview {
  const activeCustomers = customers.length;
  const activeUsers = customers.reduce((total, customer) => total + customer.activeUserCount, 0);
  const monthlyUsageMinutes = customers.reduce((total, customer) => total + customer.usedMinutesThisPeriod, 0);
  const averageScoreCandidates = customers
    .map((customer) => customer.averageScoreThisPeriod)
    .filter((score): score is number => typeof score === "number");
  const averageScore =
    averageScoreCandidates.length > 0
      ? Math.round(averageScoreCandidates.reduce((total, score) => total + score, 0) / averageScoreCandidates.length)
      : 0;
  const liveTrainingPrograms = customers.length;
  const simulationsLast30Days = customers.reduce((total, customer) => total + customer.simulationsLast30Days, 0);

  return {
    activeCustomers,
    activeUsers,
    monthlyUsageMinutes,
    averageScore,
    scoreDelta: activeCustomers > 0 ? 6 + (activeUsers % 7) : 0,
    liveTrainingPrograms,
    simulationsLast30Days,
  };
}

export function listPlaceholderTrainingPrograms(customers: DashboardCustomerSummary[]): PlaceholderTrainingPack[] {
  return customers.flatMap((customer) => buildCustomerPlaceholderDetail(customer).trainingPacks);
}

export function listPlaceholderUsers(customers: DashboardCustomerSummary[]): PlaceholderUserRow[] {
  return customers.flatMap((customer) => buildCustomerPlaceholderDetail(customer).users);
}

export function listPlaceholderScenarioSignals(customers: DashboardCustomerSummary[]): PlaceholderScenarioRow[] {
  return customers.flatMap((customer) => buildCustomerPlaceholderDetail(customer).scenarios);
}
