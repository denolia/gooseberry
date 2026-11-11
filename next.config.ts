import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: true,
  },
  serverExternalPackages: ["sql.js", "ankipack"],
};

export default createNextIntlPlugin()(nextConfig);
