// Guards and an isolated schema for the integration tests. Server-only.
import { randomBytes } from "node:crypto";
import { Client } from "pg";

export const TEST_DATABASE_NAME = "yourtechlab_test";

/** Returns the URL unchanged, or throws unless it names the test database. */
export function assertTestDatabaseUrl(connectionString: string): string {
  let name: string;
  try {
    name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid connection URL");
  }
  if (name !== TEST_DATABASE_NAME) {
    throw new Error(
      `Refusing to run database tests against "${name}": TEST_DATABASE_URL must point at "${TEST_DATABASE_NAME}"`,
    );
  }
  return connectionString;
}

const SCHEMA_PREFIX = "ytl_test_";
/** A schema left behind by a run that crashed is removed once it is this old. */
const STALE_SCHEMA_SECONDS = 15 * 60;

export interface TestSchema {
  /** Connection URL whose search_path is this schema only; give it to createDb and migrate. */
  url: string;
  name: string;
  drop(): Promise<void>;
}

async function connectToTestDatabase(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString: assertTestDatabaseUrl(connectionString) });
  await client.connect();
  // Second check against the server itself, in case the URL is rewritten on the way (service file, pooler).
  const connected = await client.query<{ name: string }>("select current_database() as name");
  if (connected.rows[0]?.name !== TEST_DATABASE_NAME) {
    await client.end();
    throw new Error(`Refusing to use "${connected.rows[0]?.name}": connected database is not "${TEST_DATABASE_NAME}"`);
  }
  return client;
}

/**
 * Creates an empty, uniquely named schema in the test database for one test run, so runs that
 * overlap (teammates share the database) never see or drop each other's tables. Nothing outside
 * schemas named `ytl_test_*` is touched. Test database only.
 */
export async function createTestSchema(connectionString: string): Promise<TestSchema> {
  const client = await connectToTestDatabase(connectionString);
  // The creation time is part of the name, which is how stale schemas are recognized later.
  const name = `${SCHEMA_PREFIX}${Math.floor(Date.now() / 1000)}_${process.pid}_${randomBytes(4).toString("hex")}`;
  try {
    const existing = await client.query<{ nspname: string }>(
      "select nspname from pg_namespace where nspname like $1",
      [`${SCHEMA_PREFIX.replaceAll("_", "\\_")}%`],
    );
    for (const { nspname } of existing.rows) {
      const createdAt = Number(/^ytl_test_(\d+)_\d+_[0-9a-f]{8}$/.exec(nspname)?.[1]);
      if (createdAt && Date.now() / 1000 - createdAt > STALE_SCHEMA_SECONDS) {
        // Another run may be removing the same leftover at this moment.
        await client.query(`drop schema if exists ${client.escapeIdentifier(nspname)} cascade`).catch(() => {});
      }
    }
    await client.query(`create schema ${client.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }

  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${name}`);
  return {
    url: url.toString(),
    name,
    async drop() {
      const dropper = await connectToTestDatabase(connectionString);
      try {
        await dropper.query(`drop schema if exists ${dropper.escapeIdentifier(name)} cascade`);
      } finally {
        await dropper.end();
      }
    },
  };
}
