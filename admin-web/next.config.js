/** @type {import('next').NextConfig} */
const resolvedApiBaseUrl =
  process.env.API_BASE_URL
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || "http://localhost:4100";

function normalizePeritioEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "production" || normalized === "prod") {
    return "production";
  }
  if (normalized === "staging" || normalized === "stage") {
    return "staging";
  }
  if (normalized === "development" || normalized === "dev" || normalized === "local") {
    return "development";
  }
  return "";
}

function inferPeritioEnvFromApiBaseUrl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (
    normalized.includes("localhost")
    || normalized.includes("127.0.0.1")
    || normalized.includes("0.0.0.0")
  ) {
    return "development";
  }
  if (normalized.includes("voicepractice-api-dev")) {
    return "staging";
  }
  if (normalized.includes("peritio-api-prod")) {
    return "production";
  }
  return "";
}

const resolvedPeritioEnv =
  normalizePeritioEnv(process.env.NEXT_PUBLIC_PERITIO_ENV || process.env.PERITIO_ENV)
  || inferPeritioEnvFromApiBaseUrl(resolvedApiBaseUrl)
  || "development";

const nextConfig = {
  transpilePackages: ["@voicepractice/shared"],
  experimental: {
    externalDir: true
  },
  env: {
    NEXT_PUBLIC_API_BASE_URL: resolvedApiBaseUrl,
    NEXT_PUBLIC_PERITIO_ENV: resolvedPeritioEnv
  },
};

module.exports = nextConfig;
