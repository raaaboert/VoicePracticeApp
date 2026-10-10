import { readFile } from "node:fs/promises";

import { Pool, type PoolClient } from "pg";

import type { StorageProvider } from "../runtimeConfig.js";
import type { FocusTopicAssignment } from "../services/focusTopicAuthority.js";
import {
  FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION,
  FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION,
} from "../services/focusTopicAuthorityBackfill.js";
import type {
  FocusTopicAuthorityBackfillPlan,
  FocusTopicContentAttachment,
  FocusTopicScenarioAttachment,
} from "../services/focusTopicAuthorityBackfill.js";

export interface FocusTopicAuthoritySnapshot {
  assignments: FocusTopicAssignment[];
  scenarioAttachments: FocusTopicScenarioAttachment[];
  contentAttachments: FocusTopicContentAttachment[];
}

export interface FocusTopicBackfillRunRecord {
  id: string;
  runVersion: string;
  mode: "apply";
  schemaGeneration: string;
  inputFingerprint: string;
  resultSummary: Record<string, unknown>;
  executedAt: string;
  validatedAt: string | null;
  validatedBy: string | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
}

export interface FocusTopicAuthorityStore {
  initialize(): Promise<void>;
  assertAssignmentsReady(): Promise<void>;
  listSnapshot(orgId?: string): Promise<FocusTopicAuthoritySnapshot>;
  createAssignment(row: FocusTopicAssignment, client: Pick<PoolClient, "query">): Promise<FocusTopicAssignment>;
  revokeAssignment(input: {
    orgId: string; topicId: string; assignmentId: string; actorId: string; at: Date;
  }, client: Pick<PoolClient, "query">): Promise<FocusTopicAssignment>;
  attachScenario(row: FocusTopicScenarioAttachment, client: Pick<PoolClient, "query">): Promise<FocusTopicScenarioAttachment>;
  detachScenario(input: { orgId: string; topicId: string; attachmentId: string; actorId: string; at: Date },
    client: Pick<PoolClient, "query">): Promise<FocusTopicScenarioAttachment>;
  attachContent(row: FocusTopicContentAttachment, client: Pick<PoolClient, "query">): Promise<FocusTopicContentAttachment>;
  detachContent(input: { orgId: string; topicId: string; attachmentId: string; actorId: string; at: Date },
    client: Pick<PoolClient, "query">): Promise<FocusTopicContentAttachment>;
  applyBackfillPlan(input: {
    plan: FocusTopicAuthorityBackfillPlan;
    validTopicKeys: ReadonlySet<string>;
  }): Promise<FocusTopicBackfillRunRecord>;
  hasTopicReferences(orgId: string, topicId: string): Promise<boolean>;
  markBackfillValidated(input: {
    runId: string;
    validatedBy: string;
    at?: Date;
  }): Promise<FocusTopicBackfillRunRecord>;
  markBackfillSignedOff(input: {
    runId: string;
    signedOffBy: string;
    at?: Date;
  }): Promise<FocusTopicBackfillRunRecord>;
}

const ACTIVE_ASSIGNMENT_UNIQUE_CONSTRAINTS = new Set([
  "focus_topic_assignments_active_broad_uidx",
  "focus_topic_assignments_active_targeted_uidx",
]);

export function isDuplicateActiveFocusTopicAssignmentError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === "23505"
    && typeof record.constraint === "string"
    && ACTIVE_ASSIGNMENT_UNIQUE_CONSTRAINTS.has(record.constraint);
}

export function isDuplicateActiveFocusTopicContentAttachmentError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === "23505"
    && record.constraint === "org_content_topic_attachments_active_uidx";
}

type QueryPool = Pick<Pool, "query" | "connect">;

class NullFocusTopicAuthorityStore implements FocusTopicAuthorityStore {
  async initialize(): Promise<void> {}
  async assertAssignmentsReady(): Promise<void> {
    throw new Error("Focus Topic assignment authority requires PostgreSQL and a validated, signed-off backfill APPLY run.");
  }
  async listSnapshot(): Promise<FocusTopicAuthoritySnapshot> {
    return { assignments: [], scenarioAttachments: [], contentAttachments: [] };
  }
  async createAssignment(): Promise<FocusTopicAssignment> { throw new Error("Focus Topic assignments require PostgreSQL."); }
  async revokeAssignment(): Promise<FocusTopicAssignment> { throw new Error("Focus Topic assignments require PostgreSQL."); }
  async attachScenario(): Promise<FocusTopicScenarioAttachment> { throw new Error("Focus Topic attachments require PostgreSQL."); }
  async detachScenario(): Promise<FocusTopicScenarioAttachment> { throw new Error("Focus Topic attachments require PostgreSQL."); }
  async attachContent(): Promise<FocusTopicContentAttachment> { throw new Error("Focus Topic attachments require PostgreSQL."); }
  async detachContent(): Promise<FocusTopicContentAttachment> { throw new Error("Focus Topic attachments require PostgreSQL."); }
  async applyBackfillPlan(): Promise<FocusTopicBackfillRunRecord> {
    throw new Error("Focus Topic authority backfill requires postgres storage.");
  }
  async hasTopicReferences(): Promise<boolean> { return false; }
  async markBackfillValidated(): Promise<FocusTopicBackfillRunRecord> {
    throw new Error("Focus Topic authority backfill requires postgres storage.");
  }
  async markBackfillSignedOff(): Promise<FocusTopicBackfillRunRecord> {
    throw new Error("Focus Topic authority backfill requires postgres storage.");
  }
}

class PostgresFocusTopicAuthorityStore implements FocusTopicAuthorityStore {
  private initialized: Promise<void> | null = null;
  constructor(private readonly pool: QueryPool) {}

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = initializeSchema(this.pool);
    await this.initialized;
  }

  async assertAssignmentsReady(): Promise<void> {
    await this.initialize();
    const result = await this.pool.query<BackfillRunRow>(
      `SELECT * FROM focus_topic_backfill_runs
       WHERE mode = 'apply'
       ORDER BY executed_at DESC, id DESC LIMIT 1`,
    );
    const run = result.rows[0];
    if (!run || run.run_version !== FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION
      || run.schema_generation !== FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION
      || !run.validated_at || !run.validated_by || !run.signed_off_at || !run.signed_off_by
      || !/^[a-f0-9]{64}$/.test(run.input_fingerprint)
      || run.result_summary.issueCount !== 0
      || !["assignmentCount", "scenarioAttachmentCount", "contentAttachmentCount"].every(
        (key) => Number.isSafeInteger(run.result_summary[key]) && Number(run.result_summary[key]) >= 0
      )
      || Number(run.result_summary.assignmentCount) === 0) {
      throw new Error("Focus Topic assignment authority requires a valid, signed-off backfill APPLY run for the expected schema and version.");
    }
    const counts = await this.pool.query<{
      assignment_count: string; scenario_count: string; content_count: string;
    }>(`SELECT
      (SELECT COUNT(*) FROM focus_topic_assignments)::text AS assignment_count,
      (SELECT COUNT(*) FROM focus_topic_scenario_attachments)::text AS scenario_count,
      (SELECT COUNT(*) FROM org_content_topic_attachments)::text AS content_count`);
    const row = counts.rows[0];
    if (!row
      || Number(row.assignment_count) < Number(run.result_summary.assignmentCount)
      || Number(row.scenario_count) < Number(run.result_summary.scenarioAttachmentCount)
      || Number(row.content_count) < Number(run.result_summary.contentAttachmentCount)) {
      throw new Error("Focus Topic assignment authority rows do not match the signed-off backfill run.");
    }
  }

  async listSnapshot(orgId?: string): Promise<FocusTopicAuthoritySnapshot> {
    await this.initialize();
    const where = orgId ? "WHERE org_id = $1" : "";
    const params = orgId ? [requiredId(orgId, "Organization id")] : [];
    const [assignments, scenarios, content] = await Promise.all([
      this.pool.query<AssignmentRow>(`SELECT * FROM focus_topic_assignments ${where} ORDER BY org_id, topic_id, id`, params),
      this.pool.query<ScenarioRow>(`SELECT * FROM focus_topic_scenario_attachments ${where} ORDER BY org_id, topic_id, id`, params),
      this.pool.query<ContentRow>(`SELECT * FROM org_content_topic_attachments ${where} ORDER BY org_id, topic_id, id`, params),
    ]);
    return {
      assignments: assignments.rows.map(mapAssignment),
      scenarioAttachments: scenarios.rows.map(mapScenario),
      contentAttachments: content.rows.map(mapContent),
    };
  }

  async createAssignment(row: FocusTopicAssignment, client: Pick<PoolClient, "query">): Promise<FocusTopicAssignment> {
    await this.initialize();
    if (row.revokedAt || row.revokedBy) {
      throw new Error("New Focus Topic assignments must be active.");
    }
    const targeted = row.audience === "individual" || row.audience === "manager_only"
      || row.audience === "manager_with_team";
    if (row.grantsManagement && row.audience !== "individual" && row.audience !== "manager_only") {
      throw new Error("Focus Topic management grants must use individual or manager_only audience.");
    }
    const inserted = await client.query<AssignmentRow>(
      `INSERT INTO focus_topic_assignments (
         id, org_id, topic_id, audience, subject_user_id, grants_management,
         due_date, created_by, created_at, revoked_by, revoked_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL) RETURNING *`,
      [row.id, row.orgId, row.topicId, row.audience, row.subjectUserId,
        row.grantsManagement, row.dueDate, row.createdBy, row.createdAt],
    );
    return mapAssignment(requiredRow(inserted.rows[0], "Created Focus Topic assignment"));
  }

  async revokeAssignment(input: {
    orgId: string; topicId: string; assignmentId: string; actorId: string; at: Date;
  }, client: Pick<PoolClient, "query">): Promise<FocusTopicAssignment> {
    await this.initialize();
    const updated = await client.query<AssignmentRow>(
      `UPDATE focus_topic_assignments SET revoked_by = $4, revoked_at = $5
       WHERE id = $1 AND org_id = $2 AND topic_id = $3 AND revoked_at IS NULL
       RETURNING *`,
      [input.assignmentId, input.orgId, input.topicId, input.actorId, input.at],
    );
    return mapAssignment(requiredRow(updated.rows[0], "Active Focus Topic assignment"));
  }

  async attachScenario(row: FocusTopicScenarioAttachment, client: Pick<PoolClient, "query">): Promise<FocusTopicScenarioAttachment> {
    await this.initialize();
    if (row.detachedAt || row.detachedBy) throw new Error("New Focus Topic attachment must be active.");
    const result = await client.query<ScenarioRow>(
      `INSERT INTO focus_topic_scenario_attachments
       (id,org_id,topic_id,scenario_kind,scenario_id,attached_by,attached_at,detached_by,detached_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL) RETURNING *`,
      [row.id,row.orgId,row.topicId,row.scenarioKind,row.scenarioId,row.attachedBy,row.attachedAt],
    );
    return mapScenario(requiredRow(result.rows[0], "Created Focus Topic scenario attachment"));
  }

  async detachScenario(input: { orgId: string; topicId: string; attachmentId: string; actorId: string; at: Date },
    client: Pick<PoolClient, "query">): Promise<FocusTopicScenarioAttachment> {
    await this.initialize();
    const result = await client.query<ScenarioRow>(
      `UPDATE focus_topic_scenario_attachments SET detached_by=$4, detached_at=$5
       WHERE id=$1 AND org_id=$2 AND topic_id=$3 AND detached_at IS NULL RETURNING *`,
      [input.attachmentId,input.orgId,input.topicId,input.actorId,input.at],
    );
    return mapScenario(requiredRow(result.rows[0], "Active Focus Topic scenario attachment"));
  }

  async attachContent(row: FocusTopicContentAttachment, client: Pick<PoolClient, "query">): Promise<FocusTopicContentAttachment> {
    await this.initialize();
    if (row.detachedAt || row.detachedBy) throw new Error("New Focus Topic attachment must be active.");
    const result = await client.query<ContentRow>(
      `INSERT INTO org_content_topic_attachments
       (id,org_id,content_id,topic_id,attached_by,attached_at,detached_by,detached_at)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL) RETURNING *`,
      [row.id,row.orgId,row.contentId,row.topicId,row.attachedBy,row.attachedAt],
    );
    return mapContent(requiredRow(result.rows[0], "Created Focus Topic content attachment"));
  }

  async detachContent(input: { orgId: string; topicId: string; attachmentId: string; actorId: string; at: Date },
    client: Pick<PoolClient, "query">): Promise<FocusTopicContentAttachment> {
    await this.initialize();
    const result = await client.query<ContentRow>(
      `UPDATE org_content_topic_attachments SET detached_by=$4, detached_at=$5
       WHERE id=$1 AND org_id=$2 AND topic_id=$3 AND detached_at IS NULL RETURNING *`,
      [input.attachmentId,input.orgId,input.topicId,input.actorId,input.at],
    );
    return mapContent(requiredRow(result.rows[0], "Active Focus Topic content attachment"));
  }

  async applyBackfillPlan(input: {
    plan: FocusTopicAuthorityBackfillPlan;
    validTopicKeys: ReadonlySet<string>;
  }): Promise<FocusTopicBackfillRunRecord> {
    await this.initialize();
    assertPlanTopics(input.plan, input.validTopicKeys);
    if (input.plan.issues.length > 0) {
      throw new Error("Focus Topic authority backfill plan contains unresolved integrity issues.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('peritio_focus_topic_authority_backfill_v1', 0))");
      for (const row of input.plan.assignments) await insertAssignment(client, row);
      for (const row of input.plan.scenarioAttachments) await insertScenario(client, row);
      for (const row of input.plan.contentAttachments) await insertContent(client, row);
      const runId = `ftbr_${input.plan.inputFingerprint.slice(0, 32)}`;
      const run = await client.query<BackfillRunRow>(
        `INSERT INTO focus_topic_backfill_runs (
           id, run_version, mode, schema_generation, input_fingerprint, result_summary,
           executed_at, validated_at, validated_by, signed_off_at, signed_off_by
         ) VALUES ($1, $2, 'apply', $3, $4, $5::jsonb, $6, NULL, NULL, NULL, NULL)
         ON CONFLICT (run_version, schema_generation, input_fingerprint) DO UPDATE
           SET result_summary = EXCLUDED.result_summary
         RETURNING *`,
        [runId, input.plan.version, input.plan.schemaGeneration, input.plan.inputFingerprint,
          JSON.stringify(input.plan.summary), input.plan.capturedAt]
      );
      await client.query("COMMIT");
      return mapRun(requiredRow(run.rows[0], "Backfill run"));
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async hasTopicReferences(orgId: string, topicId: string): Promise<boolean> {
    await this.initialize();
    const result = await this.pool.query<{ referenced: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM focus_topic_assignments WHERE org_id = $1 AND topic_id = $2
         UNION ALL SELECT 1 FROM focus_topic_scenario_attachments WHERE org_id = $1 AND topic_id = $2
         UNION ALL SELECT 1 FROM org_content_topic_attachments WHERE org_id = $1 AND topic_id = $2
       ) AS referenced`,
      [requiredId(orgId, "Organization id"), requiredId(topicId, "Topic id")]
    );
    return result.rows[0]?.referenced === true;
  }

  async markBackfillValidated(input: { runId: string; validatedBy: string; at?: Date }): Promise<FocusTopicBackfillRunRecord> {
    await this.initialize();
    const result = await this.pool.query<BackfillRunRow>(
      `UPDATE focus_topic_backfill_runs SET validated_at = $2, validated_by = $3
       WHERE id = $1 RETURNING *`,
      [requiredId(input.runId, "Run id"), input.at ?? new Date(), requiredId(input.validatedBy, "Validator")]
    );
    return mapRun(requiredRow(result.rows[0], "Backfill run"));
  }

  async markBackfillSignedOff(input: { runId: string; signedOffBy: string; at?: Date }): Promise<FocusTopicBackfillRunRecord> {
    await this.initialize();
    const result = await this.pool.query<BackfillRunRow>(
      `UPDATE focus_topic_backfill_runs SET signed_off_at = $2, signed_off_by = $3
       WHERE id = $1 AND validated_at IS NOT NULL RETURNING *`,
      [requiredId(input.runId, "Run id"), input.at ?? new Date(), requiredId(input.signedOffBy, "Signer")]
    );
    return mapRun(requiredRow(result.rows[0], "Validated backfill run"));
  }
}

interface AssignmentRow { id:string; org_id:string; topic_id:string; audience:FocusTopicAssignment["audience"]; subject_user_id:string|null; grants_management:boolean; due_date:string|Date|null; created_by:string; created_at:string|Date; revoked_by:string|null; revoked_at:string|Date|null }
interface ScenarioRow { id:string; org_id:string; topic_id:string; scenario_kind:"standard"|"org"; scenario_id:string; attached_by:string; attached_at:string|Date; detached_by:string|null; detached_at:string|Date|null }
interface ContentRow { id:string; org_id:string; content_id:string; topic_id:string; attached_by:string; attached_at:string|Date; detached_by:string|null; detached_at:string|Date|null }
interface BackfillRunRow { id:string; run_version:string; mode:"apply"; schema_generation:string; input_fingerprint:string; result_summary:Record<string,unknown>; executed_at:string|Date; validated_at:string|Date|null; validated_by:string|null; signed_off_at:string|Date|null; signed_off_by:string|null }

async function insertAssignment(client: Pick<PoolClient,"query">, row: FocusTopicAssignment): Promise<void> {
  await client.query(
    `INSERT INTO focus_topic_assignments (id,org_id,topic_id,audience,subject_user_id,grants_management,due_date,created_by,created_at,revoked_by,revoked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [row.id,row.orgId,row.topicId,row.audience,row.subjectUserId,row.grantsManagement,row.dueDate,row.createdBy,row.createdAt,row.revokedBy,row.revokedAt]
  );
}
async function insertScenario(client: Pick<PoolClient,"query">, row: FocusTopicScenarioAttachment): Promise<void> {
  await client.query(
    `INSERT INTO focus_topic_scenario_attachments VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO NOTHING`,
    [row.id,row.orgId,row.topicId,row.scenarioKind,row.scenarioId,row.attachedBy,row.attachedAt,row.detachedBy,row.detachedAt]
  );
}
async function insertContent(client: Pick<PoolClient,"query">, row: FocusTopicContentAttachment): Promise<void> {
  await client.query(
    `INSERT INTO org_content_topic_attachments VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING`,
    [row.id,row.orgId,row.contentId,row.topicId,row.attachedBy,row.attachedAt,row.detachedBy,row.detachedAt]
  );
}

function assertPlanTopics(plan: FocusTopicAuthorityBackfillPlan, valid: ReadonlySet<string>): void {
  for (const row of [...plan.assignments, ...plan.scenarioAttachments, ...plan.contentAttachments]) {
    if (!valid.has(`${row.orgId}:${row.topicId}`)) {
      throw new Error(`Focus Topic ${row.orgId}/${row.topicId} is not present in authoritative app_state.`);
    }
  }
}

function mapAssignment(row:AssignmentRow):FocusTopicAssignment { return {id:row.id,orgId:row.org_id,topicId:row.topic_id,audience:row.audience,subjectUserId:row.subject_user_id,grantsManagement:row.grants_management,dueDate:row.due_date ? (row.due_date instanceof Date ? row.due_date.toISOString().slice(0,10) : row.due_date.slice(0,10)) : null,createdBy:row.created_by,createdAt:iso(row.created_at),revokedBy:row.revoked_by,revokedAt:optionalIso(row.revoked_at)}; }
function mapScenario(row:ScenarioRow):FocusTopicScenarioAttachment { return {id:row.id,orgId:row.org_id,topicId:row.topic_id,scenarioKind:row.scenario_kind,scenarioId:row.scenario_id,attachedBy:row.attached_by,attachedAt:iso(row.attached_at),detachedBy:row.detached_by,detachedAt:optionalIso(row.detached_at)}; }
function mapContent(row:ContentRow):FocusTopicContentAttachment { return {id:row.id,orgId:row.org_id,contentId:row.content_id,topicId:row.topic_id,attachedBy:row.attached_by,attachedAt:iso(row.attached_at),detachedBy:row.detached_by,detachedAt:optionalIso(row.detached_at)}; }
function mapRun(row:BackfillRunRow):FocusTopicBackfillRunRecord { return {id:row.id,runVersion:row.run_version,mode:row.mode,schemaGeneration:row.schema_generation,inputFingerprint:row.input_fingerprint,resultSummary:row.result_summary,executedAt:iso(row.executed_at),validatedAt:optionalIso(row.validated_at),validatedBy:row.validated_by,signedOffAt:optionalIso(row.signed_off_at),signedOffBy:row.signed_off_by}; }
function iso(value:string|Date):string { const date=value instanceof Date?value:new Date(value); if(Number.isNaN(date.getTime()))throw new Error("Invalid database timestamp."); return date.toISOString(); }
function optionalIso(value:string|Date|null):string|null { return value===null?null:iso(value); }
function requiredId(value:string,label:string):string { const normalized=value.trim(); if(!normalized)throw new Error(`${label} is required.`); return normalized; }
function requiredRow<T>(value:T|undefined,label:string):T { if(!value)throw new Error(`${label} was not found.`); return value; }
async function rollbackQuietly(client:Pick<PoolClient,"query">):Promise<void>{try{await client.query("ROLLBACK");}catch{}}

async function initializeSchema(pool: QueryPool): Promise<void> {
  const migrations = await Promise.all([
    readFocusTopicMigration("015_focus_topic_authority.sql"),
    readFocusTopicMigration("017_focus_topic_management_authority.sql"),
    readFocusTopicMigration("020_focus_topic_assignment_due_dates.sql"),
  ]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('peritio_focus_topic_authority_schema_v1', 0))",
    );
    for (const migration of migrations) await client.query(migration);
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw new Error("Focus Topic authority migration SQL could not be applied.", { cause: error });
  } finally {
    client.release();
  }
}

async function readFocusTopicMigration(filename: string): Promise<string> {
  const candidates = [
    new URL(`../../sql/${filename}`, import.meta.url),
    new URL(`../sql/${filename}`, import.meta.url),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try { return await readFile(candidate, "utf8"); } catch (error) { lastError = error; }
  }
  throw new Error(`Focus Topic authority migration ${filename} is missing from the runtime artifact.`, {
    cause: lastError,
  });
}

export function createFocusTopicAuthorityStore(params: {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: QueryPool;
}): FocusTopicAuthorityStore {
  if (params.provider !== "postgres") return new NullFocusTopicAuthorityStore();
  if (!params.databaseUrl) throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  const pool = params.queryPool ?? new Pool({
    connectionString: params.databaseUrl, max: params.pgPoolMax,
    connectionTimeoutMillis: params.pgConnectTimeoutMs,
    idleTimeoutMillis: params.pgIdleTimeoutMs, keepAlive: true,
  });
  return new PostgresFocusTopicAuthorityStore(pool);
}
