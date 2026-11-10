import { describe, expect, it } from "vitest";
import { TARGET_ID_PATTERN } from "@ytl/contracts";
import { resolveInterfaces, runConnectivity } from "./index";
import { HOME_WITH_GATEWAY, HOME_WITH_ONT, build } from "./test-helpers";

const home = build(HOME_WITH_ONT);
const iface = (state: typeof home, deviceId: string, name: string) => resolveInterfaces(state).find((r) => r.deviceId === deviceId && r.interface === name);

describe("a correct ISP -> ONT -> router -> client topology", () => {
  it("the router's WAN side leases a provider address and the clients lease local ones", () => {
    expect(iface(home, "router-1", "wan")).toMatchObject({ source: "dhcp", address: "100.64.0.10", gateway: "100.64.0.1", leasedBy: "isp-1" });
    expect(iface(home, "pc-1", "nic")).toMatchObject({ source: "dhcp", address: "192.168.1.100", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["203.0.113.53"], leasedBy: "router-1" });
    expect(iface(home, "phone-1", "nic")).toMatchObject({ source: "dhcp", address: "192.168.1.101", leasedBy: "router-1" });
  });

  it("a virtual ping to an internet host is delivered, along ISP <- fibre <- ONT <- Ethernet <- router WAN <- LAN <- PC and back", () => {
    const result = runConnectivity(home, { kind: "ping", fromDeviceId: "pc-1", to: "203.0.113.10" });
    expect(result.succeeded).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.journey.outcome).toBe("delivered");
    const links = result.journey.events.filter((e) => e.at.kind === "link").map((e) => (e.at.kind === "link" ? `${e.at.fromNodeId}>${e.at.toNodeId}` : ""));
    expect(links).toEqual([
      "pc-1>router-1", "router-1>ont-1", "ont-1>isp-1",
      "isp-1>ont-1", "ont-1>router-1", "router-1>pc-1",
    ]);
    expect(result.journey.events.every((e) => e.result !== "failed")).toBe(true);
    expect(result.journey.events.at(-1)).toMatchObject({ at: { kind: "node", nodeId: "pc-1" }, result: "ok" });
  });

  it("the journey shows ARP, NAT out and NAT back as events", () => {
    const result = runConnectivity(home, { kind: "ping", fromDeviceId: "pc-1", to: "203.0.113.10" });
    const text = result.journey.events.map((e) => e.message.en);
    expect(text.some((m) => m.includes("(ARP)") && m.includes("192.168.1.1"))).toBe(true);
    expect(text.some((m) => m.includes("(NAT)") && m.includes("192.168.1.100") && m.includes("100.64.0.10"))).toBe(true);
    expect(text.some((m) => m.includes("puts the private address 192.168.1.100 back"))).toBe(true);
  });

  it("the Wi-Fi client reaches the internet too, over its wireless link", () => {
    const result = runConnectivity(home, { kind: "ping", fromDeviceId: "phone-1", to: "203.0.113.20" });
    expect(result.succeeded).toBe(true);
    expect(result.journey.events[2]).toMatchObject({ at: { kind: "link", linkId: "wifi/phone-1", fromNodeId: "phone-1", toNodeId: "router-1" } });
  });

  it("two local devices reach each other directly, without the router's WAN side", () => {
    const result = runConnectivity(home, { kind: "ping", fromDeviceId: "pc-1", to: "192.168.1.101" });
    expect(result.succeeded).toBe(true);
    expect(result.journey.events.some((e) => e.message.en.includes("(NAT)"))).toBe(false);
    expect(result.journey.events.some((e) => e.at.kind === "node" && e.at.nodeId === "isp-1")).toBe(false);
  });

  it("a name is looked up at the virtual DNS server first, then pinged", () => {
    const result = runConnectivity(home, { kind: "ping", fromDeviceId: "pc-1", to: "school.test" });
    expect(result).toMatchObject({ succeeded: true, resolvedAddress: "203.0.113.10" });
    const lookup = runConnectivity(home, { kind: "lookup", fromDeviceId: "pc-1", name: "Library.test" });
    expect(lookup).toMatchObject({ succeeded: true, resolvedAddress: "203.0.113.20" });
    expect(lookup.journey.summary.en).toBe("Library.test is 203.0.113.20.");
  });

  it("every event has a unique ID, both languages, and a well-formed target stamped with the run", () => {
    const result = runConnectivity(home, { kind: "ping", fromDeviceId: "pc-1", to: "school.test" }, { projectRevision: 7, executionId: "ping-1" });
    const ids = result.journey.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const event of result.journey.events) {
      expect(event.message.en.length).toBeGreaterThan(0);
      expect(event.message.ar.length).toBeGreaterThan(0);
      expect(event.target.id).toMatch(TARGET_ID_PATTERN);
      expect(event.target).toMatchObject({ projectRevision: 7, executionId: "ping-1" });
    }
    expect(result.journey.id).toBe("ping-1");
  });
});

describe("an integrated fibre gateway", () => {
  const gateway = build(HOME_WITH_GATEWAY);

  it("is one device with the optical, routing, switching and Wi-Fi roles, and its own kind", () => {
    const device = gateway.devices.find((d) => d.id === "gateway-1")!;
    expect(device.kind).toBe("fiber_gateway");
    expect(device.roles).toEqual(expect.arrayContaining(["optical_termination", "routing", "nat", "dhcp_server", "switching", "wifi_access"]));
    expect(gateway.devices.some((d) => d.kind === "ont" || d.kind === "router")).toBe(false);
  });

  it("works: leases, and a ping to the internet from the wired and the Wi-Fi client", () => {
    expect(iface(gateway, "gateway-1", "wan")).toMatchObject({ source: "dhcp", address: "100.64.0.10" });
    for (const from of ["pc-1", "phone-1"]) {
      const result = runConnectivity(gateway, { kind: "ping", fromDeviceId: from, to: "school.test" });
      expect(result.succeeded, from).toBe(true);
    }
    const path = runConnectivity(gateway, { kind: "ping", fromDeviceId: "pc-1", to: "203.0.113.10" }).journey.events.filter((e) => e.at.kind === "link");
    expect(path.map((e) => (e.at.kind === "link" ? e.at.linkId : ""))).toEqual(["cable-2", "cable-1", "cable-1", "cable-2"]);
  });
});
