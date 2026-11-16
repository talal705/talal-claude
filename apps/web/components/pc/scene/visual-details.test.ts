import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGeometry, type PartGeometry } from "./geometry";
import { withVisualDetails } from "./visual-details";
import { cableRoutePoints, connectorSize } from "./cable-visuals";

const ids = ["corsair-4000d-airflow-black", "asus-tuf-gaming-z790-plus-wifi", "arctic-freezer-36", "asus-dual-rtx4060-o8g", "corsair-cx550", "intel-core-i5-14600k", "samsung-990-pro-1tb", "corsair-vengeance-rgb-ddr5-6000-32gb-kit"];
function load(id: string) {
  const result = parseGeometry(JSON.parse(readFileSync(new URL(`../../../../../assets/pc/geometry/${id}.json`, import.meta.url), "utf8")), id);
  if (!result.ok) throw new Error(result.problem);
  return result.geometry;
}

describe("procedural visual improvements", () => {
  it.each(ids)("preserves %s mechanical anchors and the catalog envelope without mutating the source", (id) => {
    const source = load(id), original = JSON.stringify(source);
    const detailed = withVisualDetails(source);
    expect(JSON.stringify(source)).toBe(original);
    for (const field of ["bounds", "mounts", "ports", "leads", "attach", "lights"] as const) expect(detailed[field]).toBe(source[field]);
    expect(new Set(detailed.solids.map((solid) => solid.id)).size).toBe(detailed.solids.length);
    expect(detailed.solids.length).toBeGreaterThan(source.solids.length);
    expect(parseGeometry(detailed, id).ok).toBe(true);
  });
  it("opens the case front and cooler fan frames so the fan blades are visible", () => {
    const caseModel = withVisualDetails(load(ids[0]));
    expect(caseModel.solids.find((solid) => solid.id === "front-frame")!.size![2]).toBe(10);
    const cooler = withVisualDetails(load("arctic-freezer-36"));
    expect(cooler.solids.find((solid) => solid.id === "fan-frame-1")!.size![1]).toBe(8);
    expect(cooler.solids.some((solid) => solid.shape === "ring")).toBe(true);
  });
  it("uses an open ring grille instead of hiding the PSU rotor behind a filled cylinder", () => {
    expect(withVisualDetails(load("corsair-cx550")).solids.find((solid) => solid.id === "fan-grille")!.shape).toBe("ring");
  });
});

describe("cable presentation", () => {
  it("keeps exact source and destination anchors and lifts the route above the mat", () => {
    const source = [0, 8, 30] as const, destination = [200, 130, 50] as const;
    const points = cableRoutePoints(source, destination);
    expect(points.at(0)).toEqual(source);
    expect(points.at(-1)).toEqual(destination);
    expect(points.every((point) => point.every(Number.isFinite) && point[1] >= 8)).toBe(true);
  });
  it("distinguishes the wide ATX housing from GPU/EPS and small fan plugs", () => {
    expect(connectorSize("atx_main")[2]).toBeGreaterThan(connectorSize("gpu_power")[2]);
    expect(connectorSize("cpu_power")).toEqual(connectorSize("gpu_power"));
    expect(connectorSize("fan_lead")[0]).toBeLessThan(connectorSize("gpu_power")[0]);
  });
});

describe("optional RGB diffusers", () => {
  const read = (id: string) => JSON.parse(readFileSync(new URL(`../../../../../assets/pc/geometry/${id}.json`, import.meta.url), "utf8")) as PartGeometry;
  it("exist only on the case fans and the liquid cooler, as their own role, so RGB off draws parts as before", () => {
    const rgbOf = (id: string) => withVisualDetails(read(id)).solids.filter((s) => s.role === "rgb");
    expect(rgbOf("corsair-airguide-120-4000d")).toHaveLength(2);
    const aio = rgbOf("arctic-liquid-freezer-iii-280");
    expect(aio.map((s) => s.group).sort()).toEqual(["block", "radiator", "radiator"]);
    for (const id of ["intel-core-i5-14600k", "arctic-freezer-36", "asus-tuf-gaming-z790-plus-wifi", "corsair-vengeance-rgb-ddr5-6000-32gb-kit"]) expect(rgbOf(id), id).toEqual([]);
    // Without its rings, a part is exactly what it was.
    const fan = withVisualDetails(read("corsair-airguide-120-4000d"));
    expect(fan.solids.filter((s) => s.role !== "rgb")).toEqual(read("corsair-airguide-120-4000d").solids);
  });
});

describe("finer detail", () => {
  it("adds board details only where nothing is installed or plugged in", () => {
    const board = withVisualDetails(load("asus-tuf-gaming-z790-plus-wifi"));
    const places = board.solids.filter((s) => /^(cpu_socket|dimm_slot|m2_slot|pcie_slot|cooler_keepout|port|io_shield|edge_connector)$/.test(s.role));
    const footprint = (s: (typeof board.solids)[number]) => {
      const size = s.size ?? [2 * (s.radius ?? 1), s.height ?? 1, 2 * (s.radius ?? 1)];
      return { x: [s.at[0] - size[0] / 2, s.at[0] + size[0] / 2], z: [s.at[2] - size[2] / 2, s.at[2] + size[2] / 2] };
    };
    const added = board.solids.filter((s) => /^detail-(board-screw|board-smd|audio-|chipset-groove)/.test(s.id));
    expect(added.length).toBeGreaterThan(60);
    for (const detail of added) {
      const a = footprint(detail);
      for (const place of places) {
        const b = footprint(place);
        const overlaps = a.x[0] < b.x[1] && b.x[0] < a.x[1] && a.z[0] < b.z[1] && b.z[0] < a.z[1];
        expect(overlaps, `${detail.id} over ${place.id}`).toBe(false);
      }
    }
  });

  it("draws every pin's wire: 24 for the motherboard plug, 8 for CPU and GPU power, 4 for a fan", async () => {
    const { cableStrands } = await import("./cable-visuals");
    const wires = (kind: string) => { const s = cableStrands(kind); return s.count * s.rows; };
    expect([wires("atx_main"), wires("cpu_power"), wires("gpu_power"), wires("fan_lead"), wires("pump_lead")]).toEqual([24, 8, 8, 4, 4]);
  });
});
