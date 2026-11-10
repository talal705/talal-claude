import { describe, expect, it } from "vitest";
import type { NetworkAction, PCAction } from "@ytl/contracts";
import { network, pc } from "@ytl/simulation";
import { pcCatalog, pcPresets } from "../../../content/catalog";
import { checkStep, selectDevice } from "./checkers";
import type { CheckSpec, LessonEvidence } from "./contract";

const label = (en: string) => ({ en, ar: `${en} (ar)` });

// ---------- PC, against the real engine and catalog ----------
const amd = pcPresets.find((preset) => preset.id === "i5-ddr4-air")!;
const pcAfter = (...more: PCAction[]): LessonEvidence => ({ lab: "pc", state: pc.replay([...amd.actions, ...more], pcCatalog).state, catalog: pcCatalog });
const built = pcAfter();
const started = pcAfter({ type: "press_power" });

describe("PC conditions are decided by the PC engine", () => {
  it("counts parts of a category, optionally only the ones that are seated", () => {
    expect(checkStep({ type: "pc.part_count", label: label("Two memory modules"), category: "ram", min: 2, max: 2 }, built)).toMatchObject({ passed: true, lines: [{ observed: "2" }] });
    expect(checkStep({ type: "pc.part_count", label: label("Three"), category: "ram", min: 3 }, built).passed).toBe(false);
    const oneLoose = pcAfter({ type: "set_seating", instanceId: "ram-4", seating: "placed" });
    expect(checkStep({ type: "pc.part_count", label: label("Two seated"), category: "ram", min: 2, mounted: true }, oneLoose)).toMatchObject({ passed: false, lines: [{ observed: "1" }] });
  });

  it("reads which slots hold fully seated memory", () => {
    const spec: CheckSpec = { type: "pc.memory_slots", label: label("Memory in A2 and B2"), slots: ["dimm-b2", "dimm-a2"] };
    expect(checkStep(spec, built)).toMatchObject({ passed: true, lines: [{ observed: "dimm-a2, dimm-b2" }] });
    const half = pcAfter({ type: "set_seating", instanceId: "ram-5", seating: "partial" });
    expect(checkStep(spec, half)).toMatchObject({ passed: false, lines: [{ observed: "dimm-a2" }] });
    expect(checkStep({ ...spec, slots: ["dimm-a1", "dimm-b1"] }, built).passed).toBe(false);
  });

  it("the startup condition needs the power button pressed and the engine's staged result", () => {
    const firmware: CheckSpec = { type: "pc.startup", label: label("Reaches the firmware screen or further"), stagePassed: "firmware_display" };
    expect(checkStep(firmware, built)).toMatchObject({ passed: false, lines: [{ observed: "idle; screen off" }] });
    expect(checkStep(firmware, started).passed).toBe(true);
    expect(checkStep({ type: "pc.startup", label: label("Boots"), outcome: ["operational"], screen: ["operating_system"] }, started).passed).toBe(true);
    const noRam = pcAfter({ type: "unmount_part", instanceId: "ram-4" }, { type: "unmount_part", instanceId: "ram-5" }, { type: "press_power" });
    const result = checkStep(firmware, noRam);
    expect(result.passed).toBe(false);
    expect(result.lines[0].observed).toContain("no_post");
  });

  it("no_diagnostic passes only while the engine reports none of the named findings", () => {
    const spec: CheckSpec = { type: "pc.no_diagnostic", label: label("The side panel is closed"), codes: ["side_panel_open"] };
    const engineSays = (evidence: LessonEvidence) => evidence.lab === "pc" && pc.diagnoseBuild(evidence.state, evidence.catalog).some((d) => d.code === "side_panel_open");
    for (const evidence of [built, pcAfter({ type: "set_side_panel", open: true }), pcAfter({ type: "set_side_panel", open: false })]) {
      expect(checkStep(spec, evidence).passed).toBe(!engineSays(evidence));
    }
  });
});

// ---------- Network, against the real engine ----------
const home = network.replay(network.HOME_WITH_ONT).state;
const net = (...more: NetworkAction[]): LessonEvidence => ({ lab: "network", state: network.replay(more, home).state });

describe("network conditions are decided by the network engine", () => {
  it("selects a device by ID or as the n-th of its kind", () => {
    expect(selectDevice(home, { id: "router-1" })?.kind).toBe("router");
    expect(selectDevice(home, { kind: "wired_client" })?.id).toBe("pc-1");
    expect(selectDevice(home, { kind: "wired_client", index: 1 })).toBeUndefined();
  });

  it("a link condition needs a link that carries frames, at ports of the stated roles", () => {
    const spec: CheckSpec = { type: "net.link", label: label("ONT into the router's WAN port"), a: { kind: "ont", portRole: "uplink" }, b: { kind: "router", portRole: "wan" } };
    expect(checkStep(spec, net()).passed).toBe(true);
    const swapped = net({ type: "disconnect_cable_end", cableId: "cable-2", endId: "b" }, { type: "connect_cable_end", cableId: "cable-2", endId: "b", to: { deviceId: "router-1", portId: "lan-2" } });
    expect(checkStep(spec, swapped)).toMatchObject({ passed: false, lines: [{ observed: "no working link" }] });
    expect(checkStep(spec, net({ type: "set_power", deviceId: "ont-1", powered: false })).passed).toBe(false);
  });

  it("an address condition reads what the engine resolved, and where it came from", () => {
    const spec: CheckSpec = { type: "net.address", label: label("The computer got an address by DHCP"), device: { kind: "wired_client" }, interface: "nic", source: "dhcp" };
    expect(checkStep(spec, net())).toMatchObject({ passed: true, lines: [{ observed: "192.168.1.100 (dhcp)" }] });
    const typed = net({ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0" } });
    expect(checkStep(spec, typed)).toMatchObject({ passed: false, lines: [{ observed: "192.168.1.50 (static)" }] });
    const off = net({ type: "set_dhcp_server", deviceId: "router-1", config: { enabled: false, poolStart: "192.168.1.100", poolEnd: "192.168.1.199", mask: "255.255.255.0", gateway: "192.168.1.1", dns: [] } });
    expect(checkStep(spec, off)).toMatchObject({ passed: false, lines: [{ observed: "no address" }] });
  });

  it("a ping condition runs the virtual ping; a fault exercise can also require that it fails", () => {
    const reaches: CheckSpec = { type: "net.ping", label: label("The computer reaches the internet host"), from: { kind: "wired_client" }, to: "203.0.113.10", succeeds: true };
    expect(checkStep(reaches, net()).passed).toBe(true);
    const noNat = net({ type: "set_nat", deviceId: "router-1", enabled: false });
    expect(checkStep(reaches, noNat)).toMatchObject({ passed: false, lines: [{ observed: "nat_disabled" }] });
    expect(checkStep({ ...reaches, succeeds: false }, noNat).passed).toBe(true);
  });

  it("no_diagnostic follows the standing check", () => {
    expect(checkStep({ type: "net.no_diagnostic", label: label("Nothing blocks the network") }, net()).passed).toBe(true);
    const wrong = net({ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.254", dns: ["203.0.113.53"] } });
    expect(checkStep({ type: "net.no_diagnostic", label: label("Nothing blocks the network") }, wrong)).toMatchObject({ passed: false, lines: [{ observed: "gateway_wrong" }] });
    expect(checkStep({ type: "net.no_diagnostic", label: label("No duplicate"), codes: ["duplicate_address"] }, wrong).passed).toBe(true);
    expect(checkStep({ type: "net.device_count", label: label("A router"), kind: "router", min: 1 }, net()).passed).toBe(true);
  });
});

describe("combining and guarding", () => {
  const two: CheckSpec = { type: "all", label: label("Both"), of: [{ type: "choice", label: label("Names the cause"), correctOptionId: "gateway" }, { type: "choice", label: label("Second"), correctOptionId: "x" }] };

  it("all needs every part, any needs one, and every leaf is listed with its own outcome", () => {
    const result = checkStep(two, { lab: "choice", optionId: "gateway" });
    expect(result.passed).toBe(false);
    expect(result.lines.map((line) => [line.label.en, line.passed])).toEqual([["Names the cause", true], ["Second", false]]);
    expect(checkStep({ ...two, type: "any" }, { lab: "choice", optionId: "gateway" }).passed).toBe(true);
  });

  it("evidence from another lab never passes a condition", () => {
    expect(checkStep({ type: "choice", label: label("x"), correctOptionId: "a" }, built)).toMatchObject({ passed: false, lines: [{ observed: "no evidence for this lab" }] });
    expect(checkStep({ type: "pc.part_count", label: label("x"), category: "ram", min: 0 }, net()).passed).toBe(false);
    expect(checkStep({ type: "net.device_count", label: label("x"), kind: "router", min: 0 }, { lab: "choice", optionId: "a" }).passed).toBe(false);
  });

  it("checking does not change the evidence", () => {
    const before = JSON.stringify(started);
    checkStep({ type: "pc.startup", label: label("x"), stagePassed: "post" }, started);
    expect(JSON.stringify(started)).toBe(before);
  });
});
