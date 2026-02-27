import { Pool } from "pg";
import { TrainingPack, TrainingPackScoringWeightOverrides } from "@voicepractice/shared";
import { StorageProvider } from "../runtimeConfig.js";

export interface TrainingPackStore {
  getActiveTrainingPackForOrg(orgId: string | null | undefined): Promise<TrainingPack | null>;
}

interface CreateTrainingPackStoreParams {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  logWarn?: (message: string) => void;
}

interface TrainingPackRow {
  id: string;
  organization_id: string;
  title: string;
  training_topic: string;
  learning_objectives: unknown;
  success_behaviors: unknown;
  failure_patterns: unknown;
  required_behavioral_triggers: unknown;
  scoring_weight_overrides: unknown;
  compliance_constraints: string | null;
  audience_level: string | null;
  active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

class NullTrainingPackStore implements TrainingPackStore {
  async getActiveTrainingPackForOrg(_orgId: string | null | undefined): Promise<TrainingPack | null> {
    return null;
  }
}

class PostgresTrainingPackStore implements TrainingPackStore {
  private readonly pool: Pool;
  private hasWarnedMissingTable = false;
  private readonly cache = new Map<string, { value: TrainingPack | null; expiresAt: number }>();
  private readonly cacheTtlMs = 60_000;

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
      keepAlive: true,
    });
  }

  async getActiveTrainingPackForOrg(orgId: string | null | undefined): Promise<TrainingPack | null> {
    const trimmedOrgId = typeof orgId === "string" ? orgId.trim() : "";
    if (!trimmedOrgId) {
      return null;
    }

    const cached = this.cache.get(trimmedOrgId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    try {
      const result = await this.pool.query<TrainingPackRow>(
        `
          SELECT
            id,
            organization_id,
            title,
            training_topic,
            learning_objectives,
            success_behaviors,
            failure_patterns,
            required_behavioral_triggers,
            scoring_weight_overrides,
            compliance_constraints,
            audience_level,
            active,
            created_at,
            updated_at
          FROM training_packs
          WHERE organization_id = $1
            AND active IS TRUE
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [trimmedOrgId]
      );

      const row = result.rows[0];
      if (!row) {
        this.cache.set(trimmedOrgId, { value: null, expiresAt: now + this.cacheTtlMs });
        return null;
      }

      const pack = mapTrainingPackRow(row);
      this.cache.set(trimmedOrgId, { value: pack, expiresAt: now + this.cacheTtlMs });
      return pack;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "42P01") {
        if (!this.hasWarnedMissingTable) {
          this.logWarn(
            "[training-pack] training_packs table is missing. Apply api/sql/002_training_packs.sql to enable runtime packs."
          );
          this.hasWarnedMissingTable = true;
        }
        this.cache.set(trimmedOrgId, { value: null, expiresAt: now + this.cacheTtlMs });
        return null;
      }

      throw error;
    }
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

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

function toIsoString(value: string | Date): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return value;
  }
  return value.toISOString();
}

function mapTrainingPackRow(row: TrainingPackRow): TrainingPack {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    trainingTopic: row.training_topic,
    learningObjectives: toStringArray(row.learning_objectives),
    successBehaviors: toStringArray(row.success_behaviors),
    failurePatterns: toStringArray(row.failure_patterns),
    requiredBehavioralTriggers: toStringArray(row.required_behavioral_triggers),
    scoringWeightOverrides: toScoringWeightOverrides(row.scoring_weight_overrides),
    complianceConstraints: row.compliance_constraints?.trim() ?? "",
    audienceLevel: row.audience_level?.trim() ?? "",
    active: row.active === true,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
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
      pgIdleTimeoutMs: params.pgIdleTimeoutMs,
    },
    params.logWarn ?? (() => {})
  );
}
