// Re-validation against the real engines, the real catalog and the published PC lessons.
import { describe, expect, it } from "vitest";
import type { PCAction } from "@ytl/contracts";
import { pcCatalog } from "@ytl/catalog";
import type { Lesson, LessonExample } from "@ytl/curriculum";
import { network } from "@ytl/simulation";
import { buildChallenge, buildChallengeExample, firstBuild, firstBuildExample, memoryFault, memoryFaultExample } from "../../../../../content/lessons/pc/build";
import { VERIFY_LIMITS, verifyLesson, type LessonSubmission, type StepSubmission } from "./verify";

/**
 * A submission as the browser would send it, built from a lesson's published worked solution.
 * The example lists each step's own actions; a submission carries the whole log up to that step.
 */
function submissionFrom(lesson: Lesson, example: LessonExample): LessonSubmission {
  const log: PCAction[] = [];
  const steps: StepSubmission[] = example.steps.map((step) => {
    if (step.solution.lab === "choice") return { stepId: step.stepId, lab: "choice", optionId: step.solution.optionId };
    if (step.solution.lab !== "pc") throw new Error("these lessons are PC lessons");
    log.push(...step.solution.actions);
    return { stepId: step.stepId, lab: "pc", log: [...log] };
  });
  return { lessonId: lesson.id, lessonVersion: lesson.version, steps };
}

const PUBLISHED: [Lesson, LessonExample][] = [
  [firstBuild, firstBuildExample],
  [buildChallenge, buildChallengeExample],
  [memoryFault, memoryFaultExample],
];

describe("lesson re-validation: PC", () => {
  it("verifies each published lesson from its worked solution, step by step", () => {
    for (const [lesson, example] of PUBLISHED) {
      const outcome = verifyLesson(lesson, submissionFrom(lesson, example), pcCatalog);
      expect([lesson.id, outcome.verified]).toEqual([lesson.id, true]);
      if (!outcome.verified) continue;
      expect(outcome.steps.map((step) => step.stepId)).toEqual(lesson.steps.map((step) => step.id));
      // Every line of every step's rubric was decided by the engine and passed.
      expect(outcome.steps.every((step) => step.lines.length > 0 && step.lines.every((line) => line.passed))).toBe(true);
    }
  });

  it("does not verify a lesson whose actions do not reach the required state", () => {
    // The learner did nothing at all: the start state alone does not satisfy the first step.
    const idle = submissionFrom(firstBuild, firstBuildExample);
    const nothing: LessonSubmission = { ...idle, steps: idle.steps.map((step) => (step.lab === "pc" ? { ...step, log: [] } : step)) };
    const outcome = verifyLesson(firstBuild, nothing, pcCatalog);
    expect(outcome).toMatchObject({ verified: false, reason: "check_failed", stepId: firstBuild.steps[0].id });
    expect(!outcome.verified && outcome.lines?.some((line) => !line.passed)).toBe(true);

    // The last action of the last step is left out (power is never pressed).
    const good = submissionFrom(firstBuild, firstBuildExample);
    const last = good.steps[good.steps.length - 1];
    if (last.lab !== "pc") throw new Error("expected a PC step");
    const unfinished: LessonSubmission = { ...good, steps: [...good.steps.slice(0, -1), { ...last, log: last.log.slice(0, -1) }] };
    expect(verifyLesson(firstBuild, unfinished, pcCatalog)).toMatchObject({ verified: false, reason: "check_failed", stepId: last.stepId });
  });

  it("does not take the browser's word for anything but the actions", () => {
    const good = submissionFrom(firstBuild, firstBuildExample);
    // Claims of success in the submission change nothing.
    const claimed = { ...good, verified: true, passed: true, steps: good.steps.map((step) => ({ ...step, passed: true, log: step.lab === "pc" ? [] : undefined })) } as unknown as LessonSubmission;
    expect(verifyLesson(firstBuild, claimed, pcCatalog).verified).toBe(false);
  });

  it("checks a question step against the lesson's own answer", () => {
    const good = submissionFrom(memoryFault, memoryFaultExample);
    expect(verifyLesson(memoryFault, good, pcCatalog).verified).toBe(true);
    const wrong: LessonSubmission = { ...good, steps: good.steps.map((step) => (step.lab === "choice" ? { ...step, optionId: "psu-off" } : step)) };
    expect(verifyLesson(memoryFault, wrong, pcCatalog)).toMatchObject({ verified: false, reason: "check_failed", stepId: "name-cause" });
    // An action log where an answer is needed is not an answer.
    const mismatched: LessonSubmission = { ...good, steps: good.steps.map((step) => (step.lab === "choice" ? { stepId: step.stepId, lab: "pc" as const, log: [] } : step)) };
    expect(verifyLesson(memoryFault, mismatched, pcCatalog)).toMatchObject({ verified: false, reason: "invalid_submission", stepId: "name-cause" });
  });

  it("rejects a submission for another lesson or version, with a step missing, or malformed", () => {
    const good = submissionFrom(firstBuild, firstBuildExample);
    expect(verifyLesson(firstBuild, { ...good, lessonId: memoryFault.id }, pcCatalog)).toMatchObject({ verified: false, reason: "wrong_lesson" });
    expect(verifyLesson(firstBuild, { ...good, lessonVersion: firstBuild.version + 1 }, pcCatalog)).toMatchObject({ verified: false, reason: "wrong_version" });
    expect(verifyLesson(firstBuild, { ...good, steps: good.steps.slice(1) }, pcCatalog)).toMatchObject({ verified: false, reason: "missing_step", stepId: firstBuild.steps[0].id });
    for (const steps of [null, "all", [null], [{ lab: "pc", log: [] }]]) {
      expect(verifyLesson(firstBuild, { ...good, steps } as unknown as LessonSubmission, pcCatalog)).toMatchObject({ verified: false, reason: "invalid_submission" });
    }
    const junk: LessonSubmission = { ...good, steps: good.steps.map((step) => (step.lab === "pc" ? { ...step, log: ["press_power", 7, { no: "type" }] } : step)) };
    expect(verifyLesson(firstBuild, junk, pcCatalog)).toMatchObject({ verified: false, reason: "invalid_submission" });
    // Unknown action types and actions the engine refuses do not crash and do not help.
    const noise: PCAction[] = [{ type: "self_destruct" } as unknown as PCAction, { type: "remove_part", instanceId: "no-such-part" }];
    const noisy: LessonSubmission = { ...good, steps: good.steps.map((step) => (step.lab === "pc" ? { ...step, log: noise } : step)) };
    expect(verifyLesson(firstBuild, noisy, pcCatalog).verified).toBe(false);
  });

  it("bounds the work one submission can cause", () => {
    const good = submissionFrom(firstBuild, firstBuildExample);
    const press: PCAction = { type: "press_power" };
    const long: LessonSubmission = { ...good, steps: good.steps.map((step) => (step.lab === "pc" ? { ...step, log: Array.from({ length: VERIFY_LIMITS.maxLogLength + 1 }, () => press) } : step)) };
    expect(verifyLesson(firstBuild, long, pcCatalog)).toMatchObject({ verified: false, reason: "too_large" });
    const many: LessonSubmission = { ...good, steps: Array.from({ length: 11 }, (_, index) => ({ stepId: `extra-${index}`, lab: "pc" as const, log: Array.from({ length: 2_000 }, () => press) })) };
    expect(verifyLesson(firstBuild, many, pcCatalog)).toMatchObject({ verified: false, reason: "too_large" });
  });
});

describe("lesson re-validation: network and code", () => {
  const label = (en: string) => ({ en, ar: en });
  const hint = { text: label("hint") };
  const networkLesson = {
    id: "network.test.second-computer",
    version: 2,
    lab: "network",
    level: "beginner",
    kind: "lesson",
    title: label("t"),
    summary: label("s"),
    outcome: label("o"),
    prerequisites: [],
    skills: { devices: label("Devices") },
    start: { lab: "network", actions: network.HOME_WITH_ONT },
    steps: [
      {
        id: "add-computer",
        skill: "devices",
        goal: label("Add a second wired computer"),
        check: { type: "net.device_count", label: label("Two wired computers"), kind: "wired_client", min: 2 },
        hints: [hint, hint, hint],
        explanation: label("e"),
      },
    ],
  } as unknown as Lesson;

  it("replays a network log on the network engine", () => {
    const submit = (log: unknown[]): LessonSubmission => ({ lessonId: networkLesson.id, lessonVersion: 2, steps: [{ stepId: "add-computer", lab: "network", log }] });
    expect(verifyLesson(networkLesson, submit([{ type: "add_device", kind: "wired_client" }]), pcCatalog)).toMatchObject({ verified: true, steps: [{ stepId: "add-computer" }] });
    expect(verifyLesson(networkLesson, submit([]), pcCatalog)).toMatchObject({ verified: false, reason: "check_failed", stepId: "add-computer" });
    // A log the engine refuses part-way does not describe a reachable state.
    const refused = verifyLesson(networkLesson, submit([{ type: "remove_device", deviceId: "no-such-device" }, { type: "add_device", kind: "wired_client" }]), pcCatalog);
    expect(refused).toMatchObject({ verified: false, reason: "action_rejected", stepId: "add-computer" });
    // A PC log for a network lesson is the wrong kind of evidence.
    const wrongLab: LessonSubmission = { lessonId: networkLesson.id, lessonVersion: 2, steps: [{ stepId: "add-computer", lab: "pc", log: [] }] };
    expect(verifyLesson(networkLesson, wrongLab, pcCatalog)).toMatchObject({ verified: false, reason: "invalid_submission" });
  });

  it("does not verify a lesson of an archived lab (the former Code Studio)", () => {
    const codeLesson = { ...networkLesson, id: "code.test.hello", lab: "code", start: { lab: "code", track: "python", files: [] } } as unknown as Lesson;
    expect(verifyLesson(codeLesson, { lessonId: codeLesson.id, lessonVersion: 2, steps: [] }, pcCatalog)).toMatchObject({ verified: false, reason: "unsupported_lab" });
  });
});
