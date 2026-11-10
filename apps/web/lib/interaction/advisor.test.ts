import { describe, expect, it } from "vitest";
import { pcTarget, type PCDiagnostic } from "@ytl/contracts";
import { createTutorService, ruleBasedAdvisor, vetTopics, type GuidanceRequest, type TutorAdvisor } from "./advisor";
import { activeTopic, createHintLadderStore, type HintTopic } from "./hint-ladder";

const diagnostic: PCDiagnostic = {
  id: "storage_missing:build",
  code: "storage_missing",
  class: "startup_fault",
  severity: "blocking",
  message: { en: "No storage drive is installed.", ar: "ما في وحدة تخزين مركّبة." },
  explanation: { en: "The computer needs a drive to load an operating system from.", ar: "الكمبيوتر يحتاج وحدة تخزين يشغّل منها نظام التشغيل." },
  evidence: [],
  target: pcTarget.port({ kind: "part", instanceId: "motherboard-1", portId: "atx-24" }),
  relatedTargets: [],
};
const request = (revision: number, executionId: string): GuidanceRequest => ({
  lab: "pc",
  context: { projectRevision: revision, executionId },
  // The target is stamped with the state it was found in, so the topic is tied to that revision and run.
  evidence: [{ kind: "pc-diagnostics", diagnostics: [{ ...diagnostic, target: { ...diagnostic.target!, projectRevision: revision, executionId } }] }],
});
const plain = { text: { key: "thinkAbout" } };
const topicWith = (id: string, over: Partial<HintTopic> = {}): HintTopic => ({ id, levels: [plain, plain, plain], ...over });

describe("rule-based advisor", () => {
  it("turns evidence into topics and reports that no AI is configured", async () => {
    const topics = await ruleBasedAdvisor.advise(request(3, "exec-1"));
    expect(topics).toHaveLength(1);
    expect(topics[0].source).toBe("rule_based");
    expect(ruleBasedAdvisor.kind).toBe("rule_based");
    expect(ruleBasedAdvisor.aiStatus()).toBe("not_configured");
  });

  it("passes hand-written topics through and returns nothing for no evidence", async () => {
    const lesson = topicWith("lesson.1");
    expect(await ruleBasedAdvisor.advise({ lab: "shell", context: {}, evidence: [{ kind: "topics", topics: [lesson] }] })).toEqual([lesson]);
    expect(await ruleBasedAdvisor.advise({ lab: "pc", context: {}, evidence: [] })).toEqual([]);
  });
});

describe("vetTopics", () => {
  const context = { projectRevision: 3, executionId: "exec-1" };

  it("drops topics made for another revision or run", () => {
    const topics = [
      topicWith("current", { madeFor: context }),
      topicWith("old-revision", { madeFor: { projectRevision: 2 } }),
      topicWith("old-run", { madeFor: { projectRevision: 3, executionId: "exec-0" } }),
    ];
    expect(vetTopics(topics, context).map((topic) => topic.id)).toEqual(["current"]);
  });

  it("removes a target that is a selector, malformed, or stamped for another state, and keeps the text", () => {
    const topic = topicWith("mixed", {
      levels: [
        { ...plain, target: { id: "main > a.card", kind: "ui" } },
        { ...plain, target: { id: "pc:port:motherboard-2/atx-24", kind: "port", projectRevision: 2 } },
        { ...plain, target: { id: "pc:port:motherboard-2/atx-24", kind: "port", projectRevision: 3, executionId: "exec-1" } },
      ],
    });
    const [vetted] = vetTopics([topic], context);
    expect(vetted.levels[0]).toEqual(plain);
    expect(vetted.levels[1]).toEqual(plain);
    expect(vetted.levels[2].target?.id).toBe("pc:port:motherboard-2/atx-24");
  });

  it("drops duplicates and malformed topics, and caps the list", () => {
    const broken = { id: "broken", levels: [plain] } as unknown as HintTopic;
    const many = Array.from({ length: 40 }, (_, index) => topicWith(`t${index}`));
    const vetted = vetTopics([topicWith("a"), topicWith("a"), broken, topicWith(""), ...many], context);
    expect(vetted[0].id).toBe("a");
    expect(vetted.filter((topic) => topic.id === "a")).toHaveLength(1);
    expect(vetted.some((topic) => topic.id === "broken" || topic.id === "")).toBe(false);
    expect(vetted).toHaveLength(12);
  });
});

describe("tutor service", () => {
  it("presentGuidance sets the context and shows the rule-based topics", async () => {
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    const shown = await service.presentGuidance(request(3, "exec-1"));
    expect(shown).toHaveLength(1);
    expect(ladder.getState().context).toEqual({ projectRevision: 3, executionId: "exec-1" });
    expect(activeTopic(ladder.getState())?.levels[2].text).toEqual(diagnostic.explanation);
    expect(service.status.getState()).toMatchObject({ advisor: "rule_based", ai: "not_configured", question: { status: "idle" } });
  });

  it("a new revision removes the old guidance at once, before the new answer arrives", async () => {
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    await service.presentGuidance(request(3, "exec-1"));
    ladder.getState().requestNextLevel();
    const pending = service.presentGuidance({ lab: "pc", context: { projectRevision: 4 }, evidence: [] });
    expect(ladder.getState()).toMatchObject({ pageTopics: [], level: 0, notice: "stale" });
    await pending;
    expect(ladder.getState().pageTopics).toEqual([]);
  });

  it("discards an answer that arrives after a newer request", async () => {
    const ladder = createHintLadderStore();
    const releases: Array<() => void> = [];
    const slow: TutorAdvisor = {
      kind: "ai",
      aiStatus: () => "available",
      advise: (asked) =>
        new Promise((resolve) => releases.push(() => resolve([topicWith(`for-${asked.context.projectRevision}`, { madeFor: asked.context, source: "ai" })]))),
    };
    const service = createTutorService(ladder, slow);
    const first = service.presentGuidance({ lab: "pc", context: { projectRevision: 1 }, evidence: [] });
    const second = service.presentGuidance({ lab: "pc", context: { projectRevision: 2 }, evidence: [] });
    releases[1]();
    expect((await second)?.map((topic) => topic.id)).toEqual(["for-2"]);
    releases[0]();
    expect(await first).toBeNull();
    expect(ladder.getState().pageTopics.map((topic) => topic.id)).toEqual(["for-2"]);
  });

  it("discards an answer when the project moved on while the advisor was working", async () => {
    const ladder = createHintLadderStore();
    let release = () => {};
    const slow: TutorAdvisor = {
      kind: "ai",
      aiStatus: () => "available",
      advise: () => new Promise((resolve) => (release = () => resolve([topicWith("late")]))),
    };
    const service = createTutorService(ladder, slow);
    const pending = service.presentGuidance({ lab: "pc", context: { projectRevision: 1 }, evidence: [] });
    ladder.getState().setContext({ projectRevision: 2 });
    release();
    expect(await pending).toBeNull();
    expect(ladder.getState().pageTopics).toEqual([]);
  });

  it("an advisor's answer is vetted: stale topics and bad targets from a provider never reach the ladder", async () => {
    const ladder = createHintLadderStore();
    const careless: TutorAdvisor = {
      kind: "ai",
      aiStatus: () => "available",
      advise: async () => [
        topicWith("old", { madeFor: { projectRevision: 1 } }),
        topicWith("ok", { levels: [plain, { ...plain, target: { id: "document.body", kind: "ui" } }, plain] }),
      ],
    };
    const service = createTutorService(ladder, careless);
    const shown = await service.presentGuidance({ lab: "pc", context: { projectRevision: 2 }, evidence: [] });
    expect(shown?.map((topic) => topic.id)).toEqual(["ok"]);
    expect(shown?.[0].levels[1].target).toBeUndefined();
  });

  it("a failing AI advisor falls back to rule-based topics and reports the error state", async () => {
    const ladder = createHintLadderStore();
    const failing: TutorAdvisor = {
      kind: "ai",
      aiStatus: () => "error",
      advise: async () => {
        throw new Error("provider unreachable");
      },
    };
    const service = createTutorService(ladder);
    service.setAdvisor(failing);
    const shown = await service.presentGuidance(request(3, "exec-1"));
    expect(shown).toHaveLength(1);
    expect(shown?.[0].source).toBe("rule_based");
    expect(service.status.getState()).toMatchObject({ advisor: "ai", ai: "error" });
  });

  it("clearGuidance removes the lab's topics and cancels a pending answer", async () => {
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    const pending = service.presentGuidance(request(3, "exec-1"));
    service.clearGuidance();
    expect(await pending).toBeNull();
    expect(ladder.getState().pageTopics).toEqual([]);
  });
});
