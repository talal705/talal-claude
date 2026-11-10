import { describe, expect, it } from "vitest";
import { TARGET_ID_PATTERN, networkTarget, type NetworkAction } from "@ytl/contracts";
import { applyAction, cablePortOptions, canRedo, canUndo, createHistory, createNetwork, dispatch, redo, replay, runConnectivity, timelineLog, toProjectData, undo } from "./index";
import { HOME_WITH_ONT, build } from "./test-helpers";

const home = build(HOME_WITH_ONT);
const rejected = (action: NetworkAction, from = home) => {
  const result = applyAction(from, action);
  if (result.ok) throw new Error("expected a rejection");
  expect(result.state).toBe(from);
  return result.rejection;
};

describe("devices and roles", () => {
  it("gives deterministic IDs and generic names, and keeps roles separate from kind", () => {
    expect(home.devices.map((d) => d.id)).toEqual(["isp-1", "ont-1", "router-1", "pc-1", "phone-1"]);
    expect(home.devices.every((d) => d.kind === "isp" || d.kind.endsWith("client") || d.name.en.startsWith("Generic"))).toBe(true);
    const roles = Object.fromEntries(home.devices.map((d) => [d.kind, d.roles]));
    expect(roles.ont).toEqual(["optical_termination"]);
    expect(roles.router).toEqual(["routing", "nat", "dhcp_server", "switching", "wifi_access"]);
    expect(build([{ type: "add_device", kind: "switch" }, { type: "add_device", kind: "access_point" }]).devices.map((d) => d.roles)).toEqual([["switching"], ["wifi_access"]]);
  });

  it("ports have identities, a medium and a side: fibre and RJ45, WAN and LAN are not interchangeable labels", () => {
    const router = home.devices.find((d) => d.id === "router-1")!;
    expect(router.ports.map((p) => [p.id, p.medium, p.role])).toEqual([["wan", "rj45", "wan"], ["lan-1", "rj45", "lan"], ["lan-2", "rj45", "lan"], ["lan-3", "rj45", "lan"], ["lan-4", "rj45", "lan"]]);
    const ont = home.devices.find((d) => d.id === "ont-1")!;
    expect(ont.ports.map((p) => [p.id, p.medium, p.role])).toEqual([["pon", "fiber", "pon"], ["eth", "rj45", "uplink"]]);
  });

  it("IDs are not reused after a removal, and only one provider can exist", () => {
    const state = build([{ type: "remove_device", deviceId: "pc-1" }, { type: "add_device", kind: "wired_client" }, { type: "add_device", kind: "wired_client" }], home);
    expect(state.devices.filter((d) => d.kind === "wired_client").map((d) => d.id)).toEqual(["pc-1", "pc-2"]);
    expect(rejected({ type: "add_device", kind: "isp" }).code).toBe("not_supported");
  });

  it("removing a device leaves its cables loose at that end", () => {
    const state = build([{ type: "remove_device", deviceId: "router-1" }], home);
    expect(state.cables.find((c) => c.id === "cable-2")!.ends).toEqual({ a: { deviceId: "ont-1", portId: "eth" }, b: null });
    expect(state.cables.find((c) => c.id === "cable-3")!.ends).toEqual({ a: null, b: { deviceId: "pc-1", portId: "eth0" } });
  });
});

describe("cabling rules", () => {
  it("a fibre connector does not go into an RJ45 port, nor an RJ45 plug into a fibre port", () => {
    const loose = build([{ type: "add_cable", medium: "fiber" }, { type: "add_cable", medium: "rj45" }], home);
    const fibre = rejected({ type: "connect_cable_end", cableId: "cable-4", endId: "a", to: { deviceId: "router-1", portId: "lan-2" } }, loose);
    expect(fibre.code).toBe("medium_mismatch");
    expect(fibre.message.en).toBe("A fibre connector does not fit Generic home router 1, LAN 2, which is an Ethernet (RJ45) port.");
    const copper = rejected({ type: "connect_cable_end", cableId: "cable-5", endId: "a", to: { deviceId: "isp-1", portId: "drop-2" } }, loose);
    expect(copper.code).toBe("medium_mismatch");
  });

  it("a port takes one cable, an end goes into one port, and a cable does not loop into its own device", () => {
    const loose = build([{ type: "add_cable", medium: "rj45" }], home);
    expect(rejected({ type: "connect_cable_end", cableId: "cable-4", endId: "a", to: { deviceId: "router-1", portId: "lan-1" } }, loose).code).toBe("port_occupied");
    expect(rejected({ type: "connect_cable_end", cableId: "cable-3", endId: "a", to: { deviceId: "router-1", portId: "lan-2" } }).code).toBe("cable_end_occupied");
    const half = build([{ type: "connect_cable_end", cableId: "cable-4", endId: "a", to: { deviceId: "router-1", portId: "lan-2" } }], loose);
    expect(rejected({ type: "connect_cable_end", cableId: "cable-4", endId: "b", to: { deviceId: "router-1", portId: "lan-3" } }, half).code).toBe("not_supported");
    expect(rejected({ type: "connect_cable_end", cableId: "cable-9", endId: "a", to: { deviceId: "router-1", portId: "lan-2" } }).code).toBe("unknown_reference");
  });

  it("the port list for a loose end names every port, with the reason for each one that cannot take it", () => {
    const loose = build([{ type: "add_cable", medium: "rj45" }], home);
    const options = cablePortOptions(loose, "cable-4", "a");
    expect(options).toHaveLength(loose.devices.reduce((sum, d) => sum + d.ports.length, 0));
    const byId = Object.fromEntries(options.map((o) => [`${o.to.deviceId}/${o.to.portId}`, o]));
    expect(byId["router-1/lan-2"]).toMatchObject({ ok: true, label: { en: "Generic home router 1, LAN 2" } });
    expect(byId["router-1/lan-1"]).toMatchObject({ ok: false, reason: { en: "Generic home router 1, LAN 1 already has a cable." } });
    expect(byId["isp-1/drop-2"].reason?.en).toContain("fibre port");
    expect(options.filter((o) => !o.ok).every((o) => o.reason && o.reason.ar.length > 0)).toBe(true);
  });

  it("an option marked ok is accepted by the reducer, and one marked not ok is rejected with the same reason", () => {
    const loose = build([{ type: "add_cable", medium: "rj45" }], home);
    for (const option of cablePortOptions(loose, "cable-4", "a")) {
      const result = applyAction(loose, { type: "connect_cable_end", cableId: "cable-4", endId: "a", to: option.to });
      expect(result.ok).toBe(option.ok);
      if (!result.ok) expect(result.rejection.message).toEqual(option.reason);
    }
  });

  it("an end that is already plugged in has no options until it is unplugged", () => {
    expect(cablePortOptions(home, "cable-3", "a")).toEqual([]);
    const unplugged = build([{ type: "disconnect_cable_end", cableId: "cable-3", endId: "a" }], home);
    expect(cablePortOptions(unplugged, "cable-3", "a").some((o) => o.ok)).toBe(true);
  });

  it("only a cable the learner terminates takes plugs; fibre is never crimped", () => {
    expect(rejected({ type: "set_plug", cableId: "cable-3", endId: "a", plug: { order: ["blue", "orange", "green", "brown", "white-blue", "white-orange", "white-green", "white-brown"] } }).code).toBe("not_supported");
    expect(rejected({ type: "add_cable", medium: "fiber", terminated: true }).message.en).toContain("Fibre is not terminated with an RJ45 crimp");
    const made = build([{ type: "add_cable", medium: "rj45", category: "cat6", terminated: true }], home);
    expect(made.cables.at(-1)).toMatchObject({ category: "cat6", plugs: { a: null, b: null } });
    expect(rejected({ type: "set_plug", cableId: "cable-4", endId: "a", plug: { order: ["blue", "blue", "green", "brown", "white-blue", "white-orange", "white-green", "white-brown"] } }, made).code).toBe("invalid_plug");
  });
});

describe("configuration", () => {
  it("rejects text that is not an address or a mask, naming the field", () => {
    const bad = rejected({ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.300", mask: "255.255.255.0" } });
    expect(bad).toMatchObject({ code: "invalid_address", target: { id: "network:setting:pc-1/nic.address" } });
    expect(rejected({ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.3", mask: "255.0.255.0" } }).target.id).toBe("network:setting:pc-1/nic.mask");
    expect(rejected({ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "dhcp", dns: ["dns.example"] } }).target.id).toBe("network:setting:pc-1/nic.dns");
  });

  it("rejects a setting the device does not have", () => {
    expect(rejected({ type: "set_interface", deviceId: "pc-1", interface: "wan", config: { mode: "dhcp" } }).code).toBe("not_supported");
    expect(rejected({ type: "set_nat", deviceId: "pc-1", enabled: false }).code).toBe("not_supported");
    expect(rejected({ type: "set_wifi", deviceId: "ont-1", config: { enabled: true, ssid: "x", passphrase: "y" } }).code).toBe("not_supported");
    expect(rejected({ type: "set_dhcp_server", deviceId: "router-1", config: { enabled: true, poolStart: "192.168.1.200", poolEnd: "192.168.1.100", mask: "255.255.255.0", gateway: "192.168.1.1", dns: [] } }).code).toBe("invalid_address");
  });

  it("every target the engine builds is a well-formed tutor target ID", () => {
    const refs = [networkTarget.device("router-1"), networkTarget.port({ deviceId: "router-1", portId: "lan-2" }), networkTarget.cable("cable-2"), networkTarget.cableEnd("cable-2", "a"), networkTarget.wifiLink("phone-1"), networkTarget.setting("pc-1", "nic.gateway")];
    for (const ref of refs) expect(ref.id).toMatch(TARGET_ID_PATTERN);
  });
});

describe("undo, redo and replay", () => {
  it("each accepted action is one undo step; a rejected action is none", () => {
    let history = createHistory();
    for (const action of HOME_WITH_ONT) history = dispatch(history, action).history;
    expect(history.present).toEqual(home);
    const before = history;
    const refused = dispatch(history, { type: "add_device", kind: "isp" });
    expect(refused.result.ok).toBe(false);
    expect(refused.history).toBe(before);
    const undone = undo(history);
    expect(undone.present.devices.find((d) => d.id === "phone-1")!.config.wifiClient).toEqual({ ssid: "", passphrase: "" });
    expect(canRedo(undone)).toBe(true);
    expect(redo(undone).present).toEqual(home);
    expect(canUndo(createHistory())).toBe(false);
  });

  it("a new action after an undo drops the undone future from the log", () => {
    let history = createHistory();
    for (const action of HOME_WITH_ONT) history = dispatch(history, action).history;
    history = undo(undo(history));
    history = dispatch(history, { type: "set_power", deviceId: "pc-1", powered: false }).history;
    expect(canRedo(history)).toBe(false);
    expect(timelineLog(history)).toHaveLength(HOME_WITH_ONT.length - 1);
    expect(replay(timelineLog(history)).state).toEqual(history.present);
  });

  it("replaying the saved log on an empty network reproduces the state", () => {
    let history = createHistory();
    for (const action of HOME_WITH_ONT) history = dispatch(history, action).history;
    const data = toProjectData(history);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    const again = replay(data.log, createNetwork());
    expect(again).toMatchObject({ applied: HOME_WITH_ONT.length });
    expect(again.state).toEqual(data.state);
  });

  it("a packet journey can be replayed deterministically: same state and request, same events", () => {
    const request = { kind: "ping", fromDeviceId: "pc-1", to: "school.test" } as const;
    const context = { projectRevision: 3, executionId: "run-1" };
    const first = runConnectivity(home, request, context);
    const second = runConnectivity(home, request, context);
    const rebuilt = runConnectivity(replay(HOME_WITH_ONT).state, request, context);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(first));
    expect(first.journey.events.length).toBeGreaterThan(10);
  });

  it("a failed journey is just as repeatable", () => {
    const broken = build([{ type: "set_nat", deviceId: "router-1", enabled: false }], home);
    const request = { kind: "ping", fromDeviceId: "phone-1", to: "203.0.113.20" } as const;
    expect(JSON.stringify(runConnectivity(broken, request))).toBe(JSON.stringify(runConnectivity(broken, request)));
  });

  it("the engine does not change the state it is given", () => {
    const frozen = JSON.stringify(home);
    runConnectivity(home, { kind: "ping", fromDeviceId: "pc-1", to: "school.test" });
    applyAction(home, { type: "set_power", deviceId: "pc-1", powered: false });
    expect(JSON.stringify(home)).toBe(frozen);
  });
});
