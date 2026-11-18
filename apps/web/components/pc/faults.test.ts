import { afterEach, describe, expect, it } from "vitest";
import { availableFaults, finishedBuild, flashBios, withFault } from "./faults";
import { planModel } from "./plan-model";
import { suggestBuild } from "./planner-data";
import { activateSimpleModel, connectSimpleCable, installSimplePart, LEGACY_MODEL, startSimplePC } from "./simple-model";

afterEach(() => activateSimpleModel(LEGACY_MODEL));

describe("find the fault", () => {
  it("the finished practice build starts", () => {
    expect(startSimplePC(finishedBuild()).ok).toBe(true);
  });

  it("every fault stops the start, and the ordinary step fixes it", () => {
    expect(availableFaults()).toEqual(["ramUnseated", "cpuPowerMissing", "coolerLeadMissing", "frontPanelWrong", "biosTooOld"]);
    const fixes: Record<string, (s: NonNullable<ReturnType<typeof withFault>>) => ReturnType<typeof withFault>> = {
      ramUnseated: (s) => { const r = installSimplePart(s, "ram"); return r.ok ? r.state : null; },
      cpuPowerMissing: (s) => { const r = connectSimpleCable(s, "cpuPower"); return r.ok ? r.state : null; },
      coolerLeadMissing: (s) => { const r = connectSimpleCable(s, "cpuFan"); return r.ok ? r.state : null; },
      frontPanelWrong: (s) => { const r = connectSimpleCable(s, "powerSwitch"); return r.ok ? r.state : null; },
      biosTooOld: (s) => flashBios(s),
    };
    for (const kind of availableFaults()) {
      const broken = withFault(kind)!;
      const r = startSimplePC(broken);
      expect(r.ok, kind).toBe(false);
      const fixed = fixes[kind]!(broken)!;
      expect(startSimplePC(fixed).ok, kind).toBe(true);
    }
  });

  it("separates what is seen: fans spin without CPU power, but POST fails", () => {
    const r = startSimplePC(withFault("cpuPowerMissing")!).startup;
    expect(r.stages.find((s) => s.stage === "power")?.status).toBe("passed");
    expect(r.stages.find((s) => s.stage === "post")?.status).toBe("failed");
    expect(r.observable.spinning.length).toBeGreaterThan(0);
  });

  it("works on a planned build too (no BIOS fault on a board whose history is not recorded)", () => {
    activateSimpleModel(planModel({ version: 1, purpose: "study", workload: "", parts: suggestBuild("study", "") }));
    expect(availableFaults()).toEqual(["ramUnseated", "cpuPowerMissing", "coolerLeadMissing", "frontPanelWrong"]);
  });
});
