"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { LessonEvidence, LessonTask } from "@ytl/curriculum";
import { useStoreValue, type SessionStore } from "../project/context";
import { useRouter } from "next/navigation";
import { labHref, type ActiveLab } from "../labs";
import { lessonById, lessonOfProject, lessonProject, runMode, type CreateLessonProject, type LessonBinding } from "./lesson-catalog";
import { LessonPanel } from "./LessonPanel";

/**
 * The lesson of the open project, when it has one: the lesson panel in Learn and Test Yourself,
 * and in Free Lab a line that leads back to it. The lesson comes from the address, or from what
 * this browser remembers about the project (opened from My Projects). Works for every lab.
 */
export function LessonSlot({
  lab,
  lessonId,
  store,
  evidence,
  createProject,
  proof,
}: {
  lab: ActiveLab;
  lessonId: string | null;
  store: SessionStore;
  evidence(task: LessonTask): Promise<LessonEvidence>;
  createProject: CreateLessonProject;
  proof?(): unknown;
}) {
  const t = useTranslations("lessons.panel");
  const locale = useLocale() as "en" | "ar";
  const projectId = useStoreValue(store, (state) => state.projectId);
  const mode = useStoreValue(store, (state) => state.mode);
  const [binding, setBinding] = useState<LessonBinding | null>(null);
  const router = useRouter();

  useEffect(() => {
    setBinding(projectId ? lessonOfProject(projectId) : null);
  }, [projectId]);

  const lesson = lessonById(lessonId ?? binding?.lessonId ?? "");
  if (!lesson || lesson.lab !== lab) return null;
  // A challenge is always a test; otherwise the mode the lesson was opened in, or the project's.
  const lessonMode = lesson.kind === "challenge" ? "test" : (binding?.mode ?? (mode === "test" ? "test" : "learn"));

  if (mode === "free") {
    return (
      <p className="notice lesson-return">
        <span>{t("freeBanner", { title: lesson.title[locale] })}</span>
        <button type="button" className="button button-small button-primary" onClick={() => store.getState().setMode(lessonMode)}>
          {t("backToLesson")}
        </button>
      </p>
    );
  }

  async function openLesson(nextId: string) {
    const next = lessonById(nextId);
    if (!next) return;
    const nextMode = runMode(next, lessonMode);
    const projectId = await lessonProject(next, nextMode, next.title[locale], createProject);
    router.push(labHref(lab, { mode: nextMode, project: projectId, lesson: next.id }));
  }

  return (
    <LessonPanel
      lab={lab}
      lesson={lesson}
      mode={lessonMode}
      evidence={evidence}
      proof={proof}
      onLeaveToFree={() => store.getState().setMode("free")}
      openLesson={(nextId) => void openLesson(nextId)}
    />
  );
}
