import { describe, expect, it } from "vitest";
import { guideFocus } from "./guide";
import { connectSimpleCable, createSimpleBuild, installSimplePart, simpleCablesFor, startSimplePC, type SimplePartKey } from "./simple-model";

function built(parts: readonly SimplePartKey[], wire = false) {
  let state = createSimpleBuild();
  for (const key of parts) {
    const step = installSimplePart(state, key);
    if (!step.ok) throw new Error(`${key}: ${step.reason}`);
    state = step.state;
  }
  if (wire) for (const cable of simpleCablesFor(state)) {
    const step = connectSimpleCable(state, cable.key);
    if (!step.ok) throw new Error(cable.key);
    state = step.state;
  }
  return state;
}

describe("the guide robot's focus", () => {
  it("stays parked until the learner picks something up or asks", () => {
    expect(guideFocus(createSimpleBuild(), null, false, false)).toBeNull();
    expect(guideFocus(createSimpleBuild(), null, false, true)).toEqual({ targets: [{ kind: "part", instanceId: "cpu-3" }], reason: "next", subject: { part: "cpu" } });
  });

  it("points at the place of the part in hand, from the simulation's own target", () => {
    expect(guideFocus(createSimpleBuild(), { kind: "part", key: "cpu" }, false, false)).toEqual({
      targets: [{ kind: "mount", hostInstanceId: "motherboard-2", placeId: "cpu-socket" }], reason: "place", subject: { part: "cpu" },
    });
    // A memory module has no default slot: until it is in one, the robot looks at the module (the page
    // points at the slot it is actually held over).
    expect(guideFocus(built(["ram"]), { kind: "part", key: "ram2" }, false, false)!.targets).toEqual([{ kind: "part", instanceId: "ram-11" }]);
    // The liquid cooler: its block place and its radiator place.
    expect(guideFocus(built(["cpu2", "ram", "ram2", "storage", "motherboard"]), { kind: "part", key: "aio" }, false, false)!.targets).toEqual([
      { kind: "mount", hostInstanceId: "motherboard-2", placeId: "cooler-mount" },
      { kind: "mount", hostInstanceId: "case-1", placeId: "rad-front" },
    ]);
  });

  it("shows the earlier step first when a part or lead is picked too early", () => {
    expect(guideFocus(createSimpleBuild(), { kind: "part", key: "motherboard" }, false, false)).toMatchObject({ reason: "prerequisite", targets: [{ kind: "part", instanceId: "cpu-3" }] });
    expect(guideFocus(createSimpleBuild(), { kind: "part", key: "gpu" }, false, false)).toMatchObject({ reason: "prerequisite", targets: [{ kind: "part", instanceId: "cpu-3" }] });
    expect(guideFocus(built(["cpu2", "ram", "ram2", "storage"]), { kind: "part", key: "aio" }, false, false)).toMatchObject({ reason: "prerequisite", targets: [{ kind: "part", instanceId: "motherboard-2" }] });
    expect(guideFocus(createSimpleBuild(), { kind: "cable", key: "gpuPower" }, false, false)).toMatchObject({ reason: "prerequisite", subject: { part: "cpu" } });
  });

  it("guides a swap: the fan lead to unplug, then the cooler to take off, before the CPU", () => {
    const state = built(["cpu2", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"], true);
    expect(guideFocus(state, { kind: "part", key: "aio" }, false, false)).toMatchObject({ reason: "prerequisite", targets: [{ kind: "port", placeId: "cpu-fan" }] });
    expect(guideFocus(state, { kind: "part", key: "cpu" }, false, false)).toMatchObject({ reason: "prerequisite", targets: [{ kind: "part", instanceId: "cooling-6" }] });
    // Asked what next with the i9 on air: unplug the air cooler's fan first.
    expect(guideFocus(state, null, false, true)).toMatchObject({ reason: "next", targets: [{ kind: "port", placeId: "cpu-fan" }] });
  });

  it("points at leads' ports, then the power button, then celebrates once it runs complete", () => {
    const parts = built(["cpu", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"]);
    expect(guideFocus(parts, null, false, true)).toMatchObject({ reason: "next", targets: [{ kind: "port", hostInstanceId: "motherboard-2", placeId: "atx-24" }] });
    expect(guideFocus(parts, { kind: "cable", key: "gpuPower" }, false, false)).toMatchObject({ reason: "place", targets: [{ kind: "port", hostInstanceId: "gpu-7", placeId: "power-8pin" }] });
    const wired = built(["cpu", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"], true);
    expect(guideFocus(wired, null, false, true)).toEqual({ targets: [{ kind: "powerButton" }], reason: "next" });
    const running = startSimplePC(wired);
    expect(running.ok).toBe(true);
    expect(guideFocus(running.state, null, true, false)).toEqual({ targets: [{ kind: "powerButton" }], reason: "celebrate" });
  });
});
