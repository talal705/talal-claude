import { describe, expect, it } from "vitest";
import type { Lesson, LessonEvidence, LessonStep } from "./contract";
import { currentTask, lessonReducer, resumeLesson, startLesson, summarize, toProgress, visibleHelp, type LessonEvent, type LessonRunState } from "./runner";

const L = (en: string) => ({ en, ar: `${en} (ar)` });
const hints = (name: string): LessonStep["hints"] => [{ text: L(`${name} hint 1`) }, { text: L(`${name} hint 2`), target: { id: "pc:connector:motherboard-1/dimm-a2", kind: "connector" } }, { text: L(`${name} hint 3`) }];
const pick = (optionId: string): LessonEvent => ({ type: "submit", evidence: { lab: "choice", optionId } });

// A lesson whose steps are answered by a choice, so the runner's own behaviour is what is tested.
const lesson: Lesson = {
  id: "test.beginner.sample",
  version: 2,
  lab: "pc",
  level: "beginner",
  kind: "lesson",
  title: L("Sample"),
  summary: L("Sample"),
  outcome: L("Can do the sample"),
  prerequisites: [],
  skills: { slots: L("Choosing memory slots"), power: L("Reading the startup stages") },
  start: { lab: "pc", actions: [] },
  nextLessonId: "test.beginner.next",
  steps: [
    {
      id: "s1",
      skill: "slots",
      goal: L("Step one"),
      prediction: { question: L("What will happen?"), options: [{ id: "boots", text: L("It boots") }, { id: "nothing", text: L("Nothing") }], correctOptionId: "boots", explanation: L("Because.") },
      check: { type: "choice", label: L("Step one done"), correctOptionId: "right" },
      hints: hints("s1"),
      explanation: L("Why step one works."),
      example: L("Watch: do it like this."),
      followUp: { goal: L("Now a similar one"), check: { type: "choice", label: L("Similar done"), correctOptionId: "also-right" }, hints: hints("f1"), explanation: L("Same idea.") },
    },
    { id: "s2", skill: "power", goal: L("Step two"), check: { type: "choice", label: L("Step two done"), correctOptionId: "right" }, hints: hints("s2"), explanation: L("Why step two works.") },
  ],
};

function run(events: LessonEvent[], from: LessonRunState = startLesson(lesson)) {
  return events.reduce(lessonReducer, from);
}
const hintTexts = (state: LessonRunState) => visibleHelp(state).hints.map((hint) => hint.text.en);

describe("the learning loop", () => {
  it("starts at the prediction of the first step, with nothing revealed", () => {
    const state = startLesson(lesson);
    expect(state).toMatchObject({ mode: "learn", stepIndex: 0, phase: "predict", lastCheck: null });
    expect(visibleHelp(state)).toMatchObject({ hints: [], explanation: null, example: null });
  });

  it("the prediction is optional: answering or skipping both lead to the work, and neither reveals whether it was right yet", () => {
    const answered = run([{ type: "answer_prediction", optionId: "nothing" }]);
    expect(answered).toMatchObject({ phase: "work", predictionChoice: "nothing", notice: null });
    expect(answered.records[0].predictionCorrect).toBe(false);
    expect(run([{ type: "skip_prediction" }])).toMatchObject({ phase: "work" });
    expect(run([{ type: "skip_prediction" }]).records[0].predictionCorrect).toBeNull();
    expect(run([{ type: "answer_prediction", optionId: "not-an-option" }]).phase).toBe("predict");
  });

  it("a step can be submitted straight away, without touching the prediction", () => {
    expect(run([pick("right")])).toMatchObject({ phase: "explained", notice: "check_passed" });
  });

  it("a passed check shows the explanation and tells the learner how the prediction turned out", () => {
    const right = run([{ type: "answer_prediction", optionId: "boots" }, pick("right")]);
    expect(right).toMatchObject({ phase: "explained", notice: "prediction_right" });
    expect(visibleHelp(right).explanation?.en).toBe("Why step one works.");
    expect(right.lastCheck).toEqual({ passed: true, lines: [{ label: L("Step one done"), passed: true, observed: "right" }] });
    expect(run([{ type: "answer_prediction", optionId: "nothing" }, pick("right")]).notice).toBe("prediction_wrong");
  });

  it("a failed check keeps the learner on the step with the rubric and, in learn mode, the reason", () => {
    const state = run([{ type: "skip_prediction" }, pick("wrong")]);
    expect(state).toMatchObject({ phase: "work", notice: "check_failed", stepIndex: 0 });
    expect(state.lastCheck?.lines[0]).toMatchObject({ passed: false, observed: "wrong" });
    expect(state.records[0]).toMatchObject({ attempts: 1, passed: false });
    expect(visibleHelp(state).explanation?.en).toBe("Why step one works.");
  });

  it("right first time goes on to the next step with no follow-up", () => {
    const state = run([pick("right"), { type: "continue" }]);
    expect(state).toMatchObject({ stepIndex: 1, phase: "work", lastCheck: null });
    expect(state.records[0]).toMatchObject({ passed: true, independent: true, followUp: "not_offered" });
  });

  it("a corrected error is followed by the related small task, which must be passed or skipped to go on", () => {
    const offered = run([pick("wrong"), pick("right"), { type: "continue" }]);
    expect(offered).toMatchObject({ phase: "follow_up", notice: "follow_up_offered", stepIndex: 0 });
    expect(currentTask(offered)?.goal.en).toBe("Now a similar one");
    expect(visibleHelp(offered)).toMatchObject({ hints: [], explanation: null, canRequestHint: false });
    const missed = lessonReducer(offered, pick("right"));
    expect(missed).toMatchObject({ phase: "follow_up", notice: "follow_up_failed" });
    expect(lessonReducer(missed, { type: "continue" })).toBe(missed);
    const passed = lessonReducer(missed, pick("also-right"));
    expect(passed.notice).toBe("follow_up_passed");
    expect(lessonReducer(passed, { type: "continue" })).toMatchObject({ stepIndex: 1, phase: "work" });
    const skipped = lessonReducer(offered, { type: "skip_follow_up" });
    expect(skipped).toMatchObject({ stepIndex: 1 });
    expect(skipped.records[0].followUp).toBe("skipped");
  });

  it("the last step leads to the summary, after which nothing changes", () => {
    const done = run([pick("right"), { type: "continue" }, pick("right"), { type: "continue" }]);
    expect(done).toMatchObject({ phase: "summary", stepIndex: 2, notice: "lesson_completed" });
    expect(lessonReducer(done, pick("right"))).toBe(done);
    expect(lessonReducer(done, { type: "request_hint" })).toBe(done);
  });

  it("the runner never completes a step the checker did not pass", () => {
    const state = run([pick("wrong"), { type: "continue" }, pick("nope"), { type: "continue" }, { type: "skip_follow_up" }]);
    expect(state).toMatchObject({ stepIndex: 0, phase: "work" });
    expect(state.records[0].passed).toBe(false);
  });

  it("evidence of the wrong kind fails the check instead of passing it", () => {
    const wrongKind: LessonEvidence = { lab: "code", results: {} };
    expect(run([{ type: "submit", evidence: wrongKind }])).toMatchObject({ phase: "work", notice: "check_failed" });
  });
});

describe("hints and the example", () => {
  it("hints come one level at a time, three at most, and the count is recorded", () => {
    let state = run([{ type: "skip_prediction" }]);
    const seen: string[][] = [];
    for (let i = 0; i < 4; i += 1) {
      state = lessonReducer(state, { type: "request_hint" });
      seen.push(hintTexts(state));
    }
    expect(seen.map((list) => list.length)).toEqual([1, 2, 3, 3]);
    expect(seen[2]).toEqual(["s1 hint 1", "s1 hint 2", "s1 hint 3"]);
    expect(state.notice).toBe("no_more_hints");
    expect(state.records[0].hintLevel).toBe(3);
    expect(visibleHelp(state).hints[1].target).toEqual({ id: "pc:connector:motherboard-1/dimm-a2", kind: "connector" });
  });

  it("the example is shown on request in learn mode and marks the step as not independent", () => {
    const state = run([{ type: "skip_prediction" }, { type: "show_example" }]);
    expect(visibleHelp(state).example?.en).toBe("Watch: do it like this.");
    expect(visibleHelp(state).canShowExample).toBe(false);
    const passed = lessonReducer(state, pick("right"));
    expect(passed.records[0]).toMatchObject({ passed: true, independent: false, exampleShown: true });
  });

  it("the third hint also marks the step as not independent; two hints do not", () => {
    const three = run([{ type: "request_hint" }, { type: "request_hint" }, { type: "request_hint" }, pick("right")]);
    expect(three.records[0].independent).toBe(false);
    const two = run([{ type: "request_hint" }, { type: "request_hint" }, pick("right")]);
    expect(two.records[0].independent).toBe(true);
  });
});

describe("test mode", () => {
  const test = () => startLesson(lesson, "test");

  it("withholds the third hint, the explanation and the example until an attempt has been submitted", () => {
    let state = run([{ type: "skip_prediction" }, { type: "request_hint" }, { type: "request_hint" }], test());
    expect(hintTexts(state)).toHaveLength(2);
    expect(visibleHelp(state)).toMatchObject({ canRequestHint: false, nextHintLocked: true, explanation: null, canShowExample: false });
    state = lessonReducer(state, { type: "request_hint" });
    expect(state.notice).toBe("hint_locked_until_attempt");
    expect(hintTexts(state)).toHaveLength(2);
    state = lessonReducer(state, { type: "show_example" });
    expect(state.notice).toBe("example_not_in_test");
    expect(visibleHelp(state).example).toBeNull();
  });

  it("after a submitted attempt the third hint and the reason become available", () => {
    let state = run([{ type: "request_hint" }, { type: "request_hint" }, pick("wrong")], test());
    expect(visibleHelp(state)).toMatchObject({ canRequestHint: true, nextHintLocked: false });
    expect(visibleHelp(state).explanation?.en).toBe("Why step one works.");
    state = lessonReducer(state, { type: "request_hint" });
    expect(hintTexts(state)).toHaveLength(3);
  });

  it("uses the same checkers as learn mode", () => {
    expect(run([pick("wrong")], test()).notice).toBe("check_failed");
    expect(run([pick("right")], test())).toMatchObject({ phase: "explained" });
  });

  it("a challenge always runs in test mode, whatever was asked for", () => {
    expect(startLesson({ ...lesson, kind: "challenge" }, "learn").mode).toBe("test");
    expect(startLesson({ ...lesson, kind: "fault" }, "learn").mode).toBe("learn");
  });
});

describe("progress and summary", () => {
  it("progress records attempts, hints and completion, and carries the times it is given", () => {
    const mid = run([{ type: "request_hint" }, pick("wrong"), pick("right")]);
    const stored = toProgress(mid, "2026-10-13T10:00:00Z");
    expect(stored).toMatchObject({ lessonId: "test.beginner.sample", lessonVersion: 2, mode: "learn", status: "in_progress", stepIndex: 0, startedAt: "2026-10-13T10:00:00Z", updatedAt: "2026-10-13T10:00:00Z" });
    expect(stored.steps[0]).toEqual({ stepId: "s1", attempts: 2, hintLevel: 1, exampleShown: false, predictionCorrect: null, passed: true, independent: false, followUp: "not_offered" });
    expect(stored.completedAt).toBeUndefined();
    const done = run([{ type: "continue" }, { type: "skip_follow_up" }, pick("right"), { type: "continue" }], mid);
    const finished = toProgress(done, "2026-10-13T10:05:00Z", stored);
    expect(finished).toMatchObject({ status: "completed", stepIndex: 2, startedAt: "2026-10-13T10:00:00Z", completedAt: "2026-10-13T10:05:00Z" });
    expect(JSON.parse(JSON.stringify(finished))).toEqual(finished);
  });

  it("a stored run resumes in the same place: mid-step, at the explanation, or in the follow-up", () => {
    const cases = [
      run([{ type: "skip_prediction" }, { type: "request_hint" }, pick("wrong")]),
      run([pick("right")]),
      run([pick("wrong"), pick("right"), { type: "continue" }]),
      run([pick("right"), { type: "continue" }]),
      run([pick("right"), { type: "continue" }, pick("right"), { type: "continue" }]),
    ];
    for (const state of cases) {
      const again = resumeLesson(lesson, toProgress(state));
      expect(again).toMatchObject({ stepIndex: state.stepIndex, phase: state.phase, mode: state.mode });
      expect(again.records).toEqual(state.records);
    }
  });

  it("progress for another version of the lesson, or another lesson, starts over", () => {
    const stored = toProgress(run([pick("right"), { type: "continue" }]));
    expect(resumeLesson({ ...lesson, version: 3 }, stored)).toMatchObject({ stepIndex: 0, phase: "predict" });
    expect(resumeLesson(lesson, { ...stored, lessonId: "other" }).stepIndex).toBe(0);
    expect(resumeLesson(lesson, { ...stored, steps: stored.steps.slice(0, 1) }).stepIndex).toBe(0);
  });

  it("the summary names what was practised, what needs work and one next step", () => {
    const clean = summarize(run([{ type: "answer_prediction", optionId: "boots" }, pick("right"), { type: "continue" }, pick("right"), { type: "continue" }]));
    expect(clean).toMatchObject({ completed: true, independentSteps: 2, totalSteps: 2, hintsUsed: 0, needsWork: [], predictions: { answered: 1, correct: 1 }, next: { kind: "next_lesson", lessonId: "test.beginner.next" } });
    expect(clean.practised.map((s) => s.name.en)).toEqual(["Choosing memory slots", "Reading the startup stages"]);

    const rough = summarize(run([{ type: "request_hint" }, pick("wrong"), pick("right"), { type: "continue" }, { type: "skip_follow_up" }, pick("right"), { type: "continue" }]));
    expect(rough).toMatchObject({ completed: true, independentSteps: 1, hintsUsed: 1 });
    expect(rough.needsWork.map((s) => s.skill)).toEqual(["slots"]);
    expect(rough.next).toEqual({ kind: "next_lesson", lessonId: "test.beginner.next" });
  });

  it("when most steps needed help the next step is to repeat the first of them, and an unfinished lesson points at the open step", () => {
    const both = summarize(run([pick("wrong"), pick("right"), { type: "continue" }, { type: "skip_follow_up" }, pick("wrong"), pick("right"), { type: "continue" }]));
    expect(both.next).toEqual({ kind: "repeat_step", stepId: "s1" });
    const open = summarize(run([pick("right"), { type: "continue" }, pick("wrong")]));
    expect(open).toMatchObject({ completed: false, next: { kind: "repeat_step", stepId: "s2" } });
    expect(open.needsWork.map((s) => s.skill)).toEqual(["power"]);
    expect(summarize(run([pick("right"), { type: "continue" }, pick("right"), { type: "continue" }], startLesson({ ...lesson, nextLessonId: undefined }))).next).toEqual({ kind: "free_practice" });
  });

  it("the summary counts hints as information; it carries no score, grade or ranking", () => {
    const summary = summarize(run([{ type: "request_hint" }, { type: "request_hint" }, pick("right"), { type: "continue" }, pick("right"), { type: "continue" }]));
    expect(summary.hintsUsed).toBe(2);
    expect(Object.keys(summary).sort()).toEqual(["completed", "hintsUsed", "independentSteps", "lessonId", "needsWork", "next", "practised", "predictions", "totalSteps"]);
  });

  it("the reducer is pure: the same events from the same start give the same state, and the lesson is not changed", () => {
    const events: LessonEvent[] = [{ type: "request_hint" }, pick("wrong"), pick("right"), { type: "continue" }];
    const before = JSON.stringify(lesson);
    expect(run(events)).toEqual(run(events));
    expect(JSON.stringify(lesson)).toBe(before);
  });
});
