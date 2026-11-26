import { afterEach, describe, expect, it } from "vitest";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import { planModel, parsePlannedBuild, rebaseProgress, snapshotFromHistory, type PlannedBuild } from "./plan-model";
import {
  activateSimpleModel, connectSimpleCable, createSimpleBuild, emptySimpleSnapshot, installSimplePart, LEGACY_MODEL, parseSimpleSnapshot, SIMPLE_PARTS, simplePartOrder,
  simpleAssemblyComplete, simpleBuildFromSnapshot, simpleCablesFor, simpleRuleBlock, startSimplePC, withCable, withPart, type SimpleSnapshot,
  actualEndPort, plugSimpleEnd, simpleCableEnds, simpleCableConnected, simplePortChoices, unplugSimpleEnd, undoSimpleStep, withPlug, withUnplug,
} from "./simple-model";

const build = (parts: pc.BuildPlan): PlannedBuild => ({ version: 1, purpose: "gaming", workload: "1080p", parts });
const gaming: pc.BuildPlan = {
  case: "corsair-4000d-airflow-black",
  motherboard: "asus-tuf-gaming-z790-plus-wifi",
  cpu: "intel-core-i5-14600k",
  cooler: "arctic-freezer-36",
  psu: "corsair-rm850x-atx31",
  gpu: "asus-dual-rtx5060-o8g",
  ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 },
  storage: ["samsung-990-pro-1tb", "seagate-barracuda-2tb-st2000dm008"],
  fans: ["arctic-p12-pwm-pst"],
};
const legacyDdr3: pc.BuildPlan = {
  case: "fractal-pop-mini-air-rgb-black-tg",
  motherboard: "asus-h81m-k",
  cpu: "intel-core-i5-4590",
  cooler: "arctic-freezer-7-x",
  psu: "corsair-rm650e-2025",
  gpu: null,
  ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 },
  storage: ["samsung-870-evo-1tb"],
  fans: [],
};

/** Fits every part in the model's own order, connects every lead, then presses power. */
function assembleAll() {
  let state = createSimpleBuild();
  let snapshot: SimpleSnapshot = emptySimpleSnapshot();
  for (const key of simplePartOrder(state)) { const p = { key };
    const r = installSimplePart(state, p.key);
    if (!r.ok) throw new Error(`${p.key}: ${r.reason}`);
    state = r.state;
    snapshot = withPart(snapshot, p.key);
  }
  for (const c of simpleCablesFor(state)) {
    const r = connectSimpleCable(state, c.key);
    if (!r.ok) throw new Error(`${c.key}: ${r.reason}`);
    state = r.state;
    snapshot = withCable(snapshot, c.key);
  }
  return { state, snapshot };
}

afterEach(() => activateSimpleModel(LEGACY_MODEL));

describe("assembly of a planned build", () => {
  it("assembles a planned gaming build with an M.2 drive, a 3.5-inch drive on SATA and an extra fan, and starts", () => {
    expect(pc.checkPlan(gaming, pcCatalog).ready).toBe(true);
    activateSimpleModel(planModel(build(gaming)));
    const keys = SIMPLE_PARTS.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["cpu", "ram", "ram2", "storage", "storage2", "cooler", "motherboard", "gpu", "psu", "fan1"]));
    const { state } = assembleAll();
    // Modular PSU: each lead is in a PSU socket as well as in its part.
    const atx = state.cables.find((c) => c.id.endsWith(".atx24"))!;
    expect(Object.values(atx.ends).every((e) => e !== null)).toBe(true);
    expect(simpleAssemblyComplete(state)).toBe(true);
    const r = startSimplePC(state);
    expect(r.startup.outcome).toBe("operational");
    expect(r.ok).toBe(true);
  });

  it("assembles the legacy DDR3 route on its own platform without a graphics card", () => {
    expect(pc.checkPlan(legacyDdr3, pcCatalog).ready).toBe(true);
    activateSimpleModel(planModel(build(legacyDdr3)));
    const { state } = assembleAll();
    const r = startSimplePC(state);
    expect(r.startup.outcome).toBe("operational");
  });

  it("puts the pump on CPU_OPT on a board without AIO_PUMP, and keeps the radiator's fans out of the way", () => {
    const plan = { ...gaming, motherboard: "asus-prime-b760m-a-wifi", cooler: "arctic-liquid-freezer-iii-280", storage: ["samsung-990-pro-1tb"], fans: [] };
    activateSimpleModel(planModel(build(plan)));
    const { state } = assembleAll();
    const pump = simpleCablesFor(state).find((c) => c.key === "aioPump")!;
    expect(pump.portId).toBe("cpu-opt");
    expect(startSimplePC(state).startup.outcome).toBe("operational");
  });

  it("applies the exercise rule to a planned i9 with an air cooler, and not with a liquid one", () => {
    const air = { ...gaming, cpu: "intel-core-i9-14900k" };
    activateSimpleModel(planModel(build(air)));
    expect(simpleRuleBlock(assembleAll().state)).toBe("needsLiquidCooler");
    activateSimpleModel(planModel(build({ ...air, cooler: "arctic-liquid-freezer-iii-280" })));
    expect(simpleRuleBlock(assembleAll().state)).toBeNull();
  });

  it("saves as version 4 with its plan and restores only under the same model", () => {
    activateSimpleModel(planModel(build(gaming)));
    const { snapshot } = assembleAll();
    expect(snapshot.version).toBe(4);
    const parsed = parseSimpleSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed?.history).toEqual(snapshot.history);
    expect(simpleAssemblyComplete(simpleBuildFromSnapshot(parsed!))).toBe(true);
    activateSimpleModel(LEGACY_MODEL);
    expect(parseSimpleSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBeNull();
  });

  it("replacing a part undoes only what it affects", () => {
    const before = planModel(build(gaming));
    activateSimpleModel(before);
    const { snapshot } = assembleAll();
    // A different card: the card and its power lead come out; everything else stays.
    const gpuSwap = planModel(build({ ...gaming, gpu: "asus-dual-rtx4060-o8g" }));
    const r = rebaseProgress(snapshot, before, gpuSwap);
    expect(r.changed).toEqual(["gpu"]);
    activateSimpleModel(gpuSwap);
    const next = snapshotFromHistory(r.history);
    expect(snapshot.history.filter((s) => !next.history.includes(s))).toEqual(["part:gpu", "cable:gpuPower"]);
    // A different CPU: the CPU, the cooler on it and the cooler's lead; the board stays in the case.
    const cpuSwap = planModel(build({ ...gaming, cpu: "intel-core-i7-14700k" }));
    const c = rebaseProgress(snapshot, before, cpuSwap);
    activateSimpleModel(cpuSwap);
    const afterCpu = snapshotFromHistory(c.history);
    expect(snapshot.history.filter((s) => !afterCpu.history.includes(s)).sort()).toEqual(["cable:cpuFan", "part:cooler", "part:cpu"]);
    expect(afterCpu.placed).toContain("motherboard");
  });

  it("adding a drive or a RAM kit keeps every lead whose ends did not move", () => {
    const before = planModel(build(gaming));
    activateSimpleModel(before);
    const { snapshot } = assembleAll();
    const more = planModel(build({ ...gaming, storage: [...gaming.storage!, "samsung-870-evo-1tb"], ram: { id: gaming.ram!.id, modules: 4 } }));
    const r = rebaseProgress(snapshot, before, more);
    activateSimpleModel(more);
    const next = snapshotFromHistory(r.history);
    expect(snapshot.history.filter((s) => !next.history.includes(s))).toEqual([]);
  });

  it("keeps hands-on CPU steps (lever, lowering) when an unrelated part changes", () => {
    const before = planModel(build(gaming));
    activateSimpleModel(before);
    const history = ["mech:cpu-socket-plate:lever:open", "mech:cpu-socket-plate:open", "lower:cpu", "mech:cpu-socket-plate:closed", "mech:cpu-socket-plate:lever:closed", "mech:dimm-a2-latch:open", "lower:ram"];
    const kept = snapshotFromHistory(history);
    expect(kept.history).toEqual(history);
    const after = planModel(build({ ...gaming, gpu: "asus-dual-rtx4060-o8g" }));
    const r = rebaseProgress(kept, before, after);
    activateSimpleModel(after);
    expect(snapshotFromHistory(r.history).history).toEqual(history);
    // A different board takes its levers and latches with it.
    const board = planModel(build({ ...gaming, motherboard: "asus-tuf-gaming-z790-plus-wifi-d4", ram: { id: "corsair-vengeance-lpx-ddr4-3600-16gb-kit", modules: 2 } }));
    expect(rebaseProgress(kept, before, board).history).toEqual([]);
  });

  it("parses a saved plan and drops unknown part IDs", () => {
    const p = parsePlannedBuild({ version: 1, purpose: "creator", workload: "video4k", parts: { ...gaming, gpu: "not-a-part", fans: ["arctic-p12-pwm-pst", 7] } });
    expect(p?.parts.gpu).toBeNull();
    expect(p?.parts.fans).toEqual(["arctic-p12-pwm-pst"]);
    expect(parsePlannedBuild({ version: 2 })).toBeNull();
  });
});

describe("hands-on cables", () => {
  it("plugs a modular lead end by end: the PSU socket, then the device; wrong sockets and reversed plugs are refused", async () => {
    const { plugSimpleEnd, simpleCableEnds, simplePortChoices, simpleCableConnected } = await import("./simple-model");
    activateSimpleModel(planModel(build(gaming)));
    let state = createSimpleBuild();
    for (const key of simplePartOrder(state)) { const r = installSimplePart(state, key); if (r.ok) state = r.state; }
    const ends = simpleCableEnds("cpuPower");
    expect(ends.length).toBeGreaterThan(1);
    const psuEnd = ends[0]!;
    expect(plugSimpleEnd(state, "cpuPower", 0, psuEnd.portId, true)).toMatchObject({ ok: false, reason: "reversed" });
    const r1 = plugSimpleEnd(state, "cpuPower", 0, psuEnd.portId, false);
    if (!r1.ok) throw new Error(JSON.stringify(r1));
    state = r1.state;
    const device = ends.at(-1)!;
    const wrong = simplePortChoices(state, device).find((c) => !c.fits);
    expect(wrong).toBeDefined();
    expect(plugSimpleEnd(state, "cpuPower", ends.length - 1, wrong!.portId, false)).toMatchObject({ ok: false, reason: "wrongPort" });
    const r2 = plugSimpleEnd(state, "cpuPower", ends.length - 1, device.portId, false);
    if (!r2.ok) throw new Error(JSON.stringify(r2));
    expect(simpleCableConnected(r2.state, "cpuPower")).toBe(true);
    activateSimpleModel(LEGACY_MODEL);
  });
});

describe("cable endpoint persistence", () => {
  function unwired(parts: pc.BuildPlan = gaming) {
    activateSimpleModel(planModel(build(parts)));
    return snapshotFromHistory(assembleAll().snapshot.history.filter((step) => !step.startsWith("cable:")));
  }

  function dataEnd(snapshot: SimpleSnapshot) {
    const state = simpleBuildFromSnapshot(snapshot);
    const cable = simpleCablesFor(state).find((c) => c.key.startsWith("sataData"))!;
    const ends = simpleCableEnds(cable.key);
    const index = ends.findIndex((e) => e.instanceId === cable.instanceId);
    const end = ends[index]!;
    const alternate = simplePortChoices(state, end).find((p) => p.fits && !p.occupied && p.portId !== end.portId)!;
    expect(alternate).toBeDefined();
    return { state, key: cable.key, ends, index, end, port: alternate.portId };
  }

  it("reloads the actual equivalent SATA port instead of silently changing it to the preferred port", () => {
    const snapshot = unwired();
    const { state, key, index, end, port } = dataEnd(snapshot);
    expect(plugSimpleEnd(state, key, index, port, false).ok).toBe(true);
    const saved = withPlug(snapshot, key, index, port);
    const restored = parseSimpleSnapshot(JSON.parse(JSON.stringify(saved)))!;
    expect(restored).not.toBeNull();
    expect(actualEndPort(simpleBuildFromSnapshot(restored), end)).toBe(port);
  });

  it("rejects invalid endpoint saves instead of replaying an unknown cable, endpoint or socket", () => {
    const snapshot = unwired();
    const { key, index } = dataEnd(snapshot);
    for (const step of [`plug:missing-lead:0`, `plug:${key}:99`, `plug:${key}:${index}@missing-port`, `unplug:${key}:${index}@sata-1`, `plug:${key}:${index}@`]) {
      expect(parseSimpleSnapshot({ ...snapshot, history: [...snapshot.history, step] }), step).toBeNull();
    }
  });

  it("unplugs only one end and undo restores that end to its actual socket", () => {
    const snapshot = unwired();
    const { key, ends, index, end, port } = dataEnd(snapshot);
    const otherIndex = index === 0 ? 1 : 0;
    const other = ends[otherIndex]!;
    const wired = withPlug(withPlug(snapshot, key, otherIndex, other.portId), key, index, port);
    expect(simpleCableConnected(simpleBuildFromSnapshot(wired), key)).toBe(true);
    const removed = withUnplug(wired, key, index);
    const after = simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify(removed)))!);
    expect(actualEndPort(after, end)).toBeNull();
    expect(actualEndPort(after, other)).toBe(other.portId);
    expect(removed.connected).not.toContain(key);
    const undone = simpleBuildFromSnapshot(undoSimpleStep(removed)!);
    expect(actualEndPort(undone, end)).toBe(port);
    expect(simpleCableConnected(undone, key)).toBe(true);
  });

  it("takes one end out of a lead saved whole (old cable step), keeping the other end and the lead's history", () => {
    const snapshot = unwired();
    const { key, ends, index, end } = dataEnd(snapshot);
    const whole = withCable(snapshot, key);
    expect(whole.connected).toContain(key);
    const removed = withUnplug(whole, key, index);
    // The lead's whole-lead step stays; only the one end is out, and a reload agrees.
    expect(removed.history).toEqual([...whole.history, `unplug:${key}:${index}`]);
    const after = simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify(removed)))!);
    expect(actualEndPort(after, end)).toBeNull();
    expect(ends.filter((e) => e !== end).every((e) => actualEndPort(after, e) !== null)).toBe(true);
    expect(removed.connected).not.toContain(key);
    expect(simpleCableConnected(simpleBuildFromSnapshot(undoSimpleStep(removed)!), key)).toBe(true);
  });

  it("removes an end of a partly connected lead, then the other, without touching unrelated leads", () => {
    const snapshot = unwired();
    const { key, ends, index } = dataEnd(snapshot);
    const otherIndex = index === 0 ? 1 : 0;
    const atx = snapshot.history.length;
    const partly = withPlug(withCable(snapshot, "atx"), key, otherIndex, ends[otherIndex]!.portId);
    const first = withUnplug(partly, key, otherIndex);
    const state = simpleBuildFromSnapshot(first);
    expect(actualEndPort(state, ends[otherIndex]!)).toBeNull();
    expect(simpleCableConnected(state, "atx")).toBe(true);
    expect(first.history.length).toBe(atx + 3);
    expect(unplugSimpleEnd(state, key, otherIndex)).toMatchObject({ ok: false, reason: "notPlugged" });
  });

  it("records a fault build's end removal in its own trail and rejects an unplug of an unplugged end on replay", () => {
    const snapshot = unwired();
    const { key, index } = dataEnd(snapshot);
    const trail = withUnplug({ ...emptySimpleSnapshot(), history: [] }, key, index).history;
    expect(trail).toEqual([`unplug:${key}:${index}`]);
    expect(() => simpleBuildFromSnapshot({ ...snapshot, history: [...snapshot.history, `unplug:${key}:${index}`], placed: snapshot.placed, connected: snapshot.connected })).toThrow();
  });

  it("lights every free equivalent socket for the end being plugged and points the robot at the actual socket", async () => {
    const { simpleSceneTargets } = await import("./simple-scene");
    const { simpleEndSocket } = await import("./simple-model");
    const snapshot = unwired();
    const { state, key, ends, index, end, port } = dataEnd(snapshot);
    // The drive side of the data lead goes in first (the board end is active only after it).
    const first = ends.findIndex((e) => e.instanceId !== end.instanceId);
    const targets = simpleSceneTargets(state, { kind: "cable", key }).filter((t) => t.role === "target");
    expect(targets.every((t) => t.hostInstanceId === ends[first]!.instanceId)).toBe(true);
    const wired = simpleBuildFromSnapshot(withPlug(snapshot, key, first, ends[first]!.portId));
    const boardTargets = simpleSceneTargets(wired, { kind: "cable", key }).filter((t) => t.role === "target").map((t) => t.placeId);
    expect(boardTargets).toContain(end.portId);
    expect(boardTargets).toContain(port);
    // Once in an alternate socket, the socket to point at is that one, not the planned one.
    const placed = simpleBuildFromSnapshot(withPlug(withPlug(snapshot, key, first, ends[first]!.portId), key, index, port));
    expect(simpleSceneTargets(placed, { kind: "cable", key })).toEqual([]);
    expect(simpleEndSocket(placed, end)).toBe(port);
  });

  it("keeps old endpoint saves readable and preserves actual ports when an unrelated fan is added", () => {
    const snapshot = unwired();
    const { key, index, end, port } = dataEnd(snapshot);
    const old = withPlug(snapshot, key, index);
    expect(actualEndPort(simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify(old)))!), end)).toBe(end.portId);
    const from = planModel(build(gaming));
    const next = planModel(build({ ...gaming, fans: [...gaming.fans!, "arctic-p12-pwm-pst"] }));
    const rebased = rebaseProgress(withPlug(snapshot, key, index, port), from, next);
    activateSimpleModel(next);
    expect(actualEndPort(simpleBuildFromSnapshot(snapshotFromHistory(rebased.history)), end)).toBe(port);
  });

  it("still refuses an equivalent socket already used by another drive and a reversed plug", () => {
    const snapshot = unwired({ ...gaming, storage: ["seagate-barracuda-2tb-st2000dm008", "samsung-870-evo-1tb"] });
    const { state, key, index, end, port } = dataEnd(snapshot);
    expect(plugSimpleEnd(state, key, index, port, true)).toMatchObject({ ok: false, reason: "reversed" });
    const first = plugSimpleEnd(state, key, index, port, false);
    if (!first.ok) throw new Error(first.reason);
    const second = simpleCablesFor(first.state).find((c) => c.key.startsWith("sataData") && c.key !== key)!;
    const secondIndex = simpleCableEnds(second.key).findIndex((e) => e.instanceId === end.instanceId);
    expect(plugSimpleEnd(first.state, second.key, secondIndex, port, false)).toMatchObject({ ok: false, reason: "wrongPort" });
  });

  it("requires power off before taking an endpoint out", () => {
    const snapshot = unwired();
    const { key, index, port } = dataEnd(snapshot);
    let state = simpleBuildFromSnapshot(withPlug(snapshot, key, index, port));
    for (const action of [{ type: "set_wall_power", connected: true }, { type: "set_psu_switch", on: true }, { type: "press_power" }] as const) {
      const result = pc.applyAction(state, action, pcCatalog);
      if (!result.ok) throw new Error(result.rejection.message.en);
      state = result.state;
    }
    expect(unplugSimpleEnd(state, key, index)).toMatchObject({ ok: false, reason: "turnOffFirst" });
  });

  it("explains endpoint undo steps in both languages, including the new actual-port format", async () => {
    const snapshot = unwired();
    const { key, index, port } = dataEnd(snapshot);
    const { undoLine } = await import("./companion");
    const lines = [undoLine(`plug:${key}:${index}@${port}`), undoLine(`unplug:${key}:${index}`)];
    expect(lines.map((l) => l.key)).toEqual(["undo.plug", "undo.unplug"]);
    for (const messages of [(await import("../../messages/en/labs.json")).default, (await import("../../messages/ar/labs.json")).default]) {
      const undo = messages.simplePc.companion.undo as Record<string, string>;
      for (const line of lines) expect(undo[line.key.slice(5)]).toBeTruthy();
    }
  });
});
