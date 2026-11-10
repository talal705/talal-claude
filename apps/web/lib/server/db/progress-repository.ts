// Account lesson progress in PostgreSQL, behind the same LessonProgressStore contract as the guest
// store. A repository is bound to one owner and every statement filters on that owner. Server-only.
//
// Records are what the browser reported (`verified` stays false): until lessons can be re-checked
// on the server, this is the learner's own history, not an authoritative result.
import { ProjectStoreError } from "@ytl/contracts";
import type { LessonMode, LessonProgress, StepRecord } from "@ytl/curriculum";
import {
  applySave,
  byRecency,
  checkLessonKey,
  checkLessonProgress,
  readLessonProgressRecord,
  type LessonProgressList,
  type LessonProgressRecord,
  type LessonProgressStore,
} from "../../storage/progress";
import { isUuid } from "../../storage/validation";
import type { Db } from "./client";
import type { LessonProgressRow } from "./schema";

const iso = (value: Date | null): string | undefined => (value === null ? undefined : value.toISOString());

/** The stored row as a record, or null when its `steps` do not validate. */
function toRecord(row: LessonProgressRow): LessonProgressRecord | null {
  const progress: Record<string, unknown> = {
    lessonId: row.lesson_id,
    lessonVersion: row.lesson_version,
    mode: row.mode,
    status: row.status,
    stepIndex: row.step_index,
    steps: row.steps as StepRecord[],
    updatedAt: row.updated_at.toISOString(),
  };
  if (row.started_at !== null) progress.startedAt = iso(row.started_at);
  if (row.completed_at !== null) progress.completedAt = iso(row.completed_at);
  return readLessonProgressRecord({
    progress,
    completedCount: row.completed_count,
    revision: row.revision,
    ...(row.first_completed_at === null ? {} : { firstCompletedAt: iso(row.first_completed_at) }),
  });
}

function toStoreError(error: unknown): ProjectStoreError {
  if (error instanceof ProjectStoreError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (/^2[23]/.test(code)) return new ProjectStoreError("invalid_input", message);
  return new ProjectStoreError("unavailable", `The progress database is unavailable (${message})`);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function createLessonProgressRepository(db: Db, ownerId: string, options: { now?: () => Date } = {}): LessonProgressStore {
  if (!isUuid(ownerId)) throw new ProjectStoreError("invalid_input", "ownerId must be a UUID");
  const timestamp = () => (options.now?.() ?? new Date()).toISOString();

  async function saveOnce(progress: LessonProgress): Promise<LessonProgressRecord> {
    return db.transaction().execute(async (trx) => {
      // The row is locked until the write, so two saves of the same lesson cannot lose a completion.
      const row = await trx
        .selectFrom("lesson_progress")
        .selectAll()
        .where("user_id", "=", ownerId)
        .where("lesson_id", "=", progress.lessonId)
        .where("mode", "=", progress.mode)
        .forUpdate()
        .executeTakeFirst();
      const record = applySave(row ? toRecord(row) : null, progress, timestamp());
      const values = {
        lesson_version: record.progress.lessonVersion,
        status: record.progress.status,
        step_index: record.progress.stepIndex,
        steps: JSON.stringify(record.progress.steps),
        started_at: record.progress.startedAt ?? null,
        completed_at: record.progress.completedAt ?? null,
        updated_at: record.progress.updatedAt!,
        completed_count: record.completedCount,
        first_completed_at: record.firstCompletedAt ?? null,
        revision: record.revision,
      };
      const written = row
        ? await trx.updateTable("lesson_progress").set(values).where("user_id", "=", ownerId).where("lesson_id", "=", progress.lessonId).where("mode", "=", progress.mode).returningAll().executeTakeFirstOrThrow()
        : await trx.insertInto("lesson_progress").values({ user_id: ownerId, lesson_id: progress.lessonId, mode: progress.mode, ...values }).returningAll().executeTakeFirstOrThrow();
      const saved = toRecord(written);
      if (saved === null) throw new ProjectStoreError("corrupt", "the saved progress did not read back as a valid record");
      return saved;
    });
  }

  return {
    async get(lessonId: string, mode: LessonMode): Promise<LessonProgressRecord | null> {
      const key = checkLessonKey(lessonId, mode);
      try {
        const row = await db.selectFrom("lesson_progress").selectAll().where("user_id", "=", ownerId).where("lesson_id", "=", key.lessonId).where("mode", "=", key.mode).executeTakeFirst();
        if (!row) return null;
        const record = toRecord(row);
        if (record === null) throw new ProjectStoreError("corrupt", `progress for lesson ${key.lessonId} (${key.mode}) is stored but failed validation; it was left in place`);
        return record;
      } catch (error) {
        throw toStoreError(error);
      }
    },

    async save(progress: LessonProgress): Promise<LessonProgressRecord> {
      const checked = checkLessonProgress(progress);
      try {
        try {
          return await saveOnce(checked);
        } catch (error) {
          // Two first saves of the same lesson at once: the second finds the row on its retry.
          if (!isUniqueViolation(error)) throw error;
          return await saveOnce(checked);
        }
      } catch (error) {
        throw toStoreError(error);
      }
    },

    async list(): Promise<LessonProgressList> {
      try {
        const rows = await db.selectFrom("lesson_progress").selectAll().where("user_id", "=", ownerId).execute();
        const records: LessonProgressRecord[] = [];
        const corruptKeys: string[] = [];
        for (const row of rows) {
          const record = toRecord(row);
          if (record === null) corruptKeys.push(`${row.lesson_id}:${row.mode}`);
          else records.push(record);
        }
        return { records: records.sort(byRecency), corruptKeys };
      } catch (error) {
        throw toStoreError(error);
      }
    },

    async remove(lessonId: string, mode: LessonMode): Promise<void> {
      const key = checkLessonKey(lessonId, mode);
      try {
        await db.deleteFrom("lesson_progress").where("user_id", "=", ownerId).where("lesson_id", "=", key.lessonId).where("mode", "=", key.mode).execute();
      } catch (error) {
        throw toStoreError(error);
      }
    },
  };
}
