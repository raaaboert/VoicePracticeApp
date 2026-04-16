import type {
  ApiDatabase,
  DashboardDivisionScope,
  DashboardViewer,
} from "@voicepractice/shared";

import { findOrgDivisionRecord, listOrgDivisions } from "./orgDivisions.js";

function normalizeRequestedDivisionId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function filterRecordsByDivision<T extends { divisionId?: string | null }>(
  rows: readonly T[],
  divisionId: string | null
): T[] {
  if (!divisionId) {
    return [...rows];
  }

  return rows.filter((row) => (row.divisionId ?? null) === divisionId);
}

export function buildDashboardDivisionScope(params: {
  db: Pick<ApiDatabase, "orgDivisions" | "usageSessions" | "scoreRecords">;
  orgId: string;
  appliedDivisionId: string | null;
}): DashboardDivisionScope | undefined {
  const historicalDivisionIds = new Set<string>();
  for (const session of params.db.usageSessions ?? []) {
    if (session.orgId === params.orgId && typeof session.divisionId === "string" && session.divisionId.trim()) {
      historicalDivisionIds.add(session.divisionId);
    }
  }
  for (const record of params.db.scoreRecords ?? []) {
    if (record.orgId === params.orgId && typeof record.divisionId === "string" && record.divisionId.trim()) {
      historicalDivisionIds.add(record.divisionId);
    }
  }

  const divisions = listOrgDivisions(params.db, params.orgId, { includeDeleted: true })
    .filter((division) => division.active || historicalDivisionIds.has(division.id) || division.id === params.appliedDivisionId)
    .map((division) => ({
      id: division.id,
      name: division.name,
      active: division.active === true,
      deletedAt: division.deletedAt ?? null,
    }));

  if (divisions.length === 0) {
    return undefined;
  }

  return {
    appliedDivisionId: params.appliedDivisionId,
    divisions,
  };
}

export function resolveDashboardDivisionFilter(params: {
  db: Pick<ApiDatabase, "orgDivisions" | "usageSessions" | "scoreRecords">;
  viewer: DashboardViewer;
  requestedDivisionId: unknown;
  explicitOrgId?: string | null;
}):
  | {
      orgId: string | null;
      appliedDivisionId: string | null;
      divisionScope?: DashboardDivisionScope;
      error: null;
    }
  | {
      orgId: string | null;
      appliedDivisionId: string | null;
      divisionScope?: DashboardDivisionScope;
      error: string;
    } {
  const normalizedRequestedDivisionId = normalizeRequestedDivisionId(params.requestedDivisionId);
  const scopedOrgId =
    params.explicitOrgId ??
    (params.viewer.accessType === "customer_dashboard_user" ? params.viewer.orgId ?? null : null);

  if (!scopedOrgId) {
    return {
      orgId: null,
      appliedDivisionId: null,
      divisionScope: undefined,
      error: null,
    };
  }

  if (normalizedRequestedDivisionId) {
    const division = findOrgDivisionRecord(params.db, scopedOrgId, normalizedRequestedDivisionId);
    if (!division) {
      return {
        orgId: scopedOrgId,
        appliedDivisionId: null,
        divisionScope: buildDashboardDivisionScope({
          db: params.db,
          orgId: scopedOrgId,
          appliedDivisionId: null,
        }),
        error: "divisionId must reference a division in this company.",
      };
    }
  }

  const appliedDivisionId = normalizedRequestedDivisionId ?? null;
  return {
    orgId: scopedOrgId,
    appliedDivisionId,
    divisionScope: buildDashboardDivisionScope({
      db: params.db,
      orgId: scopedOrgId,
      appliedDivisionId,
    }),
    error: null,
  };
}
