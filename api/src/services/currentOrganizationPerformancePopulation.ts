import type { OrganizationEvidenceCandidate } from "./authorizedOrganizationEvidenceCandidates.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

export interface CurrentOrganizationPerformancePopulation {
  readonly organizationId: string;
  readonly currentMemberCount: number;
  /** INTERNAL identity set. It must never enter a route-facing or fact DTO. */
  readonly memberIds: ReadonlySet<string>;
}

/**
 * INTERNAL - NOT ROUTE-SAFE. Resolves the canonical current organization
 * population from one approved snapshot. Status, role, manager, and division
 * do not narrow membership; the current enterprise organization assignment is
 * authoritative. The hard-delete sentinel is never a current member.
 */
export function resolveCurrentOrganizationPerformancePopulation(input: {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly organizationId: string;
}): CurrentOrganizationPerformancePopulation {
  const memberIds = new Set(
    input.snapshot.users
      .filter((user) =>
        user.id !== "deleted_user"
        && user.accountType === "enterprise"
        && user.orgId === input.organizationId)
      .map((user) => user.id),
  );
  return {
    organizationId: input.organizationId,
    currentMemberCount: memberIds.size,
    memberIds,
  };
}

/** Selects same-organization evidence for the already-resolved population. */
export function selectCurrentOrganizationPerformanceCandidates(
  candidates: readonly OrganizationEvidenceCandidate[],
  population: CurrentOrganizationPerformancePopulation,
): OrganizationEvidenceCandidate[] {
  return candidates.filter((candidate) =>
    candidate.subjectKind === "user"
    && candidate.orgId === population.organizationId
    && population.memberIds.has(candidate.subjectKey));
}
