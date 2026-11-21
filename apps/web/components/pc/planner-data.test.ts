import { afterEach, describe, expect, it } from "vitest";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import { planModel } from "./plan-model";
import { compatibleOptions, PLANNER_IDS, suggestBuild, WORKLOADS, withChoice, withoutChoice, withoutModel } from "./planner-data";
import { activateSimpleModel, connectSimpleCable, createSimpleBuild, installSimplePart, LEGACY_MODEL, SIMPLE_PARTS, simplePartOrder, simpleCablesFor, startSimplePC } from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));

describe("planner data", () => {
  it("removes the chosen drive before assembly, preserving other drives and duplicate copies", () => {
    const [first, second, third] = PLANNER_IDS.storage;
    const plan = { ...suggestBuild("gaming", "1080p"), storage: [first!, second!, third!, second!] };
    const removed = withoutChoice(plan, "storage", plan.storage.indexOf(second!));
    expect(removed.storage).toEqual([first, third, second]);
    expect(removed.cpu).toBe(plan.cpu);
    expect(plan.storage).toEqual([first, second, third, second]);
    const lastCopyRemoved = withoutChoice(removed, "storage", removed.storage!.indexOf(second!));
    expect(lastCopyRemoved.storage).toEqual([first, third]);
    expect(withChoice(lastCopyRemoved, "storage", second!).storage).toEqual([first, third, second]);
  });

  it("removes exactly one copy of a card's drive or fan model, keeping other instances and choices", () => {
    const [a, b, c] = PLANNER_IDS.storage;
    const [f1, f2] = PLANNER_IDS.fans;
    const plan = { ...suggestBuild("gaming", "1080p"), storage: [a!, b!, c!, b!], fans: [f1!, f2!, f1!] };
    const noB = withoutModel(plan, "storage", b!)!;
    expect(noB.storage).toEqual([a, c, b]);
    expect(noB.fans).toEqual(plan.fans);
    expect({ ...noB, storage: plan.storage }).toEqual(plan);
    expect(withoutModel(noB, "storage", b!)!.storage).toEqual([a, c]);
    expect(withoutModel(plan, "fans", f1!)!.fans).toEqual([f2, f1]);
    expect(withoutModel(plan, "fans", f1!)!.storage).toEqual(plan.storage);
    expect(plan.storage).toEqual([a, b, c, b]);
    expect(withChoice(noB, "storage", b!).storage).toEqual([a, c, b, b]);
  });

  it("cannot remove a drive or fan model that is not in the build", () => {
    const [a, b] = PLANNER_IDS.storage;
    const [f1, f2] = PLANNER_IDS.fans;
    const plan = { ...suggestBuild("gaming", "1080p"), storage: [a!], fans: [f1!] };
    expect(withoutModel(plan, "storage", b!)).toBeNull();
    expect(withoutModel(plan, "fans", f2!)).toBeNull();
  });

  it("removes a single-choice part only when that exact model is selected", () => {
    const plan = suggestBuild("gaming", "1080p");
    for (const category of ["cpu", "motherboard", "ram", "cooler", "gpu", "psu", "case"] as const) {
      const chosen = category === "ram" ? plan.ram!.id : plan[category]!;
      const other = PLANNER_IDS[category].find((id) => id !== chosen)!;
      expect(withoutModel(plan, category, other)).toBeNull();
      const removed = withoutModel(plan, category, chosen)!;
      expect(removed[category]).toBeNull();
      expect({ ...removed, [category]: plan[category] }).toEqual(plan);
    }
  });

  it("offers only catalog entries", () => {
    for (const ids of Object.values(PLANNER_IDS)) for (const id of ids) expect(pcCatalog.entries.some((e) => e.id === id)).toBe(true);
  });

  for (const purpose of ["study", "gaming", "creator"] as const) {
    for (const workload of WORKLOADS[purpose].length ? WORKLOADS[purpose] : [""]) {
      it(`suggests a ready build that assembles and starts: ${purpose} ${workload}`, () => {
        const plan = suggestBuild(purpose, workload);
        const report = pc.checkPlan(plan, pcCatalog);
        expect(report.findings.filter((f) => f.severity === "incompatible")).toEqual([]);
        expect(report.ready).toBe(true);
        activateSimpleModel(planModel({ version: 1, purpose, workload, parts: plan }));
        let state = createSimpleBuild();
        for (const key of simplePartOrder(state)) { const p = { key }; const r = installSimplePart(state, p.key); if (!r.ok) throw new Error(p.key + r.reason); state = r.state; }
        for (const c of simpleCablesFor(state)) { const r = connectSimpleCable(state, c.key); if (!r.ok) throw new Error(c.key); state = r.state; }
        expect(startSimplePC(state).startup.outcome).toBe("operational");
      });
    }
  }

  it("lists compatible alternatives that clear the conflict", () => {
    const plan = withChoice(suggestBuild("gaming", "1080p"), "ram", "corsair-vengeance-lpx-ddr4-3600-16gb-kit");
    expect(compatibleOptions(plan, "ram")).toEqual(["corsair-vengeance-rgb-ddr5-6000-32gb-kit"]);
  });
});
