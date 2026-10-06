import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Proxy API calls so the browser only talks to the frontend origin (no CORS needed).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
