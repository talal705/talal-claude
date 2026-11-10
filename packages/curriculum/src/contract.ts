// Lesson contract (proposed by `interaction`; the lead moves it to @ytl/contracts when stable).
// A lesson is data: text in both languages, a starting state, ordered steps, and for each step a
// completion condition that a pure checker evaluates on the lab's own engine state. Nothing here renders, and no page decides whether a step is complete.
import type {
  LabType,
  Localized,
  NetworkAction,
  NetworkDeviceKind,
  NetworkDiagnosticCode,
  NetworkPortRole,
  NetworkState,
  PCAction,
  PCBuildState,
  PCCatalog,
  PCDiagnosticCode,
  PCPartCategory,
  ScreenState,
  StartupOutcome,
  StartupStage,
  TutorTargetRef,
} from "@ytl/contracts";

export const LESSON_CONTRACT_VERSION = 1;

/** Difficulty of the content. "expert" describes the track's hardest material, not a professional qualification. */
export type LessonLevel = "beginner" | "intermediate" | "advanced" | "expert";
export const LESSON_LEVELS: readonly LessonLevel[] = ["beginner", "intermediate", "advanced", "expert"];

/**
 * `lesson`: guided, with goals, hints and explanations (Learn).
 * `challenge`: the same checkers with no solution before an attempt is submitted (Test Yourself).
 * `fault`: a broken starting state to diagnose and repair.
 */
export type LessonKind = "lesson" | "challenge" | "fault";

/** How the learner is working. A `challenge` always runs in `test`. */
export type LessonMode = "learn" | "test";

// ---------- Starting state ----------

export type LessonStart =
  /** Replayed on an empty build with the shared catalog. */
  | { lab: "pc"; actions: readonly PCAction[] }
  /** Replayed on an empty network. */
  | { lab: "network"; actions: readonly NetworkAction[] };

// ---------- Completion conditions ----------

/** A network device named by its ID, or as the n-th device of a kind in creation order (default the first). */
export type DeviceSelector = { id: string } | { kind: NetworkDeviceKind; index?: number };

interface Labelled {
  /** The rubric line for this condition: what must be true, in words the learner can act on. */
  label: Localized;
}

export type CheckSpec =
  | (Labelled & { type: "all"; of: readonly CheckSpec[] })
  | (Labelled & { type: "any"; of: readonly CheckSpec[] })
  /** A question with one right answer, for prediction-free reasoning steps (name the cause before repairing it). */
  | (Labelled & { type: "choice"; correctOptionId: string })
  // PC: decided by the PC engine over the build state.
  | (Labelled & { type: "pc.part_count"; category: PCPartCategory; min?: number; max?: number; mounted?: boolean })
  /** The fully seated memory modules occupy exactly these slots (mount point IDs). */
  | (Labelled & { type: "pc.memory_slots"; slots: readonly string[] })
  /** None of these findings is reported by the engine (standing check plus, once power is pressed, the startup stages). */
  | (Labelled & { type: "pc.no_diagnostic"; codes: readonly PCDiagnosticCode[] })
  /** Power has been pressed and the staged startup reaches this. Any given field must match. */
  | (Labelled & { type: "pc.startup"; screen?: readonly ScreenState[]; outcome?: readonly StartupOutcome[]; stagePassed?: StartupStage })
  // Network: decided by the network engine over the topology.
  | (Labelled & { type: "net.device_count"; kind: NetworkDeviceKind; min: number })
  /** A link that carries frames joins these two devices (optionally at ports of these roles). */
  | (Labelled & { type: "net.link"; a: DeviceSelector & { portRole?: NetworkPortRole }; b: DeviceSelector & { portRole?: NetworkPortRole } })
  /** The interface has an address, optionally from this source. */
  | (Labelled & { type: "net.address"; device: DeviceSelector; interface: "nic" | "wan" | "lan"; source?: "dhcp" | "static" })
  /** A virtual ping from the device to this address or name ends as stated. */
  | (Labelled & { type: "net.ping"; from: DeviceSelector; to: string; succeeds: boolean })
  /** The standing check reports none of these codes (or, without `codes`, nothing blocking). */
  | (Labelled & { type: "net.no_diagnostic"; codes?: readonly NetworkDiagnosticCode[] });

export type CheckType = CheckSpec["type"];

/** What a checker is given. The page collects it; it never judges it. */
export type LessonEvidence =
  | { lab: "pc"; state: PCBuildState; catalog: PCCatalog }
  | { lab: "network"; state: NetworkState }
  /** The option the learner chose in a `choice` step. */
  | { lab: "choice"; optionId: string };

export interface CheckLine {
  label: Localized;
  passed: boolean;
  /** What the engine or the run showed, as a language-neutral value. */
  observed?: string;
}

export interface CheckResult {
  passed: boolean;
  /** One line per leaf condition, in the order written. The rubric with its outcome. */
  lines: CheckLine[];
}

// ---------- Steps ----------

export interface LessonHint {
  text: Localized;
  /** What the tutor can point at for this hint. */
  target?: Pick<TutorTargetRef, "id" | "kind">;
}

export interface LessonChoice {
  id: string;
  text: Localized;
}

export interface LessonTask {
  /** What to do, as one sentence. */
  goal: Localized;
  /** For a `choice` check: the options offered. */
  options?: readonly LessonChoice[];
  check: CheckSpec;
  /**
   * Three levels, asked for one at a time: a thinking question, the likely area, the explicit
   * explanation. In test mode the third is withheld until an attempt has been submitted.
   */
  hints: readonly [LessonHint, LessonHint, LessonHint];
  /** The reason behind it, shown after an attempt: why it works or why it failed, not only where. */
  explanation: Localized;
}

export interface LessonStep extends LessonTask {
  id: string;
  /** The skill this step practises; steps of several lessons can share one. Used in the summary. */
  skill: string;
  /** Asked before the learner acts. Optional to answer; never blocks the step. */
  prediction?: { question: Localized; options: readonly LessonChoice[]; correctOptionId: string; explanation: Localized };
  /** "Show me an example": one short demonstrated step in words, after which the learner continues alone. Learn mode only. */
  example?: Localized;
  /** A related small task offered after the learner got this step wrong and then right, to check understanding. */
  followUp?: LessonTask;
}

// ---------- Lesson ----------

export interface Lesson {
  /** Stable, e.g. `pc.beginner.memory-slots`. */
  id: string;
  /** Raised when steps or checks change, so stored progress for an older version can be recognised. */
  version: number;
  lab: LabType;
  level: LessonLevel;
  kind: LessonKind;
  title: Localized;
  summary: Localized;
  /** What the learner can do afterwards, stated so that it can be checked. */
  outcome: Localized;
  /** Lesson IDs that should come first. */
  prerequisites: readonly string[];
  /** Human names of the skills referred to by the steps. */
  skills: Readonly<Record<string, Localized>>;
  start: LessonStart;
  steps: readonly LessonStep[];
  /** Where to go after this one. */
  nextLessonId?: string;
}

// ---------- Progress (stored per learner; guest store now, account later) ----------

export interface StepRecord {
  stepId: string;
  /** Checks submitted for the step itself. */
  attempts: number;
  /** Highest hint level shown, 0 to 3. Recorded as a fact about the session, never as a penalty. */
  hintLevel: 0 | 1 | 2 | 3;
  exampleShown: boolean;
  /** Null when the step has no prediction or it was skipped. */
  predictionCorrect: boolean | null;
  passed: boolean;
  /** Passed on the first submitted attempt, without the third hint or the example. */
  independent: boolean;
  /** `not_offered` when the step was right first time or has no follow-up. */
  followUp: "not_offered" | "pending" | "passed" | "skipped";
}

export interface LessonProgress {
  lessonId: string;
  lessonVersion: number;
  mode: LessonMode;
  status: "in_progress" | "completed";
  /** Index of the step the learner is on; equals the number of steps when completed. */
  stepIndex: number;
  steps: StepRecord[];
  /** ISO 8601 UTC, supplied by the page; the runner has no clock. */
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface LessonSummary {
  lessonId: string;
  completed: boolean;
  /** Skills of the steps that were passed. */
  practised: { skill: string; name: Localized }[];
  /** Skills where the learner needed several attempts, the full explanation, the example, or missed the follow-up. */
  needsWork: { skill: string; name: Localized }[];
  /** Steps passed on the first attempt without the third hint or the example. */
  independentSteps: number;
  totalSteps: number;
  hintsUsed: number;
  /** Predictions answered, and how many matched what happened. */
  predictions: { answered: number; correct: number };
  /** One next step. */
  next: { kind: "next_lesson"; lessonId: string } | { kind: "repeat_step"; stepId: string } | { kind: "free_practice" };
}

// ---------- Tested examples ----------

/** How one task is solved, for the tests that prove a lesson can be completed and its checks tell right from wrong. */
export type ExampleSolution =
  | { lab: "pc"; actions: readonly PCAction[] }
  | { lab: "network"; actions: readonly NetworkAction[] }
  | { lab: "choice"; optionId: string };

/**
 * A worked solution for every step of a lesson, in order. Actions are applied on top of the
 * start state and the earlier steps. Published with the lesson and run by its tests.
 */
export interface LessonExample {
  lessonId: string;
  steps: readonly { stepId: string; solution: ExampleSolution; followUp?: ExampleSolution }[];
}
