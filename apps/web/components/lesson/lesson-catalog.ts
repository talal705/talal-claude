// The published lessons, reached from one place in the web app.
import type { LabType } from "@ytl/contracts";
import type { Lesson, LessonMode } from "@ytl/curriculum";
import { getGuestProjectStore, getLessonProgressStore } from "@/lib/storage";
import { lessonById as publishedLesson, lessons } from "../../../../content/lessons";
import { localChallenges } from "../challenge/local-challenges";

/** A published lesson, or a challenge the learner made in this browser. */
export function lessonById(id: string): Lesson | undefined {
  return publishedLesson(id) ?? localChallenges().find((lesson) => lesson.id === id);
}

/**
 * What a lab offers in a mode: Learn lists lessons and fault exercises, Test Yourself lists
 * everything (run in test mode). The learner's own challenges come last, in both.
 */
export function lessonsFor(lab: LabType, mode: LessonMode): Lesson[] {
  const offered = (lesson: Lesson) => lesson.lab === lab && (mode === "test" || lesson.kind !== "challenge");
  return [...lessons.filter(offered), ...localChallenges().filter(offered)];
}

/** The mode a lesson actually runs in: a challenge is always a test. */
export const runMode = (lesson: Lesson, mode: LessonMode): LessonMode => (lesson.kind === "challenge" ? "test" : mode);

// ---------- Which project a lesson was opened in ----------
// Kept in this browser so "Continue" reopens the same work, and so a project opened from My
// Projects still knows its lesson. Losing it (storage blocked) only means a new project.

const BINDING = "ytl_lesson_of:";
const PROJECT = "ytl_lesson_project:";

export interface LessonBinding {
  lessonId: string;
  mode: LessonMode;
}

export function bindLesson(projectId: string, binding: LessonBinding) {
  try {
    localStorage.setItem(BINDING + projectId, JSON.stringify(binding));
    localStorage.setItem(`${PROJECT}${binding.lessonId}:${binding.mode}`, projectId);
  } catch {
    // Not remembered; the address still carries the lesson.
  }
}

export function lessonOfProject(projectId: string): LessonBinding | null {
  try {
    const raw = JSON.parse(localStorage.getItem(BINDING + projectId) ?? "null") as Partial<LessonBinding> | null;
    return raw && typeof raw.lessonId === "string" && (raw.mode === "learn" || raw.mode === "test") ? { lessonId: raw.lessonId, mode: raw.mode } : null;
  } catch {
    return null;
  }
}

export function projectOfLesson(lessonId: string, mode: LessonMode): string | null {
  try {
    return localStorage.getItem(`${PROJECT}${lessonId}:${mode}`);
  } catch {
    return null;
  }
}

/** Makes a lab's project at a lesson's starting state and resolves to its ID. */
export type CreateLessonProject = (lesson: Lesson, mode: LessonMode, title: string) => Promise<string>;

/**
 * The project to open a lesson in: the one it was worked in before (when it still exists and the
 * learner is not starting again), or a new one at the lesson's starting state.
 */
export async function lessonProject(lesson: Lesson, mode: LessonMode, title: string, createProject: CreateLessonProject, again = false): Promise<string> {
  let projectId = again ? null : projectOfLesson(lesson.id, mode);
  if (projectId) {
    try {
      await getGuestProjectStore().get(projectId);
    } catch {
      projectId = null;
    }
  }
  if (again) await getLessonProgressStore().remove(lesson.id, mode).catch(() => {});
  projectId ??= await createProject(lesson, mode, title);
  bindLesson(projectId, { lessonId: lesson.id, mode });
  return projectId;
}
