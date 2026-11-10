"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Lesson, LessonMode } from "@ytl/curriculum";
import { getLessonProgressStore } from "@/lib/storage";
import type { LessonProgressRecord } from "@/lib/storage/progress";
import { WarningIcon } from "../icons";
import { labHref, type EntryChoice, type ActiveLab } from "../labs";
import { BaselineCheck } from "./BaselineCheck";
import { lessonById, lessonProject, lessonsFor, runMode, type CreateLessonProject } from "./lesson-catalog";

/**
 * Learn and Test Yourself start here: the lab's lessons with their level, what they teach and how
 * far the learner got. Opening one creates (or reopens) a project from the lesson's starting
 * state, so the learner works in the real lab with autosave, undo and snapshots.
 */
export function LessonList({
  lab,
  mode,
  start,
  createProject,
}: {
  lab: ActiveLab;
  mode: LessonMode;
  start: EntryChoice | null;
  /** Makes the lab's project for a lesson's starting state; resolves to its ID. */
  createProject: CreateLessonProject;
}) {
  const t = useTranslations("lessons");
  const locale = useLocale() as "en" | "ar";
  const router = useRouter();
  const lessons = lessonsFor(lab, mode);
  const [progress, setProgress] = useState<ReadonlyMap<string, LessonProgressRecord>>(new Map());
  const [progressFailed, setProgressFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    getLessonProgressStore()
      .list()
      .then(
        (list) => {
          if (current) setProgress(new Map(list.records.map((record) => [`${record.progress.lessonId}:${record.progress.mode}`, record])));
        },
        () => {
          if (current) setProgressFailed(true);
        },
      );
    return () => {
      current = false;
    };
  }, []);

  async function open(lesson: Lesson, again: boolean) {
    if (busy) return;
    setBusy(lesson.id);
    setError("");
    const effective = runMode(lesson, mode);
    try {
      // "Continue" reopens the project the lesson was worked in, when it still exists.
      const projectId = await lessonProject(lesson, effective, lesson.title[locale], createProject, again);
      router.push(labHref(lab, { start, mode: effective, project: projectId, lesson: lesson.id }));
    } catch {
      setError(t("startFailed"));
      setBusy(null);
    }
  }

  return (
    <div className="lesson-list-block">
      <h3 className="subheading">{t(`listHeading.${mode}`)}</h3>
      <p className="settings-hint">{t(`listIntro.${mode}`)}</p>
      {progressFailed && (
        <p className="notice">
          <WarningIcon />
          <span>{t("progressUnavailable")}</span>
        </p>
      )}
      {error && (
        <p className="notice notice-danger" role="alert">
          <WarningIcon />
          <span>{error}</span>
        </p>
      )}
      {lessons.length > 0 && (
        <BaselineCheck
          lab={lab}
          onOpen={(lessonId) => {
            const suggested = lessonById(lessonId);
            if (suggested) void open(suggested, false);
          }}
        />
      )}
      {lessons.length === 0 ? (
        <>
          <p className="lab-status-empty">{t("none")}</p>
          <Link href={`${labHref(lab, { start, mode: "free" })}#workspace-heading`} className="button">
            {t("freeInstead")}
          </Link>
        </>
      ) : (
        <ul className="pc-card-list">
          {lessons.map((lesson) => {
            const record = progress.get(`${lesson.id}:${runMode(lesson, mode)}`);
            const status = !record ? "new" : record.completedCount > 0 && record.progress.status === "completed" ? "completed" : "in_progress";
            const before = lesson.prerequisites.map((id) => lessonById(id)?.title[locale]).filter((title): title is string => Boolean(title));
            return (
              <li key={lesson.id} className="pc-card lesson-card">
                <h4 className="pc-card-name">
                  {lesson.title[locale]}
                  <span className="pc-tag">{t(`kinds.${lesson.kind}`)}</span>
                  <span className="pc-tag">{t(`levels.${lesson.level}`)}</span>
                </h4>
                <p>{lesson.summary[locale]}</p>
                <p className="state-meta">
                  <strong>{t("outcome")}:</strong> {lesson.outcome[locale]}
                </p>
                {before.length > 0 && <p className="state-meta">{t("needsFirst", { titles: before.join(locale === "ar" ? "، " : ", ") })}</p>}
                <p className="state-meta" data-status={status}>
                  {t(`status.${status}`)}
                </p>
                <div className="button-row">
                  <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void open(lesson, false)}>
                    {busy === lesson.id ? t("starting") : status === "in_progress" ? t("continue") : t("start")}
                    <span className="visually-hidden">: {lesson.title[locale]}</span>
                  </button>
                  {status !== "new" && (
                    <button type="button" className="button" disabled={busy !== null} onClick={() => void open(lesson, true)}>
                      {t("again")}
                      <span className="visually-hidden">: {lesson.title[locale]}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
