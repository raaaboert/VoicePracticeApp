import {
  ApiDatabase,
  ORG_TRAINING_STATUSES,
  OrgTrainingPackAttachmentRecord,
  OrgTrainingRecord,
  OrgTrainingScenarioAttachmentRecord,
  OrgTrainingStatus,
  OrgTrainingSummary,
} from "@voicepractice/shared";

export const LEGACY_TEST_TRAINING_NAME = "Test Training";
export const LEGACY_TEST_TRAINING_DESCRIPTION =
  "Auto-created to preserve existing enterprise training assets during the training-first workspace migration.";

type OrgTrainingCollections = Pick<
  ApiDatabase,
  "orgTrainings" | "orgTrainingPackAttachments" | "orgTrainingScenarioAttachments"
>;

export function normalizeOrgTrainingStatus(value: unknown, fallback: OrgTrainingStatus = "draft"): OrgTrainingStatus {
  return typeof value === "string" && ORG_TRAINING_STATUSES.includes(value as OrgTrainingStatus)
    ? (value as OrgTrainingStatus)
    : fallback;
}

export function ensureOrgTrainingCollections(db: Partial<OrgTrainingCollections>): asserts db is OrgTrainingCollections {
  if (!Array.isArray(db.orgTrainings)) {
    db.orgTrainings = [];
  }
  if (!Array.isArray(db.orgTrainingPackAttachments)) {
    db.orgTrainingPackAttachments = [];
  }
  if (!Array.isArray(db.orgTrainingScenarioAttachments)) {
    db.orgTrainingScenarioAttachments = [];
  }
}

export function normalizeOrgTrainingRecords(
  entries: unknown,
  validOrgIds: ReadonlySet<string>,
  now: string,
): OrgTrainingRecord[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const candidate = (entry ?? {}) as Partial<OrgTrainingRecord>;
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const orgId = typeof candidate.orgId === "string" ? candidate.orgId.trim() : "";
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!id || !orgId || !name || !validOrgIds.has(orgId)) {
        return null;
      }

      const createdAt =
        typeof candidate.createdAt === "string" && candidate.createdAt.trim() ? candidate.createdAt : now;
      const updatedAt =
        typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt : createdAt;

      return {
        id,
        orgId,
        name: name.slice(0, 160),
        status: normalizeOrgTrainingStatus(candidate.status, "draft"),
        description: typeof candidate.description === "string" ? candidate.description.trim().slice(0, 4_000) : "",
        createdAt,
        updatedAt,
      } satisfies OrgTrainingRecord;
    })
    .filter((entry): entry is OrgTrainingRecord => Boolean(entry));
}

export function normalizeOrgTrainingPackAttachments(
  entries: unknown,
  validOrgIds: ReadonlySet<string>,
  validTrainingIds: ReadonlySet<string>,
  now: string,
): OrgTrainingPackAttachmentRecord[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const candidate = (entry ?? {}) as Partial<OrgTrainingPackAttachmentRecord>;
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const orgId = typeof candidate.orgId === "string" ? candidate.orgId.trim() : "";
      const trainingId = typeof candidate.trainingId === "string" ? candidate.trainingId.trim() : "";
      const trainingPackId = typeof candidate.trainingPackId === "string" ? candidate.trainingPackId.trim() : "";
      if (!id || !orgId || !trainingId || !trainingPackId || !validOrgIds.has(orgId) || !validTrainingIds.has(trainingId)) {
        return null;
      }

      const createdAt =
        typeof candidate.createdAt === "string" && candidate.createdAt.trim() ? candidate.createdAt : now;
      const updatedAt =
        typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt : createdAt;

      return {
        id,
        orgId,
        trainingId,
        trainingPackId,
        createdAt,
        updatedAt,
      } satisfies OrgTrainingPackAttachmentRecord;
    })
    .filter((entry): entry is OrgTrainingPackAttachmentRecord => Boolean(entry));
}

export function normalizeOrgTrainingScenarioAttachments(
  entries: unknown,
  validOrgIds: ReadonlySet<string>,
  validTrainingIds: ReadonlySet<string>,
  now: string,
): OrgTrainingScenarioAttachmentRecord[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const candidate = (entry ?? {}) as Partial<OrgTrainingScenarioAttachmentRecord>;
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const orgId = typeof candidate.orgId === "string" ? candidate.orgId.trim() : "";
      const trainingId = typeof candidate.trainingId === "string" ? candidate.trainingId.trim() : "";
      const scenarioId = typeof candidate.scenarioId === "string" ? candidate.scenarioId.trim() : "";
      if (!id || !orgId || !trainingId || !scenarioId || !validOrgIds.has(orgId) || !validTrainingIds.has(trainingId)) {
        return null;
      }

      const createdAt =
        typeof candidate.createdAt === "string" && candidate.createdAt.trim() ? candidate.createdAt : now;
      const updatedAt =
        typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt : createdAt;

      return {
        id,
        orgId,
        trainingId,
        scenarioId,
        createdAt,
        updatedAt,
      } satisfies OrgTrainingScenarioAttachmentRecord;
    })
    .filter((entry): entry is OrgTrainingScenarioAttachmentRecord => Boolean(entry));
}

export function listOrgTrainingRecords(db: OrgTrainingCollections, orgId: string): OrgTrainingRecord[] {
  return db.orgTrainings
    .filter((entry) => entry.orgId === orgId)
    .slice()
    .sort((left, right) => {
      const statusOrder: Record<OrgTrainingStatus, number> = {
        active: 0,
        draft: 1,
        archived: 2,
      };
      if (statusOrder[left.status] !== statusOrder[right.status]) {
        return statusOrder[left.status] - statusOrder[right.status];
      }
      const updatedAtDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (Number.isFinite(updatedAtDelta) && updatedAtDelta !== 0) {
        return updatedAtDelta;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
}

export function findOrgTrainingRecord(
  db: OrgTrainingCollections,
  orgId: string,
  trainingId: string,
): OrgTrainingRecord | null {
  return db.orgTrainings.find((entry) => entry.orgId === orgId && entry.id === trainingId) ?? null;
}

export function buildOrgTrainingSummaries(params: {
  db: OrgTrainingCollections;
  orgId: string;
  validTrainingPackIds?: Iterable<string>;
  validScenarioIds?: Iterable<string>;
}): OrgTrainingSummary[] {
  const validPackIds = params.validTrainingPackIds ? new Set(params.validTrainingPackIds) : null;
  const validScenarioIds = params.validScenarioIds ? new Set(params.validScenarioIds) : null;

  return listOrgTrainingRecords(params.db, params.orgId).map((training) => {
    const attachedTrainingPackIds = Array.from(
      new Set(
        params.db.orgTrainingPackAttachments
          .filter(
            (entry) =>
              entry.orgId === params.orgId &&
              entry.trainingId === training.id &&
              (validPackIds === null || validPackIds.has(entry.trainingPackId)),
          )
          .map((entry) => entry.trainingPackId),
      ),
    );
    const attachedCustomScenarioIds = Array.from(
      new Set(
        params.db.orgTrainingScenarioAttachments
          .filter(
            (entry) =>
              entry.orgId === params.orgId &&
              entry.trainingId === training.id &&
              (validScenarioIds === null || validScenarioIds.has(entry.scenarioId)),
          )
          .map((entry) => entry.scenarioId),
      ),
    );

    return {
      ...training,
      attachedTrainingPackIds,
      attachedCustomScenarioIds,
      attachedTrainingPackCount: attachedTrainingPackIds.length,
      attachedCustomScenarioCount: attachedCustomScenarioIds.length,
    };
  });
}

export function seedLegacyOrgTraining(params: {
  db: OrgTrainingCollections;
  orgId: string;
  trainingPackIds: readonly string[];
  scenarioIds: readonly string[];
  now: string;
  createTrainingId: () => string;
  createPackAttachmentId: () => string;
  createScenarioAttachmentId: () => string;
}): OrgTrainingRecord | null {
  ensureOrgTrainingCollections(params.db);
  if (listOrgTrainingRecords(params.db, params.orgId).length > 0) {
    return null;
  }

  const uniqueTrainingPackIds = Array.from(new Set(params.trainingPackIds.map((entry) => entry.trim()).filter(Boolean)));
  const uniqueScenarioIds = Array.from(new Set(params.scenarioIds.map((entry) => entry.trim()).filter(Boolean)));
  if (uniqueTrainingPackIds.length === 0 && uniqueScenarioIds.length === 0) {
    return null;
  }

  const training: OrgTrainingRecord = {
    id: params.createTrainingId(),
    orgId: params.orgId,
    name: LEGACY_TEST_TRAINING_NAME,
    status: "active",
    description: LEGACY_TEST_TRAINING_DESCRIPTION,
    createdAt: params.now,
    updatedAt: params.now,
  };
  params.db.orgTrainings.push(training);

  for (const trainingPackId of uniqueTrainingPackIds) {
    params.db.orgTrainingPackAttachments.push({
      id: params.createPackAttachmentId(),
      orgId: params.orgId,
      trainingId: training.id,
      trainingPackId,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  for (const scenarioId of uniqueScenarioIds) {
    params.db.orgTrainingScenarioAttachments.push({
      id: params.createScenarioAttachmentId(),
      orgId: params.orgId,
      trainingId: training.id,
      scenarioId,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  return training;
}

export function replaceOrgTrainingPackAttachments(params: {
  db: OrgTrainingCollections;
  orgId: string;
  trainingId: string;
  trainingPackIds: readonly string[];
  now: string;
  createAttachmentId: () => string;
}): void {
  ensureOrgTrainingCollections(params.db);
  const requestedTrainingPackIds = new Set(params.trainingPackIds.map((entry) => entry.trim()).filter(Boolean));
  params.db.orgTrainingPackAttachments = params.db.orgTrainingPackAttachments.filter(
    (entry) =>
      !(
        entry.orgId === params.orgId &&
        (entry.trainingId === params.trainingId || requestedTrainingPackIds.has(entry.trainingPackId))
      ),
  );

  for (const trainingPackId of Array.from(requestedTrainingPackIds)) {
    params.db.orgTrainingPackAttachments.push({
      id: params.createAttachmentId(),
      orgId: params.orgId,
      trainingId: params.trainingId,
      trainingPackId,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }
}

export function replaceOrgTrainingScenarioAttachments(params: {
  db: OrgTrainingCollections;
  orgId: string;
  trainingId: string;
  scenarioIds: readonly string[];
  now: string;
  createAttachmentId: () => string;
}): void {
  ensureOrgTrainingCollections(params.db);
  const requestedScenarioIds = new Set(params.scenarioIds.map((entry) => entry.trim()).filter(Boolean));
  params.db.orgTrainingScenarioAttachments = params.db.orgTrainingScenarioAttachments.filter(
    (entry) =>
      !(
        entry.orgId === params.orgId &&
        (entry.trainingId === params.trainingId || requestedScenarioIds.has(entry.scenarioId))
      ),
  );

  for (const scenarioId of Array.from(requestedScenarioIds)) {
    params.db.orgTrainingScenarioAttachments.push({
      id: params.createAttachmentId(),
      orgId: params.orgId,
      trainingId: params.trainingId,
      scenarioId,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }
}
