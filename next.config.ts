import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: {
    // page.tsx is user WIP (unescaped entities); don't block container
    // builds on cosmetic lint. Revisit when Phase 2 replaces the homepage.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
