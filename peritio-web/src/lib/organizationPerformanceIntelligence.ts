import type { OrganizationPerformanceCalendarMonth } from "./organizationPerformance";
import type { TeamPerformanceIntelligenceResponse } from "./teamPerformanceIntelligence";

export interface OrganizationPerformanceIntelligenceResponse {
  readonly scope: "organization";
  readonly populationBasis: "current_members";
  readonly asOf: string;
  readonly currentMonth: OrganizationPerformanceCalendarMonth & { readonly timeZone: "UTC" };
  readonly comparisonMonth: OrganizationPerformanceCalendarMonth & { readonly timeZone: "UTC" };
  readonly population: {
    readonly currentMemberCount: number;
    readonly hasCurrentMembers: boolean;
  };
  readonly facts: TeamPerformanceIntelligenceResponse["facts"];
  readonly signals: TeamPerformanceIntelligenceResponse["signals"];
}

export interface OrganizationPerformanceIntelligenceRequest extends OrganizationPerformanceCalendarMonth {
  readonly orgId: string;
  readonly signal?: AbortSignal;
}

export type OrganizationPerformanceIntelligenceClientResult =
  | { readonly kind: "success"; readonly data: OrganizationPerformanceIntelligenceResponse }
  | { readonly kind: "error" };

export async function getOrganizationPerformanceIntelligence(
  input: OrganizationPerformanceIntelligenceRequest,
  fetcher: typeof fetch = fetch,
): Promise<OrganizationPerformanceIntelligenceClientResult> {
  const params = new URLSearchParams({
    orgId: input.orgId,
    year: String(input.year),
    month: String(input.month),
  });
  try {
    const response = await fetcher(`/api/performance/organization/intelligence?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: input.signal,
    });
    return response.ok
      ? { kind: "success", data: await response.json() as OrganizationPerformanceIntelligenceResponse }
      : { kind: "error" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { kind: "error" };
  }
}

export function isOrganizationPerformanceIntelligenceRequestCurrent(signal: AbortSignal): boolean {
  return !signal.aborted;
}
