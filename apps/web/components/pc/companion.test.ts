import { describe, expect, it } from "vitest";
import en from "../../messages/en/labs.json";
import ar from "../../messages/ar/labs.json";
import { buildContext, companionSay, intentOf, nextAction, topicOf, type CompanionEvent, type CompanionSay, type Selection } from "./companion";
import {
  connectSimpleCable, createSimpleBuild, installSimplePart, SIMPLE_CABLES, simpleBuildFromSnapshot, startSimplePC, undoSimpleStep, withCable, withPart,
  emptySimpleSnapshot, type SimplePartKey,
} from "./simple-model";

type Tree = Record<string, unknown>;
const lookup = (tree: Tree, path: string) => path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Tree)[key] : undefined), tree);
/** Every line resolves to a message in both languages, with the placeholders it uses. */
function expectSpoken(say: CompanionSay) {
  expect(say.lines.length).toBeGreaterThan(0);
  for (const line of say.lines) {
    for (const messages of [en, ar] as Tree[]) {
      const text = lookup(messages, `simplePc.companion.${line.key}`);
      expect(typeof text, `companion.${line.key}`).toBe("string");
      for (const name of String(text).match(/\{(\w+)\}/g) ?? []) expect(line.values, `${line.key} needs ${name}`).toHaveProperty(name.slice(1, -1));
      for (const value of Object.values(line.values ?? {})) {
        if (typeof value === "object" && "place" in value) expect(lookup(messages, `simplePc.companion.places.${value.place}`), value.place).toBeTypeOf("string");
      }
    }
  }
}

describe("the build companion", () => {
  it("guides a whole build in order, from the first part to the celebration", () => {
    let state = createSimpleBuild();
    const say = (event: CompanionEvent, selection: Selection = null, powered = false) => {
      const result = companionSay(event, state, powered, selection);
      expectSpoken(result);
      return result;
    };
    expect(say({ type: "start" }).lines[1].key).toBe("next.cpu");
    const order: SimplePartKey[] = ["cpu", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"];
    for (const key of order) {
      expect(nextAction(state, false)).toEqual({ kind: "part", key: key === "ram2" ? "ram2" : key });
      expect(say({ type: "select", selection: { kind: "part", key } }, { kind: "part", key }).mood).toBe("point");
      const step = installSimplePart(state, key);
      if (!step.ok) throw new Error(step.reason);
      state = step.state;
      expect(say({ type: "installed", key }).mood).toBe("happy");
    }
    expect(companionSay({ type: "installed", key: "ram2" }, state, false, null).lines.some((l) => l.key === "installed.allParts")).toBe(true);
    for (const cable of SIMPLE_CABLES) {
      expect(nextAction(state, false)).toEqual({ kind: "cable", key: cable.key });
      say({ type: "select", selection: { kind: "cable", key: cable.key } }, { kind: "cable", key: cable.key });
      const step = connectSimpleCable(state, cable.key);
      if (!step.ok) throw new Error(step.reason);
      state = step.state;
      say({ type: "connected", key: cable.key });
    }
    expect(nextAction(state, false)).toEqual({ kind: "power" });
    const started = startSimplePC(state);
    expect(started.ok).toBe(true);
    state = started.state;
    const done = say({ type: "powerOn" }, null, true);
    expect(done.mood).toBe("celebrate");
    expect(done.lines.map((l) => l.key)).toEqual(["complete.title", "complete.summary"]);
  });

  it("names no default slot for a module in hand, and counts the sticks that are in", () => {
    let state = createSimpleBuild();
    const first = installSimplePart(state, "ram2");
    if (!first.ok) throw new Error(first.reason);
    state = first.state;
    const say = companionSay({ type: "select", selection: { kind: "part", key: "ram" } }, state, false, { kind: "part", key: "ram" });
    // The learner chooses the slot by where they hold the module: the line says how, not "A2"/"B2".
    expect(say.lines[0].key).toBe("hands.ramPick");
    const help = companionSay({ type: "ask", intent: "help" }, state, false, { kind: "part", key: "ram" });
    expect(help.lines[0]).toEqual({ key: "help.ram", values: { rec: "DIMM_A2 + DIMM_B2" } });
    expect(companionSay({ type: "installed", key: "ram2" }, state, false, null).lines[0].key).toBe("installed.ramFirst");
    // The CPU still comes first; once it is in, the next step is the remaining stick.
    expect(companionSay({ type: "start" }, state, false, null).lines[1].key).toBe("next.cpu");
    const cpu = installSimplePart(state, "cpu");
    if (!cpu.ok) throw new Error(cpu.reason);
    expect(companionSay({ type: "start" }, cpu.state, false, null).lines[1].key).toBe("next.ramSecond");
    expect(nextAction(cpu.state, false)).toEqual({ kind: "part", key: "ram" });
  });

  it("explains a step taken too early and names what is still missing", () => {
    const state = createSimpleBuild();
    const board = companionSay({ type: "select", selection: { kind: "part", key: "motherboard" } }, state, false, null);
    expectSpoken(board);
    expect(board.mood).toBe("concerned");
    // The air cooler may also go on in the case now (the liquid cooler must), so the board waits for the CPU, RAM and storage only.
    expect(board.lines[0]).toEqual({ key: "blocked.prepareBoard", values: { parts: { parts: ["cpu", "ram", "ram2", "storage"] } } });
    const cooler = companionSay({ type: "select", selection: { kind: "part", key: "cooler" } }, state, false, null);
    expect(cooler.lines[0].key).toBe("blocked.cpuFirst");
    const lead = companionSay({ type: "select", selection: { kind: "cable", key: "gpuPower" } }, state, false, null);
    expectSpoken(lead);
    expect(lead.lines[0].key).toBe("blocked.cableParts");
  });

  it("explains a wrong slot or port without changing the build", () => {
    const state = createSimpleBuild();
    const before = JSON.stringify(state);
    const slot = companionSay({ type: "wrongPlace", key: "ram", place: "dimm-a1" }, state, false, { kind: "part", key: "ram" });
    expectSpoken(slot);
    expect(slot.lines[0]).toMatchObject({ key: "wrong.ramSlot", values: { place: { place: "dimm-a2" } } });
    const port = companionSay({ type: "wrongPort", key: "cpuFan", portOf: "caseFan1" }, state, false, null);
    expectSpoken(port);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("follows undo and restart back to the right next step", () => {
    let snapshot = withPart(withPart(emptySimpleSnapshot(), "cpu"), "ram");
    snapshot = undoSimpleStep(snapshot)!;
    const state = simpleBuildFromSnapshot(snapshot);
    const undo = companionSay({ type: "undo", step: "part:ram" }, state, false, null);
    expectSpoken(undo);
    expect(undo.lines.at(-1)!.key).toBe("next.ram");
    const restart = companionSay({ type: "restart" }, createSimpleBuild(), false, null);
    expectSpoken(restart);
    expect(restart.lines.at(-1)!.key).toBe("next.cpu");
  });

  it("does not celebrate a boot with case fans still loose, and asks to turn it off first", () => {
    let snapshot = emptySimpleSnapshot();
    for (const key of ["cpu", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"] as const) snapshot = withPart(snapshot, key);
    for (const cable of SIMPLE_CABLES.filter((c) => c.essential)) snapshot = withCable(snapshot, cable.key);
    const started = startSimplePC(simpleBuildFromSnapshot(snapshot));
    expect(started.ok).toBe(true);
    const say = companionSay({ type: "powerOn" }, started.state, true, null);
    expectSpoken(say);
    expect(say.mood).not.toBe("celebrate");
    expect(nextAction(started.state, true)).toEqual({ kind: "turnOff" });
  });

  it("answers the quick questions in both languages and says when open questions need the AI tutor", () => {
    const state = createSimpleBuild();
    for (const intent of ["next", "help", "explain"] as const) expectSpoken(companionSay({ type: "ask", intent }, state, false, null));
    expectSpoken(companionSay({ type: "ask", intent: "help" }, state, false, { kind: "part", key: "cooler" }));
    expectSpoken(companionSay({ type: "ask", intent: "explain" }, state, false, { kind: "cable", key: "caseFan2" }));
    expectSpoken(companionSay({ type: "question", text: "what colour is the case?" }, state, false, null));
    expect(intentOf("What next?")).toBe("next");
    expect(intentOf("وش الخطوة الجاية؟")).toBe("next");
    expect(intentOf("why does RAM go in A2")).toBe("explain");
    expect(intentOf("ليش المبرد فوق المعالج")).toBe("explain");
    expect(intentOf("help, I'm stuck")).toBe("help");
    expect(intentOf("ساعدني")).toBe("help");
    expect(intentOf("undo that")).toBe("undo");
    expect(intentOf("what colour is the case")).toBeNull();
    expect(topicOf("why does RAM go in A2?")).toBe("ram");
    expect(topicOf("ليش الرام في A2")).toBe("ram");
    expect(topicOf("where does the CPU power go")).toBe("cpuPower");
    expect(topicOf("what does the processor do")).toBe("cpu");
    expect(topicOf("وين مكان الباور")).toBe("psu");
    expect(topicOf("what colour is the case")).toBeNull();
    for (const key of ["atx", "cpuPower", "gpuPower", "cpuFan", "powerSwitch", "caseFan", "ram", "cpu", "cooler", "storage", "motherboard", "gpu", "psu"]) {
      for (const messages of [en, ar] as Tree[]) expect(lookup(messages, `simplePc.companion.explain.${key}`), key).toBeTypeOf("string");
    }
  });

  it("gives the AI tutor the real build state", () => {
    const step = installSimplePart(createSimpleBuild(), "ram2");
    if (!step.ok) throw new Error(step.reason);
    const context = buildContext(step.state, false, { kind: "part", key: "cpu" });
    expect(context).toContain("ram2 (dimm-a2)");
    expect(context).toContain("In hand: part cpu");
    expect(context).toContain("Next step: part cpu");
  });

  it("guides the Core i9 build: board into the case, then the liquid cooler, its two leads, and a spinning finish", () => {
    let state = createSimpleBuild();
    const say = (event: CompanionEvent, selection: Selection = null, powered = false) => {
      const result = companionSay(event, state, powered, selection);
      expectSpoken(result);
      return result;
    };
    const fit = (key: SimplePartKey) => {
      const step = installSimplePart(state, key);
      if (!step.ok) throw new Error(step.reason);
      state = step.state;
      say({ type: "installed", key });
    };
    fit("cpu2");
    for (const key of ["ram", "ram2", "storage", "motherboard", "aio", "gpu", "psu"] as const) {
      expect(nextAction(state, false)).toEqual({ kind: "part", key });
      fit(key);
    }
    const leads = ["atx", "cpuPower", "gpuPower", "aioPump", "aioFan", "powerSwitch", "caseFan1", "caseFan2"] as const;
    for (const key of leads) {
      expect(nextAction(state, false)).toEqual({ kind: "cable", key });
      const step = connectSimpleCable(state, key);
      if (!step.ok) throw new Error(step.reason);
      state = step.state;
      say({ type: "connected", key });
    }
    const started = startSimplePC(state);
    expect(started.ok).toBe(true);
    state = started.state;
    expect(say({ type: "powerOn" }, null, true).lines.map((l) => l.key)).toEqual(["complete.title", "complete.summaryLiquid"]);
  });

  it("explains the liquid-cooling rule when the Core i9 is tried on the air cooler, and how to swap", () => {
    let state = createSimpleBuild();
    for (const key of ["cpu2", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"] as const) {
      const step = installSimplePart(state, key);
      if (!step.ok) throw new Error(step.reason);
      state = step.state;
    }
    for (const cable of SIMPLE_CABLES) {
      const step = connectSimpleCable(state, cable.key);
      if (step.ok) state = step.state;
    }
    const tried = startSimplePC(state);
    expect(tried.rule).toBe("needsLiquidCooler");
    const fail = companionSay({ type: "powerFail", missingCable: null, rule: tried.rule }, tried.state, false, null);
    expectSpoken(fail);
    expect(fail.lines[0]!.key).toBe("power.needsLiquid");
    expect(nextAction(tried.state, false)).toEqual({ kind: "swapCooler" });
    const picking = companionSay({ type: "select", selection: { kind: "part", key: "aio" } }, tried.state, false, { kind: "part", key: "aio" });
    expectSpoken(picking);
    expect(picking.lines[0]!.key).toBe("blocked.coolerTaken");
    expectSpoken(companionSay({ type: "removeBlocked", key: "cooler", reason: "unplugCoolerFirst" }, tried.state, false, null));
    expectSpoken(companionSay({ type: "swapped", from: "cooler", key: "aio" }, tried.state, false, null));
    expectSpoken(companionSay({ type: "ask", intent: "explain" }, tried.state, false, null));
    expect(topicOf("why does the i9 need liquid cooling?")).toBe("liquidRule");
    expect(topicOf("وش فايدة المضخة")).toBe("aioPump");
    expect(topicOf("what is the radiator for")).toBe("aio");
  });
});
