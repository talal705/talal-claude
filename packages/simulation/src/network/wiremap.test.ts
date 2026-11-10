import { describe, expect, it } from "vitest";
import type { NetworkAction, NetworkState, PlugTermination, WireColor } from "@ytl/contracts";
import { STANDARD_ORDER, applyAction, checkCable, checkPlug, isValidOrder, matchStandard, networkPresets, replay, runConnectivity, scrambledWireOrder } from "./index";
import { build } from "./test-helpers";

const A = [...STANDARD_ORDER.T568A];
const B = [...STANDARD_ORDER.T568B];
const cable = (a: PlugTermination | null, b: PlugTermination | null) => checkCable({ plugs: { a, b } });
const statuses = (result: ReturnType<typeof checkCable>) => result.pins.map((pin) => pin.status);
const swap = (order: WireColor[], i: number, j: number): WireColor[] => {
  const next = [...order];
  [next[i - 1], next[j - 1]] = [next[j - 1], next[i - 1]];
  return next;
};

describe("one plug against the chosen standard", () => {
  it("T568A and T568B are both valid orders", () => {
    expect(checkPlug({ standard: "T568A", order: A })).toMatchObject({ passed: true });
    expect(checkPlug({ standard: "T568B", order: B })).toMatchObject({ passed: true });
    expect(matchStandard(A)).toBe("T568A");
    expect(matchStandard(B)).toBe("T568B");
  });

  it("a plug in the other standard is reported as a valid order that is not the chosen one, pin by pin", () => {
    const result = checkPlug({ standard: "T568B", order: A });
    expect(result.passed).toBe(false);
    expect(result.pins.filter((pin) => !pin.ok).map((pin) => pin.position)).toEqual([1, 2, 3, 6]);
    expect(result.summary.en).toContain("T568A, which is a valid order");
    expect(result.pins[0].detail?.en).toBe("Pin 1 holds the white-green wire. T568B puts the white-orange wire here.");
    expect(result.pins[0].detail?.ar.length).toBeGreaterThan(0);
  });

  it("two wires in each other's place fail exactly those two pins", () => {
    const result = checkPlug({ standard: "T568B", order: swap(B, 4, 5) });
    expect(result.passed).toBe(false);
    expect(result.pins.filter((pin) => !pin.ok).map((pin) => pin.position)).toEqual([4, 5]);
    expect(result.summary.en).toBe("Pins 4, 5 do not match T568B.");
  });

  it("never says one standard is faster or better", () => {
    for (const standard of ["T568A", "T568B"] as const) {
      for (const order of [A, B, swap(B, 1, 2)]) {
        const result = checkPlug({ standard, order });
        const text = [result.summary.en, ...result.pins.map((pin) => pin.detail?.en ?? "")].join(" ").toLowerCase();
        expect(text).not.toMatch(/faster|slower|better|worse|speed/);
      }
    }
  });
});

describe("starting order for the plug exercise", () => {
  it("is the eight wires once each, the same for the same seed, and never already a standard", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const order = scrambledWireOrder(seed);
      expect(isValidOrder(order)).toBe(true);
      expect(matchStandard(order)).toBeNull();
      expect(scrambledWireOrder(seed)).toEqual(order);
      seen.add(order.join(","));
    }
    expect(seen.size).toBeGreaterThan(150);
    expect(scrambledWireOrder()).toEqual(scrambledWireOrder(1));
  });
});

describe("ready-made topologies", () => {
  it("each preset replays without a rejection and reaches the virtual internet from its computer", () => {
    expect(networkPresets.map((preset) => preset.id)).toEqual(["home-with-ont", "home-with-gateway"]);
    for (const preset of networkPresets) {
      const built = replay(preset.actions);
      expect(built.rejection, preset.id).toBeUndefined();
      expect(built.applied).toBe(preset.actions.length);
      expect(runConnectivity(built.state, { kind: "ping", fromDeviceId: "pc-1", to: "school.test" }).succeeded, preset.id).toBe(true);
      expect(preset.title.ar.length).toBeGreaterThan(0);
    }
  });
});

describe("a whole cable, end to end", () => {
  it("the same standard on both ends is a straight-through cable, with either standard", () => {
    expect(cable({ order: A }, { order: A })).toMatchObject({ passed: true, wiring: "straight_through", ends: { a: "T568A", b: "T568A" } });
    expect(cable({ order: B }, { order: B })).toMatchObject({ passed: true, wiring: "straight_through", ends: { a: "T568B", b: "T568B" } });
  });

  it("T568A on one end and T568B on the other is a crossover cable, and it passes", () => {
    const result = cable({ order: A }, { order: B });
    expect(result).toMatchObject({ passed: true, wiring: "crossover", ends: { a: "T568A", b: "T568B" } });
    expect(result.pins.map((pin) => pin.farPin)).toEqual([3, 6, 1, 4, 5, 2, 7, 8]);
  });

  it("a factory patch cable passes as straight-through", () => {
    expect(checkCable({})).toMatchObject({ passed: true, wiring: "straight_through" });
  });

  it("an open wire is reported on its pin", () => {
    const result = cable({ order: B, open: [3] }, { order: B });
    expect(result.passed).toBe(false);
    expect(statuses(result)).toEqual(["ok", "ok", "open", "ok", "ok", "ok", "ok", "ok"]);
    expect(result.pins[2].farPin).toBeNull();
    expect(result.summary.en).toBe("Wiremap failed: open on pins 3.");
  });

  it("an open at the far end shows on the pin that leads to it", () => {
    const result = cable({ order: A }, { order: B, open: [1] });
    expect(result.pins.filter((pin) => pin.status === "open").map((pin) => pin.pin)).toEqual([3]);
  });

  it("a short is reported on both bridged pins", () => {
    const result = cable({ order: B, shorted: [[1, 2]] }, { order: B });
    expect(result.passed).toBe(false);
    expect(result.pins.filter((pin) => pin.status === "short").map((pin) => pin.pin)).toEqual([1, 2]);
  });

  it("two wires swapped at one end are reported as swapped, with where each arrives", () => {
    const result = cable({ order: B }, { order: swap(B, 4, 5) });
    expect(result).toMatchObject({ passed: false, wiring: null });
    expect(result.pins.filter((pin) => pin.status === "swapped").map((pin) => [pin.pin, pin.farPin])).toEqual([[4, 5], [5, 4]]);
  });

  it("a split pair: every pin connects straight through, but pins 3 and 6 are not one twisted pair", () => {
    const sequential: WireColor[] = ["white-orange", "orange", "white-green", "green", "white-blue", "blue", "white-brown", "brown"];
    const result = cable({ order: sequential }, { order: sequential });
    expect(result.passed).toBe(false);
    expect(result.pins.every((pin) => pin.farPin === pin.pin)).toBe(true);
    expect(result.pins.filter((pin) => pin.status === "split_pair").map((pin) => pin.pin)).toEqual([3, 4, 5, 6]);
    expect(result.summary.en).toBe("Wiremap failed: split pair on pins 3, 4, 5, 6.");
  });

  it("a cable with one plug still missing connects nothing", () => {
    const result = cable({ order: B }, null);
    expect(result.passed).toBe(false);
    expect(statuses(result).every((status) => status === "open")).toBe(true);
    expect(result.summary.en).toContain("End B has no plug yet");
  });

  it("every failing pin has a sentence in both languages, and no text ranks the standards", () => {
    const results = [cable({ order: B, open: [3], shorted: [[7, 8]] }, { order: swap(B, 1, 2) }), cable({ order: A }, { order: B }), cable({ order: A }, { order: A })];
    for (const result of results) {
      for (const pin of result.pins) {
        if (pin.status !== "ok") expect(pin.detail?.ar.length).toBeGreaterThan(0);
      }
      expect(result.summary.en.toLowerCase()).not.toMatch(/faster|slower|better|worse|speed/);
    }
  });
});

describe("straight-through or crossover depends on the two ports", () => {
  // Two computers plugged into each other: both ports have the same pin layout.
  const pair = (autoMdix: boolean, plugs: "factory" | "crossover"): NetworkState => {
    const actions: NetworkAction[] = [
      { type: "add_device", kind: "wired_client" },
      { type: "add_device", kind: "wired_client" },
      { type: "add_cable", medium: "rj45", terminated: plugs === "crossover" },
      { type: "connect_cable_end", cableId: "cable-1", endId: "a", to: { deviceId: "pc-1", portId: "eth0" } },
      { type: "connect_cable_end", cableId: "cable-1", endId: "b", to: { deviceId: "pc-2", portId: "eth0" } },
      { type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "10.0.0.1", mask: "255.255.255.0" } },
      { type: "set_interface", deviceId: "pc-2", interface: "nic", config: { mode: "static", address: "10.0.0.2", mask: "255.255.255.0" } },
      ...(plugs === "crossover" ? ([{ type: "set_plug", cableId: "cable-1", endId: "a", plug: { order: A } }, { type: "set_plug", cableId: "cable-1", endId: "b", plug: { order: B } }] as NetworkAction[]) : []),
    ];
    const state = build(actions);
    return { ...state, devices: state.devices.map((d, i) => ({ ...d, ports: d.ports.map((p) => ({ ...p, autoMdix: i === 0 ? autoMdix : false })) })) };
  };
  const ping = (state: NetworkState) => runConnectivity(state, { kind: "ping", fromDeviceId: "pc-1", to: "10.0.0.2" });

  it("two like ports without Auto-MDIX do not link over a straight-through cable, and the diagnostic says which cable they need", () => {
    const result = ping(pair(false, "factory"));
    expect(result.succeeded).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ code: "crossover_needed", target: { id: "network:connector:cable-1" } });
    expect(result.diagnostics[0].evidence[0]).toMatchObject({ observed: "straight_through", expected: "crossover" });
  });

  it("the same two ports link over a crossover cable", () => {
    expect(ping(pair(false, "crossover")).succeeded).toBe(true);
  });

  it("when one port has Auto-MDIX, either cable works", () => {
    expect(ping(pair(true, "factory")).succeeded).toBe(true);
    expect(ping(pair(true, "crossover")).succeeded).toBe(true);
  });

  it("through actions alone: two computers of the no_auto_mdix variant need a crossover cable; a standard one adapts", () => {
    const two = (variant: "standard" | "no_auto_mdix", crossover: boolean) =>
      build([
        { type: "add_device", kind: "wired_client", variant },
        { type: "add_device", kind: "wired_client", variant: "no_auto_mdix" },
        { type: "add_cable", medium: "rj45", terminated: true },
        { type: "set_plug", cableId: "cable-1", endId: "a", plug: { order: A } },
        { type: "set_plug", cableId: "cable-1", endId: "b", plug: { order: crossover ? B : A } },
        { type: "connect_cable_end", cableId: "cable-1", endId: "a", to: { deviceId: "pc-1", portId: "eth0" } },
        { type: "connect_cable_end", cableId: "cable-1", endId: "b", to: { deviceId: "pc-2", portId: "eth0" } },
        { type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "10.0.0.1", mask: "255.255.255.0" } },
        { type: "set_interface", deviceId: "pc-2", interface: "nic", config: { mode: "static", address: "10.0.0.2", mask: "255.255.255.0" } },
      ]);
    const fixed = two("no_auto_mdix", false);
    expect(fixed.devices.every((d) => d.ports.every((p) => p.autoMdix === false))).toBe(true);
    expect(fixed.devices[0].name.en).toBe("Computer 1 (no Auto-MDIX)");
    expect(ping(fixed).diagnostics[0]?.code).toBe("crossover_needed");
    expect(ping(two("no_auto_mdix", true)).succeeded).toBe(true);
    expect(ping(two("standard", false)).succeeded).toBe(true);
    const refused = applyAction(fixed, { type: "add_device", kind: "switch", variant: "turbo" as never });
    expect(refused.ok).toBe(false);
  });

  it("a cable that fails its wiremap carries nothing, whatever the ports can do", () => {
    const state = pair(true, "crossover");
    const broken = { ...state, cables: state.cables.map((c) => ({ ...c, plugs: { a: { order: A, open: [1] }, b: { order: B } } })) };
    const result = ping(broken);
    expect(result.succeeded).toBe(false);
    expect(result.diagnostics[0].code).toBe("cable_fault");
    expect(result.diagnostics[0].evidence).toEqual([expect.objectContaining({ observed: "open", expected: "ok" })]);
  });

  it("cable category does not decide whether the link works", () => {
    const state = pair(true, "factory");
    for (const category of ["cat5e", "cat6", "cat6a"] as const) {
      expect(ping({ ...state, cables: state.cables.map((c) => ({ ...c, category })) }).succeeded, category).toBe(true);
    }
  });
});
