import {
  ProjectStoreError,
  type CreateProjectInput,
  type LabType,
  type ProjectListResult,
  type ProjectRecord,
  type ProjectSnapshot,
  type ProjectSnapshotSummary,
  type ProjectStore,
  type ProjectSummary,
  type UpdateProjectInput,
} from "@ytl/contracts";
import { PROJECTS_STORE, SNAPSHOTS_BY_PROJECT, SNAPSHOTS_STORE, request, type GuestDatabase } from "./guest-db";
import {
  checkCreateInput,
  checkExpectedRevision,
  checkLabFilter,
  checkSnapshotLabel,
  checkUpdateInput,
  isProjectRecord,
  isProjectSnapshot,
} from "./validation";

export interface GuestProjectStoreOptions {
  /** Clock and ID source, replaceable in tests. */
  now?: () => Date;
  newId?: () => string;
}

/** `crypto.randomUUID` needs a secure context; plain-HTTP LAN addresses fall back to getRandomValues. */
export function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function notFound(what: string, id: string): ProjectStoreError {
  return new ProjectStoreError("not_found", `${what} ${id} was not found`);
}

function corrupt(what: string, id: string): ProjectStoreError {
  return new ProjectStoreError("corrupt", `${what} ${id} is stored but failed validation; it was left in place`);
}

function conflict(expected: number, actual: number): ProjectStoreError {
  return new ProjectStoreError(
    "revision_conflict",
    `expected revision ${expected} but the project is at revision ${actual}; nothing was written`,
  );
}

function summarize(record: ProjectRecord): ProjectSummary {
  const { data: _data, ...summary } = record;
  return summary;
}

function summarizeSnapshot(snapshot: ProjectSnapshot): ProjectSnapshotSummary {
  const { data: _data, ...summary } = snapshot;
  return summary;
}

async function readProject(tx: IDBTransaction, id: string): Promise<ProjectRecord> {
  if (typeof id !== "string" || id.length === 0) throw notFound("project", String(id));
  const stored: unknown = await request(tx.objectStore(PROJECTS_STORE).get(id));
  if (stored === undefined) throw notFound("project", id);
  if (!isProjectRecord(stored)) throw corrupt("project", id);
  return stored;
}

export function createGuestProjectStore(db: GuestDatabase, options: GuestProjectStoreOptions = {}): ProjectStore {
  const timestamp = () => (options.now?.() ?? new Date()).toISOString();
  const newId = options.newId ?? randomId;

  return {
    async list(filter?: { lab?: LabType }): Promise<ProjectListResult> {
      const lab = checkLabFilter(filter);
      const stored = await db.transaction(PROJECTS_STORE, "readonly", async (tx) => {
        const store = tx.objectStore(PROJECTS_STORE);
        // Sequential requests: both are queued before the transaction can commit.
        const keys = request(store.getAllKeys());
        const values: Promise<unknown[]> = request(store.getAll());
        return { keys: await keys, values: await values };
      });

      const projects: ProjectSummary[] = [];
      const corruptIds: string[] = [];
      stored.values.forEach((value, index) => {
        if (!isProjectRecord(value)) {
          // Reported under every filter: its lab cannot be trusted.
          corruptIds.push(String(stored.keys[index]));
        } else if (lab === undefined || value.lab === lab) {
          projects.push(summarize(value));
        }
      });
      projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { projects, corruptIds };
    },

    async get<T = unknown>(id: string): Promise<ProjectRecord<T>> {
      return db.transaction(PROJECTS_STORE, "readonly", (tx) => readProject(tx, id)) as Promise<ProjectRecord<T>>;
    },

    async create<T = unknown>(input: CreateProjectInput<T>): Promise<ProjectRecord<T>> {
      const checked = checkCreateInput(input);
      const now = timestamp();
      const record: ProjectRecord = {
        id: newId(),
        ownerId: null,
        ...checked,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await db.transaction(PROJECTS_STORE, "readwrite", async (tx) => {
        // add, not put: an ID collision must fail instead of overwriting another project.
        await request(tx.objectStore(PROJECTS_STORE).add(record));
      });
      return record as ProjectRecord<T>;
    },

    async update<T = unknown>(id: string, input: UpdateProjectInput<T>): Promise<ProjectRecord<T>> {
      const { expectedRevision, ...changes } = checkUpdateInput(input);
      // The read, the revision check and the write share one transaction, so two tabs cannot both win.
      return db.transaction(PROJECTS_STORE, "readwrite", async (tx) => {
        const current = await readProject(tx, id);
        if (current.revision !== expectedRevision) throw conflict(expectedRevision, current.revision);
        const next: ProjectRecord = {
          ...current,
          ...changes,
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
        await request(tx.objectStore(PROJECTS_STORE).put(next));
        return next as ProjectRecord<T>;
      });
    },

    async remove(id: string): Promise<void> {
      return db.transaction([PROJECTS_STORE, SNAPSHOTS_STORE], "readwrite", async (tx) => {
        const projects = tx.objectStore(PROJECTS_STORE);
        // A corrupt record may still be removed: this is the learner's explicit choice.
        const key = typeof id === "string" && id.length > 0 ? await request(projects.getKey(id)) : undefined;
        if (key === undefined) throw notFound("project", String(id));
        const snapshots = tx.objectStore(SNAPSHOTS_STORE);
        const snapshotKeys = await request(snapshots.index(SNAPSHOTS_BY_PROJECT).getAllKeys(id));
        for (const snapshotKey of snapshotKeys) await request(snapshots.delete(snapshotKey));
        await request(projects.delete(id));
      });
    },

    async createSnapshot(projectId: string, label: string): Promise<ProjectSnapshotSummary> {
      const checkedLabel = checkSnapshotLabel(label);
      return db.transaction([PROJECTS_STORE, SNAPSHOTS_STORE], "readwrite", async (tx) => {
        const project = await readProject(tx, projectId);
        const snapshot: ProjectSnapshot = {
          id: newId(),
          projectId: project.id,
          revision: project.revision,
          label: checkedLabel,
          data: project.data,
          dataVersion: project.dataVersion,
          createdAt: timestamp(),
        };
        await request(tx.objectStore(SNAPSHOTS_STORE).add(snapshot));
        return summarizeSnapshot(snapshot);
      });
    },

    async getSnapshot<T = unknown>(projectId: string, snapshotId: string): Promise<ProjectSnapshot<T>> {
      return db.transaction([PROJECTS_STORE, SNAPSHOTS_STORE], "readonly", async (tx) => {
        const project = await readProject(tx, projectId);
        const snapshot: unknown =
          typeof snapshotId === "string" && snapshotId.length > 0 ? await request(tx.objectStore(SNAPSHOTS_STORE).get(snapshotId)) : undefined;
        if (snapshot === undefined) throw notFound("snapshot", String(snapshotId));
        if (!isProjectSnapshot(snapshot)) throw corrupt("snapshot", snapshotId);
        // A snapshot of another project is treated as absent.
        if (snapshot.projectId !== project.id) throw notFound("snapshot", snapshotId);
        return snapshot as ProjectSnapshot<T>;
      });
    },

    async listSnapshots(projectId: string): Promise<ProjectSnapshotSummary[]> {
      return db.transaction([PROJECTS_STORE, SNAPSHOTS_STORE], "readonly", async (tx) => {
        await readProject(tx, projectId);
        const stored: unknown[] = await request(
          tx.objectStore(SNAPSHOTS_STORE).index(SNAPSHOTS_BY_PROJECT).getAll(projectId),
        );
        // The contract has no channel for unreadable snapshots here; they stay stored and
        // restoreSnapshot reports them as `corrupt`.
        return stored
          .filter(isProjectSnapshot)
          .map(summarizeSnapshot)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision);
      });
    },

    async restoreSnapshot<T = unknown>(
      projectId: string,
      snapshotId: string,
      expectedRevision: number,
    ): Promise<ProjectRecord<T>> {
      const expected = checkExpectedRevision(expectedRevision);
      return db.transaction([PROJECTS_STORE, SNAPSHOTS_STORE], "readwrite", async (tx) => {
        const current = await readProject(tx, projectId);
        const snapshot: unknown =
          typeof snapshotId === "string" && snapshotId.length > 0
            ? await request(tx.objectStore(SNAPSHOTS_STORE).get(snapshotId))
            : undefined;
        if (snapshot === undefined) throw notFound("snapshot", String(snapshotId));
        if (!isProjectSnapshot(snapshot)) throw corrupt("snapshot", snapshotId);
        // A snapshot of another project is treated as absent.
        if (snapshot.projectId !== current.id) throw notFound("snapshot", snapshotId);
        if (current.revision !== expected) throw conflict(expected, current.revision);
        const next: ProjectRecord = {
          ...current,
          data: snapshot.data,
          dataVersion: snapshot.dataVersion,
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
        await request(tx.objectStore(PROJECTS_STORE).put(next));
        return next as ProjectRecord<T>;
      });
    },
  };
}
