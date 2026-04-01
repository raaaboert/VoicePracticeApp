import type {
  DashboardAttemptDetailResponse,
  DashboardAttemptHistoryRow,
  EnterpriseOrg,
  SimulationScoreRecord,
  TrainingPackAssignmentRecord,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";

export interface DashboardAttemptScenarioCatalogEntry {
  scenarioId: string;
  title: string;
  summary: string | null;
  segmentId: string;
  segmentLabel: string;
  source: "standard" | "custom";
}

export function resolveDashboardAttemptActivityAssignmentStatus(params: {
  assignment: TrainingPackAssignmentRecord | null;
  activityAt: string;
  scenarioId: string;
  isScored: boolean;
}): DashboardAttemptHistoryRow["assignmentContextStatus"] {
  const { assignment, activityAt, scenarioId, isScored } = params;
  if (!assignment) {
    return "not_assignment_scoped";
  }

  const assignedAtMs = new Date(assignment.assignedAt).getTime();
  const activityAtMs = new Date(activityAt).getTime();
  if (!Number.isFinite(activityAtMs) || activityAtMs < assignedAtMs) {
    return "outside_assignment_window";
  }

  if (isScored && assignment.requiredScenarioIds.includes(scenarioId)) {
    return "counts_toward_completion";
  }

  return "within_assignment_window";
}

export function buildDashboardAttemptHistoryRowFromScore(params: {
  score: SimulationScoreRecord;
  user: UserProfile;
  org: EnterpriseOrg | null;
  scenarioCatalog: ReadonlyMap<string, DashboardAttemptScenarioCatalogEntry>;
  trainingPackTitles: ReadonlyMap<string, string>;
  relatedSession: UsageSessionRecord | null;
  assignment: TrainingPackAssignmentRecord | null;
}): DashboardAttemptHistoryRow {
  const { score, user, org, scenarioCatalog, trainingPackTitles, relatedSession, assignment } = params;
  const scenarioMeta = scenarioCatalog.get(score.scenarioId);

  return {
    activityId: score.id,
    activityKind: "scored_attempt",
    userId: user.id,
    userEmail: user.email,
    userStatus: user.status,
    orgId: org?.id ?? null,
    orgName: org?.name ?? null,
    scenarioId: score.scenarioId,
    scenarioTitle: scenarioMeta?.title ?? score.scenarioId,
    segmentId: score.segmentId,
    segmentLabel: scenarioMeta?.segmentLabel ?? score.segmentId,
    trainingPackId: score.trainingPackId ?? null,
    trainingPackTitle: score.trainingPackId ? trainingPackTitles.get(score.trainingPackId) ?? score.trainingPackId : null,
    packAttributed: Boolean(score.trainingPackId),
    assignmentId: assignment?.id ?? null,
    assignmentContextStatus: resolveDashboardAttemptActivityAssignmentStatus({
      assignment,
      activityAt: score.endedAt,
      scenarioId: score.scenarioId,
      isScored: true
    }),
    startedAt: score.startedAt,
    endedAt: score.endedAt,
    rawDurationSeconds: relatedSession?.rawDurationSeconds ?? null,
    overallScore: score.overallScore,
    summary: score.summary ?? null,
    coachingPriority: score.coachingArtifact?.coachingPriority ?? null,
    model: score.model ?? null,
    promptVersion: score.promptVersion ?? null,
    rubricVersion: score.rubricVersion ?? null
  };
}

export function deriveDashboardAttemptScoreSignals(
  record: SimulationScoreRecord
): DashboardAttemptDetailResponse["attempt"]["derivedSignals"] {
  const categories = [
    { key: "persuasion", label: "Persuasion", value: record.persuasion },
    { key: "clarity", label: "Clarity", value: record.clarity },
    { key: "empathy", label: "Empathy", value: record.empathy },
    { key: "assertiveness", label: "Assertiveness", value: record.assertiveness }
  ].sort((left, right) => right.value - left.value);

  const strongest = categories[0];
  const weakest = categories[categories.length - 1];
  return {
    strongestCategory: strongest?.label ?? null,
    weakestCategory: weakest?.label ?? null,
    coachingFocus: record.coachingArtifact?.coachingPriority ?? (weakest ? `Focus next on ${weakest.label.toLowerCase()}.` : null)
  };
}

export function buildDashboardAttemptDetailAttempt(params: {
  score: SimulationScoreRecord;
  user: UserProfile;
  org: EnterpriseOrg | null;
  scenarioCatalog: ReadonlyMap<string, DashboardAttemptScenarioCatalogEntry>;
  trainingPackTitles: ReadonlyMap<string, string>;
  industryLabelById: ReadonlyMap<string, string>;
  relatedSession: UsageSessionRecord | null;
  assignment: TrainingPackAssignmentRecord | null;
}): DashboardAttemptDetailResponse["attempt"] {
  const attempt = buildDashboardAttemptHistoryRowFromScore(params);
  const { score, industryLabelById } = params;

  return {
    ...attempt,
    industryId: score.industryId ?? null,
    industryLabel: score.industryId ? industryLabelById.get(score.industryId) ?? score.industryId : null,
    scoreBreakdown: {
      overallScore: score.overallScore,
      persuasion: score.persuasion,
      clarity: score.clarity,
      empathy: score.empathy,
      assertiveness: score.assertiveness
    },
    derivedSignals: deriveDashboardAttemptScoreSignals(score),
    coachingArtifact: score.coachingArtifact ?? null,
    transcriptAvailable: false
  };
}
