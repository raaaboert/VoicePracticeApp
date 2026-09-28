import type { DashboardViewer } from "@voicepractice/shared";

import { isCurrentDashboardEligibleActor } from "./authorizedPerformanceEvidenceQuery.js";
import { canDashboardViewerAccessOrg } from "./dashboardAuthorization.js";
import { canViewOrganizationPerformance } from "./performanceAuthorization.js";
import {
  isPerformanceEvidenceQuarantined,
  normalizePerformanceEvidenceBatch,
  type CanonicalPerformanceEvidence,
} from "./performanceEvidence.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

export interface AuthorizedOrganizationEvidenceCandidatesQuery {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
}

type CandidateMetrics = Pick<
  CanonicalPerformanceEvidence,
  | "overallScore"
  | "communicationScore"
  | "outcomeScore"
  | "persuasion"
  | "clarity"
  | "empathy"
  | "assertiveness"
  | "completionLevel"
  | "objectiveAchieved"
  | "metricAvailability"
  | "recordEra"
  | "scoringGeneration"
  | "scoringWeightsApplied"
>;

interface CandidateBase extends CandidateMetrics {
  readonly orgId: string;
  readonly divisionId?: string;
  readonly scenarioId: string;
  readonly trainingId?: string;
  readonly evidenceAt: string;
}

/** Internal aggregation input only. subjectKey is an opaque current-free score
 * userId for distinct-subject calculations; it must never enter a public DTO.
 * Deidentified rows have no distinct-person key, so cohort privacy decisions
 * cannot be made from this candidate list and belong to the aggregate layer.
 */
export type OrganizationEvidenceCandidate = CandidateBase & (
  | { readonly subjectKind: "user"; readonly subjectKey: string }
  | { readonly subjectKind: "deidentified"; readonly subjectKey?: never }
);

export class AuthorizedOrganizationEvidenceCandidatesInputError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join(" "));
    this.name = "AuthorizedOrganizationEvidenceCandidatesInputError";
    this.errors = errors;
  }
}

function requiredId(value: unknown, label: string, errors: string[]): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} is required.`);
    return undefined;
  }
  return value.trim();
}

function projectOrganizationEvidenceCandidate(
  evidence: CanonicalPerformanceEvidence,
): OrganizationEvidenceCandidate {
  // This is the only output projection. Never spread a canonical score into an
  // aggregation candidate: it contains session IDs and other person-level data.
  const base: CandidateBase = {
    orgId: evidence.orgId!,
    ...(evidence.divisionId === undefined ? {} : { divisionId: evidence.divisionId }),
    scenarioId: evidence.scenarioId,
    ...(evidence.trainingId === undefined ? {} : { trainingId: evidence.trainingId }),
    evidenceAt: evidence.evidenceAt,
    recordEra: evidence.recordEra,
    scoringGeneration: evidence.scoringGeneration,
    metricAvailability: { ...evidence.metricAvailability },
    ...(evidence.scoringWeightsApplied === undefined
      ? {}
      : { scoringWeightsApplied: { ...evidence.scoringWeightsApplied } }),
    overallScore: evidence.overallScore,
    ...(evidence.communicationScore === undefined ? {} : { communicationScore: evidence.communicationScore }),
    ...(evidence.outcomeScore === undefined ? {} : { outcomeScore: evidence.outcomeScore }),
    persuasion: evidence.persuasion,
    clarity: evidence.clarity,
    empathy: evidence.empathy,
    assertiveness: evidence.assertiveness,
    ...(evidence.completionLevel === undefined ? {} : { completionLevel: evidence.completionLevel }),
    ...(evidence.objectiveAchieved === undefined ? {} : { objectiveAchieved: evidence.objectiveAchieved }),
  };
  return evidence.subjectKind === "deidentified"
    ? { ...base, subjectKind: "deidentified" }
    : { ...base, subjectKind: "user", subjectKey: evidence.userId };
}

/**
 * INTERNAL - NOT ROUTE-SAFE.
 * Routes/controllers must use queryAuthorizedOrganizationPerformance.
 *
 * Returns historically org-stamped evidence for future anonymous aggregation.
 * This does not authorize person targets or decide cohort privacy thresholds.
 * Ordering is canonical evidenceAt ascending, then internal evidenceId.
 */
export function queryAuthorizedOrganizationEvidenceCandidates(
  query: AuthorizedOrganizationEvidenceCandidatesQuery,
): OrganizationEvidenceCandidate[] {
  const errors: string[] = [];
  const organizationId = requiredId(query.organizationId, "organizationId", errors);
  const runtimeQuery = query as AuthorizedOrganizationEvidenceCandidatesQuery & Record<string, unknown>;
  if ([
    "evidenceAtFrom", "evidenceAtBefore", "scenarioId", "trainingId", "divisionId",
  ].some((key) => Object.hasOwn(runtimeQuery, key))) {
    errors.push("Organization evidence candidate prefilters are not supported.");
  }
  if (errors.length > 0) throw new AuthorizedOrganizationEvidenceCandidatesInputError(errors);

  const actor = query.snapshot.users.find((user) => user.id === query.viewer.userId && user.id !== "deleted_user");
  if (
    !actor
    || !isCurrentDashboardEligibleActor({ actor, viewer: query.viewer, organizations: query.snapshot.organizations })
    || !query.snapshot.organizations.some((org) => org.id === organizationId)
    || !canDashboardViewerAccessOrg(query.viewer, organizationId!)
    || (query.viewer.accessType !== "super_user" && !canViewOrganizationPerformance({ actor, orgId: organizationId! }))
  ) {
    return [];
  }

  return normalizePerformanceEvidenceBatch(query.snapshot.scoreRecords).results
    .flatMap((result) => result.status === "accepted" ? [result.evidence] : [])
    .filter((evidence) => !isPerformanceEvidenceQuarantined(evidence))
    .filter((evidence) => evidence.orgId !== null && evidence.orgId === organizationId)
    .sort((left, right) => left.evidenceAt.localeCompare(right.evidenceAt) || left.evidenceId.localeCompare(right.evidenceId))
    .map(projectOrganizationEvidenceCandidate);
}
