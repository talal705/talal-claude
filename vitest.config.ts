import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// DATABASE_URL / TEST_DATABASE_URL live in the git-ignored root .env.local.
if (existsSync(at("./.env.local"))) process.loadEnvFile(at("./.env.local"));

export default defineConfig({
  resolve: {
    alias: {
      "@ytl/contracts": at("./packages/contracts/src/index.ts"),
      "@ytl/simulation": at("./packages/simulation/src/index.ts"),
      "@ytl/curriculum": at("./packages/curriculum/src/index.ts"),
      "@ytl/ui": at("./packages/ui/src/index.ts"),
      "@ytl/catalog": at("./content/catalog/index.ts"),
      "@ytl/lessons": at("./content/lessons/index.ts"),
      "@": at("./apps/web"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "services/**/*.test.ts", "apps/web/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
