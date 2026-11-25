import { afterEach, describe, expect, it } from "vitest";
import type { PCBuildState } from "@ytl/contracts";
import {
  applyCoolerStep, applyMountingStep, coolerStepHistory, mountingDismantling, mountingStepHistory, nextCoolerRemoval, nextCoolerStep, nextMountingRemoval, simpleCoolerProgress, type CoolerStep,
} from "./cooler-assembly";
import { nextHandStep } from "./click-assembly";
import { companionSay, mountingRemovalLine } from "./companion";
import { planModel, rebaseProgress, snapshotFromHistory } from "./plan-model";
import {
  activateSimpleModel, createSimpleBuild, deriveSimpleLists, emptySimpleSnapshot, installSimplePart, LEGACY_MODEL, liftSimplePart, lowerSimplePart, parseSimpleSnapshot, setSimpleMechanism, simpleBuildFromSnapshot, simplePartInstalled,
  simpleCableConnected, simpleCablesFor, simpleRetention, undoSimpleStep, type SimpleSnapshot, type SimpleStep,
} from "./simple-model";
import en from "../../messages/en/labs.json";
import ar from "../../messages/ar/labs.json";

afterEach(() => activateSimpleModel(LEGACY_MODEL));
const must = <T,>(r: { ok: true; state: T } | { ok: false; reason?: string }): T => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.state; };

/** The CPU in with its ILM closed and locked: where Phase 1 leaves it, before any cooler work. */
const withCpu = () => must(installSimplePart(createSimpleBuild(), "cpu"));

/** Walks `nextCoolerStep` to its end, applying every step as the page does, and records the saved steps. */
function walk(state: PCBuildState, key: string, limit = 60): { state: PCBuildState; steps: CoolerStep[]; history: SimpleStep[] } {
  const steps: CoolerStep[] = [];
  const history: SimpleStep[] = [];
  let s = state;
  for (let i = 0; i < limit; i += 1) {
    const step = nextCoolerStep(s, key);
    if (!step || step.kind === "cpuFirst" || step.kind === "boardFirst") break;
    const r = applyCoolerStep(s, key, step);
    if (!r.ok) throw new Error(`${JSON.stringify(step)} refused: ${JSON.stringify(r)}`);
    history.push(coolerStepHistory(s, key, step));
    steps.push(step);
    s = r.state;
  }
  return { state: s, steps, history };
}
const kinds = (steps: CoolerStep[]) => steps.map((s) => (s ? (s.kind === "frameScrew" || s.kind === "screw" ? `${s.kind}:${s.to}` : s.kind) : "null"));

describe("Freezer 36 on the TUF board: the contact-frame mounting, one documented step at a time", () => {
  it("backplate, ILM off, frame (engaged then across), paste, film, place, two screws (engaged then tight)", () => {
    const { steps, state } = walk(withCpu(), "cooler");
    expect(kinds(steps)).toEqual([
      "backplate", "lever", "plate", "ilm", "frame",
      "frameScrew:engaged", "frameScrew:engaged", "frameScrew:engaged", "frameScrew:engaged",
      "frameScrew:tight", "frameScrew:tight", "frameScrew:tight", "frameScrew:tight",
      "paste", "film", "place", "screw:engaged", "screw:engaged", "screw:tight", "screw:tight",
    ]);
    expect(steps.find((x) => x?.kind === "backplate")).toMatchObject({ value: "padding" }); // the board is on the bench
    expect(simplePartInstalled(state, "cooler")).toBe(true);
    expect(simplePartInstalled(state, "cpu")).toBe(true); // retained by the frame
    expect(nextCoolerStep(state, "cooler")).toBeNull();
  });

  it("every step is one engine change, saved as one step, and undone on its own; replaying the saves reproduces the state", () => {
    const { history, state } = walk(withCpu(), "cooler");
    let snap: SimpleSnapshot = { ...emptySimpleSnapshot(), history: ["part:cpu" as SimpleStep] };
    const snaps = [snap];
    for (const step of history) { snap = { ...snap, history: [...snap.history, step] }; snaps.push(snap); }
    expect(simpleBuildFromSnapshot(snap)).toEqual(state);
    for (let i = snaps.length - 1; i > 1; i -= 1) {
      const undone = undoSimpleStep(snaps[i]!);
      expect(undone?.history.length).toBe(snaps[i]!.history.length - 1);
      expect(simpleBuildFromSnapshot(undone!)).toEqual(simpleBuildFromSnapshot(snaps[i - 1]!)); // paste, film and screws exactly as before
    }
    // A save round-trips with its steps (the lists must say what the steps say).
    const saved = { ...snap, version: 3, ...deriveSimpleLists(snap.history) };
    expect(parseSimpleSnapshot(JSON.parse(JSON.stringify(saved)))?.history).toEqual(snap.history);
  });

  it("the next step before the CPU is in is 'CPU first'; nothing about wiring changes", () => {
    const bare = createSimpleBuild();
    expect(nextCoolerStep(bare, "cooler")).toEqual({ kind: "cpuFirst" });
    const { state } = walk(withCpu(), "cooler");
    expect(simpleCoolerProgress(state, "cooler")).toMatchObject({ placed: true, secured: 2, total: 2, mechanicallyComplete: true, connected: false });
    // Fitting the cooler plugs nothing in: the build's leads are exactly as they were with only the CPU in.
    expect(state.cables).toEqual(withCpu().cables);
    expect(simpleCablesFor(state).some((c) => simpleCableConnected(state, c.key))).toBe(false);
  });

  it("a wrong choice is refused by the engine with a reason: tape for a board on the bench", () => {
    const s = withCpu();
    const r = applyCoolerStep(s, "cooler", { kind: "backplate", value: "tape" });
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).toMatch(/outside the case/);
  });
});

describe("old saves", () => {
  it("a whole-fit cooler step still works and ends with the same documented state", () => {
    const s = must(installSimplePart(withCpu(), "cooler"));
    expect(simplePartInstalled(s, "cooler")).toBe(true);
    expect(simplePartInstalled(s, "cpu")).toBe(true);
    expect(s.parts.find((p) => p.instanceId === "motherboard-2")!.hardware).toMatchObject({ ilm: "removed", frame: "placed", frame_screws: "2222" });
    expect(simpleCoolerProgress(s, "cooler").mechanicallyComplete).toBe(true);
  });

  it("an older step-by-step save (paste, film, place, four corner screws over a locked ILM) loads with CPU and cooler in; the screws are read as the new ones", () => {
    const old = { version: 3, placed: ["cpu", "ram", "ram2", "cooler"], connected: [], powered: false,
      history: ["part:cpu", "part:ram", "part:ram2", "prep:cooler:film:removed", "prep:cooler:paste:applied", "place:cooler", "screw:cooler:0", "screw:cooler:2", "screw:cooler:1", "screw:cooler:3"] };
    const parsed = parseSimpleSnapshot(old);
    expect(parsed).not.toBeNull();
    const s = simpleBuildFromSnapshot(parsed!);
    expect(simplePartInstalled(s, "cooler")).toBe(true);
    expect(simplePartInstalled(s, "cpu")).toBe(true);
    expect(parsed!.placed).toEqual(expect.arrayContaining(["cpu", "cooler"]));
  });

  it("a save made with the whole-fit step round-trips", () => {
    const snap = { ...emptySimpleSnapshot(), history: ["part:cpu", "part:cooler"] as SimpleStep[] };
    const parsed = parseSimpleSnapshot(JSON.parse(JSON.stringify({ ...snap, version: 3, placed: ["cpu", "cooler"], connected: [], powered: false })));
    expect(simplePartInstalled(simpleBuildFromSnapshot(parsed!), "cooler")).toBe(true);
  });
});

describe("Liquid Freezer III 280 (the practice build's liquid cooler): block, radiator and VRM module are separate", () => {
  it("the pump block goes on first (board on the bench), then its two screws and the VRM module; the radiator waits for the board in the case", () => {
    const { steps, state } = walk(withCpu(), "aio");
    expect(kinds(steps)).toEqual([
      "backplate", "lever", "plate", "ilm", "frame",
      "frameScrew:engaged", "frameScrew:engaged", "frameScrew:engaged", "frameScrew:engaged",
      "frameScrew:tight", "frameScrew:tight", "frameScrew:tight", "frameScrew:tight",
      "paste", "film", "place", "screw:engaged", "screw:engaged", "screw:tight", "screw:tight", "vrmFan",
    ]);
    expect(nextCoolerStep(state, "aio")).toEqual({ kind: "boardFirst" }); // the radiator needs the board in the case
    expect(simplePartInstalled(state, "aio")).toBe(false); // not mechanically complete: the radiator is still off
    expect(simpleCoolerProgress(state, "aio")).toMatchObject({ placed: true, secured: 2, total: 2, mechanicallyComplete: false });
  });

  it("with the board in the case the radiator mounts, its fasteners go in, and only then is the cooler complete", () => {
    const early = walk(withCpu(), "aio").state;
    const boarded = [...["ram", "ram2", "storage"]].reduce((s, k) => must(installSimplePart(s, k)), early);
    const inCase = must(installSimplePart(boarded, "motherboard"));
    const { steps, state } = walk(inCase, "aio");
    expect(kinds(steps)[0]).toBe("radiator");
    expect(kinds(steps).filter((k) => k === "radiatorScrew").length).toBe(8);
    expect(simplePartInstalled(state, "aio")).toBe(true);
    expect(simpleCoolerProgress(state, "aio")).toMatchObject({ mechanicallyComplete: true, connected: false });
  });

  it("the part note matches that order: the block on the bench, only the radiator after the board is in the case (en and ar)", () => {
    expect(en.simplePc.partNotes.aio).toMatch(/block on the bench/);
    expect(en.simplePc.partNotes.aio).toMatch(/radiator once the board is in the case/);
    expect(ar.simplePc.partNotes.aio).toMatch(/البلوك على الطاولة/);
    expect(ar.simplePc.partNotes.aio).toMatch(/الرادياتير بعد/);
    // And the workflow it describes: the block is placeable with the board on the bench; the radiator waits.
    const block = walk(withCpu(), "aio");
    expect(block.steps.some((s) => s?.kind === "place")).toBe(true);
    expect(nextCoolerStep(block.state, "aio")).toEqual({ kind: "boardFirst" });
  });

  it("the AIO's own radiator fans are not extra case fans", () => {
    const { state } = walk(withCpu(), "aio");
    const fans = state.parts.filter((p) => p.catalogId.includes("fan") || p.catalogId.includes("p12")).length;
    expect(fans).toBe(createSimpleBuild().parts.filter((p) => p.catalogId.includes("fan") || p.catalogId.includes("p12")).length);
  });
});

describe("Freezer 7 X on the H81M-K (retention ring and pins, pre-applied paste)", () => {
  it("position, ring, four pins, film, place; no paste step and no backplate", () => {
    activateSimpleModel(planModel({ version: 1, purpose: "study", workload: "", parts: { case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"], fans: [] } }));
    const cpu = must(installSimplePart(createSimpleBuild(), "cpu"));
    const { steps, state } = walk(cpu, "cooler");
    expect(kinds(steps)).toEqual(["position", "ring", "pin", "pin", "pin", "pin", "film", "place"]);
    expect(steps[0]).toMatchObject({ id: "1200" }); // LGA1150 takes the LGA1200/115x position
    expect(simplePartInstalled(state, "cooler")).toBe(true);
  });
});

describe("changing the plan's cooler", () => {
  const gaming = {
    case: "corsair-4000d-airflow-black", motherboard: "asus-tuf-gaming-z790-plus-wifi", cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36",
    psu: "corsair-rm850x-atx31", gpu: "asus-dual-rtx5060-o8g", ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 }, storage: ["samsung-990-pro-1tb"], fans: ["arctic-p12-pwm-pst"],
  };
  const plan = (cooler: string) => planModel({ version: 1, purpose: "gaming", workload: "1080p", parts: { ...gaming, cooler } });

  it("keeps the CPU's frame work and the other parts' progress; only the old cooler's own steps go, and the new cooler fits on the tight frame", () => {
    const air = plan("arctic-freezer-36");
    activateSimpleModel(air);
    const { state, history } = walk(must(installSimplePart(createSimpleBuild(), "cpu")), "cooler");
    expect(simplePartInstalled(state, "cooler")).toBe(true);
    const snapshot = { placed: ["cpu", "cooler", "ram"], connected: [], history: ["part:cpu", ...history, "part:ram"] as string[], powered: false };
    const liquid = plan("arctic-liquid-freezer-iii-240-argb");
    const r = rebaseProgress(snapshot, air, liquid);
    expect(r.changed).toContain("cooler");
    expect(r.history).toEqual(expect.arrayContaining(["part:cpu", "part:ram", "hw:motherboard:ilm:removed", "hw:motherboard:frame:placed", "hw:motherboard:frame_screws:2222"]));
    expect(r.history.filter((s) => s === "place:cooler" || s.startsWith("hw:cooler:") || s.startsWith("prep:cooler:"))).toEqual([]);
    activateSimpleModel(liquid);
    const next = simpleBuildFromSnapshot(snapshotFromHistory(r.history));
    expect(simplePartInstalled(next, "cpu")).toBe(true); // still retained by the frame
    expect(simplePartInstalled(next, "aio")).toBe(false); // a liquid cooler's part key is `aio`
    expect(nextCoolerStep(next, "aio")).toMatchObject({ kind: "paste" }); // straight to the thermal steps: the frame is already tight
  });
});

describe("taking a cooler off (physical removal, never Undo)", () => {
  /** Applies removal steps until none is left; returns the kinds taken and the saved steps. */
  function remove(state: PCBuildState, key: string) {
    const taken: string[] = [];
    const history: SimpleStep[] = [];
    let s = state;
    for (let i = 0; i < 40; i += 1) {
      const step = nextCoolerRemoval(s, key);
      if (!step) break;
      const r = applyCoolerStep(s, key, step);
      if (!r.ok) throw new Error(`${JSON.stringify(step)} refused: ${JSON.stringify(r)}`);
      history.push(coolerStepHistory(s, key, step));
      taken.push(step.kind === "screw" ? `screw:${step.to}` : step.kind);
      s = r.state;
    }
    return { state: s, taken, history };
  }

  it("an air cooler: its screws loosened and taken out, then lifted off; the plate is used and the CPU stays in its frame", () => {
    const fitted = walk(withCpu(), "cooler").state;
    const out = remove(fitted, "cooler");
    expect(out.taken).toEqual(["screw:loosened", "screw:loosened", "screw:out", "screw:out", "liftBody"]);
    expect(out.history.at(-1)).toBe("lift:cooler");
    expect(simplePartInstalled(out.state, "cooler")).toBe(false);
    expect(simplePartInstalled(out.state, "cpu")).toBe(true); // the frame still holds it
    expect(out.state.parts.find((p) => p.instanceId === "cooling-6")!.hardware).toMatchObject({ contact: "used" });
    // The plate is spent: cleaning and fresh paste come before it goes back (the manual's film stays peeled).
    expect(nextCoolerStep(out.state, "cooler")).toEqual({ kind: "clean" });
  });

  it("the engine refuses lifting a cooler whose screws are still tight; undo (not removal) restores paste and screws exactly", () => {
    const fitted = walk(withCpu(), "cooler");
    expect(applyCoolerStep(fitted.state, "cooler", { kind: "liftBody" })).toMatchObject({ ok: false });
    const out = remove(fitted.state, "cooler");
    // Undo of the removal steps (history popped and replayed) brings the cooler back exactly as it was.
    let snap: SimpleSnapshot = { ...emptySimpleSnapshot(), history: ["part:cpu", ...fitted.history, ...out.history] as SimpleStep[] };
    snap = { ...snap, ...deriveSimpleLists(snap.history) };
    for (let i = 0; i < out.history.length; i += 1) snap = undoSimpleStep(snap)!;
    expect(simpleBuildFromSnapshot(snap)).toEqual(fitted.state);
  });

  it("a liquid cooler: the radiator comes off before the pump block", () => {
    const early = walk(withCpu(), "aio").state;
    const boarded = [...["ram", "ram2", "storage"]].reduce((s, k) => must(installSimplePart(s, k)), early);
    const complete = walk(must(installSimplePart(boarded, "motherboard")), "aio").state;
    expect(simplePartInstalled(complete, "aio")).toBe(true);
    const out = remove(complete, "aio");
    expect(out.taken.filter((k) => k === "radiatorUnscrew").length).toBe(8);
    expect(out.taken.indexOf("liftRadiator")).toBeLessThan(out.taken.indexOf("liftBody"));
    expect(out.taken.at(-1)).toBe("liftBody");
    expect(out.history).toContain("lift:aio:rad");
  });
});

describe("the contact frame after its cooler is off: optional removal, CPU out, original ILM back (review fix)", () => {
  /** Fitted, then the body taken off by its own removal steps (never Undo): the frame stays tight over the CPU. */
  function bodyOff() {
    const fitted = walk(withCpu(), "cooler");
    let s = fitted.state;
    const history: SimpleStep[] = ["part:cpu" as SimpleStep, ...fitted.history];
    for (let step = nextCoolerRemoval(s, "cooler"); step; step = nextCoolerRemoval(s, "cooler")) {
      history.push(coolerStepHistory(s, "cooler", step));
      s = must(applyCoolerStep(s, "cooler", step));
    }
    return { state: s, history };
  }
  /** Takes every optional mounting step the page offers, as the page does: one engine change and one saved step each. */
  function dismantle(state: PCBuildState) {
    const taken: string[] = [];
    const history: SimpleStep[] = [];
    let s = state;
    for (let step = nextMountingRemoval(s); step; step = nextMountingRemoval(s)) {
      taken.push(step.kind === "frameScrew" ? `frameScrew:${step.to}:${step.index}` : step.kind);
      history.push(mountingStepHistory(step));
      s = must(applyMountingStep(s, step));
    }
    return { state: s, taken, history };
  }
  const boardOf = (s: PCBuildState) => s.parts.find((p) => p.catalogId === "asus-tuf-gaming-z790-plus-wifi" || p.instanceId.startsWith("motherboard"))!;
  const inSocket = (s: PCBuildState) => s.parts.some((p) => p.attachments.some((a) => a.target.mountPointId === "cpu-socket"));

  it("before: the frame blocks lifting the CPU, and nothing of the frame is offered while a cooler body is still on", () => {
    const fitted = walk(withCpu(), "cooler").state;
    expect(nextMountingRemoval(fitted)).toBeNull(); // the body sits over the frame
    const { state } = bodyOff();
    expect(simplePartInstalled(state, "cpu")).toBe(true);
    const lift = liftSimplePart(state, "cpu");
    expect(lift.ok).toBe(false);
    expect(JSON.stringify(lift)).toMatch(/contact frame is over the CPU/);
  });

  it("is optional: with the body off, the cooler's own next step is still a refit on the tight frame", () => {
    const { state } = bodyOff();
    expect(nextCoolerStep(state, "cooler")).toEqual({ kind: "clean" });
    expect(nextMountingRemoval(state)).toMatchObject({ kind: "frameScrew", to: "loosened" });
  });

  it("once the learner chooses removal, the guidance follows removal; any install step hands it back (direction from the saved steps)", () => {
    const { state, history } = bodyOff();
    expect(mountingDismantling(history)).toBe(false); // fitted only: nothing taken off yet
    const first = nextMountingRemoval(state)!;
    const after = must(applyMountingStep(state, first));
    const saved = [...history, mountingStepHistory(first)];
    expect(saved.at(-1)).toBe("hw:motherboard:frame_screws:1222");
    expect(mountingDismantling(saved)).toBe(true);
    // The cooler's own next step is still the refit (tighten), so the guidance must be told which way the learner is going.
    expect(nextCoolerStep(after, "cooler")).toMatchObject({ kind: "frameScrew", to: "tight" });
    const select = { type: "select", selection: { kind: "part", key: "cooler" } } as const;
    expect(companionSay(select, after, false, null).lines[0]!.key).toBe("cooler.frameScrewTight");
    expect(companionSay(select, after, false, null, true).lines[0]).toMatchObject({ key: "cooler.frameScrewLoosen", values: { n: 3, total: 4 } });
    expect(companionSay({ type: "resume", held: null }, after, false, null, true).lines.map((l) => l.key)).toContain("cooler.frameScrewLoosen");
    // Tightening a frame screw again is an install step: the direction flips back.
    const tighten = nextCoolerStep(after, "cooler")!;
    expect(mountingDismantling([...saved, coolerStepHistory(after, "cooler", tighten)])).toBe(false);
    // Frame off and the original ILM back are removal steps too; placing the frame again is not.
    expect(mountingDismantling([...saved, "hw:motherboard:frame:"])).toBe(true);
    expect(mountingDismantling([...saved, "hw:motherboard:frame:", "hw:motherboard:ilm:"])).toBe(true);
    expect(mountingDismantling([...saved, "hw:motherboard:frame:", "hw:motherboard:frame:placed"])).toBe(false);
    // Undo pops the last saved step: the direction is read again from what is left.
    expect(mountingDismantling(saved.slice(0, -1))).toBe(false);
  });

  it("frame screws loosened across (each the opposite of the last), then taken out, then the frame off, then the ILM back", () => {
    const { state } = bodyOff();
    expect(boardOf(state).hardware).toMatchObject({ ilm: "removed", frame: "placed", frame_screws: "2222" });
    const out = dismantle(state);
    expect(out.taken).toEqual([
      "frameScrew:loosened:0", "frameScrew:loosened:2", "frameScrew:loosened:1", "frameScrew:loosened:3",
      "frameScrew:out:0", "frameScrew:out:1", "frameScrew:out:2", "frameScrew:out:3",
      "frameOff", "ilmRefit",
    ]);
    expect(out.history.slice(-2)).toEqual(["hw:motherboard:frame:", "hw:motherboard:ilm:"]);
    expect(boardOf(out.state).hardware ?? {}).not.toHaveProperty("frame");
    expect(boardOf(out.state).hardware ?? {}).not.toHaveProperty("ilm");
    // The backplate support was never taken away during the work.
    expect(boardOf(out.state).prep?.backplate).toBe("padding");
  });

  it("the CPU stays put until the learner lifts it, and lifts only once the frame is actually off", () => {
    const { state } = bodyOff();
    let s = state;
    for (let step = nextMountingRemoval(s); step && step.kind !== "frameOff"; step = nextMountingRemoval(s)) {
      s = must(applyMountingStep(s, step));
      expect(inSocket(s)).toBe(true);
      expect(liftSimplePart(s, "cpu").ok).toBe(false); // the frame (loose or not) is still over it
    }
    const frameOff = must(applyMountingStep(s, nextMountingRemoval(s)));
    expect(inSocket(frameOff)).toBe(true); // not lifted for the learner
    expect(inSocket(must(liftSimplePart(frameOff, "cpu")))).toBe(false);
  });

  it("with the ILM back, the original plate and lever close over the CPU again and retain it", () => {
    const { state } = dismantle(bodyOff().state);
    expect(simplePartInstalled(state, "cpu")).toBe(false); // the frame no longer holds it
    const ret = simpleRetention(state, "cpu")!;
    const closed = must(setSimpleMechanism(must(setSimpleMechanism(state, ret.id, "closed")), ret.leverId!, "closed"));
    expect(simplePartInstalled(closed, "cpu")).toBe(true);
  });

  it("the plate stays refused while the ILM is off, even with the frame gone, so the shared next step never offers it", () => {
    let s = bodyOff().state;
    for (let step = nextMountingRemoval(s); step && step.kind !== "ilmRefit"; step = nextMountingRemoval(s)) s = must(applyMountingStep(s, step));
    expect(nextMountingRemoval(s)).toEqual({ kind: "ilmRefit" });
    expect(setSimpleMechanism(s, simpleRetention(s, "cpu")!.id, "closed").ok).toBe(false);
    expect(nextHandStep(s, "cpu", null)).toBeNull(); // toolbar, scene click and robot: no refused "close the plate"
    // With the ILM back, the same shared step closes the plate again.
    expect(nextHandStep(must(applyMountingStep(s, { kind: "ilmRefit" })), "cpu", null)).toEqual({ kind: "mechanism", desired: "closed" });
  });

  it("any point of the dismantling can be recovered: the cooler's steps refit the frame, or a lifted CPU goes back and the frame follows", () => {
    const { state } = bodyOff();
    // Two screws loosened: the fitting steps tighten them back (across) and the cooler goes on again.
    let s = must(applyMountingStep(state, nextMountingRemoval(state)));
    s = must(applyMountingStep(s, nextMountingRemoval(s)));
    expect(nextCoolerStep(s, "cooler")).toMatchObject({ kind: "frameScrew", to: "tight" });
    expect(simplePartInstalled(walk(s, "cooler").state, "cooler")).toBe(true);
    // Frame off, CPU lifted and lowered back (ILM still off): the next cooler step is the frame again.
    let t = state;
    for (let step = nextMountingRemoval(t); step && step.kind !== "ilmRefit"; step = nextMountingRemoval(t)) t = must(applyMountingStep(t, step));
    t = must(lowerSimplePart(must(liftSimplePart(t, "cpu")), "cpu", { rotationDeg: 0, offsetMm: [0, 0] }));
    expect(nextCoolerStep(t, "cooler")).toEqual({ kind: "frame" });
    expect(simplePartInstalled(walk(t, "cooler").state, "cooler")).toBe(true);
  });

  it("every mounting step and the CPU lift are saved steps: undo restores each previous state and a reload replays them exactly", () => {
    const off = bodyOff();
    const out = dismantle(off.state);
    const lifted = must(liftSimplePart(out.state, "cpu"));
    const history = [...off.history, ...out.history, "lift:cpu"] as SimpleStep[];
    const snap: SimpleSnapshot = { ...emptySimpleSnapshot(), history, ...deriveSimpleLists(history) };
    expect(snap.placed).not.toContain("cpu");
    // Reload: the save is parsed from JSON and replayed to the same build.
    const reloaded = parseSimpleSnapshot(JSON.parse(JSON.stringify({ ...snap, version: 3 })));
    expect(reloaded?.history).toEqual(history);
    expect(simpleBuildFromSnapshot(reloaded!)).toEqual(lifted);
    // Undo, one step at a time: the CPU lift first, then each mounting step, back to the frame tight.
    let u: SimpleSnapshot = undoSimpleStep(snap)!;
    expect(simpleBuildFromSnapshot(u)).toEqual(out.state);
    for (let i = 0; i < out.history.length; i += 1) u = undoSimpleStep(u)!;
    expect(simpleBuildFromSnapshot(u)).toEqual(off.state);
    expect(nextMountingRemoval(simpleBuildFromSnapshot(u))).toMatchObject({ kind: "frameScrew", to: "loosened" });
  });

  it("a half-dismantled frame reloads half-dismantled, with the same next step", () => {
    const off = bodyOff();
    let s = off.state;
    const history = [...off.history];
    for (let i = 0; i < 5; i += 1) { const step = nextMountingRemoval(s)!; history.push(mountingStepHistory(step)); s = must(applyMountingStep(s, step)); }
    const reloaded = simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify({ ...emptySimpleSnapshot(), version: 3, history, ...deriveSimpleLists(history) })))!);
    expect(reloaded).toEqual(s);
    // Four loosened and the first taken out ("0111"): the second comes out next.
    expect(nextMountingRemoval(reloaded)).toEqual({ kind: "frameScrew", to: "out", index: 1, value: "0011" });
  });

  it("every mounting step has a robot line in both languages", () => {
    let s = bodyOff().state;
    const keys = new Set<string>();
    for (let step = nextMountingRemoval(s); step; step = nextMountingRemoval(s)) { keys.add(mountingRemovalLine(step)!.key); s = must(applyMountingStep(s, step)); }
    expect([...keys].sort()).toEqual(["cooler.frameOff", "cooler.frameScrewLoosen", "cooler.frameScrewOut", "cooler.ilmRefit"]);
    const at = (m: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], m);
    for (const key of keys) {
      expect(typeof at(en.simplePc.companion, key)).toBe("string");
      expect(typeof at(ar.simplePc.companion, key)).toBe("string");
    }
  });

  it("a retention-ring cooler leaves no such dead end: with its body off the CPU's own plate opens and the CPU lifts", () => {
    activateSimpleModel(planModel({ version: 1, purpose: "study", workload: "", parts: { case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"], fans: [] } }));
    let s = walk(must(installSimplePart(createSimpleBuild(), "cpu")), "cooler").state;
    for (let step = nextCoolerRemoval(s, "cooler"); step; step = nextCoolerRemoval(s, "cooler")) s = must(applyCoolerStep(s, "cooler", step));
    expect(simplePartInstalled(s, "cooler")).toBe(false);
    expect(nextMountingRemoval(s)).toBeNull();
    const ret = simpleRetention(s, "cpu")!;
    s = must(setSimpleMechanism(s, ret.leverId!, "open"));
    s = must(setSimpleMechanism(s, ret.id, "open"));
    expect(inSocket(must(liftSimplePart(s, "cpu")))).toBe(false);
  });
});
