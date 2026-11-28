import { afterEach, describe, expect, it } from "vitest";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import { planModel } from "./plan-model";
import {
  activateSimpleModel, createSimpleBuild, emptySimpleSnapshot, LEGACY_MODEL, liftSimplePart, loweredPose, lowerSimpleRam, parseSimpleSnapshot, reseatSimplePart, setSimpleMechanism,
  simpleBuildFromSnapshot, simplePartInstalled, simpleRamSlotOffsets, simpleRamSlots, undoSimpleStep, withLower, withMechanism, withSeat,
} from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));
const must = <T,>(r: { ok: true; state: T } | { ok: false }) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.state; };
const at = (s: ReturnType<typeof createSimpleBuild>, id: string) => s.parts.find((p) => p.instanceId === id)?.attachments[0];

describe("memory by hand (TUF GAMING Z790-PLUS WIFI: one clip per slot)", () => {
  it("chooses the slot by where the module is held; checks clip, notch and alignment; rests, then presses home", () => {
    let s = createSimpleBuild();
    const off = simpleRamSlotOffsets(s);
    expect([...off.keys()]).toEqual(["dimm-a1", "dimm-a2", "dimm-b1", "dimm-b2"]);
    const a2 = off.get("dimm-a2")!;
    expect(lowerSimpleRam(s, "ram", { rotationDeg: 0, offsetMm: [0, off.get("dimm-a1")![1] - 6] })).toMatchObject({ ok: false, reason: "noSlot" });
    expect(lowerSimpleRam(s, "ram", { rotationDeg: 0, offsetMm: a2 })).toMatchObject({ ok: false, reason: "openFirst", slotId: "dimm-a2" });
    s = must(setSimpleMechanism(s, "dimm-a2-latch", "open"));
    expect(lowerSimpleRam(s, "ram", { rotationDeg: 180, offsetMm: a2 })).toMatchObject({ ok: false, reason: "turnPart" });
    expect(lowerSimpleRam(s, "ram", { rotationDeg: 0, offsetMm: [a2[0] + 2, a2[1]] })).toMatchObject({ ok: false, reason: "centrePart" });
    const r = lowerSimpleRam(s, "ram", { rotationDeg: 0, offsetMm: [a2[0] + 1, a2[1] - 0.5] });
    if (!r.ok) throw new Error(JSON.stringify(r));
    s = r.state;
    expect(r.slotId).toBe("dimm-a2");
    // Resting in the slot is not installed.
    expect(at(s, "ram-4")?.seating).toBe("placed");
    expect(simplePartInstalled(s, "ram")).toBe(false);
    s = must(reseatSimplePart(s, "ram"));
    expect(simplePartInstalled(s, "ram")).toBe(true);
    expect(simpleRamSlots(s).find((x) => x.id === "dimm-a2")?.clipOpen).toBe(false);
    // Another module cannot go into the occupied slot (its clip is closed and it is taken).
    expect(lowerSimpleRam(s, "ram2", { rotationDeg: 0, offsetMm: a2 })).toMatchObject({ ok: false, reason: "slotTaken" });
    // A non-recommended slot is allowed (A1 with B2 free).
    s = must(setSimpleMechanism(s, "dimm-a1-latch", "open"));
    expect(lowerSimpleRam(s, "ram2", { rotationDeg: 0, offsetMm: off.get("dimm-a1")! }).ok).toBe(true);
  });

  it("each slot's clip is independent; removal needs the clip open, and lifts the module out", () => {
    let s = createSimpleBuild();
    s = must(setSimpleMechanism(s, "dimm-b2-latch", "open"));
    expect(simpleRamSlots(s).filter((x) => x.clipOpen).map((x) => x.id)).toEqual(["dimm-b2"]);
    s = must(lowerSimpleRam(s, "ram", { rotationDeg: 0, offsetMm: simpleRamSlotOffsets(s).get("dimm-b2")! }) as { ok: true; state: typeof s });
    s = must(reseatSimplePart(s, "ram"));
    expect(liftSimplePart(s, "ram")).toMatchObject({ ok: false, reason: "openFirst" });
    s = must(setSimpleMechanism(s, "dimm-b2-latch", "open"));
    expect(at(s, "ram-4")?.seating).toBe("placed");
    s = must(liftSimplePart(s, "ram"));
    expect(at(s, "ram-4")).toBeUndefined();
  });

  it("records the pose (and so the slot) it was lowered from; replays, undoes and reloads it", () => {
    const base = createSimpleBuild();
    const b1 = simpleRamSlotOffsets(base).get("dimm-b1")!;
    let snap = emptySimpleSnapshot();
    snap = withMechanism(snap, "dimm-b1-latch", "open");
    snap = withLower(snap, "ram", { rotationDeg: 0, offsetMm: [1, b1[1] + 0.5] });
    expect(snap.history.at(-1)).toBe(`lower:ram:0:1:${b1[1] + 0.5}`);
    let state = simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify(snap)))!);
    expect(at(state, "ram-4")).toMatchObject({ target: { mountPointId: "dimm-b1" }, seating: "placed" });
    snap = withSeat(snap, "ram");
    state = simpleBuildFromSnapshot(snap);
    expect(simplePartInstalled(state, "ram")).toBe(true);
    // Undo the press: resting again (partial), clip open again.
    const unpressed = undoSimpleStep(snap)!;
    expect(at(simpleBuildFromSnapshot(unpressed), "ram-4")?.seating).toBe("placed");
    // Undo the lowering: back to the held pose.
    const unlowered = undoSimpleStep(unpressed)!;
    expect(loweredPose(unpressed.history.at(-1)!)).toEqual({ key: "ram", rotationDeg: 0, offsetMm: [1, b1[1] + 0.5] });
    expect(at(simpleBuildFromSnapshot(unlowered), "ram-4")).toBeUndefined();
    expect(simpleRamSlots(simpleBuildFromSnapshot(unlowered)).find((x) => x.id === "dimm-b1")?.clipOpen).toBe(true);
  });

  it("still reads an older save's one-step memory fitting", () => {
    const old = { version: 3, placed: ["ram"], connected: [], history: ["mech:dimm-a2-latch:open", "lower:ram"], powered: false };
    expect(simplePartInstalled(simpleBuildFromSnapshot(parseSimpleSnapshot(old)!), "ram")).toBe(true);
  });
});

describe("memory with a clip at each end (ASUS H81M-K, DDR3)", () => {
  it("needs both clips open to go in and to come out; pressing home closes both", () => {
    activateSimpleModel(planModel({ version: 1, purpose: "study", workload: "", parts: { case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"], fans: [] } }));
    let s = createSimpleBuild();
    const slots = simpleRamSlots(s);
    expect(slots.map((x) => [x.id, x.nearId])).toEqual([["dimm-a1", "dimm-a1-latch:near"], ["dimm-b1", "dimm-b1-latch:near"]]);
    const a1 = simpleRamSlotOffsets(s).get("dimm-a1")!;
    s = must(setSimpleMechanism(s, "dimm-a1-latch", "open"));
    expect(lowerSimpleRam(s, "ram", { rotationDeg: 0, offsetMm: a1 })).toMatchObject({ ok: false, reason: "openFirst" });
    s = must(setSimpleMechanism(s, "dimm-a1-latch:near", "open"));
    s = must(lowerSimpleRam(s, "ram", { rotationDeg: 0, offsetMm: a1 }) as { ok: true; state: typeof s });
    s = must(reseatSimplePart(s, "ram"));
    expect(simpleRamSlots(s).find((x) => x.id === "dimm-a1")).toMatchObject({ clipOpen: false, nearOpen: false });
    s = must(setSimpleMechanism(s, "dimm-a1-latch", "open"));
    expect(liftSimplePart(s, "ram")).toMatchObject({ ok: false, reason: "openFirst" });
    s = must(setSimpleMechanism(s, "dimm-a1-latch:near", "open"));
    expect(liftSimplePart(s, "ram").ok).toBe(true);
  });

  it("saves and reloads the far-end clip steps", () => {
    activateSimpleModel(planModel({ version: 1, purpose: "study", workload: "", parts: { case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"], fans: [] } }));
    const history = ["mech:dimm-a1-latch:open", "mech:dimm-a1-latch:near:open"];
    const snap = parseSimpleSnapshot(JSON.parse(JSON.stringify({ ...emptySimpleSnapshot(), history })));
    expect(snap?.history).toEqual(history);
    expect(simpleRamSlots(simpleBuildFromSnapshot(snap!)).find((x) => x.id === "dimm-a1")).toMatchObject({ clipOpen: true, nearOpen: true });
  });
});

describe("memory of the wrong generation", () => {
  it("is refused with the catalog's own generations named", () => {
    const run = (s: ReturnType<typeof pc.createBuild>, a: Parameters<typeof pc.applyAction>[1]) => { const r = pc.applyAction(s, a, pcCatalog); if (!r.ok) throw new Error(r.rejection.code); return r.state; };
    let s = pc.createBuild(pcCatalog);
    for (const a of [{ type: "set_mechanics", mode: "detailed" }, { type: "add_part", catalogId: "asus-tuf-gaming-z790-plus-wifi" }, { type: "add_part", catalogId: "corsair-vengeance-lpx-ddr4-3600-16gb-kit" }, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "dimm-a2-latch", state: "open" }] as const) s = run(s, a as never);
    const r = pc.applyAction(s, { type: "mount_part", instanceId: "ram-2", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-a2" }, alignment: { rotationDeg: 0, offsetMm: [0, 0] } }, pcCatalog);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.rejection.message.en).toMatch(/DDR4/); expect(r.rejection.message.en).toMatch(/DDR5/); }
  });
});

describe("the clips each board's documents show", () => {
  const geo = (id: string) => pc.visual.partGeometry(pcCatalog.entries.find((e) => e.id === id)!, pcCatalog.version);
  const z = (id: string, solid: string) => geo(id).solids.find((s) => s.id === solid)?.at[2];
  it("one moving clip at the slot's top end (ASUS Q-DIMM: E21279, E20581, E21693 and the official photos); the bottom end is fixed", () => {
    for (const board of ["asus-tuf-gaming-z790-plus-wifi", "asus-tuf-gaming-z790-plus-wifi-d4", "asus-prime-b760m-a-wifi"]) {
      const slot = z(board, "dimm-a2")!;
      expect(z(board, "dimm-a2-latch")!, board).toBeLessThan(slot);
      expect(z(board, "dimm-a2-latch-near"), board).toBeUndefined();
      const ret = pcCatalog.entries.find((e) => e.id === board)!.mountPoints.find((m) => m.id === "dimm-a2")!.retention!;
      expect(ret).toMatchObject({ latches: "one_side", latchEnd: "top" });
    }
  });
  it("a clip at each end on the H81M-K (manual E8601 p. 1-9)", () => {
    const slot = z("asus-h81m-k", "dimm-a1")!;
    expect(z("asus-h81m-k", "dimm-a1-latch")!).toBeGreaterThan(slot);
    expect(z("asus-h81m-k", "dimm-a1-latch-near")!).toBeLessThan(slot);
  });
});
