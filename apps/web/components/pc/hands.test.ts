import { afterEach, describe, expect, it } from "vitest";
import {
  activateSimpleModel, createSimpleBuild, emptySimpleSnapshot, LEGACY_MODEL, liftSimplePart, lowerSimplePart, parseSimpleSnapshot, setSimpleMechanism, simpleBuildFromSnapshot,
  simplePartInstalled, simpleRetention, undoSimpleStep, withLift, withLower, withMechanism,
} from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));
const aligned = { rotationDeg: 0, offsetMm: [0, 0] as [number, number] };

describe("hands-on CPU and memory", () => {
  it("lowers a CPU only with the plate open and the triangle matched; it counts as installed once the plate is closed", () => {
    let s = createSimpleBuild();
    expect(lowerSimplePart(s, "cpu", aligned)).toMatchObject({ ok: false, reason: "openFirst" });
    const open = setSimpleMechanism(s, "cpu-socket-plate", "open");
    if (!open.ok) throw new Error();
    s = open.state;
    expect(lowerSimplePart(s, "cpu", { rotationDeg: 90, offsetMm: [0, 0] })).toMatchObject({ ok: false, reason: "turnPart" });
    expect(lowerSimplePart(s, "cpu", { rotationDeg: 0, offsetMm: [4, 3] })).toMatchObject({ ok: false, reason: "centrePart" });
    const low = lowerSimplePart(s, "cpu", { rotationDeg: 0, offsetMm: [1, 1] });
    if (!low.ok) throw new Error();
    expect(simplePartInstalled(low.state, "cpu")).toBe(false);
    const closed = setSimpleMechanism(low.state, "cpu-socket-plate", "closed");
    if (!closed.ok) throw new Error();
    expect(simplePartInstalled(closed.state, "cpu")).toBe(true);
    expect(liftSimplePart(closed.state, "cpu")).toMatchObject({ ok: false, reason: "openFirst" });
  });

  it("records each physical step, undoes them one at a time and restores them after a reload", () => {
    let snap = emptySimpleSnapshot();
    snap = withMechanism(snap, "cpu-socket-plate", "open");
    snap = withLower(snap, "cpu");
    snap = withMechanism(snap, "cpu-socket-plate", "closed");
    snap = withMechanism(snap, "dimm-a2-latch", "open");
    snap = withLower(snap, "ram");
    expect(snap.placed).toEqual(["cpu", "ram"]);
    const restored = parseSimpleSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(restored?.history).toEqual(snap.history);
    const state = simpleBuildFromSnapshot(restored!);
    expect(state.parts.find((p) => p.instanceId === "motherboard-2")?.mechanisms).toMatchObject({ "cpu-socket-plate": "closed", "dimm-a2-latch": "closed", "cpu-socket-plate:cover": "open" });
    const undone = undoSimpleStep(snap)!;
    expect(undone.placed).toEqual(["cpu"]);
    expect(simpleBuildFromSnapshot(undone).parts.find((p) => p.instanceId === "motherboard-2")?.mechanisms?.["dimm-a2-latch"]).toBe("open");
    // Lifting a module out needs its latch open; then it is back on the bench.
    const lifted = withLift(withMechanism(snap, "dimm-a2-latch", "open"), "ram");
    expect(lifted.placed).toEqual(["cpu"]);
    expect(simpleBuildFromSnapshot(lifted).parts.find((p) => p.instanceId === "ram-4")?.attachments).toEqual([]);
  });

  it("migrates an older save explicitly: its one-step CPU and memory fittings replay through the mechanisms", () => {
    const old = { version: 3, placed: ["cpu", "ram", "ram2"], connected: [], history: ["part:cpu", "part:ram", "part:ram2"], powered: false };
    const parsed = parseSimpleSnapshot(old);
    expect(parsed?.history).toEqual(old.history);
    const state = simpleBuildFromSnapshot(parsed!);
    expect(simplePartInstalled(state, "cpu") && simplePartInstalled(state, "ram") && simplePartInstalled(state, "ram2")).toBe(true);
    expect(simpleRetention(state, "cpu")?.open).toBe(false);
  });

  it("refuses a save whose steps are not physically possible", () => {
    expect(parseSimpleSnapshot({ version: 3, placed: ["cpu"], connected: [], history: ["lower:cpu"], powered: false })).toBeNull();
  });
});
