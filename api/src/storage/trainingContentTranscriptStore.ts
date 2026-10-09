import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import type { AuditActorType } from "@voicepractice/shared";

import type { StorageProvider } from "../runtimeConfig.js";
import { initializeTrainingContentSchema } from "./trainingContentMigrations.js";

export interface TrainingContentTranscriptRecord {
  id: string;
  orgId: string;
  contentId: string;
  version: number;
  text: string;
  characterCount: number;
  contentSha256: string;
  createdByActorId: string;
  createdAt: string;
}

export interface TrainingContentTranscriptMetadata {
  id: string;
  contentId: string;
  version: number;
  characterCount: number;
  contentSha256: string;
  createdAt: string;
}

export interface TrainingContentTranscriptActor {
  actorType: AuditActorType;
  actorId: string;
}

export type TrainingContentTranscriptTransactionGuard = (
  client: Pick<PoolClient, "query">,
) => Promise<void>;

export class TrainingContentTranscriptStoreError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "content_not_found" | "content_archived" | "unavailable",
  ) {
    super(message);
    this.name = "TrainingContentTranscriptStoreError";
  }
}

export interface TrainingContentTranscriptStore {
  initialize(): Promise<void>;
  listCurrentMetadata(orgId: string, contentIds: readonly string[]): Promise<TrainingContentTranscriptMetadata[]>;
  getCurrent(params: { orgId: string; contentId: string;
    transactionGuard?: TrainingContentTranscriptTransactionGuard }): Promise<TrainingContentTranscriptRecord | null>;
  replaceCurrent(params: { orgId: string; contentId: string; text: string;
    actor: TrainingContentTranscriptActor; now?: Date;
    transactionGuard?: TrainingContentTranscriptTransactionGuard }): Promise<TrainingContentTranscriptRecord>;
  removeCurrent(params: { orgId: string; contentId: string; actor: TrainingContentTranscriptActor;
    now?: Date; transactionGuard?: TrainingContentTranscriptTransactionGuard }): Promise<TrainingContentTranscriptRecord>;
}

interface TranscriptRow {
  id: string; org_id: string; content_id: string; version: number;
  transcript_text: string; content_sha256: string; created_by_actor_id: string;
  created_at: string | Date;
}

interface TranscriptMetadataRow {
  id: string;
  content_id: string;
  version: number;
  character_count: number | string;
  content_sha256: string;
  created_at: string | Date;
}

class PostgresTrainingContentTranscriptStore implements TrainingContentTranscriptStore {
  private initialization: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  initialize(): Promise<void> {
    this.initialization ??= initializeTrainingContentSchema(this.pool);
    return this.initialization;
  }

  async listCurrentMetadata(orgId: string, contentIds: readonly string[]): Promise<TrainingContentTranscriptMetadata[]> {
    await this.initialize();
    if (contentIds.length === 0) return [];
    const result = await this.pool.query<TranscriptMetadataRow>(
      `SELECT id,content_id,version,char_length(transcript_text) AS character_count,
              content_sha256,created_at
       FROM org_content_transcripts
       WHERE org_id=$1 AND content_id=ANY($2::uuid[])
         AND superseded_at IS NULL AND removed_at IS NULL`,
      [requiredId(orgId), [...new Set(contentIds)]],
    );
    return result.rows.map(toMetadata);
  }

  async getCurrent(params: { orgId: string; contentId: string;
    transactionGuard?: TrainingContentTranscriptTransactionGuard }): Promise<TrainingContentTranscriptRecord | null> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockAuthority(client, params.orgId, params.contentId);
      if (params.transactionGuard) await params.transactionGuard(client);
      const result = await client.query<TranscriptRow>(
        `SELECT id,org_id,content_id,version,transcript_text,content_sha256,created_by_actor_id,created_at
         FROM org_content_transcripts
         WHERE org_id=$1 AND content_id=$2 AND superseded_at IS NULL AND removed_at IS NULL
         FOR SHARE`,
        [requiredId(params.orgId), requiredId(params.contentId)],
      );
      await client.query("COMMIT");
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    } catch (error) {
      await rollback(client); throw error;
    } finally { client.release(); }
  }

  async replaceCurrent(params: { orgId: string; contentId: string; text: string;
    actor: TrainingContentTranscriptActor; now?: Date;
    transactionGuard?: TrainingContentTranscriptTransactionGuard }): Promise<TrainingContentTranscriptRecord> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      await lockAuthority(client, params.orgId, params.contentId);
      const content = await lockCurrentContent(client, params.orgId, params.contentId);
      if (params.transactionGuard) await params.transactionGuard(client);
      const current = await client.query<TranscriptRow>(
        `SELECT id,org_id,content_id,version,transcript_text,content_sha256,created_by_actor_id,created_at
         FROM org_content_transcripts
         WHERE org_id=$1 AND content_id=$2 AND superseded_at IS NULL AND removed_at IS NULL
         FOR UPDATE`, [params.orgId, params.contentId],
      );
      const actorId = requiredId(params.actor.actorId);
      if (current.rows[0]) {
        await client.query(
          `UPDATE org_content_transcripts SET superseded_by_actor_id=$3,superseded_at=$4
           WHERE org_id=$1 AND id=$2`, [params.orgId, current.rows[0].id, actorId, now],
        );
      }
      const versionResult = await client.query<{ next_version: number | string }>(
        `SELECT COALESCE(MAX(version),0)+1 AS next_version FROM org_content_transcripts
         WHERE org_id=$1 AND content_id=$2`, [params.orgId, params.contentId],
      );
      const version = Number(versionResult.rows[0]?.next_version ?? 1);
      const id = randomUUID();
      const hash = createHash("sha256").update(params.text, "utf8").digest("hex");
      const inserted = await client.query<TranscriptRow>(
        `INSERT INTO org_content_transcripts
         (id,org_id,content_id,version,transcript_text,content_sha256,created_by_actor_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id,org_id,content_id,version,transcript_text,content_sha256,created_by_actor_id,created_at`,
        [id, params.orgId, params.contentId, version, params.text, hash, actorId, now],
      );
      await insertAudit(client, { actor: params.actor, orgId: params.orgId,
        contentId: params.contentId, transcriptId: id, version,
        characterCount: params.text.length, contentSha256: hash,
        action: current.rows[0] ? "training_content_transcript_replaced" : "training_content_transcript_added",
        contentType: content.content_type, now });
      await client.query("COMMIT");
      return mapRow(inserted.rows[0]!);
    } catch (error) {
      await rollback(client); throw error;
    } finally { client.release(); }
  }

  async removeCurrent(params: { orgId: string; contentId: string; actor: TrainingContentTranscriptActor;
    now?: Date; transactionGuard?: TrainingContentTranscriptTransactionGuard }): Promise<TrainingContentTranscriptRecord> {
    await this.initialize();
    const client = await this.pool.connect();
    const now = params.now ?? new Date();
    try {
      await client.query("BEGIN");
      await lockAuthority(client, params.orgId, params.contentId);
      const content = await lockCurrentContent(client, params.orgId, params.contentId);
      if (params.transactionGuard) await params.transactionGuard(client);
      const current = await client.query<TranscriptRow>(
        `SELECT id,org_id,content_id,version,transcript_text,content_sha256,created_by_actor_id,created_at
         FROM org_content_transcripts
         WHERE org_id=$1 AND content_id=$2 AND superseded_at IS NULL AND removed_at IS NULL
         FOR UPDATE`, [params.orgId, params.contentId],
      );
      if (!current.rows[0]) throw new TrainingContentTranscriptStoreError("Transcript was not found.", "not_found");
      const actorId = requiredId(params.actor.actorId);
      await client.query(
        `UPDATE org_content_transcripts SET removed_by_actor_id=$3,removed_at=$4
         WHERE org_id=$1 AND id=$2`, [params.orgId, current.rows[0].id, actorId, now],
      );
      await insertAudit(client, { actor: params.actor, orgId: params.orgId,
        contentId: params.contentId, transcriptId: current.rows[0].id,
        version: current.rows[0].version, characterCount: current.rows[0].transcript_text.length,
        contentSha256: current.rows[0].content_sha256, action: "training_content_transcript_removed",
        contentType: content.content_type, now });
      await client.query("COMMIT");
      return mapRow(current.rows[0]);
    } catch (error) {
      await rollback(client); throw error;
    } finally { client.release(); }
  }
}

class DisabledTrainingContentTranscriptStore implements TrainingContentTranscriptStore {
  async initialize(): Promise<void> {}
  async listCurrentMetadata(): Promise<TrainingContentTranscriptMetadata[]> { return []; }
  async getCurrent(): Promise<null> { return null; }
  async replaceCurrent(): Promise<never> { throw new TrainingContentTranscriptStoreError("Transcript storage is unavailable.", "unavailable"); }
  async removeCurrent(): Promise<never> { throw new TrainingContentTranscriptStoreError("Transcript storage is unavailable.", "unavailable"); }
}

export function createTrainingContentTranscriptStore(config: {
  provider: StorageProvider; databaseUrl?: string; pgPoolMax?: number;
  pgConnectTimeoutMs?: number; pgIdleTimeoutMs?: number; queryPool?: Pool;
}): TrainingContentTranscriptStore {
  if (config.provider !== "postgres" || !config.databaseUrl) return new DisabledTrainingContentTranscriptStore();
  return new PostgresTrainingContentTranscriptStore(config.queryPool ?? new Pool({
    connectionString: config.databaseUrl, max: config.pgPoolMax ?? 4,
    connectionTimeoutMillis: config.pgConnectTimeoutMs ?? 5000,
    idleTimeoutMillis: config.pgIdleTimeoutMs ?? 30000,
  }));
}

async function lockAuthority(client: Pick<PoolClient, "query">, orgId: string, contentId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`peritio_training_content_authority:${requiredId(orgId)}:${requiredId(contentId)}`]);
}

async function lockCurrentContent(client: Pick<PoolClient, "query">, orgId: string, contentId: string) {
  const result = await client.query<{ content_type: string; archived_at: Date | string | null }>(
    "SELECT content_type,archived_at FROM org_content_items WHERE org_id=$1 AND id=$2 FOR SHARE",
    [requiredId(orgId), requiredId(contentId)],
  );
  if (!result.rows[0]) throw new TrainingContentTranscriptStoreError("Learning Resource was not found.", "content_not_found");
  if (result.rows[0].archived_at) throw new TrainingContentTranscriptStoreError("Archived Learning Resources cannot change transcripts.", "content_archived");
  return result.rows[0];
}

async function insertAudit(client: Pick<PoolClient, "query">, params: {
  actor: TrainingContentTranscriptActor; orgId: string; contentId: string; transcriptId: string;
  version: number; characterCount: number; contentSha256: string; action: string; contentType: string; now: Date;
}): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
     (id,actor_type,actor_id,action,org_id,user_id,message,metadata,created_at)
     VALUES ($1,$2,$3,$4,$5,NULL,'Changed Learning Resource transcript.',$6::jsonb,$7)`,
    [`audit_${randomUUID()}`, params.actor.actorType, requiredId(params.actor.actorId), params.action,
      params.orgId, JSON.stringify({ orgId: params.orgId, contentId: params.contentId,
        transcriptId: params.transcriptId, version: params.version,
        characterCount: params.characterCount, contentSha256: params.contentSha256,
        contentType: params.contentType }), params.now],
  );
}

function mapRow(row: TranscriptRow): TrainingContentTranscriptRecord {
  return { id: row.id, orgId: row.org_id, contentId: row.content_id, version: Number(row.version),
    text: row.transcript_text, characterCount: row.transcript_text.length,
    contentSha256: row.content_sha256, createdByActorId: row.created_by_actor_id,
    createdAt: new Date(row.created_at).toISOString() };
}

function toMetadata(row: TranscriptMetadataRow): TrainingContentTranscriptMetadata {
  return { id: row.id, contentId: row.content_id, version: Number(row.version),
    characterCount: Number(row.character_count), contentSha256: row.content_sha256,
    createdAt: new Date(row.created_at).toISOString() };
}

function requiredId(value: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error("Identifier is required.");
  return normalized;
}

async function rollback(client: Pick<PoolClient, "query">): Promise<void> {
  try { await client.query("ROLLBACK"); } catch { /* retain original error */ }
}
