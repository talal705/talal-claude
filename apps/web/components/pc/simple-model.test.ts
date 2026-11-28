import { describe, expect, it } from "vitest";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import {
  connectSimpleCable, createSimpleBuild, disconnectSimpleCable, emptySimpleSnapshot, installSimplePart, lastSimpleStep, parseSimpleSnapshot, RAM_SLOTS,
  SIMPLE_CABLES, SIMPLE_PARTS, simpleAssemblyComplete, simpleBlock, simpleBuildFromSnapshot, simpleCableConnected, simpleCablesFor, simplePartInstalled,
  simpleRemoveBlock, simpleSwapBlock, simpleTarget, startSimplePC, pressSimplePower, setSimpleSystem, withSimpleStep, undoSimpleStep, withCable, withoutCable, withoutPart, withPart, withSwap, type SimpleCableKey, type SimplePartKey, type SimpleSnapshot,
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
function snapshotOf(parts: readonly SimplePartKey[], cables: readonly SimpleCableKey[] = [], powered = false): SimpleSnapshot {
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
    // The CPU and cooler alternatives come after every earlier part.
    expect(ids.slice(-3)).toEqual(["ram-11", "cpu-12", "cooling-13"]);
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

describe("the CPU and cooler alternatives", () => {
  const LIQUID_PARTS: SimplePartKey[] = ["cpu2", "ram", "ram2", "storage", "motherboard", "aio", "gpu", "psu"];
  const LIQUID_CABLES = ["atx", "cpuPower", "gpuPower", "aioPump", "aioFan", "powerSwitch", "caseFan1", "caseFan2"] as const;
  function built(parts: readonly SimplePartKey[], skip: readonly string[] = []) {
    let state = createSimpleBuild();
    for (const key of parts) {
      const step = installSimplePart(state, key);
      if (!step.ok) throw new Error(`${key}: ${step.reason}`);
      state = step.state;
    }
    for (const cable of simpleCablesFor(state).filter((c) => !skip.includes(c.key))) {
      if (!parts.includes("psu") || !parts.includes("gpu")) break;
      const step = connectSimpleCable(state, cable.key);
      if (!step.ok) throw new Error(`${cable.key}: ${step.reason}`);
      state = step.state;
    }
    return state;
  }

  it("keeps one CPU in the socket and one cooler on it", () => {
    const state = built(["cpu"]);
    expect(installSimplePart(state, "cpu2")).toMatchObject({ ok: false, reason: "socketTaken" });
    const air = built(["cpu", "cooler"]);
    expect(simpleBlock(air, "aio")).toBe("coolerTaken");
    const liquid = built(["cpu2", "ram", "ram2", "storage", "motherboard", "aio"]);
    expect(installSimplePart(liquid, "cooler")).toMatchObject({ ok: false, reason: "coolerTaken" });
    expect(installSimplePart(liquid, "cpu")).toMatchObject({ ok: false, reason: "socketTaken" });
  });

  it("fits the liquid cooler after the board is in the case: block on the CPU, radiator in front, case fans to the top", () => {
    const early = built(["cpu2", "ram", "ram2", "storage"]);
    expect(installSimplePart(early, "aio")).toMatchObject({ ok: false, reason: "boardFirst" });
    expect(installSimplePart(createSimpleBuild(), "aio")).toMatchObject({ ok: false, reason: "cpuFirst" });
    const state = built(["cpu2", "ram", "ram2", "storage", "motherboard", "aio"]);
    const aio = state.parts.find((p) => p.instanceId === "cooling-13")!;
    expect(aio.attachments.map((a) => [a.role, a.target.hostInstanceId, a.target.mountPointId, a.seating])).toEqual([
      ["block", "motherboard-2", "cooler-mount", "seated"],
      ["radiator", "case-1", "rad-front", "seated"],
    ]);
    // The case's own front fan moves up; its rear fan (a supplied fan at the rear, per Corsair) stays where it is.
    expect(state.parts.filter((p) => p.instanceId === "fan-9" || p.instanceId === "fan-10").map((p) => p.attachments[0]!.target.mountPointId)).toEqual(["fan-top-1", "fan-rear-1"]);
    expect(simpleCablesFor(state).map((c) => c.key)).toEqual(["atx", "cpuPower", "gpuPower", "powerSwitch", "caseFan1", "caseFan2", "aioPump", "aioFan"]);
  });

  it("starts the original i5 build with the air cooler, exactly as before", () => {
    const result = startSimplePC(wired());
    expect(result.ok).toBe(true);
    expect(result.rule).toBeNull();
    expect(result.startup.observable.spinning).toContain("cooling-6");
  });

  it("refuses to start the Core i9 on the air cooler (a lab rule), then starts it on the liquid cooler with both radiator fans turning", () => {
    const air = startSimplePC(built(["cpu2", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"]));
    expect(air.ok).toBe(false);
    expect(air.rule).toBe("needsLiquidCooler");
    // The engine itself would pass this build: the rule is the lab's, for this CPU only.
    expect(air.startup.outcome).toBe("operational");
    expect(air.state.power.pressed).toBe(false);
    const liquid = startSimplePC(built(LIQUID_PARTS));
    expect(liquid.ok).toBe(true);
    expect(liquid.rule).toBeNull();
    expect(liquid.startup.observable.spinning).toEqual(expect.arrayContaining(["cooling-13", "fan-9", "fan-10"]));
    expect(simpleAssemblyComplete(liquid.state)).toBe(true);
  });

  it.each(["aioPump", "aioFan"])("fails without the liquid cooler's %s lead, then starts once it is connected", (key) => {
    const failed = startSimplePC(built(LIQUID_PARTS, [key]));
    expect(failed.ok).toBe(false);
    expect(failed.rule).toBeNull();
    const fixed = connectSimpleCable(failed.state, key as "aioPump");
    expect(fixed.ok).toBe(true);
    if (fixed.ok) expect(startSimplePC(fixed.state).ok).toBe(true);
  });

  it("also runs the i5 on the liquid cooler", () => {
    expect(startSimplePC(built(["cpu", "ram", "ram2", "storage", "motherboard", "aio", "gpu", "psu"])).ok).toBe(true);
  });

  it("swaps parts: the cooler comes off before the CPU, and its leads are unplugged first", () => {
    const state = built(["cpu2", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"]);
    expect(simpleSwapBlock(state, "cpu")).toBe("removeCoolerFirst");
    expect(simpleSwapBlock(state, "aio")).toBe("unplugCoolerFirst");
    expect(simpleRemoveBlock(state, "cooler")).toBe("unplugCoolerFirst");
    expect(simpleRemoveBlock(state, "gpu")).toBe("notSwappable");
    // From the i9 on air to the i9 on liquid, the way a learner does it: unplug, swap coolers, plug in.
    let snapshot = snapshotOf(["cpu2", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"], ALL_CABLES);
    snapshot = withoutCable(snapshot, "cpuFan");
    expect(simpleSwapBlock(simpleBuildFromSnapshot(snapshot), "aio")).toBeNull();
    snapshot = withSwap(snapshot, "cooler", "aio");
    snapshot = withCable(withCable(snapshot, "aioPump"), "aioFan");
    expect(startSimplePC(simpleBuildFromSnapshot(snapshot)).ok).toBe(true);
    // Back to the i5 on air, with the board in the case: leads out, cooler out, CPU swapped in its place, air cooler on.
    snapshot = withoutCable(withoutCable(snapshot, "aioPump"), "aioFan");
    snapshot = withoutPart(snapshot, "aio");
    expect(simpleSwapBlock(simpleBuildFromSnapshot(snapshot), "cpu")).toBeNull();
    snapshot = withSwap(snapshot, "cpu2", "cpu");
    expect(snapshot.history[0]).toBe("part:cpu");
    snapshot = withCable(withPart(snapshot, "cooler"), "cpuFan");
    expect(parseSimpleSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    const back = simpleBuildFromSnapshot(snapshot);
    expect(simpleAssemblyComplete(back)).toBe(true);
    expect(back.parts.find((p) => p.instanceId === "fan-9")!.attachments[0]!.target.mountPointId).toBe("fan-front-1");
    expect(startSimplePC(back).ok).toBe(true);
    // Undo still takes steps back newest first through a swapped history.
    let undo: SimpleSnapshot | null = snapshot;
    while (undo && lastSimpleStep(undo)) { undo = undoSimpleStep(undo); expect(() => simpleBuildFromSnapshot(undo!)).not.toThrow(); }
    // A running PC is never taken apart.
    expect(simpleRemoveBlock(startSimplePC(back).state, "cooler")).toBe("turnOffFirst");
  });

  it("saves and restores either build, and refuses a saved 'running' i9 on air", () => {
    const liquid = snapshotOf(LIQUID_PARTS, LIQUID_CABLES, true);
    expect(parseSimpleSnapshot(JSON.parse(JSON.stringify(liquid)))).toEqual(liquid);
    const swapped = withSwap(snapshotOf(["cpu", "ram"]), "cpu", "cpu2");
    expect(parseSimpleSnapshot(JSON.parse(JSON.stringify(swapped)))).toEqual(swapped);
    const airI9 = snapshotOf(["cpu2", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"], ALL_CABLES, true);
    expect(parseSimpleSnapshot(airI9)).toBeNull();
    expect(parseSimpleSnapshot({ ...airI9, powered: false })).toEqual({ ...airI9, powered: false });
    // Two CPUs or two coolers could never have been fitted together.
    expect(parseSimpleSnapshot({ version: 3, placed: ["cpu", "cpu2"], connected: [], history: ["part:cpu", "part:cpu2"], powered: false })).toBeNull();
  });
});

describe("saves from before the readiness steps", () => {
  it("restores a complete running save, and its first power-off needs no step and survives reload", () => {
    const saved = snapshotOf(ALL_PARTS, ALL_CABLES, true);
    expect(saved.history.some((s) => s.startsWith("sys:"))).toBe(false);
    const parsed = parseSimpleSnapshot(JSON.parse(JSON.stringify(saved)))!;
    expect(simpleBuildFromSnapshot(parsed).power).toMatchObject({ pressed: true, wallConnected: true, psuSwitchOn: true });
    // The page's first power-off on such a save clears the flag; replay and reload agree it is off.
    const off = { ...parsed, powered: false };
    expect(simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify(off)))!).power.pressed).toBe(false);
    // Starting again is now the learner's own steps and button, recorded as such.
    let again = off;
    for (const step of ["sys:panel:closed", "sys:wall:in", "sys:psu:on", "sys:power:on"] as const) again = withSimpleStep(again, step);
    expect(again.powered).toBe(true);
    expect(simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify(again)))!).power.pressed).toBe(true);
  });

  it("refuses a running save whose build does not start", () => {
    expect(parseSimpleSnapshot(snapshotOf(ALL_PARTS, ALL_CABLES.filter((k) => k !== "atx" && k !== "cpuPower"), true))).toBeNull();
  });

  it("presses power on exactly what is there", () => {
    const empty = createSimpleBuild();
    const r = pressSimplePower(empty);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(empty);
    expect(setSimpleSystem(empty, "power", "off")).toMatchObject({ ok: false });
  });
});
