import { describe, expect, it } from "vitest";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import { connectSimpleCable, createSimpleBuild, disconnectSimpleCable, emptySimpleSnapshot, installSimplePart, parseSimpleSnapshot, SIMPLE_CABLES, SIMPLE_PARTS, simpleBuildFromSnapshot, simpleCableConnected, simplePartInstalled, startSimplePC } from "./simple-model";

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

describe("the single-PC page", () => {
  it("has one case and seven learner-installed parts, with no alternatives", () => {
    const state = createSimpleBuild();
    expect(SIMPLE_PARTS).toHaveLength(7);
    expect(new Set(state.parts.filter((p) => !p.catalogId.includes("airguide")).map((p) => p.catalogId)).size).toBe(8);
    expect(SIMPLE_PARTS.every((p) => !simplePartInstalled(state, p.key))).toBe(true);
    expect(SIMPLE_CABLES.every((c) => !simpleCableConnected(state, c.key))).toBe(true);
    expect(startSimplePC(state).ok).toBe(false);
  });

  it("prepares the board outside the case and keeps its parts attached when it moves", () => {
    let state = createSimpleBuild();
    expect(installSimplePart(state, "motherboard")).toMatchObject({ ok:false, reason:"prepareBoard" });
    expect(installSimplePart(state, "cooler")).toMatchObject({ ok:false, reason:"cpuFirst" });
    for (const key of ["cpu","ram","storage","cooler"] as const) {
      const result = installSimplePart(state, key);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    const wire = connectSimpleCable(state, "cpuFan");
    expect(wire.ok).toBe(true);
    if (wire.ok) state = wire.state;
    const children = state.parts.filter((p) => p.attachments.some((a) => a.target.hostInstanceId === "motherboard-2"));
    expect(children).toHaveLength(4);
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

  it.each(SIMPLE_CABLES.filter((c) => c.essential))("rejects startup when $key alone is missing, then permits repair and retry", ({key}) => {
    const failed = startSimplePC(wired(key));
    expect(failed.ok).toBe(false);
    expect(failed.state.power.pressed).toBe(false);
    const repaired = connectSimpleCable(failed.state, key);
    expect(repaired.ok).toBe(true);
    if (repaired.ok) expect(startSimplePC(repaired.state).ok).toBe(true);
  });

  it("allows startup without case fan leads, but only connected fans spin", () => {
    let state = fitted();
    for (const cable of SIMPLE_CABLES.filter((c) => c.essential)) {
      const result = connectSimpleCable(state, cable.key);
      if (result.ok) state = result.state;
    }
    const result = startSimplePC(state);
    expect(result.ok).toBe(true);
    expect(result.startup.observable.spinning).toContain("cooling-6");
    expect(result.startup.observable.spinning).not.toContain("fan-9");
    expect(result.startup.observable.spinning).not.toContain("fan-10");
    const complete = startSimplePC(wired());
    expect(complete.ok).toBe(true);
    expect(complete.startup.observable.spinning).toEqual(expect.arrayContaining(["fan-9", "fan-10"]));
    expect(pc.evaluateStartup(complete.state, pcCatalog).stages.every((s) => s.status === "passed")).toBe(true);
  });

  it("blocks premature or live wiring, allows idempotent connection and deliberate unplugging while off", () => {
    expect(connectSimpleCable(createSimpleBuild(), "gpuPower")).toMatchObject({ok:false, reason:"fitCableParts"});
    const off = wired();
    expect(connectSimpleCable(off, "atx")).toEqual({ok:true, state:off});
    const running = startSimplePC(off).state;
    expect(disconnectSimpleCable(running, "atx")).toMatchObject({ok:false, reason:"turnOffFirst"});
    expect(connectSimpleCable(running, "atx")).toMatchObject({ok:false, reason:"turnOffFirst"});
    const unplugged = disconnectSimpleCable(off, "atx");
    expect(unplugged.ok).toBe(true);
    if (unplugged.ok) {
      expect(simpleCableConnected(unplugged.state, "atx")).toBe(false);
      expect(startSimplePC(unplugged.state).ok).toBe(false);
    }
  });

  it("round-trips explicit connections and migrates v1 progress without losing a running build", () => {
    const placed = SIMPLE_PARTS.map((p) => p.key);
    const complete = {version:2 as const, placed, connected:SIMPLE_CABLES.map((c) => c.key), powered:true};
    expect(parseSimpleSnapshot(complete)).toEqual(complete);
    expect(parseSimpleSnapshot({version:1, placed, powered:true})).toEqual(complete);
    const partial = {...emptySimpleSnapshot(), placed:["cpu","ram"]};
    expect(parseSimpleSnapshot({version:1, placed:partial.placed, powered:false})).toEqual(partial);
    const snapshot = {...complete, powered:false, connected:["cpuFan"]};
    const restored = parseSimpleSnapshot(snapshot)!;
    expect(restored).toEqual(snapshot);
    expect(simpleCableConnected(simpleBuildFromSnapshot(restored), "cpuFan")).toBe(true);
    expect(simpleCableConnected(simpleBuildFromSnapshot(restored), "atx")).toBe(false);
  });

  it("rejects invalid, duplicate and impossible saved parts or wires", () => {
    for (const value of [
      { version:1, placed:["motherboard"], powered:false },
      { version:1, placed:["cpu","cpu"], powered:false },
      { version:1, placed:["cpu"], powered:true },
      { version:1, placed:["other"], powered:false },
      { version:2, placed:[], connected:["atx"], powered:false },
      { version:2, placed:SIMPLE_PARTS.map((p) => p.key), connected:["atx","atx"], powered:false },
      { version:2, placed:[], connected:["other"], powered:false },
      { version:2, placed:SIMPLE_PARTS.map((p) => p.key), connected:[], powered:true },
    ]) expect(parseSimpleSnapshot(value)).toBeNull();
  });
});
