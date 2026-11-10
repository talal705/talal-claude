// Pooled PostgreSQL connection. Server-only: import it from route handlers, server actions and
// other lib/server code, never from a client component.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema";

if (typeof window !== "undefined") {
  throw new Error("lib/server/db must not be imported by client code");
}

export type Db = Kysely<Database>;

/** A new pool for the given URL. The caller owns it and ends it with `db.destroy()`. */
export function createDb(connectionString: string, options: { maxConnections?: number } = {}): Db {
  const pool = new Pool({
    connectionString,
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Without a listener, an error on an idle connection (server restart) would crash the process.
  pool.on("error", (error) => console.error("PostgreSQL pool error:", error.message));
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

// Kept on globalThis so hot reloading in development reuses one pool instead of leaking one per reload.
const globalForDb = globalThis as typeof globalThis & { __ytlDb?: Db };

/** The application's shared pool, created on first use from DATABASE_URL. */
export function getDb(): Db {
  if (!globalForDb.__ytlDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local in the repository root.");
    }
    globalForDb.__ytlDb = createDb(connectionString);
  }
  return globalForDb.__ytlDb;
}
