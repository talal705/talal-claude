import { describe, expect, it, vi } from "vitest";
import type { TutorTargetRef } from "@ytl/contracts";
import type { GuidanceCheck } from "@/lib/targets/registry";
import { activeTopic, createHintLadderStore, currentTarget, type HintTopic } from "./hint-ladder";
import { topicForPath } from "./shell-hints";

const port: TutorTargetRef = { id: "pc:port:mb-atx24", kind: "port", projectRevision: 4 };
const topic: HintTopic = {
  id: "pc.missing-atx",
  levels: [
    { text: { en: "What feeds the motherboard?", ar: "وش اللي يغذّي اللوحة الأم؟" } },
    { text: { en: "Look at the right edge of the board.", ar: "شوف الطرف اليمين من اللوحة." }, target: port },
    { text: { en: "The 24-pin cable is not connected.", ar: "سلك 24 بن مو موصّل." }, target: port },
  ],
  madeFor: { projectRevision: 4 },
};
const visible: GuidanceCheck = { ok: true, resolution: { status: "visible", rect: { x: 0, y: 0, width: 10, height: 10 } } };

describe("hint ladder", () => {
  it("starts with nothing shown and gives one level per request, never past three", () => {
    const store = createHintLadderStore();
    store.getState().setPageTopic(topic);
    expect(store.getState().level).toBe(0);
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      store.getState().requestNextLevel();
      seen.push(store.getState().level);
    }
    expect(seen).toEqual([1, 2, 3, 3, 3]);
  });

  it("does nothing without a topic", () => {
    const store = createHintLadderStore();
    store.getState().requestNextLevel();
    expect(store.getState().level).toBe(0);
  });

  it("a page topic wins over the route fallback, and a new topic restarts the ladder", () => {
    const store = createHintLadderStore();
    store.getState().setFallbackTopic(topicForPath("/"));
    store.getState().requestNextLevel();
    expect(activeTopic(store.getState())?.id).toBe("shell.home");
    store.getState().setPageTopic(topic);
    expect(activeTopic(store.getState())?.id).toBe("pc.missing-atx");
    expect(store.getState().level).toBe(0);
    store.getState().requestNextLevel();
    store.getState().setPageTopic({ ...topic });
    expect(store.getState().level).toBe(1);
  });

  it("offers a target only at a level that has one", () => {
    const store = createHintLadderStore();
    store.getState().setPageTopic(topic);
    expect(currentTarget(store.getState())).toBeNull();
    store.getState().requestNextLevel();
    expect(currentTarget(store.getState())).toBeNull();
    store.getState().requestNextLevel();
    expect(currentTarget(store.getState())).toEqual(port);
  });

  it("points only when the learner asks and the registry accepts the target", () => {
    const store = createHintLadderStore();
    store.getState().setPageTopic(topic);
    store.getState().setContext({ projectRevision: 4 });
    store.getState().requestNextLevel();
    store.getState().requestNextLevel();
    expect(store.getState().pointing).toBeNull();
    const check = vi.fn(() => visible);
    store.getState().pointAtCurrentTarget(check);
    expect(check).toHaveBeenCalledWith(port, { projectRevision: 4 });
    expect(store.getState().pointing).toEqual(port);
    store.getState().stopPointing();
    expect(store.getState().pointing).toBeNull();
    expect(store.getState().notice).toBeNull();
  });

  it("does not point at an unknown or hidden target and says so", () => {
    const store = createHintLadderStore();
    store.getState().setPageTopic(topic);
    store.getState().setContext({ projectRevision: 4 });
    store.getState().requestNextLevel();
    store.getState().requestNextLevel();
    store.getState().pointAtCurrentTarget(() => ({ ok: false, reason: "unknown" }));
    expect(store.getState()).toMatchObject({ pointing: null, notice: "unavailable" });
    store.getState().pointAtCurrentTarget(() => ({ ok: true, resolution: { status: "hidden" } }));
    expect(store.getState()).toMatchObject({ pointing: null, notice: "unavailable" });
    store.getState().pointAtCurrentTarget(() => ({ ok: false, reason: "stale" }));
    expect(store.getState()).toMatchObject({ pointing: null, notice: "stale" });
  });

  it("removes the topic and stops pointing when the project moves to another revision", () => {
    const store = createHintLadderStore();
    store.getState().setPageTopic(topic);
    store.getState().setContext({ projectRevision: 4 });
    store.getState().requestNextLevel();
    store.getState().requestNextLevel();
    store.getState().pointAtCurrentTarget(() => visible);
    store.getState().setContext({ projectRevision: 5 });
    expect(store.getState()).toMatchObject({ pageTopics: [], level: 0, pointing: null, notice: "stale" });
  });

  it("drops a topic when one of its targets belongs to a finished execution", () => {
    const store = createHintLadderStore();
    const line: TutorTargetRef = { id: "pc:port:motherboard-2/eps-1", kind: "port", executionId: "run-1" };
    const plain = { text: { key: "thinkAbout" } };
    store.getState().setContext({ executionId: "run-1" });
    store.getState().setPageTopic({ id: "code.error", levels: [plain, { ...plain, target: line }, plain] });
    store.getState().requestNextLevel();
    store.getState().requestNextLevel();
    store.getState().pointAtCurrentTarget(() => visible);
    expect(store.getState().pointing).toEqual(line);
    store.getState().setContext({ executionId: "run-2" });
    expect(store.getState()).toMatchObject({ pageTopics: [], pointing: null, notice: "stale", level: 0 });
  });

  it("several problems: the learner moves between them and each starts at level 0", () => {
    const store = createHintLadderStore();
    const second: HintTopic = { ...topic, id: "pc.loose-ram" };
    store.getState().setContext({ projectRevision: 4 });
    store.getState().setPageTopics([topic, second]);
    store.getState().requestNextLevel();
    store.getState().selectTopic(1);
    expect(activeTopic(store.getState())?.id).toBe("pc.loose-ram");
    expect(store.getState().level).toBe(0);
    store.getState().selectTopic(5);
    store.getState().selectTopic(-1);
    expect(store.getState().topicIndex).toBe(1);
  });

  it("new topics for the same problem keep the learner's place; a fixed problem moves them to the first one left", () => {
    const store = createHintLadderStore();
    const second: HintTopic = { ...topic, id: "pc.loose-ram" };
    store.getState().setContext({ projectRevision: 4 });
    store.getState().setPageTopics([topic, second]);
    store.getState().selectTopic(1);
    store.getState().requestNextLevel();
    store.getState().requestNextLevel();
    store.getState().setPageTopics([{ ...second }, { ...topic, id: "pc.new" }]);
    expect(store.getState()).toMatchObject({ topicIndex: 0, level: 2 });
    expect(activeTopic(store.getState())?.id).toBe("pc.loose-ram");
    store.getState().setPageTopics([{ ...topic, id: "pc.new" }]);
    expect(store.getState()).toMatchObject({ topicIndex: 0, level: 0 });
  });

  it("a revision change removes only the topics made for the old revision", () => {
    const store = createHintLadderStore();
    const timeless: HintTopic = { id: "lesson.intro", levels: [{ text: { key: "thinkAbout" } }, { text: { key: "thinkAbout" } }, { text: { key: "thinkAbout" } }] };
    store.getState().setContext({ projectRevision: 4 });
    store.getState().setPageTopics([timeless, topic]);
    store.getState().requestNextLevel();
    store.getState().setContext({ projectRevision: 5 });
    expect(store.getState().pageTopics.map((t) => t.id)).toEqual(["lesson.intro"]);
    expect(store.getState()).toMatchObject({ level: 1, notice: null });
  });

  it("asking for the next level stops the current pointing", () => {
    const store = createHintLadderStore();
    store.getState().setPageTopic(topic);
    store.getState().setContext({ projectRevision: 4 });
    store.getState().requestNextLevel();
    store.getState().requestNextLevel();
    store.getState().pointAtCurrentTarget(() => visible);
    store.getState().requestNextLevel();
    expect(store.getState()).toMatchObject({ level: 3, pointing: null });
  });
});

describe("level cap and point requests", () => {
  it("with the cap at 2 the third level cannot be asked for; raising the cap allows it", () => {
    const store = createHintLadderStore();
    store.getState().setPageTopic(topic);
    store.getState().setLevelCap(2);
    for (let i = 0; i < 4; i += 1) store.getState().requestNextLevel();
    expect(store.getState().level).toBe(2);
    store.getState().setLevelCap(3);
    store.getState().requestNextLevel();
    expect(store.getState().level).toBe(3);
  });

  it("a point request carries the target and a new sequence number each time", () => {
    const store = createHintLadderStore();
    store.getState().requestPoint(port);
    store.getState().requestPoint(port);
    expect(store.getState().pointRequest).toEqual({ target: port, seq: 2 });
  });
});

describe("route hints", () => {
  it("the homepage has a three-level topic and unknown routes have none", () => {
    expect(topicForPath("/")?.levels).toHaveLength(3);
    expect(topicForPath("/nowhere")).toBeNull();
  });
});
