import { describe, expect, it } from "vitest";
import type { NetworkAction, NetworkDiagnostic, NetworkState } from "@ytl/contracts";
import { diagnoseNetwork, resolveInterfaces, runConnectivity } from "./index";
import { HOME_WITH_ONT, build } from "./test-helpers";

const home = build(HOME_WITH_ONT);
const INTERNET = "203.0.113.10";
const ping = (state: NetworkState, to = INTERNET, from = "pc-1") => runConnectivity(state, { kind: "ping", fromDeviceId: from, to });
const withActions = (...actions: NetworkAction[]) => build(actions, home);
const staticNic = (address: string, mask: string, gateway: string, dns = ["203.0.113.53"], deviceId = "pc-1"): NetworkAction => ({
  type: "set_interface",
  deviceId,
  interface: "nic",
  config: { mode: "static", address, mask, gateway, dns },
});
/** The journey must end at the place the packet stopped: one failed event, last, carrying the diagnostic's sentence. */
function endsAt(result: ReturnType<typeof ping>, nodeId: string) {
  const failed = result.journey.events.filter((e) => e.result === "failed");
  expect(result.journey.outcome).toBe("failed");
  expect(failed).toHaveLength(1);
  expect(result.journey.events.at(-1)).toBe(failed[0]);
  expect(failed[0].at).toEqual({ kind: "node", nodeId });
  expect(failed[0].reason).toEqual(result.diagnostics[0].message);
  expect(result.journey.summary).toEqual(result.diagnostics[0].message);
}
const complete = (d: NetworkDiagnostic) => d.message.en && d.message.ar && d.explanation.en && d.explanation.ar && d.observation?.en && d.target.id;

const SCENARIOS: Record<string, NetworkState> = {
  disconnected_link: withActions({ type: "disconnect_cable_end", cableId: "cable-3", endId: "b" }),
  wan_lan_swapped: withActions(
    { type: "disconnect_cable_end", cableId: "cable-2", endId: "b" },
    { type: "connect_cable_end", cableId: "cable-2", endId: "b", to: { deviceId: "router-1", portId: "lan-2" } },
  ),
  duplicate_address: withActions(
    { type: "add_device", kind: "wired_client" },
    { type: "add_cable", medium: "rj45" },
    { type: "connect_cable_end", cableId: "cable-4", endId: "a", to: { deviceId: "router-1", portId: "lan-2" } },
    { type: "connect_cable_end", cableId: "cable-4", endId: "b", to: { deviceId: "pc-2", portId: "eth0" } },
    staticNic("192.168.1.50", "255.255.255.0", "192.168.1.1"),
    staticNic("192.168.1.50", "255.255.255.0", "192.168.1.1", ["203.0.113.53"], "pc-2"),
  ),
  wrong_subnet: withActions(staticNic("192.168.1.50", "255.255.255.252", "192.168.1.1")),
  dhcp_disabled: withActions({ type: "set_dhcp_server", deviceId: "router-1", config: { enabled: false, poolStart: "192.168.1.100", poolEnd: "192.168.1.199", mask: "255.255.255.0", gateway: "192.168.1.1", dns: [] } }),
  wrong_gateway: withActions(staticNic("192.168.1.50", "255.255.255.0", "192.168.1.254")),
  dns_failure: withActions(staticNic("192.168.1.50", "255.255.255.0", "192.168.1.1", ["192.168.1.53"])),
};

describe("fault scenarios", () => {
  it("a disconnected link: the packet stops at the computer, pointing at the loose cable end", () => {
    const result = ping(SCENARIOS.disconnected_link);
    // The loose end belongs to no port, so the fault is stated from the computer's side: nothing is in its port.
    expect(result.diagnostics[0]).toMatchObject({ code: "link_disconnected", target: { id: "network:port:pc-1/eth0" } });
    expect(result.diagnostics[0].message.en).toBe("Nothing is plugged into Computer 1, Ethernet.");
    expect(diagnoseNetwork(SCENARIOS.disconnected_link).map((d) => d.target.id)).toContain("network:cable-end:cable-3/b");
    endsAt(result, "pc-1");
  });

  it("a link disconnected further along stops the packet at the router, not at the computer", () => {
    const result = ping(withActions({ type: "disconnect_cable_end", cableId: "cable-2", endId: "a" }));
    expect(result.diagnostics[0]).toMatchObject({ code: "link_disconnected", target: { id: "network:cable-end:cable-2/a" } });
    endsAt(result, "router-1");
    expect(result.journey.events.some((e) => e.at.kind === "link" && e.at.linkId === "cable-3")).toBe(true);
    expect(ping(withActions({ type: "disconnect_cable_end", cableId: "cable-2", endId: "a" }), "192.168.1.101").succeeded).toBe(true);
  });

  it("WAN and LAN swapped: local traffic works, the internet does not, and the diagnostic names the empty WAN port", () => {
    const state = SCENARIOS.wan_lan_swapped;
    const result = ping(state);
    expect(result.diagnostics[0]).toMatchObject({ code: "wan_lan_swapped", target: { id: "network:port:router-1/wan" } });
    expect(result.diagnostics[0].evidence[0]).toMatchObject({ observed: "LAN 2", expected: "WAN" });
    endsAt(result, "router-1");
    expect(ping(state, "192.168.1.101").succeeded).toBe(true);
  });

  it("a duplicate address: the packet does not leave, and both devices are named", () => {
    const result = ping(SCENARIOS.duplicate_address);
    expect(result.diagnostics[0].code).toBe("duplicate_address");
    expect(result.diagnostics[0].message.en).toContain("192.168.1.50");
    expect([result.diagnostics[0].target.id, ...result.diagnostics[0].relatedTargets.map((t) => t.id)].sort()).toEqual(["network:setting:pc-1/nic.address", "network:setting:pc-2/nic.address"]);
    endsAt(result, "pc-1");
  });

  it("a wrong subnet mask: the gateway falls outside the computer's network, and the mask is what is named", () => {
    const result = ping(SCENARIOS.wrong_subnet);
    expect(result.diagnostics[0]).toMatchObject({ code: "subnet_mismatch", target: { id: "network:setting:pc-1/nic.mask" } });
    expect(result.diagnostics[0].evidence.map((e) => e.observed)).toEqual(["192.168.1.50/30", "192.168.1.1/24"]);
    endsAt(result, "pc-1");
  });

  it("an address from another network is also a subnet fault, naming the address", () => {
    const result = ping(withActions(staticNic("192.168.2.50", "255.255.255.0", "192.168.1.1")));
    expect(result.diagnostics[0]).toMatchObject({ code: "subnet_mismatch", target: { id: "network:setting:pc-1/nic.address" } });
  });

  it("DHCP disabled: the computer has no address, and the diagnostic points at the router's DHCP switch", () => {
    const state = SCENARIOS.dhcp_disabled;
    expect(resolveInterfaces(state).find((r) => r.deviceId === "pc-1")).toMatchObject({ source: "none" });
    const result = ping(state);
    expect(result.diagnostics[0]).toMatchObject({ code: "dhcp_disabled", target: { id: "network:setting:router-1/dhcp.enabled" } });
    endsAt(result, "pc-1");
    expect(result.journey.events).toHaveLength(1);
  });

  it("a wrong gateway: the local network works, the internet does not, and the right gateway is given as evidence", () => {
    const state = SCENARIOS.wrong_gateway;
    const result = ping(state);
    expect(result.diagnostics[0]).toMatchObject({ code: "gateway_wrong", target: { id: "network:setting:pc-1/nic.gateway" } });
    expect(result.diagnostics[0].evidence[0]).toMatchObject({ observed: "192.168.1.254", expected: "192.168.1.1" });
    endsAt(result, "pc-1");
    const phone = resolveInterfaces(state).find((r) => r.deviceId === "phone-1")!.address!;
    expect(ping(state, phone).succeeded).toBe(true);
  });

  it("a DNS failure: the numeric address works while the name does not", () => {
    const state = SCENARIOS.dns_failure;
    expect(ping(state, INTERNET).succeeded).toBe(true);
    const byName = ping(state, "school.test");
    expect(byName.succeeded).toBe(false);
    expect(byName.diagnostics[0]).toMatchObject({ code: "dns_unreachable", target: { id: "network:setting:pc-1/nic.dns" } });
    expect(byName.diagnostics[0].evidence[0].observed).toBe("192.168.1.53");
    expect(byName.journey.outcome).toBe("failed");
    expect(byName.journey.events.at(-1)?.result).toBe("failed");
  });

  it("the three DNS failures are told apart: no server set, no server answering, and a name the server does not know", () => {
    const noServer = withActions({ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.1" } });
    expect(ping(noServer, "school.test").diagnostics[0].code).toBe("dns_not_configured");
    expect(ping(noServer, INTERNET).succeeded).toBe(true);
    expect(ping(SCENARIOS.dns_failure, "school.test").diagnostics[0].code).toBe("dns_unreachable");
    const unknown = ping(home, "nowhere.test");
    expect(unknown.diagnostics[0].code).toBe("dns_name_unknown");
    expect(unknown.journey.events.at(-1)).toMatchObject({ at: { kind: "node", nodeId: "isp-1" }, result: "failed" });
  });

  it("the seven faults are distinguishable: each gives a different first diagnostic code", () => {
    const first = Object.fromEntries(
      Object.entries(SCENARIOS).map(([name, state]) => [name, ping(state, name === "dns_failure" ? "school.test" : INTERNET).diagnostics[0].code]),
    );
    expect(first).toEqual({
      disconnected_link: "link_disconnected",
      wan_lan_swapped: "wan_lan_swapped",
      duplicate_address: "duplicate_address",
      wrong_subnet: "subnet_mismatch",
      dhcp_disabled: "dhcp_disabled",
      wrong_gateway: "gateway_wrong",
      dns_failure: "dns_unreachable",
    });
    expect(new Set(Object.values(first)).size).toBe(7);
  });

  it("every fault diagnostic has a symptom, a message, a rule and a target, in both languages", () => {
    for (const [name, state] of Object.entries(SCENARIOS)) {
      const result = ping(state, name === "dns_failure" ? "school.test" : INTERNET);
      expect(Boolean(complete(result.diagnostics[0])), name).toBe(true);
    }
  });

  it("the symptom (hint level 1) does not name the cause", () => {
    const banned: Record<string, RegExp> = {
      wan_lan_swapped: /wan|lan|port/i,
      duplicate_address: /duplicate|same address/i,
      wrong_subnet: /mask|subnet/i,
      dhcp_disabled: /dhcp/i,
      wrong_gateway: /gateway/i,
      dns_failure: /dns/i,
    };
    for (const [name, pattern] of Object.entries(banned)) {
      const result = ping(SCENARIOS[name], name === "dns_failure" ? "school.test" : INTERNET);
      expect(result.diagnostics[0].observation?.en, name).not.toMatch(pattern);
    }
  });
});

describe("other faults along the way", () => {
  it("NAT switched off: the provider drops the packet and the diagnostic points at the router's NAT setting", () => {
    const result = ping(withActions({ type: "set_nat", deviceId: "router-1", enabled: false }));
    expect(result.diagnostics[0]).toMatchObject({ code: "nat_disabled", target: { id: "network:setting:router-1/nat" } });
    endsAt(result, "isp-1");
  });

  it("a device that is switched off takes its links down", () => {
    const result = ping(withActions({ type: "set_power", deviceId: "ont-1", powered: false }));
    expect(result.succeeded).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ code: "device_off", target: { id: "network:component:ont-1" } });
  });

  it("a Wi-Fi client with the wrong passphrase does not join, and says why", () => {
    const result = ping(withActions({ type: "set_wifi_client", deviceId: "phone-1", ssid: "HomeLab", passphrase: "wrong" }), INTERNET, "phone-1");
    expect(result.diagnostics[0]).toMatchObject({ code: "wifi_not_joined", target: { id: "network:setting:phone-1/wifiClient" } });
    expect(result.diagnostics[0].message.en).toContain("passphrase does not match");
  });

  it("an address nobody has is host_unreachable, locally and in the virtual internet", () => {
    expect(ping(home, "192.168.1.77").diagnostics[0].code).toBe("host_unreachable");
    const far = ping(home, "198.51.100.9");
    expect(far.diagnostics[0].code).toBe("host_unreachable");
    expect(far.journey.events.at(-1)).toMatchObject({ at: { kind: "node", nodeId: "isp-1" }, result: "failed" });
  });

  it("a test from something that is not a client is refused without events", () => {
    const result = runConnectivity(home, { kind: "ping", fromDeviceId: "switch-9", to: INTERNET });
    expect(result).toMatchObject({ succeeded: false, journey: { events: [], outcome: "failed" } });
    expect(result.diagnostics[0].code).toBe("unknown_reference");
  });
});

describe("the standing check", () => {
  const codes = (state: NetworkState) => diagnoseNetwork(state).map((d) => d.code);

  it("a correct topology has no findings", () => {
    expect(diagnoseNetwork(home)).toEqual([]);
  });

  it("finds each fault without a ping, with the same code and ID the ping reports", () => {
    for (const name of ["disconnected_link", "wan_lan_swapped", "duplicate_address", "wrong_subnet", "dhcp_disabled", "wrong_gateway"]) {
      const fromPing = ping(SCENARIOS[name]).diagnostics[0];
      const standing = diagnoseNetwork(SCENARIOS[name]);
      expect(standing.map((d) => d.id), name).toContain(fromPing.id);
    }
  });

  it("flags a missing DNS server as a warning and NAT being off as blocking", () => {
    const noDns = withActions({ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.1" } });
    expect(diagnoseNetwork(noDns)).toEqual([expect.objectContaining({ code: "dns_not_configured", severity: "warning" })]);
    expect(codes(withActions({ type: "set_nat", deviceId: "router-1", enabled: false }))).toEqual(["nat_disabled"]);
  });

  it("stamps targets with the revision it was computed for", () => {
    const found = diagnoseNetwork(SCENARIOS.wrong_gateway, { projectRevision: 12 });
    expect(found[0].target.projectRevision).toBe(12);
    expect(found[0].target.executionId).toBeUndefined();
  });
});
