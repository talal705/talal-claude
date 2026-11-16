import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { InstalledPart } from "@ytl/contracts";
import { createSimpleBuild, installSimplePart } from "../simple-model";
import { simpleBenchLayout } from "../simple-scene";
import type { PartGeometry, Vec3 } from "./geometry";
import { placeParts } from "./placement";

// The real model files, so sizes (and so the rows) are the ones the page uses.
const geometry = new Map<string, PartGeometry>();
for (const id of ["corsair-4000d-airflow-black", "asus-tuf-gaming-z790-plus-wifi", "intel-core-i5-14600k", "intel-core-i9-14900k", "arctic-liquid-freezer-iii-280", "corsair-vengeance-rgb-ddr5-6000-32gb-kit", "samsung-990-pro-1tb", "arctic-freezer-36", "asus-dual-rtx4060-o8g", "corsair-cx550", "corsair-airguide-120-4000d"]) {
  geometry.set(id, JSON.parse(readFileSync(new URL(`../../../../../assets/pc/geometry/${id}.json`, import.meta.url), "utf8")) as PartGeometry);
}
const fallbackSize = (): Vec3 => [120, 40, 120];
const standsFirst = (part: InstalledPart) => part.catalogId === "corsair-4000d-airflow-black";
const BENCH = { geometry, fallbackSize, standsFirst, benchRowMm: 950 };

describe("the workbench of the single-PC page", () => {
  const build = createSimpleBuild();
  const layout = simpleBenchLayout(build);
  const now = placeParts({ state: build, ...BENCH, ...layout });
  // The page before the second stick: the same build without it, laid out the old way.
  const before = placeParts({ state: { ...build, parts: build.parts.filter((p) => !["ram-11", "cpu-12", "cooling-13"].includes(p.instanceId)) }, ...BENCH });

  it("keeps every original part exactly where it started", () => {
    for (const [id, item] of before) expect(now.get(id)?.frame, id).toEqual(item.frame);
  });

  it("lays the second RAM stick beside the first, parallel, on the free bench in front of it", () => {
    const first = now.get("ram-4")!;
    const second = now.get("ram-11")!;
    expect(second.onBench).toBe(true);
    expect(second.frame.quat).toEqual(first.frame.quat);
    expect(second.frame.at[0]).toBe(first.frame.at[0]);
    expect(second.frame.at[2]).toBeGreaterThan(first.frame.at[2] + first.size[2]);
    // It overlaps no other bench part.
    for (const [id, item] of now) {
      if (id === "ram-11" || !item.onBench) continue;
      const apart = second.frame.at[0] + second.size[0] <= item.frame.at[0] || item.frame.at[0] + item.size[0] <= second.frame.at[0]
        || second.frame.at[2] + second.size[2] <= item.frame.at[2] || item.frame.at[2] + item.size[2] <= second.frame.at[2];
      expect(apart, id).toBe(true);
    }
  });

  it("lays the second CPU beside the first and the liquid cooler on free bench, overlapping nothing", () => {
    const first = now.get("cpu-3")!;
    const second = now.get("cpu-12")!;
    expect(second.onBench).toBe(true);
    expect(second.frame.at[0]).toBe(first.frame.at[0]);
    expect(second.frame.at[2]).toBeGreaterThan(first.frame.at[2] + first.size[2]);
    for (const id of ["cpu-12", "cooling-13"]) {
      const a = now.get(id)!;
      expect(a.onBench, id).toBe(true);
      for (const [other, item] of now) {
        if (other === id || !item.onBench) continue;
        const apart = a.frame.at[0] + a.size[0] <= item.frame.at[0] || item.frame.at[0] + item.size[0] <= a.frame.at[0]
          || a.frame.at[2] + a.size[2] <= item.frame.at[2] || item.frame.at[2] + item.size[2] <= a.frame.at[2];
        expect(apart, `${id} / ${other}`).toBe(true);
      }
    }
  });

  it("leaves the other bench parts in place while parts are installed", () => {
    let state = build;
    for (const key of ["cpu", "ram"] as const) {
      const step = installSimplePart(state, key);
      if (!step.ok) throw new Error(step.reason);
      state = step.state;
    }
    const after = placeParts({ state, ...BENCH, ...layout });
    for (const id of ["ram-11", "storage-5", "cooling-6", "gpu-7", "psu-8"]) expect(after.get(id)?.frame, id).toEqual(now.get(id)?.frame);
    expect(after.get("cpu-3")?.onBench).toBe(false);
  });
});
