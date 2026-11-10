import { describe, expect, it } from "vitest";
import { fitDistance } from "./camera-fit";
import type { Vec3 } from "./geometry";

const box = (w: number, h: number, d: number): Vec3[] => {
  const corners: Vec3[] = [];
  for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) for (const z of [-d / 2, d / 2]) corners.push([x, y, z]);
  return corners;
};

describe("fitDistance", () => {
  it("fits a flat bench from the front: the distance follows the narrower side of the picture", () => {
    const bench = box(1200, 0, 600);
    const wide = fitDistance(bench, [0, 0, 0], [0, 0, 1], 40, 1280 / 560, 1);
    const narrow = fitDistance(bench, [0, 0, 0], [0, 0, 1], 40, 343 / 400, 1);
    // Width 1200 at a 343:400 picture needs more distance than at a wide one.
    expect(narrow).toBeGreaterThan(wide);
    expect(narrow).toBeCloseTo(600 / (Math.tan((20 * Math.PI) / 180) * (343 / 400)) + 300, 3);
  });

  it("stands closer than a bounding sphere would for a long, low workbench", () => {
    const bench = box(1400, 200, 700);
    const radius = Math.hypot(700, 100, 350);
    const sphere = radius / Math.sin((20 * Math.PI) / 180);
    expect(fitDistance(bench, [0, 0, 0], [0.3, 0.9, 0.8], 40, 1280 / 560)).toBeLessThan(sphere);
  });
});
