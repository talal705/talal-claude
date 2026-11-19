import { afterEach, describe, expect, it } from "vitest";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import { planModel, parsePlannedBuild, rebaseProgress, snapshotFromHistory, type PlannedBuild } from "./plan-model";
import {
  activateSimpleModel, connectSimpleCable, createSimpleBuild, emptySimpleSnapshot, installSimplePart, LEGACY_MODEL, parseSimpleSnapshot, SIMPLE_PARTS, simplePartOrder,
  simpleAssemblyComplete, simpleBuildFromSnapshot, simpleCablesFor, simpleRuleBlock, startSimplePC, withCable, withPart, type SimpleSnapshot,
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
    const wrong = simplePortChoices(state, device).find((c) => c.portId !== device.portId);
    expect(wrong).toBeDefined();
    expect(plugSimpleEnd(state, "cpuPower", ends.length - 1, wrong!.portId, false)).toMatchObject({ ok: false, reason: "wrongPort" });
    const r2 = plugSimpleEnd(state, "cpuPower", ends.length - 1, device.portId, false);
    if (!r2.ok) throw new Error(JSON.stringify(r2));
    expect(simpleCableConnected(r2.state, "cpuPower")).toBe(true);
    activateSimpleModel(LEGACY_MODEL);
  });
});
