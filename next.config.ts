import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
