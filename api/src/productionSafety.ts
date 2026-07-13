export const PRODUCTION_WRITE_CONFIRMATION = "I understand this writes to production";

export type ScriptTargetEnvironment = "development" | "staging" | "production";

export function parseScriptTarget(rawValue: unknown): ScriptTargetEnvironment | null {
  if (rawValue === undefined || rawValue === null || rawValue === false) {
    return null;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "development" || normalized === "dev" || normalized === "local") {
    return "development";
  }

  if (normalized === "staging" || normalized === "stage") {
    return "staging";
  }

  if (normalized === "production" || normalized === "prod") {
    return "production";
  }

  throw new Error('--target must be one of "development", "staging", or "production".');
}

export function databaseUrlLooksProductionTarget(databaseUrl: string | null): boolean {
  const normalized = databaseUrl?.trim().toLowerCase() ?? "";
  return normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod");
}

export function databaseUrlLooksStagingTarget(databaseUrl: string | null): boolean {
  const normalized = databaseUrl?.trim().toLowerCase() ?? "";
  return normalized.includes("voicepractice_db") || normalized.includes("voicepractice-db");
}

export function inferDatabaseTargetEnvironment(databaseUrl: string | null): ScriptTargetEnvironment | null {
  if (databaseUrlLooksProductionTarget(databaseUrl)) {
    return "production";
  }

  if (databaseUrlLooksStagingTarget(databaseUrl)) {
    return "staging";
  }

  if (!databaseUrl) {
    return "development";
  }

  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname.trim().toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
      return "development";
    }
  } catch {
    return null;
  }

  return null;
}

export function inferApiTargetEnvironment(apiBaseUrl: string): ScriptTargetEnvironment | null {
  const normalized = apiBaseUrl.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes("peritio-api-prod")) {
    return "production";
  }

  if (normalized.includes("voicepractice-api-dev")) {
    return "staging";
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.trim().toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
      return "development";
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveGuardedTargetEnvironment(params: {
  operationName: string;
  explicitTarget: ScriptTargetEnvironment | null;
  inferredTarget: ScriptTargetEnvironment | null;
}): ScriptTargetEnvironment | null {
  if (params.explicitTarget && params.inferredTarget && params.explicitTarget !== params.inferredTarget) {
    throw new Error(
      `${params.operationName} target mismatch: --target ${params.explicitTarget} does not match detected ${params.inferredTarget} target.`
    );
  }

  return params.explicitTarget ?? params.inferredTarget;
}

export function assertProductionWriteAllowed(params: {
  operationName: string;
  explicitTarget: ScriptTargetEnvironment | null;
  inferredTarget: ScriptTargetEnvironment | null;
  confirmProduction: string | null;
}): ScriptTargetEnvironment | null {
  const resolvedTarget = resolveGuardedTargetEnvironment(params);
  if (resolvedTarget !== "production") {
    return resolvedTarget;
  }

  if (
    params.explicitTarget !== "production" ||
    params.confirmProduction !== PRODUCTION_WRITE_CONFIRMATION
  ) {
    throw new Error(
      `${params.operationName} refuses to write to production unless you pass --target production --confirm-production "${PRODUCTION_WRITE_CONFIRMATION}".`
    );
  }

  return resolvedTarget;
}
