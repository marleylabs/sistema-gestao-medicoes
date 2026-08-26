import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/admin/templates/[tipo]": ["./app-assets/templates/**/*"],
    "/api/colaborador/nf": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-*/**/*",
      "./node_modules/pdf-parse/node_modules/@napi-rs/canvas/**/*",
      "./node_modules/pdf-parse/node_modules/@napi-rs/canvas-*/**/*",
      "./node_modules/pdfjs-dist/node_modules/@napi-rs/canvas/**/*",
      "./node_modules/pdfjs-dist/node_modules/@napi-rs/canvas-*/**/*",
      "./node_modules/node-ensure/**/*",
      "./node_modules/debug/**/*",
    ],
  },
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
