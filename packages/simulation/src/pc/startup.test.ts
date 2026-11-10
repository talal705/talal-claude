import { describe, expect, it } from "vitest";
import { TARGET_ID_PATTERN, type PCAction, type PCCatalog } from "@ytl/contracts";
import { pcCatalog } from "../../../../content/catalog";
import { pcPresets } from "../../../../content/catalog/presets";
import { LOAD_MODEL, diagnoseBuild, evaluateStartup, replay } from "./index";
import { A, B, codes, preset, run, start, statuses } from "./test-helpers";

const ALL_PASSED = ["passed", "passed", "passed", "passed", "passed"];

describe("valid builds", () => {
  it("every preset action is accepted by the reducer", () => {
    for (const p of pcPresets) {
      const r = replay(p.actions, pcCatalog);
      expect(r.events.filter((e) => !e.accepted).map((e) => [p.id, e.action.type, e.rejection?.code])).toEqual([]);
      expect(r.state.rgbPreference).toBe(p.rgb);
    }
  });

  it("starter B (Core i7, DDR5, RGB, AIO) passes all five stages without a monitor or display cable", () => {
    const r = start(preset("i7-ddr5-rgb-aio"));
    expect(r.outcome).toBe("operational");
    expect(r.stages.map((s) => s.stage)).toEqual(["power", "post", "firmware_display", "boot_device", "operating_load"]);
    expect(statuses(r)).toEqual(ALL_PASSED);
    expect(r.observable.screen).toBe("operating_system");
    expect(r.observable.spinning.sort()).toEqual([A.aio, A.fan, A.ff1, A.ff2].sort());
    // Lit: exactly the parts that have lighting hardware.
    expect(r.observable.lighting.map((l) => [l.instanceId, l.lit, l.reason])).toEqual([
      [A.ram1, true, "lit"],
      [A.ram2, true, "lit"],
      [A.aio, true, "lit"],
      [A.gpu, true, "lit"],
      [A.fan, true, "lit"],
    ]);
    expect(r.model).toBe("educational");
    expect(r.disclaimer.en).toMatch(/not firmware emulation/);
    expect(r.disclaimer.ar.length).toBeGreaterThan(20);
  });

  it("starter A (Core i5, DDR4, air) passes all five stages, nothing is lit, and no monitor is involved", () => {
    const r = start(preset("i5-ddr4-air"));
    expect(r.outcome).toBe("operational");
    expect(statuses(r)).toEqual(ALL_PASSED);
    expect(r.observable.lighting).toEqual([]);
    expect(r.observable.spinning.sort()).toEqual([B.cooler, B.fan, B.ff1, B.ff2].sort());
  });

  it("the case's factory-fitted fans are parts of their own: taken out, moved and still turning", () => {
    const base = run(preset("i5-ddr4-air"), [{ type: "set_side_panel", open: true }]);
    const moved = run(base, [
      { type: "unmount_part", instanceId: B.ff2 },
      { type: "mount_part", instanceId: B.ff2, target: { hostInstanceId: B.pc, mountPointId: "fan-top-1" } },
      { type: "set_seating", instanceId: B.ff2, seating: "seated" },
      { type: "set_fasteners", instanceId: B.ff2, secured: 4 },
      { type: "set_side_panel", open: false },
    ]);
    expect(moved.parts.find((p) => p.instanceId === B.ff2)!.attachments[0]!.target.mountPointId).toBe("fan-top-1");
    const r = start(moved);
    expect(r.outcome).toBe("operational");
    expect(r.observable.spinning).toContain(B.ff2);
    // Removed altogether, the computer still works: case fans never decide success.
    expect(start(run(base, [{ type: "remove_part", instanceId: B.ff1 }, { type: "remove_part", instanceId: B.ff2 }, { type: "set_side_panel", open: false }])).outcome).toBe("operational");
  });

  it("neither starter contains a monitor or a display cable", () => {
    for (const p of pcPresets) {
      const state = replay(p.actions, pcCatalog).state;
      const entries = state.parts.map((part) => pcCatalog.entries.find((e) => e.id === part.catalogId)!);
      expect(entries.filter((e) => e.category === "monitor"), p.id).toEqual([]);
      const cableKinds = state.cables.map((c) => pcCatalog.entries.find((e) => e.id === c.catalogId)!.cables.find((x) => x.id === c.cableSpecId)!.kind);
      expect(cableKinds.filter((k) => k === "display"), p.id).toEqual([]);
    }
  });

  it("turning RGB off gives the same evaluation: lighting is never a startup requirement", () => {
    const lit = preset("i7-ddr5-rgb-aio");
    const dark = run(lit, [{ type: "set_rgb_preference", preference: "without_rgb" }]);
    const a = start(lit);
    const b = start(dark);
    expect(b.outcome).toBe(a.outcome);
    expect(statuses(b)).toEqual(statuses(a));
    expect(b.loadModel).toEqual(a.loadModel);
    expect(b.advisories.map((d) => d.id)).toEqual(a.advisories.map((d) => d.id));
    expect(b.observable.lighting.every((l) => !l.lit && l.reason === "preference_without_rgb" && l.color === null)).toBe(true);
  });

  it("a finished preset leaves no blocking finding, and its advisories are optional notes only", () => {
    for (const p of pcPresets) {
      const found = diagnoseBuild(replay(p.actions, pcCatalog).state, pcCatalog);
      expect(found.filter((d) => d.severity === "blocking")).toEqual([]);
      expect(found.every((d) => TARGET_ID_PATTERN.test(d.target.id))).toBe(true);
    }
    const codesB = diagnoseBuild(preset("i5-ddr4-air"), pcCatalog).map((d) => d.code);
    expect(codesB).toEqual(["ram_profile_note"]);
  });

  it("does nothing until the power button is pressed", () => {
    const r = evaluateStartup(preset("i5-ddr4-air"), pcCatalog);
    expect(r.outcome).toBe("idle");
    expect(statuses(r)).toEqual(["not_reached", "not_reached", "not_reached", "not_reached", "not_reached"]);
    expect(r.observable).toEqual({ spinning: [], lighting: [], screen: "off" });
  });
});

describe("stage 1: power availability", () => {
  it("no 24-pin cable: nothing happens, and the evidence names the socket", () => {
    const state = run(preset("i5-ddr4-air"), [{ type: "disconnect_cable_end", cableId: `${B.psu}.atx24`, endId: "device" }]);
    const r = start(state);
    expect(r.outcome).toBe("no_power");
    expect(statuses(r)).toEqual(["failed", "not_reached", "not_reached", "not_reached", "not_reached"]);
    const d = r.stages[0]!.diagnostics[0]!;
    expect(d.code).toBe("required_power_missing");
    expect(d.class).toBe("assembly");
    expect(d.target).toEqual({ id: `pc:port:${B.mb}/atx-24`, kind: "port", projectRevision: 1, executionId: "run-1" });
    expect(d.evidence[0]).toMatchObject({ observed: "ATX 24-pin" });
    expect(d.observation?.en).not.toMatch(/24|cable|ATX/i);
    expect(r.observable.spinning).toEqual([]);
    expect(r.observable.screen).toBe("off");
  });

  it("PSU switch off, mains unplugged and an unconnected power button are separate findings", () => {
    const base = preset("i5-ddr4-air");
    expect(codes(start(run(base, [{ type: "set_psu_switch", on: false }])))).toEqual(["psu_switch_off"]);
    expect(codes(start(run(base, [{ type: "set_wall_power", connected: false }])))).toEqual(["wall_power_disconnected"]);
    expect(codes(start(run(base, [{ type: "disconnect_cable_end", cableId: `${B.pc}.power-switch`, endId: "plug" }])))).toEqual(["power_switch_not_connected"]);
  });

  it("the power button lead on the reset pins fits but does not start the computer", () => {
    const state = run(preset("i5-ddr4-air"), [
      { type: "disconnect_cable_end", cableId: `${B.pc}.power-switch`, endId: "plug" },
      { type: "connect_cable_end", cableId: `${B.pc}.power-switch`, endId: "plug", to: { kind: "part", instanceId: B.mb, portId: "panel-reset" } },
    ]);
    const r = start(state);
    expect(r.outcome).toBe("no_power");
    expect(codes(r)).toEqual(["power_switch_wrong_header"]);
  });

  it("a modular cable plugged into the board but not into the power supply is reported as a loose source end", () => {
    const state = run(preset("i7-ddr5-rgb-aio"), [{ type: "disconnect_cable_end", cableId: `${A.psu}.atx24`, endId: "psu" }]);
    const r = start(state);
    expect(r.outcome).toBe("no_power");
    const d = r.stages[0]!.diagnostics[0]!;
    expect(d.code).toBe("power_cable_source_loose");
    expect(d.target.id).toBe(`pc:cable-end:${A.psu}.atx24/psu`);
    expect(d.evidence[0]).toMatchObject({ observed: "0 / 1", expected: "1 / 1" });
  });
});

describe("stage 2: POST and component checks", () => {
  it("missing CPU power: fans spin and lights glow, but POST fails", () => {
    const state = run(preset("i7-ddr5-rgb-aio"), [{ type: "disconnect_cable_end", cableId: `${A.psu}.eps-1`, endId: "device" }]);
    const r = start(state);
    expect(r.outcome).toBe("no_post");
    expect(statuses(r)).toEqual(["passed", "failed", "not_reached", "not_reached", "not_reached"]);
    expect(codes(r)).toEqual(["required_power_missing"]);
    expect(r.stages[1]!.diagnostics[0]!.target.id).toBe(`pc:port:${A.mb}/eps-1`);
    // Spinning fans and lit parts are not proof of POST.
    expect(r.observable.spinning.length).toBeGreaterThan(0);
    expect(r.observable.lighting.some((l) => l.lit)).toBe(true);
    expect(r.observable.screen).toBe("off");
  });

  it("the second CPU power socket is only recommended: the build still starts and gets a warning", () => {
    const state = run(preset("i7-ddr5-rgb-aio"), [{ type: "disconnect_cable_end", cableId: `${A.psu}.eps-2`, endId: "device" }]);
    const r = start(state);
    expect(r.outcome).toBe("operational");
    expect(r.advisories.find((d) => d.code === "required_power_missing")).toMatchObject({ severity: "warning", target: { id: `pc:port:${A.mb}/eps-2` } });
  });

  it("missing graphics card power fails POST and names the card's socket", () => {
    const state = run(preset("i5-ddr4-air"), [{ type: "disconnect_cable_end", cableId: `${B.psu}.pcie`, endId: "device-1" }]);
    const r = start(state);
    expect(r.outcome).toBe("no_post");
    expect(r.stages[1]!.diagnostics.map((d) => [d.code, d.target.id])).toEqual([["required_power_missing", `pc:port:${B.gpu}/power-8pin`]]);
  });

  it("a compatible memory module that is only partly seated is its own state and fails POST", () => {
    const state = run(preset("i7-ddr5-rgb-aio"), [{ type: "set_seating", instanceId: A.ram2, seating: "partial" }]);
    const r = start(state);
    expect(r.outcome).toBe("no_post");
    expect(statuses(r)).toEqual(["passed", "failed", "not_reached", "not_reached", "not_reached"]);
    const d = r.stages[1]!.diagnostics[0]!;
    expect(d.code).toBe("ram_partially_seated");
    expect(d.class).toBe("assembly");
    expect(d.target.id).toBe(`pc:component:${A.ram2}`);
    expect(d.relatedTargets[0]!.id).toBe(`pc:connector:${A.mb}/dimm-b2`);
    expect(d.evidence[0]).toMatchObject({ observed: "partial", expected: "seated" });
    // Level 1 is the symptom only; the cause appears from level 2 on.
    expect(d.observation?.en).not.toMatch(/memory|module|seat/i);
    expect(d.message.en).toMatch(/not fully seated/);
  });

  it("model-specific: a CPU that fits the socket fails POST on a BIOS older than the support list requires", () => {
    const p = pcPresets.find((x) => x.id === "i7-ddr5-rgb-aio")!;
    const state = replay(p.actions.filter((a) => a.type !== "update_bios"), pcCatalog).state;
    const r = start(state);
    expect(r.outcome).toBe("no_post");
    const d = r.stages[1]!.diagnostics[0]!;
    expect(d.code).toBe("cpu_needs_bios_update");
    expect(d.class).toBe("startup_fault");
    expect(d.evidence.map((e) => [e.observed, e.expected])).toEqual([["0802", ">= 1205"], ["1205", undefined]]);
    expect(d.evidence[0]!.catalogId).toBe("asus-tuf-gaming-z790-plus-wifi");
    // Exactly the listed version is enough; one version earlier is not.
    expect(start(run(state, [{ type: "update_bios", instanceId: A.mb, version: "1030" }])).outcome).toBe("no_post");
    expect(start(run(state, [{ type: "update_bios", instanceId: A.mb, version: "1205" }])).outcome).toBe("operational");
  });

  it("an open CPU socket lever fails POST", () => {
    const r = start(run(preset("i5-ddr4-air"), [{ type: "set_fasteners", instanceId: B.cpu, secured: 0 }]));
    expect(r.outcome).toBe("no_post");
    expect(codes(r)).toEqual(["cpu_lever_open"]);
  });
});

describe("stage 3: graphics readiness (no monitor in the lab)", () => {
  /** The same catalog with a Core i5 that has no integrated graphics, like the real "F" models. */
  const noIgpuCatalog: PCCatalog = {
    ...pcCatalog,
    version: "test-no-igpu",
    entries: pcCatalog.entries.map((e) => (e.id === "intel-core-i5-14600k" && e.category === "cpu" ? { ...e, spec: { ...e.spec, integratedGraphics: null } } : e)),
  };
  const withoutGpu: PCAction[] = [
    { type: "set_side_panel", open: true },
    { type: "unmount_part", instanceId: B.gpu },
  ];
  const startOn = (catalog: PCCatalog, actions: PCAction[]) => {
    const r = replay([...pcPresets.find((p) => p.id === "i5-ddr4-air")!.actions, ...actions, { type: "press_power" }], catalog);
    expect(r.events.filter((e) => !e.accepted).map((e) => e.rejection?.code)).toEqual([]);
    return evaluateStartup(r.state, catalog, { projectRevision: 1, executionId: "run-1" });
  };

  it("without a graphics card the CPU's integrated graphics carry the check, and the build still starts", () => {
    const r = startOn(pcCatalog, withoutGpu);
    expect(r.outcome).toBe("operational");
    expect(r.observable.screen).toBe("operating_system");
  });

  it("a CPU without integrated graphics and no graphics card stops at the graphics check, after POST", () => {
    const r = startOn(noIgpuCatalog, [...withoutGpu, { type: "remove_part", instanceId: B.gpu }]);
    expect(r.outcome).toBe("no_display");
    expect(statuses(r)).toEqual(["passed", "passed", "failed", "not_reached", "not_reached"]);
    const d = r.stages[2]!.diagnostics[0]!;
    expect(d.code).toBe("graphics_missing");
    expect(d.target.id).toBe(`pc:connector:${B.mb}/pcie-x16-1`);
    expect(d.evidence.map((e) => e.observed)).toEqual(["none", "no"]);
    // Nothing in the text asks for a monitor or a display cable, and level 1 does not name the cause.
    for (const t of [d.observation!, d.message, d.explanation]) expect(`${t.en} ${t.ar}`).not.toMatch(/monitor|HDMI|DisplayPort|cable|شاشة تطلّع|كيبل الشاشة/i);
    expect(d.observation?.en).not.toMatch(/graphics/i);
    expect(r.observable.screen).toBe("no_signal");
  });

  it("with that CPU, a graphics card still on the bench is reported as not installed", () => {
    const r = startOn(noIgpuCatalog, withoutGpu);
    expect(r.outcome).toBe("no_display");
    expect(r.stages[2]!.diagnostics.map((d) => [d.code, d.target.id])).toEqual([["part_not_mounted", `pc:component:${B.gpu}`]]);
  });

  it("no finding of a finished build ever mentions a monitor", () => {
    for (const p of pcPresets) {
      const found = diagnoseBuild(replay(p.actions, pcCatalog).state, pcCatalog);
      expect(found.map((d) => d.code).filter((c) => c.startsWith("monitor") || c.startsWith("display_"))).toEqual([]);
    }
  });
});

describe("stage 4: bootable storage", () => {
  it("no drive: POST and firmware pass and the result is a distinct no-boot-device outcome", () => {
    const r = start(run(preset("i7-ddr5-rgb-aio"), [{ type: "remove_part", instanceId: A.ssd }]));
    expect(r.outcome).toBe("no_boot_device");
    expect(statuses(r)).toEqual(["passed", "passed", "passed", "failed", "not_reached"]);
    expect(codes(r)).toEqual(["storage_missing"]);
    expect(r.observable.screen).toBe("no_boot_device");
    // Not the same thing as failing POST.
    const noPost = start(run(preset("i7-ddr5-rgb-aio"), [{ type: "set_seating", instanceId: A.ram1, seating: "partial" }]));
    expect(noPost.outcome).toBe("no_post");
    expect(noPost.observable.screen).toBe("off");
    expect(noPost.stages[1]!.observation.en).not.toBe(r.stages[3]!.observation.en);
  });

  it("a SATA drive needs both data and power to be detected", () => {
    const base = preset("i5-ddr4-air");
    const noData = start(run(base, [{ type: "disconnect_cable_end", cableId: B.sata, endId: "b" }]));
    expect(noData.outcome).toBe("no_boot_device");
    expect(noData.stages[3]!.diagnostics[0]!.evidence.map((e) => e.observed)).toEqual(["no", "yes"]);
    expect(noData.stages[3]!.diagnostics[0]!.target.id).toBe(`pc:port:${B.ssd}/sata-data`);
    const noPower = start(run(base, [{ type: "disconnect_cable_end", cableId: `${B.psu}.sata`, endId: "sata-1" }]));
    expect(noPower.stages[3]!.diagnostics[0]!.evidence.map((e) => e.observed)).toEqual(["yes", "no"]);
    expect(noPower.stages[3]!.diagnostics[0]!.target.id).toBe(`pc:port:${B.ssd}/sata-power`);
  });

  it("a detected drive without an operating system is detected but not bootable", () => {
    const r = start(run(preset("i7-ddr5-rgb-aio"), [{ type: "set_storage_bootable", instanceId: A.ssd, bootable: false }]));
    expect(r.outcome).toBe("no_boot_device");
    expect(codes(r)).toEqual(["storage_not_bootable"]);
  });

  it("an M.2 drive resting in its slot but not seated is not detected", () => {
    const r = start(run(preset("i7-ddr5-rgb-aio"), [{ type: "set_seating", instanceId: A.ssd, seating: "placed" }]));
    expect(codes(r)).toEqual(["storage_not_detected"]);
  });
});

describe("stage 5: simplified operating load", () => {
  // i9-14900K (253 W) + RTX 4070 Ti SUPER (285 W) + 50 W allowance = 588 W on a 550 W unit.
  const undersized = () => {
    const p = pcPresets.find((x) => x.id === "i7-ddr5-rgb-aio")!;
    const actions = p.actions
      .map((a) => (a.type === "add_part" && a.catalogId === "corsair-rm850x-atx31" ? { ...a, catalogId: "corsair-cx550" } : a))
      .filter((a) => !((a.type === "connect_cable_end" || a.type === "set_cable_tidy") && a.cableId.startsWith(`${A.psu}.`)));
    return run(replay(actions, pcCatalog).state, [
      { type: "set_side_panel", open: true },
      { type: "connect_cable_end", cableId: `${A.psu}.atx24`, endId: "device", to: { kind: "part", instanceId: A.mb, portId: "atx-24" } },
      { type: "connect_cable_end", cableId: `${A.psu}.eps`, endId: "device", to: { kind: "part", instanceId: A.mb, portId: "eps-1" } },
      // The card's supplied 16-pin adapter takes the unit's two PCIe plugs.
      { type: "connect_cable_end", cableId: `${A.gpu}.adapter-16pin`, endId: "device", to: { kind: "part", instanceId: A.gpu, portId: "power-16pin" } },
      { type: "connect_cable_end", cableId: `${A.psu}.pcie`, endId: "device-1", to: { kind: "cable", cableId: `${A.gpu}.adapter-16pin`, endId: "in-1" } },
      { type: "connect_cable_end", cableId: `${A.psu}.pcie`, endId: "device-2", to: { kind: "cable", cableId: `${A.gpu}.adapter-16pin`, endId: "in-2" } },
    ]);
  };

  it("an undersized power supply starts and boots, then fails under the modelled load", () => {
    const r = start(undersized());
    expect(r.outcome).toBe("load_fault");
    expect(statuses(r)).toEqual(["passed", "passed", "passed", "passed", "failed"]);
    const d = r.stages[4]!.diagnostics[0]!;
    expect(d.code).toBe("psu_insufficient_for_load");
    expect(d.class).toBe("operating_load_fault");
    expect(r.loadModel).toEqual({ estimatedDrawW: 253 + 285 + LOAD_MODEL.baseSystemW, psuRatedW: 550, cpuHeatW: 253, coolerCapacityW: null });
    expect(d.evidence.map((e) => e.observed)).toEqual(["588 W", "253 W", "285 W", "50 W", "550 W"]);
    expect(d.evidence[0]!.expected).toBe("<= 550 W");
    expect(r.observable.screen).toBe("operating_system");
  });

  it("with only one of the adapter's two inputs fed, the card has no power and POST fails instead", () => {
    const state = run(undersized(), [{ type: "disconnect_cable_end", cableId: `${A.psu}.pcie`, endId: "device-2" }]);
    const r = start(state);
    expect(r.outcome).toBe("no_post");
    const d = r.stages[1]!.diagnostics[0]!;
    expect(d.code).toBe("power_cable_source_loose");
    expect(d.target.id).toBe(`pc:cable-end:${A.gpu}.adapter-16pin/in-2`);
    expect(d.evidence[0]).toMatchObject({ observed: "1 / 2", expected: "2 / 2" });
  });

  it("a power supply below the card maker's recommendation but above the estimated load is an optional improvement", () => {
    // A cross-kit mix: i5-14600K (181) + RTX 4070 Ti SUPER (285) + 50 = 516 W on the 550 W unit; ASUS recommends 750 W.
    const p = pcPresets.find((x) => x.id === "i7-ddr5-rgb-aio")!;
    const actions = p.actions
      .map((a) => (a.type === "add_part" && a.catalogId === "intel-core-i7-14700k" ? { ...a, catalogId: "intel-core-i5-14600k" } : a))
      .map((a) => (a.type === "add_part" && a.catalogId === "corsair-rm850x-atx31" ? { ...a, catalogId: "corsair-cx550" } : a))
      .filter((a) => !((a.type === "connect_cable_end" || a.type === "set_cable_tidy") && a.cableId.startsWith(`${A.psu}.`)));
    const state = run(replay(actions, pcCatalog).state, [
      { type: "set_side_panel", open: true },
      { type: "connect_cable_end", cableId: `${A.psu}.atx24`, endId: "device", to: { kind: "part", instanceId: A.mb, portId: "atx-24" } },
      { type: "connect_cable_end", cableId: `${A.psu}.eps`, endId: "device", to: { kind: "part", instanceId: A.mb, portId: "eps-1" } },
      { type: "connect_cable_end", cableId: `${A.gpu}.adapter-16pin`, endId: "device", to: { kind: "part", instanceId: A.gpu, portId: "power-16pin" } },
      { type: "connect_cable_end", cableId: `${A.psu}.pcie`, endId: "device-1", to: { kind: "cable", cableId: `${A.gpu}.adapter-16pin`, endId: "in-1" } },
      { type: "connect_cable_end", cableId: `${A.psu}.pcie`, endId: "device-2", to: { kind: "cable", cableId: `${A.gpu}.adapter-16pin`, endId: "in-2" } },
    ]);
    const r = start(state);
    expect(r.outcome).toBe("operational");
    const note = r.advisories.find((d) => d.code === "psu_below_gpu_recommendation")!;
    expect(note.class).toBe("optional_improvement");
    expect(note.evidence.map((e) => e.observed)).toEqual(["550 W", "750 W", "516 W"]);
    // The unit has one CPU power cable; the board's second socket is a warning, not a fault.
    expect(r.advisories.some((d) => d.code === "psu_connector_unavailable" && d.target.id === `pc:port:${A.mb}/eps-2`)).toBe(true);
  });

  it("a cooler that fits can still be inadequate: the archived generic 65 W cooler on a 253 W CPU fails only under load", () => {
    const p = pcPresets.find((x) => x.id === "i7-ddr5-rgb-aio")!;
    const actions = p.actions
      .filter((a) => !("instanceId" in a && a.instanceId === A.aio) && !("cableId" in a && a.cableId.startsWith(`${A.aio}.`)))
      .map((a) => (a.type === "add_part" && a.catalogId === "arctic-liquid-freezer-iii-240-argb" ? { ...a, catalogId: "generic-low-profile-air-cooler" } : a));
    const state = run(replay(actions, pcCatalog).state, [
      { type: "set_side_panel", open: true },
      { type: "mount_part", instanceId: A.aio, target: { hostInstanceId: A.mb, mountPointId: "cooler-mount" } },
      { type: "set_seating", instanceId: A.aio, seating: "seated" },
      { type: "set_fasteners", instanceId: A.aio, secured: 4 },
      { type: "connect_cable_end", cableId: `${A.aio}.fan`, endId: "plug", to: { kind: "part", instanceId: A.mb, portId: "cpu-fan" } },
    ]);
    const r = start(state);
    expect(r.outcome).toBe("load_fault");
    expect(statuses(r)).toEqual(["passed", "passed", "passed", "passed", "failed"]);
    const d = r.stages[4]!.diagnostics[0]!;
    expect(d.code).toBe("cooler_insufficient_for_load");
    expect(d.evidence.map((e) => [e.observed, e.expected])).toEqual([["253 W", "<= 65 W"], ["65 W", undefined]]);
    expect(d.evidence[1]!.label.en).toMatch(/teaching assumption/);
  });

  it("an unplugged cooler fan and a missing cooler are load-stage findings, not POST failures", () => {
    const base = preset("i5-ddr4-air");
    const noFan = start(run(base, [{ type: "disconnect_cable_end", cableId: `${B.cooler}.fan`, endId: "plug" }]));
    expect(noFan.outcome).toBe("load_fault");
    expect(codes(noFan)).toEqual(["cooler_fan_not_connected"]);
    const none = start(run(base, [{ type: "set_side_panel", open: true }, { type: "remove_part", instanceId: B.cooler }]));
    expect(none.outcome).toBe("load_fault");
    expect(codes(none)).toEqual(["cooler_missing"]);
  });
});

describe("repairing the real fault versus decorative changes", () => {
  const broken = () => run(preset("i7-ddr5-rgb-aio"), [{ type: "set_seating", instanceId: A.ram2, seating: "partial" }]);

  it("RGB off, lighting changes and cable tidying do not change a failed result", () => {
    const before = start(broken());
    const decorated = run(broken(), [
      { type: "set_rgb_preference", preference: "without_rgb" },
      { type: "set_part_lighting", instanceId: A.gpu, lighting: { enabled: false } },
      { type: "set_part_lighting", instanceId: A.ram1, lighting: { color: "#ff0000", effect: "rainbow" } },
      { type: "set_cable_tidy", cableId: `${A.psu}.atx24`, tidied: false },
      { type: "set_side_panel", open: true },
    ]);
    const after = start(decorated);
    expect(after.outcome).toBe("no_post");
    expect(statuses(after)).toEqual(statuses(before));
    expect(after.stages[1]!.diagnostics.map((d) => d.id)).toEqual(before.stages[1]!.diagnostics.map((d) => d.id));
  });

  it("seating the module changes the result to operational", () => {
    const fixed = run(broken(), [{ type: "set_seating", instanceId: A.ram2, seating: "seated" }]);
    expect(start(broken()).outcome).toBe("no_post");
    expect(start(fixed).outcome).toBe("operational");
  });

  it("untidy cables, an open panel and loose screws are advisories that never block", () => {
    const state = run(preset("i5-ddr4-air"), [
      { type: "set_side_panel", open: true },
      { type: "set_cable_tidy", cableId: `${B.psu}.atx24`, tidied: false },
      { type: "set_cable_tidy", cableId: B.sata, tidied: false },
      { type: "set_fasteners", instanceId: B.gpu, secured: 1 },
    ]);
    const r = start(state);
    expect(r.outcome).toBe("operational");
    const byCode = Object.fromEntries(r.advisories.map((d) => [d.code, d]));
    expect(byCode.cable_untidy).toMatchObject({ class: "optional_improvement", severity: "info" });
    expect(byCode.cable_untidy!.evidence[0]!.observed).toBe("2");
    expect(byCode.side_panel_open).toMatchObject({ class: "optional_improvement", target: { id: "pc:setting:side-panel" } });
    expect(byCode.fasteners_missing).toMatchObject({ class: "assembly", severity: "warning" });
    expect(byCode.fasteners_missing!.evidence[0]).toMatchObject({ observed: "1 / 2", expected: "2 / 2" });
  });
});

describe("lighting", () => {
  it("is shown only with hardware, enabled, a valid connection and power", () => {
    const base = preset("i7-ddr5-rgb-aio");
    const of = (r: ReturnType<typeof start>, id: string) => r.observable.lighting.find((l) => l.instanceId === id);
    // Disabled on one part.
    const off = start(run(base, [{ type: "set_part_lighting", instanceId: A.gpu, lighting: { enabled: false } }]));
    expect(of(off, A.gpu)).toMatchObject({ lit: false, reason: "disabled", color: null });
    expect(of(off, A.ram1)).toMatchObject({ lit: true });
    // Lighting lead unplugged: the pump and fans still run, the build still starts.
    const unplugged = start(run(base, [{ type: "disconnect_cable_end", cableId: `${A.aio}.argb`, endId: "plug" }]));
    expect(of(unplugged, A.aio)).toMatchObject({ lit: false, reason: "not_connected" });
    expect(unplugged.outcome).toBe("operational");
    expect(unplugged.observable.spinning).toContain(A.aio);
    expect(unplugged.advisories.map((d) => d.code)).toContain("lighting_not_connected");
    // No power: nothing is lit.
    const dead = start(run(base, [{ type: "set_psu_switch", on: false }]));
    expect(dead.observable.lighting.every((l) => !l.lit && l.reason === "not_powered")).toBe(true);
    // Parts without lighting hardware never appear.
    expect(start(base).observable.lighting.map((l) => l.instanceId)).not.toContain(A.cpu);
  });

  it("a part without lighting hardware cannot have lighting enabled", () => {
    const state = preset("i5-ddr4-air");
    expect(state.parts.every((p) => p.lighting === undefined)).toBe(true);
  });
});

describe("memory slot recommendations", () => {
  it("a supported but non-recommended layout starts, with a recommendation taken from the board manual", () => {
    const moved = (id: string) =>
      pcPresets.find((x) => x.id === id)!.actions.map((a) =>
        a.type === "mount_part" && a.target.mountPointId === "dimm-a2" ? { ...a, target: { ...a.target, mountPointId: "dimm-a1" } } : a,
      );
    const r = start(replay(moved("i7-ddr5-rgb-aio"), pcCatalog).state);
    expect(r.outcome).toBe("operational");
    const note = r.advisories.find((d) => d.code === "ram_population_not_recommended")!;
    expect(note.class).toBe("optional_improvement");
    expect(note.evidence[0]).toMatchObject({ observed: "DIMM_A1 + DIMM_B2", expected: "DIMM_A2 + DIMM_B2", catalogId: "asus-tuf-gaming-z790-plus-wifi" });
    expect(note.target.id).toBe(`pc:connector:${A.mb}/dimm-a2`);
    // The DDR4 board's manual was not read, so no layout advice is invented for it.
    const d4 = start(replay(moved("i5-ddr4-air"), pcCatalog).state);
    expect(d4.outcome).toBe("operational");
    expect(d4.advisories.map((d) => d.code)).not.toContain("ram_population_not_recommended");
  });

  it("a higher advertised memory speed is a note about profiles, not an incompatibility", () => {
    const r = start(preset("i7-ddr5-rgb-aio"));
    const note = r.advisories.find((d) => d.code === "ram_profile_note")!;
    expect(note.severity).toBe("info");
    expect(note.evidence.map((e) => e.observed)).toEqual(["4800 MT/s", "6000 MT/s"]);
  });
});
