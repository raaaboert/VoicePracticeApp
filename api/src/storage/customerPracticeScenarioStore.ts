import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import type {
  CustomerPracticeScenario,
  CustomerPracticeScenarioDraftRequest,
  CustomerPracticeScenarioHistoryEvent,
  CustomerPracticeScenarioHistoryEventType,
  CustomerPracticeScenarioSourceReference,
  CustomerPracticeScenarioStatus,
  CustomerPracticeScenarioVersion,
  IndustryId,
  OrgCustomScenarioProvenance,
} from "@voicepractice/shared";

import type { StorageProvider } from "../runtimeConfig.js";

type Queryable = Pick<Pool | PoolClient, "query">;
type TransactionClient = Pick<PoolClient, "query">;
export type CustomerPracticeScenarioTransactionGuard = (client: TransactionClient) => Promise<void>;
export type CustomerPracticeScenarioStoredDraft = CustomerPracticeScenarioDraftRequest & {
  sourceReferences?: CustomerPracticeScenarioSourceReference[];
};

export interface CustomerPracticeScenarioStore {
  initialize(): Promise<void>;
  listByOrg(orgId: string): Promise<CustomerPracticeScenario[]>;
  listByTopic(orgId: string, topicId: string): Promise<CustomerPracticeScenario[]>;
  get(orgId: string, scenarioId: string): Promise<CustomerPracticeScenario | null>;
  getVersion(orgId: string, scenarioId: string, versionId: string): Promise<CustomerPracticeScenarioVersion | null>;
  createDraft(input: {
    orgId: string;
    scenarioId: string;
    versionId: string;
    homeFocusTopicId: string;
    actorId: string;
    draft: CustomerPracticeScenarioStoredDraft;
    now: Date;
    guard?: CustomerPracticeScenarioTransactionGuard;
  }, client?: TransactionClient): Promise<CustomerPracticeScenario>;
  createRevision(input: {
    orgId: string;
    scenarioId: string;
    versionId: string;
    actorId: string;
    draft: CustomerPracticeScenarioStoredDraft;
    now: Date;
    guard?: CustomerPracticeScenarioTransactionGuard;
  }, client?: TransactionClient): Promise<CustomerPracticeScenario>;
  submit(input: {
    orgId: string;
    scenarioId: string;
    actorId: string;
    approvalRequired: boolean;
    now: Date;
    guard?: CustomerPracticeScenarioTransactionGuard;
  }, client?: TransactionClient): Promise<CustomerPracticeScenario>;
  review(input: {
    orgId: string;
    scenarioId: string;
    actorId: string;
    decision: "approve" | "reject";
    reviewNote?: string | null;
    now: Date;
    guard?: CustomerPracticeScenarioTransactionGuard;
  }, client?: TransactionClient): Promise<CustomerPracticeScenario>;
  publish(input: {
    orgId: string;
    scenarioId: string;
    actorId: string;
    now: Date;
    guard?: CustomerPracticeScenarioTransactionGuard;
  }, client?: TransactionClient): Promise<CustomerPracticeScenario>;
  archive(input: {
    orgId: string;
    scenarioId: string;
    actorId: string;
    now: Date;
    guard?: CustomerPracticeScenarioTransactionGuard;
  }, client?: TransactionClient): Promise<CustomerPracticeScenario>;
}

interface ScenarioRow {
  id: string;
  org_id: string;
  home_focus_topic_id: string;
  status: string;
  current_version_id: string;
  approved_version_id: string | null;
  published_version_id: string | null;
  created_by_actor_id: string;
  created_at: string | Date;
  updated_at: string | Date;
  archived_by_actor_id: string | null;
  archived_at: string | Date | null;
}

interface VersionRow {
  id: string;
  org_id: string;
  scenario_id: string;
  version_number: number | string;
  status: string;
  title: string;
  description: string;
  desired_outcome: string | null;
  ai_role: string;
  scoring_guidance: string;
  segment_id: string;
  applicable_industry_ids: unknown;
  provenance: unknown;
  source_references: unknown;
  created_by_actor_id: string;
  created_at: string | Date;
  submitted_by_actor_id: string | null;
  submitted_at: string | Date | null;
  reviewed_by_actor_id: string | null;
  reviewed_at: string | Date | null;
  review_note: string | null;
  published_by_actor_id: string | null;
  published_at: string | Date | null;
}

interface EventRow {
  id: number | string;
  scenario_id: string;
  version_id: string;
  event_type: string;
  status: string;
  actor_id: string;
  comment: string | null;
  created_at: string | Date;
}

const SCENARIO_COLUMNS = `id, org_id, home_focus_topic_id, status, current_version_id,
  approved_version_id, published_version_id, created_by_actor_id, created_at, updated_at,
  archived_by_actor_id, archived_at`;
const VERSION_COLUMNS = `id, org_id, scenario_id, version_number, status, title, description,
  desired_outcome, ai_role, scoring_guidance, segment_id, applicable_industry_ids, provenance,
  source_references, created_by_actor_id, created_at, submitted_by_actor_id, submitted_at,
  reviewed_by_actor_id, reviewed_at, review_note, published_by_actor_id, published_at`;
const STATUS_SET = new Set<CustomerPracticeScenarioStatus>([
  "draft", "in_review", "approved", "rejected", "published", "archived",
]);

export class CustomerPracticeScenarioStoreError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode = 400) {
    super(message);
    this.name = "CustomerPracticeScenarioStoreError";
  }
}

class NullCustomerPracticeScenarioStore implements CustomerPracticeScenarioStore {
  async initialize(): Promise<void> {}
  async listByOrg(): Promise<CustomerPracticeScenario[]> { return []; }
  async listByTopic(): Promise<CustomerPracticeScenario[]> { return []; }
  async get(): Promise<CustomerPracticeScenario | null> { return null; }
  async getVersion(): Promise<CustomerPracticeScenarioVersion | null> { return null; }
  async createDraft(): Promise<CustomerPracticeScenario> { return unavailable(); }
  async createRevision(): Promise<CustomerPracticeScenario> { return unavailable(); }
  async submit(): Promise<CustomerPracticeScenario> { return unavailable(); }
  async review(): Promise<CustomerPracticeScenario> { return unavailable(); }
  async publish(): Promise<CustomerPracticeScenario> { return unavailable(); }
  async archive(): Promise<CustomerPracticeScenario> { return unavailable(); }
}

class PostgresCustomerPracticeScenarioStore implements CustomerPracticeScenarioStore {
  private initialized: Promise<void> | null = null;
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = initializeSchema(this.pool);
    await this.initialized;
  }

  async listByTopic(orgId: string, topicId: string): Promise<CustomerPracticeScenario[]> {
    await this.initialize();
    const result = await this.pool.query<ScenarioRow>(
      `SELECT ${SCENARIO_COLUMNS} FROM customer_practice_scenarios
       WHERE org_id = $1 AND home_focus_topic_id = $2 ORDER BY updated_at DESC, id`,
      [id(orgId, "Organization id"), id(topicId, "Focus Topic id")],
    );
    return await hydrate(this.pool, result.rows);
  }

  async listByOrg(orgId: string): Promise<CustomerPracticeScenario[]> {
    await this.initialize();
    const result = await this.pool.query<ScenarioRow>(
      `SELECT ${SCENARIO_COLUMNS} FROM customer_practice_scenarios
       WHERE org_id = $1 ORDER BY updated_at DESC, id`,
      [id(orgId, "Organization id")],
    );
    return await hydrate(this.pool, result.rows);
  }

  async get(orgId: string, scenarioId: string): Promise<CustomerPracticeScenario | null> {
    await this.initialize();
    return await loadOne(this.pool, id(orgId, "Organization id"), id(scenarioId, "Scenario id"));
  }

  async getVersion(orgId: string, scenarioId: string, versionId: string): Promise<CustomerPracticeScenarioVersion | null> {
    await this.initialize();
    const result = await this.pool.query<VersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM customer_practice_scenario_versions
       WHERE org_id=$1 AND scenario_id=$2 AND id=$3`,
      [id(orgId, "Organization id"), id(scenarioId, "Scenario id"), id(versionId, "Scenario version id")],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }

  async createDraft(input: Parameters<CustomerPracticeScenarioStore["createDraft"]>[0], client?: TransactionClient) {
    return await this.mutate(client, async (queryClient) => {
      await input.guard?.(queryClient);
      const orgId = id(input.orgId, "Organization id");
      const scenarioId = id(input.scenarioId, "Scenario id");
      const versionId = id(input.versionId, "Scenario version id");
      const topicId = id(input.homeFocusTopicId, "Home Focus Topic id");
      const actorId = id(input.actorId, "Actor id");
      const draft = normalizeDraft(input.draft);
      await queryClient.query(
        `INSERT INTO customer_practice_scenarios
         (id,org_id,home_focus_topic_id,status,current_version_id,approved_version_id,
          published_version_id,created_by_actor_id,created_at,updated_at,archived_by_actor_id,archived_at)
         VALUES ($1,$2,$3,'draft',$4,NULL,NULL,$5,$6,$6,NULL,NULL)`,
        [scenarioId, orgId, topicId, versionId, actorId, input.now],
      );
      await insertVersion(queryClient, {
        orgId, scenarioId, versionId, versionNumber: 1, actorId, draft, now: input.now,
      });
      await insertEvent(queryClient, {
        orgId, scenarioId, versionId, eventType: "created", status: "draft", actorId, now: input.now,
      });
      return required(await loadOne(queryClient, orgId, scenarioId));
    });
  }

  async createRevision(input: Parameters<CustomerPracticeScenarioStore["createRevision"]>[0], client?: TransactionClient) {
    return await this.mutate(client, async (queryClient) => {
      await input.guard?.(queryClient);
      const orgId = id(input.orgId, "Organization id");
      const scenarioId = id(input.scenarioId, "Scenario id");
      const actorId = id(input.actorId, "Actor id");
      const aggregate = await lockScenario(queryClient, orgId, scenarioId);
      if (aggregate.status === "archived") throw conflict("Archived scenarios cannot be revised.", "scenario_archived");
      const current = await loadVersion(queryClient, orgId, aggregate.current_version_id);
      if (current.status === "in_review") {
        throw conflict("A scenario in review cannot be edited.", "scenario_in_review");
      }
      const nextNumberResult = await queryClient.query<{ next_number: number | string }>(
        `SELECT COALESCE(MAX(version_number),0)+1 AS next_number
         FROM customer_practice_scenario_versions WHERE org_id=$1 AND scenario_id=$2`,
        [orgId, scenarioId],
      );
      const versionId = id(input.versionId, "Scenario version id");
      await insertVersion(queryClient, {
        orgId, scenarioId, versionId,
        versionNumber: Number(nextNumberResult.rows[0]?.next_number ?? 1),
        actorId, draft: normalizeDraft(input.draft), now: input.now,
      });
      await queryClient.query(
        `UPDATE customer_practice_scenarios SET current_version_id=$3,status='draft',updated_at=$4
         WHERE org_id=$1 AND id=$2`,
        [orgId, scenarioId, versionId, input.now],
      );
      await insertEvent(queryClient, {
        orgId, scenarioId, versionId, eventType: "created", status: "draft", actorId, now: input.now,
      });
      return required(await loadOne(queryClient, orgId, scenarioId));
    });
  }

  async submit(input: Parameters<CustomerPracticeScenarioStore["submit"]>[0], client?: TransactionClient) {
    return await this.mutate(client, async (queryClient) => {
      await input.guard?.(queryClient);
      const orgId = id(input.orgId, "Organization id");
      const scenarioId = id(input.scenarioId, "Scenario id");
      const actorId = id(input.actorId, "Actor id");
      const aggregate = await lockScenario(queryClient, orgId, scenarioId);
      if (aggregate.status === "archived") throw conflict("Archived scenarios cannot be submitted.", "scenario_archived");
      const current = await loadVersion(queryClient, orgId, aggregate.current_version_id);
      if (current.status !== "draft" && current.status !== "rejected") {
        throw conflict("Only a draft or rejected revision can be submitted.", "scenario_transition_invalid");
      }
      const nextStatus: CustomerPracticeScenarioStatus = input.approvalRequired ? "in_review" : "approved";
      await queryClient.query(
        `UPDATE customer_practice_scenario_versions SET status=$3,submitted_by_actor_id=$4,
         submitted_at=$5,reviewed_by_actor_id=$6,reviewed_at=$7,review_note=NULL
         WHERE org_id=$1 AND id=$2`,
        [orgId, current.id, nextStatus, actorId, input.now,
          input.approvalRequired ? null : actorId, input.approvalRequired ? null : input.now],
      );
      await insertEvent(queryClient, {
        orgId, scenarioId, versionId: current.id,
        eventType: "submitted", status: nextStatus, actorId, now: input.now,
      });
      if (!input.approvalRequired) {
        await insertEvent(queryClient, {
          orgId, scenarioId, versionId: current.id,
          eventType: "approved", status: nextStatus, actorId, now: input.now,
        });
      }
      await queryClient.query(
        `UPDATE customer_practice_scenarios SET status=$3,approved_version_id=$4,updated_at=$5
         WHERE org_id=$1 AND id=$2`,
        [orgId, scenarioId, nextStatus, input.approvalRequired ? aggregate.approved_version_id : current.id, input.now],
      );
      return required(await loadOne(queryClient, orgId, scenarioId));
    });
  }

  async review(input: Parameters<CustomerPracticeScenarioStore["review"]>[0], client?: TransactionClient) {
    return await this.mutate(client, async (queryClient) => {
      await input.guard?.(queryClient);
      const orgId = id(input.orgId, "Organization id");
      const scenarioId = id(input.scenarioId, "Scenario id");
      const actorId = id(input.actorId, "Actor id");
      const aggregate = await lockScenario(queryClient, orgId, scenarioId);
      const current = await loadVersion(queryClient, orgId, aggregate.current_version_id);
      if (current.status !== "in_review") {
        throw conflict("Only a revision in review can be approved or rejected.", "scenario_transition_invalid");
      }
      const nextStatus: CustomerPracticeScenarioStatus = input.decision === "approve" ? "approved" : "rejected";
      const note = text(input.reviewNote, 2_000);
      await queryClient.query(
        `UPDATE customer_practice_scenario_versions SET status=$3,reviewed_by_actor_id=$4,
         reviewed_at=$5,review_note=$6 WHERE org_id=$1 AND id=$2`,
        [orgId, current.id, nextStatus, actorId, input.now, note],
      );
      await queryClient.query(
        `UPDATE customer_practice_scenarios SET status=$3,approved_version_id=$4,updated_at=$5
         WHERE org_id=$1 AND id=$2`,
        [orgId, scenarioId, nextStatus,
          input.decision === "approve" ? current.id : aggregate.approved_version_id, input.now],
      );
      await insertEvent(queryClient, {
        orgId, scenarioId, versionId: current.id,
        eventType: input.decision === "approve" ? "approved" : "rejected",
        status: nextStatus, actorId, comment: note, now: input.now,
      });
      return required(await loadOne(queryClient, orgId, scenarioId));
    });
  }

  async publish(input: Parameters<CustomerPracticeScenarioStore["publish"]>[0], client?: TransactionClient) {
    return await this.mutate(client, async (queryClient) => {
      await input.guard?.(queryClient);
      const orgId = id(input.orgId, "Organization id");
      const scenarioId = id(input.scenarioId, "Scenario id");
      const actorId = id(input.actorId, "Actor id");
      const aggregate = await lockScenario(queryClient, orgId, scenarioId);
      const current = await loadVersion(queryClient, orgId, aggregate.current_version_id);
      if (current.status !== "approved" || aggregate.approved_version_id !== current.id) {
        throw conflict("Only the approved current revision can be published.", "scenario_not_approved");
      }
      if (aggregate.published_version_id && aggregate.published_version_id !== current.id) {
        await queryClient.query(
          `UPDATE customer_practice_scenario_versions SET status='approved'
           WHERE org_id=$1 AND id=$2 AND status='published'`,
          [orgId, aggregate.published_version_id],
        );
      }
      await queryClient.query(
        `UPDATE customer_practice_scenario_versions SET status='published',published_by_actor_id=$3,
         published_at=$4 WHERE org_id=$1 AND id=$2`,
        [orgId, current.id, actorId, input.now],
      );
      await queryClient.query(
        `UPDATE customer_practice_scenarios SET status='published',published_version_id=$3,updated_at=$4
         WHERE org_id=$1 AND id=$2`,
        [orgId, scenarioId, current.id, input.now],
      );
      await insertEvent(queryClient, {
        orgId, scenarioId, versionId: current.id, eventType: "published",
        status: "published", actorId, now: input.now,
      });
      return required(await loadOne(queryClient, orgId, scenarioId));
    });
  }

  async archive(input: Parameters<CustomerPracticeScenarioStore["archive"]>[0], client?: TransactionClient) {
    return await this.mutate(client, async (queryClient) => {
      await input.guard?.(queryClient);
      const orgId = id(input.orgId, "Organization id");
      const scenarioId = id(input.scenarioId, "Scenario id");
      const actorId = id(input.actorId, "Actor id");
      const aggregate = await lockScenario(queryClient, orgId, scenarioId);
      if (aggregate.status === "archived") return required(await loadOne(queryClient, orgId, scenarioId));
      await queryClient.query(
        `UPDATE customer_practice_scenarios SET status='archived',archived_by_actor_id=$3,
         archived_at=$4,updated_at=$4 WHERE org_id=$1 AND id=$2`,
        [orgId, scenarioId, actorId, input.now],
      );
      await queryClient.query(
        `UPDATE customer_practice_scenario_versions SET status='archived'
         WHERE org_id=$1 AND id=$2`,
        [orgId, aggregate.current_version_id],
      );
      await insertEvent(queryClient, {
        orgId, scenarioId, versionId: aggregate.current_version_id, eventType: "archived",
        status: "archived", actorId, now: input.now,
      });
      return required(await loadOne(queryClient, orgId, scenarioId));
    });
  }

  private async mutate<T>(client: TransactionClient | undefined, work: (client: TransactionClient) => Promise<T>): Promise<T> {
    await this.initialize();
    if (client) return await work(client);
    const owned = await this.pool.connect();
    try {
      await owned.query("BEGIN");
      const result = await work(owned);
      await owned.query("COMMIT");
      return result;
    } catch (error) {
      try { await owned.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      owned.release();
    }
  }
}

async function insertVersion(client: Queryable, input: {
  orgId: string; scenarioId: string; versionId: string; versionNumber: number;
  actorId: string; draft: NormalizedDraft; now: Date;
}): Promise<void> {
  await client.query(
    `INSERT INTO customer_practice_scenario_versions
     (id,org_id,scenario_id,version_number,status,title,description,desired_outcome,ai_role,
      scoring_guidance,segment_id,applicable_industry_ids,provenance,source_references,
      created_by_actor_id,created_at,submitted_by_actor_id,submitted_at,reviewed_by_actor_id,
      reviewed_at,review_note,published_by_actor_id,published_at)
     VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,
      $14,$15,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
    [input.versionId, input.orgId, input.scenarioId, input.versionNumber, input.draft.title,
      input.draft.description, input.draft.desiredOutcome, input.draft.aiRole,
      input.draft.scoringGuidance, input.draft.segmentId,
      JSON.stringify(input.draft.applicableIndustryIds), JSON.stringify(input.draft.provenance),
      JSON.stringify(input.draft.sourceReferences), input.actorId, input.now],
  );
}

async function insertEvent(client: Queryable, input: {
  orgId: string; scenarioId: string; versionId: string;
  eventType: CustomerPracticeScenarioHistoryEventType; status: CustomerPracticeScenarioStatus;
  actorId: string; comment?: string | null; now: Date;
}): Promise<void> {
  await client.query(
    `INSERT INTO customer_practice_scenario_events
     (org_id,scenario_id,version_id,event_type,status,actor_id,comment,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT ON CONSTRAINT customer_practice_scenario_events_natural_unique DO NOTHING`,
    [input.orgId, input.scenarioId, input.versionId, input.eventType, input.status,
      input.actorId, input.comment ?? null, input.now],
  );
}

async function lockScenario(client: Queryable, orgId: string, scenarioId: string): Promise<ScenarioRow> {
  const result = await client.query<ScenarioRow>(
    `SELECT ${SCENARIO_COLUMNS} FROM customer_practice_scenarios
     WHERE org_id=$1 AND id=$2 FOR UPDATE`, [orgId, scenarioId],
  );
  if (!result.rows[0]) throw new CustomerPracticeScenarioStoreError("Practice Scenario not found.", "scenario_not_found", 404);
  return result.rows[0];
}

async function loadVersion(client: Queryable, orgId: string, versionId: string): Promise<VersionRow> {
  const result = await client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM customer_practice_scenario_versions WHERE org_id=$1 AND id=$2`,
    [orgId, versionId],
  );
  if (!result.rows[0]) throw new Error("Practice Scenario version pointer is invalid.");
  return result.rows[0];
}

async function loadOne(client: Queryable, orgId: string, scenarioId: string): Promise<CustomerPracticeScenario | null> {
  const result = await client.query<ScenarioRow>(
    `SELECT ${SCENARIO_COLUMNS} FROM customer_practice_scenarios WHERE org_id=$1 AND id=$2`,
    [orgId, scenarioId],
  );
  return (await hydrate(client, result.rows))[0] ?? null;
}

async function hydrate(client: Queryable, rows: ScenarioRow[]): Promise<CustomerPracticeScenario[]> {
  if (rows.length === 0) return [];
  const scenarioIds = rows.map((row) => row.id);
  const versions = await client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM customer_practice_scenario_versions
     WHERE scenario_id = ANY($1::text[]) ORDER BY scenario_id, version_number`,
    [scenarioIds],
  );
  const events = await client.query<EventRow>(
    `SELECT id,scenario_id,version_id,event_type,status,actor_id,comment,created_at
     FROM customer_practice_scenario_events WHERE scenario_id = ANY($1::text[])
     ORDER BY scenario_id,created_at,id`,
    [scenarioIds],
  );
  const byId = new Map(versions.rows.map((row) => [row.id, mapVersion(row)]));
  const versionsByScenario = new Map<string, CustomerPracticeScenarioVersion[]>();
  for (const version of byId.values()) {
    const values = versionsByScenario.get(version.scenarioId) ?? [];
    values.push(version);
    versionsByScenario.set(version.scenarioId, values);
  }
  const eventsByScenario = new Map<string, CustomerPracticeScenarioHistoryEvent[]>();
  for (const row of events.rows) {
    const values = eventsByScenario.get(row.scenario_id) ?? [];
    values.push(mapEvent(row));
    eventsByScenario.set(row.scenario_id, values);
  }
  return rows.map((row) => {
    const currentVersion = byId.get(row.current_version_id);
    if (!currentVersion) throw new Error("Practice Scenario current version is missing.");
    return {
      id: row.id,
      orgId: row.org_id,
      homeFocusTopicId: row.home_focus_topic_id,
      status: status(row.status),
      currentVersionId: row.current_version_id,
      approvedVersionId: row.approved_version_id,
      publishedVersionId: row.published_version_id,
      createdByActorId: row.created_by_actor_id,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      archivedByActorId: row.archived_by_actor_id,
      archivedAt: optionalIso(row.archived_at),
      currentVersion,
      publishedVersion: row.published_version_id ? byId.get(row.published_version_id) ?? null : null,
      versions: versionsByScenario.get(row.id) ?? [],
      history: eventsByScenario.get(row.id) ?? [],
    };
  });
}

function mapEvent(row: EventRow): CustomerPracticeScenarioHistoryEvent {
  const eventType = row.event_type as CustomerPracticeScenarioHistoryEventType;
  if (!["created", "submitted", "approved", "rejected", "published", "archived"].includes(eventType)) {
    throw new Error("Practice Scenario history event type is invalid.");
  }
  return {
    id: String(row.id), scenarioId: row.scenario_id, versionId: row.version_id,
    eventType, status: status(row.status), actorId: row.actor_id,
    comment: row.comment, createdAt: iso(row.created_at),
  };
}

function mapVersion(row: VersionRow): CustomerPracticeScenarioVersion {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    orgId: row.org_id,
    versionNumber: Number(row.version_number),
    status: status(row.status),
    title: row.title,
    description: row.description,
    desiredOutcome: row.desired_outcome,
    aiRole: row.ai_role,
    scoringGuidance: row.scoring_guidance,
    segmentId: row.segment_id,
    applicableIndustryIds: strings(row.applicable_industry_ids) as IndustryId[],
    provenance: object(row.provenance) as unknown as OrgCustomScenarioProvenance,
    sourceReferences: normalizeReferences(row.source_references),
    createdByActorId: row.created_by_actor_id,
    createdAt: iso(row.created_at),
    submittedByActorId: row.submitted_by_actor_id,
    submittedAt: optionalIso(row.submitted_at),
    reviewedByActorId: row.reviewed_by_actor_id,
    reviewedAt: optionalIso(row.reviewed_at),
    reviewNote: row.review_note,
    publishedByActorId: row.published_by_actor_id,
    publishedAt: optionalIso(row.published_at),
  };
}

interface NormalizedDraft extends CustomerPracticeScenarioStoredDraft {
  desiredOutcome: string | null;
  provenance: OrgCustomScenarioProvenance;
  sourceReferences: CustomerPracticeScenarioSourceReference[];
}

function normalizeDraft(input: CustomerPracticeScenarioStoredDraft): NormalizedDraft {
  const title = requiredText(input.title, "Title", 300);
  const description = requiredText(input.description, "Description", 12_000);
  const aiRole = requiredText(input.aiRole, "AI role", 2_000);
  const scoringGuidance = requiredText(input.scoringGuidance, "Scoring guidance", 8_000);
  const segmentId = id(input.segmentId, "Role");
  const applicableIndustryIds = strings(input.applicableIndustryIds);
  if (applicableIndustryIds.length === 0) {
    throw new CustomerPracticeScenarioStoreError("At least one applicable industry is required.", "scenario_validation_failed");
  }
  return {
    title, description, aiRole, scoringGuidance, segmentId,
    desiredOutcome: text(input.desiredOutcome, 4_000),
    applicableIndustryIds: applicableIndustryIds as IndustryId[],
    provenance: { sourceMode: "scratch", creationMethod: "manual" },
    sourceReferences: normalizeReferences(input.sourceReferences ?? []),
  };
}

function normalizeReferences(value: unknown): CustomerPracticeScenarioSourceReference[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).map((candidate) => {
    const row = object(candidate);
    const kind = row.kind === "training_content" || row.kind === "external" ? row.kind : "manual";
    return {
      kind,
      referenceId: text(row.referenceId, 300),
      label: requiredText(row.label, "Source reference label", 500),
    };
  });
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim()).filter(Boolean))];
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function requiredText(value: unknown, label: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim().slice(0, max) : "";
  if (!normalized) throw new CustomerPracticeScenarioStoreError(`${label} is required.`, "scenario_validation_failed");
  return normalized;
}
function text(value: unknown, max: number): string | null {
  const normalized = typeof value === "string" ? value.trim().slice(0, max) : "";
  return normalized || null;
}
function id(value: string, label: string): string { return requiredText(value, label, 300); }
function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Practice Scenario timestamp is invalid.");
  return parsed.toISOString();
}
function optionalIso(value: string | Date | null): string | null { return value ? iso(value) : null; }
function status(value: string): CustomerPracticeScenarioStatus {
  if (!STATUS_SET.has(value as CustomerPracticeScenarioStatus)) throw new Error("Practice Scenario status is invalid.");
  return value as CustomerPracticeScenarioStatus;
}
function required<T>(value: T | null): T { if (!value) throw new Error("Practice Scenario write did not return a row."); return value; }
function conflict(message: string, code: string) { return new CustomerPracticeScenarioStoreError(message, code, 409); }
function unavailable(): never { throw new CustomerPracticeScenarioStoreError("Practice Scenario lifecycle requires PostgreSQL storage.", "scenario_storage_unavailable", 503); }

async function readMigration(): Promise<string> {
  const candidates = [
    new URL("../../sql/019_customer_practice_scenarios.sql", import.meta.url),
    new URL("../sql/019_customer_practice_scenarios.sql", import.meta.url),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try { return await readFile(candidate, "utf8"); } catch (error) { lastError = error; }
  }
  throw new Error("Customer Practice Scenario migration is missing from the runtime artifact.", { cause: lastError });
}

async function initializeSchema(pool: Pool): Promise<void> {
  const sql = await readMigration();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('peritio_customer_practice_scenarios_v1', 0))");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export function createCustomerPracticeScenarioStore(params: {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  pool?: Pool;
}): CustomerPracticeScenarioStore {
  if (params.provider !== "postgres") return new NullCustomerPracticeScenarioStore();
  if (!params.databaseUrl) throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  return new PostgresCustomerPracticeScenarioStore(params.pool ?? new Pool({
    connectionString: params.databaseUrl,
    max: params.pgPoolMax,
    connectionTimeoutMillis: params.pgConnectTimeoutMs,
    idleTimeoutMillis: params.pgIdleTimeoutMs,
    keepAlive: true,
  }));
}
