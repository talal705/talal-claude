import { afterEach, describe, expect, it } from "vitest";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import { planModel } from "./plan-model";
import { compatibleOptions, PLANNER_IDS, suggestBuild, WORKLOADS, withChoice } from "./planner-data";
import { activateSimpleModel, connectSimpleCable, createSimpleBuild, installSimplePart, LEGACY_MODEL, SIMPLE_PARTS, simpleCablesFor, startSimplePC } from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));

describe("planner data", () => {
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
        for (const p of SIMPLE_PARTS) { const r = installSimplePart(state, p.key); if (!r.ok) throw new Error(p.key + r.reason); state = r.state; }
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
