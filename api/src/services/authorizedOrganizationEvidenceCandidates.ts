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
  readonly evidenceAtFrom?: string;
  readonly evidenceAtBefore?: string;
  readonly scenarioId?: string;
  readonly trainingId?: string;
  readonly divisionId?: string;
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

function optionalId(value: unknown, label: string, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a non-empty string when provided.`);
    return undefined;
  }
  return value.trim();
}

function optionalTime(value: unknown, label: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    errors.push(`${label} must be a valid ISO timestamp when provided.`);
    return undefined;
  }
  return Date.parse(value);
}

function toCandidate(evidence: CanonicalPerformanceEvidence): OrganizationEvidenceCandidate {
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

/** Returns historically org-stamped evidence for future anonymous aggregation.
 * This does not authorize person targets or decide cohort privacy thresholds.
 * Ordering is canonical evidenceAt ascending, then internal evidenceId.
 */
export function queryAuthorizedOrganizationEvidenceCandidates(
  query: AuthorizedOrganizationEvidenceCandidatesQuery,
): OrganizationEvidenceCandidate[] {
  const errors: string[] = [];
  const organizationId = requiredId(query.organizationId, "organizationId", errors);
  const scenarioId = optionalId(query.scenarioId, "scenarioId", errors);
  const trainingId = optionalId(query.trainingId, "trainingId", errors);
  const divisionId = optionalId(query.divisionId, "divisionId", errors);
  const evidenceAtFrom = optionalTime(query.evidenceAtFrom, "evidenceAtFrom", errors);
  const evidenceAtBefore = optionalTime(query.evidenceAtBefore, "evidenceAtBefore", errors);
  if (evidenceAtFrom !== undefined && evidenceAtBefore !== undefined && evidenceAtFrom >= evidenceAtBefore) {
    errors.push("evidenceAtFrom must be earlier than evidenceAtBefore.");
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
    .filter((evidence) => evidenceAtFrom === undefined || Date.parse(evidence.evidenceAt) >= evidenceAtFrom)
    .filter((evidence) => evidenceAtBefore === undefined || Date.parse(evidence.evidenceAt) < evidenceAtBefore)
    .filter((evidence) => scenarioId === undefined || evidence.scenarioId === scenarioId)
    .filter((evidence) => trainingId === undefined || evidence.trainingId === trainingId)
    .filter((evidence) => divisionId === undefined || evidence.divisionId === divisionId)
    .sort((left, right) => left.evidenceAt.localeCompare(right.evidenceAt) || left.evidenceId.localeCompare(right.evidenceId))
    .map(toCandidate);
}
