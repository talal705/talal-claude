import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { offeredEntries, pcCatalog } from "../../../../../content/catalog";
import { extent, generateAssets, geometryPath, partGeometry, thumbnailPath, validateAssets, type PartGeometry } from "./index";

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../assets");
// The two worked examples; the rest are generated once the owner has seen these.
const EXAMPLES = ["asus-tuf-gaming-z790-plus-wifi", "asus-tuf-rtx4070tis-o16g-gaming"];
const board = pcCatalog.entries.find((e) => e.id === EXAMPLES[0])!;
const card = pcCatalog.entries.find((e) => e.id === EXAMPLES[1])!;

describe("generated geometry", () => {
  it("a motherboard takes its outline from the catalog and draws every mount point, port and zone", () => {
    const g = partGeometry(board, pcCatalog.version)!;
    expect([g.bounds.size[0], g.bounds.size[2]]).toEqual([244, 305]);
    expect(g.bounds.basis).toEqual({ x: "catalog", y: "schematic", z: "catalog" });
    expect(Object.keys(g.mounts).sort()).toEqual(board.mountPoints.map((m) => m.id).sort());
    expect(Object.keys(g.ports).sort()).toEqual(board.ports.map((p) => p.id).sort());
    expect(Object.keys(g.zones).sort()).toEqual(board.zones.map((z) => z.id).sort());
    // Memory slots keep the manual's order across the board.
    const xs = ["dimm-a1", "dimm-a2", "dimm-b1", "dimm-b2"].map((id) => g.mounts[id]!.at[0]);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // Parts are pushed down onto the board; M.2 drives slide in sideways.
    expect(g.mounts["dimm-a2"]!.insert).toEqual([0, -1, 0]);
    expect(g.mounts["m2-1"]).toMatchObject({ insert: [-1, 0, 0], facing: [0, 1, 0] });
    // Rear display outputs face out of the back; headers face up.
    expect(g.ports["hdmi-out"]!.facing).toEqual([-1, 0, 0]);
    expect(g.ports["atx-24"]!.facing).toEqual([0, 1, 0]);
    expect(g.lights).toEqual([]);
    // Positions are centres, and everything lies inside the bounds, so a camera can be framed from `bounds` alone.
    const socket = g.solids.find((s) => s.id === "cpu-socket")!;
    expect(extent(socket).max[0] - extent(socket).min[0]).toBe(54);
    for (const s of g.solids) {
      const e = extent(s);
      expect(e.min.every((v) => v >= -0.05) && e.max.every((v, i) => v <= g.bounds.size[i]! + 0.05), s.id).toBe(true);
    }
    // Mounts carry a size and a facing; the cable leaves a port along `facing`.
    expect(g.mounts["dimm-a2"]).toMatchObject({ size: [7, 9, 142], facing: [0, 1, 0], travelMm: 35 });
    // Printed markings come from the catalog labels; pin dots only where the connector name states a count.
    const marked = Object.fromEntries(g.solids.filter((s) => s.label).map((s) => [s.id, [s.label, s.pins]]));
    expect(marked["cpu-fan"]).toEqual(["CPU_FAN", 4]);
    expect(marked["dimm-b1"]).toEqual(["DIMM_B1", undefined]);
    expect(marked["atx-24"]).toEqual(["ATX-24", 24]);
    expect(marked["panel-pwrsw"]).toEqual(["PWRSW", 2]);
    expect(marked["hd-audio"]).toEqual(["AAFP", undefined]);
    expect(marked["cpu-socket"]).toEqual(["LGA1700", undefined]);
  });

  it("a graphics card takes length, height, thickness and fan count from the catalog", () => {
    const g = partGeometry(card, pcCatalog.version)!;
    expect(g.bounds.size).toEqual([305, 138, 65]);
    expect(g.bounds.basis).toEqual({ x: "catalog", y: "catalog", z: "catalog" });
    expect(g.solids.filter((s) => s.role === "fan")).toHaveLength(3);
    expect(Object.keys(g.ports).sort()).toEqual(["hdmi-1", "hdmi-2", "power-16pin"]);
    expect(g.ports["power-16pin"]!.facing).toEqual([0, 1, 0]);
    // Light sources exist only because the catalog entry has lighting hardware.
    expect(g.lights.map((l) => l.zone)).toEqual(["shroud-logo"]);
    const plain = partGeometry(pcCatalog.entries.find((e) => e.id === "asus-dual-rtx4060-o8g")!, pcCatalog.version)!;
    expect(plain.lights).toEqual([]);
    expect(plain.solids.some((s) => s.role === "light")).toBe(false);
    expect(plain.solids.filter((s) => s.role === "fan")).toHaveLength(2);
  });

  it("every offered part is drawn with surfaces, fin stacks and bladed rotors, not as plain boxes", () => {
    for (const e of offeredEntries) {
      const g = partGeometry(e, pcCatalog.version);
      // Most of each drawing names its surface (board, gold, metal, plastic, rubber…); empty places for other parts are outlines.
      const bodies = g.solids.filter((s) => !["tray", "bay", "fan_mount", "radiator_mount", "cooler_keepout", "port"].includes(s.role));
      expect(bodies.filter((s) => s.finish).length / bodies.length, e.id).toBeGreaterThan(0.6);
      // Every fan is a rotor with blades, never a plain disc.
      for (const fan of g.solids.filter((s) => s.role === "fan")) expect([fan.shape, (fan.count ?? 0) >= 5], `${e.id} ${fan.id}`).toEqual(["rotor", true]);
      if (["motherboard", "gpu", "cooling"].includes(e.category)) expect(g.solids.some((s) => s.shape === "fins" && s.role === "heatsink" || s.role === "radiator"), e.id).toBe(true);
    }
    // Contacts are gold on every board-level part that has them.
    const gold = (id: string, solid: string) => partGeometry(pcCatalog.entries.find((e) => e.id === id)!, pcCatalog.version).solids.find((s) => s.id === solid)?.finish;
    expect(gold("asus-tuf-rtx4070tis-o16g-gaming", "edge-connector")).toBe("gold");
    expect(gold("corsair-vengeance-lpx-ddr4-3600-16gb-kit", "contacts-left")).toBe("gold");
    expect(gold("intel-core-i7-14700k", "contacts")).toBe("gold");
  });

  it("is deterministic", () => {
    expect(generateAssets(pcCatalog).files).toEqual(generateAssets(pcCatalog).files);
  });

  it("every entry gets a geometry with all its mount points, ports, zones, cable exits and attach frames", () => {
    for (const e of pcCatalog.entries) {
      const g = partGeometry(e, pcCatalog.version);
      expect(Object.keys(g.mounts).sort(), e.id).toEqual(e.mountPoints.map((m) => m.id).sort());
      expect(Object.keys(g.ports).sort(), e.id).toEqual(e.ports.map((p) => p.id).sort());
      expect(Object.keys(g.zones).sort(), e.id).toEqual(e.zones.map((z) => z.id).sort());
      expect(Object.keys(g.attach).sort(), e.id).toEqual(e.mounting.map((m) => m.role).sort());
      expect(Object.keys(g.leads).sort(), e.id).toEqual(e.cables.filter((c) => c.attachment === "captive").map((c) => c.id).sort());
      // Light sources exist exactly where the catalog has lighting hardware.
      expect(g.lights.map((l) => l.zone), e.id).toEqual(e.rgb ? e.rgb.zones : []);
      expect(g.solids.some((s) => s.role === "light"), e.id).toBe(!!e.rgb);
    }
  });

  it("parts take their outer size from the catalog and differ where the hardware differs", () => {
    const size = (id: string) => partGeometry(pcCatalog.entries.find((e) => e.id === id)!, pcCatalog.version).bounds.size;
    expect(size("corsair-4000d-airflow-black")).toEqual([453, 466, 230]);
    expect(size("fractal-north-charcoal-black-mesh")).toEqual([447, 469, 215]);
    expect(size("arctic-freezer-36")).toEqual([104, 159, 126]);
    expect(size("samsung-990-pro-1tb")).toEqual([80, 2.3, 22]);
    expect(size("samsung-870-evo-1tb")).toEqual([100, 6.8, 69.9]);
    expect(size("arctic-p12-pwm-pst")).toEqual([120, 120, 25]);
    // The key notch is in a different place on DDR4 and DDR5 modules.
    const notch = (id: string) => partGeometry(pcCatalog.entries.find((e) => e.id === id)!, pcCatalog.version).solids.find((s) => s.id === "notch")!.at[0];
    expect(notch("corsair-vengeance-rgb-ddr5-6000-32gb-kit")).not.toBe(notch("corsair-vengeance-lpx-ddr4-3600-16gb-kit"));
    // An AIO's radiator and pump block move separately.
    const aio = partGeometry(pcCatalog.entries.find((e) => e.id === "arctic-liquid-freezer-iii-240-argb")!, pcCatalog.version);
    expect(new Set(aio.solids.map((s) => s.group))).toEqual(new Set(["radiator", "block"]));
    expect(aio.solids.filter((s) => s.role === "fan")).toHaveLength(2);
  });
});

describe("asset validation", () => {
  const good = generateAssets(pcCatalog).files;

  it("accepts the generated assets of every catalog entry", () => {
    expect(validateAssets(pcCatalog, good, true)).toEqual([]);
  });

  it("requiring every entry reports each one that has no asset", () => {
    const two = generateAssets(pcCatalog, EXAMPLES).files;
    expect(validateAssets(pcCatalog, two)).toEqual([]);
    const missing = validateAssets(pcCatalog, two, true).filter((i) => i.rule === "missing_manifest_row");
    expect(missing).toHaveLength(pcCatalog.entries.length - EXAMPLES.length);
  });

  it("catches a hand edit, a wrong size, a dropped connector, a bare box and a missing label", () => {
    const path = geometryPath(EXAMPLES[1]!);
    const g = JSON.parse(good[path]!) as PartGeometry;
    const rules = (change: (x: PartGeometry) => void, files = good) => {
      const copy = JSON.parse(JSON.stringify(g)) as PartGeometry;
      change(copy);
      return validateAssets(pcCatalog, { ...files, [path]: `${JSON.stringify(copy, null, 2)}\n` }).map((i) => i.rule);
    };
    expect(rules((x) => { x.bounds.size[0] = 300; })).toEqual(expect.arrayContaining(["not_reproducible", "bounds_mismatch"]));
    expect(rules((x) => { delete x.ports["power-16pin"]; })).toContain("unmapped_element");
    expect(rules((x) => { x.solids = x.solids.filter((s) => s.role !== "fan"); })).toContain("too_little_detail");
    expect(rules((x) => { x.solids[0]!.at = [400, 60, 1]; })).toContain("outside_bounds");
    expect(rules((x) => { x.ports["ghost"] = x.ports["hdmi-1"]!; })).toContain("unknown_reference");
    const svgPath = thumbnailPath(EXAMPLES[1]!);
    expect(validateAssets(pcCatalog, { ...good, [svgPath]: good[svgPath]!.replace("Educational model", "Model") }).map((i) => i.rule)).toEqual(
      expect.arrayContaining(["missing_label", "not_reproducible"]),
    );
    const { [svgPath]: _gone, ...without } = good;
    expect(validateAssets(pcCatalog, without).map((i) => i.rule)).toContain("missing_file");
  });
});

describe("committed assets", () => {
  // UPDATE_ASSETS=1 rewrites the files under assets/pc/; otherwise the test proves they match the generator.
  it("match the generator byte for byte", () => {
    const { files } = generateAssets(pcCatalog);
    if (process.env.UPDATE_ASSETS === "1") {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(resolve(ASSETS, path)), { recursive: true });
        writeFileSync(resolve(ASSETS, path), content);
      }
    }
    const onDisk = Object.fromEntries(Object.keys(files).map((p) => [p, existsSync(resolve(ASSETS, p)) ? readFileSync(resolve(ASSETS, p), "utf8") : "<missing>"]));
    expect(onDisk).toEqual(files);
    expect(validateAssets(pcCatalog, onDisk, true)).toEqual([]);
  });

  it("the catalog claims a visual exactly for the entries whose files exist and validate", () => {
    const { manifest } = generateAssets(pcCatalog);
    const rows = new Map(manifest.assets.map((r) => [r.catalogId, r]));
    for (const e of pcCatalog.entries) {
      const row = rows.get(e.id);
      // Every entry has generated files now; the catalog says for each whether the drawing is good enough.
      expect(["educational", "placeholder"], e.id).toContain(e.asset.quality);
      expect([e.asset.model, e.asset.thumbnail, e.asset.kind, e.asset.metresPerUnit], e.id).toEqual([row?.geometry, row?.thumbnail, "procedural", row?.metresPerUnit]);
      expect(existsSync(resolve(ASSETS, e.asset.model ?? "")), e.id).toBe(true);
      expect(e.asset.provenance).toMatch(/not manufacturer-accurate/);
    }
  });
});
