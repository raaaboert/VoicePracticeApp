import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import type { StorageProvider } from "../runtimeConfig.js";
import { inferDatabaseTargetEnvironment, type ScriptTargetEnvironment } from "../productionSafety.js";
import type { FocusTopicAssignment } from "../services/focusTopicAuthority.js";
import {
  FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION,
  FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION,
  FOCUS_TOPIC_BACKFILL_ACTOR,
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
    targetEnvironment?: ScriptTargetEnvironment;
  }): Promise<FocusTopicBackfillRunRecord>;
  hasTopicReferences(orgId: string, topicId: string): Promise<boolean>;
  markBackfillValidated(input: {
    runId: string;
    validatedBy: string;
    plan: FocusTopicAuthorityBackfillPlan;
    targetEnvironment: ScriptTargetEnvironment;
    at?: Date;
  }, client?: Pick<PoolClient, "query">): Promise<FocusTopicBackfillRunRecord>;
  markBackfillSignedOff(input: {
    runId: string;
    signedOffBy: string;
    plan: FocusTopicAuthorityBackfillPlan;
    targetEnvironment: ScriptTargetEnvironment;
    acknowledgeEmpty?: boolean;
    at?: Date;
  }, client?: Pick<PoolClient, "query">): Promise<FocusTopicBackfillRunRecord>;
}

const ACTIVE_ASSIGNMENT_UNIQUE_CONSTRAINTS = new Set([
  "focus_topic_assignments_active_broad_uidx",
  "focus_topic_assignments_active_targeted_uidx",
  "focus_topic_assignments_active_learner_targeted_uidx",
  "focus_topic_assignments_active_management_person_uidx",
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

export function isDuplicateActiveFocusTopicScenarioAttachmentError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === "23505"
    && record.constraint === "focus_topic_scenario_attachments_active_uidx";
}

type QueryPool = Pick<Pool, "query" | "connect">;

export class FocusTopicBackfillValidationError extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : "Backfill validation failed.", { cause }); }
}

export function assertBackfillRunNotFinalized(signedOffAt: unknown): void {
  if (signedOffAt) throw new Error("Backfill run is finalized; it must not be revalidated or signed off again. Original approval remains unchanged.");
}

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
  constructor(private readonly pool: QueryPool, private readonly databaseUrl: string) {}

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
      || (Number(run.result_summary.assignmentCount) === 0 && !validEmptyAcknowledgment(run))) {
      throw new Error("Focus Topic assignment authority requires a valid, signed-off backfill APPLY run for the expected schema and version.");
    }
    const evidence = run.result_summary.validation as ValidationEvidence | undefined;
    // Older nonempty signed-off runs retain their existing readiness contract.
    if (evidence || run.result_summary.targetEnvironment !== undefined || run.result_summary.databaseIdentity !== undefined
      || Number(run.result_summary.assignmentCount) === 0) {
      if (!validEvidence(run) || run.result_summary.targetEnvironment !== (inferDatabaseTargetEnvironment(this.databaseUrl) ?? run.result_summary.targetEnvironment)
        || run.result_summary.databaseIdentity !== await databaseIdentity(this.pool)
        || await persistedRowsFingerprint(this.pool, evidence!) !== evidence!.rowsFingerprint) {
        throw new Error("Focus Topic assignment authority validation evidence is inconsistent or stale.");
      }
      await assertActiveBackfillSet(this.pool, evidence!, false);
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
         created_by, created_at, revoked_by, revoked_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL) RETURNING *`,
      [row.id, row.orgId, row.topicId, row.audience, row.subjectUserId,
        row.grantsManagement, row.createdBy, row.createdAt],
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
    targetEnvironment?: ScriptTargetEnvironment;
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
      const binding = input.targetEnvironment ? {
        targetEnvironment: input.targetEnvironment, databaseIdentity: await databaseIdentity(client),
      } : {};
      const runId = `ftbr_${input.plan.inputFingerprint.slice(0, 32)}`;
      const latestRunId = (await client.query<{ id: string }>(
        "SELECT id FROM focus_topic_backfill_runs ORDER BY executed_at DESC, id DESC LIMIT 1",
      )).rows[0]?.id ?? null;
      const preserveReview = "focus_topic_backfill_runs.id = $7 AND focus_topic_backfill_runs.result_summary->'validation'->>'status' = 'passed'";
      const run = await client.query<BackfillRunRow>(
        `INSERT INTO focus_topic_backfill_runs (
           id, run_version, mode, schema_generation, input_fingerprint, result_summary,
           executed_at, validated_at, validated_by, signed_off_at, signed_off_by
         ) VALUES ($1, $2, 'apply', $3, $4, $5::jsonb, $6, NULL, NULL, NULL, NULL)
         ON CONFLICT (run_version, schema_generation, input_fingerprint) DO UPDATE
           SET result_summary = CASE WHEN ${preserveReview}
             THEN focus_topic_backfill_runs.result_summary
             ELSE EXCLUDED.result_summary || jsonb_build_object('priorValidationFailures',
               COALESCE(focus_topic_backfill_runs.result_summary->'priorValidationFailures', '[]'::jsonb)
               || CASE WHEN focus_topic_backfill_runs.result_summary->'validation'->>'status' = 'failed'
                 THEN jsonb_build_array(focus_topic_backfill_runs.result_summary->'validation') ELSE '[]'::jsonb END,
               'priorSignOffs', COALESCE(focus_topic_backfill_runs.result_summary->'priorSignOffs', '[]'::jsonb)
                 || CASE WHEN focus_topic_backfill_runs.signed_off_at IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
                   'at', focus_topic_backfill_runs.signed_off_at, 'by', focus_topic_backfill_runs.signed_off_by,
                   'validation', focus_topic_backfill_runs.result_summary->'validation')) ELSE '[]'::jsonb END) END,
             executed_at = CASE WHEN ${preserveReview} THEN focus_topic_backfill_runs.executed_at ELSE EXCLUDED.executed_at END,
             validated_at = CASE WHEN ${preserveReview} THEN focus_topic_backfill_runs.validated_at ELSE NULL END,
             validated_by = CASE WHEN ${preserveReview} THEN focus_topic_backfill_runs.validated_by ELSE NULL END,
             signed_off_at = CASE WHEN ${preserveReview} THEN focus_topic_backfill_runs.signed_off_at ELSE NULL END,
             signed_off_by = CASE WHEN ${preserveReview} THEN focus_topic_backfill_runs.signed_off_by ELSE NULL END
         RETURNING *`,
        [runId, input.plan.version, input.plan.schemaGeneration, input.plan.inputFingerprint,
          JSON.stringify({ ...input.plan.summary, ...binding }), new Date(), latestRunId]
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

  async markBackfillValidated(input: Parameters<FocusTopicAuthorityStore["markBackfillValidated"]>[0], client?: Pick<PoolClient, "query">): Promise<FocusTopicBackfillRunRecord> {
    return this.reviewBackfill(input, false, client);
  }

  async markBackfillSignedOff(input: Parameters<FocusTopicAuthorityStore["markBackfillSignedOff"]>[0], client?: Pick<PoolClient, "query">): Promise<FocusTopicBackfillRunRecord> {
    return this.reviewBackfill(input, true, client);
  }

  private async reviewBackfill(
    input: Parameters<FocusTopicAuthorityStore["markBackfillValidated"]>[0] | Parameters<FocusTopicAuthorityStore["markBackfillSignedOff"]>[0],
    signOff: boolean, suppliedClient?: Pick<PoolClient, "query">,
  ): Promise<FocusTopicBackfillRunRecord> {
    // An APPLY must already exist. Reviewing it must not run schema/data writes.
    const at = input.at ?? new Date();
    const actor = requiredId("signedOffBy" in input ? input.signedOffBy : input.validatedBy, "Operator");
    const client = suppliedClient ?? await this.pool.connect();
    let validationError: unknown;
    try {
      if (!suppliedClient) await client.query("BEGIN");
      const run = requiredRow((await client.query<BackfillRunRow>(
        "SELECT * FROM focus_topic_backfill_runs WHERE id = $1 FOR UPDATE", [requiredId(input.runId, "Run id")],
      )).rows[0], "Backfill run");
      assertBackfillRunNotFinalized(run.signed_off_at);
      if (run.result_summary.targetEnvironment !== input.targetEnvironment
        || run.result_summary.databaseIdentity !== await databaseIdentity(client)) throw new Error("Backfill run environment/database mismatch; use the APPLY run from this target.");
      if ((run.result_summary.validation as ValidationEvidence | undefined)?.status === "failed") {
        throw new Error("Backfill validation previously failed; repair the cause and explicitly APPLY again before validating.");
      }
      try {
        const latest = (await client.query<{ id: string }>("SELECT id FROM focus_topic_backfill_runs ORDER BY executed_at DESC, id DESC LIMIT 1")).rows[0];
        assertRunMatchesPlan(run, input.plan);
        if (latest?.id !== run.id) throw new Error("Backfill run is not the latest APPLY run.");
        const evidence = planEvidence(input.plan, at, actor);
        await assertActiveBackfillSet(client, evidence, true);
        if (await persistedRowsFingerprint(client, evidence, true) !== evidence.rowsFingerprint) {
          throw new Error("Backfill rows are incomplete or do not match the current plan.");
        }
        if (signOff) {
          if (!validEvidence(run) || !run.validated_at || !run.validated_by) throw new Error("Successful backfill validation is required before sign-off.");
          if (evidence.rowsFingerprint !== (run.result_summary.validation as ValidationEvidence).rowsFingerprint) throw new Error("Backfill validation evidence is stale.");
          if (input.plan.summary.assignmentCount === 0 && !validEmptyAcknowledgment(run)) {
            if (!("acknowledgeEmpty" in input && input.acknowledgeEmpty)) throw new Error("Empty backfill requires explicit --acknowledge-empty at sign-off.");
            run.result_summary.emptyAcknowledgment = { by: actor, at: at.toISOString() };
          }
        } else {
          if (run.validated_at && !validEvidence(run)) throw new Error("Existing backfill validation evidence is inconsistent.");
          if (!run.validated_at) run.result_summary.validation = evidence;
        }
      } catch (error) {
        if (signOff) throw error;
        // Commit a failed validation, never silently overwrite it on a later --validate.
        run.result_summary.validation = { status: "failed", by: actor, at: at.toISOString(), reason: "integrity_check_failed" };
        validationError = error;
      }
      const result = await client.query<BackfillRunRow>(
        `UPDATE focus_topic_backfill_runs SET result_summary=$2::jsonb,
          validated_at=$3, validated_by=$4, signed_off_at=$5, signed_off_by=$6 WHERE id=$1 RETURNING *`,
        [run.id, JSON.stringify(run.result_summary), validationError ? null : (run.validated_at ?? (signOff ? null : at)),
          validationError ? null : (run.validated_by ?? (signOff ? null : actor)),
          validationError ? null : (run.signed_off_at ?? (signOff ? at : null)),
          validationError ? null : (run.signed_off_by ?? (signOff ? actor : null))],
      );
      if (!suppliedClient) await client.query("COMMIT");
      if (validationError) throw new FocusTopicBackfillValidationError(validationError);
      return mapRun(requiredRow(result.rows[0], "Backfill run"));
    } catch (error) {
      if (!suppliedClient && !validationError) await rollbackQuietly(client);
      throw error;
    } finally {
      if (!suppliedClient) (client as PoolClient).release();
    }
  }
}

interface ValidationEvidence {
  status: "passed" | "failed"; at: string; by: string; inputFingerprint: string;
  assignmentIds: string[]; scenarioIds: string[]; contentIds: string[]; rowsFingerprint: string;
}
async function assertActiveBackfillSet(client: Pick<PoolClient, "query">, evidence: ValidationEvidence, exact: boolean): Promise<void> {
  const discrepancies: unknown[] = [];
  // The CLI inventories the entire database. Compare each organization as part of
  // that global plan, including old backfill rows whose org/Topic left the source.
  // Reserved backfill provenance excludes genuine manual/direct assignments.
  for (const [table, actorColumn, inactiveColumn, expectedIds] of [
    ["focus_topic_assignments", "created_by", "revoked_at", evidence.assignmentIds],
    ["focus_topic_scenario_attachments", "attached_by", "detached_at", evidence.scenarioIds],
    ["org_content_topic_attachments", "attached_by", "detached_at", evidence.contentIds],
  ] as const) {
    const rows = (await client.query<{ id: string; org_id: string; topic_id: string }>(
      `SELECT id, org_id, topic_id FROM ${table} WHERE ${actorColumn}=$1 AND ${inactiveColumn} IS NULL ORDER BY org_id, topic_id, id`,
      [FOCUS_TOPIC_BACKFILL_ACTOR],
    )).rows;
    const expected = new Set(expectedIds), actual = new Set(rows.map(row => row.id));
    const unexpected = rows.filter(row => !expected.has(row.id));
    const missingIds = exact ? expectedIds.filter(id => !actual.has(id)) : [];
    if (unexpected.length || missingIds.length) discrepancies.push({ table, unexpectedActiveRows: unexpected, missingActiveIds: missingIds });
  }
  if (discrepancies.length) throw new Error(`Active backfill records do not match the plan: ${JSON.stringify(discrepancies)}`);
}
async function databaseIdentity(client: Pick<PoolClient, "query">): Promise<string> {
  const row = requiredRow((await client.query("SELECT current_database() AS database, current_schema() AS schema")).rows[0], "Database identity");
  return hash(row);
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function identities(snapshot: FocusTopicAuthoritySnapshot) {
  return {
    assignments: snapshot.assignments.map(r => [r.id, r.orgId, r.topicId, r.audience, r.subjectUserId, r.grantsManagement]).sort(),
    scenarios: snapshot.scenarioAttachments.map(r => [r.id, r.orgId, r.topicId, r.scenarioKind, r.scenarioId]).sort(),
    content: snapshot.contentAttachments.map(r => [r.id, r.orgId, r.topicId, r.contentId]).sort(),
  };
}
function planEvidence(plan: FocusTopicAuthorityBackfillPlan, at: Date, by: string): ValidationEvidence {
  return { status: "passed", at: at.toISOString(), by, inputFingerprint: plan.inputFingerprint,
    assignmentIds: plan.assignments.map(r => r.id), scenarioIds: plan.scenarioAttachments.map(r => r.id),
    contentIds: plan.contentAttachments.map(r => r.id), rowsFingerprint: hash(identities(plan)) };
}
async function persistedRowsFingerprint(client: Pick<PoolClient, "query">, evidence: ValidationEvidence, activeOnly = false): Promise<string> {
  const assignments = await client.query<AssignmentRow>(`SELECT * FROM focus_topic_assignments WHERE id=ANY($1::text[])${activeOnly ? " AND revoked_at IS NULL" : ""}`, [evidence.assignmentIds]);
  const scenarios = await client.query<ScenarioRow>(`SELECT * FROM focus_topic_scenario_attachments WHERE id=ANY($1::text[])${activeOnly ? " AND detached_at IS NULL" : ""}`, [evidence.scenarioIds]);
  const content = await client.query<ContentRow>(`SELECT * FROM org_content_topic_attachments WHERE id=ANY($1::text[])${activeOnly ? " AND detached_at IS NULL" : ""}`, [evidence.contentIds]);
  return hash(identities({ assignments: assignments.rows.map(mapAssignment), scenarioAttachments: scenarios.rows.map(mapScenario), contentAttachments: content.rows.map(mapContent) }));
}
function validEvidence(run: BackfillRunRow): boolean {
  const evidence = run.result_summary.validation as ValidationEvidence | undefined;
  return evidence?.status === "passed" && evidence.inputFingerprint === run.input_fingerprint
    && evidence.by === run.validated_by && evidence.at === optionalIso(run.validated_at)
    && /^[a-f0-9]{64}$/.test(evidence.rowsFingerprint)
    && [[evidence.assignmentIds, "assignmentCount"], [evidence.scenarioIds, "scenarioAttachmentCount"], [evidence.contentIds, "contentAttachmentCount"]].every(
      ([ids, key]) => Array.isArray(ids) && ids.every(id => typeof id === "string") && new Set(ids).size === ids.length && ids.length === run.result_summary[key as string],
    );
}
function validEmptyAcknowledgment(run: BackfillRunRow): boolean {
  const acknowledgment = run.result_summary.emptyAcknowledgment as { by?: string; at?: string } | undefined;
  return Boolean(acknowledgment?.by && acknowledgment.by === run.signed_off_by && acknowledgment.at === optionalIso(run.signed_off_at) && validEvidence(run));
}
function assertRunMatchesPlan(run: BackfillRunRow, plan: FocusTopicAuthorityBackfillPlan): void {
  if (run.mode !== "apply" || run.run_version !== FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION || run.schema_generation !== FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION
    || run.input_fingerprint !== plan.inputFingerprint || !/^[a-f0-9]{64}$/.test(run.input_fingerprint)
    || plan.issues.length || !Object.entries(plan.summary).every(([key, value]) => Number.isSafeInteger(value) && value >= 0 && run.result_summary[key] === value)
    || plan.summary.issueCount !== 0 || plan.summary.assignmentCount !== plan.assignments.length
    || plan.summary.scenarioAttachmentCount !== plan.scenarioAttachments.length || plan.summary.contentAttachmentCount !== plan.contentAttachments.length) {
    throw new Error("Backfill APPLY result is failed, incomplete, issue-bearing or stale relative to the current inventory.");
  }
}

interface AssignmentRow { id:string; org_id:string; topic_id:string; audience:FocusTopicAssignment["audience"]; subject_user_id:string|null; grants_management:boolean; created_by:string; created_at:string|Date; revoked_by:string|null; revoked_at:string|Date|null }
interface ScenarioRow { id:string; org_id:string; topic_id:string; scenario_kind:"standard"|"org"; scenario_id:string; attached_by:string; attached_at:string|Date; detached_by:string|null; detached_at:string|Date|null }
interface ContentRow { id:string; org_id:string; content_id:string; topic_id:string; attached_by:string; attached_at:string|Date; detached_by:string|null; detached_at:string|Date|null }
interface BackfillRunRow { id:string; run_version:string; mode:"apply"; schema_generation:string; input_fingerprint:string; result_summary:Record<string,unknown>; executed_at:string|Date; validated_at:string|Date|null; validated_by:string|null; signed_off_at:string|Date|null; signed_off_by:string|null }

async function insertAssignment(client: Pick<PoolClient,"query">, row: FocusTopicAssignment): Promise<void> {
  await client.query(
    `INSERT INTO focus_topic_assignments (id,org_id,topic_id,audience,subject_user_id,grants_management,created_by,created_at,revoked_by,revoked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [row.id,row.orgId,row.topicId,row.audience,row.subjectUserId,row.grantsManagement,row.createdBy,row.createdAt,row.revokedBy,row.revokedAt]
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

function mapAssignment(row:AssignmentRow):FocusTopicAssignment { return {id:row.id,orgId:row.org_id,topicId:row.topic_id,audience:row.audience,subjectUserId:row.subject_user_id,grantsManagement:row.grants_management,createdBy:row.created_by,createdAt:iso(row.created_at),revokedBy:row.revoked_by,revokedAt:optionalIso(row.revoked_at)}; }
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
    readFocusTopicMigration("021_focus_topic_management_grant_person_uniqueness.sql"),
    readFocusTopicMigration("022_retire_focus_topic_deadline_reminders.sql"),
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
  return new PostgresFocusTopicAuthorityStore(pool, params.databaseUrl);
}
