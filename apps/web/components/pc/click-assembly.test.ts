import { afterEach, describe, expect, it } from "vitest";
import type { PCBuildState } from "@ytl/contracts";
import { aimClick, aimHeld, aimTargets, createStepGate, m2LiftPose, nextHandStep, sameAim, type HandStep } from "./click-assembly";
import { heldLines } from "./companion";
import { planModel } from "./plan-model";
import {
  activateSimpleModel, createSimpleBuild, emptySimpleSnapshot, installSimplePart, LEGACY_MODEL, liftSimplePart, lowerSimplePart, lowerSimpleRam, M2_WHOLE_TILT_DEG,
  parseSimpleSnapshot, reseatSimplePart, setSimpleMechanism, simpleBuildFromSnapshot, simplePartInstalled, simpleRamSlotOffsets, simpleRamSlots, simpleRetention,
  simpleTarget, withLift, withLower, withMechanism, withPart, withSeat, type SimpleHeld, type SimplePartKey, type SimpleSnapshot,
} from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));
const must = <T,>(r: { ok: true; state: T } | { ok: false }) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.state; };
const H81 = () => activateSimpleModel(planModel({ version: 1, purpose: "study", workload: "", parts: { case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"], fans: [] } }));
/** How the page carries out one step: exactly one engine call (aiming only moves the hand). */
function apply(state: PCBuildState, key: "ram" | "ram2" | "cpu", held: SimpleHeld | null, step: HandStep): { state: PCBuildState; held: SimpleHeld | null } {
  if (!step) throw new Error("no step");
  const ret = simpleRetention(state, key)!;
  switch (step.kind) {
    case "clip": return { state: must(setSimpleMechanism(state, step.near ? simpleRamSlots(state).find((s) => s.id === step.slotId)!.nearId! : simpleRamSlots(state).find((s) => s.id === step.slotId)!.clipId, "open")), held };
    case "lever": return { state: must(setSimpleMechanism(state, ret.leverId!, step.desired)), held };
    case "mechanism": return { state: must(setSimpleMechanism(state, ret.id, step.desired)), held };
    case "lower": {
      const r = key === "cpu" ? lowerSimplePart(state, key, held!) : lowerSimpleRam(state, key, held!);
      return { state: must(r), held: null };
    }
    case "seat": return { state: must(reseatSimplePart(state, key)), held };
    default: throw new Error(`unexpected step ${JSON.stringify(step)}`);
  }
}

describe("click-based assembly: aiming a part in hand at the place clicked", () => {
  it("any real memory slot can be chosen by a click; the turn the learner gave the module is kept, never corrected", () => {
    const s = createSimpleBuild();
    const off = simpleRamSlotOffsets(s);
    const held: SimpleHeld = { key: "ram", rotationDeg: 180, offsetMm: [6, -30] };
    for (const slot of ["dimm-a1", "dimm-a2", "dimm-b1", "dimm-b2"]) {
      const r = aimHeld(s, held, slot);
      expect(r).toEqual({ ok: true, held: { key: "ram", rotationDeg: 180, offsetMm: off.get(slot) }, placeId: slot });
    }
  });

  it("refuses a slot another module is in, a place that is not the part's, and a part that cannot go in yet", () => {
    let s = createSimpleBuild();
    const b1 = simpleRamSlotOffsets(s).get("dimm-b1")!;
    s = must(setSimpleMechanism(s, "dimm-b1-latch", "open"));
    s = must(lowerSimpleRam(s, "ram2", { rotationDeg: 0, offsetMm: b1 }));
    const held: SimpleHeld = { key: "ram", rotationDeg: 0, offsetMm: [6, -30] };
    expect(aimHeld(s, held, "dimm-b1")).toEqual({ ok: false, reason: "slotTaken", placeId: "dimm-b1" });
    expect(aimHeld(s, held, "cpu-socket")).toEqual({ ok: false, reason: "notItsPlace", placeId: "cpu-socket" });
    expect(aimHeld(s, { key: "cpu", rotationDeg: 90, offsetMm: [-32, -18] }, "dimm-a2")).toEqual({ ok: false, reason: "notItsPlace", placeId: "dimm-a2" });
    // The board in the case first: the CPU belongs on the prepared board (the order is still checked).
    const boardFirst = aimHeld(must(installSimplePart(createSimpleBuild(), "cpu")), { key: "cpu2", rotationDeg: 0, offsetMm: [0, 0] }, "cpu-socket");
    expect(boardFirst.ok).toBe(false);
  });

  it("a CPU is brought over the centre of its socket, still turned as the learner held it", () => {
    const s = createSimpleBuild();
    expect(aimHeld(s, { key: "cpu", rotationDeg: 90, offsetMm: [-32, -18] }, "cpu-socket")).toEqual({ ok: true, held: { key: "cpu", rotationDeg: 90, offsetMm: [0, 0] }, placeId: "cpu-socket" });
  });

  it("offers every memory slot as a click target, free or taken, without lighting any of them up (no default slot)", () => {
    let s = createSimpleBuild();
    s = must(setSimpleMechanism(s, "dimm-a2-latch", "open"));
    s = must(lowerSimpleRam(s, "ram2", { rotationDeg: 0, offsetMm: simpleRamSlotOffsets(s).get("dimm-a2")! }));
    const targets = aimTargets(s, "ram", { key: "ram", rotationDeg: 180, offsetMm: [6, -30] });
    expect(targets.map((t) => t.placeId)).toEqual(["dimm-a1", "dimm-a2", "dimm-b1", "dimm-b2"]);
    expect(targets.every((t) => t.role === "decoy" && t.id === `aim:${t.placeId}`)).toBe(true);
    // A module resting in its slot: only that slot answers (to press it home).
    s = must(setSimpleMechanism(s, "dimm-b1-latch", "open"));
    s = must(lowerSimpleRam(s, "ram", { rotationDeg: 0, offsetMm: simpleRamSlotOffsets(s).get("dimm-b1")! }));
    expect(aimTargets(s, "ram", null).map((t) => t.placeId)).toEqual(["dimm-b1"]);
    // Pressed home: nothing to click.
    expect(aimTargets(must(reseatSimplePart(s, "ram")), "ram", null)).toEqual([]);
  });

  it("the CPU socket answers a click only once it is open (the lever and plate are clicked themselves before that)", () => {
    let s = createSimpleBuild();
    const held: SimpleHeld = { key: "cpu", rotationDeg: 90, offsetMm: [-32, -18] };
    expect(aimTargets(s, "cpu", held)).toEqual([]);
    s = must(setSimpleMechanism(s, simpleRetention(s, "cpu")!.leverId!, "open"));
    expect(aimTargets(s, "cpu", held)).toEqual([]);
    s = must(setSimpleMechanism(s, simpleRetention(s, "cpu")!.id, "open"));
    expect(aimTargets(s, "cpu", held).map((t) => `${t.id} ${t.role}`)).toEqual(["aim:cpu-socket target"]);
  });
});

describe("click-based assembly: one click, one checked step", () => {
  it("memory on a one-clip board: choose a slot, open its clip, lower, press home; each click one step", () => {
    let s = createSimpleBuild();
    let held: SimpleHeld | null = { key: "ram", rotationDeg: 180, offsetMm: [6, -30] };
    expect(nextHandStep(s, "ram", held)).toEqual({ kind: "aim" });
    // The learner turns it the right way round (that stays their job), then clicks B1.
    held = { ...held, rotationDeg: 0 };
    const aimed = aimHeld(s, held, "dimm-b1");
    if (!aimed.ok) throw new Error("aim");
    held = aimed.held;
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const step = nextHandStep(s, "ram", held);
      if (!step) break;
      seen.push(step.kind);
      const before = JSON.stringify(s);
      ({ state: s, held } = apply(s, "ram", held, step));
      expect(JSON.stringify(s)).not.toBe(before);
    }
    expect(seen).toEqual(["clip", "lower", "seat"]);
    expect(simplePartInstalled(s, "ram")).toBe(true);
    expect(simpleRamSlots(s).find((x) => x.id === "dimm-b1")!.occupant).toBe("ram");
  });

  it("a board with a clip at each end: both clips, one click each, before the module can go in", () => {
    H81();
    const s = createSimpleBuild();
    const aimed = aimHeld(s, { key: "ram", rotationDeg: 0, offsetMm: [0, 0] }, "dimm-a1");
    if (!aimed.ok) throw new Error("aim");
    expect(nextHandStep(s, "ram", aimed.held)).toEqual({ kind: "clip", slotId: "dimm-a1", near: false });
    const one = must(setSimpleMechanism(s, "dimm-a1-latch", "open"));
    expect(nextHandStep(one, "ram", aimed.held)).toEqual({ kind: "clip", slotId: "dimm-a1", near: true });
    expect(nextHandStep(must(setSimpleMechanism(one, "dimm-a1-latch:near", "open")), "ram", aimed.held)).toEqual({ kind: "lower" });
  });

  it("a reversed module is still refused when it is lowered: aiming never turns it", () => {
    let s = createSimpleBuild();
    s = must(setSimpleMechanism(s, "dimm-a2-latch", "open"));
    const aimed = aimHeld(s, { key: "ram", rotationDeg: 180, offsetMm: [6, -30] }, "dimm-a2");
    if (!aimed.ok) throw new Error("aim");
    expect(nextHandStep(s, "ram", aimed.held)).toEqual({ kind: "lower" });
    expect(lowerSimpleRam(s, "ram", aimed.held)).toMatchObject({ ok: false, reason: "turnPart" });
  });

  it("a slot another module is in is named, not entered", () => {
    let s = createSimpleBuild();
    const b2 = simpleRamSlotOffsets(s).get("dimm-b2")!;
    s = must(setSimpleMechanism(s, "dimm-b2-latch", "open"));
    s = must(lowerSimpleRam(s, "ram2", { rotationDeg: 0, offsetMm: b2 }));
    // Held over B2 by the keys (the click refuses it): the next step says the slot is taken.
    expect(nextHandStep(s, "ram", { key: "ram", rotationDeg: 0, offsetMm: b2 })).toEqual({ kind: "slotTaken", slotId: "dimm-b2" });
  });

  it("the Intel CPU: lever, plate, bring it over, lower, close the plate, lock the lever; each click one step", () => {
    let s = createSimpleBuild();
    let held: SimpleHeld | null = { key: "cpu", rotationDeg: 0, offsetMm: [-32, -18] };
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const step = nextHandStep(s, "cpu", held);
      if (!step) break;
      seen.push(step.kind === "lever" || step.kind === "mechanism" ? `${step.kind}:${step.desired}` : step.kind);
      if (step.kind === "aim") {
        const aimed = aimHeld(s, held!, "cpu-socket");
        if (!aimed.ok) throw new Error("aim");
        held = aimed.held;
        continue;
      }
      const before = JSON.stringify(s);
      ({ state: s, held } = apply(s, "cpu", held, step));
      expect(JSON.stringify(s)).not.toBe(before);
    }
    expect(seen).toEqual(["lever:open", "mechanism:open", "aim", "lower", "mechanism:closed", "lever:closed"]);
    expect(simplePartInstalled(s, "cpu")).toBe(true);
  });

  it("a CPU turned the wrong way, brought over the socket, is refused when lowered", () => {
    let s = createSimpleBuild();
    s = must(setSimpleMechanism(s, simpleRetention(s, "cpu")!.leverId!, "open"));
    s = must(setSimpleMechanism(s, simpleRetention(s, "cpu")!.id, "open"));
    const aimed = aimHeld(s, { key: "cpu", rotationDeg: 90, offsetMm: [-32, -18] }, "cpu-socket");
    if (!aimed.ok) throw new Error("aim");
    expect(nextHandStep(s, "cpu", aimed.held)).toEqual({ kind: "lower" });
    expect(lowerSimplePart(s, "cpu", aimed.held)).toMatchObject({ ok: false, reason: "turnPart" });
  });

  it("nothing to do for a part that is in, and nothing for a part with no mechanism of its own", () => {
    const s = must(installSimplePart(createSimpleBuild(), "cpu"));
    expect(nextHandStep(s, "cpu", null)).toBeNull();
    expect(nextHandStep(s, "psu", null)).toBeNull();
  });
});

describe("click-based assembly: an M.2 drive, one documented step per click", () => {
  /** One step as the page takes it: one engine call, or (aim, tilt) a change of the hand only. */
  function m2Step(state: PCBuildState, held: SimpleHeld | null, step: HandStep): { state: PCBuildState; held: SimpleHeld | null } {
    if (!step) throw new Error("no step");
    const slotId = held?.slotId ?? state.parts.flatMap((p) => p.attachments).find((a) => a.target.mountPointId.startsWith("m2-") && state.parts.some((x) => x.catalogId === "samsung-990-pro-1tb" && x.attachments.includes(a)))?.target.mountPointId;
    const ret = simpleRetention(state, "storage", slotId)!;
    switch (step.kind) {
      case "heatsink": {
        const [id, st] = ({ screws: [`${step.hsId}:screws`, "open"], lift: [step.hsId, "open"], film: [`${step.hsId}:film`, "open"], fit: [step.hsId, "closed"], tighten: [`${step.hsId}:screws`, "closed"] } as const)[step.step];
        return { state: must(setSimpleMechanism(state, id, st)), held };
      }
      case "stand": return { state: must(setSimpleMechanism(state, ret.standId!, "closed")), held };
      case "mechanism": return { state: must(setSimpleMechanism(state, ret.id, step.desired)), held };
      case "tilt": return { state, held: { ...held!, tiltDeg: 25 } };
      case "lower": return { state: must(lowerSimplePart(state, "storage", held!)), held: null };
      case "seat": return { state: must(reseatSimplePart(state, "storage")), held };
      default: throw new Error(`unexpected step ${JSON.stringify(step)}`);
    }
  }
  /** Clicks the drive's next step until it is in; the learner turns it right and chooses the slot (aim). */
  function walk(state: PCBuildState, slotId: string): string[] {
    let held: SimpleHeld | null = { key: "storage", rotationDeg: 0, offsetMm: [4, 0] };
    const seen: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const step = nextHandStep(state, "storage", held);
      if (!step) return seen;
      seen.push(step.kind === "heatsink" ? `heatsink:${step.step}` : step.kind === "mechanism" ? `mechanism:${step.desired}` : step.kind);
      if (step.kind === "aim") { const r = aimHeld(state, held!, slotId); if (!r.ok) throw new Error(r.reason); held = r.held; continue; }
      ({ state, held } = m2Step(state, held, step));
    }
    throw new Error(`no end: ${seen.join(", ")}`);
  }

  it("TUF M.2_1: choose the slot, heatsink off, Q-Latch open, tilt, insert, press flat, latch, film, heatsink back, screws", () => {
    expect(walk(createSimpleBuild(), "m2-1")).toEqual([
      "aim", "heatsink:screws", "heatsink:lift", "mechanism:open", "tilt", "lower", "seat", "mechanism:closed", "heatsink:film", "heatsink:fit", "heatsink:tighten",
    ]);
  });

  it("TUF M.2_2 has no heatsink: those steps are skipped", () => {
    expect(walk(createSimpleBuild(), "m2-2")).toEqual(["aim", "mechanism:open", "tilt", "lower", "seat", "mechanism:closed"]);
  });

  it("PRIME B760M-A WIFI: the screw stand instead of a Q-Latch, and the screw holds it", () => {
    activateSimpleModel(planModel({ version: 1, purpose: "study", workload: "", parts: { case: "corsair-4000d-airflow-black", motherboard: "asus-prime-b760m-a-wifi", cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 }, storage: ["samsung-990-pro-1tb"], fans: [] } }));
    expect(walk(createSimpleBuild(), "m2-1")).toEqual([
      "aim", "heatsink:screws", "heatsink:lift", "stand", "tilt", "lower", "seat", "mechanism:closed", "heatsink:film", "heatsink:fit", "heatsink:tighten",
    ]);
  });

  it("aiming keeps the learner's turn and tilt; a slot another drive is in, or one the drive does not fit, is refused", () => {
    const s = must(installSimplePart(createSimpleBuild(), "storage"));
    const held: SimpleHeld = { key: "storage", rotationDeg: 180, offsetMm: [4, 0], tiltDeg: 10 };
    expect(aimHeld(createSimpleBuild(), held, "m2-3")).toEqual({ ok: true, held: { ...held, offsetMm: [0, 0], slotId: "m2-3" }, placeId: "m2-3" });
    expect(aimHeld(s, { ...held, key: "storage" }, "m2-1")).toMatchObject({ ok: true }); // its own slot
    expect(aimHeld(createSimpleBuild(), held, "dimm-a1")).toMatchObject({ ok: false, reason: "notItsPlace" });
    // Every M.2 slot can be clicked; none is suggested.
    expect(aimTargets(createSimpleBuild(), "storage", held).map((t) => [t.placeId, t.role])).toEqual([["m2-1", "decoy"], ["m2-2", "decoy"], ["m2-3", "decoy"], ["m2-4", "decoy"]]);
  });
});

describe("click-based assembly: what a click on a place does (the page's aimAt decision)", () => {
  /** The drive held over `from` (aimed there by a click), turned and tilted by the learner. */
  const over = (state: PCBuildState, from: string): SimpleHeld => {
    const r = aimClick(state, { key: "storage", rotationDeg: 180, offsetMm: [4, 0], tiltDeg: 25 }, from);
    if (!r.ok || !r.moved) throw new Error(`aim ${from}: ${JSON.stringify(r)}`);
    return r.held;
  };

  for (const [from, to] of [["m2-1", "m2-2"], ["m2-3", "m2-4"], ["m2-2", "m2-1"]] as const) {
    it(`an M.2 drive over ${from}: a click on ${to} moves it there (turn and tilt kept), with no mechanical step and no change to the build`, () => {
      const s = createSimpleBuild();
      const before = JSON.stringify(s);
      const held = over(s, from);
      expect(held).toEqual({ key: "storage", rotationDeg: 180, offsetMm: [0, 0], tiltDeg: 25, slotId: from });
      const r = aimClick(s, held, to);
      // Both slots aim to the connector centre ([0, 0]): the slot itself is what tells them apart.
      expect(r).toEqual({ ok: true, moved: true, placeId: to, held: { ...held, slotId: to } });
      expect(JSON.stringify(s)).toBe(before);
      // The next step is now about the new slot, never the old one's heatsink or latch.
      const next = nextHandStep(s, "storage", (r as { held: SimpleHeld }).held);
      if (next?.kind === "heatsink") expect(next.hsId).not.toContain(from);
      expect(nextHandStep(s, "storage", (r as { held: SimpleHeld }).held)).toEqual(nextHandStep(s, "storage", { ...held, slotId: to }));
    });
  }

  it("TUF: from M.2_1 (heatsink steps), a click on M.2_2 makes the next step M.2_2's latch, and M.2_1's heatsink is left as it was", () => {
    let s = createSimpleBuild();
    const held = over(s, "m2-1");
    const first = nextHandStep(s, "storage", held);
    expect(first).toMatchObject({ kind: "heatsink", step: "screws" });
    // One real step on M.2_1 (its heatsink's screws out), then the learner changes their mind.
    s = must(setSimpleMechanism(s, `${(first as { hsId: string }).hsId}:screws`, "open"));
    const before = JSON.stringify(s);
    const r = aimClick(s, held, "m2-2");
    expect(r).toMatchObject({ ok: true, moved: true, held: { slotId: "m2-2", rotationDeg: 180, tiltDeg: 25 } });
    expect(JSON.stringify(s)).toBe(before);
    expect(nextHandStep(s, "storage", (r as { held: SimpleHeld }).held)).toEqual({ kind: "mechanism", desired: "open" });
  });

  it("a click on the slot the drive is already over is the next step there (not a move)", () => {
    const s = createSimpleBuild();
    const held = over(s, "m2-2");
    expect(aimClick(s, held, "m2-2")).toEqual({ ok: true, moved: false, placeId: "m2-2", held });
  });

  it("CPU and memory keep their behaviour: the same place is a step, another memory slot is a move", () => {
    const s = createSimpleBuild();
    const cpu = aimClick(s, { key: "cpu", rotationDeg: 90, offsetMm: [-32, -18] }, "cpu-socket");
    expect(cpu).toEqual({ ok: true, moved: true, placeId: "cpu-socket", held: { key: "cpu", rotationDeg: 90, offsetMm: [0, 0] } });
    expect(aimClick(s, (cpu as { held: SimpleHeld }).held, "cpu-socket")).toMatchObject({ ok: true, moved: false });
    const off = simpleRamSlotOffsets(s);
    const a1 = aimClick(s, { key: "ram", rotationDeg: 0, offsetMm: [6, -30] }, "dimm-a1");
    expect(a1).toEqual({ ok: true, moved: true, placeId: "dimm-a1", held: { key: "ram", rotationDeg: 0, offsetMm: off.get("dimm-a1") } });
    const held = (a1 as { held: SimpleHeld }).held;
    expect(aimClick(s, held, "dimm-a1")).toMatchObject({ ok: true, moved: false });
    expect(aimClick(s, held, "dimm-b2")).toMatchObject({ ok: true, moved: true, held: { offsetMm: off.get("dimm-b2") } });
  });

  it("refusals pass through unchanged", () => {
    const s = createSimpleBuild();
    expect(aimClick(s, { key: "storage", rotationDeg: 0, offsetMm: [4, 0] }, "dimm-a1")).toEqual({ ok: false, reason: "notItsPlace", placeId: "dimm-a1" });
  });

  it("sameAim compares the slot as well as the pose", () => {
    const a: SimpleHeld = { key: "storage", rotationDeg: 0, offsetMm: [0, 0], slotId: "m2-1" };
    expect(sameAim(a, { ...a })).toBe(true);
    expect(sameAim(a, { ...a, slotId: "m2-2" })).toBe(false);
    expect(sameAim(a, { ...a, offsetMm: [0, 1] })).toBe(false);
    expect(sameAim(a, { ...a, key: "storage2" as SimpleHeld["key"] })).toBe(false);
  });
});

describe("one hand step at a time: the gate every assembly input goes through", () => {
  function gate() {
    const pending: (() => void)[] = [];
    const g = createStepGate(450, (f) => pending.push(f));
    /** The end of the current input event (the microtask after the handler). */
    const endEvent = () => { while (pending.length) pending.shift()!(); };
    return { g, endEvent };
  }

  it("a second input inside the step's time is ignored; after it, the next one goes", () => {
    const { g, endEvent } = gate();
    expect(g.take(1000)).toBe(true); endEvent();
    expect(g.take(1100)).toBe(false); endEvent(); // double click
    expect(g.take(1449)).toBe(false); endEvent(); // key repeat
    expect(g.take(1450)).toBe(true); endEvent();
  });

  it("nested calls inside the same input (toolbar → step → mechanism) count as one step", () => {
    const { g, endEvent } = gate();
    expect(g.take(1000)).toBe(true);
    expect(g.take(1000.2)).toBe(true);
    expect(g.take(1000.4)).toBe(true);
    endEvent();
    expect(g.take(1001)).toBe(false);
  });

  it("aiming (a pure move of the hand) is never refused, but arms the gate so a double click on a slot is not also a step", () => {
    const { g, endEvent } = gate();
    g.arm(1000); endEvent();
    expect(g.take(1200)).toBe(false); endEvent();
    expect(g.take(1500)).toBe(true); endEvent();
  });
});

describe("taking an installed M.2 drive out: it stays in hand over the slot it came from", () => {
  const TWO = () => activateSimpleModel(planModel({ version: 1, purpose: "study", workload: "", parts: { case: "corsair-4000d-airflow-black", motherboard: "asus-tuf-gaming-z790-plus-wifi", cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 }, storage: ["samsung-990-pro-1tb", "samsung-990-pro-1tb"], fans: [] } }));
  const IN = (slotId: string) => ({ rotationDeg: 0, offsetMm: [0, 0] as [number, number], tiltDeg: M2_WHOLE_TILT_DEG, slotId });
  /** Fitted by hand under the shared heatsink (M.2_3/M.2_4) and latched, then the latch opened again (heatsink off): ready to lift. */
  function fittedThenOpened(drives: [SimplePartKey, string][]): SimpleSnapshot {
    let sn = withMechanism(withMechanism(emptySimpleSnapshot(), "m2-hs-2:screws", "open"), "m2-hs-2", "open");
    for (const [key, slot] of drives) sn = withMechanism(withSeat(withLower(withMechanism(sn, `${slot}-qlatch`, "open"), key, IN(slot)), key), `${slot}-qlatch`, "closed");
    for (const [, slot] of drives) sn = withMechanism(sn, `${slot}-qlatch`, "open");
    return sn;
  }
  const printed = (slot: string) => `M.2_${slot.slice(-1)}`;

  for (const [key, slot] of [["storage", "m2-3"], ["storage2", "m2-4"]] as const) {
    it(`${key} out of ${slot}: the hand keeps ${slot}, the installed turn (0°), the insertion tilt and the connector position`, () => {
      TWO();
      const sn = fittedThenOpened([["storage", "m2-3"], ["storage2", "m2-4"]]);
      const before = simpleBuildFromSnapshot(sn);
      const pose = m2LiftPose(before, key);
      expect(pose).toEqual({ key, rotationDeg: 0, offsetMm: [0, 0], tiltDeg: M2_WHOLE_TILT_DEG, slotId: slot });
      const after = must(liftSimplePart(before, key));
      expect(simpleBuildFromSnapshot(withLift(sn, key))).toEqual(after);
      // Over that same connector: what the scene and the engine read is the source slot, not the plan's default one.
      expect(simpleTarget(after, key, pose!.slotId).mountPointId).toBe(slot);
      expect(aimClick(after, pose!, slot)).toMatchObject({ ok: true, moved: false });
      // The robot names the slot it came out of.
      expect(heldLines(after, pose!)?.[0]).toEqual({ key: "resume.m2Over", values: { slot: printed(slot) } });
    });
  }

  it("a drive fitted in M.2_3 while the plan's slot is M.2_1 comes out over M.2_3", () => {
    const sn = fittedThenOpened([["storage", "m2-3"]]);
    const before = simpleBuildFromSnapshot(sn);
    expect(simpleTarget(createSimpleBuild(), "storage").mountPointId).toBe("m2-1");
    const pose = m2LiftPose(before, "storage");
    expect(pose).toEqual({ key: "storage", rotationDeg: 0, offsetMm: [0, 0], tiltDeg: M2_WHOLE_TILT_DEG, slotId: "m2-3" });
    const after = must(liftSimplePart(before, "storage"));
    expect(simpleTarget(after, "storage").mountPointId).toBe("m2-1"); // the fallback the page used to show
    expect(simpleTarget(after, "storage", pose!.slotId).mountPointId).toBe("m2-3");
    expect(nextHandStep(after, "storage", pose)).not.toMatchObject({ kind: "aim" });
  });

  it("the pose in hand after taking a drive out of M.2_4 survives a save and reload", () => {
    TWO();
    const sn = fittedThenOpened([["storage", "m2-3"], ["storage2", "m2-4"]]);
    const pose = m2LiftPose(simpleBuildFromSnapshot(sn), "storage2")!;
    const saved: SimpleSnapshot = { ...withLift(sn, "storage2"), held: pose };
    const restored = parseSimpleSnapshot(JSON.parse(JSON.stringify(saved)));
    expect(restored?.held).toEqual({ key: "storage2", rotationDeg: 0, offsetMm: [0, 0], tiltDeg: M2_WHOLE_TILT_DEG, slotId: "m2-4" });
    const after = simpleBuildFromSnapshot(restored!);
    expect(after.parts.some((p) => p.attachments.some((a) => a.target.mountPointId === "m2-4"))).toBe(false);
    expect(simpleTarget(after, "storage2", restored!.held!.slotId).mountPointId).toBe("m2-4");
    expect(heldLines(after, restored!.held!)?.[0]).toEqual({ key: "resume.m2Over", values: { slot: "M.2_4" } });
  });

  it("no M.2 lift pose for a drive not in a slot, or for a CPU or a memory module", () => {
    expect(m2LiftPose(createSimpleBuild(), "storage")).toBeNull();
    expect(m2LiftPose(simpleBuildFromSnapshot(withPart(emptySimpleSnapshot(), "ram")), "ram")).toBeNull();
    expect(m2LiftPose(simpleBuildFromSnapshot(withPart(emptySimpleSnapshot(), "cpu")), "cpu")).toBeNull();
  });
});
