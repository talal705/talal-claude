// Guest lesson progress in IndexedDB: one record per lesson and mode.
import { ProjectStoreError } from "@ytl/contracts";
import type { LessonMode, LessonProgress } from "@ytl/curriculum";
import { LESSON_PROGRESS_STORE, request, type GuestDatabase } from "./guest-db";
import {
  applySave,
  byRecency,
  checkLessonKey,
  checkLessonProgress,
  readLessonProgressRecord,
  type LessonProgressList,
  type LessonProgressRecord,
  type LessonProgressStore,
} from "./progress";

/** What is stored: the record plus the two key fields at the top level, where IndexedDB reads the key from. */
interface StoredLessonProgress extends LessonProgressRecord {
  lessonId: string;
  mode: LessonMode;
}

function corrupt(lessonId: string, mode: string): ProjectStoreError {
  return new ProjectStoreError("corrupt", `progress for lesson ${lessonId} (${mode}) is stored but failed validation; it was left in place`);
}

export function createGuestLessonProgressStore(db: GuestDatabase, options: { now?: () => Date } = {}): LessonProgressStore {
  const timestamp = () => (options.now?.() ?? new Date()).toISOString();

  return {
    async get(lessonId, mode): Promise<LessonProgressRecord | null> {
      const key = checkLessonKey(lessonId, mode);
      const stored: unknown = await db.transaction(LESSON_PROGRESS_STORE, "readonly", (tx) =>
        request(tx.objectStore(LESSON_PROGRESS_STORE).get([key.lessonId, key.mode])),
      );
      if (stored === undefined) return null;
      const record = readLessonProgressRecord(stored);
      if (record === null) throw corrupt(key.lessonId, key.mode);
      return record;
    },

    async save(progress: LessonProgress): Promise<LessonProgressRecord> {
      const checked = checkLessonProgress(progress);
      // Read and write in one transaction, so two tabs saving at once cannot lose a completion count.
      return db.transaction(LESSON_PROGRESS_STORE, "readwrite", async (tx) => {
        const store = tx.objectStore(LESSON_PROGRESS_STORE);
        const stored: unknown = await request(store.get([checked.lessonId, checked.mode]));
        // An unreadable record is replaced by a save: the learner's new run is worth more than the damaged one.
        const existing = stored === undefined ? null : readLessonProgressRecord(stored);
        const record = applySave(existing, checked, timestamp());
        const value: StoredLessonProgress = { lessonId: checked.lessonId, mode: checked.mode, ...record };
        await request(store.put(value));
        return record;
      });
    },

    async list(): Promise<LessonProgressList> {
      const stored = await db.transaction(LESSON_PROGRESS_STORE, "readonly", async (tx) => {
        const store = tx.objectStore(LESSON_PROGRESS_STORE);
        const keys = request(store.getAllKeys());
        const values: Promise<unknown[]> = request(store.getAll());
        return { keys: await keys, values: await values };
      });
      const records: LessonProgressRecord[] = [];
      const corruptKeys: string[] = [];
      stored.values.forEach((value, index) => {
        const record = readLessonProgressRecord(value);
        if (record === null) corruptKeys.push((stored.keys[index] as unknown[]).join(":"));
        else records.push(record);
      });
      return { records: records.sort(byRecency), corruptKeys };
    },

    async remove(lessonId, mode): Promise<void> {
      const key = checkLessonKey(lessonId, mode);
      await db.transaction(LESSON_PROGRESS_STORE, "readwrite", async (tx) => {
        await request(tx.objectStore(LESSON_PROGRESS_STORE).delete([key.lessonId, key.mode]));
      });
    },
  };
}
