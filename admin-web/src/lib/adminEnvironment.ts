export type PeritioEnvironment = "development" | "staging" | "production";

export function normalizePeritioEnvironment(value: string | null | undefined): PeritioEnvironment | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "production" || normalized === "prod") {
    return "production";
  }
  if (normalized === "staging" || normalized === "stage") {
    return "staging";
  }
  if (normalized === "development" || normalized === "dev" || normalized === "local") {
    return "development";
  }
  return null;
}

export function isApiBaseLocalhost(apiBaseUrl: string): boolean {
  const trimmed = apiBaseUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    const lower = trimmed.toLowerCase();
    return lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes("0.0.0.0");
  }
}

export function inferPeritioEnvironmentFromApiBaseUrl(apiBaseUrl: string): PeritioEnvironment | null {
  const lower = apiBaseUrl.trim().toLowerCase();
  if (!lower) {
    return null;
  }
  if (isApiBaseLocalhost(apiBaseUrl)) {
    return "development";
  }
  if (lower.includes("voicepractice-api-dev")) {
    return "staging";
  }
  if (lower.includes("peritio-api-prod")) {
    return "production";
  }
  return null;
}

export function getConfiguredAdminEnvironment(apiBaseUrl: string): PeritioEnvironment {
  return (
    normalizePeritioEnvironment(process.env.NEXT_PUBLIC_PERITIO_ENV)
    ?? inferPeritioEnvironmentFromApiBaseUrl(apiBaseUrl)
    ?? "development"
  );
}

export function getEnvironmentLabel(environment: PeritioEnvironment): string {
  return environment.toUpperCase();
}

export function getShortGitSha(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "unknown") {
    return "unknown";
  }
  return trimmed.slice(0, 8);
}

export function isBrowserDeployedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized !== "localhost" && normalized !== "127.0.0.1" && normalized !== "";
}
