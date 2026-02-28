/** @type {import('next').NextConfig} */
const resolvedApiBaseUrl =
  process.env.API_BASE_URL
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || "http://localhost:4100";

const nextConfig = {
  transpilePackages: ["@voicepractice/shared"],
  experimental: {
    externalDir: true
  },
  env: {
    NEXT_PUBLIC_API_BASE_URL: resolvedApiBaseUrl
  },
};

module.exports = nextConfig;
