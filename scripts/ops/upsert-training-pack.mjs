#!/usr/bin/env node

import crypto from "node:crypto";
import { Pool } from "pg";

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseStringArray(value) {
  if (!value) {
    return [];
  }
  const raw = String(value).trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON for array input: ${message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Expected JSON array.");
    }
    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseWeightOverrides(value) {
  if (!value) {
    return {};
  }
  const raw = String(value).trim();
  if (!raw) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON for scoringWeightOverrides: ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("scoringWeightOverrides must be a JSON object.");
  }

  const normalized = {};
  for (const [key, val] of Object.entries(parsed)) {
    const numeric = Number(val);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    normalized[key] = numeric;
  }
  return normalized;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/ops/upsert-training-pack.mjs --orgId <org-id> [options]

Required:
  --orgId <value>

Options:
  --databaseUrl <postgres-url>        Defaults to DATABASE_URL env var
  --id <uuid>                         Defaults to random UUID
  --title <text>                      Default: "Org Training Pack"
  --trainingTopic <text>              Default: "General communication reinforcement"
  --learningObjectives <json|a;b;c>   Default: []
  --successBehaviors <json|a;b;c>     Default: []
  --failurePatterns <json|a;b;c>      Default: []
  --requiredBehavioralTriggers <json|a;b;c> Default: []
  --scoringWeightOverrides <json>     Default: {}
  --complianceConstraints <text>      Default: ""
  --audienceLevel <text>              Default: ""
  --active <true|false>               Default: true

Examples:
  node scripts/ops/upsert-training-pack.mjs --orgId org_123 --title "De-escalation Pack" --active true
  node scripts/ops/upsert-training-pack.mjs --orgId org_123 --scoringWeightOverrides "{\\"clarity\\":0.4,\\"empathy\\":0.3}"
`);
}

function describeDatabaseTarget(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname || "(unknown-host)",
      port: parsed.port || "(default-port)",
      db: parsed.pathname?.replace(/^\//, "") || "(unknown-db)",
    };
  } catch {
    return {
      host: "(unparseable-url)",
      port: "(unparseable-url)",
      db: "(unparseable-url)",
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    printHelp();
    return;
  }

  const databaseUrl = String(args.databaseUrl || process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("databaseUrl is required (pass --databaseUrl or set DATABASE_URL).");
  }

  const orgId = String(args.orgId || "").trim();
  if (!orgId) {
    throw new Error("orgId is required.");
  }

  const id = String(args.id || crypto.randomUUID()).trim();
  const active = parseBoolean(args.active, true);
  const title = String(args.title || "Org Training Pack").trim();
  const trainingTopic = String(args.trainingTopic || "General communication reinforcement").trim();
  const learningObjectives = parseStringArray(args.learningObjectives);
  const successBehaviors = parseStringArray(args.successBehaviors);
  const failurePatterns = parseStringArray(args.failurePatterns);
  const requiredBehavioralTriggers = parseStringArray(args.requiredBehavioralTriggers);
  const scoringWeightOverrides = parseWeightOverrides(args.scoringWeightOverrides);
  const complianceConstraints = String(args.complianceConstraints || "").trim();
  const audienceLevel = String(args.audienceLevel || "").trim();
  const target = describeDatabaseTarget(databaseUrl);
  console.log(`Target DB host=${target.host} port=${target.port} db=${target.db}`);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (active) {
        await client.query(
          `
            UPDATE training_packs
            SET active = FALSE, updated_at = NOW()
            WHERE organization_id = $1
              AND id <> $2
              AND active IS TRUE
          `,
          [orgId, id]
        );
      }

      const result = await client.query(
        `
          INSERT INTO training_packs (
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
          )
          VALUES (
            $1::uuid,
            $2,
            $3,
            $4,
            $5::jsonb,
            $6::jsonb,
            $7::jsonb,
            $8::jsonb,
            $9::jsonb,
            $10,
            $11,
            $12,
            NOW(),
            NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            title = EXCLUDED.title,
            training_topic = EXCLUDED.training_topic,
            learning_objectives = EXCLUDED.learning_objectives,
            success_behaviors = EXCLUDED.success_behaviors,
            failure_patterns = EXCLUDED.failure_patterns,
            required_behavioral_triggers = EXCLUDED.required_behavioral_triggers,
            scoring_weight_overrides = EXCLUDED.scoring_weight_overrides,
            compliance_constraints = EXCLUDED.compliance_constraints,
            audience_level = EXCLUDED.audience_level,
            active = EXCLUDED.active,
            updated_at = NOW()
          RETURNING
            id,
            organization_id,
            title,
            training_topic,
            active,
            updated_at
        `,
        [
          id,
          orgId,
          title,
          trainingTopic,
          JSON.stringify(learningObjectives),
          JSON.stringify(successBehaviors),
          JSON.stringify(failurePatterns),
          JSON.stringify(requiredBehavioralTriggers),
          JSON.stringify(scoringWeightOverrides),
          complianceConstraints,
          audienceLevel,
          active,
        ]
      );

      await client.query("COMMIT");

      const row = result.rows[0];
      console.log("Training pack upserted:");
      console.log(
        JSON.stringify(
          {
            id: row.id,
            organizationId: row.organization_id,
            title: row.title,
            trainingTopic: row.training_topic,
            active: row.active,
            updatedAt: row.updated_at,
          },
          null,
          2
        )
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
