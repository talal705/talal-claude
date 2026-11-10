import { describe, expect, it } from "vitest";
import { lessonReducer, startLesson, type LessonRunState } from "@ytl/curriculum";
import { network } from "@ytl/simulation";
import { lessonExamples } from "../../../../content/lessons/examples";
import { lessonsFor, runMode } from "./lesson-catalog";

describe("network lessons through the lesson panel's path", () => {
  it("start from a state the engine accepts, refuse it, and pass with the worked example", () => {
    const lessons = lessonsFor("network", "test");
    expect(lessons.length).toBeGreaterThan(0);
    for (const lesson of lessons) {
      if (lesson.start.lab !== "network") throw new Error(`${lesson.id} starts in another lab`);
      const replayed = network.replay(lesson.start.actions);
      expect(replayed.rejection, lesson.id).toBeUndefined();
      const example = lessonExamples.find((item) => item.lessonId === lesson.id)!;
      let history = network.createHistory(replayed.state);
      let run: LessonRunState = startLesson(lesson, runMode(lesson, "learn"));
      for (const [index, step] of lesson.steps.entries()) {
        if (run.phase === "predict") run = lessonReducer(run, { type: "skip_prediction" });
        const solved = example.steps.find((item) => item.stepId === step.id)!;
        if (index === 0 && step.check.type !== "choice") {
          run = lessonReducer(run, { type: "submit", evidence: { lab: "network", state: history.present } });
          expect(run.notice, `${lesson.id}/${step.id}`).toBe("check_failed");
        }
        if (solved.solution.lab === "network") {
          for (const action of solved.solution.actions) {
            const result = network.dispatch(history, action);
            if (!result.result.ok) throw new Error(`${lesson.id}: ${action.type} refused`);
            history = result.history;
          }
          run = lessonReducer(run, { type: "submit", evidence: { lab: "network", state: history.present } });
        } else if (solved.solution.lab === "choice") {
          run = lessonReducer(run, { type: "submit", evidence: { lab: "choice", optionId: solved.solution.optionId } });
        }
        expect(run.phase, `${lesson.id}/${step.id}`).toBe("explained");
        run = lessonReducer(run, { type: "continue" });
        if (run.phase === "follow_up") {
          const answer = solved.followUp;
          if (answer?.lab !== "choice") throw new Error("follow-up without a choice answer");
          run = lessonReducer(lessonReducer(run, { type: "submit", evidence: { lab: "choice", optionId: answer.optionId } }), { type: "continue" });
        }
      }
      expect(run.phase, lesson.id).toBe("summary");
    }
  });
});
