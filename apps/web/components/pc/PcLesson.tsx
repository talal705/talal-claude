"use client";

import { LessonSlot as SharedLessonSlot } from "../lesson/LessonSlot";
import { pcCatalog } from "./catalog";
import { pcStore } from "./pc-client";
import { createLessonProject } from "./PcStarter";
import { lessonById } from "../lesson/lesson-catalog";

/** The PC project's lesson. The checker gets the build exactly as the engine holds it now. */
export function LessonSlot({ lessonId }: { lessonId: string | null }) {
  return (
    <SharedLessonSlot
      lab="pc"
      lessonId={lessonId}
      store={pcStore}
      evidence={async () => ({ lab: "pc", state: pcStore.getState().history!.present, catalog: pcCatalog })}
      createProject={createLessonProject}
      proof={() => lessonActions(lessonId)}
    />
  );
}

/** What the learner did since the lesson started: the build's log without the lesson's own starting actions. */
function lessonActions(lessonId: string | null) {
  const lesson = lessonById(lessonId ?? "");
  const log = pcStore.getState().data?.log ?? [];
  return lesson?.start.lab === "pc" ? log.slice(lesson.start.actions.length) : log;
}
