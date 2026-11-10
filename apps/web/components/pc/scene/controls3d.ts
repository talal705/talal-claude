// Where the 3D view draws the things the learner clicks besides parts and cable ends: one marker per
// fastener of the selected part, and the switches outside the build (the case's power button and
// side panel, the power supply's switch and mains socket). Pure arithmetic, no rendering library.
// The positions are teaching positions near the real place, not measured from the product.
import type { InstalledPart, PCBuildState, PCSettingTarget } from "@ytl/contracts";
import type { Frame, PartGeometry, Vec3 } from "./geometry";
import { add, compose, rotate, scale, type PlacedPart } from "./placement";

export interface Hotspot {
  name: Extract<PCSettingTarget, "power-button" | "side-panel" | "psu-switch" | "wall-power">;
  ownerId: string;
  /** Centre and turn of the clickable box, in the scene. */
  frame: Frame;
  size: Vec3;
}

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const norm = (v: Vec3): Vec3 => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A box at `at` in the part's own frame, turned with the part. */
const onPart = (item: PlacedPart, at: Vec3): Frame => compose(item.frame, { at, quat: [0, 0, 0, 1] });

/**
 * The switches outside the build. The case's frame runs from its rear to its front along +x, up along +y,
 * and from the tray to the open side along +z: the button is at the top front, the panel on the open side.
 * The power supply's switch and mains socket are on its outer face (its −x face).
 */
export function settingHotspots(state: PCBuildState, placed: ReadonlyMap<string, PlacedPart>, categoryOf: (part: InstalledPart) => string | undefined): Hotspot[] {
  const spots: Hotspot[] = [];
  const theCase = state.parts.find((part) => categoryOf(part) === "case");
  const caseItem = theCase && placed.get(theCase.instanceId);
  if (theCase && caseItem) {
    const [x, y, z] = caseItem.size;
    spots.push({ name: "power-button", ownerId: theCase.instanceId, frame: onPart(caseItem, [x - 30, y + 6, z / 2]), size: [24, 12, 24] });
    spots.push({ name: "side-panel", ownerId: theCase.instanceId, frame: onPart(caseItem, [x / 2, y / 2, z + 4]), size: [x * 0.86, y * 0.86, 6] });
  }
  const psu = state.parts.find((part) => categoryOf(part) === "psu");
  const psuItem = psu && placed.get(psu.instanceId);
  if (psu && psuItem) {
    const [, y, z] = psuItem.size;
    spots.push({ name: "psu-switch", ownerId: psu.instanceId, frame: onPart(psuItem, [-6, y * 0.5, z * 0.25]), size: [10, 22, 16] });
    spots.push({ name: "wall-power", ownerId: psu.instanceId, frame: onPart(psuItem, [-6, y * 0.5, z * 0.65]), size: [10, 26, 34] });
  }
  return spots;
}

/** The part of a switch that takes the click: the whole button or switch, and for the side panel its handle along the top edge. */
export function clickBox(spot: Hotspot): { frame: Frame; size: Vec3 } {
  if (spot.name !== "side-panel") return { frame: spot.frame, size: spot.size };
  return { frame: compose(spot.frame, { at: [0, spot.size[1] / 2 - 12, 0], quat: [0, 0, 0, 1] }), size: [spot.size[0], 24, spot.size[2] + 4] };
}

export interface FastenerMarker {
  role: string;
  /** 0-based; the engine counts how many are secured, so marker `index` is secured when `index < secured`. */
  index: number;
  secured: boolean;
  at: Vec3;
}

/**
 * One marker per fastener of each mounted role of `part`, spaced evenly around its mount point in the
 * plane across the insert direction. Secured fasteners are the first ones, as the engine counts them.
 */
export function fastenerMarkers(
  part: InstalledPart,
  placed: ReadonlyMap<string, PlacedPart>,
  geometry: ReadonlyMap<string, PartGeometry>,
  catalogOf: (instanceId: string) => string | undefined,
  fastenerCount: (hostInstanceId: string, mountPointId: string) => number,
): FastenerMarker[] {
  const markers: FastenerMarker[] = [];
  for (const attachment of part.attachments) {
    const { hostInstanceId, mountPointId } = attachment.target;
    const count = fastenerCount(hostInstanceId, mountPointId);
    if (count === 0) continue;
    const host = placed.get(hostInstanceId);
    if (!host) continue;
    const mount = geometry.get(catalogOf(hostInstanceId) ?? "")?.mounts[mountPointId];
    const centre = onPart(host, mount ? mount.at : [host.size[0] / 2, host.size[1], host.size[2] / 2]);
    const insert = norm(mount ? rotate(host.frame.quat, mount.insert) : [0, -1, 0]);
    // Two directions across the insert direction.
    const helper: Vec3 = Math.abs(insert[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(insert, helper));
    const v = norm(cross(insert, u));
    const extent = mount?.size ? Math.max(mount.size[0], mount.size[1], mount.size[2]) / 2 : 40;
    const radius = Math.max(24, extent + 12);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + Math.PI / 4;
      const offset = add(scale(u, Math.cos(angle) * radius), scale(v, Math.sin(angle) * radius));
      markers.push({ role: attachment.role, index, secured: index < attachment.fastenersSecured, at: add(add(centre.at, offset), scale(insert, -8)) });
    }
  }
  return markers;
}
