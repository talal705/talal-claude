import { describe, expect, it } from "vitest";
import { avoidObstacles, smoothCableRoute, type Obstacle } from "./cable-visuals";
import type { Vec3 } from "./geometry";

const line = (from: Vec3, to: Vec3, n = 21): Vec3[] => Array.from({ length: n }, (_, i) => from.map((v, k) => v + ((to[k] - v) * i) / (n - 1)) as unknown as Vec3);
const insideBox = (p: Vec3, box: Obstacle) => p.every((v, k) => v > box.min[k] && v < box.max[k]);

describe("cable routing", () => {
  const gpu: Obstacle = { min: [40, -20, -20], max: [60, 20, 20] };

  it("bends a run out of a part it would pass through, and keeps both plug ends exactly in place", () => {
    const path = line([0, 0, 0], [100, 0, 0]);
    expect(path.some((p) => insideBox(p, gpu))).toBe(true);
    const routed = avoidObstacles(path, [gpu], 3);
    expect(routed.some((p) => insideBox(p, gpu))).toBe(false);
    expect(routed[0]).toEqual([0, 0, 0]);
    expect(routed.at(-1)).toEqual([100, 0, 0]);
    expect(routed[1]).toEqual(path[1]);
    expect(routed.at(-2)).toEqual(path.at(-2));
  });

  it("leaves no sharp kink: neighbouring points stay close together", () => {
    const routed = avoidObstacles(line([0, 0, 0], [100, 0, 0], 41), [gpu], 3);
    const steps = routed.slice(1).map((p, i) => Math.hypot(...p.map((v, k) => v - routed[i][k])));
    expect(Math.max(...steps)).toBeLessThan(30);
  });

  it("keeps the run outside the part it plugs into, except the plug end itself", () => {
    const card: Obstacle = { min: [70, -20, -20], max: [110, 20, 20] };
    const path = line([0, 0, 0], [100, 0, 0], 41);
    const routed = avoidObstacles(path, [card], 3);
    expect(routed.at(-1)).toEqual([100, 0, 0]);
    expect(routed.slice(2, -2).some((p) => insideBox(p, card))).toBe(false);
  });

  it("leaves alone a part that holds both ends", () => {
    const board: Obstacle = { min: [-10, -10, -10], max: [110, 10, 10] };
    const path = line([0, 0, 0], [100, 0, 0]);
    expect(avoidObstacles(path, [board], 3)).toEqual(path);
  });

  it("arrives straight along the port's facing", () => {
    const route = smoothCableRoute([0, 0, 0], [200, 100, 0], [0, 1, 0]);
    const [near, end] = route.slice(-2);
    expect(near[0]).toBeCloseTo(end[0]);
    expect(near[2]).toBeCloseTo(end[2]);
    expect(near[1]).toBeGreaterThan(end[1]);
  });
});
