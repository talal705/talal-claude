import { afterEach, describe, expect, it } from "vitest";
import type { PCBuildState } from "@ytl/contracts";
import { aimHeld, aimTargets, nextHandStep, type HandStep } from "./click-assembly";
import { planModel } from "./plan-model";
import {
  activateSimpleModel, createSimpleBuild, installSimplePart, LEGACY_MODEL, lowerSimplePart, lowerSimpleRam, reseatSimplePart, setSimpleMechanism,
  simplePartInstalled, simpleRamSlotOffsets, simpleRamSlots, simpleRetention, type SimpleHeld,
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
