export function normalizeHost(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export type RequestHostKind = "app" | "public" | "local" | "preview" | "unknown";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function getConfiguredAppHost(): string {
  return normalizeHost(requireEnv("PERITIO_APP_HOST"));
}

export function getConfiguredPublicHost(): string {
  return normalizeHost(requireEnv("PERITIO_PUBLIC_HOST"));
}

export function isAppHost(host: string): boolean {
  return normalizeHost(host) === getConfiguredAppHost();
}

export function isPublicHost(host: string): boolean {
  return normalizeHost(host) === getConfiguredPublicHost();
}

export function isLocalDevelopmentHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized.endsWith(".localhost");
}

export function isPreviewDeploymentHost(host: string): boolean {
  return normalizeHost(host).endsWith(".vercel.app");
}

export function classifyRequestHost(host: string | null | undefined): RequestHostKind {
  const normalized = normalizeHost(host);
  if (!normalized) {
    return "unknown";
  }

  if (isLocalDevelopmentHost(normalized)) {
    return "local";
  }

  if (isPreviewDeploymentHost(normalized)) {
    return "preview";
  }

  if (isPublicHost(normalized)) {
    return "public";
  }

  if (isAppHost(normalized)) {
    return "app";
  }

  return "unknown";
}

export function isSystemPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/")
    || pathname === "/favicon.ico"
    || pathname === "/robots.txt"
    || pathname === "/sitemap.xml"
  );
}

export function isAuthApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/");
}

export function isPerformanceApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/performance/");
}

export function isAppExperiencePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/app" || pathname.startsWith("/app/");
}

export function buildAbsoluteUrlForHost(params: {
  host: string;
  pathname: string;
  search?: string;
  protocol?: string;
}): string {
  const protocol = (params.protocol ?? "https").replace(/:$/, "");
  const search = params.search ?? "";
  return `${protocol}://${params.host}${params.pathname}${search}`;
}
