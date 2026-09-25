import type { DashboardViewer } from "@voicepractice/shared";

import { canDashboardViewerAccessOrg } from "./dashboardAuthorization.js";
import {
  getDashboardPermittedUserIds,
} from "./performanceAuthorization.js";
import {
  isPerformanceEvidenceQuarantined,
  normalizePerformanceEvidenceBatch,
  type CanonicalPerformanceEvidence,
} from "./performanceEvidence.js";
import type {
  PerformanceEvidenceSourceSnapshot,
  PerformanceEvidenceSourceUser,
} from "./performanceEvidenceSourceSnapshot.js";

export interface AuthorizedPerformanceEvidenceQuery {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly actorUserId: string;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly targetUserId?: string;
  readonly evidenceAtFrom?: string;
  readonly evidenceAtBefore?: string;
  readonly scenarioId?: string;
  readonly trainingId?: string;
}

export class AuthorizedPerformanceEvidenceQueryInputError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join(" "));
    this.name = "AuthorizedPerformanceEvidenceQueryInputError";
    this.errors = errors;
  }
}

interface ValidatedQueryFilters {
  readonly targetUserId?: string;
  readonly evidenceAtFrom?: number;
  readonly evidenceAtBefore?: number;
  readonly scenarioId?: string;
  readonly trainingId?: string;
}

function normalizeRequiredIdentifier(value: unknown, label: string, errors: string[]): string | null {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} is required.`);
    return null;
  }
  return value.trim();
}

function normalizeOptionalIdentifier(value: unknown, label: string, errors: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a non-empty string when provided.`);
    return undefined;
  }
  return value.trim();
}

function parseOptionalTimestamp(value: unknown, label: string, errors: string[]): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a valid ISO timestamp when provided.`);
    return undefined;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    errors.push(`${label} must be a valid ISO timestamp when provided.`);
    return undefined;
  }
  return parsed.getTime();
}

function validateQuery(query: AuthorizedPerformanceEvidenceQuery): ValidatedQueryFilters {
  const errors: string[] = [];
  normalizeRequiredIdentifier(query.actorUserId, "actorUserId", errors);
  normalizeRequiredIdentifier(query.organizationId, "organizationId", errors);
  const targetUserId = normalizeOptionalIdentifier(query.targetUserId, "targetUserId", errors);
  const scenarioId = normalizeOptionalIdentifier(query.scenarioId, "scenarioId", errors);
  const trainingId = normalizeOptionalIdentifier(query.trainingId, "trainingId", errors);
  const evidenceAtFrom = parseOptionalTimestamp(query.evidenceAtFrom, "evidenceAtFrom", errors);
  const evidenceAtBefore = parseOptionalTimestamp(query.evidenceAtBefore, "evidenceAtBefore", errors);

  if (
    evidenceAtFrom !== undefined
    && evidenceAtBefore !== undefined
    && evidenceAtFrom >= evidenceAtBefore
  ) {
    errors.push("evidenceAtFrom must be earlier than evidenceAtBefore.");
  }
  if (errors.length > 0) {
    throw new AuthorizedPerformanceEvidenceQueryInputError(errors);
  }

  return { targetUserId, evidenceAtFrom, evidenceAtBefore, scenarioId, trainingId };
}

function findSourceUser(
  users: readonly PerformanceEvidenceSourceUser[],
  id: string,
): PerformanceEvidenceSourceUser | undefined {
  return users.find((user) => user.id === id);
}

/**
 * Returns current-viewer-authorized, person-scoped canonical evidence for one
 * requested organization. Ordering is chronological ascending by canonical
 * evidenceAt, then evidenceId, matching historical reporting reads.
 */
export function queryAuthorizedPerformanceEvidence(
  query: AuthorizedPerformanceEvidenceQuery,
): CanonicalPerformanceEvidence[] {
  const filters = validateQuery(query);
  const actorUserId = query.actorUserId.trim();
  const organizationId = query.organizationId.trim();
  const authorizationUsers = query.snapshot.users.filter((user) => user.id !== "deleted_user");
  const actor = findSourceUser(authorizationUsers, actorUserId);
  const organizationExists = query.snapshot.organizations.some((organization) => organization.id === organizationId);

  if (!actor || !organizationExists || !canDashboardViewerAccessOrg(query.viewer, organizationId)) {
    return [];
  }

  const permittedUserIds = getDashboardPermittedUserIds({
    db: { users: authorizationUsers },
    actor,
    viewer: query.viewer,
    orgIds: new Set([organizationId]),
  });

  if (filters.targetUserId && !permittedUserIds.has(filters.targetUserId)) {
    return [];
  }

  return normalizePerformanceEvidenceBatch(query.snapshot.scoreRecords).results
    .flatMap((result) => result.status === "accepted" ? [result.evidence] : [])
    .filter((evidence) => !isPerformanceEvidenceQuarantined(evidence))
    .filter((evidence) => evidence.subjectKind !== "deidentified")
    .filter((evidence) => evidence.orgId === organizationId)
    .filter((evidence) => permittedUserIds.has(evidence.userId))
    .filter((evidence) => !filters.targetUserId || evidence.userId === filters.targetUserId)
    .filter((evidence) => {
      const evidenceAt = Date.parse(evidence.evidenceAt);
      return (
        (filters.evidenceAtFrom === undefined || evidenceAt >= filters.evidenceAtFrom)
        && (filters.evidenceAtBefore === undefined || evidenceAt < filters.evidenceAtBefore)
      );
    })
    .filter((evidence) => !filters.scenarioId || evidence.scenarioId === filters.scenarioId)
    .filter((evidence) => !filters.trainingId || evidence.trainingId === filters.trainingId)
    .sort((left, right) => left.evidenceAt.localeCompare(right.evidenceAt) || left.evidenceId.localeCompare(right.evidenceId));
}
