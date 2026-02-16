/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@voicepractice/shared"],
  experimental: {
    externalDir: true
  }
};

module.exports = nextConfig;
