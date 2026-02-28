import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";
import { TrainingPack, TrainingPackScoringWeightOverrides } from "@voicepractice/shared";
import { StorageProvider } from "../runtimeConfig.js";

export interface CreateTrainingPackInput {
  title: string;
  trainingTopic: string;
  requiredBehavioralTriggers: string[];
  active: boolean;
}

export interface UpdateTrainingPackInput {
  title?: string;
  trainingTopic?: string;
  requiredBehavioralTriggers?: string[];
  active?: boolean;
}

export interface TrainingPackStore {
  initialize(): Promise<void>;
  getActiveTrainingPackForOrg(orgId: string | null | undefined): Promise<TrainingPack | null>;
  listTrainingPacksForOrg(orgId: string | null | undefined): Promise<TrainingPack[]>;
  createTrainingPackForOrg(orgId: string | null | undefined, input: CreateTrainingPackInput): Promise<TrainingPack>;
  updateTrainingPackForOrg(
    orgId: string | null | undefined,
    trainingPackId: string,
    patch: UpdateTrainingPackInput
  ): Promise<TrainingPack | null>;
  deleteTrainingPackForOrg(orgId: string | null | undefined, trainingPackId: string): Promise<boolean>;
}

interface CreateTrainingPackStoreParams {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  logWarn?: (message: string) => void;
}

type TrainingPackRow = Record<string, unknown>;

interface TrainingPackColumnMapping {
  id: string;
  orgId: string;
  title: string;
  active: string;
  trainingTopic: string;
  requiredBehavioralTriggers: string;
  createdAt: string | null;
  updatedAt: string | null;
  hasLearningObjectives: boolean;
  hasSuccessBehaviors: boolean;
  hasFailurePatterns: boolean;
  hasScoringWeightOverrides: boolean;
  hasComplianceConstraints: boolean;
  hasAudienceLevel: boolean;
}

class NullTrainingPackStore implements TrainingPackStore {
  async initialize(): Promise<void> {
    // No schema warmup needed for non-postgres storage providers.
  }

  async getActiveTrainingPackForOrg(_orgId: string | null | undefined): Promise<TrainingPack | null> {
    return null;
  }

  async listTrainingPacksForOrg(_orgId: string | null | undefined): Promise<TrainingPack[]> {
    return [];
  }

  async createTrainingPackForOrg(_orgId: string | null | undefined, _input: CreateTrainingPackInput): Promise<TrainingPack> {
    throw new Error("Training packs require postgres storage.");
  }

  async updateTrainingPackForOrg(
    _orgId: string | null | undefined,
    _trainingPackId: string,
    _patch: UpdateTrainingPackInput
  ): Promise<TrainingPack | null> {
    throw new Error("Training packs require postgres storage.");
  }

  async deleteTrainingPackForOrg(_orgId: string | null | undefined, _trainingPackId: string): Promise<boolean> {
    throw new Error("Training packs require postgres storage.");
  }
}

class PostgresTrainingPackStore implements TrainingPackStore {
  private readonly pool: Pool;
  private hasWarnedMissingTable = false;
  private readonly cache = new Map<string, { value: TrainingPack | null; expiresAt: number }>();
  private readonly cacheTtlMs = 60_000;
  private cachedColumnMapping: TrainingPackColumnMapping | null = null;
  private columnMappingPromise: Promise<TrainingPackColumnMapping> | null = null;
  private hasLoggedResolvedMapping = false;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    private readonly logWarn: (message: string) => void
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: options.pgPoolMax,
      connectionTimeoutMillis: options.pgConnectTimeoutMs,
      idleTimeoutMillis: options.pgIdleTimeoutMs,
      keepAlive: true
    });
  }
  async initialize(): Promise<void> {
    const mapping = await this.getColumnMapping();
    if (this.hasLoggedResolvedMapping) {
      return;
    }

    this.logWarn(
      `[training-pack] resolved schema mapping ${JSON.stringify({
        orgId: mapping.orgId,
        id: mapping.id,
        active: mapping.active,
        brief: mapping.trainingTopic,
        triggers: mapping.requiredBehavioralTriggers,
        updated_at: mapping.updatedAt
      })}`
    );
    this.hasLoggedResolvedMapping = true;
  }

  async getActiveTrainingPackForOrg(orgId: string | null | undefined): Promise<TrainingPack | null> {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) {
      return null;
    }

    const cached = this.cache.get(normalizedOrgId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    try {
      const mapping = await this.getColumnMapping();
      const query = `
        SELECT *
        FROM training_packs
        WHERE ${quoteIdentifier(mapping.orgId)} = $1
          AND ${quoteIdentifier(mapping.active)} IS TRUE
        ${buildOrderByClause(mapping)}
        LIMIT 1
      `;
      const result = await this.pool.query<TrainingPackRow>(query, [normalizedOrgId]);
      const row = result.rows[0];
      if (!row) {
        this.cache.set(normalizedOrgId, { value: null, expiresAt: now + this.cacheTtlMs });
        return null;
      }

      const pack = mapTrainingPackRow(row, mapping);
      this.cache.set(normalizedOrgId, { value: pack, expiresAt: now + this.cacheTtlMs });
      return pack;
    } catch (error) {
      if (isMissingTableError(error)) {
        this.warnMissingTable();
        this.cache.set(normalizedOrgId, { value: null, expiresAt: now + this.cacheTtlMs });
        return null;
      }
      throw error;
    }
  }

  async listTrainingPacksForOrg(orgId: string | null | undefined): Promise<TrainingPack[]> {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) {
      return [];
    }

    try {
      const mapping = await this.getColumnMapping();
      const query = `
        SELECT *
        FROM training_packs
        WHERE ${quoteIdentifier(mapping.orgId)} = $1
        ${buildOrderByClause(mapping)}
      `;
      const result = await this.pool.query<TrainingPackRow>(query, [normalizedOrgId]);
      return result.rows.map((row) => mapTrainingPackRow(row, mapping));
    } catch (error) {
      if (isMissingTableError(error)) {
        this.warnMissingTable();
        throw new Error(
          "training_packs table is missing. Apply api/sql/002_training_packs.sql to enable training-pack management."
        );
      }
      throw error;
    }
  }

  async createTrainingPackForOrg(orgId: string | null | undefined, input: CreateTrainingPackInput): Promise<TrainingPack> {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) {
      throw new Error("Organization id is required.");
    }

    const title = input.title.trim();
    const trainingTopic = input.trainingTopic.trim();
    const requiredBehavioralTriggers = normalizeStringArray(input.requiredBehavioralTriggers);
    const active = input.active === true;

    const mapping = await this.getColumnMapping();
    const id = cryptoRandomUuid();
    const now = new Date();
    const optionalColumns = buildOptionalColumnValues(mapping, now);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      if (active) {
        await this.deactivateOtherPacks(client, mapping, normalizedOrgId, id, now);
      }

      const insertColumns = [
        mapping.id,
        mapping.orgId,
        mapping.title,
        mapping.trainingTopic,
        mapping.requiredBehavioralTriggers,
        mapping.active,
        ...optionalColumns.columns
      ];
      const insertValues: unknown[] = [
        id,
        normalizedOrgId,
        title,
        trainingTopic,
        JSON.stringify(requiredBehavioralTriggers),
        active,
        ...optionalColumns.values
      ];
      const placeholders = insertValues.map((_entry, index) => `$${index + 1}`);

      const insertQuery = `
        INSERT INTO training_packs (${insertColumns.map(quoteIdentifier).join(", ")})
        VALUES (${placeholders.join(", ")})
        RETURNING *
      `;
      const result = await client.query<TrainingPackRow>(insertQuery, insertValues);
      await client.query("COMMIT");
      this.invalidateOrgCache(normalizedOrgId);
      return mapTrainingPackRow(result.rows[0], mapping);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isMissingTableError(error)) {
        this.warnMissingTable();
        throw new Error(
          "training_packs table is missing. Apply api/sql/002_training_packs.sql to enable training-pack management."
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateTrainingPackForOrg(
    orgId: string | null | undefined,
    trainingPackId: string,
    patch: UpdateTrainingPackInput
  ): Promise<TrainingPack | null> {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) {
      throw new Error("Organization id is required.");
    }
    const normalizedPackId = trainingPackId.trim();
    if (!normalizedPackId) {
      throw new Error("trainingPackId is required.");
    }

    const mapping = await this.getColumnMapping();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (patch.title !== undefined) {
      setClauses.push(`${quoteIdentifier(mapping.title)} = $${values.length + 1}`);
      values.push(patch.title.trim());
    }

    if (patch.trainingTopic !== undefined) {
      setClauses.push(`${quoteIdentifier(mapping.trainingTopic)} = $${values.length + 1}`);
      values.push(patch.trainingTopic.trim());
    }

    if (patch.requiredBehavioralTriggers !== undefined) {
      setClauses.push(`${quoteIdentifier(mapping.requiredBehavioralTriggers)} = $${values.length + 1}`);
      values.push(JSON.stringify(normalizeStringArray(patch.requiredBehavioralTriggers)));
    }

    if (patch.active !== undefined) {
      setClauses.push(`${quoteIdentifier(mapping.active)} = $${values.length + 1}`);
      values.push(patch.active === true);
    }

    const now = new Date();
    if (mapping.updatedAt) {
      setClauses.push(`${quoteIdentifier(mapping.updatedAt)} = $${values.length + 1}`);
      values.push(now);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<TrainingPackRow>(
        `
          SELECT *
          FROM training_packs
          WHERE ${quoteIdentifier(mapping.orgId)} = $1
            AND ${quoteIdentifier(mapping.id)} = $2
          LIMIT 1
        `,
        [normalizedOrgId, normalizedPackId]
      );
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      if (patch.active === true) {
        await this.deactivateOtherPacks(client, mapping, normalizedOrgId, normalizedPackId, now);
      }

      if (setClauses.length === 0) {
        await client.query("COMMIT");
        return mapTrainingPackRow(existing.rows[0], mapping);
      }

      const query = `
        UPDATE training_packs
        SET ${setClauses.join(", ")}
        WHERE ${quoteIdentifier(mapping.orgId)} = $${values.length + 1}
          AND ${quoteIdentifier(mapping.id)} = $${values.length + 2}
        RETURNING *
      `;
      values.push(normalizedOrgId, normalizedPackId);
      const updated = await client.query<TrainingPackRow>(query, values);
      await client.query("COMMIT");
      this.invalidateOrgCache(normalizedOrgId);
      return updated.rows[0] ? mapTrainingPackRow(updated.rows[0], mapping) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      if (isMissingTableError(error)) {
        this.warnMissingTable();
        throw new Error(
          "training_packs table is missing. Apply api/sql/002_training_packs.sql to enable training-pack management."
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteTrainingPackForOrg(orgId: string | null | undefined, trainingPackId: string): Promise<boolean> {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) {
      throw new Error("Organization id is required.");
    }
    const normalizedPackId = trainingPackId.trim();
    if (!normalizedPackId) {
      throw new Error("trainingPackId is required.");
    }

    try {
      const mapping = await this.getColumnMapping();
      const result = await this.pool.query(
        `
          DELETE FROM training_packs
          WHERE ${quoteIdentifier(mapping.orgId)} = $1
            AND ${quoteIdentifier(mapping.id)} = $2
        `,
        [normalizedOrgId, normalizedPackId]
      );
      const deletedCount = result.rowCount ?? 0;
      if (deletedCount > 0) {
        this.invalidateOrgCache(normalizedOrgId);
      }
      return deletedCount > 0;
    } catch (error) {
      if (isMissingTableError(error)) {
        this.warnMissingTable();
        throw new Error(
          "training_packs table is missing. Apply api/sql/002_training_packs.sql to enable training-pack management."
        );
      }
      throw error;
    }
  }

  private async deactivateOtherPacks(
    client: PoolClient,
    mapping: TrainingPackColumnMapping,
    orgId: string,
    excludeId: string,
    now: Date
  ): Promise<void> {
    const setClauses = [`${quoteIdentifier(mapping.active)} = FALSE`];
    const params: unknown[] = [orgId, excludeId];
    if (mapping.updatedAt) {
      setClauses.push(`${quoteIdentifier(mapping.updatedAt)} = $3`);
      params.push(now);
    }

    await client.query(
      `
        UPDATE training_packs
        SET ${setClauses.join(", ")}
        WHERE ${quoteIdentifier(mapping.orgId)} = $1
          AND ${quoteIdentifier(mapping.id)} <> $2
          AND ${quoteIdentifier(mapping.active)} IS TRUE
      `,
      params
    );
  }

  private invalidateOrgCache(orgId: string): void {
    this.cache.delete(orgId);
  }

  private warnMissingTable(): void {
    if (this.hasWarnedMissingTable) {
      return;
    }
    this.logWarn("[training-pack] training_packs table is missing. Apply api/sql/002_training_packs.sql.");
    this.hasWarnedMissingTable = true;
  }

  private async getColumnMapping(): Promise<TrainingPackColumnMapping> {
    if (this.cachedColumnMapping) {
      return this.cachedColumnMapping;
    }
    if (!this.columnMappingPromise) {
      this.columnMappingPromise = this.loadColumnMapping();
    }
    try {
      this.cachedColumnMapping = await this.columnMappingPromise;
      return this.cachedColumnMapping;
    } finally {
      this.columnMappingPromise = null;
    }
  }

  private async loadColumnMapping(): Promise<TrainingPackColumnMapping> {
    const result = await this.pool.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ANY(current_schemas(false))
          AND table_name = 'training_packs'
      `
    );
    const columns = new Set(result.rows.map((row) => row.column_name));
    if (columns.size === 0) {
      const error = new Error("training_packs table is missing.");
      (error as { code?: string }).code = "42P01";
      throw error;
    }

    const id = pickColumn(columns, ["id"], "id");
    const orgId = pickColumn(columns, ["organization_id", "org_id"], "organization id");
    const title = pickColumn(columns, ["title"], "title");
    const active = pickColumn(columns, ["active"], "active flag");
    const trainingTopic = pickColumn(columns, ["training_topic", "training_pack_brief", "brief"], "training pack brief");
    const requiredBehavioralTriggers = pickColumn(
      columns,
      ["required_behavioral_triggers", "behavioral_triggers", "required_triggers"],
      "required behavioral triggers"
    );

    const createdAt = pickOptionalColumn(columns, ["created_at", "createdat"]);
    const updatedAt = pickOptionalColumn(columns, ["updated_at", "updatedat"]);

    return {
      id,
      orgId,
      title,
      active,
      trainingTopic,
      requiredBehavioralTriggers,
      createdAt,
      updatedAt,
      hasLearningObjectives: columns.has("learning_objectives"),
      hasSuccessBehaviors: columns.has("success_behaviors"),
      hasFailurePatterns: columns.has("failure_patterns"),
      hasScoringWeightOverrides: columns.has("scoring_weight_overrides"),
      hasComplianceConstraints: columns.has("compliance_constraints"),
      hasAudienceLevel: columns.has("audience_level")
    };
  }
}

function normalizeOrgId(orgId: string | null | undefined): string {
  return typeof orgId === "string" ? orgId.trim() : "";
}

function isMissingTableError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

function pickColumn(columns: Set<string>, candidates: string[], label: string): string {
  const matches = candidates.filter((candidate) => columns.has(candidate));
  if (matches.length === 0) {
    throw new Error(
      `training_packs schema error: missing ${label} column. Expected one of: ${candidates.join(", ")}`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `training_packs schema error: ambiguous schema for ${label}. Matched columns: ${matches.join(", ")}`
    );
  }
  return matches[0];
}

function pickOptionalColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (columns.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Invalid SQL identifier "${value}".`);
  }
  return `"${value}"`;
}

function buildOrderByClause(mapping: TrainingPackColumnMapping): string {
  const clauses: string[] = [`${quoteIdentifier(mapping.active)} DESC`];
  if (mapping.updatedAt) {
    clauses.push(`${quoteIdentifier(mapping.updatedAt)} DESC`);
  }
  if (mapping.createdAt) {
    clauses.push(`${quoteIdentifier(mapping.createdAt)} DESC`);
  }
  clauses.push(`${quoteIdentifier(mapping.id)} DESC`);
  return `ORDER BY ${clauses.join(", ")}`;
}

function buildOptionalColumnValues(
  mapping: TrainingPackColumnMapping,
  now: Date
): { columns: string[]; values: unknown[] } {
  const columns: string[] = [];
  const values: unknown[] = [];

  if (mapping.hasLearningObjectives) {
    columns.push("learning_objectives");
    values.push(JSON.stringify([]));
  }
  if (mapping.hasSuccessBehaviors) {
    columns.push("success_behaviors");
    values.push(JSON.stringify([]));
  }
  if (mapping.hasFailurePatterns) {
    columns.push("failure_patterns");
    values.push(JSON.stringify([]));
  }
  if (mapping.hasScoringWeightOverrides) {
    columns.push("scoring_weight_overrides");
    values.push(JSON.stringify({}));
  }
  if (mapping.hasComplianceConstraints) {
    columns.push("compliance_constraints");
    values.push("");
  }
  if (mapping.hasAudienceLevel) {
    columns.push("audience_level");
    values.push("");
  }
  if (mapping.createdAt) {
    columns.push(mapping.createdAt);
    values.push(now);
  }
  if (mapping.updatedAt) {
    columns.push(mapping.updatedAt);
    values.push(now);
  }

  return { columns, values };
}

function getRowValue(row: TrainingPackRow, columnName: string): unknown {
  if (columnName in row) {
    return row[columnName];
  }
  const lower = columnName.toLowerCase();
  if (lower in row) {
    return row[lower];
  }
  return undefined;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    const normalized: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      normalized.push(trimmed);
    }
    return normalized;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    // Handle text/json columns that store serialized arrays.
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const fromJson = toStringArray(parsed);
      if (fromJson.length > 0) {
        return fromJson;
      }
    } catch {
      // Fall through to additional formats.
    }

    // Handle postgres text[] literal format, e.g. {"scenario:*","scenario:pm_unmotivated_member"}.
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const content = trimmed.slice(1, -1).trim();
      if (!content) {
        return [];
      }
      return content
        .split(",")
        .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
        .map((entry) => entry.replace(/\\"/g, "\"").trim())
        .filter(Boolean);
    }
  }

  return [];
}

function normalizeStringArray(value: string[]): string[] {
  const deduped = new Set<string>();
  for (const entry of value) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    deduped.add(trimmed);
  }
  return Array.from(deduped);
}

function toScoringWeightOverrides(value: unknown): TrainingPackScoringWeightOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const parsed: TrainingPackScoringWeightOverrides = {};
  for (const [key, raw] of Object.entries(value)) {
    const weight = Number(raw);
    if (!Number.isFinite(weight)) {
      continue;
    }
    parsed[key] = weight;
  }
  return parsed;
}

function toIsoString(value: unknown): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date().toISOString();
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function mapTrainingPackRow(row: TrainingPackRow, mapping: TrainingPackColumnMapping): TrainingPack {
  const learningObjectives = mapping.hasLearningObjectives ? toStringArray(row.learning_objectives) : [];
  const successBehaviors = mapping.hasSuccessBehaviors ? toStringArray(row.success_behaviors) : [];
  const failurePatterns = mapping.hasFailurePatterns ? toStringArray(row.failure_patterns) : [];
  const scoringWeightOverrides = mapping.hasScoringWeightOverrides
    ? toScoringWeightOverrides(row.scoring_weight_overrides)
    : {};
  const complianceConstraints = mapping.hasComplianceConstraints ? asTrimmedString(row.compliance_constraints) : "";
  const audienceLevel = mapping.hasAudienceLevel ? asTrimmedString(row.audience_level) : "";
  const createdAt = mapping.createdAt ? toIsoString(getRowValue(row, mapping.createdAt)) : toIsoString(undefined);
  const updatedAt = mapping.updatedAt ? toIsoString(getRowValue(row, mapping.updatedAt)) : createdAt;

  return {
    id: asTrimmedString(getRowValue(row, mapping.id)),
    organizationId: asTrimmedString(getRowValue(row, mapping.orgId)),
    title: asTrimmedString(getRowValue(row, mapping.title)),
    trainingTopic: asTrimmedString(getRowValue(row, mapping.trainingTopic)),
    learningObjectives,
    successBehaviors,
    failurePatterns,
    requiredBehavioralTriggers: toStringArray(getRowValue(row, mapping.requiredBehavioralTriggers)),
    scoringWeightOverrides,
    complianceConstraints,
    audienceLevel,
    active: asBoolean(getRowValue(row, mapping.active)),
    createdAt,
    updatedAt
  };
}

function cryptoRandomUuid(): string {
  return randomUUID();
}

export function createTrainingPackStore(params: CreateTrainingPackStoreParams): TrainingPackStore {
  if (params.provider !== "postgres" || !params.databaseUrl) {
    return new NullTrainingPackStore();
  }

  return new PostgresTrainingPackStore(
    params.databaseUrl,
    {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs
    },
    params.logWarn ?? (() => {})
  );
}


