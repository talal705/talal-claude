// Server-side re-validation of a finished PC or network lesson: the learner's actions are replayed
// on the real engines and each step's condition is checked again with the curriculum's own
// checkers. Nothing the browser says about passing is believed; only the actions are taken from it.
// Pure: no database, no network, no clock. Server-only by location, not by dependency.
import type { NetworkAction, PCAction, PCCatalog } from "@ytl/contracts";
import { checkStep, type CheckLine, type CheckSpec, type Lesson, type LessonEvidence, type LessonStep } from "@ytl/curriculum";
import { network, pc } from "@ytl/simulation";

/**
 * What the browser submits for one step. `log` is every action of the workspace's timeline after
 * the lesson's own start actions, at the moment the step's check passed: the whole log again for
 * each step, not the difference from the step before, so an undo between steps cannot confuse it.
 */
export type StepSubmission =
  | { stepId: string; lab: "pc"; log: readonly unknown[] }
  | { stepId: string; lab: "network"; log: readonly unknown[] }
  /** A step whose condition is a question with one right answer. */
  | { stepId: string; lab: "choice"; optionId: string };

export interface LessonSubmission {
  lessonId: string;
  lessonVersion: number;
  steps: readonly StepSubmission[];
}

export const VERIFY_LIMITS = {
  /** Actions in one step's log. */
  maxLogLength: 2_000,
  /** Actions over all steps of one submission; bounds the work of one verification. */
  maxTotalActions: 20_000,
} as const;

export type VerifyFailure =
  /** The submission is for another lesson or another version of it than the server has. */
  | "wrong_lesson"
  | "wrong_version"
  /** Code lessons are not re-validated here: a run in the browser cannot be repeated from a log. */
  | "unsupported_lab"
  /** A step mixes a question with an engine condition; no single kind of evidence can satisfy it. */
  | "unsupported_check"
  | "missing_step"
  | "invalid_submission"
  | "too_large"
  /** The engine refused one of the actions, so the log does not describe a state the workspace could reach. */
  | "action_rejected"
  /** The actions replayed, but the step's condition is not met in the resulting state. */
  | "check_failed";

export type VerifyOutcome =
  | { verified: true; steps: { stepId: string; lines: CheckLine[] }[] }
  | { verified: false; reason: VerifyFailure; stepId?: string; detail?: string; lines?: CheckLine[] };

function leafTypes(spec: CheckSpec, into: Set<string> = new Set()): Set<string> {
  if (spec.type === "all" || spec.type === "any") for (const part of spec.of) leafTypes(part, into);
  else into.add(spec.type);
  return into;
}

function isActionList(value: unknown): value is readonly { type: string }[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "object" && entry !== null && typeof (entry as { type?: unknown }).type === "string");
}

type Replayed = { ok: true; evidence: LessonEvidence } | { ok: false; reason: VerifyFailure; detail: string };

/** The state after the lesson's start actions and then the learner's log, as evidence for the checkers. */
function replayStep(lesson: Lesson, log: readonly { type: string }[], catalog: PCCatalog): Replayed {
  try {
    if (lesson.start.lab === "pc") {
      const start = pc.replay(lesson.start.actions, catalog);
      // An action the engine rejects leaves the build unchanged, exactly as in the workspace, so it does not end the replay.
      const end = pc.replay(log as readonly PCAction[], catalog, start.state);
      return { ok: true, evidence: { lab: "pc", state: end.state, catalog } };
    }
    if (lesson.start.lab === "network") {
      const start = network.replay(lesson.start.actions);
      const end = network.replay(log as readonly NetworkAction[], start.state);
      if (end.rejection) return { ok: false, reason: "action_rejected", detail: `action ${end.applied + 1} of the log: ${end.rejection.code}` };
      return { ok: true, evidence: { lab: "network", state: end.state } };
    }
  } catch (error) {
    // The log is untrusted input; an action the engine cannot even read must not take the server down.
    return { ok: false, reason: "invalid_submission", detail: error instanceof Error ? error.message : String(error) };
  }
  return { ok: false, reason: "unsupported_lab", detail: "only PC and network lessons are replayed" };
}

function checkOne(lesson: Lesson, step: LessonStep, submitted: StepSubmission, catalog: PCCatalog): { passed: boolean; lines: CheckLine[] } | { failure: VerifyFailure; detail: string } {
  const kinds = leafTypes(step.check);
  const choiceOnly = [...kinds].every((kind) => kind === "choice");
  if (kinds.has("choice") && !choiceOnly) return { failure: "unsupported_check", detail: "the step combines a question with an engine condition" };

  if (choiceOnly) {
    if (submitted.lab !== "choice" || typeof submitted.optionId !== "string") return { failure: "invalid_submission", detail: "this step needs the chosen option" };
    return checkStep(step.check, { lab: "choice", optionId: submitted.optionId });
  }
  if (submitted.lab !== lesson.start.lab) return { failure: "invalid_submission", detail: `this step needs a ${lesson.start.lab} action log` };
  if (!isActionList(submitted.log)) return { failure: "invalid_submission", detail: "the log must be a list of actions" };
  if (submitted.log.length > VERIFY_LIMITS.maxLogLength) return { failure: "too_large", detail: `a log holds at most ${VERIFY_LIMITS.maxLogLength} actions` };
  const replayed = replayStep(lesson, submitted.log, catalog);
  if (!replayed.ok) return { failure: replayed.reason, detail: replayed.detail };
  return checkStep(step.check, replayed.evidence);
}

/**
 * True only when every step of the lesson, in order, has a submission whose replay satisfies the
 * step's condition. What this establishes: the lesson can be completed with these actions.
 * What it does not: how many attempts or hints it took, which stay as the browser reported them.
 */
export function verifyLesson(lesson: Lesson, submission: LessonSubmission, catalog: PCCatalog): VerifyOutcome {
  // Archived labs (the former Code Studio) have no engine to replay a log on.
  if (lesson.start.lab !== "pc" && lesson.start.lab !== "network") return { verified: false, reason: "unsupported_lab", detail: "only PC and network lessons are re-validated from a log" };
  if (typeof submission !== "object" || submission === null || !Array.isArray(submission.steps)) return { verified: false, reason: "invalid_submission", detail: "the submission has no steps" };
  if (submission.lessonId !== lesson.id) return { verified: false, reason: "wrong_lesson" };
  if (submission.lessonVersion !== lesson.version) return { verified: false, reason: "wrong_version", detail: `the server has version ${lesson.version}` };

  let total = 0;
  for (const step of submission.steps) {
    if (typeof step !== "object" || step === null || typeof step.stepId !== "string") return { verified: false, reason: "invalid_submission", detail: "each step needs a stepId" };
    if ("log" in step && Array.isArray(step.log)) total += step.log.length;
  }
  if (total > VERIFY_LIMITS.maxTotalActions) return { verified: false, reason: "too_large", detail: `a submission holds at most ${VERIFY_LIMITS.maxTotalActions} actions` };

  const verifiedSteps: { stepId: string; lines: CheckLine[] }[] = [];
  for (const step of lesson.steps) {
    // The first submission for the step counts; extra entries and unknown step IDs are ignored.
    const submitted = submission.steps.find((candidate) => candidate.stepId === step.id);
    if (!submitted) return { verified: false, reason: "missing_step", stepId: step.id };
    const result = checkOne(lesson, step, submitted, catalog);
    if ("failure" in result) return { verified: false, reason: result.failure, stepId: step.id, detail: result.detail };
    if (!result.passed) return { verified: false, reason: "check_failed", stepId: step.id, lines: result.lines };
    verifiedSteps.push({ stepId: step.id, lines: result.lines });
  }
  return { verified: true, steps: verifiedSteps };
}
