import { afterEach, describe, expect, it } from "vitest";
import {
  activateSimpleModel, createSimpleBuild, emptySimpleSnapshot, LEGACY_MODEL, liftSimplePart, lowerSimplePart, parseSimpleSnapshot, reseatSimplePart, setSimpleMechanism, simpleBuildFromSnapshot,
  simplePartInstalled, simpleRetention, undoSimpleStep, withLift, withLower, withMechanism,
  caseCoversClosed, connectSimpleCable, disconnectSimpleCable, fastenSimplePart, installSimplePart, simpleFastened, SLOT_COVERS_ID, unfastenSimplePart, withFasten, withUnfasten,
  placeSimplePart, prepSimplePart, screwSimplePart, simpleOrientationAdvice, simpleScrewOrder, withPlace, withPrep, withScrew,
} from "./simple-model";
import { applyCoolerStep, nextCoolerStep } from "./cooler-assembly";

afterEach(() => activateSimpleModel(LEGACY_MODEL));
const aligned = { rotationDeg: 0, offsetMm: [0, 0] as [number, number] };

describe("hands-on CPU and memory", () => {
  it("lowers a CPU only with the plate open and the triangle matched; it counts as installed once the plate is closed", () => {
    let s = createSimpleBuild();
    expect(lowerSimplePart(s, "cpu", aligned)).toMatchObject({ ok: false, reason: "openFirst" });
    // The plate does not open before the lever is released and lifted.
    expect(setSimpleMechanism(s, "cpu-socket-plate", "open").ok).toBe(false);
    const lever = setSimpleMechanism(s, "cpu-socket-plate:lever", "open");
    if (!lever.ok) throw new Error();
    expect(lowerSimplePart(lever.state, "cpu", aligned)).toMatchObject({ ok: false, reason: "openFirst" });
    const open = setSimpleMechanism(lever.state, "cpu-socket-plate", "open");
    if (!open.ok) throw new Error();
    s = open.state;
    expect(lowerSimplePart(s, "cpu", { rotationDeg: 90, offsetMm: [0, 0] })).toMatchObject({ ok: false, reason: "turnPart" });
    expect(lowerSimplePart(s, "cpu", { rotationDeg: 0, offsetMm: [4, 3] })).toMatchObject({ ok: false, reason: "centrePart" });
    const low = lowerSimplePart(s, "cpu", { rotationDeg: 0, offsetMm: [1, 1] });
    if (!low.ok) throw new Error();
    expect(simplePartInstalled(low.state, "cpu")).toBe(false);
    // The lever cannot lock while the plate is up.
    expect(setSimpleMechanism(low.state, "cpu-socket-plate:lever", "closed").ok).toBe(false);
    const plate = setSimpleMechanism(low.state, "cpu-socket-plate", "closed");
    if (!plate.ok) throw new Error();
    expect(simplePartInstalled(plate.state, "cpu")).toBe(false);
    const closed = setSimpleMechanism(plate.state, "cpu-socket-plate:lever", "closed");
    if (!closed.ok) throw new Error();
    expect(simplePartInstalled(closed.state, "cpu")).toBe(true);
    expect(liftSimplePart(closed.state, "cpu")).toMatchObject({ ok: false, reason: "openFirst" });
  });

  it("records each physical step, undoes them one at a time and restores them after a reload", () => {
    let snap = emptySimpleSnapshot();
    snap = withMechanism(snap, "cpu-socket-plate:lever", "open");
    snap = withMechanism(snap, "cpu-socket-plate", "open");
    snap = withLower(snap, "cpu");
    snap = withMechanism(snap, "cpu-socket-plate", "closed");
    snap = withMechanism(snap, "cpu-socket-plate:lever", "closed");
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

  it("reads a save from before the lever had its own step as the two steps it stood for", () => {
    const old = { version: 3, placed: ["cpu"], connected: [], history: ["mech:cpu-socket-plate:open", "lower:cpu", "mech:cpu-socket-plate:closed"], powered: false };
    const parsed = parseSimpleSnapshot(old)!;
    expect(parsed.history).toEqual(["mech:cpu-socket-plate:lever:open", "mech:cpu-socket-plate:open", "lower:cpu", "mech:cpu-socket-plate:closed", "mech:cpu-socket-plate:lever:closed"]);
    expect(simplePartInstalled(simpleBuildFromSnapshot(parsed), "cpu")).toBe(true);
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

describe("hands-on graphics card", () => {
  const board = () => {
    let snap = emptySimpleSnapshot();
    for (const k of ["cpu", "ram", "ram2", "storage", "cooler", "motherboard"]) snap = { ...snap, history: [...snap.history, `part:${k}` as const] };
    return simpleBuildFromSnapshot(snap);
  };
  const must = <T,>(r: { ok: true; state: T } | { ok: false }) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.state; };

  it("needs the slot covers out, the latch open, the bracket the right way and lined up, then the screws", () => {
    let s = board();
    expect(caseCoversClosed(s)).toBe(true);
    expect(lowerSimplePart(s, "gpu", aligned)).toMatchObject({ ok: false, reason: "openFirst" });
    s = must(setSimpleMechanism(s, "pcie-x16-1-latch", "open"));
    // Latch open but the covers still in: the bracket has nowhere to go.
    expect(lowerSimplePart(s, "gpu", aligned)).toMatchObject({ ok: false, reason: "openFirst" });
    s = must(setSimpleMechanism(s, SLOT_COVERS_ID, "open"));
    expect(lowerSimplePart(s, "gpu", { rotationDeg: 180, offsetMm: [0, 0] })).toMatchObject({ ok: false, reason: "turnPart" });
    expect(lowerSimplePart(s, "gpu", { rotationDeg: 0, offsetMm: [4, 3] })).toMatchObject({ ok: false, reason: "centrePart" });
    s = must(lowerSimplePart(s, "gpu", { rotationDeg: 0, offsetMm: [1, 0] }));
    expect(simpleRetention(s, "gpu")?.open).toBe(false);
    expect(simplePartInstalled(s, "gpu")).toBe(false);
    s = must(fastenSimplePart(s, "gpu"));
    expect(simpleFastened(s, "gpu") && simplePartInstalled(s, "gpu")).toBe(true);
    // The covers cannot go back over a card.
    expect(setSimpleMechanism(s, SLOT_COVERS_ID, "closed").ok).toBe(false);
  });

  it("comes out only with its power unplugged, its screws out and its latch released", () => {
    let s = board();
    s = must(installSimplePart(s, "gpu"));
    s = must(installSimplePart(s, "psu"));
    s = must(connectSimpleCable(s, "gpuPower"));
    expect(liftSimplePart(s, "gpu")).toMatchObject({ ok: false, reason: "unplugFirst" });
    s = must(disconnectSimpleCable(s, "gpuPower"));
    expect(liftSimplePart(s, "gpu")).toMatchObject({ ok: false, reason: "unscrewFirst" });
    s = must(unfastenSimplePart(s, "gpu"));
    expect(liftSimplePart(s, "gpu")).toMatchObject({ ok: false, reason: "openFirst" });
    s = must(setSimpleMechanism(s, "pcie-x16-1-latch", "open"));
    // Releasing the latch leaves the card seated until it is lifted.
    expect(s.parts.find((p) => p.instanceId === "gpu-7")?.attachments[0]?.seating).toBe("seated");
    s = must(liftSimplePart(s, "gpu"));
    expect(s.parts.find((p) => p.instanceId === "gpu-7")?.attachments).toEqual([]);
  });

  it("records the card's steps and replays them after a reload", () => {
    let snap = emptySimpleSnapshot();
    for (const k of ["cpu", "ram", "ram2", "storage", "cooler", "motherboard"]) snap = { ...snap, history: [...snap.history, `part:${k}` as const] };
    snap = withMechanism(snap, SLOT_COVERS_ID, "open");
    snap = withMechanism(snap, "pcie-x16-1-latch", "open");
    snap = withLower(snap, "gpu");
    snap = withFasten(snap, "gpu");
    const restored = parseSimpleSnapshot(JSON.parse(JSON.stringify(snap)))!;
    expect(restored.history).toEqual(snap.history);
    expect(simplePartInstalled(simpleBuildFromSnapshot(restored), "gpu")).toBe(true);
    const undone = undoSimpleStep(restored)!;
    expect(simplePartInstalled(simpleBuildFromSnapshot(undone), "gpu")).toBe(false);
    const out = withLift(withMechanism(withUnfasten(snap, "gpu"), "pcie-x16-1-latch", "open"), "gpu");
    expect(out.placed).not.toContain("gpu");
  });
});

describe("hands-on M.2 drive (Q-Latch)", () => {
  const must = <T,>(r: { ok: true; state: T } | { ok: false }) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.state; };
  it("needs the heatsink off and the Q-Latch unlocked, the notch matched, the drive in front of the slot and tilted; it counts once latched and the heatsink is back", () => {
    let s = createSimpleBuild();
    const angled = { tiltDeg: 25, slotId: "m2-1" };
    expect(simpleRetention(s, "storage")?.kind).toBe("m2_qlatch");
    // M.2_1 is under its heatsink (manual E21279 p. 2-7): nothing there can be reached yet.
    expect(lowerSimplePart(s, "storage", { ...aligned, ...angled })).toMatchObject({ ok: false, reason: "cannotFit" });
    s = must(setSimpleMechanism(must(setSimpleMechanism(s, "m2-hs-1:screws", "open")), "m2-hs-1", "open"));
    expect(lowerSimplePart(s, "storage", { ...aligned, ...angled })).toMatchObject({ ok: false, reason: "openFirst" });
    s = must(setSimpleMechanism(s, "m2-1-qlatch", "open"));
    expect(lowerSimplePart(s, "storage", { rotationDeg: 180, offsetMm: [0, 0], ...angled })).toMatchObject({ ok: false, reason: "turnPart" });
    expect(lowerSimplePart(s, "storage", { rotationDeg: 0, offsetMm: [3, 0], ...angled })).toMatchObject({ ok: false, reason: "centrePart" });
    s = must(lowerSimplePart(s, "storage", { rotationDeg: 0, offsetMm: [1, 0], ...angled }));
    expect(simplePartInstalled(s, "storage")).toBe(false);
    s = must(setSimpleMechanism(must(reseatSimplePart(s, "storage")), "m2-1-qlatch", "closed"));
    expect(simplePartInstalled(s, "storage")).toBe(false); // the heatsink is still off
    for (const [id, st] of [["m2-hs-1:film", "open"], ["m2-hs-1", "closed"], ["m2-hs-1:screws", "closed"]] as const) s = must(setSimpleMechanism(s, id, st));
    expect(simplePartInstalled(s, "storage")).toBe(true);
    s = must(setSimpleMechanism(must(setSimpleMechanism(s, "m2-hs-1:screws", "open")), "m2-hs-1", "open"));
    expect(liftSimplePart(s, "storage")).toMatchObject({ ok: false, reason: "openFirst" });
    s = must(setSimpleMechanism(s, "m2-1-qlatch", "open"));
    expect(simplePartInstalled(s, "storage")).toBe(false);
    s = must(liftSimplePart(s, "storage"));
    expect(s.parts.find((p) => p.instanceId === "storage-5")?.attachments).toEqual([]);
  });
});

describe("hands-on preparation, placing and screws", () => {
  const must = <T,>(r: { ok: true; state: T } | { ok: false }) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.state; };
  const withBoardReady = () => {
    let snap = emptySimpleSnapshot();
    for (const k of ["cpu", "ram", "ram2", "storage"]) snap = { ...snap, history: [...snap.history, `part:${k}` as const] };
    return simpleBuildFromSnapshot(snap);
  };
  it("a cooler needs the paste and the film removal its catalog entry asks for; screws go across the diagonal", () => {
    let s = withBoardReady();
    // The Freezer 36 is held by its contact frame (ARCTIC's manual): the frame goes on before anything else.
    expect(placeSimplePart(s, "cooler")).toMatchObject({ ok: false, reason: "mountingMissing" });
    for (let step = nextCoolerStep(s, "cooler"); step && ["backplate", "lever", "plate", "ilm", "frame", "frameScrew"].includes(step.kind); step = nextCoolerStep(s, "cooler")) s = must(applyCoolerStep(s, "cooler", step));
    expect(placeSimplePart(s, "cooler")).toMatchObject({ ok: false, reason: "prepMissing" });
    s = must(prepSimplePart(s, "cooler", "film", "removed"));
    expect(placeSimplePart(s, "cooler")).toMatchObject({ ok: false, reason: "prepMissing" }); // paste still missing
    s = must(prepSimplePart(s, "cooler", "paste", "applied"));
    expect(prepSimplePart(s, "cooler", "paste", "applied")).toMatchObject({ ok: false, reason: "prepWrong" });
    s = must(placeSimplePart(s, "cooler"));
    expect(simplePartInstalled(s, "cooler")).toBe(false);
    expect(screwSimplePart(s, "cooler")).toMatchObject({ ok: false }); // its two screws go in one at a time, not by count
    for (let step = nextCoolerStep(s, "cooler"); step; step = nextCoolerStep(s, "cooler")) s = must(applyCoolerStep(s, "cooler", step));
    expect(simplePartInstalled(s, "cooler")).toBe(true);
    // The corner order of the lab's generic fixing (a pure rule on the saved steps).
    const history = ["place:cooler", "screw:cooler:0"] as const;
    expect(simpleScrewOrder([...history], "cooler").next).toBe(2);
    expect(simpleScrewOrder([...history, "screw:cooler:2"], "cooler").next).toBeNull();
  });
  it("the board needs its standoffs checked and refuses a separate I/O shield it does not have", () => {
    let s = withBoardReady();
    expect(placeSimplePart(s, "motherboard")).toMatchObject({ ok: false, reason: "prepMissing" });
    expect(prepSimplePart(s, "motherboard", "io_shield", "fitted")).toMatchObject({ ok: false, reason: "prepWrong" });
    s = must(prepSimplePart(s, "motherboard", "standoffs", "checked"));
    s = must(placeSimplePart(s, "motherboard"));
    for (let i = 0; i < 9; i++) s = must(screwSimplePart(s, "motherboard"));
    expect(simplePartInstalled(s, "motherboard")).toBe(true);
  });
  it("the PSU's fan direction is the learner's choice (either fits; the vent only makes down the advice); the steps replay from a save", () => {
    let snap = emptySimpleSnapshot();
    for (const k of ["cpu", "ram", "ram2", "storage", "cooler", "motherboard"]) snap = { ...snap, history: [...snap.history, `part:${k}` as const] };
    let s = simpleBuildFromSnapshot(snap);
    expect(placeSimplePart(s, "psu")).toMatchObject({ ok: false, reason: "prepMissing" });
    expect(simpleOrientationAdvice(s, "psu")).toBe("psuDown");
    expect(placeSimplePart(must(prepSimplePart(s, "psu", "psu_fan", "up")), "psu").ok).toBe(true);
    snap = withPrep(snap, "psu", "psu_fan", "down");
    snap = withPlace(snap, "psu");
    for (let i = 0; i < 4; i++) snap = withScrew(snap, "psu", i);
    const restored = parseSimpleSnapshot(JSON.parse(JSON.stringify(snap)))!;
    expect(restored.history).toEqual(snap.history);
    expect(simplePartInstalled(simpleBuildFromSnapshot(restored), "psu")).toBe(true);
    expect(simplePartInstalled(simpleBuildFromSnapshot(undoSimpleStep(restored)!), "psu")).toBe(false);
  });
});

describe("a CPU in hand is saved as it is held", () => {
  it("keeps the turn and offset of a held CPU through a save, and refuses an impossible pose", async () => {
    const { parseHeld, HELD_REACH_MM } = await import("./simple-model");
    let snap = emptySimpleSnapshot();
    snap = withMechanism(snap, "cpu-socket-plate:lever", "open");
    snap = { ...snap, held: { key: "cpu", rotationDeg: 90, offsetMm: [-12.5, 3] } };
    const restored = parseSimpleSnapshot(JSON.parse(JSON.stringify(snap)))!;
    expect(restored.held).toEqual({ key: "cpu", rotationDeg: 90, offsetMm: [-12.5, 3] });
    expect(parseHeld({ key: "cpu", rotationDeg: 45, offsetMm: [0, 0] })).toBeNull();
    expect(parseHeld({ key: "cpu", rotationDeg: 0, offsetMm: [HELD_REACH_MM + 1, 0] })).toBeNull();
    expect(parseHeld({ key: "nope", rotationDeg: 0, offsetMm: [0, 0] })).toBeNull();
  });
});

describe("phase 1 review fixes", () => {
  it("records the pose a CPU was lowered from, replays it, and gives it back on undo", async () => {
    const { loweredPose } = await import("./simple-model");
    let snap = emptySimpleSnapshot();
    snap = withMechanism(snap, "cpu-socket-plate:lever", "open");
    snap = withMechanism(snap, "cpu-socket-plate", "open");
    snap = withLower(snap, "cpu", { rotationDeg: 0, offsetMm: [1.5, -1] });
    expect(snap.history.at(-1)).toBe("lower:cpu:0:1.5:-1");
    expect(snap.placed).toEqual(["cpu"]);
    const restored = parseSimpleSnapshot(JSON.parse(JSON.stringify(snap)))!;
    expect(restored.history).toEqual(snap.history);
    expect(simpleBuildFromSnapshot(restored).parts.find((p) => p.instanceId === "cpu-3")?.attachments[0]?.seating).toBe("seated");
    expect(loweredPose(snap.history.at(-1)!)).toEqual({ key: "cpu", rotationDeg: 0, offsetMm: [1.5, -1] });
    const undone = undoSimpleStep(snap)!;
    expect(undone.history).toEqual(snap.history.slice(0, -1));
    const board = simpleBuildFromSnapshot(undone).parts.find((p) => p.instanceId === "motherboard-2")!;
    expect(board.mechanisms).toMatchObject({ "cpu-socket-plate": "open", "cpu-socket-plate:lever": "open", "cpu-socket-plate:cover": "closed" });
    // A pose that could not have been lowered is not a valid save.
    expect(parseSimpleSnapshot({ ...snap, history: [...snap.history.slice(0, -1), "lower:cpu:0:9:0"] })).toBeNull();
    expect(parseSimpleSnapshot({ ...snap, history: [...snap.history.slice(0, -1), "lower:cpu:45:0:0"] })).toBeNull();
  });

  it("says what was undone for every kind of step, never a raw key", async () => {
    const { undoLine } = await import("./companion");
    const en = (await import("../../messages/en/labs.json")).default as { simplePc: { companion: { undo: Record<string, string> } } };
    const lines = ["lower:cpu:0:1.5:-1", "lower:cpu", "mech:cpu-socket-plate:lever:open", "mech:cpu-socket-plate:open", "mech:dimm-a2-latch:open", "mech:slot-covers:open", "part:cpu", "cable:atx", "seat:ram", "lift:cpu", "fasten:gpu", "unfasten:gpu", "prep:cooler:paste:applied", "place:cooler", "screw:cooler:0", "weird:thing"].map(undoLine);
    expect(lines.map((l) => l.key)).toEqual(["undo.lower", "undo.lower", "undo.lever", "undo.plate", "undo.latch", "undo.covers", "undo.part", "undo.cable", "undo.seat", "undo.lift", "undo.fasten", "undo.unfasten", "undo.prep", "undo.place", "undo.screw", "undo.step"]);
    for (const l of lines) expect(en.simplePc.companion.undo[l.key.slice(5)]).toBeTruthy();
    expect(lines[0]!.values).toEqual({ part: expect.anything() });
    expect(JSON.stringify(lines)).not.toContain("cables");
  });

  it("accepts the CPU only the right way round: 90°, 180° and 270° are refused", () => {
    let s = createSimpleBuild();
    s = (setSimpleMechanism(s, "cpu-socket-plate:lever", "open") as { state: typeof s }).state;
    s = (setSimpleMechanism(s, "cpu-socket-plate", "open") as { state: typeof s }).state;
    for (const deg of [90, 180, 270]) expect(lowerSimplePart(s, "cpu", { rotationDeg: deg, offsetMm: [0, 0] })).toMatchObject({ ok: false, reason: "turnPart" });
    expect(lowerSimplePart(s, "cpu", { rotationDeg: 0, offsetMm: [2, 1] }).ok).toBe(true);
  });
});
