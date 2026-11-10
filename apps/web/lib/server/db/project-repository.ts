// Account projects in PostgreSQL, behind the same ProjectStore contract as the guest store.
// A repository is bound to one owner and every statement filters on that owner, so one account
// cannot read, change or snapshot another account's project. Server-only.
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
import { sql } from "kysely";
import {
  checkCreateInput,
  checkExpectedRevision,
  checkLabFilter,
  checkSnapshotLabel,
  checkUpdateInput,
  isUuid,
} from "../../storage/validation";
import type { Db } from "./client";
import type { ProjectRow, ProjectSnapshotRow } from "./schema";

function toRecord<T>(row: ProjectRow): ProjectRecord<T> {
  return { ...toSummary(row), data: row.data as T };
}

function toSummary(row: Omit<ProjectRow, "data">): ProjectSummary {
  return {
    id: row.id,
    ownerId: row.owner_id,
    lab: row.lab,
    mode: row.mode,
    title: row.title,
    dataVersion: row.data_version,
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSnapshotSummary(row: Omit<ProjectSnapshotRow, "data">): ProjectSnapshotSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    revision: row.revision,
    label: row.label,
    dataVersion: row.data_version,
    createdAt: row.created_at.toISOString(),
  };
}

const SUMMARY_COLUMNS = [
  "id",
  "owner_id",
  "lab",
  "mode",
  "title",
  "data_version",
  "revision",
  "created_at",
  "updated_at",
] as const;

const SNAPSHOT_SUMMARY_COLUMNS = ["id", "project_id", "revision", "label", "data_version", "created_at"] as const;

function notFound(what: string, id: string): ProjectStoreError {
  // Also the answer for another owner's project: its existence is not revealed.
  return new ProjectStoreError("not_found", `${what} ${id} was not found`);
}

function conflict(expected: number, actual: number): ProjectStoreError {
  return new ProjectStoreError(
    "revision_conflict",
    `expected revision ${expected} but the project is at revision ${actual}; nothing was written`,
  );
}

/** Maps database failures onto the contract's error codes. */
function toStoreError(error: unknown): ProjectStoreError {
  if (error instanceof ProjectStoreError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  // Class 22 (data exception, e.g. \u0000 inside jsonb) and class 23 (constraint violation).
  if (/^2[23]/.test(code)) return new ProjectStoreError("invalid_input", message);
  return new ProjectStoreError("unavailable", `The project database is unavailable (${message})`);
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toStoreError(error);
  }
}

export function createProjectRepository(db: Db, ownerId: string): ProjectStore {
  if (!isUuid(ownerId)) throw new ProjectStoreError("invalid_input", "ownerId must be a UUID");

  /** Current revision of the owner's project, or not_found. */
  async function currentRevision(projectId: string): Promise<number> {
    const row = await db
      .selectFrom("projects")
      .select("revision")
      .where("id", "=", projectId)
      .where("owner_id", "=", ownerId)
      .executeTakeFirst();
    if (!row) throw notFound("project", projectId);
    return row.revision;
  }

  return {
    list(filter?: { lab?: LabType }): Promise<ProjectListResult> {
      return guarded(async () => {
        const lab = checkLabFilter(filter);
        let query = db.selectFrom("projects").select(SUMMARY_COLUMNS).where("owner_id", "=", ownerId);
        if (lab !== undefined) query = query.where("lab", "=", lab);
        const rows = await query.orderBy("updated_at", "desc").orderBy("id").execute();
        // The table's constraints keep every row valid, so nothing is unreadable here.
        return { projects: rows.map(toSummary), corruptIds: [] };
      });
    },

    get<T = unknown>(id: string): Promise<ProjectRecord<T>> {
      return guarded(async () => {
        // A malformed id cannot match; answering here avoids a uuid cast error from PostgreSQL.
        if (!isUuid(id)) throw notFound("project", String(id));
        const row = await db
          .selectFrom("projects")
          .selectAll()
          .where("id", "=", id)
          .where("owner_id", "=", ownerId)
          .executeTakeFirst();
        if (!row) throw notFound("project", id);
        return toRecord<T>(row);
      });
    },

    create<T = unknown>(input: CreateProjectInput<T>): Promise<ProjectRecord<T>> {
      return guarded(async () => {
        const checked = checkCreateInput(input);
        const row = await db
          .insertInto("projects")
          .values({
            owner_id: ownerId,
            lab: checked.lab,
            mode: checked.mode,
            title: checked.title,
            data: JSON.stringify(checked.data),
            data_version: checked.dataVersion,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return toRecord<T>(row);
      });
    },

    update<T = unknown>(id: string, input: UpdateProjectInput<T>): Promise<ProjectRecord<T>> {
      return guarded(async () => {
        const checked = checkUpdateInput(input);
        if (!isUuid(id)) throw notFound("project", String(id));
        // One statement: the revision check and the write cannot be separated by another writer.
        const row = await db
          .updateTable("projects")
          .set({
            ...(checked.title !== undefined && { title: checked.title }),
            ...(checked.mode !== undefined && { mode: checked.mode }),
            ...(checked.data !== undefined && { data: JSON.stringify(checked.data) }),
            ...(checked.dataVersion !== undefined && { data_version: checked.dataVersion }),
            revision: sql<number>`revision + 1`,
            updated_at: sql<Date>`now()`,
          })
          .where("id", "=", id)
          .where("owner_id", "=", ownerId)
          .where("revision", "=", checked.expectedRevision)
          .returningAll()
          .executeTakeFirst();
        if (row) return toRecord<T>(row);
        throw conflict(checked.expectedRevision, await currentRevision(id));
      });
    },

    remove(id: string): Promise<void> {
      return guarded(async () => {
        if (!isUuid(id)) throw notFound("project", String(id));
        // Snapshots go with it through the foreign key's ON DELETE CASCADE.
        const result = await db
          .deleteFrom("projects")
          .where("id", "=", id)
          .where("owner_id", "=", ownerId)
          .executeTakeFirst();
        if (result.numDeletedRows === 0n) throw notFound("project", id);
      });
    },

    createSnapshot(projectId: string, label: string): Promise<ProjectSnapshotSummary> {
      return guarded(async () => {
        const checkedLabel = checkSnapshotLabel(label);
        if (!isUuid(projectId)) throw notFound("project", String(projectId));
        // Copies data and revision from the owner's project inside the statement.
        const row = await db
          .insertInto("project_snapshots")
          .columns(["project_id", "revision", "label", "data", "data_version"])
          .expression((eb) =>
            eb
              .selectFrom("projects")
              .select(["id", "revision", eb.val(checkedLabel).as("label"), "data", "data_version"])
              .where("id", "=", projectId)
              .where("owner_id", "=", ownerId),
          )
          .returning(SNAPSHOT_SUMMARY_COLUMNS)
          .executeTakeFirst();
        if (!row) throw notFound("project", projectId);
        return toSnapshotSummary(row);
      });
    },

    getSnapshot<T = unknown>(projectId: string, snapshotId: string): Promise<ProjectSnapshot<T>> {
      return guarded(async () => {
        if (!isUuid(projectId)) throw notFound("project", String(projectId));
        if (!isUuid(snapshotId)) throw notFound("snapshot", String(snapshotId));
        await currentRevision(projectId);
        // The join on the owner's project: another project's or another owner's snapshot is not found.
        const row = await db
          .selectFrom("project_snapshots as s")
          .innerJoin("projects as p", "p.id", "s.project_id")
          .select(["s.id", "s.project_id", "s.revision", "s.label", "s.data", "s.data_version", "s.created_at"])
          .where("s.id", "=", snapshotId)
          .where("s.project_id", "=", projectId)
          .where("p.owner_id", "=", ownerId)
          .executeTakeFirst();
        if (!row) throw notFound("snapshot", snapshotId);
        return { ...toSnapshotSummary(row), data: row.data as T };
      });
    },

    listSnapshots(projectId: string): Promise<ProjectSnapshotSummary[]> {
      return guarded(async () => {
        if (!isUuid(projectId)) throw notFound("project", String(projectId));
        await currentRevision(projectId);
        const rows = await db
          .selectFrom("project_snapshots as s")
          .innerJoin("projects as p", "p.id", "s.project_id")
          .select(["s.id", "s.project_id", "s.revision", "s.label", "s.data_version", "s.created_at"])
          .where("s.project_id", "=", projectId)
          .where("p.owner_id", "=", ownerId)
          .orderBy("s.created_at", "desc")
          .orderBy("s.revision", "desc")
          .execute();
        return rows.map(toSnapshotSummary);
      });
    },

    restoreSnapshot<T = unknown>(
      projectId: string,
      snapshotId: string,
      expectedRevision: number,
    ): Promise<ProjectRecord<T>> {
      return guarded(async () => {
        const expected = checkExpectedRevision(expectedRevision);
        if (!isUuid(projectId)) throw notFound("project", String(projectId));
        if (!isUuid(snapshotId)) throw notFound("snapshot", String(snapshotId));
        // One statement: the snapshot must belong to this project, the project to this owner.
        const row = await db
          .updateTable("projects as p")
          .from("project_snapshots as s")
          .set((eb) => ({
            data: eb.ref("s.data").$castTo<string>(),
            data_version: eb.ref("s.data_version"),
            revision: sql<number>`p.revision + 1`,
            updated_at: sql<Date>`now()`,
          }))
          .whereRef("s.project_id", "=", "p.id")
          .where("s.id", "=", snapshotId)
          .where("p.id", "=", projectId)
          .where("p.owner_id", "=", ownerId)
          .where("p.revision", "=", expected)
          .returningAll("p")
          .executeTakeFirst();
        if (row) return toRecord<T>(row);

        const actual = await currentRevision(projectId);
        const snapshot = await db
          .selectFrom("project_snapshots")
          .select("id")
          .where("id", "=", snapshotId)
          .where("project_id", "=", projectId)
          .executeTakeFirst();
        if (!snapshot) throw notFound("snapshot", snapshotId);
        throw conflict(expected, actual);
      });
    },
  };
}
