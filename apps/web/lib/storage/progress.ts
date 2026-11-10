// Lesson progress records: types, validation and the save rule, shared by the guest store
// (IndexedDB) and the account repository (PostgreSQL). Pure: no browser or Node APIs.
import { ProjectStoreError } from "@ytl/contracts";
import type { LessonMode, LessonProgress, StepRecord } from "@ytl/curriculum";

/** One record per lesson and mode. `progress` is the latest run, exactly as the lesson runner produced it. */
export interface LessonProgressRecord {
  progress: LessonProgress;
  /** How many runs of this lesson and mode ended as completed. Survives a restart of the lesson. */
  completedCount: number;
  /** ISO 8601 UTC time of the first completion. */
  firstCompletedAt?: string;
  /** Starts at 1 and increases by 1 on every save. */
  revision: number;
}

export interface LessonProgressList {
  /** Most recently updated first. */
  records: LessonProgressRecord[];
  /** `lessonId:mode` of records that exist but could not be read. They are left in place. */
  corruptKeys: string[];
}

/** Implemented by the guest store now and by the account repository later. All failures throw ProjectStoreError. */
export interface LessonProgressStore {
  /** Null when nothing is stored. Rejects with `corrupt` for a stored record that fails validation. */
  get(lessonId: string, mode: LessonMode): Promise<LessonProgressRecord | null>;
  /** Creates or replaces the record for `progress.lessonId` and `progress.mode`. */
  save(progress: LessonProgress): Promise<LessonProgressRecord>;
  list(): Promise<LessonProgressList>;
  /** Removing a record that does not exist is not an error. */
  remove(lessonId: string, mode: LessonMode): Promise<void>;
}

export const LESSON_ID_MAX_LENGTH = 200;
export const MAX_STEPS = 200;
export const LESSON_MODES: readonly LessonMode[] = ["learn", "test"];
const FOLLOW_UPS: readonly StepRecord["followUp"][] = ["not_offered", "pending", "passed", "skipped"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

export function isLessonMode(value: unknown): value is LessonMode {
  return (LESSON_MODES as readonly unknown[]).includes(value);
}

export function isLessonId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= LESSON_ID_MAX_LENGTH;
}

function readStep(value: unknown): StepRecord | null {
  if (!isObject(value)) return null;
  if (typeof value.stepId !== "string" || value.stepId.length === 0 || value.stepId.length > LESSON_ID_MAX_LENGTH) return null;
  if (!isCount(value.attempts)) return null;
  if (value.hintLevel !== 0 && value.hintLevel !== 1 && value.hintLevel !== 2 && value.hintLevel !== 3) return null;
  if (typeof value.exampleShown !== "boolean" || typeof value.passed !== "boolean" || typeof value.independent !== "boolean") return null;
  if (value.predictionCorrect !== null && typeof value.predictionCorrect !== "boolean") return null;
  if (!(FOLLOW_UPS as readonly unknown[]).includes(value.followUp)) return null;
  return {
    stepId: value.stepId,
    attempts: value.attempts,
    hintLevel: value.hintLevel,
    exampleShown: value.exampleShown,
    predictionCorrect: value.predictionCorrect,
    passed: value.passed,
    independent: value.independent,
    followUp: value.followUp as StepRecord["followUp"],
  };
}

/** A copy holding only the contract's fields, or null when the value is not a valid LessonProgress. */
export function readLessonProgress(value: unknown): LessonProgress | null {
  if (!isObject(value)) return null;
  if (!isLessonId(value.lessonId) || !isLessonMode(value.mode)) return null;
  if (!isCount(value.lessonVersion) || value.lessonVersion < 1) return null;
  if (value.status !== "in_progress" && value.status !== "completed") return null;
  if (!isCount(value.stepIndex)) return null;
  if (!Array.isArray(value.steps) || value.steps.length > MAX_STEPS) return null;
  const steps: StepRecord[] = [];
  for (const entry of value.steps as unknown[]) {
    const step = readStep(entry);
    if (step === null) return null;
    steps.push(step);
  }
  const progress: LessonProgress = {
    lessonId: value.lessonId,
    lessonVersion: value.lessonVersion,
    mode: value.mode,
    status: value.status,
    stepIndex: value.stepIndex,
    steps,
  };
  for (const key of ["startedAt", "updatedAt", "completedAt"] as const) {
    if (value[key] === undefined) continue;
    if (!isIsoTime(value[key])) return null;
    progress[key] = value[key];
  }
  return progress;
}

export function readLessonProgressRecord(value: unknown): LessonProgressRecord | null {
  if (!isObject(value)) return null;
  const progress = readLessonProgress(value.progress);
  if (progress === null || !isCount(value.completedCount) || !isCount(value.revision) || value.revision < 1) return null;
  if (value.firstCompletedAt !== undefined && !isIsoTime(value.firstCompletedAt)) return null;
  return { progress, completedCount: value.completedCount, revision: value.revision, ...(value.firstCompletedAt === undefined ? {} : { firstCompletedAt: value.firstCompletedAt as string }) };
}

/** Validates what a caller wants to save; throws `invalid_input`. */
export function checkLessonProgress(value: unknown): LessonProgress {
  const progress = readLessonProgress(value);
  if (progress === null) throw new ProjectStoreError("invalid_input", "the lesson progress is not a valid LessonProgress record");
  return progress;
}

export function checkLessonKey(lessonId: unknown, mode: unknown): { lessonId: string; mode: LessonMode } {
  if (!isLessonId(lessonId)) throw new ProjectStoreError("invalid_input", "lessonId must be a string of 1 to 200 characters");
  if (!isLessonMode(mode)) throw new ProjectStoreError("invalid_input", "mode must be learn or test");
  return { lessonId, mode };
}

/** The same instant, however it is written (a database returns times in its own form). */
function sameTime(a: string | undefined, b: string | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && Date.parse(a) === Date.parse(b));
}

/**
 * The record after saving `progress` over `existing`. A completion is counted when the stored run
 * was not completed and the saved one is, or when a completed run is replaced by a later completed
 * run (a different `completedAt`); saving the same completed run again counts nothing.
 */
export function applySave(existing: LessonProgressRecord | null, progress: LessonProgress, now: string): LessonProgressRecord {
  const saved: LessonProgress = { ...progress, updatedAt: progress.updatedAt ?? now };
  const completes =
    saved.status === "completed" && (existing === null || existing.progress.status !== "completed" || !sameTime(existing.progress.completedAt, saved.completedAt));
  const firstCompletedAt = existing?.firstCompletedAt ?? (saved.status === "completed" ? (saved.completedAt ?? saved.updatedAt) : undefined);
  return {
    progress: saved,
    completedCount: (existing?.completedCount ?? 0) + (completes ? 1 : 0),
    revision: (existing?.revision ?? 0) + 1,
    ...(firstCompletedAt === undefined ? {} : { firstCompletedAt }),
  };
}

export function byRecency(a: LessonProgressRecord, b: LessonProgressRecord): number {
  return (b.progress.updatedAt ?? "").localeCompare(a.progress.updatedAt ?? "") || a.progress.lessonId.localeCompare(b.progress.lessonId);
}
