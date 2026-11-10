// How far the camera stands so a box fills the picture, for the canvas's real shape. Pure arithmetic.
// A bounding sphere wastes most of a wide or a tall picture; this fits the box's corners themselves,
// so the parts on the workbench come out as large as the canvas allows at 1280 and at 375 pixels.
import type { Vec3 } from "./geometry";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Distance from `centre` along `direction` (toward the camera) at which every corner is inside the view,
 * with `margin` (1.08 = 8 % spare). `vfovDeg` is the vertical field of view, `aspect` width / height.
 */
export function fitDistance(corners: readonly Vec3[], centre: Vec3, direction: Vec3, vfovDeg: number, aspect: number, margin = 1.08): number {
  const back = norm(direction);
  const right = norm(cross([0, 1, 0], back));
  const up = cross(back, right);
  const tanV = Math.tan((vfovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(aspect, 0.01);
  let distance = 0;
  for (const corner of corners) {
    const p = sub(corner, centre);
    const towardCamera = dot(p, back);
    distance = Math.max(distance, Math.abs(dot(p, up)) / tanV + towardCamera, Math.abs(dot(p, right)) / tanH + towardCamera);
  }
  return distance * margin;
}
