// Stages 5–9: a board, power supply, SATA drive or case fan goes in by placing, then one screw per step,
// and comes out by one screw per step, then lifting. Positions are the learner's choice.
import { afterEach, describe, expect, it } from "vitest";
import type { pc } from "@ytl/simulation";
import { guideFocus } from "./guide";
import { simpleSceneTargets } from "./simple-scene";
import { planModel, rebaseProgress, snapshotFromHistory, type PlannedBuild } from "./plan-model";
import {
  activateSimpleModel, applySimpleStep, createSimpleBuild, firstAttachment, LEGACY_MODEL, parseSimpleSnapshot, placeSimplePart, simpleBlock, simpleBuildFromSnapshot,
  clearRadiatorFans, placeRadiator, simpleCableConnected, simpleRadiatorCover, simpleLiftBlock, simpleOrientationAdvice, simplePartInstalled, simplePositions, simpleRequiredScrews, withSimpleStep, emptySimpleSnapshot, type SimpleSnapshot, type SimpleStep,
} from "./simple-model";

const plan = (over: Partial<pc.BuildPlan> = {}): PlannedBuild => ({
  version: 1, purpose: "gaming", workload: "1080p",
  parts: {
    case: "corsair-4000d-airflow-black", motherboard: "asus-tuf-gaming-z790-plus-wifi", cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm850x-atx31",
    gpu: "asus-dual-rtx5060-o8g", ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 },
    storage: ["samsung-990-pro-1tb", "seagate-barracuda-2tb-st2000dm008", "samsung-870-evo-1tb"], fans: ["arctic-p12-pwm-pst"], ...over,
  },
});

/** Replays steps on the active model, saving them the way the page does. */
function steps(...list: SimpleStep[]) {
  let snapshot: SimpleSnapshot = emptySimpleSnapshot();
  for (const step of list) { applySimpleStep(simpleBuildFromSnapshot(snapshot), step); snapshot = withSimpleStep(snapshot, step); }
  return { snapshot, state: simpleBuildFromSnapshot(snapshot) };
}
const screws = (key: string, n: number): SimpleStep[] => Array.from({ length: n }, (_, i) => `screw:${key}:${i}` as SimpleStep);
const unscrews = (key: string, n: number): SimpleStep[] => Array.from({ length: n }, () => `unscrew:${key}` as SimpleStep);

afterEach(() => activateSimpleModel(LEGACY_MODEL));

describe("power supply (stage 6)", () => {
  it("needs no motherboard: it is placed and screwed in an empty case", () => {
    activateSimpleModel(planModel(plan()));
    const empty = createSimpleBuild();
    expect(simpleBlock(empty, "psu")).toBeNull();
    const { state } = steps("prep:psu:psu_fan:down", "place:psu", ...screws("psu", 4));
    expect(simplePartInstalled(state, "psu")).toBe(true);
    expect(simplePartInstalled(state, "motherboard")).toBe(false);
  });

  it("accepts either fan direction (Corsair: it changes airflow, not fit), needs a choice, and only advises fan-down over a filtered vent", () => {
    activateSimpleModel(planModel(plan()));
    const start = createSimpleBuild();
    expect(placeSimplePart(start, "psu")).toMatchObject({ ok: false, reason: "prepMissing" });
    expect(simpleOrientationAdvice(start, "psu")).toBe("psuDown");
    for (const way of ["up", "down"]) expect(placeSimplePart(steps(`prep:psu:psu_fan:${way}` as SimpleStep).state, "psu").ok, way).toBe(true);
    activateSimpleModel(planModel(plan({ case: "fractal-north-charcoal-black-mesh" })));
    expect(simpleOrientationAdvice(createSimpleBuild(), "psu")).toBeNull();
  });

  it("comes out by unscrewing one screw at a time, then lifting; the lift is refused while a screw or a lead is in", () => {
    activateSimpleModel(planModel(plan()));
    const placed = steps("prep:psu:psu_fan:down", "place:psu", ...screws("psu", 4));
    expect(simpleLiftBlock(placed.state, "psu")).toBe("unscrewFirst");
    const partly = steps("prep:psu:psu_fan:down", "place:psu", ...screws("psu", 4), ...unscrews("psu", 3)).state;
    expect(firstAttachment(partly, "psu")?.fastenersSecured).toBe(1);
    expect(simpleLiftBlock(partly, "psu")).toBe("unscrewFirst");
    const out = steps("prep:psu:psu_fan:down", "place:psu", ...screws("psu", 4), ...unscrews("psu", 4), "lift:psu");
    expect(simplePartInstalled(out.state, "psu")).toBe(false);
    expect(out.snapshot.placed).not.toContain("psu");
  });
});

describe("SATA drives (stage 7)", () => {
  it("offers only bays the drive fits, shows taken ones, and takes the learner's choice", () => {
    activateSimpleModel(planModel(plan()));
    const start = createSimpleBuild();
    // The 3.5-inch drive (storage2) fits the two combined trays only; the 2.5-inch SSD (storage3) fits all four.
    expect(simplePositions(start, "storage2").filter((p) => p.fits).map((p) => p.id)).toEqual(["drive-35-1", "drive-35-2"]);
    expect(simplePositions(start, "storage3").filter((p) => p.fits)).toHaveLength(4);
    const wrong = placeSimplePart(start, "storage2", "drive-25-1");
    expect(wrong).toMatchObject({ ok: false, reason: "positionWrong" });

    const first = steps("place:storage2@drive-35-1").state;
    expect(simplePositions(first, "storage3").find((p) => p.id === "drive-35-1")).toMatchObject({ occupant: "storage2", fits: true });
    expect(placeSimplePart(first, "storage3", "drive-35-1")).toMatchObject({ ok: false, reason: "positionTaken" });
  });

  it("is installed only when every screw of the chosen bay is in, one per step; two drives are independent", () => {
    activateSimpleModel(planModel(plan()));
    const mid = steps("place:storage2@drive-35-2", ...screws("storage2", 3), "place:storage3@drive-25-1", ...screws("storage3", 4));
    expect(simpleRequiredScrews(mid.state, "storage2")).toBe(4);
    expect(simplePartInstalled(mid.state, "storage2")).toBe(false);
    expect(simplePartInstalled(mid.state, "storage3")).toBe(true);
    expect(firstAttachment(mid.state, "storage2")?.target.mountPointId).toBe("drive-35-2");
    const done = steps("place:storage2@drive-35-2", ...screws("storage2", 4), "place:storage3@drive-25-1", ...screws("storage3", 4));
    expect(simplePartInstalled(done.state, "storage2") && simplePartInstalled(done.state, "storage3")).toBe(true);
  });

  it("removes a drive by unscrewing then lifting, leaving the other drive and the M.2 drive alone", () => {
    activateSimpleModel(planModel(plan()));
    const out = steps("place:storage2@drive-35-1", ...screws("storage2", 4), "place:storage3@drive-25-2", ...screws("storage3", 4), ...unscrews("storage2", 4), "lift:storage2");
    expect(simplePartInstalled(out.state, "storage2")).toBe(false);
    expect(simplePartInstalled(out.state, "storage3")).toBe(true);
    expect(out.snapshot.placed).toEqual(["storage3"]);
    // The freed bay can be chosen again.
    expect(simplePositions(out.state, "storage2").find((p) => p.id === "drive-35-1")?.occupant).toBeNull();
  });

  it("replays from a saved snapshot, keeps a legacy `place:` step (default bay) and rejects a bad bay id", () => {
    activateSimpleModel(planModel(plan()));
    const { snapshot } = steps("place:storage2@drive-35-2", ...screws("storage2", 2));
    const reloaded = parseSimpleSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(reloaded?.history).toEqual(snapshot.history);
    expect(parseSimpleSnapshot({ ...snapshot, history: ["place:storage2@Drive 9"], placed: ["storage2"] })).toBeNull();
    const legacy = steps("place:storage2", ...screws("storage2", 4));
    expect(firstAttachment(legacy.state, "storage2")?.target.mountPointId).toBe("drive-35-1");
  });

  it("keeps a bay choice when the plan changes elsewhere", () => {
    const from = planModel(plan());
    activateSimpleModel(from);
    const { snapshot } = steps("place:storage2@drive-35-2", ...screws("storage2", 4));
    const to = planModel(plan({ fans: [] }));
    const kept = rebaseProgress(snapshot, from, to);
    expect(kept.history).toContain("place:storage2@drive-35-2");
    activateSimpleModel(to);
    expect(simplePartInstalled(snapshotFromBuild(kept.history), "storage2")).toBe(true);
  });
});

const snapshotFromBuild = (history: readonly string[]) => simpleBuildFromSnapshot(snapshotFromHistory(history));

describe("case fans (stage 9)", () => {
  it("lists only places of the fan's size, with the case's own fans as occupants of the front", () => {
    activateSimpleModel(planModel(plan()));
    const places = simplePositions(createSimpleBuild(), "fan1");
    const fits = places.filter((p) => p.fits).map((p) => p.id);
    expect(fits).toContain("fan-top-1");
    expect(fits).toContain("fan-rear-1");
    expect(places.find((p) => p.id === "fan-front-1")).toMatchObject({ supplied: true, fits: true });
    expect(placeSimplePart(createSimpleBuild(), "fan1", "fan-front-1")).toMatchObject({ ok: false, reason: "positionTaken" });
  });

  it("needs the airflow chosen, accepts either direction at any place, and advises the usual one for the chosen place", () => {
    activateSimpleModel(planModel(plan()));
    expect(placeSimplePart(createSimpleBuild(), "fan1", "fan-top-1")).toMatchObject({ ok: false, reason: "prepMissing" });
    expect(simpleOrientationAdvice(createSimpleBuild(), "fan1", "fan-top-1")).toBe("exhaust");
    expect(simpleOrientationAdvice(createSimpleBuild(), "fan1", "fan-front-3")).toBe("intake");
    const against = steps("prep:fan1:airflow:intake", "place:fan1@fan-top-1", ...screws("fan1", 4));
    expect(simplePartInstalled(against.state, "fan1")).toBe(true);
    expect(firstAttachment(against.state, "fan1")?.target.mountPointId).toBe("fan-top-1");
  });

  it("never moves a fan for a radiator by itself: the case's own fan is moved by its own step, a fan the learner fitted blocks until taken out", () => {
    activateSimpleModel(planModel(plan({ cooler: "arctic-liquid-freezer-iii-280", storage: ["samsung-990-pro-1tb"] })));
    const start = createSimpleBuild();
    // Left alone, the case's own fan covers the radiator's places: refused, nothing moved.
    expect(placeRadiator(start, "aio")).toMatchObject({ ok: false, reason: "fanInTheWay" });
    const cleared = clearRadiatorFans(start, "aio");
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const own = simpleRadiatorCover(start, "aio").supplied[0]!;
    const moved = cleared.state.parts.find((p) => p.instanceId === own)!;
    expect(moved.attachments[0]!.target.mountPointId).toMatch(/^fan-top-/);
    expect(placeRadiator(cleared.state, "aio").ok).toBe(true);
    // A fan the learner fitted at a covered front place: not moved, and the case's own fan step does not touch it.
    const withOwn = steps("prep:fan1:airflow:intake", "place:fan1@fan-front-3", ...screws("fan1", 4)).state;
    expect(simpleRadiatorCover(withOwn, "aio").fans).toContain(simpleRadiatorCover(withOwn, "aio").fans.find((id) => !simpleRadiatorCover(withOwn, "aio").supplied.includes(id)));
    const afterClear = clearRadiatorFans(withOwn, "aio");
    expect(afterClear.ok && placeRadiator(afterClear.state, "aio")).toMatchObject({ ok: false, reason: "fanInTheWay" });
    expect(afterClear.ok && firstAttachment(afterClear.state, "fan1")?.target.mountPointId).toBe("fan-front-3");
  });

  it("a board's removal needs its leads and card unscrewed first, and carries its CPU along", () => {
    activateSimpleModel(planModel(plan({ storage: ["samsung-990-pro-1tb"] })));
    const placed = steps("prep:motherboard:standoffs:checked", "place:motherboard", ...screws("motherboard", 9));
    expect(simpleLiftBlock(placed.state, "motherboard")).toBe("unscrewFirst");
    const unscrewed = steps("prep:motherboard:standoffs:checked", "place:motherboard", ...screws("motherboard", 9), ...unscrews("motherboard", 9), "lift:motherboard");
    expect(simplePartInstalled(unscrewed.state, "motherboard")).toBe(false);
  });
});

describe("lifting a prepared board out (stage 5)", () => {
  const prepared = [
    "part:cpu", "part:ram", "part:ram2", "part:storage", "part:cooler", "prep:motherboard:standoffs:checked", "place:motherboard", ...screws("motherboard", 9),
  ] as SimpleStep[];
  const out = [...unscrews("motherboard", 9)];

  it("lifts the board with its own cooler lead still plugged in: the lead never leaves the carried assembly", () => {
    activateSimpleModel(planModel(plan({ storage: ["samsung-990-pro-1tb"], fans: [] })));
    const { snapshot, state } = steps(...prepared, "plug:cpuFan:0", ...out, "lift:motherboard");
    expect(simpleCableConnected(state, "cpuFan")).toBe(true);
    expect(simplePartInstalled(state, "motherboard")).toBe(false);
    // The CPU, memory, drive and cooler go with it, and a reload replays the same state.
    for (const key of ["cpu", "ram", "ram2", "storage", "cooler"]) expect(simplePartInstalled(state, key), key).toBe(true);
    const reloaded = simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify(snapshot)))!);
    expect(simpleCableConnected(reloaded, "cpuFan")).toBe(true);
  });

  it("still refuses while a lead crosses to the power supply, and lifts again once that plug is taken back", () => {
    activateSimpleModel(planModel(plan({ storage: ["samsung-990-pro-1tb"], fans: [] })));
    const psu = ["prep:psu:psu_fan:down", "place:psu", ...screws("psu", 4)] as SimpleStep[];
    const wired = steps(...prepared, ...psu, "plug:atx:0", "plug:atx:1", ...out);
    expect(simpleLiftBlock(wired.state, "motherboard")).toBe("unplugFirst");
    // Undo takes the last plug back; the supply-side end alone does not tie the board to the supply.
    const undone = steps(...prepared, ...psu, "plug:atx:0", ...out);
    expect(simpleLiftBlock(undone.state, "motherboard")).toBeNull();
  });
});

describe("plan edits keep the learner's chosen bays and fan places (rebase from the real from/to specs)", () => {
  const work: SimpleStep[] = [
    "place:storage2@drive-35-2", ...screws("storage2", 4), "place:storage3@drive-25-2", ...screws("storage3", 4),
    "prep:fan1:airflow:exhaust", "place:fan1@fan-top-2", ...screws("fan1", 4),
  ];
  const from = () => planModel(plan());

  it("adding a fan changes nothing that was done", () => {
    const before = from();
    activateSimpleModel(before);
    const { snapshot } = steps(...work);
    const kept = rebaseProgress(snapshot, before, planModel(plan({ fans: ["arctic-p12-pwm-pst", "arctic-p12-pwm-pst"] })));
    expect(kept.history).toEqual(snapshot.history);
    expect(kept.changed).toEqual([]);
  });

  it("removing the last drive undoes only that drive; the other drive's bay and the fan's place stay", () => {
    const before = from();
    activateSimpleModel(before);
    const { snapshot } = steps(...work);
    const after = planModel(plan({ storage: ["samsung-990-pro-1tb", "seagate-barracuda-2tb-st2000dm008"] }));
    const kept = rebaseProgress(snapshot, before, after);
    expect(kept.history).toContain("place:storage2@drive-35-2");
    expect(kept.history).toContain("place:fan1@fan-top-2");
    expect(kept.history.some((h) => h.includes("storage3"))).toBe(false);
    activateSimpleModel(after);
    const rebuilt = simpleBuildFromSnapshot(snapshotFromHistory(kept.history));
    expect(simplePartInstalled(rebuilt, "storage2") && simplePartInstalled(rebuilt, "fan1")).toBe(true);
  });

  it("a part of another kind taking a key keeps no stale position steps", () => {
    const before = from();
    activateSimpleModel(before);
    const { snapshot } = steps(...work);
    const swapped = planModel(plan({ fans: ["arctic-p14-pwm-pst"] }));
    const kept = rebaseProgress(snapshot, before, swapped);
    expect(kept.changed).toContain("fan1");
    expect(kept.history.some((h) => h.includes("fan1"))).toBe(false);
    expect(kept.history).toContain("place:storage2@drive-35-2");
  });
});

describe("the chosen bay or fan place is the same place in the scene targets and the robot's pointer", () => {
  const key = { kind: "part", key: "storage2" } as const;

  it("shows every bay as a click, glows only the chosen one, and implies none before a choice", () => {
    activateSimpleModel(planModel(plan()));
    const state = createSimpleBuild();
    const none = simpleSceneTargets(state, key, null);
    expect(none.map((t) => t.placeId)).toEqual(["drive-25-1", "drive-25-2", "drive-35-1", "drive-35-2"]);
    expect(none.every((t) => t.role === "decoy" && t.id.startsWith("pick:"))).toBe(true);
    expect(guideFocus(state, key, false, false, null)?.targets).toMatchObject([{ kind: "part" }]);
    const chosen = simpleSceneTargets(state, key, "drive-35-2");
    expect(chosen.filter((t) => t.role === "target").map((t) => t.placeId)).toEqual(["drive-35-2"]);
    expect(guideFocus(state, key, false, false, "drive-35-2")?.targets).toEqual([{ kind: "mount", hostInstanceId: "case-1", placeId: "drive-35-2" }]);
  });

  it("follows the part after placing: no bay clicks remain, and the saved step names the bay that was chosen", () => {
    activateSimpleModel(planModel(plan()));
    const { snapshot, state } = steps("place:storage2@drive-35-2");
    expect(simpleSceneTargets(state, key, "drive-35-2")).toEqual([]);
    expect(snapshot.history).toEqual(["place:storage2@drive-35-2"]);
    expect(firstAttachment(simpleBuildFromSnapshot(parseSimpleSnapshot(JSON.parse(JSON.stringify(snapshot)))!), "storage2")?.target.mountPointId).toBe("drive-35-2");
  });

  it("offers fan places the same way (the case's own fan places included, so a taken one can be explained)", () => {
    activateSimpleModel(planModel(plan()));
    const places = simpleSceneTargets(createSimpleBuild(), { kind: "part", key: "fan1" }, null).map((t) => t.placeId);
    expect(places).toEqual(expect.arrayContaining(["fan-front-1", "fan-top-1", "fan-rear-1"]));
  });
});

describe("saves made before the supplied fans were corrected (one front, one rear)", () => {
  it("a `place:` step without a chosen place replays at the plan's default place and keeps every screw", () => {
    activateSimpleModel(planModel(plan()));
    const old = steps("prep:fan1:airflow:intake", "place:fan1", ...screws("fan1", 4));
    const reloaded = parseSimpleSnapshot(JSON.parse(JSON.stringify(old.snapshot)));
    expect(reloaded?.history).toEqual(old.snapshot.history);
    // The case's own second fan now sits at the rear, so the first free front place is front 2 (it was front 3).
    expect(firstAttachment(simpleBuildFromSnapshot(reloaded!), "fan1")?.target.mountPointId).toBe("fan-front-2");
    expect(simplePartInstalled(simpleBuildFromSnapshot(reloaded!), "fan1")).toBe(true);
  });
});
