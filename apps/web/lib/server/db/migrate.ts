// Migration runner for the plain SQL files in db/migrations. Server-only.
// Self-contained (pg and Node built-ins only, erasable TypeScript) so db/migrate.mjs can load it
// directly with Node, without a build step.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../db/migrations", import.meta.url));

const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
// Arbitrary constant; serializes runners that start at the same time against one schema.
const ADVISORY_LOCK_KEY = 987_201_001;

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  /** Applied by this run, in order. */
  applied: string[];
  /** Already recorded as applied; left untouched. */
  skipped: string[];
}

export async function readMigrationFiles(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const files: MigrationFile[] = [];
  const numbers = new Set<string>();
  for (const name of names) {
    if (!MIGRATION_FILE_PATTERN.test(name)) {
      throw new Error(`Migration file "${name}" must be named like 0002_add_progress.sql`);
    }
    const number = name.slice(0, 4);
    if (numbers.has(number)) throw new Error(`Two migration files share the number ${number}`);
    numbers.add(number);
    const sql = await readFile(join(dir, name), "utf8");
    files.push({ name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return files;
}

/**
 * Applies every migration that is not yet recorded in `schema_migrations`, each in its own
 * transaction together with its record, so a failed migration leaves nothing behind.
 * Running it again is a no-op. It refuses to continue when an applied file was edited or removed,
 * or when a new file sorts before one that is already applied.
 */
export async function migrate(connectionString: string, options: { dir?: string } = {}): Promise<MigrateResult> {
  const files = await readMigrationFiles(options.dir);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Per schema: migrations of different schemas (each test run has its own) do not wait for each other.
    await client.query("select pg_advisory_lock($1, hashtext(current_schema()))", [ADVISORY_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        name       text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `);
    const recorded = await client.query<{ name: string; checksum: string }>(
      "select name, checksum from schema_migrations order by name",
    );
    const appliedChecksums = new Map(recorded.rows.map((row) => [row.name, row.checksum]));

    for (const name of appliedChecksums.keys()) {
      if (!files.some((file) => file.name === name)) {
        throw new Error(`Migration "${name}" is applied in the database but its file is missing`);
      }
    }

    const result: MigrateResult = { applied: [], skipped: [] };
    const lastApplied = recorded.rows.at(-1)?.name;
    for (const file of files) {
      const appliedChecksum = appliedChecksums.get(file.name);
      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== file.checksum) {
          throw new Error(`Migration "${file.name}" was edited after it was applied; add a new migration instead`);
        }
        result.skipped.push(file.name);
        continue;
      }
      if (lastApplied !== undefined && file.name < lastApplied) {
        throw new Error(`Migration "${file.name}" sorts before "${lastApplied}", which is already applied`);
      }
      await client.query("begin");
      try {
        // No parameters: the simple query protocol runs every statement in the file.
        await client.query(file.sql);
        await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
          file.name,
          file.checksum,
        ]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration "${file.name}" failed and was rolled back: ${reason}`, { cause: error });
      }
      result.applied.push(file.name);
    }
    return result;
  } finally {
    // Ending the session also releases the advisory lock.
    await client.end();
  }
}
