import type { Vec3 } from "./geometry";

/** A lifted, floor-safe visual route; routing is cosmetic and never changes simulation results. */
export function cableRoutePoints(from: Vec3, to: Vec3): Vec3[] {
  const span = Math.hypot(...from.map((value, i) => to[i] - value));
  const lift = Math.min(48, Math.max(12, span * 0.12));
  const y = Math.max(8, Math.min(from[1], to[1]) + lift);
  return [from, [from[0], Math.max(from[1] + 8, y), from[2] + lift],
    [to[0], Math.max(to[1] + 8, y), to[2] + lift], to];
}

/**
 * A smoother route for one lead: it leaves its source, bows out toward the open side of the case
 * (+z) and the viewer, and arrives straight along the port's facing, so the plug sits square in its
 * header instead of entering at an angle. `endFacing` is the direction out of the port (unit vector).
 * Cosmetic only, like `cableRoutePoints`.
 */
export function smoothCableRoute(from: Vec3, to: Vec3, endFacing?: Vec3): Vec3[] {
  const span = Math.hypot(...from.map((value, i) => to[i] - value));
  const bow = Math.min(70, Math.max(16, span * 0.16));
  const facing = endFacing && Math.hypot(...endFacing) > 0.1 ? endFacing : ([0, 1, 0] as Vec3);
  const approach = Math.min(28, Math.max(12, span * 0.12));
  const near: Vec3 = [to[0] + facing[0] * approach, to[1] + facing[1] * approach, to[2] + facing[2] * approach];
  const floor = (y: number) => Math.max(8, y);
  const lerp = (t: number): Vec3 => [from[0] + (near[0] - from[0]) * t, from[1] + (near[1] - from[1]) * t, from[2] + (near[2] - from[2]) * t];
  // Two shoulders lift the run off whatever it crosses and give it a gentle, even curve.
  const a = lerp(0.3);
  const b = lerp(0.7);
  return [
    from,
    [a[0], floor(a[1] + bow * 0.35), a[2] + bow],
    [b[0], floor(b[1] + bow * 0.3), b[2] + bow * 0.8],
    near,
    to,
  ];
}

/**
 * How many conductors a lead is drawn with, their radius and spacing (mm), side by side as the
 * real flat or round bundles are: the 24-pin is a wide ribbon, CPU and GPU power narrower, fan and
 * front-panel leads thin.
 */
export function cableStrands(kind: string): { count: number; radius: number; pitch: number } {
  if (kind === "atx_main") return { count: 6, radius: 1.9, pitch: 3.9 };
  if (kind === "cpu_power" || kind === "gpu_power" || kind === "gpu_power_adapter") return { count: 4, radius: 1.9, pitch: 3.9 };
  if (kind === "fan_lead" || kind === "pump_lead") return { count: 2, radius: 1.1, pitch: 2.3 };
  if (kind === "front_panel_lead") return { count: 2, radius: 0.9, pitch: 1.9 };
  return { count: 1, radius: 1.8, pitch: 0 };
}

export interface Obstacle { min: Vec3; max: Vec3 }

const inside = (p: Vec3, box: Obstacle, margin: number) =>
  p[0] > box.min[0] - margin && p[0] < box.max[0] + margin && p[1] > box.min[1] - margin && p[1] < box.max[1] + margin && p[2] > box.min[2] - margin && p[2] < box.max[2] + margin;

/**
 * Bends a sampled cable path out of solid parts. Points inside a box (grown by `clearance`) move
 * to the nearest face, then the path is relaxed so the detour stays a smooth curve, a few times
 * over. The first and last `keep` points never move: the plug ends stay exactly at their ports and
 * still enter them straight; the rest of the run stays outside every part, including the one it plugs
 * into (a graphics card's own power lead goes around the card). Cosmetic: never changes what is connected.
 */
export function avoidObstacles(path: readonly Vec3[], boxes: readonly Obstacle[], clearance: number, keep = 2): Vec3[] {
  const points: number[][] = path.map((p) => [...p]);
  const first = path[0];
  const last = path[path.length - 1];
  // A part that holds both ends (a lead running across one part) is left alone; otherwise every part is
  // solid, the ones the lead leaves from and plugs into included: only the plug ends themselves may be inside.
  const solid = boxes.filter((box) => !(inside(first, box, clearance) && inside(last, box, clearance)));
  if (solid.length === 0 || points.length <= keep * 2) return points as unknown as Vec3[];
  const movable = (i: number) => i >= keep && i < points.length - keep;
  const pushOut = () => {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      if (!movable(i)) continue;
      for (const box of solid) {
        const p = points[i];
        if (!inside(p as unknown as Vec3, box, clearance)) continue;
        // The shortest way out of the grown box.
        let axis = 0;
        let best = Infinity;
        let target = 0;
        for (let k = 0; k < 3; k++) {
          const low = box.min[k] - clearance - p[k];
          const high = box.max[k] + clearance - p[k];
          if (-low < best) { best = -low; axis = k; target = box.min[k] - clearance - 0.01; }
          if (high < best) { best = high; axis = k; target = box.max[k] + clearance + 0.01; }
        }
        p[axis] = target;
        moved = true;
      }
    }
    return moved;
  };
  for (let round = 0; round < 8; round++) {
    if (!pushOut()) break;
    // Relax: each free point moves toward the middle of its neighbours, so no sharp kink remains.
    for (let pass = 0; pass < 2; pass++) {
      const before = points.map((p) => [...p]);
      for (let i = 0; i < points.length; i++) {
        if (!movable(i)) continue;
        for (let k = 0; k < 3; k++) points[i][k] = before[i][k] * 0.5 + (before[i - 1][k] + before[i + 1][k]) * 0.25;
      }
    }
  }
  pushOut();
  return points as unknown as Vec3[];
}

/** Connector silhouettes are intentionally distinct; these are schematic dimensions in millimetres. */
export function connectorSize(kind: string): [number, number, number] {
  if (kind === "atx_main") return [12, 12, 48];
  if (kind === "cpu_power" || kind === "gpu_power" || kind === "gpu_power_adapter") return [18, 10, 12];
  if (kind === "sata_power" || kind === "sata_data") return [22, 5, 8];
  if (kind === "fan_lead" || kind === "pump_lead") return [10, 6, 6];
  if (kind === "front_panel_lead") return [6, 6, 5];
  return [12, 7, 8];
}
