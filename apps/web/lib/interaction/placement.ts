// Where the robot stands relative to a rectangle it must not cover. Pure geometry in
// viewport pixels; physical left/right are derived from the text direction here and nowhere else.
import type { TargetRect } from "@ytl/contracts";

export type Direction = "ltr" | "rtl";
export type LogicalSide = "inline-end" | "inline-start" | "above" | "below";
export type PhysicalSide = "left" | "right" | "above" | "below";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PlacementInput {
  target: TargetRect;
  viewport: Size;
  robot: Size;
  direction: Direction;
  /** Sides to try, best first. Defaults to inline-end, inline-start, above, below. */
  prefer?: readonly LogicalSide[];
  /** Space kept between the robot and the target. Must exceed the idle float amplitude. */
  gap?: number;
  /** Space kept between the robot and the viewport edge. */
  margin?: number;
  /** Other rectangles the robot should stay off when it has a choice (the help panel). */
  avoid?: readonly TargetRect[];
}

export interface Placement extends Point {
  side: PhysicalSide | "corner";
  /** True only when the target leaves no free side; the robot then takes the least-covering corner. */
  coversTarget: boolean;
}

const DEFAULT_ORDER: readonly LogicalSide[] = ["inline-end", "inline-start", "above", "below"];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function overlapArea(a: TargetRect, b: TargetRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export function toPhysical(side: LogicalSide, direction: Direction): PhysicalSide {
  if (side === "inline-end") return direction === "rtl" ? "left" : "right";
  if (side === "inline-start") return direction === "rtl" ? "right" : "left";
  return side;
}

export function placeBeside(input: PlacementInput): Placement {
  const { target, viewport, robot, direction } = input;
  const gap = input.gap ?? 12;
  const margin = input.margin ?? 8;
  const avoid = input.avoid ?? [];
  const maxX = viewport.width - robot.width - margin;
  const maxY = viewport.height - robot.height - margin;
  const centredX = clamp(target.x + target.width / 2 - robot.width / 2, margin, maxX);
  const centredY = clamp(target.y + target.height / 2 - robot.height / 2, margin, maxY);

  const at = (side: PhysicalSide): Point => {
    if (side === "right") return { x: target.x + target.width + gap, y: centredY };
    if (side === "left") return { x: target.x - gap - robot.width, y: centredY };
    if (side === "above") return { x: centredX, y: target.y - gap - robot.height };
    return { x: centredX, y: target.y + target.height + gap };
  };
  const fits = (p: Point) => p.x >= margin && p.x <= maxX && p.y >= margin && p.y <= maxY;
  const cost = (p: Point) => {
    const rect = { ...p, ...robot };
    return avoid.reduce((sum, other) => sum + overlapArea(rect, other), 0);
  };

  let best: (Placement & { cost: number }) | null = null;
  for (const logical of input.prefer ?? DEFAULT_ORDER) {
    const side = toPhysical(logical, direction);
    const point = at(side);
    if (!fits(point)) continue;
    const candidate = { ...point, side, coversTarget: false, cost: cost(point) };
    if (!best || candidate.cost < best.cost) best = candidate;
    if (best.cost === 0) break;
  }
  if (best) return { x: best.x, y: best.y, side: best.side, coversTarget: false };

  // No free side: take the viewport corner that covers the least of the target.
  const corners: Point[] = [
    { x: direction === "rtl" ? margin : maxX, y: margin },
    { x: direction === "rtl" ? maxX : margin, y: margin },
    { x: direction === "rtl" ? margin : maxX, y: maxY },
    { x: direction === "rtl" ? maxX : margin, y: maxY },
  ].map((p) => ({ x: Math.max(margin, p.x), y: Math.max(margin, p.y) }));
  let corner = corners[0];
  let covered = Number.POSITIVE_INFINITY;
  for (const point of corners) {
    const area = overlapArea({ ...point, ...robot }, target) + cost(point) / 1000;
    if (area < covered) {
      covered = area;
      corner = point;
    }
  }
  return { ...corner, side: "corner", coversTarget: overlapArea({ ...corner, ...robot }, target) > 0 };
}

/** The point on the rectangle closest to `from`: where the arm aims. */
export function nearestPointOn(rect: TargetRect, from: Point): Point {
  return {
    x: clamp(from.x, rect.x, rect.x + rect.width),
    y: clamp(from.y, rect.y, rect.y + rect.height),
  };
}

/**
 * Rotation in degrees for an arm that hangs straight down at 0 and turns clockwise on
 * screen as the angle grows, so that it aims from `shoulder` at `at`.
 */
export function armAngle(shoulder: Point, at: Point): number {
  const dx = at.x - shoulder.x;
  const dy = at.y - shoulder.y;
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(-dx, dy) * 180) / Math.PI;
}

// ---------- Pointing placement with obstacles ----------

/** Sizes tried, largest first. Below half size the character stops being readable. */
export const ROBOT_SCALES: readonly number[] = [1, 0.8, 0.64, 0.5];
/** Clear space kept around every obstacle; covers the idle float of a pointing robot. */
const OBSTACLE_CLEARANCE = 3;
const SEARCH_STEP = 16;

export type PlacementRule =
  /** Full size, touching distance from the target, covering nothing. */
  | "beside"
  /** Same, at a reduced size because the free strip next to the target is narrow. */
  | "beside-smaller"
  /** No free strip next to the target: the nearest spot on screen that covers nothing. */
  | "free-spot"
  /** Nothing on screen is free: smallest size, next to the target, where it covers the least. */
  | "least-overlap";

export interface RobotPlacementInput {
  target: TargetRect;
  viewport: Size;
  /** Full-size robot. */
  robot: Size;
  direction: Direction;
  /** Everything the robot must not stand on: other targets, text, controls, the help panel. */
  obstacles: readonly TargetRect[];
  scales?: readonly number[];
  margin?: number;
}

export interface RobotPlacement extends Point {
  scale: number;
  rule: PlacementRule;
  /** Obstacle area in square pixels under the robot. 0 for every rule except `least-overlap`. */
  covered: number;
}

const grow = (rect: TargetRect, by: number): TargetRect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + by * 2,
  height: rect.height + by * 2,
});

/** Distance from a point to the nearest point of a rectangle. */
function distanceTo(rect: TargetRect, from: Point): number {
  const near = nearestPointOn(rect, from);
  return Math.hypot(near.x - from.x, near.y - from.y);
}

/**
 * Drops obstacle rectangles that cannot be avoided or do not matter: those outside the viewport,
 * those inside the target (its own label), and those that contain the target (its container).
 */
export function relevantObstacles(rects: readonly TargetRect[], target: TargetRect, viewport: Size): TargetRect[] {
  const slack = 1;
  return rects.filter((rect) => {
    if (!(rect.width > 0 && rect.height > 0)) return false;
    if (rect.x >= viewport.width || rect.y >= viewport.height || rect.x + rect.width <= 0 || rect.y + rect.height <= 0) return false;
    const inside =
      rect.x >= target.x - slack &&
      rect.y >= target.y - slack &&
      rect.x + rect.width <= target.x + target.width + slack &&
      rect.y + rect.height <= target.y + target.height + slack;
    const contains =
      rect.x <= target.x + slack &&
      rect.y <= target.y + slack &&
      rect.x + rect.width >= target.x + target.width - slack &&
      rect.y + rect.height >= target.y + target.height - slack;
    return !inside && !contains;
  });
}

/**
 * Where the robot stands while it points. It never covers the target. Rules, in order:
 * 1. `beside` — full size, right next to the target (inline-end, inline-start, above, below;
 *    centred on the edge, then slid to either end of it), covering no obstacle.
 * 2. `beside-smaller` — the same positions at each smaller size.
 * 3. `free-spot` — the spot nearest to the target that covers nothing, largest size first.
 * 4. `least-overlap` — smallest size next to the target, where the covered obstacle area is least.
 */
export function placeRobot(input: RobotPlacementInput): RobotPlacement {
  const { target, viewport, robot, direction, obstacles } = input;
  const margin = input.margin ?? 8;
  const scales = input.scales ?? ROBOT_SCALES;
  const padded = obstacles.map((rect) => grow(rect, OBSTACLE_CLEARANCE));

  const sizeAt = (scale: number): Size => ({ width: robot.width * scale, height: robot.height * scale });
  const gapAt = (scale: number) => Math.max(6, 12 * scale);
  const inViewport = (p: Point, size: Size) =>
    p.x >= margin && p.y >= margin && p.x + size.width <= viewport.width - margin && p.y + size.height <= viewport.height - margin;
  const coveredAt = (p: Point, size: Size) => {
    const rect = { ...p, ...size };
    return padded.reduce((sum, other) => sum + overlapArea(rect, other), 0);
  };

  /** Positions touching the target: four sides, three places along each side. */
  const beside = (scale: number): Point[] => {
    const size = sizeAt(scale);
    const gap = gapAt(scale);
    const maxX = viewport.width - size.width - margin;
    const maxY = viewport.height - size.height - margin;
    const along = (start: number, length: number, own: number, max: number) => {
      const places = [start + length / 2 - own / 2, start, start + length - own].map((v) => clamp(v, margin, max));
      return direction === "rtl" ? [places[0], places[2], places[1]] : places;
    };
    const xs = along(target.x, target.width, size.width, maxX);
    const ys = [target.y + target.height / 2 - size.height / 2, target.y, target.y + target.height - size.height].map((v) =>
      clamp(v, margin, maxY),
    );
    const points: Point[] = [];
    for (const logical of DEFAULT_ORDER) {
      const side = toPhysical(logical, direction);
      if (side === "right") for (const y of ys) points.push({ x: target.x + target.width + gap, y });
      else if (side === "left") for (const y of ys) points.push({ x: target.x - gap - size.width, y });
      else if (side === "above") for (const x of xs) points.push({ x, y: target.y - gap - size.height });
      else for (const x of xs) points.push({ x, y: target.y + target.height + gap });
    }
    return points.filter((p) => inViewport(p, size) && overlapArea({ ...p, ...size }, target) === 0);
  };

  for (const scale of scales) {
    const size = sizeAt(scale);
    const free = beside(scale).find((p) => coveredAt(p, size) === 0);
    if (free) return { ...free, scale, rule: scale === scales[0] ? "beside" : "beside-smaller", covered: 0 };
  }

  // The search grid is anchored to the target, so the chosen spot keeps its offset while the page scrolls.
  for (const scale of scales) {
    const size = sizeAt(scale);
    const keepOff = grow(target, gapAt(scale) - 0.5);
    let best: Point | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const firstX = target.x + Math.ceil((margin - target.x) / SEARCH_STEP) * SEARCH_STEP;
    const firstY = target.y + Math.ceil((margin - target.y) / SEARCH_STEP) * SEARCH_STEP;
    for (let y = firstY; y + size.height <= viewport.height - margin; y += SEARCH_STEP) {
      for (let x = firstX; x + size.width <= viewport.width - margin; x += SEARCH_STEP) {
        const point = { x, y };
        const distance = distanceTo(target, { x: x + size.width / 2, y: y + size.height / 2 });
        if (distance >= bestDistance) continue;
        if (overlapArea({ ...point, ...size }, keepOff) > 0 || coveredAt(point, size) > 0) continue;
        best = point;
        bestDistance = distance;
      }
    }
    if (best) return { ...best, scale, rule: "free-spot", covered: 0 };
  }

  const scale = scales[scales.length - 1];
  const size = sizeAt(scale);
  let least: Point | null = null;
  let leastCovered = Number.POSITIVE_INFINITY;
  for (const point of beside(scale)) {
    const covered = coveredAt(point, size);
    if (covered < leastCovered) {
      least = point;
      leastCovered = covered;
    }
  }
  if (least) return { ...least, scale, rule: "least-overlap", covered: leastCovered };

  // The target leaves no side free at all (it fills the viewport): a corner, as far from its centre as possible.
  const corner = placeBeside({ target, viewport, robot: size, direction, margin });
  return { x: corner.x, y: corner.y, scale, rule: "least-overlap", covered: coveredAt(corner, size) };
}

// ---------- Idle (home) placement ----------

/** Sizes tried for the idle robot outside the launcher, largest first. */
export const HOME_SCALES: readonly number[] = [1, 0.8, 0.64];

export interface HomePlacementInput {
  /** The tutor's dock: the Help button, plus the panel when it is open. */
  dock: TargetRect;
  /** The place reserved for the robot inside the Help button. */
  slot: TargetRect;
  viewport: Size;
  /** Full-size robot. */
  robot: Size;
  direction: Direction;
  /** On a narrow screen the page fills the width, so the robot always rests inside the Help button. */
  narrow: boolean;
  /** True when nothing on the page (text, controls, other targets) is under this rectangle. */
  isFree(rect: TargetRect): boolean;
  margin?: number;
}

export interface HomePlacement extends Point {
  scale: number;
  /** `beside-dock`: floating next to the dock over empty page. `in-launcher`: resting inside the Help button. */
  rule: "beside-dock" | "in-launcher";
}

/**
 * Where the robot rests when it is not pointing. It floats next to the dock only over empty page:
 * above the dock (at its inline-end edge, then centred), then on its inline-start side, at each
 * size in HOME_SCALES. When none of those is free, or the screen is narrow, it rests inside the
 * Help button, scaled to fit the slot, where it covers nothing but the tutor's own button.
 */
export function placeHome(input: HomePlacementInput): HomePlacement {
  const { dock, slot, viewport, robot, direction } = input;
  const margin = input.margin ?? 8;
  const gap = 8;
  if (!input.narrow) {
    for (const scale of HOME_SCALES) {
      const size = { width: robot.width * scale, height: robot.height * scale };
      const endAligned = direction === "rtl" ? dock.x : dock.x + dock.width - size.width;
      const above = dock.y - gap - size.height;
      const beside = direction === "rtl" ? dock.x + dock.width + gap : dock.x - gap - size.width;
      const candidates: Point[] = [
        { x: endAligned, y: above },
        { x: dock.x + dock.width / 2 - size.width / 2, y: above },
        { x: beside, y: dock.y + dock.height - size.height },
      ];
      for (const point of candidates) {
        const inside =
          point.x >= margin &&
          point.y >= margin &&
          point.x + size.width <= viewport.width - margin &&
          point.y + size.height <= viewport.height - margin;
        if (inside && input.isFree({ ...point, ...size })) return { ...point, scale, rule: "beside-dock" };
      }
    }
  }
  const scale = Math.min(1, slot.width / robot.width, slot.height / robot.height);
  return {
    x: slot.x + (slot.width - robot.width * scale) / 2,
    y: slot.y + (slot.height - robot.height * scale) / 2,
    scale,
    rule: "in-launcher",
  };
}
