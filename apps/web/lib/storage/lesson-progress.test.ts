import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectStoreError, type ProjectStoreErrorCode } from "@ytl/contracts";
import type { LessonProgress, StepRecord } from "@ytl/curriculum";
import { GuestDatabase, LESSON_PROGRESS_STORE, openGuestDatabase, request } from "./guest-db";
import { createGuestLessonProgressStore } from "./lesson-progress-store";
import { applySave, readLessonProgress, readLessonProgressRecord } from "./progress";
import { getLessonProgressStore } from "./index";

const DB_NAME = "ytl-guest-progress-test";
let factory: IDBFactory;

/** A fresh store over the current database: what the app gets after a page reload. */
function openStore() {
  const db = new GuestDatabase(() => factory, DB_NAME);
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 13, 9, 0, tick++));
  return { db, progress: createGuestLessonProgressStore(db, { now }) };
}

async function putRaw(value: unknown): Promise<void> {
  const db = await openGuestDatabase(factory, DB_NAME);
  await request(db.transaction(LESSON_PROGRESS_STORE, "readwrite").objectStore(LESSON_PROGRESS_STORE).put(value));
  db.close();
}

async function expectCode(promise: Promise<unknown>, code: ProjectStoreErrorCode): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ProjectStoreError);
  expect((error as ProjectStoreError).code).toBe(code);
}

const step = (stepId: string, overrides: Partial<StepRecord> = {}): StepRecord => ({
  stepId,
  attempts: 1,
  hintLevel: 0,
  exampleShown: false,
  predictionCorrect: null,
  passed: true,
  independent: true,
  followUp: "not_offered",
  ...overrides,
});

const LESSON = "pc.beginner.memory-slots";

function inProgress(overrides: Partial<LessonProgress> = {}): LessonProgress {
  return {
    lessonId: LESSON,
    lessonVersion: 1,
    mode: "learn",
    status: "in_progress",
    stepIndex: 1,
    steps: [step("find-slots", { attempts: 3, hintLevel: 2, independent: false }), step("seat-module", { attempts: 0, passed: false, independent: false })],
    startedAt: "2026-10-13T08:00:00.000Z",
    updatedAt: "2026-10-13T08:05:00.000Z",
    ...overrides,
  };
}

function completed(completedAt: string, overrides: Partial<LessonProgress> = {}): LessonProgress {
  return inProgress({ status: "completed", stepIndex: 2, steps: [step("find-slots", { attempts: 3, hintLevel: 2, independent: false }), step("seat-module")], updatedAt: completedAt, completedAt, ...overrides });
}

beforeEach(() => {
  factory = new FakeIDBFactory() as unknown as IDBFactory;
});

describe("guest lesson progress store", () => {
  it("returns null for a lesson that was never started", async () => {
    const { progress } = openStore();
    expect(await progress.get(LESSON, "learn")).toBeNull();
    expect(await progress.list()).toEqual({ records: [], corruptKeys: [] });
  });

  it("saves a run with its attempts and hints, and reads it back unchanged", async () => {
    const { progress } = openStore();
    const saved = await progress.save(inProgress());
    expect(saved).toEqual({ progress: inProgress(), completedCount: 0, revision: 1 });
    expect(await progress.get(LESSON, "learn")).toEqual(saved);
    // Attempts and the highest hint level are kept per step, as the runner recorded them.
    expect(saved.progress.steps[0]).toMatchObject({ attempts: 3, hintLevel: 2, independent: false });
  });

  it("increments the revision on every save and keeps one record per lesson and mode", async () => {
    const { progress } = openStore();
    await progress.save(inProgress());
    const second = await progress.save(inProgress({ stepIndex: 2, updatedAt: "2026-10-13T08:06:00.000Z" }));
    expect(second).toMatchObject({ revision: 2, completedCount: 0 });
    // Test mode is its own record.
    const test = await progress.save(inProgress({ mode: "test" }));
    expect(test.revision).toBe(1);
    expect((await progress.list()).records).toHaveLength(2);
    expect((await progress.get(LESSON, "learn"))?.progress.stepIndex).toBe(2);
  });

  it("counts a completion once, remembers the first, and survives a restart of the lesson", async () => {
    const { progress } = openStore();
    await progress.save(inProgress());
    const first = await progress.save(completed("2026-10-13T08:10:00.000Z"));
    expect(first).toMatchObject({ completedCount: 1, firstCompletedAt: "2026-10-13T08:10:00.000Z", revision: 2 });
    // Saving the same finished run again (a page re-render) is not a second completion.
    expect((await progress.save(completed("2026-10-13T08:10:00.000Z"))).completedCount).toBe(1);

    // The learner starts the lesson again: the run is new, the history is kept.
    const restarted = await progress.save(inProgress({ stepIndex: 0, startedAt: "2026-10-14T08:00:00.000Z", updatedAt: "2026-10-14T08:00:00.000Z" }));
    expect(restarted).toMatchObject({ completedCount: 1, firstCompletedAt: "2026-10-13T08:10:00.000Z" });
    expect(restarted.progress.status).toBe("in_progress");

    const again = await progress.save(completed("2026-10-14T08:09:00.000Z"));
    expect(again).toMatchObject({ completedCount: 2, firstCompletedAt: "2026-10-13T08:10:00.000Z" });
  });

  it("sets updatedAt when the page did not, and leaves the page's value alone", async () => {
    const { progress } = openStore();
    const { updatedAt: _omitted, ...withoutTime } = inProgress();
    expect((await progress.save(withoutTime)).progress.updatedAt).toBe("2026-10-13T09:00:00.000Z");
    expect((await progress.save(inProgress())).progress.updatedAt).toBe("2026-10-13T08:05:00.000Z");
  });

  it("lists records most recently updated first", async () => {
    const { progress } = openStore();
    await progress.save(inProgress({ lessonId: "pc.beginner.a", updatedAt: "2026-10-13T08:01:00.000Z" }));
    await progress.save(inProgress({ lessonId: "network.beginner.b", updatedAt: "2026-10-13T08:03:00.000Z" }));
    await progress.save(inProgress({ lessonId: "code.beginner.c", updatedAt: "2026-10-13T08:02:00.000Z" }));
    expect((await progress.list()).records.map((record) => record.progress.lessonId)).toEqual(["network.beginner.b", "code.beginner.c", "pc.beginner.a"]);
  });

  it("recovers every record after a reload", async () => {
    const before = openStore();
    await before.progress.save(inProgress());
    const done = await before.progress.save(completed("2026-10-13T08:10:00.000Z"));
    await before.db.close();
    const after = openStore();
    expect(await after.progress.get(LESSON, "learn")).toEqual(done);
    expect((await after.progress.save(inProgress())).revision).toBe(3);
  });

  it("removes one record and leaves the others", async () => {
    const { progress } = openStore();
    await progress.save(inProgress());
    await progress.save(inProgress({ mode: "test" }));
    await progress.remove(LESSON, "learn");
    await progress.remove(LESSON, "learn");
    expect(await progress.get(LESSON, "learn")).toBeNull();
    expect((await progress.get(LESSON, "test"))?.progress.mode).toBe("test");
  });

  it("rejects invalid progress and stores nothing", async () => {
    const { progress } = openStore();
    const bad: unknown[] = [
      null,
      { ...inProgress(), lessonId: "" },
      { ...inProgress(), lessonId: "x".repeat(201) },
      { ...inProgress(), mode: "practice" },
      { ...inProgress(), lessonVersion: 0 },
      { ...inProgress(), status: "done" },
      { ...inProgress(), stepIndex: -1 },
      { ...inProgress(), steps: "none" },
      { ...inProgress(), steps: [{ ...step("a"), hintLevel: 4 }] },
      { ...inProgress(), steps: [{ ...step("a"), attempts: 1.5 }] },
      { ...inProgress(), steps: [{ ...step("a"), followUp: "maybe" }] },
      { ...inProgress(), steps: [{ ...step("a"), passed: "yes" }] },
      { ...inProgress(), steps: Array.from({ length: 201 }, (_, index) => step(`s${index}`)) },
      { ...inProgress(), updatedAt: "yesterday" },
    ];
    for (const value of bad) await expectCode(progress.save(value as LessonProgress), "invalid_input");
    await expectCode(progress.get("", "learn"), "invalid_input");
    await expectCode(progress.get(LESSON, "practice" as never), "invalid_input");
    expect(await progress.list()).toEqual({ records: [], corruptKeys: [] });
  });

  it("drops fields that are not part of the record", async () => {
    const { progress } = openStore();
    const saved = await progress.save({ ...inProgress(), score: 100, steps: [{ ...step("a"), cheated: false } as StepRecord] } as LessonProgress);
    expect(saved.progress).not.toHaveProperty("score");
    expect(saved.progress.steps[0]).not.toHaveProperty("cheated");
  });

  it("reports a corrupt record, keeps it in place, and lets a new save replace it", async () => {
    const { progress } = openStore();
    await progress.save(inProgress({ lessonId: "pc.beginner.good" }));
    await putRaw({ lessonId: LESSON, mode: "learn", progress: { lessonId: LESSON, status: 7 }, completedCount: "many", revision: 1 });

    const listed = await progress.list();
    expect(listed.records.map((record) => record.progress.lessonId)).toEqual(["pc.beginner.good"]);
    expect(listed.corruptKeys).toEqual([`${LESSON}:learn`]);
    await expectCode(progress.get(LESSON, "learn"), "corrupt");
    // Still there after being reported.
    expect((await progress.list()).corruptKeys).toEqual([`${LESSON}:learn`]);

    const replaced = await progress.save(inProgress());
    expect(replaced).toMatchObject({ revision: 1, completedCount: 0 });
    expect((await progress.list()).corruptKeys).toEqual([]);
  });

  it("is unavailable, not broken, without IndexedDB (server rendering)", async () => {
    const store = getLessonProgressStore();
    expect(getLessonProgressStore()).toBe(store);
    await expectCode(store.list(), "unavailable");
    await expectCode(store.save(inProgress()), "unavailable");
  });
});

describe("lesson progress rules", () => {
  it("applies the save rule without a store", () => {
    const now = "2026-10-13T12:00:00.000Z";
    const first = applySave(null, completed("2026-10-13T08:10:00.000Z"), now);
    expect(first).toEqual({ progress: completed("2026-10-13T08:10:00.000Z"), completedCount: 1, firstCompletedAt: "2026-10-13T08:10:00.000Z", revision: 1 });
    // A completion without its own time is dated by the save.
    const { completedAt: _c, updatedAt: _u, ...undated } = completed("x");
    expect(applySave(null, undated, now)).toMatchObject({ completedCount: 1, firstCompletedAt: now });
    expect(applySave(first, inProgress(), now)).toMatchObject({ completedCount: 1, revision: 2 });
  });

  it("reads only well-formed values", () => {
    expect(readLessonProgress(inProgress())).toEqual(inProgress());
    expect(readLessonProgress("text")).toBeNull();
    expect(readLessonProgressRecord({ progress: inProgress(), completedCount: 0, revision: 1 })).toEqual({ progress: inProgress(), completedCount: 0, revision: 1 });
    expect(readLessonProgressRecord({ progress: inProgress(), completedCount: -1, revision: 1 })).toBeNull();
    expect(readLessonProgressRecord({ progress: inProgress(), completedCount: 0, revision: 0 })).toBeNull();
    expect(readLessonProgressRecord({ progress: inProgress(), completedCount: 0, revision: 1, firstCompletedAt: "soon" })).toBeNull();
  });
});
