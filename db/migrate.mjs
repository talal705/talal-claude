// Applies pending SQL migrations from db/migrations.
//   node db/migrate.mjs          -> DATABASE_URL (development database)
//   node db/migrate.mjs --test   -> TEST_DATABASE_URL
// Reads the git-ignored .env.local in the repository root. Needs Node 22.18+ (loads the TypeScript runner directly).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../apps/web/lib/server/db/migrate.ts";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const variable = process.argv.includes("--test") ? "TEST_DATABASE_URL" : "DATABASE_URL";
const connectionString = process.env[variable];
if (!connectionString) {
  console.error(`${variable} is not set. Copy .env.example to .env.local in the repository root.`);
  process.exit(1);
}

try {
  const result = await migrate(connectionString);
  // The URL holds the password, so only the database name is printed.
  console.log(`Database: ${new URL(connectionString).pathname.slice(1)} (${variable})`);
  console.log(`Applied:  ${result.applied.length ? result.applied.join(", ") : "nothing (already up to date)"}`);
  console.log(`Skipped:  ${result.skipped.length ? result.skipped.join(", ") : "none"}`);

  const client = new pg.Client({ connectionString });
  await client.connect();
  const tables = await client.query("select tablename from pg_tables where schemaname = 'public' order by tablename");
  await client.end();
  console.log(`Tables:   ${tables.rows.map((row) => row.tablename).join(", ")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
