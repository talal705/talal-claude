// One-click installation: one button fits the selected part completely through the engine's own steps, saved as one
// grouped action. A refusal changes nothing; one Undo restores the build from before; cables are never connected.
import { afterEach, describe, expect, it } from "vitest";
import type { PCBuildState } from "@ytl/contracts";
import { applyCoolerStep, coolerStepHistory, nextCoolerStep } from "./cooler-assembly";
import { autoPlace, installPlaces, planInstall, type InstallPlan } from "./one-click";
import { planModel, type PlannedBuild } from "./plan-model";
import {
  activateSimpleModel, createSimpleBuild, emptySimpleSnapshot, roleOf, firstAttachment, installSimplePart, lastSimpleAction, LEGACY_MODEL, liftSimplePart, parseSimpleSnapshot, setSimpleMechanism,
  simpleAllPartsIn, simpleBuildFromSnapshot, simplePartInstalled, simplePartOrder, SIMPLE_PARTS, simpleRetention, simpleSlotFilled, slotOf, startSimplePC, undoSimpleStep, unscrewSimplePart, withoutPart, withPart,
  withSimpleStep, withSimpleSteps, type SimpleSnapshot, type SimpleStep,
} from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));

const gaming = (over: Partial<PlannedBuild["parts"]> = {}): PlannedBuild => ({
  version: 1, purpose: "gaming", workload: "1080p",
  parts: {
    case: "corsair-4000d-airflow-black", motherboard: "asus-tuf-gaming-z790-plus-wifi", cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm850x-atx31",
    gpu: "asus-dual-rtx5060-o8g", ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 },
    storage: ["samsung-990-pro-1tb", "samsung-870-evo-1tb"], fans: ["arctic-p12-pwm-pst"], ...over,
  },
});
const study: PlannedBuild = { version: 1, purpose: "study", workload: "", parts: { case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"], fans: [] } };

const ok = (plan: InstallPlan) => { if (!plan.ok) throw new Error(JSON.stringify(plan)); return plan; };
/** Installs with one click per part, saved the way the page saves it. */
function click(snapshot: SimpleSnapshot, key: string, place?: string | null): SimpleSnapshot {
  const state = simpleBuildFromSnapshot(snapshot);
  return withSimpleSteps(snapshot, ok(place === undefined ? planInstall(state, key, undefined, snapshot.history) : planInstall(state, key, place, snapshot.history)).steps);
}
const json = (s: PCBuildState) => JSON.stringify(s);
/** Takes a fitted case fan out by its own steps (four screws, then lifted), as the step-by-step controls do. */
const fanOut = (snapshot: SimpleSnapshot, fan: string): SimpleSnapshot =>
  [...Array<SimpleStep>(4).fill(`unscrew:${fan}`), `lift:${fan}` as SimpleStep].reduce((sn, step) => withSimpleStep(sn, step), snapshot);

describe("one click fits the whole part through the engine's own steps", () => {
  it("CPU: lever and plate open, the CPU lowered turned to its key, plate closed, lever locked; one group, one Undo", () => {
    activateSimpleModel(planModel(gaming()));
    const start = createSimpleBuild();
    const plan = ok(planInstall(start, "cpu"));
    expect(plan.steps[0]).toMatch(/^mech:.*:lever:open$/);
    expect(plan.steps.some((s) => s.startsWith("lower:cpu:0:0:0"))).toBe(true);
    expect(plan.steps.at(-1)).toMatch(/:lever:closed$/);
    expect(simplePartInstalled(plan.state, "cpu")).toBe(true);
    const saved = withSimpleSteps(emptySimpleSnapshot(), plan.steps);
    expect(saved.groups).toEqual([[0, plan.steps.length]]);
    expect(json(simpleBuildFromSnapshot(saved))).toBe(json(plan.state));
    expect(lastSimpleAction(saved)).toEqual(plan.steps);
    const undone = undoSimpleStep(saved)!;
    expect(undone.history).toEqual([]);
    expect(undone.groups).toBeUndefined();
    expect(json(simpleBuildFromSnapshot(undone))).toBe(json(start));
  });

  it("continues a fitting the learner started by hand, without repeating or reversing its steps", () => {
    activateSimpleModel(planModel(gaming()));
    const ret = simpleRetention(createSimpleBuild(), "cpu")!;
    const lever = setSimpleMechanism(createSimpleBuild(), ret.leverId!, "open");
    if (!lever.ok) throw new Error("lever");
    const plan = ok(planInstall(lever.state, "cpu"));
    expect(plan.steps.some((s) => s === `mech:${ret.leverId}:open`)).toBe(false);
    expect(simplePartInstalled(plan.state, "cpu")).toBe(true);
  });

  it("memory goes where the board's manual recommends: the first stick A2, the second B2; clips shut", () => {
    activateSimpleModel(planModel(gaming()));
    let saved = click(emptySimpleSnapshot(), "cpu");
    const state = simpleBuildFromSnapshot(saved);
    expect(autoPlace(state, "ram")).toBe("dimm-a2");
    expect(installPlaces(state, "ram").filter((p) => p.recommended).map((p) => p.id)).toEqual(["dimm-a2"]);
    saved = click(saved, "ram");
    expect(autoPlace(simpleBuildFromSnapshot(saved), "ram2")).toBe("dimm-b2");
    saved = click(saved, "ram2");
    const built = simpleBuildFromSnapshot(saved);
    expect(firstAttachment(built, "ram")?.target.mountPointId).toBe("dimm-a2");
    expect(firstAttachment(built, "ram2")?.target.mountPointId).toBe("dimm-b2");
    expect(simplePartInstalled(built, "ram") && simplePartInstalled(built, "ram2")).toBe(true);
  });

  it("a slot the learner picks is used; a taken one is refused and changes nothing", () => {
    activateSimpleModel(planModel(gaming()));
    const saved = click(emptySimpleSnapshot(), "ram", "dimm-b1");
    const state = simpleBuildFromSnapshot(saved);
    expect(firstAttachment(state, "ram")?.target.mountPointId).toBe("dimm-b1");
    const before = json(state);
    expect(planInstall(state, "ram2", "dimm-b1")).toEqual({ ok: false, reason: "placeTaken", place: "dimm-b1" });
    expect(json(state)).toBe(before);
  });

  it("an M.2 drive: heatsink off, latch, inserted at its angle, pressed flat and held, film, heatsink back and screwed", () => {
    activateSimpleModel(planModel(gaming()));
    const start = createSimpleBuild();
    const m2 = SIMPLE_PARTS.find((p) => /^m2-/.test(p.mount))!.key;
    const plan = ok(planInstall(start, m2));
    expect(plan.place).toBe(SIMPLE_PARTS.find((p) => p.key === m2)!.mount);
    expect(plan.steps.some((s) => /^lower:.*:t25:s/.test(s))).toBe(true);
    expect(plan.steps.at(-1)).toMatch(/:screws:closed$/);
    expect(simplePartInstalled(plan.state, m2)).toBe(true);
  });

  it("a contact-frame cooler on the bench: every documented step, in the fitting direction only", () => {
    activateSimpleModel(planModel(gaming()));
    const saved = click(emptySimpleSnapshot(), "cpu");
    const plan = ok(planInstall(simpleBuildFromSnapshot(saved), "cooler", undefined, saved.history));
    expect(plan.steps).toContain("hw:motherboard:ilm:removed");
    expect(plan.steps).toContain("place:cooler");
    // Fitting direction only: nothing is lifted or unscrewed, and every screw only ever tightens (0 out, 1 engaged, 2 tight).
    expect(plan.steps.some((s) => /^(lift|unscrew|unfasten):/.test(s))).toBe(false);
    for (const prefix of ["hw:motherboard:frame_screws:", "hw:cooler:screws:"]) {
      const values = plan.steps.filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length));
      expect(values.length, prefix).toBeGreaterThan(0);
      values.slice(1).forEach((v, i) => [...v].forEach((c, j) => expect(Number(c)).toBeGreaterThanOrEqual(Number(values[i]![j]))));
    }
    expect(simplePartInstalled(plan.state, "cooler")).toBe(true);
    expect(simplePartInstalled(plan.state, "cpu")).toBe(true);
  });

  it("a retention-ring cooler (Freezer 7 X on the H81M-K) and DDR3 memory", () => {
    activateSimpleModel(planModel(study));
    let saved = click(emptySimpleSnapshot(), "cpu");
    saved = click(saved, "cooler");
    saved = click(saved, "ram");
    expect(simplePartInstalled(simpleBuildFromSnapshot(saved), "cooler")).toBe(true);
    expect(simplePartInstalled(simpleBuildFromSnapshot(saved), "ram")).toBe(true);
  });

  it("board, power supply, card, drive and fan: preparation, placing and every screw; the fan faces the way its place needs", () => {
    activateSimpleModel(planModel(gaming()));
    let saved = emptySimpleSnapshot();
    for (const key of simplePartOrder(createSimpleBuild())) saved = click(saved, key);
    const built = simpleBuildFromSnapshot(saved);
    expect(simpleAllPartsIn(built)).toBe(true);
    expect(saved.history.some((s) => s.startsWith("cable:") || s.startsWith("plug:"))).toBe(false);
    expect(built.cables.every((c) => Object.values(c.ends).every((end) => end?.kind !== "part"))).toBe(true);
    const fan = SIMPLE_PARTS.find((p) => roleOf(p.key) === "fan")?.key;
    if (fan) expect(saved.history).toContain(`prep:${fan}:airflow:${/rear|top/.test(firstAttachment(built, fan)!.target.mountPointId) ? "exhaust" : "intake"}`);
    expect(saved.groups?.length).toBe(simplePartOrder(createSimpleBuild()).length);
  });
});

describe("a refusal changes nothing and says why", () => {
  it("mandatory prerequisites: the cooler needs the CPU, the card the board in the case; the practice build's board its parts", () => {
    activateSimpleModel(planModel(gaming()));
    const start = createSimpleBuild();
    const before = json(start);
    expect(planInstall(start, "cooler")).toEqual({ ok: false, reason: "required", block: "cpuFirst" });
    expect(planInstall(start, "gpu")).toEqual({ ok: false, reason: "required", block: "boardFirst" });
    expect(json(start)).toBe(before);
    activateSimpleModel(LEGACY_MODEL);
    expect(planInstall(createSimpleBuild(), "motherboard")).toEqual({ ok: false, reason: "required", block: "prepareBoard" });
  });

  it("an installed part, a running PC", () => {
    activateSimpleModel(planModel(gaming()));
    const saved = click(emptySimpleSnapshot(), "psu");
    expect(planInstall(simpleBuildFromSnapshot(saved), "psu")).toEqual({ ok: false, reason: "alreadyIn" });
    const running = { ...createSimpleBuild(), power: { ...createSimpleBuild().power, pressed: true } };
    expect(planInstall(running, "psu")).toEqual({ ok: false, reason: "turnOff" });
  });

  it("a liquid cooler before the board is in the case: refused whole, nothing fitted or saved (no pump-only action)", () => {
    activateSimpleModel(planModel(gaming({ cooler: "arctic-liquid-freezer-iii-280" })));
    let saved = click(emptySimpleSnapshot(), "cpu");
    const state = simpleBuildFromSnapshot(saved);
    const before = json(state);
    expect(planInstall(state, "aio", undefined, saved.history)).toEqual({ ok: false, reason: "required", block: "boardFirst" });
    expect(json(state)).toBe(before);
    // With the board in the case, the case's own front fan is still in the radiator's place: named, nothing changes.
    for (const key of ["ram", "ram2", "motherboard"]) saved = click(saved, key);
    const fanned = simpleBuildFromSnapshot(saved);
    expect(planInstall(fanned, "aio", undefined, saved.history)).toEqual({ ok: false, reason: "fanInTheWay", fan: "sfan1" });
    expect(json(simpleBuildFromSnapshot(saved))).toBe(json(fanned));
    // Once the learner takes it out: the whole cooler (block, VRM module, radiator, every screw) is one action, and one Undo.
    saved = fanOut(saved, "sfan1");
    const boarded = simpleBuildFromSnapshot(saved);
    const plan = ok(planInstall(boarded, "aio", undefined, saved.history));
    expect(plan.steps).toContain("place:aio");
    expect(plan.steps).toContain("rad:aio");
    expect(plan.steps).toContain("hw:aio:vrm_fan:attached");
    expect(simplePartInstalled(plan.state, "aio")).toBe(true);
    const done = withSimpleSteps(saved, plan.steps);
    expect(lastSimpleAction(done)).toEqual(plan.steps);
    const undone = undoSimpleStep(done)!;
    expect(undone.history).toEqual(saved.history);
    expect(json(simpleBuildFromSnapshot(undone))).toBe(json(boarded));
  });

  it("the practice build's liquid cooler: its own front fan is in the radiator's place, so it is named and nothing moves", () => {
    let s = createSimpleBuild();
    for (const key of ["cpu2", "ram", "ram2", "storage", "motherboard"]) { const r = installSimplePart(s, key); if (!r.ok) throw new Error(key); s = r.state; }
    const before = json(s);
    expect(planInstall(s, "aio")).toEqual({ ok: false, reason: "fanInTheWay", fan: "sfan1" });
    expect(json(s)).toBe(before);
    // The learner takes that fan out by its own steps; then one click fits the whole cooler, and one Undo takes it all back.
    for (let i = 0; i < 4; i += 1) { const r = unscrewSimplePart(s, "sfan1"); if (!r.ok) throw new Error("unscrew"); s = r.state; }
    const lifted = liftSimplePart(s, "sfan1");
    if (!lifted.ok) throw new Error("lift");
    const plan = ok(planInstall(lifted.state, "aio"));
    expect(plan.steps).toContain("place:aio");
    expect(plan.steps).toContain("rad:aio");
    expect(simplePartInstalled(plan.state, "aio")).toBe(true);
    expect(simplePartInstalled(plan.state, "sfan1")).toBe(false); // the fan the learner took out stays out
  });

  it("a radiator for a pump block the learner fitted on the bench by hand: the one click finishes it", () => {
    activateSimpleModel(planModel(gaming({ cooler: "arctic-liquid-freezer-iii-280" })));
    let saved = click(emptySimpleSnapshot(), "cpu");
    // The step-by-step controls fit the block on the bench (owner decision 15): its documented steps, up to the board.
    let s = simpleBuildFromSnapshot(saved);
    for (let step = nextCoolerStep(s, "aio"); step && step.kind !== "boardFirst"; step = nextCoolerStep(s, "aio")) {
      const history = coolerStepHistory(s, "aio", step);
      const r = applyCoolerStep(s, "aio", step);
      if (!r.ok) throw new Error(JSON.stringify(step));
      saved = withSimpleStep(saved, history);
      s = r.state;
    }
    for (const key of ["ram", "ram2", "motherboard"]) saved = click(saved, key);
    saved = fanOut(saved, "sfan1");
    const plan = ok(planInstall(simpleBuildFromSnapshot(saved), "aio", undefined, saved.history));
    expect(plan.steps[0]).toBe("rad:aio");
    expect(plan.steps.some((st) => st.startsWith("place:aio"))).toBe(false);
    expect(simplePartInstalled(plan.state, "aio")).toBe(true);
  });
});

describe("grouped actions in the saved progress", () => {
  it("a single step after a group is undone alone; then the whole group", () => {
    activateSimpleModel(planModel(gaming()));
    const grouped = click(emptySimpleSnapshot(), "psu");
    const after = withSimpleStep(grouped, "sys:panel:open");
    expect(lastSimpleAction(after)).toEqual(["sys:panel:open"]);
    const one = undoSimpleStep(after)!;
    expect(one.history).toEqual(grouped.history);
    expect(one.groups).toEqual(grouped.groups);
    expect(undoSimpleStep(one)!.history).toEqual([]);
  });

  it("is kept through a reload, and an older save without groups still undoes one step at a time", () => {
    activateSimpleModel(planModel(gaming()));
    const grouped = click(emptySimpleSnapshot(), "psu");
    const reloaded = parseSimpleSnapshot(JSON.parse(JSON.stringify(grouped)))!;
    expect(reloaded.groups).toEqual(grouped.groups);
    expect(undoSimpleStep(reloaded)!.history).toEqual([]);
    const { groups: _g, ...older } = grouped;
    const old = parseSimpleSnapshot(JSON.parse(JSON.stringify(older)))!;
    expect(old.groups).toBeUndefined();
    expect(undoSimpleStep(old)!.history).toEqual(grouped.history.slice(0, -1));
  });

  it("drops malformed groups but keeps the save", () => {
    activateSimpleModel(planModel(gaming()));
    const grouped = click(emptySimpleSnapshot(), "psu");
    for (const groups of [[[0, 99]], [[3, 2]], [[0, 1]], "x", [[0, 2], [1, 3]]]) {
      const parsed = parseSimpleSnapshot({ ...grouped, groups });
      expect(parsed?.history).toEqual(grouped.history);
      expect(parsed?.groups).toBeUndefined();
    }
  });

  it("follows the history when an older whole-part step leaves it", () => {
    // The practice build's air cooler is removable as one `part:` step (older saves).
    const cpu = withPart(emptySimpleSnapshot(), "cpu");
    const cooled = withPart(cpu, "cooler");
    const grouped = click(cooled, "psu");
    const [a, b] = grouped.groups!.at(-1)!;
    const removed = withoutPart(grouped, "cooler");
    expect(removed.groups).toEqual([[a - 1, b - 1]]);
    expect(undoSimpleStep(removed)!.history).toEqual(["part:cpu"]);
  });

  it("a running PC is not undone", () => {
    activateSimpleModel(planModel(gaming()));
    const grouped = click(emptySimpleSnapshot(), "psu");
    expect(startSimplePC(simpleBuildFromSnapshot(grouped)).ok).toBe(false);
    expect(lastSimpleAction({ ...grouped, powered: true })).toEqual([]);
  });
});

describe("every installable part of each valid offered build goes in with one click each, in the guide's order", () => {
  // Strict: every part the guide offers next installs at once (no refusal accepted), and the build ends complete.
  const builds: [string, () => void, string[]][] = [
    ["practice build (air cooler)", () => activateSimpleModel(LEGACY_MODEL), []],
    ["practice build with the Core i9 and liquid cooler, once its front fan is out", () => activateSimpleModel(LEGACY_MODEL), ["cpu2"]],
    ["gaming Z790", () => activateSimpleModel(planModel(gaming())), []],
    ["gaming Z790 with the 280 mm liquid cooler", () => activateSimpleModel(planModel(gaming({ cooler: "arctic-liquid-freezer-iii-280" }))), []],
    ["study H81", () => activateSimpleModel(planModel(study)), []],
  ];
  for (const [name, activate, first] of builds) {
    it(name, () => {
      activate();
      let saved = emptySimpleSnapshot();
      for (const key of first) saved = click(saved, key);
      for (let i = 0; i < 30; i += 1) {
        let state = simpleBuildFromSnapshot(saved);
        const key = simplePartOrder(state).find((k) => !simpleSlotFilled(state, slotOf(k)));
        if (!key) break;
        // A liquid cooler in the 4000D: the case's own front fan sits in the radiator's place. That exact prerequisite is
        // the only refusal allowed; the learner takes the fan out by its own steps (it is never moved for them).
        if (key === "aio" && simplePartInstalled(state, "sfan1")) {
          expect(planInstall(state, key, undefined, saved.history)).toEqual({ ok: false, reason: "fanInTheWay", fan: "sfan1" });
          saved = fanOut(saved, "sfan1");
          state = simpleBuildFromSnapshot(saved);
        }
        const plan = planInstall(state, key, undefined, saved.history);
        expect(plan.ok, `${key}: ${JSON.stringify(plan)}`).toBe(true);
        if (plan.ok) saved = withSimpleSteps(saved, plan.steps);
      }
      const built = simpleBuildFromSnapshot(saved);
      expect(simpleAllPartsIn(built)).toBe(true);
      expect(SIMPLE_PARTS.every((p) => simpleSlotFilled(built, slotOf(p.key)))).toBe(true);
      expect(parseSimpleSnapshot(JSON.parse(JSON.stringify(saved)))?.history).toEqual(saved.history);
      expect(saved.history.every((s: SimpleStep) => !s.startsWith("cable:") && !s.startsWith("plug:"))).toBe(true);
      expect(built.cables.every((c) => Object.values(c.ends).every((end) => end?.kind !== "part"))).toBe(true);
    });
  }
});
