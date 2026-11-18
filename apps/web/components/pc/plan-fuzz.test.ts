import { afterEach, describe, expect, it } from "vitest";
import { planModel } from "./plan-model";
import { checkBuildPlan, PLANNER_IDS } from "./planner-data";
import { activateSimpleModel, connectSimpleCable, createSimpleBuild, installSimplePart, LEGACY_MODEL, simpleCablesFor, simplePartOrder, startSimplePC } from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));

// A deterministic pseudo-random walk over the planner's options.
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

describe("every plan the check calls ready assembles and starts", () => {
  it("random plans", () => {
    const r = rng(7);
    const pick = (a: readonly string[]) => a[Math.floor(r() * a.length)]!;
    let ready = 0;
    for (let i = 0; i < 1500 && ready < 120; i++) {
      const plan = {
        case: pick(PLANNER_IDS.case), motherboard: pick(PLANNER_IDS.motherboard), cpu: pick(PLANNER_IDS.cpu), cooler: pick(PLANNER_IDS.cooler), psu: pick(PLANNER_IDS.psu),
        gpu: r() < 0.25 ? null : pick(PLANNER_IDS.gpu), ram: { id: pick(PLANNER_IDS.ram), modules: r() < 0.3 ? 4 : 2 },
        storage: Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(PLANNER_IDS.storage)), fans: Array.from({ length: Math.floor(r() * 4) }, () => pick(PLANNER_IDS.fans)),
      };
      if (!checkBuildPlan(plan).ready) continue;
      ready += 1;
      const label = JSON.stringify(plan);
      activateSimpleModel(planModel({ version: 1, purpose: null, workload: "", parts: plan }));
      let state = createSimpleBuild();
      for (const key of simplePartOrder(state)) { const s = installSimplePart(state, key); expect(s.ok, `${key} ${label}`).toBe(true); if (s.ok) state = s.state; }
      for (const c of simpleCablesFor(state)) { const s = connectSimpleCable(state, c.key); expect(s.ok, `${c.key} ${label}`).toBe(true); if (s.ok) state = s.state; }
      expect(startSimplePC(state).startup.outcome, label).toBe("operational");
    }
    expect(ready).toBeGreaterThan(40);
  });
});
