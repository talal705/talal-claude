// IndexedDB plumbing for guest storage: versioned schema, connection handling, transactions.
// Nothing here touches IndexedDB at import time.
import { ProjectStoreError } from "@ytl/contracts";

export const GUEST_DB_NAME = "ytl-guest";

export const PROJECTS_STORE = "projects";
export const SNAPSHOTS_STORE = "snapshots";
export const PREFERENCES_STORE = "preferences";
export const SNAPSHOTS_BY_PROJECT = "projectId";
export const LESSON_PROGRESS_STORE = "lessonProgress";

/**
 * One step of the schema. `MIGRATIONS[n]` upgrades a database from version n to n + 1 and runs inside
 * the version-change transaction, so it may also rewrite existing records through `tx`.
 */
export type GuestMigration = (db: IDBDatabase, tx: IDBTransaction) => void;

/** Append only. Never edit a step that has shipped: browsers that already ran it will not run it again. */
export const MIGRATIONS: readonly GuestMigration[] = [
  // v1: projects, their snapshots, and the single preferences record.
  (db) => {
    db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
    const snapshots = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "id" });
    snapshots.createIndex(SNAPSHOTS_BY_PROJECT, "projectId");
    db.createObjectStore(PREFERENCES_STORE);
  },
  // v2: lesson progress, one record per lesson and mode.
  (db) => {
    db.createObjectStore(LESSON_PROGRESS_STORE, { keyPath: ["lessonId", "mode"] });
  },
];

export function unavailable(cause: unknown): ProjectStoreError {
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return new ProjectStoreError("unavailable", `Guest storage is unavailable (${detail})`);
}

export function openGuestDatabase(
  factory: IDBFactory,
  name: string = GUEST_DB_NAME,
  migrations: readonly GuestMigration[] = MIGRATIONS,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, migrations.length);
    } catch (error) {
      reject(unavailable(error));
      return;
    }
    request.onupgradeneeded = (event) => {
      const tx = request.transaction;
      if (!tx) return;
      try {
        for (let version = event.oldVersion; version < migrations.length; version++) {
          migrations[version](request.result, tx);
        }
      } catch (error) {
        // Aborting leaves the database at its previous version with its data untouched.
        tx.abort();
        reject(unavailable(error));
      }
    };
    request.onsuccess = () => resolve(request.result);
    // Includes VersionError: the database was written by a newer build than this one.
    request.onerror = () => reject(unavailable(request.error));
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Lazily opened, shared connection. Reopens after a failure or after the browser closes it. */
export class GuestDatabase {
  private connection: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly getFactory: () => IDBFactory | undefined,
    private readonly name: string = GUEST_DB_NAME,
    private readonly migrations: readonly GuestMigration[] = MIGRATIONS,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    let factory: IDBFactory | undefined;
    try {
      // Reading `indexedDB` itself throws in some privacy modes.
      factory = this.getFactory();
    } catch (error) {
      return Promise.reject(unavailable(error));
    }
    if (!factory) return Promise.reject(unavailable("IndexedDB is not available in this environment"));

    const connection = openGuestDatabase(factory, this.name, this.migrations).then((db) => {
      const forget = () => {
        if (this.connection === connection) this.connection = null;
      };
      // Another tab is upgrading the schema: let it proceed and reconnect on the next call.
      db.onversionchange = () => {
        db.close();
        forget();
      };
      db.onclose = forget;
      return db;
    });
    this.connection = connection;
    connection.catch(() => {
      if (this.connection === connection) this.connection = null;
    });
    return connection;
  }

  /**
   * Runs `work` in one transaction. Await only IndexedDB requests inside it; awaiting anything else
   * lets the transaction commit early. A throw from `work` aborts every write it made.
   * Failures that are not already a ProjectStoreError are reported as `unavailable`.
   */
  async transaction<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      // The connection was closed under us; the next call reopens it.
      this.connection = null;
      throw unavailable(error);
    }
    const settled = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
    try {
      const result = await work(tx);
      await settled;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // Already finished.
      }
      // A quota failure surfaces on the transaction, not on the request that caused it.
      const abortError = await settled.then(
        () => null,
        (reason: unknown) => reason,
      );
      if (error instanceof ProjectStoreError) throw error;
      throw unavailable(error ?? abortError);
    }
  }

  /** Closes the connection. The next call opens a new one. */
  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    if (!connection) return;
    try {
      (await connection).close();
    } catch {
      // Never opened.
    }
  }
}
