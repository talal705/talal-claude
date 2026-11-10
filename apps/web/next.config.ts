import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// One env file for the whole repository: the git-ignored root .env.local.
const rootEnv = fileURLToPath(new URL("../../.env.local", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  // Only public runtime files are readable by the opaque-origin code sandboxes.
  async headers() {
    return [{ source: "/runtime/:path*", headers: [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
      { key: "Cache-Control", value: "public, max-age=86400" },
    ] }];
  },
  transpilePackages: [
    "@ytl/contracts",
    "@ytl/simulation",
    "@ytl/curriculum",
    "@ytl/ui",
  ],
};

export default withNextIntl(nextConfig);
