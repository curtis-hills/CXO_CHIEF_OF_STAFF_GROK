import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@neondatabase/serverless"],
  outputFileTracingIncludes: {
    "*": ["./db/migrations/**/*"],
  },
};

export default nextConfig;
