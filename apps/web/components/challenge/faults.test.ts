import { describe, expect, it } from "vitest";
import { network, pc } from "@ytl/simulation";
import { pcCatalog, pcPresets } from "../pc/catalog";
import { applyNetwork, applyPc, isNetworkWorking, isPcWorking, networkFaults, networkProbe, pcFaults, pingSucceeds } from "./faults";

describe("PC faults", () => {
  const working = pc.replay(pcPresets[0].actions, pcCatalog).state;

  it("a ready build counts as working, an empty one does not", () => {
    expect(isPcWorking(working, pcCatalog)).toBe(true);
    expect(isPcWorking(pc.createBuild(pcCatalog), pcCatalog)).toBe(false);
  });

  it("offers faults of several kinds, each accepted by the engine and each really breaking the build", () => {
    const faults = pcFaults(working, pcCatalog);
    const kinds = new Set(faults.map((fault) => fault.kind));
    for (const kind of ["ram_partial", "unplug", "no_os", "psu_off"]) expect(kinds.has(kind as never), kind).toBe(true);
    // Both offered CPUs have integrated graphics and no monitor is involved, so taking the card out does not
    // break the build, and it is not offered as a fault.
    expect(kinds.has("remove_gpu"), "remove_gpu").toBe(false);
    for (const fault of faults) {
      const broken = applyPc(working, fault.actions, pcCatalog);
      expect(broken, fault.id).not.toBeNull();
      expect(isPcWorking(fault.kind === "psu_off" ? { ...broken!, power: { ...broken!.power, psuSwitchOn: true } } : broken!, pcCatalog), fault.id).toBe(fault.kind === "psu_off");
    }
    expect(new Set(faults.map((fault) => fault.id)).size).toBe(faults.length);
  });

  it("starts with switching off when the build is on", () => {
    const on = pc.applyAction(working, { type: "press_power" }, pcCatalog);
    if (!on.ok) throw new Error("press_power refused");
    const faults = pcFaults(on.state, pcCatalog);
    expect(faults.length).toBeGreaterThan(0);
    expect(faults.every((fault) => fault.actions[0].type === "power_off")).toBe(true);
  });
});

describe("network faults", () => {
  const working = network.replay(network.networkPresets[0].actions).state;

  it("a ready home network counts as working and has a probe", () => {
    expect(networkProbe(working)).not.toBeNull();
    expect(isNetworkWorking(working)).toBe(true);
    expect(isNetworkWorking(network.createNetwork())).toBe(false);
  });

  it("offers faults of several kinds, each really breaking the probe or the standing check", () => {
    const faults = networkFaults(working);
    const kinds = new Set(faults.map((fault) => fault.kind));
    for (const kind of ["unplug", "device_off", "wrong_gateway", "dhcp_off"]) expect(kinds.has(kind as never), kind).toBe(true);
    const probe = networkProbe(working)!;
    for (const fault of faults) {
      const broken = applyNetwork(working, fault.actions);
      expect(broken, fault.id).not.toBeNull();
      expect(!pingSucceeds(broken!, probe) || !isNetworkWorking(broken!), fault.id).toBe(true);
    }
  });
});
