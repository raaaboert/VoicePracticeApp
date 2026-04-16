import {
  ApiDatabase,
  AppConfig,
  EnterpriseOrg,
  getRoleSegmentIdsForIndustries,
  OrgDivisionRecord,
  OrgStandardScenarioDivisionAssignmentRecord,
  OrgTrainingRecord,
  UserProfile,
} from "@voicepractice/shared";

type OrgDivisionCollections = Pick<
  ApiDatabase,
  "orgDivisions" | "orgStandardScenarioDivisionAssignments" | "orgTrainings" | "users"
>;

function normalizeNullableIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function sanitizeOrgDivisionName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export function ensureOrgDivisionCollections(
  db: Partial<Pick<ApiDatabase, "orgDivisions" | "orgStandardScenarioDivisionAssignments">>
): asserts db is Pick<ApiDatabase, "orgDivisions" | "orgStandardScenarioDivisionAssignments"> {
  if (!Array.isArray(db.orgDivisions)) {
    db.orgDivisions = [];
  }
  if (!Array.isArray(db.orgStandardScenarioDivisionAssignments)) {
    db.orgStandardScenarioDivisionAssignments = [];
  }
}

export function normalizeOrgDivisionRecords(
  entries: unknown,
  validOrgIds: ReadonlySet<string>,
  now: string
): OrgDivisionRecord[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const normalized: OrgDivisionRecord[] = [];
  for (const entry of entries) {
    const candidate = (entry ?? {}) as Partial<OrgDivisionRecord>;
    const id = normalizeNullableIdentifier(candidate.id);
    const orgId = normalizeNullableIdentifier(candidate.orgId);
    const name = sanitizeOrgDivisionName(candidate.name);
    if (!id || !orgId || !name || !validOrgIds.has(orgId)) {
      continue;
    }

    const createdAt =
      typeof candidate.createdAt === "string" && candidate.createdAt.trim() ? candidate.createdAt : now;
    const updatedAt =
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt : createdAt;

    normalized.push({
      id,
      orgId,
      name,
      active: candidate.active !== false,
      createdAt,
      updatedAt,
      deletedAt: normalizeNullableIdentifier(candidate.deletedAt),
    });
  }

  normalized.sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  return normalized;
}

export function normalizeOrgStandardScenarioDivisionAssignments(
  entries: unknown,
  validOrgIds: ReadonlySet<string>,
  validDivisionIds: ReadonlySet<string>,
  validScenarioIds: ReadonlySet<string>,
  now: string
): OrgStandardScenarioDivisionAssignmentRecord[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const deduped = new Map<string, OrgStandardScenarioDivisionAssignmentRecord>();
  for (const entry of entries) {
    const candidate = (entry ?? {}) as Partial<OrgStandardScenarioDivisionAssignmentRecord>;
    const id = normalizeNullableIdentifier(candidate.id);
    const orgId = normalizeNullableIdentifier(candidate.orgId);
    const scenarioId = normalizeNullableIdentifier(candidate.scenarioId);
    const divisionId = normalizeNullableIdentifier(candidate.divisionId);
    if (!id || !orgId || !scenarioId || !divisionId) {
      continue;
    }
    if (!validOrgIds.has(orgId) || !validDivisionIds.has(divisionId) || !validScenarioIds.has(scenarioId)) {
      continue;
    }

    const createdAt =
      typeof candidate.createdAt === "string" && candidate.createdAt.trim() ? candidate.createdAt : now;
    const updatedAt =
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt : createdAt;

    deduped.set(`${orgId}::${scenarioId}`, {
      id,
      orgId,
      scenarioId,
      divisionId,
      createdAt,
      updatedAt,
    });
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.orgId !== right.orgId) {
      return left.orgId.localeCompare(right.orgId);
    }
    return left.scenarioId.localeCompare(right.scenarioId);
  });
}

export function listOrgDivisions(
  db: Pick<ApiDatabase, "orgDivisions">,
  orgId: string,
  options?: { includeDeleted?: boolean }
): OrgDivisionRecord[] {
  const includeDeleted = options?.includeDeleted === true;
  return (db.orgDivisions ?? [])
    .filter((entry) => entry.orgId === orgId && (includeDeleted || entry.active))
    .slice()
    .sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
}

export function findOrgDivisionRecord(
  db: Pick<ApiDatabase, "orgDivisions">,
  orgId: string,
  divisionId: string | null | undefined
): OrgDivisionRecord | null {
  const normalizedDivisionId = normalizeNullableIdentifier(divisionId);
  if (!normalizedDivisionId) {
    return null;
  }
  return (db.orgDivisions ?? []).find((entry) => entry.orgId === orgId && entry.id === normalizedDivisionId) ?? null;
}

export function isDivisionActive(
  db: Pick<ApiDatabase, "orgDivisions">,
  orgId: string,
  divisionId: string | null | undefined
): boolean {
  const division = findOrgDivisionRecord(db, orgId, divisionId);
  return division?.active === true;
}

export function resolveUserActiveDivisionId(
  db: OrgDivisionCollections,
  orgId: string,
  user: UserProfile
): string | null {
  const userDivisionId = normalizeNullableIdentifier(user.divisionId);
  if (!userDivisionId) {
    return null;
  }
  return isDivisionActive(db, orgId, userDivisionId) ? userDivisionId : null;
}

export function resolveTrainingActiveDivisionId(
  db: OrgDivisionCollections,
  orgId: string,
  trainingId: string | null | undefined
): string | null {
  const normalizedTrainingId = normalizeNullableIdentifier(trainingId);
  if (!normalizedTrainingId) {
    return null;
  }
  const training = (db.orgTrainings ?? []).find(
    (entry) => entry.orgId === orgId && entry.id === normalizedTrainingId
  );
  if (!training) {
    return null;
  }
  return isDivisionActive(db, orgId, training.divisionId) ? training.divisionId ?? null : null;
}

export function resolveStandardScenarioActiveDivisionId(
  db: OrgDivisionCollections,
  orgId: string,
  scenarioId: string | null | undefined
): string | null {
  const normalizedScenarioId = normalizeNullableIdentifier(scenarioId);
  if (!normalizedScenarioId) {
    return null;
  }
  const assignment = findOrgStandardScenarioDivisionAssignmentRecord(db, orgId, normalizedScenarioId);
  if (!assignment) {
    return null;
  }
  return isDivisionActive(db, orgId, assignment.divisionId) ? assignment.divisionId : null;
}

export function findOrgStandardScenarioDivisionAssignmentRecord(
  db: Pick<ApiDatabase, "orgStandardScenarioDivisionAssignments">,
  orgId: string,
  scenarioId: string | null | undefined
): OrgStandardScenarioDivisionAssignmentRecord | null {
  const normalizedScenarioId = normalizeNullableIdentifier(scenarioId);
  if (!normalizedScenarioId) {
    return null;
  }
  return (
    db.orgStandardScenarioDivisionAssignments.find(
      (entry) => entry.orgId === orgId && entry.scenarioId === normalizedScenarioId
    ) ?? null
  );
}

export type DivisionAttributedScenarioSource = "standard" | "custom";

export function resolveLiveDivisionAttribution(params: {
  db: OrgDivisionCollections;
  orgId: string | null;
  user: UserProfile;
  trainingId?: string | null;
  scenarioSource: DivisionAttributedScenarioSource;
  scenarioId?: string | null;
  divisionsEnabled: boolean;
}): string | null {
  if (!params.orgId || params.divisionsEnabled !== true) {
    return null;
  }

  const userDivisionId = resolveUserActiveDivisionId(params.db, params.orgId, params.user);
  if (!userDivisionId) {
    return null;
  }

  const trainingDivisionId = resolveTrainingActiveDivisionId(params.db, params.orgId, params.trainingId);
  const contentDivisionId =
    trainingDivisionId ??
    (params.scenarioSource === "standard"
      ? resolveStandardScenarioActiveDivisionId(params.db, params.orgId, params.scenarioId)
      : null);

  if (!contentDivisionId) {
    return null;
  }

  return userDivisionId === contentDivisionId ? userDivisionId : null;
}

export function isDivisionVisibleToUser(params: {
  divisionsEnabled: boolean;
  userDivisionId: string | null;
  contentDivisionId: string | null;
}): boolean {
  if (params.divisionsEnabled !== true) {
    return true;
  }

  if (!params.contentDivisionId) {
    return true;
  }

  return params.userDivisionId === params.contentDivisionId;
}

export function clearDivisionAssignmentsForDeletedDivision(params: {
  db: OrgDivisionCollections;
  orgId: string;
  divisionId: string;
}): {
  clearedUserCount: number;
  clearedTrainingCount: number;
  clearedStandardScenarioAssignmentCount: number;
} {
  let clearedUserCount = 0;
  let clearedTrainingCount = 0;

  for (const user of params.db.users) {
    if (user.orgId === params.orgId && normalizeNullableIdentifier(user.divisionId) === params.divisionId) {
      user.divisionId = null;
      clearedUserCount += 1;
    }
  }

  for (const training of params.db.orgTrainings) {
    if (training.orgId === params.orgId && normalizeNullableIdentifier(training.divisionId) === params.divisionId) {
      training.divisionId = null;
      clearedTrainingCount += 1;
    }
  }

  const beforeAssignmentCount = params.db.orgStandardScenarioDivisionAssignments.length;
  params.db.orgStandardScenarioDivisionAssignments = params.db.orgStandardScenarioDivisionAssignments.filter(
    (entry) => !(entry.orgId === params.orgId && entry.divisionId === params.divisionId)
  );

  return {
    clearedUserCount,
    clearedTrainingCount,
    clearedStandardScenarioAssignmentCount:
      beforeAssignmentCount - params.db.orgStandardScenarioDivisionAssignments.length,
  };
}

function getConfiguredActiveIndustryIds(config: Pick<AppConfig, "industries">): string[] {
  const activeIds = (config.industries ?? [])
    .filter((entry) => entry.enabled)
    .map((entry) => entry.id)
    .filter((id, index, values) => values.indexOf(id) === index);
  if (activeIds.length > 0) {
    return activeIds;
  }
  return (config.industries ?? [])
    .map((entry) => entry.id)
    .filter((id, index, values) => values.indexOf(id) === index);
}

function normalizeIndustryIds(
  value: unknown,
  fallback: string[],
  allowed: ReadonlySet<string>
): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const unique = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry && allowed.has(entry))
    .filter((entry, index, values) => values.indexOf(entry) === index);
  return unique.length > 0 ? unique : [...fallback];
}

export interface OrgVisibleStandardScenarioRow {
  scenarioId: string;
  segmentId: string;
  segmentLabel: string;
  title: string;
  enabled: boolean;
}

export function listOrgVisibleStandardScenarios(params: {
  config: Pick<AppConfig, "segments" | "industries" | "roleIndustries">;
  org: Pick<EnterpriseOrg, "activeIndustries">;
}): OrgVisibleStandardScenarioRow[] {
  const enabledIndustryIds = new Set(
    (params.config.industries ?? []).filter((entry) => entry.enabled).map((entry) => entry.id)
  );
  const scopedIndustryIds = normalizeIndustryIds(
    params.org.activeIndustries,
    getConfiguredActiveIndustryIds(params.config),
    enabledIndustryIds.size > 0 ? enabledIndustryIds : new Set(getConfiguredActiveIndustryIds(params.config))
  );
  const allowedRoleSegmentIds = new Set(
    getRoleSegmentIdsForIndustries(scopedIndustryIds, params.config.roleIndustries)
  );

  return (params.config.segments ?? [])
    .filter((segment) => allowedRoleSegmentIds.has(segment.id))
    .flatMap((segment) =>
      (segment.scenarios ?? []).map((scenario) => ({
        scenarioId: scenario.id,
        segmentId: segment.id,
        segmentLabel: segment.label,
        title: scenario.title,
        enabled: scenario.enabled !== false,
      }))
    );
}
