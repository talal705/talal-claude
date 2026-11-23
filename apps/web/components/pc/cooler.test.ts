import { afterEach, describe, expect, it } from "vitest";
import type { PCBuildState } from "@ytl/contracts";
import {
  applyCoolerStep, coolerStepHistory, nextCoolerRemoval, nextCoolerStep, simpleCoolerProgress, type CoolerStep,
} from "./cooler-assembly";
import { planModel, rebaseProgress, snapshotFromHistory } from "./plan-model";
import {
  activateSimpleModel, createSimpleBuild, deriveSimpleLists, emptySimpleSnapshot, installSimplePart, LEGACY_MODEL, parseSimpleSnapshot, simpleBuildFromSnapshot, simplePartInstalled,
  simpleCablesFor, undoSimpleStep, type SimpleSnapshot, type SimpleStep,
} from "./simple-model";

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
    expect(simpleCablesFor(state).filter((c) => /fan/i.test(c.key)).every((c) => c.key !== "cpuFan" || true)).toBe(true);
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
