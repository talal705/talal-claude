import { describe, expect, it } from "vitest";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import {
  connectSimpleCable, createSimpleBuild, disconnectSimpleCable, emptySimpleSnapshot, installSimplePart, lastSimpleStep, parseSimpleSnapshot, RAM_SLOTS,
  SIMPLE_CABLES, SIMPLE_PARTS, simpleAssemblyComplete, simpleBuildFromSnapshot, simpleCableConnected, simplePartInstalled, simpleTarget, startSimplePC,
  undoSimpleStep, withCable, withPart, type SimplePartKey, type SimpleSnapshot,
} from "./simple-model";

function fitted() {
  let state = createSimpleBuild();
  for (const part of SIMPLE_PARTS) {
    const step = installSimplePart(state, part.key);
    if (!step.ok) throw new Error(step.reason);
    state = step.state;
  }
  return state;
}
function wired(except?: string) {
  let state = fitted();
  for (const cable of SIMPLE_CABLES.filter((c) => c.key !== except)) {
    const step = connectSimpleCable(state, cable.key);
    if (!step.ok) throw new Error(step.reason);
    state = step.state;
  }
  return state;
}
const slotOf = (state: ReturnType<typeof createSimpleBuild>, instanceId: string) =>
  state.parts.find((p) => p.instanceId === instanceId)?.attachments[0]?.target.mountPointId;
const ALL_PARTS = SIMPLE_PARTS.map((p) => p.key);
const ALL_CABLES = SIMPLE_CABLES.map((c) => c.key);
function snapshotOf(parts: readonly SimplePartKey[], cables: readonly (typeof ALL_CABLES)[number][] = [], powered = false): SimpleSnapshot {
  let snapshot = emptySimpleSnapshot();
  for (const key of parts) snapshot = withPart(snapshot, key);
  for (const key of cables) snapshot = withCable(snapshot, key);
  return { ...snapshot, powered };
}

describe("the single-PC page", () => {
  it("has one case and eight learner-installed parts, two of them RAM sticks of the same kit", () => {
    const state = createSimpleBuild();
    expect(SIMPLE_PARTS).toHaveLength(8);
    expect(SIMPLE_PARTS.filter((p) => p.catalogId === "corsair-vengeance-rgb-ddr5-6000-32gb-kit").map((p) => p.id)).toEqual(["ram-4", "ram-11"]);
    expect(state.parts.filter((p) => p.catalogId === "corsair-vengeance-rgb-ddr5-6000-32gb-kit")).toHaveLength(2);
    expect(SIMPLE_PARTS.every((p) => !simplePartInstalled(state, p.key))).toBe(true);
    expect(SIMPLE_CABLES.every((c) => !simpleCableConnected(state, c.key))).toBe(true);
    expect(startSimplePC(state).ok).toBe(false);
  });

  it("keeps every earlier instance ID, so saved builds and cable IDs still match", () => {
    const ids = createSimpleBuild().parts.map((p) => p.instanceId);
    expect(ids).toEqual(expect.arrayContaining(["case-1", "motherboard-2", "cpu-3", "ram-4", "storage-5", "cooling-6", "gpu-7", "psu-8", "fan-9", "fan-10", "ram-11"]));
    expect(ids.indexOf("ram-11")).toBe(ids.length - 1);
  });

  it("uses the board manual's two-module layout, A2 then B2, whichever stick goes in first", () => {
    expect(RAM_SLOTS).toEqual(["dimm-a2", "dimm-b2"]);
    for (const [first, second] of [["ram", "ram2"], ["ram2", "ram"]] as const) {
      let state = createSimpleBuild();
      expect(simpleTarget(state, first).mountPointId).toBe("dimm-a2");
      const a = installSimplePart(state, first);
      if (!a.ok) throw new Error(a.reason);
      state = a.state;
      expect(simpleTarget(state, second).mountPointId).toBe("dimm-b2");
      const b = installSimplePart(state, second);
      if (!b.ok) throw new Error(b.reason);
      state = b.state;
      const firstId = first === "ram" ? "ram-4" : "ram-11";
      const secondId = first === "ram" ? "ram-11" : "ram-4";
      expect(slotOf(state, firstId)).toBe("dimm-a2");
      expect(slotOf(state, secondId)).toBe("dimm-b2");
      expect(simplePartInstalled(state, "ram") && simplePartInstalled(state, "ram2")).toBe(true);
      // Fitting an installed stick again is a no-op, never a third module.
      expect(installSimplePart(state, first)).toEqual({ ok: true, state });
    }
  });

  it("prepares the board outside the case and keeps its parts attached when it moves", () => {
    let state = createSimpleBuild();
    expect(installSimplePart(state, "motherboard")).toMatchObject({ ok: false, reason: "prepareBoard" });
    expect(installSimplePart(state, "cooler")).toMatchObject({ ok: false, reason: "cpuFirst" });
    for (const key of ["cpu", "ram", "storage", "cooler"] as const) {
      const result = installSimplePart(state, key);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    // One stick is not enough: the board waits for the second.
    expect(installSimplePart(state, "motherboard")).toMatchObject({ ok: false, reason: "prepareBoard" });
    const second = installSimplePart(state, "ram2");
    if (!second.ok) throw new Error(second.reason);
    state = second.state;
    const wire = connectSimpleCable(state, "cpuFan");
    expect(wire.ok).toBe(true);
    if (wire.ok) state = wire.state;
    const children = state.parts.filter((p) => p.attachments.some((a) => a.target.hostInstanceId === "motherboard-2"));
    expect(children).toHaveLength(5);
    const board = installSimplePart(state, "motherboard");
    expect(board.ok).toBe(true);
    if (board.ok) {
      expect(board.state.parts.filter((p) => children.some((c) => c.instanceId === p.instanceId))).toEqual(children);
      expect(simpleCableConnected(board.state, "cpuFan")).toBe(true);
    }
  });

  it("does not auto-wire a fully fitted build", () => {
    const result = startSimplePC(fitted());
    expect(result.ok).toBe(false);
    expect(result.state.power.pressed).toBe(false);
    expect(SIMPLE_CABLES.every((c) => !simpleCableConnected(result.state, c.key))).toBe(true);
  });

  it.each(SIMPLE_CABLES.filter((c) => c.essential))("rejects startup when $key alone is missing, then permits repair and retry", ({ key }) => {
    const failed = startSimplePC(wired(key));
    expect(failed.ok).toBe(false);
    expect(failed.state.power.pressed).toBe(false);
    const repaired = connectSimpleCable(failed.state, key);
    expect(repaired.ok).toBe(true);
    if (repaired.ok) expect(startSimplePC(repaired.state).ok).toBe(true);
  });

  it("allows startup without case fan leads, but the assembly is complete only with every lead", () => {
    let state = fitted();
    for (const cable of SIMPLE_CABLES.filter((c) => c.essential)) {
      const result = connectSimpleCable(state, cable.key);
      if (result.ok) state = result.state;
    }
    const result = startSimplePC(state);
    expect(result.ok).toBe(true);
    expect(simpleAssemblyComplete(result.state)).toBe(false);
    expect(result.startup.observable.spinning).toContain("cooling-6");
    expect(result.startup.observable.spinning).not.toContain("fan-9");
    const complete = startSimplePC(wired());
    expect(complete.ok).toBe(true);
    expect(simpleAssemblyComplete(complete.state)).toBe(true);
    expect(complete.startup.observable.spinning).toEqual(expect.arrayContaining(["fan-9", "fan-10"]));
    expect(pc.evaluateStartup(complete.state, pcCatalog).stages.every((s) => s.status === "passed")).toBe(true);
  });

  it("blocks premature or live wiring, allows idempotent connection and deliberate unplugging while off", () => {
    expect(connectSimpleCable(createSimpleBuild(), "gpuPower")).toMatchObject({ ok: false, reason: "fitCableParts" });
    const off = wired();
    expect(connectSimpleCable(off, "atx")).toEqual({ ok: true, state: off });
    const running = startSimplePC(off).state;
    expect(disconnectSimpleCable(running, "atx")).toMatchObject({ ok: false, reason: "turnOffFirst" });
    expect(connectSimpleCable(running, "atx")).toMatchObject({ ok: false, reason: "turnOffFirst" });
    const unplugged = disconnectSimpleCable(off, "atx");
    expect(unplugged.ok).toBe(true);
    if (unplugged.ok) {
      expect(simpleCableConnected(unplugged.state, "atx")).toBe(false);
      expect(startSimplePC(unplugged.state).ok).toBe(false);
    }
  });
});

describe("undo and saved progress", () => {
  it("undoes the newest step first, leaving a valid build each time, and never while the PC is on", () => {
    let snapshot = snapshotOf(["cpu", "ram", "ram2", "storage", "cooler"], ["cpuFan"]);
    snapshot = withPart(snapshot, "motherboard");
    expect(lastSimpleStep(snapshot)).toBe("part:motherboard");
    const order: string[] = [];
    while (lastSimpleStep(snapshot)) {
      order.push(lastSimpleStep(snapshot)!);
      snapshot = undoSimpleStep(snapshot)!;
      expect(() => simpleBuildFromSnapshot(snapshot)).not.toThrow();
    }
    expect(order).toEqual(["part:motherboard", "cable:cpuFan", "part:cooler", "part:storage", "part:ram2", "part:ram", "part:cpu"]);
    expect(snapshot).toEqual(emptySimpleSnapshot());
    expect(undoSimpleStep(snapshot)).toBeNull();
    const running = snapshotOf(ALL_PARTS, ALL_CABLES, true);
    expect(undoSimpleStep(running)).toBeNull();
  });

  it("frees the RAM slot on undo, so the next stick in takes A2 again", () => {
    let snapshot = snapshotOf(["ram2"]);
    expect(slotOf(simpleBuildFromSnapshot(snapshot), "ram-11")).toBe("dimm-a2");
    snapshot = undoSimpleStep(snapshot)!;
    snapshot = withPart(snapshot, "ram");
    expect(slotOf(simpleBuildFromSnapshot(snapshot), "ram-4")).toBe("dimm-a2");
  });

  it("round-trips v3 progress with its history", () => {
    const snapshot = snapshotOf(["cpu", "ram2", "ram"], []);
    expect(parseSimpleSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    const complete = snapshotOf(ALL_PARTS, ALL_CABLES, true);
    expect(parseSimpleSnapshot(complete)).toEqual(complete);
  });

  it("migrates v1 and v2 progress made with one stick, adding the second so the build stays complete", () => {
    const oldParts = ["cpu", "ram", "storage", "cooler", "motherboard", "gpu", "psu"];
    const migrated = parseSimpleSnapshot({ version: 2, placed: oldParts, connected: ALL_CABLES, powered: true })!;
    expect(migrated.placed).toEqual(["cpu", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"]);
    expect(migrated.powered).toBe(true);
    expect(simpleAssemblyComplete(simpleBuildFromSnapshot(migrated))).toBe(true);
    const v1 = parseSimpleSnapshot({ version: 1, placed: ["cpu", "ram"], powered: false })!;
    expect(v1).toEqual(snapshotOf(["cpu", "ram", "ram2"]));
  });

  it("rejects invalid, duplicate and impossible saved parts, wires or histories", () => {
    for (const value of [
      { version: 1, placed: ["motherboard"], powered: false },
      { version: 1, placed: ["cpu", "cpu"], powered: false },
      { version: 1, placed: ["cpu"], powered: true },
      { version: 1, placed: ["other"], powered: false },
      { version: 2, placed: [], connected: ["atx"], powered: false },
      { version: 2, placed: ALL_PARTS, connected: ["atx", "atx"], powered: false },
      { version: 2, placed: [], connected: ["other"], powered: false },
      { version: 2, placed: ALL_PARTS, connected: [], powered: true },
      { version: 3, placed: ["cpu"], connected: [], powered: false },
      { version: 3, placed: ["cpu"], connected: [], history: ["part:ram"], powered: false },
      // A lead before the parts it needs: a history that could never have happened.
      { version: 3, placed: ["cpu", "cooler"], connected: ["cpuFan"], history: ["cable:cpuFan", "part:cpu", "part:cooler"], powered: false },
    ]) expect(parseSimpleSnapshot(value)).toBeNull();
  });
});
