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
