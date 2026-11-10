// The optional baseline check: a few questions before a lab that suggest where to start.
// It suggests; it never locks anything, keeps no score for the learner to see, and "I don't know"
// is always an answer.
import type { LabType, Localized } from "@ytl/contracts";
import type { LessonChoice } from "./contract";

export const DONT_KNOW = "dont-know";

export interface BaselineQuestion {
  id: string;
  question: Localized;
  /** "I don't know" is added by the page; it is not listed here. */
  options: readonly LessonChoice[];
  correctOptionId: string;
  /** The skill this question asks about, named as in the lesson that teaches it. */
  skill: string;
  /** The lesson that teaches it. */
  lessonId: string;
}

export interface Baseline {
  id: string;
  lab: LabType;
  title: Localized;
  intro: Localized;
  questions: readonly BaselineQuestion[];
  /** Where a learner who knows everything asked here goes: the level's Test Yourself challenge. */
  allKnownLessonId: string;
}

export interface BaselineResult {
  baselineId: string;
  /** Skills the answers showed the learner already has. */
  known: string[];
  /** Skills answered wrongly or with "I don't know". */
  toLearn: string[];
  /** Questions left without any answer. */
  skipped: number;
  /**
   * One suggestion. `start_here`: the lesson for the first skill to learn. `skip_ahead`: every
   * skill was known, so try the challenge. `no_answers`: nothing was answered; start at the beginning.
   */
  suggestion: { kind: "start_here" | "skip_ahead" | "no_answers"; lessonId: string };
}

/** `answers` maps question IDs to an option ID or DONT_KNOW; a missing entry is a skipped question. */
export function scoreBaseline(baseline: Baseline, answers: Readonly<Record<string, string>>): BaselineResult {
  const known: string[] = [];
  const toLearn: string[] = [];
  let skipped = 0;
  let firstGap: BaselineQuestion | undefined;
  for (const question of baseline.questions) {
    const answer = answers[question.id];
    if (answer === undefined) {
      skipped += 1;
      continue;
    }
    if (answer === question.correctOptionId) {
      if (!known.includes(question.skill)) known.push(question.skill);
    } else {
      if (!toLearn.includes(question.skill)) toLearn.push(question.skill);
      firstGap ??= question;
    }
  }
  const answered = baseline.questions.length - skipped;
  const first = baseline.questions[0]?.lessonId ?? baseline.allKnownLessonId;
  const suggestion: BaselineResult["suggestion"] =
    answered === 0
      ? { kind: "no_answers", lessonId: first }
      : firstGap
        ? { kind: "start_here", lessonId: firstGap.lessonId }
        : skipped > 0
          ? { kind: "start_here", lessonId: baseline.questions.find((q) => answers[q.id] === undefined)!.lessonId }
          : { kind: "skip_ahead", lessonId: baseline.allKnownLessonId };
  return { baselineId: baseline.id, known: known.filter((skill) => !toLearn.includes(skill)), toLearn, skipped, suggestion };
}
