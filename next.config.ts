import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: true,
  },
  serverExternalPackages: ["sql.js", "ankipack"],
};

export default nextConfig;
