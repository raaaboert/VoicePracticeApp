import type { DashboardViewer } from "@voicepractice/shared";

import {
  AuthorizedOrganizationPerformanceInputError,
  queryAuthorizedOrganizationPerformance,
  type AuthorizedOrganizationPerformanceDimensionFilter,
  type AuthorizedOrganizationPerformanceResult,
} from "./authorizedOrganizationPerformance.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

const ALLOWED_QUERY_FIELDS = new Set([
  "orgId",
  "year",
  "month",
  "dimension",
  "dimensionId",
]);

type OrganizationPerformanceFacade = typeof queryAuthorizedOrganizationPerformance;

export interface DashboardOrganizationPerformanceRouteInput {
  readonly query: Readonly<Record<string, unknown>>;
  readonly viewer: DashboardViewer;
  readonly captureSnapshot: () => Promise<PerformanceEvidenceSourceSnapshot>;
  /** Test seam for verifying route orchestration and internal-error propagation. */
  readonly queryOrganizationPerformance?: OrganizationPerformanceFacade;
}

function optionalSingleQueryValue(
  query: Readonly<Record<string, unknown>>,
  field: string,
  errors: string[],
): string | undefined {
  if (!Object.hasOwn(query, field)) return undefined;
  const value = query[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be provided exactly once as a non-empty string.`);
    return undefined;
  }
  return value.trim();
}

function parseRouteQuery(query: Readonly<Record<string, unknown>>) {
  const errors: string[] = [];
  if (Object.keys(query).some((key) => !ALLOWED_QUERY_FIELDS.has(key))) {
    errors.push("Unsupported organization performance query fields are not allowed.");
  }

  const organizationId = optionalSingleQueryValue(query, "orgId", errors) ?? "";
  const yearValue = optionalSingleQueryValue(query, "year", errors);
  const monthValue = optionalSingleQueryValue(query, "month", errors);
  const dimension = optionalSingleQueryValue(query, "dimension", errors);
  const dimensionId = optionalSingleQueryValue(query, "dimensionId", errors);

  if (errors.length > 0) {
    throw new AuthorizedOrganizationPerformanceInputError(errors);
  }

  const dimensionFilter = dimension === undefined && dimensionId === undefined
    ? undefined
    : {
        dimension: (dimension ?? "") as AuthorizedOrganizationPerformanceDimensionFilter["dimension"],
        id: dimensionId ?? "",
      };

  return {
    organizationId,
    calendarMonth: {
      year: Number(yearValue),
      month: Number(monthValue),
    },
    ...(dimensionFilter === undefined ? {} : { dimensionFilter }),
  };
}

/**
 * Route orchestration boundary. Snapshot capture releases the global database
 * lock before the synchronous facade performs normalization and aggregation.
 */
export async function queryDashboardOrganizationPerformanceRoute(
  input: DashboardOrganizationPerformanceRouteInput,
): Promise<AuthorizedOrganizationPerformanceResult> {
  const routeQuery = parseRouteQuery(input.query);
  const snapshot = await input.captureSnapshot();
  const queryFacade = input.queryOrganizationPerformance ?? queryAuthorizedOrganizationPerformance;
  return queryFacade({
    snapshot,
    viewer: input.viewer,
    ...routeQuery,
  });
}
