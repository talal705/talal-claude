import { describe, expect, it } from "vitest";
import { lessonReducer, startLesson, summarize, toProgress, visibleHelp, type LessonRunState } from "@ytl/curriculum";
import { pc } from "@ytl/simulation";
import { lessonExamples } from "../../../../content/lessons/examples";
import { pcCatalog } from "../pc/catalog";
import { lessonById, lessonsFor, runMode } from "./lesson-catalog";

/** The PC lab's lessons, worked through the way the panel does it: the lab's state as evidence, the runner as judge. */
describe("PC lessons through the lesson panel's path", () => {
  const pcLessons = lessonsFor("pc", "test");

  it("lists lessons for the PC lab, with challenges only in Test Yourself", () => {
    expect(pcLessons.length).toBeGreaterThan(0);
    expect(lessonsFor("pc", "learn").some((lesson) => lesson.kind === "challenge")).toBe(false);
    for (const lesson of pcLessons) expect(runMode(lesson, "learn")).toBe(lesson.kind === "challenge" ? "test" : "learn");
  });

  it("every PC lesson's starting state replays cleanly, so a project can be made from it", () => {
    for (const lesson of pcLessons) {
      if (lesson.start.lab !== "pc") throw new Error(`${lesson.id} starts in another lab`);
      expect(pc.replay(lesson.start.actions, pcCatalog).clean, lesson.id).toBe(true);
    }
  });

  it("each lesson refuses its starting state and passes when its worked example is applied", () => {
    for (const lesson of pcLessons) {
      if (lesson.start.lab !== "pc") continue;
      const example = lessonExamples.find((item) => item.lessonId === lesson.id);
      if (!example) throw new Error(`no worked example for ${lesson.id}`);
      let history = pc.createHistory(pc.replay(lesson.start.actions, pcCatalog).state);
      let run: LessonRunState = startLesson(lesson, runMode(lesson, "learn"));
      const evidence = () => ({ lab: "pc" as const, state: history.present, catalog: pcCatalog });

      for (const [index, step] of lesson.steps.entries()) {
        if (run.phase === "predict") run = lessonReducer(run, { type: "skip_prediction" });
        const solved = example.steps.find((item) => item.stepId === step.id)!;
        if (index === 0 && step.check.type !== "choice") {
          // Nothing done yet: the check must say "not yet", and nothing advances.
          const failed = lessonReducer(run, { type: "submit", evidence: evidence() });
          expect(failed.notice, `${lesson.id}/${step.id}`).toBe("check_failed");
          expect(failed.lastCheck?.lines.some((line) => !line.passed)).toBe(true);
          run = failed;
        }
        if (solved.solution.lab === "pc") {
          for (const action of solved.solution.actions) {
            const step = pc.dispatch(history, action, pcCatalog);
            if (!step.result.ok) throw new Error(`${lesson.id}: ${action.type} refused: ${step.result.rejection.message.en}`);
            history = step.history;
          }
          run = lessonReducer(run, { type: "submit", evidence: evidence() });
        } else if (solved.solution.lab === "choice") {
          run = lessonReducer(run, { type: "submit", evidence: { lab: "choice", optionId: solved.solution.optionId } });
        }
        expect(run.phase, `${lesson.id}/${step.id}`).toBe("explained");
        run = lessonReducer(run, { type: "continue" });
        if (run.phase === "follow_up") {
          const answer = solved.followUp;
          if (answer?.lab !== "choice") throw new Error(`${lesson.id}/${step.id} follow-up without a choice answer`);
          run = lessonReducer(run, { type: "submit", evidence: { lab: "choice", optionId: answer.optionId } });
          run = lessonReducer(run, { type: "continue" });
        }
      }
      expect(run.phase, lesson.id).toBe("summary");
      expect(toProgress(run, "2026-10-14T10:00:00.000Z").status).toBe("completed");
      expect(summarize(run).completed).toBe(true);
    }
  });

  it("Test Yourself holds back the last hint and the explanation until an attempt", () => {
    const lesson = lessonById("pc.beginner.first-build")!;
    let run = startLesson(lesson, "test");
    if (run.phase === "predict") run = lessonReducer(run, { type: "skip_prediction" });
    run = lessonReducer(lessonReducer(run, { type: "request_hint" }), { type: "request_hint" });
    expect(visibleHelp(run)).toMatchObject({ canRequestHint: false, nextHintLocked: true, explanation: null, canShowExample: false });
    const start = pc.replay(lesson.start.lab === "pc" ? lesson.start.actions : [], pcCatalog).state;
    run = lessonReducer(run, { type: "submit", evidence: { lab: "pc", state: start, catalog: pcCatalog } });
    expect(visibleHelp(run).canRequestHint).toBe(true);
  });
});
