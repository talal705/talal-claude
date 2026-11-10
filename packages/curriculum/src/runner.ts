// The lesson runner: a pure state machine over a lesson. It follows the learning loop
// goal -> optional prediction -> action -> check -> explanation -> correction -> a related small
// task -> summary. It has no clock and touches no storage; the page feeds it events and stores
// the progress it returns. Completion is decided here by the checkers, never by the page.
import { checkStep } from "./checkers";
import type { CheckResult, Lesson, LessonEvidence, LessonMode, LessonProgress, LessonStep, LessonSummary, LessonTask, StepRecord } from "./contract";

export type RunnerPhase =
  /** The step's prediction question is on offer. */
  | "predict"
  /** The learner is working on the step. */
  | "work"
  /** The step is passed; its explanation is shown. */
  | "explained"
  /** The related small task after a corrected error. */
  | "follow_up"
  /** Every step is done. */
  | "summary";

export interface LessonRunState {
  lesson: Lesson;
  mode: LessonMode;
  stepIndex: number;
  phase: RunnerPhase;
  /** One record per step, in order; steps not reached yet have zero attempts. */
  records: StepRecord[];
  /** The outcome of the last submitted check for the task on screen; null before any. */
  lastCheck: CheckResult | null;
  /** The option chosen for the current step's prediction, when answered. */
  predictionChoice: string | null;
  /** What just happened, for the page to say; the page words it from its own messages. */
  notice: RunnerNotice | null;
}

export type RunnerNotice =
  | "check_passed"
  | "check_failed"
  | "hint_locked_until_attempt"
  | "no_more_hints"
  | "example_not_in_test"
  | "prediction_right"
  | "prediction_wrong"
  | "follow_up_offered"
  | "follow_up_passed"
  | "follow_up_failed"
  | "lesson_completed";

export type LessonEvent =
  | { type: "answer_prediction"; optionId: string }
  | { type: "skip_prediction" }
  /** The learner asks for the next hint level. */
  | { type: "request_hint" }
  /** "Show me an example". */
  | { type: "show_example" }
  /** The learner submits the current task. The page supplies evidence; the runner judges it. */
  | { type: "submit"; evidence: LessonEvidence }
  /** After the explanation: go on to the follow-up if one is due, else the next step or the summary. */
  | { type: "continue" }
  | { type: "skip_follow_up" };

const emptyRecord = (step: LessonStep): StepRecord => ({
  stepId: step.id,
  attempts: 0,
  hintLevel: 0,
  exampleShown: false,
  predictionCorrect: null,
  passed: false,
  independent: false,
  followUp: "not_offered",
});

/** A challenge is always taken in test mode, whatever was asked for. */
export function startLesson(lesson: Lesson, mode: LessonMode = "learn"): LessonRunState {
  const effective: LessonMode = lesson.kind === "challenge" ? "test" : mode;
  const first = lesson.steps[0];
  return {
    lesson,
    mode: effective,
    stepIndex: 0,
    phase: !first ? "summary" : first.prediction ? "predict" : "work",
    records: lesson.steps.map(emptyRecord),
    lastCheck: null,
    predictionChoice: null,
    notice: null,
  };
}

/** Picks a stored run up again. Progress for another lesson version, or that does not fit the lesson, starts over. */
export function resumeLesson(lesson: Lesson, progress: LessonProgress): LessonRunState {
  const fresh = startLesson(lesson, progress.mode);
  const fits =
    progress.lessonId === lesson.id &&
    progress.lessonVersion === lesson.version &&
    progress.steps.length === lesson.steps.length &&
    progress.steps.every((record, index) => record.stepId === lesson.steps[index].id);
  if (!fits) return fresh;
  const stepIndex = Math.min(Math.max(0, progress.stepIndex), lesson.steps.length);
  const step = lesson.steps[stepIndex];
  const record = progress.steps[stepIndex];
  const phase: RunnerPhase = !step ? "summary" : record.followUp === "pending" ? "follow_up" : record.passed ? "explained" : step.prediction && record.attempts === 0 && record.predictionCorrect === null ? "predict" : "work";
  return { ...fresh, stepIndex, phase, records: progress.steps.map((r) => ({ ...r })) };
}

export function currentStep(state: LessonRunState): LessonStep | null {
  return state.lesson.steps[state.stepIndex] ?? null;
}

/** The task on screen: the step, or its follow-up. */
export function currentTask(state: LessonRunState): LessonTask | null {
  const step = currentStep(state);
  if (!step) return null;
  return state.phase === "follow_up" ? (step.followUp ?? null) : step;
}

/**
 * What the page may show for the current step. In test mode the third hint and the explanation
 * stay hidden until an attempt has been submitted, and there is no example.
 */
export function visibleHelp(state: LessonRunState) {
  const step = currentStep(state);
  const record = state.records[state.stepIndex];
  if (!step || !record || state.phase === "summary") return { hints: [], explanation: null, example: null, canRequestHint: false, canShowExample: false, nextHintLocked: false };
  const task = currentTask(state) ?? step;
  const attempted = record.attempts > 0;
  const ceiling = state.mode === "test" && !attempted ? 2 : 3;
  const inFollowUp = state.phase === "follow_up";
  // The follow-up is an independent check of understanding: its hints are shown only once it has been tried.
  const level = inFollowUp ? 0 : record.hintLevel;
  const explanationOpen = state.phase === "explained" || (state.mode === "learn" ? attempted : attempted && state.phase !== "follow_up");
  return {
    hints: task.hints.slice(0, level),
    explanation: explanationOpen && !inFollowUp ? step.explanation : null,
    example: !inFollowUp && record.exampleShown ? (step.example ?? null) : null,
    canRequestHint: !inFollowUp && (state.phase === "work" || state.phase === "predict") && record.hintLevel < ceiling,
    canShowExample: !inFollowUp && state.mode === "learn" && Boolean(step.example) && !record.exampleShown && state.phase === "work",
    /** True when the only thing between the learner and the next hint is submitting an attempt (test mode). */
    nextHintLocked: !inFollowUp && state.mode === "test" && !attempted && record.hintLevel === 2,
  };
}

export function lessonReducer(state: LessonRunState, event: LessonEvent): LessonRunState {
  const step = currentStep(state);
  const record = state.records[state.stepIndex];
  if (!step || !record || state.phase === "summary") return state;
  const update = (patch: Partial<StepRecord>, rest: Partial<LessonRunState> = {}): LessonRunState => ({
    ...state,
    ...rest,
    records: state.records.map((r, index) => (index === state.stepIndex ? { ...r, ...patch } : r)),
  });
  const advance = (from: LessonRunState): LessonRunState => {
    const stepIndex = from.stepIndex + 1;
    const next = from.lesson.steps[stepIndex];
    if (!next) return { ...from, stepIndex, phase: "summary", lastCheck: null, predictionChoice: null, notice: "lesson_completed" };
    return { ...from, stepIndex, phase: next.prediction ? "predict" : "work", lastCheck: null, predictionChoice: null, notice: null };
  };

  switch (event.type) {
    case "answer_prediction": {
      if (state.phase !== "predict" || !step.prediction) return state;
      if (!step.prediction.options.some((option) => option.id === event.optionId)) return state;
      const correct = event.optionId === step.prediction.correctOptionId;
      // The answer is recorded and the learner goes on; whether it was right is told after the attempt.
      return update({ predictionCorrect: correct }, { phase: "work", predictionChoice: event.optionId, notice: null });
    }
    case "skip_prediction":
      return state.phase === "predict" ? { ...state, phase: "work", notice: null } : state;

    case "request_hint": {
      if (state.phase !== "work" && state.phase !== "predict") return state;
      if (record.hintLevel >= 3) return { ...state, notice: "no_more_hints" };
      if (state.mode === "test" && record.attempts === 0 && record.hintLevel >= 2) return { ...state, notice: "hint_locked_until_attempt" };
      return update({ hintLevel: (record.hintLevel + 1) as StepRecord["hintLevel"] }, { notice: null });
    }
    case "show_example": {
      if (state.phase !== "work" || !step.example) return state;
      if (state.mode === "test") return { ...state, notice: "example_not_in_test" };
      return update({ exampleShown: true }, { notice: null });
    }

    case "submit": {
      if (state.phase === "follow_up") {
        if (!step.followUp) return state;
        const result = checkStep(step.followUp.check, event.evidence);
        if (!result.passed) return { ...state, lastCheck: result, notice: "follow_up_failed" };
        return update({ followUp: "passed" }, { lastCheck: result, notice: "follow_up_passed" });
      }
      if (state.phase !== "work" && state.phase !== "predict") return state;
      const result = checkStep(step.check, event.evidence);
      const attempts = record.attempts + 1;
      if (!result.passed) return update({ attempts }, { phase: "work", lastCheck: result, notice: "check_failed" });
      const independent = attempts === 1 && record.hintLevel < 3 && !record.exampleShown;
      const predictionNotice: RunnerNotice | null = record.predictionCorrect === null ? null : record.predictionCorrect ? "prediction_right" : "prediction_wrong";
      return update({ attempts, passed: true, independent }, { phase: "explained", lastCheck: result, notice: predictionNotice ?? "check_passed" });
    }

    case "continue": {
      if (state.phase === "follow_up") {
        // The follow-up is left only by passing it or by choosing to skip it.
        return record.followUp === "passed" ? advance(state) : state;
      }
      if (state.phase !== "explained") return state;
      // A corrected error is followed by a related small task.
      if (record.attempts > 1 && step.followUp && record.followUp === "not_offered") {
        return update({ followUp: "pending" }, { phase: "follow_up", lastCheck: null, notice: "follow_up_offered" });
      }
      return advance(state);
    }
    case "skip_follow_up": {
      if (state.phase !== "follow_up" || record.followUp === "passed") return state;
      return advance(update({ followUp: "skipped" }));
    }
  }
}

/** What to store. `at` is the current time as ISO text, supplied by the page. */
export function toProgress(state: LessonRunState, at?: string, previous?: Pick<LessonProgress, "startedAt" | "completedAt">): LessonProgress {
  const completed = state.phase === "summary" && state.records.every((record) => record.passed);
  return {
    lessonId: state.lesson.id,
    lessonVersion: state.lesson.version,
    mode: state.mode,
    status: completed ? "completed" : "in_progress",
    stepIndex: state.stepIndex,
    steps: state.records.map((record) => ({ ...record })),
    ...(previous?.startedAt ?? at ? { startedAt: previous?.startedAt ?? at } : {}),
    ...(at ? { updatedAt: at } : {}),
    ...(completed ? { completedAt: previous?.completedAt ?? at } : {}),
  };
}

/**
 * The session summary: what was practised, what needs more work, and one next step. Hints are
 * counted as information for the learner; nothing here grades or ranks.
 */
export function summarize(state: LessonRunState): LessonSummary {
  const { lesson, records } = state;
  const named = (skill: string) => ({ skill, name: lesson.skills[skill] ?? { en: skill, ar: skill } });
  const unique = (skills: string[]) => [...new Set(skills)].map(named);
  const struggled = (record: StepRecord) => record.passed && (record.attempts > 1 || record.hintLevel === 3 || record.exampleShown || record.followUp === "skipped" || record.followUp === "pending");
  const skillOf = (record: StepRecord) => lesson.steps.find((step) => step.id === record.stepId)!.skill;
  const passed = records.filter((record) => record.passed);
  const weak = records.filter((record) => struggled(record) || !record.passed);
  const completed = records.length > 0 && passed.length === records.length;
  const firstOpen = records.find((record) => !record.passed);
  const answered = records.filter((record) => record.predictionCorrect !== null);
  let next: LessonSummary["next"];
  if (firstOpen) next = { kind: "repeat_step", stepId: firstOpen.stepId };
  else if (weak.length > 0 && weak.length * 2 > records.length) next = { kind: "repeat_step", stepId: weak[0].stepId };
  else if (lesson.nextLessonId) next = { kind: "next_lesson", lessonId: lesson.nextLessonId };
  else next = { kind: "free_practice" };
  return {
    lessonId: lesson.id,
    completed,
    practised: unique(passed.map(skillOf)),
    needsWork: unique(weak.map(skillOf)),
    independentSteps: records.filter((record) => record.independent).length,
    totalSteps: records.length,
    hintsUsed: records.reduce((sum, record) => sum + record.hintLevel, 0),
    predictions: { answered: answered.length, correct: answered.filter((record) => record.predictionCorrect).length },
    next,
  };
}
