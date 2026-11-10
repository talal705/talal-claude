import { describe, expect, it } from "vitest";
import { lessonById } from "../../../content/lessons";
import { baselines } from "../../../content/lessons/baselines";
import { DONT_KNOW, scoreBaseline, type Baseline } from "./baseline";

const pc = baselines.find((b) => b.id === "pc.baseline")!;
const right = (baseline: Baseline) => Object.fromEntries(baseline.questions.map((q) => [q.id, q.correctOptionId]));

describe("scoring a baseline check", () => {
  it("all right suggests skipping ahead to the level's challenge", () => {
    expect(scoreBaseline(pc, right(pc))).toMatchObject({ toLearn: [], skipped: 0, suggestion: { kind: "skip_ahead", lessonId: "pc.beginner.build-challenge" } });
    expect(scoreBaseline(pc, right(pc)).known).toEqual(["memory-slots", "memory-seating", "startup-reading"]);
  });

  it("a wrong answer or “I don't know” suggests the lesson that teaches that skill", () => {
    const result = scoreBaseline(pc, { ...right(pc), seated: DONT_KNOW });
    expect(result).toMatchObject({ toLearn: ["memory-seating"], suggestion: { kind: "start_here", lessonId: "pc.beginner.first-build" } });
    expect(scoreBaseline(pc, { ...right(pc), slots: "any" }).toLearn).toEqual(["memory-slots"]);
  });

  it("nothing answered suggests the beginning; a skipped question counts as not shown, not as wrong", () => {
    expect(scoreBaseline(pc, {})).toMatchObject({ skipped: 3, toLearn: [], suggestion: { kind: "no_answers", lessonId: "pc.beginner.first-build" } });
    const partly = scoreBaseline(pc, { slots: "a2-b2" });
    expect(partly).toMatchObject({ skipped: 2, toLearn: [], known: ["memory-slots"], suggestion: { kind: "start_here", lessonId: "pc.beginner.first-build" } });
  });

  it("a skill answered both rightly and wrongly is listed as to learn, not as known", () => {
    const twice: Baseline = { ...pc, questions: [pc.questions[0], { ...pc.questions[1], skill: "memory-slots" }] };
    expect(scoreBaseline(twice, { slots: "a2-b2", seated: "normal" })).toMatchObject({ known: [], toLearn: ["memory-slots"] });
  });

  it("the result has no score: only skills and one suggestion", () => {
    expect(Object.keys(scoreBaseline(pc, right(pc))).sort()).toEqual(["baselineId", "known", "skipped", "suggestion", "toLearn"]);
  });
});

describe("published baseline checks", () => {
  it("exist for both labs and both published tracks, in both languages, pointing at real lessons and their skills", () => {
    expect(baselines.map((b) => b.id)).toEqual(["pc.baseline", "network.baseline"]);
    for (const baseline of baselines) {
      expect(lessonById(baseline.allKnownLessonId)?.kind, baseline.id).toBe("challenge");
      for (const question of baseline.questions) {
        const lesson = lessonById(question.lessonId);
        expect(lesson, `${baseline.id}/${question.id}`).toBeDefined();
        expect(Object.keys(lesson!.skills), `${baseline.id}/${question.id}`).toContain(question.skill);
        expect(question.options.map((o) => o.id)).toContain(question.correctOptionId);
        expect(question.options.map((o) => o.id)).not.toContain(DONT_KNOW);
        for (const text of [question.question, ...question.options.map((o) => o.text)]) {
          expect(text.en.length).toBeGreaterThan(0);
          expect(text.ar.length).toBeGreaterThan(0);
        }
        expect(question.question.ar).toMatch(/[؀-ۿ]/);
      }
    }
  });
});
