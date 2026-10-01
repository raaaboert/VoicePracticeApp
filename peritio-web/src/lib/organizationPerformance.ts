import type { DashboardViewer, SimulationScoringWeightsApplied } from "@voicepractice/shared";

export type OrganizationPerformanceDimension = "division" | "scenario" | "training";
export type OrganizationPerformanceMetric =
  | "overall"
  | "communication"
  | "outcome"
  | "persuasion"
  | "clarity"
  | "empathy"
  | "assertiveness";

export interface OrganizationPerformanceCalendarMonth {
  readonly year: number;
  readonly month: number;
}

export interface OrganizationPerformanceDimensionFilter {
  readonly dimension: OrganizationPerformanceDimension;
  readonly id: string;
}

export interface OrganizationPerformanceEvidenceStrength {
  readonly conservativeContributorCount: number;
  readonly limitedEvidence: boolean;
}

export interface OrganizationPerformanceConcentration {
  readonly concentrationWarning: boolean;
}

export type OrganizationPerformanceWeightProfile =
  | {
      readonly kind: "known";
      readonly profileKey: string;
      readonly weights: SimulationScoringWeightsApplied;
    }
  | { readonly kind: "unknown"; readonly profileKey: "unknown" };

export interface OrganizationPerformanceActivity {
  readonly attemptCount: number;
  readonly conclusiveAttemptCount: number;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  readonly concentration: OrganizationPerformanceConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceCompletion {
  readonly availableObservationCount: number;
  readonly completeCount: number;
  readonly partialCount: number;
  readonly inconclusiveCount: number;
  readonly completionRate: number | null;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  readonly concentration: OrganizationPerformanceConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceObjective {
  readonly availableObservationCount: number;
  readonly achievedCount: number;
  readonly objectiveAchievementRate: number | null;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  readonly concentration: OrganizationPerformanceConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceCompletionGroup {
  readonly scoringGeneration: string;
  readonly completion?: OrganizationPerformanceCompletion;
  readonly objective?: OrganizationPerformanceObjective;
}

export interface OrganizationPerformanceMetricGroup {
  readonly metric: OrganizationPerformanceMetric;
  readonly scoringGeneration: string;
  readonly weightProfile?: OrganizationPerformanceWeightProfile;
  readonly mean: number;
  readonly qualifyingObservationCount: number;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  readonly concentration: OrganizationPerformanceConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceResponse {
  readonly calendarMonth: OrganizationPerformanceCalendarMonth & { readonly timeZone: "UTC" };
  readonly dimensionFilter: OrganizationPerformanceDimensionFilter | null;
  readonly historicalScope: "organization_history" | "current_population";
  readonly activity: OrganizationPerformanceActivity | null;
  readonly completionGroups: readonly OrganizationPerformanceCompletionGroup[];
  readonly metricGroups: readonly OrganizationPerformanceMetricGroup[];
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceRequest extends OrganizationPerformanceCalendarMonth {
  readonly orgId: string;
  readonly dimension?: OrganizationPerformanceDimension;
  readonly dimensionId?: string;
  readonly signal?: AbortSignal;
}

export type PerformanceGroupScope = "organization" | "team";

export interface PerformanceGroupSummaryRequest extends OrganizationPerformanceRequest {
  readonly scope: PerformanceGroupScope;
}

export type OrganizationPerformanceClientResult =
  | { readonly kind: "success"; readonly data: OrganizationPerformanceResponse }
  | { readonly kind: "access_denied" }
  | { readonly kind: "not_found" }
  | { readonly kind: "error"; readonly message: string };

export type PerformanceOverviewScope =
  | { readonly kind: "organization"; readonly orgId: string; readonly orgName: string | null }
  | { readonly kind: "team"; readonly orgId: string; readonly orgName: string | null }
  | { readonly kind: "no_access" }
  | { readonly kind: "select_organization" };

export function resolvePerformanceOverviewScope(
  viewer: Pick<DashboardViewer, "accessType" | "orgId" | "orgName" | "performanceAccess">,
  requestedOrgId?: string | null
): PerformanceOverviewScope {
  if (viewer.accessType === "super_user") {
    const orgId = requestedOrgId?.trim();
    return orgId
      ? { kind: "organization", orgId, orgName: null }
      : { kind: "select_organization" };
  }

  if (viewer.performanceAccess === "team" && viewer.orgId) {
    return { kind: "team", orgId: viewer.orgId, orgName: viewer.orgName };
  }
  if (viewer.performanceAccess !== "organization" || !viewer.orgId) {
    return { kind: "no_access" };
  }
  return { kind: "organization", orgId: viewer.orgId, orgName: viewer.orgName };
}

async function readErrorPayload(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const payload = await response.json() as unknown;
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function getOrganizationPerformance(
  input: OrganizationPerformanceRequest,
  fetcher: typeof fetch = fetch
): Promise<OrganizationPerformanceClientResult> {
  return getPerformanceGroupSummary({ ...input, scope: "organization" }, fetcher);
}

export async function getPerformanceGroupSummary(
  input: PerformanceGroupSummaryRequest,
  fetcher: typeof fetch = fetch
): Promise<OrganizationPerformanceClientResult> {
  const result = await getPerformanceGroupSummaryFromEndpoint(input, fetcher);
  if (
    input.scope === "team"
    && result.kind === "success"
    && (
      result.data.historicalScope !== "current_population"
      || result.data.historicalPrivacyAdjustmentApplied
    )
  ) {
    return { kind: "error", message: "Team performance data could not be loaded. Please retry." };
  }
  return result;
}

async function getPerformanceGroupSummaryFromEndpoint(
  input: PerformanceGroupSummaryRequest,
  fetcher: typeof fetch
): Promise<OrganizationPerformanceClientResult> {
  const params = new URLSearchParams({
    orgId: input.orgId,
    year: String(input.year),
    month: String(input.month),
  });
  if (input.scope === "organization" && input.dimension && input.dimensionId) {
    params.set("dimension", input.dimension);
    params.set("dimensionId", input.dimensionId);
  }

  let response: Response;
  try {
    response = await fetcher(`/api/performance/${input.scope}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return { kind: "error", message: "Performance data could not be loaded. Please retry." };
  }

  if (response.ok) {
    return { kind: "success", data: await response.json() as OrganizationPerformanceResponse };
  }

  const payload = await readErrorPayload(response);
  if (response.status === 403 && payload?.code === "dashboard_scope_denied") {
    return { kind: "access_denied" };
  }
  if (response.status === 404) {
    return { kind: "not_found" };
  }
  return {
    kind: "error",
    message: typeof payload?.error === "string" && payload.error.trim()
      ? payload.error
      : "Performance data could not be loaded. Please retry.",
  };
}
