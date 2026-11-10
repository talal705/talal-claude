import { describe, expect, it } from "vitest";
import { lessonReducer, startLesson, type LessonEvent, type LessonRunState } from "@ytl/curriculum";
import { lessonById } from "../../../../content/lessons";
import { createTutorService } from "./advisor";
import { activeTopic, createHintLadderStore } from "./hint-ladder";
import { lessonTopic, releaseLessonFromTutor, syncLessonToTutor } from "./lesson-guidance";

const lesson = lessonById("pc.beginner.first-build")!;

/** A page in miniature: the runner state, and the ladder kept in step after every event. */
function page(mode: "learn" | "test" = "learn") {
  const ladder = createHintLadderStore();
  let state: LessonRunState = startLesson(lesson, mode);
  const send = (event: LessonEvent) => {
    state = lessonReducer(state, event);
    syncLessonToTutor(state, send, ladder);
  };
  syncLessonToTutor(state, send, ladder);
  return { ladder, send, get: () => state };
}

describe("a lesson as the tutor's hint source", () => {
  it("the step's hints become the ladder's topic, with nothing opened yet", () => {
    const { ladder } = page();
    expect(activeTopic(ladder.getState())?.id).toBe("lesson:pc.beginner.first-build:board");
    expect(activeTopic(ladder.getState())?.levels[1].target).toEqual(lesson.steps[0].hints[1].target);
    expect(ladder.getState().level).toBe(0);
  });

  it("the tutor's next-hint button goes through the runner, which records it, and the ladder shows what the runner allows", () => {
    const { ladder, get } = page();
    ladder.getState().requestNextLevel();
    ladder.getState().requestNextLevel();
    expect(get().records[0].hintLevel).toBe(2);
    expect(ladder.getState().level).toBe(2);
  });

  it("Test Yourself: the ladder stops at the second hint until an attempt is submitted, as the runner does", () => {
    const { ladder, send, get } = page("test");
    for (let i = 0; i < 4; i += 1) ladder.getState().requestNextLevel();
    expect(get().records[0].hintLevel).toBe(2);
    expect(ladder.getState()).toMatchObject({ level: 2, levelCap: 2 });
    send({ type: "submit", evidence: { lab: "choice", optionId: "x" } });
    expect(ladder.getState().levelCap).toBe(3);
    ladder.getState().requestNextLevel();
    expect(get().records[0].hintLevel).toBe(3);
    expect(ladder.getState().level).toBe(3);
  });

  it("a failed attempt keeps the hints already opened, on the same step", () => {
    const { ladder, send } = page();
    ladder.getState().requestNextLevel();
    send({ type: "skip_prediction" });
    send({ type: "submit", evidence: { lab: "choice", optionId: "x" } });
    expect(activeTopic(ladder.getState())?.id).toContain(":board");
    expect(ladder.getState().level).toBe(1);
  });

  it("an untried follow-up and the summary have no hints on the ladder", () => {
    expect(lessonTopic({ ...startLesson(lesson), phase: "follow_up" })).toBeNull();
    expect(lessonTopic({ ...startLesson(lesson), phase: "summary" })).toBeNull();
  });

  it("an AI question about a lesson step carries only the hints the runner has opened", async () => {
    const ladder = createHintLadderStore();
    const sent: { topics: { revealedLevels: number; levels: unknown[] }[] }[] = [];
    const service = createTutorService(ladder, {
      kind: "ai",
      aiStatus: () => "available",
      advise: async () => [],
      ask: async (_q, _r, topics) => {
        sent.push({ topics: topics.map((t) => ({ revealedLevels: t.revealedLevels, levels: t.topic.levels.slice(0, t.revealedLevels) })) });
        return { text: "x", confidence: "possible" };
      },
    });
    let state = startLesson(lesson, "test");
    const send = (event: LessonEvent) => {
      state = lessonReducer(state, event);
      syncLessonToTutor(state, send, ladder);
    };
    syncLessonToTutor(state, send, ladder);
    for (let i = 0; i < 3; i += 1) ladder.getState().requestNextLevel();
    await service.ask("What is the answer?");
    expect(sent[0].topics[0].revealedLevels).toBe(2);
    expect(JSON.stringify(sent[0])).not.toContain(lesson.steps[0].hints[2].text.en);
  });

  it("closing the lesson gives the ladder back", () => {
    const { ladder } = page("test");
    releaseLessonFromTutor(ladder);
    expect(ladder.getState()).toMatchObject({ external: null, levelCap: 3, pageTopics: [] });
    ladder.getState().setPageTopic({ id: "x", levels: [{ text: { key: "a" } }, { text: { key: "b" } }, { text: { key: "c" } }] });
    ladder.getState().requestNextLevel();
    expect(ladder.getState().level).toBe(1);
  });
});
