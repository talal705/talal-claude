import { describe, expect, it } from "vitest";
import type { CatalogEntry, MountRef, PortRef } from "@ytl/contracts";
import { offeredEntries, pcCatalog } from "../../../../content/catalog";
import { LOAD_MODEL, applyAction, cableEndOptions, createBuild, evaluateStartup, mountOptions } from "./index";
import { assemble } from "./test-assembler";
import { codes, refusal, run } from "./test-helpers";

const at = (hostInstanceId: string, mountPointId: string): MountRef => ({ hostInstanceId, mountPointId });
const on = (instanceId: string, portId: string): PortRef => ({ kind: "part", instanceId, portId });
const fresh = () => createBuild(pcCatalog);

describe("physical clearance", () => {
  // Fractal North: graphics card limit 355 mm, cooler limit 145 mm. ROG Strix RTX 4090: 357.6 mm. ARCTIC Freezer 36: 159 mm.
  const north = () =>
    run(fresh(), [
      { type: "add_part", catalogId: "fractal-north-charcoal-black-mesh" },
      { type: "add_part", catalogId: "asus-tuf-gaming-z790-plus-wifi" },
      { type: "add_part", catalogId: "asus-rog-strix-rtx4090-o24g-gaming" },
      { type: "add_part", catalogId: "intel-core-i5-14600k" },
      { type: "add_part", catalogId: "arctic-freezer-36" },
      { type: "add_part", catalogId: "asus-dual-rtx4060-o8g" },
    ]);

  it("rejects a graphics card longer than the case limit, with both lengths as evidence", () => {
    const state = run(north(), [{ type: "mount_part", instanceId: "motherboard-2", target: at("case-1", "motherboard-tray") }]);
    const d = refusal(state, { type: "mount_part", instanceId: "gpu-3", target: at("motherboard-2", "pcie-x16-1") });
    expect(d.code).toBe("gpu_too_long");
    expect(d.class).toBe("impossible_fit");
    expect(d.evidence.map((e) => [e.observed, e.expected, e.catalogId])).toEqual([
      ["357.6 mm", "<= 355 mm", "asus-rog-strix-rtx4090-o24g-gaming"],
      ["355 mm", undefined, "fractal-north-charcoal-black-mesh"],
    ]);
    // A shorter card goes in the same slot.
    expect(applyAction(state, { type: "mount_part", instanceId: "gpu-6", target: at("motherboard-2", "pcie-x16-1") }, pcCatalog).ok).toBe(true);
  });

  it("the same card fits a case with a longer limit", () => {
    const state = run(fresh(), [
      { type: "add_part", catalogId: "corsair-4000d-airflow-black" },
      { type: "add_part", catalogId: "asus-tuf-gaming-z790-plus-wifi" },
      { type: "add_part", catalogId: "asus-rog-strix-rtx4090-o24g-gaming" },
      { type: "mount_part", instanceId: "motherboard-2", target: at("case-1", "motherboard-tray") },
    ]);
    expect(applyAction(state, { type: "mount_part", instanceId: "gpu-3", target: at("motherboard-2", "pcie-x16-1") }, pcCatalog).ok).toBe(true);
  });

  it("catches the long card when it is already on the board and the board is then put in the case", () => {
    const state = run(north(), [{ type: "mount_part", instanceId: "gpu-3", target: at("motherboard-2", "pcie-x16-1") }]);
    const d = refusal(state, { type: "mount_part", instanceId: "motherboard-2", target: at("case-1", "motherboard-tray") });
    expect(d.code).toBe("gpu_too_long");
  });

  it("rejects a cooler taller than the case limit", () => {
    const state = run(north(), [
      { type: "mount_part", instanceId: "motherboard-2", target: at("case-1", "motherboard-tray") },
      { type: "mount_part", instanceId: "cpu-4", target: at("motherboard-2", "cpu-socket") },
      { type: "set_seating", instanceId: "cpu-4", seating: "seated" },
    ]);
    const d = refusal(state, { type: "mount_part", instanceId: "cooling-5", target: at("motherboard-2", "cooler-mount") });
    expect(d.code).toBe("cooler_too_tall");
    expect(d.evidence[0]).toMatchObject({ observed: "159 mm", expected: "<= 145 mm" });
    expect(d.message.en).toBe("The cooler is 159 mm tall and this case takes coolers up to 145 mm, so the side panel would not close.");
    expect(d.message.en).not.toMatch(/ARCTIC|Fractal/);
    // mountOptions reports the same reason without touching any log.
    const options = mountOptions(state, pcCatalog, "cooling-5");
    expect(options.map((o) => [o.target.mountPointId, o.ok, o.rejection?.code])).toEqual([["cooler-mount", false, "cooler_too_tall"]]);
  });

  it("a cooler cannot be mounted before the CPU is seated", () => {
    const state = run(north(), []);
    expect(refusal(state, { type: "mount_part", instanceId: "cooling-5", target: at("motherboard-2", "cooler-mount") }).code).toBe("host_not_ready");
  });

  it("a radiator blocks the fan positions it covers, and only fits positions that list its size", () => {
    const state = run(fresh(), [
      { type: "add_part", catalogId: "corsair-4000d-airflow-black" },
      { type: "add_part", catalogId: "arctic-liquid-freezer-iii-240-argb" },
      { type: "add_part", catalogId: "arctic-p12-pwm-pst" },
    ]);
    expect(refusal(state, { type: "mount_part", instanceId: "cooling-2", role: "radiator", target: at("case-1", "rad-rear") }).code).toBe("radiator_size_unsupported");
    const withRad = run(state, [{ type: "mount_part", instanceId: "cooling-2", role: "radiator", target: at("case-1", "rad-front") }]);
    expect(refusal(withRad, { type: "mount_part", instanceId: "fan-3", target: at("case-1", "fan-front-1") }).code).toBe("mount_blocked");
    expect(applyAction(withRad, { type: "mount_part", instanceId: "fan-3", target: at("case-1", "fan-top-1") }, pcCatalog).ok).toBe(true);
  });

  it("nothing is installed inside a case whose side panel is closed", () => {
    const state = run(fresh(), [
      { type: "add_part", catalogId: "corsair-4000d-airflow-black" },
      { type: "add_part", catalogId: "corsair-cx550" },
      { type: "set_side_panel", open: false },
    ]);
    expect(refusal(state, { type: "mount_part", instanceId: "psu-2", target: at("case-1", "psu-bay") }).code).toBe("host_not_ready");
  });
});

describe("sockets, slots and interfaces", () => {
  it("rejects a CPU in a different socket and a cooler without that socket's mounting", () => {
    const state = run(fresh(), [
      { type: "add_part", catalogId: "asus-tuf-gaming-b550-plus" },
      { type: "add_part", catalogId: "intel-core-i5-14600k" },
      { type: "add_part", catalogId: "amd-ryzen-5-5600" },
    ]);
    const d = refusal(state, { type: "mount_part", instanceId: "cpu-2", target: at("motherboard-1", "cpu-socket") });
    expect(d.code).toBe("cpu_socket_mismatch");
    expect(d.evidence[0]).toMatchObject({ observed: "LGA1700", expected: "AM4" });
    expect(d.message.en).toMatch(/made for the LGA1700 socket.*socket is AM4/);
    expect(applyAction(state, { type: "mount_part", instanceId: "cpu-3", target: at("motherboard-1", "cpu-socket") }, pcCatalog).ok).toBe(true);
  });

  it("an NVMe drive is refused by nothing on these boards, and a part never goes on the wrong kind of mount", () => {
    const state = run(fresh(), [
      { type: "add_part", catalogId: "asus-tuf-gaming-z790-plus-wifi" },
      { type: "add_part", catalogId: "samsung-990-pro-1tb" },
      { type: "add_part", catalogId: "samsung-870-evo-1tb" },
    ]);
    expect(mountOptions(state, pcCatalog, "storage-2").map((o) => [o.target.mountPointId, o.ok])).toEqual([["m2-1", true], ["m2-2", true], ["m2-3", true], ["m2-4", true]]);
    // A 2.5-inch SATA drive is not an M.2 module: no M.2 slot is offered, and forcing it is refused.
    expect(mountOptions(state, pcCatalog, "storage-3")).toEqual([]);
    expect(refusal(state, { type: "mount_part", instanceId: "storage-3", target: at("motherboard-1", "m2-1") }).code).toBe("mount_kind_mismatch");
  });

  it("a mount point takes one part", () => {
    const state = run(fresh(), [
      { type: "add_part", catalogId: "asus-tuf-gaming-b550-plus" },
      { type: "add_part", catalogId: "corsair-vengeance-lpx-ddr4-3600-16gb-kit" },
      { type: "add_part", catalogId: "corsair-vengeance-lpx-ddr4-3600-16gb-kit" },
      { type: "mount_part", instanceId: "ram-2", target: at("motherboard-1", "dimm-a2") },
    ]);
    expect(refusal(state, { type: "mount_part", instanceId: "ram-3", target: at("motherboard-1", "dimm-a2") }).code).toBe("mount_occupied");
  });
});

describe("connections are distinct", () => {
  const bench = () =>
    run(fresh(), [
      { type: "add_part", catalogId: "asus-tuf-gaming-z790-plus-wifi" }, // motherboard-1
      { type: "add_part", catalogId: "corsair-cx550" }, // psu-2
      { type: "add_part", catalogId: "asus-dual-rtx4060-o8g" }, // gpu-3
      { type: "add_part", catalogId: "arctic-p12-pwm-pst-argb" }, // fan-4
      { type: "add_part", catalogId: "samsung-870-evo-1tb" }, // storage-5
      { type: "add_part", catalogId: "corsair-4000d-airflow-black" }, // case-6
      { type: "add_part", catalogId: "corsair-airguide-120-4000d" }, // fan-7, a 3-pin fan fitted in that case
      { type: "add_part", catalogId: "corsair-airguide-120-4000d" }, // fan-8
    ]);

  it("a CPU power plug does not go into a graphics card, nor a PCIe plug into the CPU power socket", () => {
    const state = bench();
    const a = refusal(state, { type: "connect_cable_end", cableId: "psu-2.eps", endId: "device", to: on("gpu-3", "power-8pin") });
    expect(a.code).toBe("eps_pcie_not_interchangeable");
    expect(a.class).toBe("impossible_fit");
    expect(a.evidence.map((e) => e.observed)).toEqual(["EPS 4+4-pin", "PCIe 8-pin"]);
    expect(a.message.en).toMatch(/EPS 4\+4-pin.*PCIe 8-pin.*keyed differently/);
    const b = refusal(state, { type: "connect_cable_end", cableId: "psu-2.pcie", endId: "device-1", to: on("motherboard-1", "eps-1") });
    expect(b.code).toBe("eps_pcie_not_interchangeable");
    expect(applyAction(state, { type: "connect_cable_end", cableId: "psu-2.eps", endId: "device", to: on("motherboard-1", "eps-1") }, pcCatalog).ok).toBe(true);
    expect(applyAction(state, { type: "connect_cable_end", cableId: "psu-2.pcie", endId: "device-1", to: on("gpu-3", "power-8pin") }, pcCatalog).ok).toBe(true);
  });

  it("a 5 V addressable plug does not go on a 12 V RGB header, and a fan plug does not go on a lighting header", () => {
    const state = bench();
    expect(refusal(state, { type: "connect_cable_end", cableId: "fan-4.argb", endId: "plug", to: on("motherboard-1", "rgb-1") }).code).toBe("rgb_argb_not_interchangeable");
    expect(refusal(state, { type: "connect_cable_end", cableId: "fan-4.fan", endId: "plug", to: on("motherboard-1", "argb-1") }).code).toBe("connector_mismatch");
    expect(applyAction(state, { type: "connect_cable_end", cableId: "fan-4.argb", endId: "plug", to: on("motherboard-1", "argb-1") }, pcCatalog).ok).toBe(true);
    expect(applyAction(state, { type: "connect_cable_end", cableId: "fan-4.fan", endId: "plug", to: on("motherboard-1", "cha-fan-1") }, pcCatalog).ok).toBe(true);
  });

  it("SATA power and SATA data are different connectors", () => {
    const state = bench();
    expect(refusal(state, { type: "connect_cable_end", cableId: "psu-2.sata", endId: "sata-1", to: on("storage-5", "sata-data") }).code).toBe("connector_mismatch");
    // The board's own SATA data cable.
    expect(refusal(state, { type: "connect_cable_end", cableId: "motherboard-1.sata-data-1", endId: "a", to: on("storage-5", "sata-power") }).code).toBe("connector_mismatch");
    expect(refusal(state, { type: "connect_cable_end", cableId: "psu-2.atx24", endId: "device", to: on("motherboard-1", "eps-1") }).code).toBe("connector_mismatch");
  });

  it("a 3-pin fan plug fits a 4-pin header, and a socket takes one plug", () => {
    const state = run(bench(), [{ type: "connect_cable_end", cableId: "fan-7.fan", endId: "plug", to: on("motherboard-1", "cha-fan-1") }]);
    expect(refusal(state, { type: "connect_cable_end", cableId: "fan-8.fan", endId: "plug", to: on("motherboard-1", "cha-fan-1") }).code).toBe("port_occupied");
  });

  it("cableEndOptions lists look-alike sockets with the reason they are wrong", () => {
    const options = cableEndOptions(bench(), pcCatalog, "psu-2.eps", "device");
    const row = (portId: string) => options.find((o) => o.to.kind === "part" && o.to.portId === portId);
    expect(row("eps-1")).toMatchObject({ ok: true });
    expect(row("eps-2")).toMatchObject({ ok: true });
    expect(row("power-8pin")?.ok).toBe(false);
    expect(row("power-8pin")?.rejection?.code).toBe("eps_pcie_not_interchangeable");
    // Unrelated sockets are not offered at all.
    expect(row("atx-24")).toBeUndefined();
    expect(row("sata-1")).toBeUndefined();
    // Destinations are unique and every valid one is accepted by the reducer.
    expect(new Set(options.map((o) => JSON.stringify(o.to))).size).toBe(options.length);
    for (const o of options.filter((x) => x.ok)) {
      expect(applyAction(bench(), { type: "connect_cable_end", cableId: "psu-2.eps", endId: "device", to: o.to }, pcCatalog).ok).toBe(true);
    }
  });
});

describe("model-specific modular cables", () => {
  // Corsair states that Type 4 cables are not compatible with Type 5 power supplies.
  const state = () =>
    run(fresh(), [
      { type: "add_part", catalogId: "corsair-rm850x-shift" }, // psu-1, Type 5
      { type: "add_cable", catalogId: "corsair-rm850x-atx31", cableSpecId: "eps" }, // cable-2, a Type 4 cable from another unit
    ]);

  it("rejects a Type 4 cable in a Type 5 power supply although the plug shape is the same", () => {
    const d = refusal(state(), { type: "connect_cable_end", cableId: "cable-2", endId: "psu", to: on("psu-1", "out-cpu-pcie-1") });
    expect(d.code).toBe("modular_cable_mismatch");
    expect(d.class).toBe("assembly");
    expect(d.evidence.map((e) => [e.observed, e.expected, e.catalogId])).toEqual([
      ["corsair-type4:cpu-pcie", "corsair-type5:cpu-pcie", "corsair-rm850x-atx31"],
      ["corsair-type5:cpu-pcie", undefined, "corsair-rm850x-shift"],
    ]);
    // The one-sentence reason names both cable types; the explanation says why a fitting plug is still wrong.
    expect(d.message.en).toContain("Corsair Type 4");
    expect(d.message.en).toContain("Corsair Type 5");
    expect(d.message.ar).toContain("Corsair Type 4");
    expect(d.explanation.en).toMatch(/pin assignment/);
  });

  it("accepts the unit's own cable in the same socket, and refuses its SATA cable in a CPU/PCIe socket", () => {
    const s = state();
    expect(applyAction(s, { type: "connect_cable_end", cableId: "psu-1.eps-1", endId: "psu", to: on("psu-1", "out-cpu-pcie-1") }, pcCatalog).ok).toBe(true);
    expect(refusal(s, { type: "connect_cable_end", cableId: "psu-1.sata-1", endId: "psu", to: on("psu-1", "out-cpu-pcie-1") }).code).toBe("connector_mismatch");
  });

  it("lists every socket of the foreign unit as unusable for that cable", () => {
    const options = cableEndOptions(state(), pcCatalog, "cable-2", "psu");
    expect(options.length).toBe(11);
    expect(options.every((o) => !o.ok && o.rejection?.code === "modular_cable_mismatch")).toBe(true);
  });
});

describe("every mix of the two offered options per category (decision 10)", () => {
  const CATEGORIES = ["case", "motherboard", "cpu", "ram", "gpu", "psu", "storage", "fan", "cooling"] as const;
  const choices = CATEGORIES.map((c) => offeredEntries.filter((e) => e.category === c));
  const pick = <C extends CatalogEntry["category"]>(entries: CatalogEntry[], category: C) => entries.find((e) => e.category === category) as Extract<CatalogEntry, { category: C }>;

  it("builds and starts unless a real rule (memory generation, clearance, power) says otherwise", () => {
    expect(choices.every((c) => c.length === 2)).toBe(true);
    const outcomes = new Map<string, number>();
    for (let mask = 0; mask < 2 ** CATEGORIES.length; mask++) {
      const parts = CATEGORIES.map((_, i) => choices[i]![(mask >> i) & 1]!);
      const ids = parts.flatMap((e) => (e.category === "ram" ? [e.id, e.id] : [e.id]));
      const theCase = pick(parts, "case");
      const board = pick(parts, "motherboard");
      const cpu = pick(parts, "cpu");
      const ram = pick(parts, "ram");
      const gpu = pick(parts, "gpu");
      const psu = pick(parts, "psu");
      const cooler = pick(parts, "cooling");

      // What the published specifications say, computed here independently of the engine.
      const memoryMismatch = ram.spec.generation !== board.spec.memory.generation;
      const coolerTooTall = cooler.spec.heightMm !== null && cooler.spec.heightMm > theCase.spec.maxCpuCoolerHeightMm;
      const overload = (cpu.spec.maxPowerW ?? cpu.spec.basePowerW) + (gpu.spec.powerDrawW ?? 0) + LOAD_MODEL.baseSystemW > psu.spec.wattageW;
      const expected = memoryMismatch ? "no_post" : overload || coolerTooTall ? "load_fault" : "operational";

      const { state, unplaced } = assemble(pcCatalog, ids);
      const r = evaluateStartup(run(state, [{ type: "press_power" }]), pcCatalog);
      const label = ids.join(" + ");
      expect(r.outcome, label).toBe(expected);
      expect(unplaced.map((u) => u.code).sort(), label).toEqual(
        [...(coolerTooTall ? ["cooler_too_tall"] : []), ...(memoryMismatch ? ["ram_generation_mismatch", "ram_generation_mismatch"] : [])].sort(),
      );
      if (expected === "load_fault" && overload && !memoryMismatch) expect(codes(r), label).toContain("psu_insufficient_for_load");
      outcomes.set(expected, (outcomes.get(expected) ?? 0) + 1);
    }
    // Most mixes work; the i5/i7 choice, colour, lighting and which starter a part came from never decide it.
    expect(Object.fromEntries(outcomes)).toEqual({ operational: 168, load_fault: 88, no_post: 256 });
  });
});
