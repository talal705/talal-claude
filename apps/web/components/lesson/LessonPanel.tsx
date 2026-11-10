"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  currentStep,
  currentTask,
  lessonReducer,
  resumeLesson,
  startLesson,
  summarize,
  toProgress,
  visibleHelp,
  type Lesson,
  type LessonEvent,
  type LessonEvidence,
  type LessonMode,
  type LessonProgress,
  type LessonRunState,
  type LessonTask,
} from "@ytl/curriculum";
import { getLessonProgressStore } from "@/lib/storage";
import { CheckIcon, InfoIcon, WarningIcon } from "../icons";
import { labHref, type ActiveLab } from "../labs";
import { lessonById } from "./lesson-catalog";
import { hintLadder, releaseLessonFromTutor, syncLessonToTutor } from "@/lib/interaction";
import { lessonActive } from "./lesson-active";

type Locale = "en" | "ar";

const PROOF = "ytl_lesson_proof:";

/** Keeps, per passed step, what the learner did, for a later re-check on the server. Lost quietly if storage is blocked. */
function keepProof(lessonId: string, mode: LessonMode, stepId: string, proof: unknown) {
  if (proof === undefined) return;
  try {
    const key = `${PROOF}${lessonId}:${mode}`;
    const kept = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    kept[stepId] = proof;
    localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // Nothing to keep it in.
  }
}

/**
 * One lesson beside the lab it is taught in. The panel shows the goal, asks the optional
 * prediction, sends the lab's own state to the lesson runner when the learner checks, and shows
 * what the runner allows: the rubric, hints one at a time, the example, the explanation, the
 * follow-up and the summary. It decides nothing itself; in Test Yourself the runner withholds
 * the last hint, the explanation and the example until an attempt is submitted.
 */
export function LessonPanel({
  lab,
  lesson,
  mode,
  evidence,
  onLeaveToFree,
  openLesson,
  proof,
}: {
  lab: ActiveLab;
  lesson: Lesson;
  mode: LessonMode;
  /** What the lab hands the checker for a task: its own engine state, or real run results for code. */
  evidence(task: LessonTask): Promise<LessonEvidence>;
  /** Switches the project to Free Lab; the work stays. */
  onLeaveToFree(): void;
  /** Opens another lesson of this lab (the summary's "next lesson"). */
  openLesson(lessonId: string): void;
  /** What the learner did for a passed step, kept for a later re-check on the server: the lab's actions since the lesson started. */
  proof?(): unknown;
}) {
  const t = useTranslations("lessons");
  const tp = useTranslations("lessons.panel");
  const locale = useLocale() as Locale;
  const [run, setRun] = useState<LessonRunState | null>(null);
  const current = useRef<LessonRunState | null>(null);
  const stored = useRef<Pick<LessonProgress, "startedAt" | "completedAt"> | undefined>(undefined);
  const [saveFailed, setSaveFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<string | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [focusResult, setFocusResult] = useState(0);

  // Picks up stored progress for this lesson and mode, or starts it.
  useEffect(() => {
    let alive = true;
    getLessonProgressStore()
      .get(lesson.id, mode)
      .then(
        (record) => {
          if (!alive) return;
          stored.current = record?.progress;
          const state = record ? resumeLesson(lesson, record.progress) : startLesson(lesson, mode);
          current.current = state;
          setRun(state);
        },
        () => {
          if (!alive) return;
          setSaveFailed(true);
          current.current = startLesson(lesson, mode);
          setRun(current.current);
        },
      );
    return () => {
      alive = false;
    };
  }, [lesson, mode]);

  useEffect(() => {
    if (focusResult > 0) resultHeading.current?.focus();
  }, [focusResult]);

  // The lesson's hints live on the tutor's ladder; the runner keeps owning their level and lock.
  useEffect(() => {
    if (run) syncLessonToTutor(run, send);
    // `send` reads only refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  useEffect(() => {
    lessonActive.setState({ open: true });
    return () => {
      lessonActive.setState({ open: false });
      releaseLessonFromTutor();
    };
  }, []);

  function send(event: LessonEvent) {
    const before = current.current;
    if (!before) return;
    const next = lessonReducer(before, event);
    if (next === before) return;
    current.current = next;
    setRun(next);
    if (next.stepIndex !== before.stepIndex || next.phase !== before.phase) {
      setChoice(null);
      setPrediction(null);
    }
    const record = next.records[before.stepIndex];
    if (event.type === "submit" && record?.passed && !before.records[before.stepIndex]?.passed) keepProof(lesson.id, next.mode, record.stepId, event.evidence.lab === "choice" ? { optionId: event.evidence.optionId } : proof?.());
    const progress = toProgress(next, new Date().toISOString(), stored.current);
    stored.current = { startedAt: progress.startedAt, completedAt: progress.completedAt };
    getLessonProgressStore()
      .save(progress)
      .then(
        () => setSaveFailed(false),
        () => setSaveFailed(true),
      );
  }

  if (!run) {
    return (
      <p className="state-panel" role="status">
        <span className="spinner" aria-hidden="true" />
        {t("starting")}
      </p>
    );
  }

  const step = currentStep(run);
  const task = currentTask(run);
  const help = visibleHelp(run);
  const record = run.records[run.stepIndex];
  const isChoice = task?.check.type === "choice";

  /** Back to one step: that step starts again from nothing; the steps before it stay done. */
  function restartAt(stepId: string) {
    const state = current.current;
    const index = lesson.steps.findIndex((item) => item.id === stepId);
    if (!state || index < 0) return;
    const progress = toProgress(state, new Date().toISOString(), stored.current);
    const fresh = startLesson(lesson, state.mode).records[index];
    const again = resumeLesson(lesson, { ...progress, status: "in_progress", stepIndex: index, steps: progress.steps.map((item, at) => (at === index ? fresh : item)), completedAt: undefined });
    current.current = again;
    setRun(again);
    void getLessonProgressStore()
      .save(toProgress(again, new Date().toISOString(), stored.current))
      .catch(() => setSaveFailed(true));
  }

  async function check() {
    if (!task || checking) return;
    if (isChoice && !choice) return;
    setChecking(true);
    try {
      const gathered: LessonEvidence = isChoice ? { lab: "choice", optionId: choice! } : await evidence(task);
      send({ type: "submit", evidence: gathered });
      setFocusResult((n) => n + 1);
    } finally {
      setChecking(false);
    }
  }

  const summary = run.phase === "summary" ? summarize(run) : null;
  const nextLesson = summary?.next.kind === "next_lesson" ? lessonById(summary.next.lessonId) : undefined;
  const repeatStep = summary?.next.kind === "repeat_step" ? lesson.steps.find((item) => item.id === (summary.next as { stepId: string }).stepId) : undefined;

  return (
    <section aria-labelledby="lesson-heading" className="panel lesson-panel">
      <h3 id="lesson-heading" className="subheading">
        <span className="step-number">{t(`kinds.${lesson.kind}`)}</span>
        {lesson.title[locale]}
      </h3>
      {saveFailed && (
        <p className="notice">
          <WarningIcon />
          <span>{tp("saveFailed")}</span>
        </p>
      )}

      {step && task && (
        <>
          <p className="state-meta">{tp("step", { current: run.stepIndex + 1, total: lesson.steps.length })}</p>
          <h4 className="output-label">{run.phase === "follow_up" ? tp("followUpTitle") : tp("goal")}</h4>
          <p className="lesson-goal">{task.goal[locale]}</p>

          {run.phase === "predict" && step.prediction && (
            <fieldset className="settings-group lesson-box">
              <legend>
                {tp("predictTitle")} {step.prediction.question[locale]}
              </legend>
              {step.prediction.options.map((option) => (
                <label key={option.id} className="settings-option">
                  <input type="radio" name="lesson-prediction" value={option.id} checked={prediction === option.id} onChange={() => setPrediction(option.id)} />
                  <span>{option.text[locale]}</span>
                </label>
              ))}
              <div className="button-row">
                <button type="button" className="button button-small button-primary" disabled={!prediction} onClick={() => prediction && send({ type: "answer_prediction", optionId: prediction })}>
                  {tp("predictAnswer")}
                </button>
                <button type="button" className="button button-small" onClick={() => send({ type: "skip_prediction" })}>
                  {tp("predictSkip")}
                </button>
              </div>
            </fieldset>
          )}
          {run.predictionChoice && step.prediction && run.phase !== "predict" && (
            <p className="state-meta">{tp("yourPrediction", { answer: step.prediction.options.find((option) => option.id === run.predictionChoice)?.text[locale] ?? "" })}</p>
          )}

          {(run.phase === "work" || run.phase === "follow_up") &&
            (isChoice && task.options ? (
              <fieldset className="settings-group lesson-box">
                <legend>{tp("options")}</legend>
                {task.options.map((option) => (
                  <label key={option.id} className="settings-option">
                    <input type="radio" name="lesson-choice" value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} />
                    <span>{option.text[locale]}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="settings-hint">{tp("workHere")}</p>
            ))}

          {(run.phase === "work" || run.phase === "follow_up") && (
            <div className="button-row">
              <button type="button" className="button button-primary" disabled={checking || (isChoice && !choice)} onClick={() => void check()}>
                {checking ? tp("checking") : tp("check")}
              </button>
              {run.phase === "follow_up" && (
                <button type="button" className="button" onClick={() => send({ type: "skip_follow_up" })}>
                  {tp("skipFollowUp")}
                </button>
              )}
            </div>
          )}

          <div role="status" className="lesson-notice">
            {run.lastCheck && (
              <p className="visually-hidden">
                {tp("rubricSummary", { passed: run.lastCheck.lines.filter((line) => line.passed).length, total: run.lastCheck.lines.length })}
              </p>
            )}
            {run.notice && (
              <p className={`notice${run.notice.endsWith("passed") || run.notice.startsWith("prediction") || run.notice === "lesson_completed" ? " notice-success" : ""}`}>
                {run.notice === "check_failed" || run.notice === "follow_up_failed" ? <WarningIcon /> : <InfoIcon />}
                <span>{t(`notice.${run.notice}`)}</span>
              </p>
            )}
          </div>

          {run.lastCheck && (
            <div className="lesson-box">
              <h4 ref={resultHeading} tabIndex={-1} className="output-label">
                {tp("rubric")}
              </h4>
              <ul className="pc-facts lesson-rubric">
                {run.lastCheck.lines.map((line, index) => (
                  <li key={index} data-passed={line.passed}>
                    {line.passed ? <CheckIcon /> : <WarningIcon />}
                    <span>
                      <strong>{line.passed ? tp("passed") : tp("notPassed")}:</strong> {line.label[locale]}
                      {line.observed && (
                        <span className="state-meta">
                          {" "}
                          ({tp("observed", { value: `⁦${line.observed}⁩` })})
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Hints are on the tutor's ladder, with the robot to point; this only opens it. */}
          {(run.phase === "work" || run.phase === "predict") && (
            <div className="button-row">
              <button type="button" className="button button-small" onClick={() => hintLadder.getState().setPanelOpen(true)}>
                {tp("hints")}
              </button>
              {help.hints.length > 0 && <span className="settings-hint">{tp("hintsOpened", { count: help.hints.length })}</span>}
            </div>
          )}

          {help.canShowExample && (
            <button type="button" className="button button-small" onClick={() => send({ type: "show_example" })}>
              {tp("showExample")}
            </button>
          )}
          {help.example && (
            <div className="lesson-box">
              <h4 className="output-label">{tp("example")}</h4>
              <p>{help.example[locale]}</p>
            </div>
          )}

          {(help.explanation || (run.phase === "explained" && run.predictionChoice && step.prediction)) && (
            <div className="lesson-box">
              <h4 className="output-label">{tp("explanation")}</h4>
              {help.explanation && <p>{help.explanation[locale]}</p>}
              {run.phase === "explained" && step.prediction && record?.predictionCorrect !== null && <p>{step.prediction.explanation[locale]}</p>}
            </div>
          )}

          {(run.phase === "explained" || (run.phase === "follow_up" && record?.followUp === "passed")) && (
            <div className="button-row">
              <button type="button" className="button button-primary" onClick={() => send({ type: "continue" })}>
                {tp("continue")}
              </button>
            </div>
          )}
        </>
      )}

      {summary && (
        <div className="lesson-box">
          <h4 className="output-label">{t("summary.heading")}</h4>
          <p>
            <strong>{t("summary.practised")}:</strong> {summary.practised.length ? summary.practised.map((item) => item.name[locale]).join(locale === "ar" ? "، " : ", ") : t("summary.none")}
          </p>
          <p>
            <strong>{t("summary.needsWork")}:</strong> {summary.needsWork.length ? summary.needsWork.map((item) => item.name[locale]).join(locale === "ar" ? "، " : ", ") : t("summary.none")}
          </p>
          <ul className="pc-facts">
            <li>{t("summary.independent", { count: summary.independentSteps, total: summary.totalSteps })}</li>
            {summary.predictions.answered > 0 && <li>{t("summary.predictions", { correct: summary.predictions.correct, answered: summary.predictions.answered })}</li>}
          </ul>
          <h5 className="output-label">{t("summary.next")}</h5>
          <div className="button-row">
            {nextLesson ? (
              <button type="button" className="button button-primary" onClick={() => openLesson(nextLesson.id)}>
                {t("summary.nextLesson", { title: nextLesson.title[locale] })}
              </button>
            ) : repeatStep ? (
              <button type="button" className="button button-primary" onClick={() => restartAt(repeatStep.id)}>
                {t("summary.repeat")}: {repeatStep.goal[locale]}
              </button>
            ) : (
              <button type="button" className="button button-primary" onClick={onLeaveToFree}>
                {t("summary.free")}
              </button>
            )}
            <Link href={`${labHref(lab, { mode })}#workspace-heading`} className="button">
              {t("summary.list")}
            </Link>
          </div>
        </div>
      )}

      <div className="lesson-leave">
        <button type="button" className="button button-small" onClick={onLeaveToFree}>
          {tp("toFree")}
        </button>
        <span className="settings-hint">{tp("toFreeNote")}</span>
      </div>
    </section>
  );
}
