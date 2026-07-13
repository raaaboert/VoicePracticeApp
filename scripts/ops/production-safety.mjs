export const PRODUCTION_WRITE_CONFIRMATION = "I understand this writes to production";

// Keep this standalone helper aligned with api/src/productionSafety.ts.
// The ops scripts run directly under Node and cannot import the API TypeScript source safely.
export function parseTargetEnvironment(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "true") {
    return null;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["development", "dev", "local"].includes(normalized)) {
    return "development";
  }

  if (["staging", "stage"].includes(normalized)) {
    return "staging";
  }

  if (["production", "prod"].includes(normalized)) {
    return "production";
  }

  throw new Error('--target must be one of "development", "staging", or "production".');
}

export function inferDatabaseTargetEnvironment(databaseUrl) {
  const normalized = String(databaseUrl || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod")) {
    return "production";
  }

  if (normalized.includes("voicepractice_db") || normalized.includes("voicepractice-db")) {
    return "staging";
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.trim().toLowerCase();
    if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host)) {
      return "development";
    }
  } catch {
    return null;
  }

  return null;
}

export function inferApiTargetEnvironment(apiBaseUrl) {
  const normalized = String(apiBaseUrl || "").trim().toLowerCase();
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
    if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host)) {
      return "development";
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveGuardedTargetEnvironment({ operationName, explicitTarget, inferredTarget }) {
  if (explicitTarget && inferredTarget && explicitTarget !== inferredTarget) {
    throw new Error(
      `${operationName} target mismatch: --target ${explicitTarget} does not match detected ${inferredTarget} target.`
    );
  }

  return explicitTarget || inferredTarget;
}

export function assertProductionWriteAllowed({
  operationName,
  explicitTarget,
  inferredTarget,
  confirmProduction,
}) {
  if (!inferredTarget) {
    if (
      explicitTarget === "production" &&
      confirmProduction === PRODUCTION_WRITE_CONFIRMATION
    ) {
      return "production";
    }

    throw new Error(
      `${operationName} refuses to write to an unknown target unless you pass --target production --confirm-production "${PRODUCTION_WRITE_CONFIRMATION}".`
    );
  }

  const resolvedTarget = resolveGuardedTargetEnvironment({
    operationName,
    explicitTarget,
    inferredTarget,
  });

  if (resolvedTarget !== "production") {
    return resolvedTarget;
  }

  if (
    explicitTarget === "production" &&
    confirmProduction === PRODUCTION_WRITE_CONFIRMATION
  ) {
    return resolvedTarget;
  }

  throw new Error(
    `${operationName} refuses to write to production unless you pass --target production --confirm-production "${PRODUCTION_WRITE_CONFIRMATION}".`
  );
}
