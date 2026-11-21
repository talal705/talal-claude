import { afterEach, describe, expect, it } from "vitest";
import type { PCBuildState } from "@ytl/contracts";
import { planModel } from "./plan-model";
import {
  activateSimpleModel, createSimpleBuild, emptySimpleSnapshot, LEGACY_MODEL, liftSimplePart, lowerSimplePart, parseHeld, parseSimpleSnapshot, reseatSimplePart,
  setSimpleMechanism, simpleBuildFromSnapshot, simpleCablesFor, simpleM2Heatsink, simpleM2Slots, simplePartInstalled, simpleTarget, undoSimpleStep, withLower,
  withMechanism, withPart, withSeat, type SimpleSnapshot,
} from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));
const must = <T,>(r: { ok: true; state: T } | { ok: false }) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.state; };
const mech = (s: PCBuildState, id: string, state: "open" | "closed") => must(setSimpleMechanism(s, id, state));
/** The first M.2 drive that is in a slot, if any. */
const at = (s: PCBuildState) => s.parts.find((p) => p.catalogId === "samsung-990-pro-1tb" && p.attachments.length)?.attachments[0];
const tilted = (slotId: string, tiltDeg = 25) => ({ rotationDeg: 0, offsetMm: [0, 0] as [number, number], tiltDeg, slotId });
const plan = (board: string, storage: string[]) => planModel({ version: 1, purpose: "study", workload: "", parts: { case: "corsair-4000d-airflow-black", motherboard: board, cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 }, storage, fans: [] } });

describe("M.2 by hand on the TUF GAMING Z790-PLUS WIFI (practice build)", () => {
  it("heatsink off, Q-Latch open, in at an angle, pressed flat, latched; installed only once the heatsink is back and screwed", () => {
    let s = createSimpleBuild();
    expect(simpleM2Heatsink(s, "m2-1")).toMatchObject({ id: "m2-hs-1", fitted: true, screwsIn: true, filmOn: true });
    expect(lowerSimplePart(s, "storage", tilted("m2-1"))).toMatchObject({ ok: false });
    s = mech(mech(mech(s, "m2-hs-1:screws", "open"), "m2-hs-1", "open"), "m2-1-qlatch", "open");
    expect(lowerSimplePart(s, "storage", tilted("m2-1", 0))).toMatchObject({ ok: false, reason: "tiltPart" });
    s = must(lowerSimplePart(s, "storage", tilted("m2-1")));
    expect(at(s)).toMatchObject({ seating: "placed", target: { mountPointId: "m2-1" } });
    s = mech(must(reseatSimplePart(s, "storage")), "m2-1-qlatch", "closed");
    expect(at(s)).toMatchObject({ seating: "seated", fastenersSecured: 1 });
    expect(simplePartInstalled(s, "storage")).toBe(false); // heatsink still off
    s = mech(mech(mech(s, "m2-hs-1:film", "open"), "m2-hs-1", "closed"), "m2-hs-1:screws", "closed");
    expect(simplePartInstalled(s, "storage")).toBe(true);
    expect(simpleM2Heatsink(s, "m2-1")).toMatchObject({ fitted: true, screwsIn: true, filmOn: false });
  });

  it("the learner chooses the slot: M.2_2 (no heatsink) works, and the drive's place is where it went", () => {
    let s = createSimpleBuild();
    expect(simpleM2Slots(s, "storage").map((x) => [x.id, x.heatsinkId, x.fits, x.occupant])).toEqual([
      ["m2-1", "m2-hs-1", true, null], ["m2-2", null, true, null], ["m2-3", "m2-hs-2", true, null], ["m2-4", "m2-hs-2", true, null],
    ]);
    s = must(lowerSimplePart(mech(s, "m2-2-qlatch", "open"), "storage", tilted("m2-2")));
    s = mech(must(reseatSimplePart(s, "storage")), "m2-2-qlatch", "closed");
    expect(simplePartInstalled(s, "storage")).toBe(true);
    expect(simpleTarget(s, "storage").mountPointId).toBe("m2-2");
    expect(simpleM2Slots(s, "storage").find((x) => x.id === "m2-2")!.occupant).toBe("storage");
  });

  it("removal: heatsink off, Q-Latch open (the drive rises), drive out; the heatsink can then go back on an empty slot", () => {
    let s = simpleBuildFromSnapshot(withPart(emptySimpleSnapshot(), "storage"));
    expect(simplePartInstalled(s, "storage")).toBe(true);
    expect(liftSimplePart(s, "storage")).toMatchObject({ ok: false });
    s = mech(mech(mech(s, "m2-hs-1:screws", "open"), "m2-hs-1", "open"), "m2-1-qlatch", "open");
    expect(at(s)).toMatchObject({ seating: "placed", fastenersSecured: 0 });
    s = must(liftSimplePart(s, "storage"));
    expect(at(s)).toBeUndefined();
    s = mech(mech(s, "m2-hs-1", "closed"), "m2-hs-1:screws", "closed");
    expect(simpleM2Heatsink(s, "m2-1")).toMatchObject({ fitted: true, screwsIn: true });
  });

  it("every step is saved and undone on its own; the whole-fit step still works for older saves", () => {
    const steps: ((sn: SimpleSnapshot) => SimpleSnapshot)[] = [
      (sn) => withMechanism(sn, "m2-hs-1:screws", "open"), (sn) => withMechanism(sn, "m2-hs-1", "open"), (sn) => withMechanism(sn, "m2-1-qlatch", "open"),
      (sn) => withLower(sn, "storage", tilted("m2-1")), (sn) => withSeat(sn, "storage"), (sn) => withMechanism(sn, "m2-1-qlatch", "closed"),
      (sn) => withMechanism(sn, "m2-hs-1:film", "open"), (sn) => withMechanism(sn, "m2-hs-1", "closed"), (sn) => withMechanism(sn, "m2-hs-1:screws", "closed"),
    ];
    const snaps = steps.reduce<SimpleSnapshot[]>((all, f) => [...all, f(all.at(-1)!)], [emptySimpleSnapshot()]);
    expect(snaps.at(-1)!.history.at(3)).toBe("lower:storage:0:0:0:t25:sm2-1");
    expect(simplePartInstalled(simpleBuildFromSnapshot(snaps.at(-1)!), "storage")).toBe(true);
    // Undo walks back one step at a time to exactly the state before it.
    for (let i = snaps.length - 1; i > 0; i -= 1) expect(simpleBuildFromSnapshot(undoSimpleStep(snaps[i]!)!)).toEqual(simpleBuildFromSnapshot(snaps[i - 1]!));
    // A save round-trips with its steps (and the hand pose with its tilt and slot).
    expect(parseSimpleSnapshot(JSON.parse(JSON.stringify(snaps.at(-1)!)))?.history).toEqual(snaps.at(-1)!.history);
    expect(parseHeld({ key: "storage", rotationDeg: 0, offsetMm: [0, 0], tiltDeg: 25, slotId: "m2-3" })).toEqual({ key: "storage", rotationDeg: 0, offsetMm: [0, 0], tiltDeg: 25, slotId: "m2-3" });
    expect(parseHeld({ key: "storage", rotationDeg: 0, offsetMm: [4, 0] })).toEqual({ key: "storage", rotationDeg: 0, offsetMm: [4, 0] });
  });

  it("a save from before heatsinks and angles loads with the drive in and the heatsink back on; nothing is cleared", () => {
    const old = { version: 3, placed: ["storage"], connected: [], history: ["mech:m2-1-qlatch:open", "lower:storage", "mech:m2-1-qlatch:closed"], powered: false };
    const parsed = parseSimpleSnapshot(old);
    expect(parsed?.placed).toEqual(["storage"]);
    const s = simpleBuildFromSnapshot(parsed!);
    expect(simplePartInstalled(s, "storage")).toBe(true);
    expect(simpleM2Heatsink(s, "m2-1")).toMatchObject({ fitted: true, screwsIn: true, filmOn: false });
    expect(parseSimpleSnapshot({ version: 1, placed: ["cpu", "ram", "storage"], powered: false })).not.toBeNull();
  });

  it("an NVMe M.2 drive needs no SATA data or SATA power lead", () => {
    expect(simpleCablesFor(createSimpleBuild()).some((c) => /sata/i.test(c.key))).toBe(false);
  });
});

describe("M.2 on the PRIME B760M-A WIFI: screw stand and screw (manual E21693 p. 1-14)", () => {
  it("stand, in at an angle, flat, screwed, heatsink back: installed; an older Q-Latch save is read as the screw it really is", () => {
    activateSimpleModel(plan("asus-prime-b760m-a-wifi", ["samsung-990-pro-1tb"]));
    let s = mech(mech(createSimpleBuild(), "m2-hs-1:screws", "open"), "m2-hs-1", "open");
    expect(lowerSimplePart(s, "storage", tilted("m2-1"))).toMatchObject({ ok: false });
    s = must(lowerSimplePart(mech(s, "m2-1-screw:stand", "closed"), "storage", tilted("m2-1")));
    s = mech(must(reseatSimplePart(s, "storage")), "m2-1-screw", "closed");
    s = mech(mech(mech(s, "m2-hs-1:film", "open"), "m2-hs-1", "closed"), "m2-hs-1:screws", "closed");
    expect(simplePartInstalled(s, "storage")).toBe(true);
    const old = parseSimpleSnapshot({ version: 4, plan: {}, placed: ["storage"], connected: [], history: ["mech:m2-1-qlatch:open", "lower:storage", "mech:m2-1-qlatch:closed"], powered: false });
    expect(old).not.toBeNull();
    expect(simplePartInstalled(simpleBuildFromSnapshot(old!), "storage")).toBe(true);
  });
});

describe("two drives under one heatsink (TUF M.2_3 + M.2_4)", () => {
  it("each drive keeps its own state; removing one leaves the other secured", () => {
    activateSimpleModel(plan("asus-tuf-gaming-z790-plus-wifi", ["samsung-990-pro-1tb", "samsung-990-pro-1tb"]));
    let s = mech(mech(createSimpleBuild(), "m2-hs-2:screws", "open"), "m2-hs-2", "open");
    for (const [key, slot] of [["storage", "m2-3"], ["storage2", "m2-4"]] as const) {
      s = must(lowerSimplePart(mech(s, `${slot}-qlatch`, "open"), key, tilted(slot)));
      s = mech(must(reseatSimplePart(s, key)), `${slot}-qlatch`, "closed");
    }
    s = mech(mech(mech(s, "m2-hs-2:film", "open"), "m2-hs-2", "closed"), "m2-hs-2:screws", "closed");
    expect([simplePartInstalled(s, "storage"), simplePartInstalled(s, "storage2")]).toEqual([true, true]);
    s = must(liftSimplePart(mech(mech(mech(s, "m2-hs-2:screws", "open"), "m2-hs-2", "open"), "m2-4-qlatch", "open"), "storage2"));
    expect(simpleTarget(s, "storage").mountPointId).toBe("m2-3");
    expect(s.parts.flatMap((p) => p.attachments.filter((a) => a.target.mountPointId === "m2-3")).map((a) => a.fastenersSecured)).toEqual([1]);
  });
});

