import { describe, expect, it, vi } from "vitest";
import type { TutorTargetRef } from "@ytl/contracts";
import { createTutorService, targetsOf, vetAnswer, vetTopics, type GuidanceRequest, type TutorAdvisor } from "./advisor";
import { connectAiAdvisor, createAiAdvisor, createFetchTransport, toWireTopics, type AiAskRequest, type AiTransport } from "./ai-advisor";
import { createHintLadderStore, type HintText, type HintTopic } from "./hint-ladder";

const context = { projectRevision: 4, executionId: "run-2" };
const line: TutorTargetRef = { id: "pc:port:motherboard-2/atx-24", kind: "port", ...context };
const topic: HintTopic = {
  id: "pc:run-2:0:atx-24",
  title: { key: "hints.pc.class.startup_fault" },
  levels: [{ text: { key: "hints.generic.symptom" } }, { text: { key: "hints.pc.area", values: { part: "motherboard" } }, target: line }, { text: { en: "Exact message.", ar: "الرسالة بالنص." }, evidence: "The 24-pin cable is not connected.", target: line }],
  madeFor: context,
};
const request: GuidanceRequest = { lab: "pc", context, evidence: [{ kind: "topics", topics: [topic] }] };
const render = (text: HintText) => ("key" in text ? `[${text.key}]` : text.en);
const options = { locale: () => "en" as const, render };

function transportAnswering(answer: unknown, status: unknown = { ai: "available" }) {
  const sent: AiAskRequest[] = [];
  const transport: AiTransport = {
    status: vi.fn(async () => status),
    ask: vi.fn(async (body: AiAskRequest) => {
      sent.push(body);
      return typeof answer === "function" ? (answer as (b: AiAskRequest) => unknown)(body) : answer;
    }),
  };
  return { transport, sent };
}
const ok = (answer: object) => (body: AiAskRequest) => ({ status: "ok", context: body.context, answer });

async function serviceWith(transport: AiTransport) {
  const ladder = createHintLadderStore();
  const service = createTutorService(ladder);
  await connectAiAdvisor(service, transport, options);
  await service.presentGuidance(request);
  return { ladder, service };
}

describe("when no provider is configured", () => {
  it("the rule-based advisor stays, AI is reported as not configured, and a question does nothing", async () => {
    const { transport } = transportAnswering(null, { ai: "not_configured" });
    const { service } = await serviceWith(transport);
    expect(service.status.getState()).toMatchObject({ advisor: "rule_based", ai: "not_configured" });
    await service.ask("Why?");
    expect(transport.ask).not.toHaveBeenCalled();
    expect(service.status.getState().question).toEqual({ status: "idle" });
  });

  it("the server's status shape installs the advisor on available, whatever the last call's outcome was", async () => {
    for (const lastOutcome of ["ok", "error", null] as const) {
      const { transport } = transportAnswering(null, { ai: "available", provider: "example", lastOutcome });
      const { service } = await serviceWith(transport);
      expect(service.status.getState()).toMatchObject({ advisor: "ai", ai: "available" });
    }
  });

  it("a status endpoint that fails or answers nonsense also leaves the rule-based advisor", async () => {
    for (const status of [null, {}, { ai: "yes" }, { ai: "error" }, "available"]) {
      const { transport } = transportAnswering(null, status);
      const { service } = await serviceWith(transport);
      expect(service.status.getState().advisor).toBe("rule_based");
    }
    const failing: AiTransport = { status: async () => { throw new Error("offline"); }, ask: async () => null };
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    expect(await connectAiAdvisor(service, failing, options)).toBe("not_configured");
    expect(service.status.getState().advisor).toBe("rule_based");
  });
});

describe("when a provider is configured", () => {
  it("the hints on screen are still the rule-based ones", async () => {
    const { transport } = transportAnswering(ok({ text: "x" }));
    const { ladder, service } = await serviceWith(transport);
    expect(service.status.getState()).toMatchObject({ advisor: "ai", ai: "available" });
    expect(ladder.getState().pageTopics).toEqual([topic]);
    expect(transport.ask).not.toHaveBeenCalled();
  });

  it("a question sends only the question, the opened hint levels as text, the context and the targets of those levels", async () => {
    const { transport, sent } = transportAnswering(ok({ text: "A semicolon is missing." }));
    const { ladder, service } = await serviceWith(transport);
    ladder.getState().requestNextLevel();
    ladder.getState().requestNextLevel();
    await service.ask("  Why does line 4 fail?  ");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      version: 1,
      lab: "pc",
      locale: "en",
      context,
      question: "Why does line 4 fail?",
      topics: [{ id: topic.id, title: "[hints.pc.class.startup_fault]", revealedLevels: 2, levels: [{ text: "[hints.generic.symptom]" }, { text: "[hints.pc.area]", targetId: line.id }] }],
      allowedTargets: [{ id: line.id, kind: "port" }],
    });
  });

  it("shows thinking, then the answer with the target taken from the evidence", async () => {
    let release: (value: unknown) => void = () => {};
    const transport: AiTransport = { status: async () => ({ ai: "available" }), ask: () => new Promise((resolve) => (release = resolve)) };
    const { ladder, service } = await serviceWith(transport);
    ladder.getState().requestNextLevel();
    ladder.getState().requestNextLevel();
    const pending = service.ask("Why?");
    expect(service.status.getState().question).toEqual({ status: "thinking", question: "Why?" });
    release({ status: "ok", context, answer: { text: "Look at the end of line 4.", targetId: line.id, confidence: "likely" } });
    await pending;
    expect(service.status.getState().question).toEqual({ status: "answered", question: "Why?", answer: { text: "Look at the end of line 4.", target: line, confidence: "likely" } });
  });

  it("an answer naming a target that was not in the evidence loses the target and keeps the text", async () => {
    const { transport } = transportAnswering(ok({ text: "Click here.", targetId: "shell:ui:locale-switch" }));
    const { service } = await serviceWith(transport);
    await service.ask("Where?");
    const state = service.status.getState().question;
    expect(state.status === "answered" && state.answer).toEqual({ text: "Click here.", confidence: "possible" });
  });

  it("an empty or malformed answer, an error status, or a thrown transport error becomes the error state, and the hints stay", async () => {
    for (const answer of [ok({ text: "   " }), ok({}), { status: "error" }, { status: "ok" }, null, "text", () => { throw new Error("502"); }]) {
      const { transport } = transportAnswering(answer);
      const { ladder, service } = await serviceWith(transport);
      await service.ask("Why?");
      expect(service.status.getState().question, JSON.stringify(answer)).toEqual({ status: "error", question: "Why?" });
      expect(ladder.getState().pageTopics).toEqual([topic]);
    }
  });

  it("a failed question keeps the assistant available: the error shows next to the question and the next question works", async () => {
    let calls = 0;
    const transport: AiTransport = {
      status: async () => ({ ai: "available" }),
      ask: async (body) => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("tutor API 422"), { code: "provider_refused" });
        if (calls === 2) return { status: "error" };
        return { status: "ok", context: body.context, answer: { text: "Now it works.", confidence: "likely" } };
      },
    };
    const { service } = await serviceWith(transport);
    await service.ask("first");
    expect(service.status.getState()).toMatchObject({ advisor: "ai", ai: "available", question: { status: "error", question: "first" } });
    await service.ask("second");
    expect(service.status.getState()).toMatchObject({ ai: "available", question: { status: "error", question: "second" } });
    await service.ask("third");
    expect(service.status.getState()).toMatchObject({ ai: "available", question: { status: "answered", question: "third", answer: { text: "Now it works." } } });
  });

  it("only the server saying not configured removes the assistant", async () => {
    const gone = await serviceWith(transportAnswering({ status: "not_configured" }).transport);
    await gone.service.ask("Why?");
    expect(gone.service.status.getState()).toMatchObject({ ai: "not_configured", question: { status: "error", question: "Why?" } });
    await gone.service.ask("Again?");
    expect(gone.service.status.getState().question).toEqual({ status: "error", question: "Why?" });
  });

  it("on a page without lab guidance, the page's own hints on screen are sent as the evidence, with their targets", async () => {
    const { transport, sent } = transportAnswering(ok({ text: "Look at the first card.", targetId: "home:ui:lab-pc" }));
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    await connectAiAdvisor(service, transport, options);
    const card: TutorTargetRef = { id: "home:ui:lab-pc", kind: "ui" };
    ladder.getState().setFallbackTopic({ id: "shell.home", title: { key: "hints.home.title" }, levels: [{ text: { key: "hints.home.level1" } }, { text: { key: "hints.home.level2" }, target: card }, { text: { key: "hints.home.level3" }, target: card }] });
    ladder.getState().requestNextLevel();
    ladder.getState().requestNextLevel();
    await service.ask("Where do I start?");
    expect(sent[0]).toMatchObject({ lab: "shell", context: {}, allowedTargets: [{ id: "home:ui:lab-pc", kind: "ui" }] });
    expect(sent[0].topics).toEqual([{ id: "shell.home", title: "[hints.home.title]", revealedLevels: 2, levels: [{ text: "[hints.home.level1]" }, { text: "[hints.home.level2]", targetId: "home:ui:lab-pc" }] }]);
    const state = service.status.getState().question;
    expect(state.status === "answered" && state.answer.target).toEqual(card);
  });

  it("with several lab topics, all are sent and the one the learner is reading comes first", async () => {
    const { transport, sent } = transportAnswering(ok({ text: "x" }));
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    await connectAiAdvisor(service, transport, options);
    const second: HintTopic = { ...topic, id: "pc:run-2:1:eps-1" };
    await service.presentGuidance({ lab: "pc", context, evidence: [{ kind: "topics", topics: [topic, second] }] });
    ladder.getState().selectTopic(1);
    await service.ask("And this one?");
    expect(sent[0].topics.map((t) => t.id)).toEqual([second.id, topic.id]);
    expect(sent[0].lab).toBe("pc");
  });

  it("topics set straight on the ladder (without the service) are still what a question is about", async () => {
    const { transport, sent } = transportAnswering(ok({ text: "x" }));
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    await connectAiAdvisor(service, transport, options);
    ladder.getState().setContext(context);
    ladder.getState().setPageTopic(topic);
    ladder.getState().requestNextLevel();
    ladder.getState().requestNextLevel();
    await service.ask("Why?");
    expect(sent[0].topics.map((t) => t.id)).toEqual([topic.id]);
    expect(sent[0].allowedTargets).toEqual([{ id: line.id, kind: "port" }]);
    expect(sent[0].context).toEqual(context);
  });

  it("an answer that echoes another project state is not shown", async () => {
    const { transport } = transportAnswering({ status: "ok", context: { projectRevision: 3 }, answer: { text: "Old." } });
    const { service } = await serviceWith(transport);
    await service.ask("Why?");
    expect(service.status.getState().question.status).toBe("error");
  });

  it("an answer that arrives after the project changed is discarded, and says so", async () => {
    let release: (value: unknown) => void = () => {};
    const transport: AiTransport = { status: async () => ({ ai: "available" }), ask: () => new Promise((resolve) => (release = resolve)) };
    const { ladder, service } = await serviceWith(transport);
    const pending = service.ask("Why?");
    ladder.getState().setContext({ projectRevision: 5 });
    release({ status: "ok", context, answer: { text: "Late." } });
    await pending;
    expect(service.status.getState().question).toEqual({ status: "discarded", question: "Why?" });
  });

  it("new guidance for another state clears an old answer and discards a question in flight", async () => {
    const { transport } = transportAnswering(ok({ text: "Fine." }));
    const { service } = await serviceWith(transport);
    await service.ask("Why?");
    expect(service.status.getState().question.status).toBe("answered");
    await service.presentGuidance({ lab: "pc", context: { projectRevision: 5 }, evidence: [] });
    expect(service.status.getState().question).toEqual({ status: "idle" });
  });

  it("only one question is in flight at a time, and an overlong question is cut", async () => {
    let release: (value: unknown) => void = () => {};
    const sent: AiAskRequest[] = [];
    const transport: AiTransport = { status: async () => ({ ai: "available" }), ask: (body) => (sent.push(body), new Promise((resolve) => (release = resolve))) };
    const { service } = await serviceWith(transport);
    const first = service.ask("x".repeat(900));
    await service.ask("second");
    expect(sent).toHaveLength(1);
    expect(sent[0].question).toHaveLength(300);
    release({ status: "ok", context, answer: { text: "y".repeat(5000) } });
    await first;
    const state = service.status.getState().question;
    expect(state.status === "answered" && state.answer.text.length).toBe(1200);
  });

  it("clearQuestion removes the answer and ignores one still on its way", async () => {
    let release: (value: unknown) => void = () => {};
    const transport: AiTransport = { status: async () => ({ ai: "available" }), ask: () => new Promise((resolve) => (release = resolve)) };
    const { service } = await serviceWith(transport);
    const pending = service.ask("Why?");
    service.clearQuestion();
    release({ status: "ok", context, answer: { text: "Late." } });
    await pending;
    expect(service.status.getState().question).toEqual({ status: "idle" });
  });
});

describe("only what the learner has opened leaves the browser", () => {
  it("Test Yourself before an attempt: with the cap at 2, the request has no level-3 text, no explanation and no level-3 evidence", async () => {
    const { transport, sent } = transportAnswering(ok({ text: "x" }));
    const { ladder, service } = await serviceWith(transport);
    ladder.getState().setLevelCap(2);
    for (let i = 0; i < 3; i += 1) ladder.getState().requestNextLevel();
    expect(ladder.getState().level).toBe(2);
    await service.ask("Just tell me the answer");
    const body = JSON.stringify(sent[0]);
    expect(sent[0].topics[0]).toMatchObject({ revealedLevels: 2 });
    expect(sent[0].topics[0].levels).toHaveLength(2);
    expect(body).not.toContain("Exact message.");
    expect(body).not.toContain("expected ';'");
    expect(body).not.toContain("explain");
  });

  it("with nothing opened, topics are named only, with no level text and nothing to point at", async () => {
    const { transport, sent } = transportAnswering(ok({ text: "Here.", targetId: line.id }));
    const { service } = await serviceWith(transport);
    await service.ask("Where?");
    expect(sent[0].topics).toEqual([{ id: topic.id, title: "[hints.pc.class.startup_fault]", revealedLevels: 0, levels: [] }]);
    expect(sent[0].allowedTargets).toEqual([]);
    const state = service.status.getState().question;
    expect(state.status === "answered" && state.answer.target).toBeUndefined();
  });

  it("topics other than the one being read are sent unopened", async () => {
    const { transport, sent } = transportAnswering(ok({ text: "x" }));
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    await connectAiAdvisor(service, transport, options);
    const second: HintTopic = { ...topic, id: "pc:run-2:1:eps-1" };
    await service.presentGuidance({ lab: "pc", context, evidence: [{ kind: "topics", topics: [topic, second] }] });
    ladder.getState().requestNextLevel();
    await service.ask("?");
    expect(sent[0].topics.map((t) => [t.id, t.revealedLevels, t.levels.length])).toEqual([[topic.id, 1, 1], [second.id, 0, 0]]);
  });
});

describe("vetting what a provider returns", () => {
  it("vetAnswer keeps only allowed, current targets and uses the allowed reference, not the provider's copy", () => {
    const allowed = [line];
    expect(vetAnswer({ text: "ok", target: { id: line.id, kind: "port", projectRevision: 999 } }, allowed, context)).toEqual({ text: "ok", target: line, confidence: "possible" });
    expect(vetAnswer({ text: "ok", target: { id: line.id, kind: "ui" } }, allowed, context)?.target).toBeUndefined();
    expect(vetAnswer({ text: "ok", target: { id: "a[href]", kind: "ui" } }, allowed, context)?.target).toBeUndefined();
    expect(vetAnswer({ text: "ok", target: line }, allowed, { projectRevision: 5 })?.target).toBeUndefined();
    expect(vetAnswer({ text: 5 }, allowed, context)).toBeNull();
    expect(vetAnswer(null, allowed, context)).toBeNull();
    expect(vetAnswer({ text: "ok", confidence: "certain" }, allowed, context)?.confidence).toBe("certain");
    expect(vetAnswer({ text: "ok", confidence: "absolutely" }, allowed, context)?.confidence).toBe("possible");
  });

  it("vetTopics with allowed targets strips every target the evidence did not supply", () => {
    const other: TutorTargetRef = { id: "pc:port:motherboard-2/eps-1", kind: "port", ...context };
    const fromAi: HintTopic = { ...topic, id: "ai-1", levels: [topic.levels[0], { ...topic.levels[1], target: other }, topic.levels[2]], source: "ai" };
    const [vetted] = vetTopics([fromAi], context, { allowedTargets: targetsOf([topic]) });
    expect(vetted.levels[1].target).toBeUndefined();
    expect(vetted.levels[2].target).toEqual(line);
  });

  it("topics from an AI advisor pass through that check in the service", async () => {
    const other: TutorTargetRef = { id: "pc:setting:power-button", kind: "setting" };
    const inventive: TutorAdvisor = {
      kind: "ai",
      aiStatus: () => "available",
      advise: async () => [{ ...topic, levels: [{ ...topic.levels[0], target: other }, topic.levels[1], topic.levels[2]], source: "ai" }],
    };
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder, inventive);
    const shown = await service.presentGuidance(request);
    expect(shown?.[0].levels[0].target).toBeUndefined();
    expect(shown?.[0].levels[1].target).toEqual(line);
  });
});

describe("wire format and transport", () => {
  it("topics go out as plain text in the learner's language, with evidence verbatim", () => {
    expect(toWireTopics([{ topic, revealedLevels: 3 }], (text) => ("key" in text ? "مفتاح" : text.ar))[0].levels[2]).toEqual({ text: "الرسالة بالنص.", evidence: "The 24-pin cable is not connected.", targetId: line.id });
    expect(toWireTopics([{ topic, revealedLevels: 1 }], (text) => ("key" in text ? "k" : text.en))[0]).toEqual({ id: topic.id, title: "k", revealedLevels: 1, levels: [{ text: "k" }] });
  });

  it("the fetch transport calls only the platform's own same-origin routes", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return { ok: true, status: 200, json: async () => ({ ai: "available" }) } as Response;
    }) as typeof fetch;
    const transport = createFetchTransport("/api/tutor", fake);
    await transport.status();
    await transport.ask({ version: 1, lab: "pc", locale: "en", context, question: "q", topics: [], allowedTargets: [] });
    expect(calls.map(([url]) => url)).toEqual(["/api/tutor/status", "/api/tutor/ask"]);
    expect(calls[1][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(calls[1][1]?.body)).question).toBe("q");
  });

  it("a 429 with the server's reason code shows as busy, not as a plain error", async () => {
    const fake = (async (url: string) =>
      String(url).endsWith("/status")
        ? ({ ok: true, status: 200, json: async () => ({ ai: "available", lastOutcome: null }) } as Response)
        : ({ ok: false, status: 429, json: async () => ({ status: "error", error: { code: "rate_limited", message: "slow down", retryAfterSeconds: 20 } }) } as Response)) as typeof fetch;
    const { service } = await serviceWith(createFetchTransport("/api/tutor", fake));
    await service.ask("Why?");
    expect(service.status.getState().question).toEqual({ status: "error", question: "Why?", reason: "busy" });
    const other = (async (url: string) =>
      String(url).endsWith("/status")
        ? ({ ok: true, status: 200, json: async () => ({ ai: "available" }) } as Response)
        : ({ ok: false, status: 502, json: async () => ({ status: "error", error: { code: "provider_failed", message: "x" } }) } as Response)) as typeof fetch;
    const second = await serviceWith(createFetchTransport("/api/tutor", other));
    await second.service.ask("Why?");
    expect(second.service.status.getState().question).toEqual({ status: "error", question: "Why?" });
  });

  it("a non-2xx response is a failure, not an answer", async () => {
    const fake = (async () => ({ ok: false, status: 503, json: async () => ({ status: "ok" }) }) as Response) as typeof fetch;
    await expect(createFetchTransport("/api/tutor", fake).ask({ version: 1, lab: "pc", locale: "en", context, question: "q", topics: [], allowedTargets: [] })).rejects.toThrow();
  });

  it("the AI advisor's own ask returns the provider's text and the allowed target only", async () => {
    const { transport } = transportAnswering(ok({ text: "Hi", targetId: "x:y:z" }));
    const advisor = createAiAdvisor(transport, options);
    expect(await advisor.ask!("q", request, [{ topic, revealedLevels: 3 }])).toEqual({ text: "Hi", confidence: "possible" });
  });
});
