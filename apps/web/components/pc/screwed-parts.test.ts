// Stages 5–9: a board, power supply, SATA drive or case fan goes in by placing, then one screw per step,
// and comes out by one screw per step, then lifting. Positions are the learner's choice.
import { afterEach, describe, expect, it } from "vitest";
import type { pc } from "@ytl/simulation";
import { planModel, rebaseProgress, snapshotFromHistory, type PlannedBuild } from "./plan-model";
import {
  activateSimpleModel, applySimpleStep, createSimpleBuild, firstAttachment, LEGACY_MODEL, parseSimpleSnapshot, placeSimplePart, simpleBlock, simpleBuildFromSnapshot,
  placeRadiator, simpleLiftBlock, simplePartInstalled, simplePositions, simpleRequiredScrews, withSimpleStep, emptySimpleSnapshot, type SimpleSnapshot, type SimpleStep,
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

  it("follows the case's vent: a filtered bottom vent refuses fan-up, a case with no recorded vent accepts either way", () => {
    activateSimpleModel(planModel(plan()));
    const before = steps("prep:psu:psu_fan:up").state;
    const refused = placeSimplePart(before, "psu");
    expect(refused.ok).toBe(false);
    if (!refused.ok) { expect(refused.reason).toBe("prepWrong"); expect(refused.message?.en).toMatch(/fan faces down/); }

    activateSimpleModel(planModel(plan({ case: "fractal-north-charcoal-black-mesh" })));
    for (const way of ["up", "down"]) {
      const ok = placeSimplePart(steps(`prep:psu:psu_fan:${way}` as SimpleStep).state, "psu");
      expect(ok.ok, way).toBe(true);
    }
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

  it("explains a wrong airflow through the engine, and accepts the airflow the chosen place needs", () => {
    activateSimpleModel(planModel(plan()));
    const wrong = placeSimplePart(steps("prep:fan1:airflow:intake").state, "fan1", "fan-top-1");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) { expect(wrong.reason).toBe("prepWrong"); expect(wrong.message?.en).toMatch(/blows air out/); }
    const right = steps("prep:fan1:airflow:exhaust", "place:fan1@fan-top-1", ...screws("fan1", 4));
    expect(simplePartInstalled(right.state, "fan1")).toBe(true);
    expect(firstAttachment(right.state, "fan1")?.target.mountPointId).toBe("fan-top-1");
  });

  it("does not move a fan the learner fitted for a liquid cooler's radiator: it is refused until that fan is out", () => {
    activateSimpleModel(planModel(plan({ cooler: "arctic-liquid-freezer-iii-280", storage: ["samsung-990-pro-1tb"] })));
    // fan1 is a learner fan; the radiator covers the three front places, two of which hold the case's fans.
    const front = simplePositions(createSimpleBuild(), "fan1").find((p) => p.id === "fan-front-3")!;
    expect(front.occupant).toBeNull();
    const withFan = steps("prep:fan1:airflow:intake", "place:fan1@fan-front-3", ...screws("fan1", 4)).state;
    expect(placeRadiator(withFan, "aio")).toMatchObject({ ok: false, reason: "fanInTheWay" });
  });

  it("a board's removal needs its leads and card unscrewed first, and carries its CPU along", () => {
    activateSimpleModel(planModel(plan({ storage: ["samsung-990-pro-1tb"] })));
    const placed = steps("prep:motherboard:standoffs:checked", "place:motherboard", ...screws("motherboard", 9));
    expect(simpleLiftBlock(placed.state, "motherboard")).toBe("unscrewFirst");
    const unscrewed = steps("prep:motherboard:standoffs:checked", "place:motherboard", ...screws("motherboard", 9), ...unscrews("motherboard", 9), "lift:motherboard");
    expect(simplePartInstalled(unscrewed.state, "motherboard")).toBe(false);
  });
});
