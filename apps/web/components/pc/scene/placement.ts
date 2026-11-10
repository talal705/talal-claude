// Where every part of a build stands in the scene, computed from the build state and the parts'
// geometry. Pure arithmetic, no rendering library:
//
//   world(part) = world(host) × host.mounts[mountPointId] × inverse(part.attach[role])
//
// A part that is placed but not pushed home sits back along the mount's `insert` direction by its
// travel; a partly seated one, by half of it. Parts not installed lie on the workbench: the case
// stands first (it is where the build happens), the rest in rows beside it. Parts with no geometry get a box of their catalog dimensions, so they can still be
// placed, selected and pointed at.
import type { InstalledPart, PCBuildState, SeatingState } from "@ytl/contracts";
import type { Frame, PartGeometry, Quat, Vec3 } from "./geometry";

export const IDENTITY: Quat = [0, 0, 0, 1];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** Hamilton product: the rotation `b` followed by `a`. */
export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

export const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** Rotates a vector by a unit quaternion. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 q × v; v' = v + w t + q × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** The frame `child`, given in the frame `parent`, expressed in the parent's own parent frame. */
export function compose(parent: Frame, child: Frame): Frame {
  return { at: add(parent.at, rotate(parent.quat, child.at)), quat: multiply(parent.quat, child.quat) };
}

export function inverse(frame: Frame): Frame {
  const quat = conjugate(frame.quat);
  return { at: scale(rotate(quat, frame.at), -1), quat };
}

/** How far back along the insert direction a part sits for each seating state, as a share of the travel. */
export const SEATING_BACKOFF: Record<SeatingState, number> = { placed: 1, partial: 0.5, seated: 0 };

export interface PlacedPart {
  instanceId: string;
  /** The part's frame in the scene, millimetres. */
  frame: Frame;
  /** Size of the part's bounding box in its own frame. */
  size: Vec3;
  /** The instance this part hangs from, or null for a part standing on its own (bench, case). */
  hostInstanceId: string | null;
  onBench: boolean;
  /**
   * For a part whose solids move in groups (one per mounting role), the scene frame of each group
   * that is mounted. A group not listed stays with `frame`, on the bench.
   */
  groupFrames: Record<string, Frame>;
}

export interface PlacementInput {
  state: PCBuildState;
  /** Geometry by catalog ID, for the parts that have one loaded. */
  geometry: ReadonlyMap<string, PartGeometry>;
  /** Width, height, depth in millimetres from the catalog, for parts without geometry. */
  fallbackSize(part: InstalledPart): Vec3;
  /** Gap between parts lying on the bench. */
  benchGapMm?: number;
  /** Standing parts that belong beside the build rather than in its row (the monitor): they get a row of their own, behind. */
  isAside?(part: InstalledPart): boolean;
  /** Parts that stand first, at the build position, before the workbench rows (the case). */
  standsFirst?(part: InstalledPart): boolean;
  /** Width of one workbench row; the next part starts a new row in front of it. */
  benchRowMm?: number;
  /** How far behind the main row the aside row stands. */
  asideDepthMm?: number;
}

/**
 * Frames for every part. A mounted part is placed from its first attachment whose host and mount
 * have geometry; when that is missing (the host has no model yet) it is drawn beside its host's
 * box rather than left out. The result is deterministic for the same state.
 */
export function placeParts({ state, geometry, fallbackSize, benchGapMm = 60, isAside, standsFirst, benchRowMm = 1400, asideDepthMm = 700 }: PlacementInput): Map<string, PlacedPart> {
  const placed = new Map<string, PlacedPart>();
  const byId = new Map(state.parts.map((part) => [part.instanceId, part]));
  const sizeOf = (part: InstalledPart): Vec3 => geometry.get(part.catalogId)?.bounds.size ?? fallbackSize(part);
  const bench = (part: InstalledPart, at: Vec3, size: Vec3) =>
    placed.set(part.instanceId, { instanceId: part.instanceId, frame: { at, quat: IDENTITY }, size, hostInstanceId: null, onBench: true, groupFrames: {} });

  // Standing parts first, left to right along +x: what is mounted nowhere.
  const loose = state.parts.filter((part) => part.attachments.length === 0);
  let cursor = 0;
  for (const part of loose.filter((item) => standsFirst?.(item) ?? false)) {
    const size = sizeOf(part);
    bench(part, [cursor, 0, 0], size);
    cursor += size[0] + benchGapMm;
  }
  // Then the workbench, in rows that wrap toward the viewer.
  const rowStart = cursor;
  let rowZ = 0;
  let rowDepth = 0;
  let asideCursor = 0;
  for (const part of loose) {
    if (standsFirst?.(part)) continue;
    const size = sizeOf(part);
    if (isAside?.(part)) {
      bench(part, [asideCursor, 0, -asideDepthMm - size[2]], size);
      asideCursor += size[0] + benchGapMm;
      continue;
    }
    if (cursor > rowStart && cursor + size[0] - rowStart > benchRowMm) {
      cursor = rowStart;
      rowZ += rowDepth + benchGapMm;
      rowDepth = 0;
    }
    bench(part, [cursor, 0, rowZ], size);
    cursor += size[0] + benchGapMm;
    rowDepth = Math.max(rowDepth, size[2]);
  }

  const visiting = new Set<string>();
  function place(part: InstalledPart): PlacedPart {
    const done = placed.get(part.instanceId);
    if (done) return done;
    const size = sizeOf(part);
    const fallback = (hostInstanceId: string | null, frame: Frame): PlacedPart => {
      const result = { instanceId: part.instanceId, frame, size, hostInstanceId, onBench: false, groupFrames: {} as Record<string, Frame> };
      placed.set(part.instanceId, result);
      return result;
    };
    // A cycle cannot come from the engine; guard anyway so bad stored data cannot hang the page.
    if (visiting.has(part.instanceId)) return fallback(null, { at: [cursor, 0, 0], quat: IDENTITY });
    visiting.add(part.instanceId);

    const own = geometry.get(part.catalogId);
    const grouped = own?.solids.some((solid) => solid.group !== undefined) ?? false;
    const groupFrames: Record<string, Frame> = {};
    let result: PlacedPart | null = null;
    for (const attachment of part.attachments) {
      const hostPart = byId.get(attachment.target.hostInstanceId);
      if (!hostPart) continue;
      const host = place(hostPart);
      const mount = geometry.get(hostPart.catalogId)?.mounts[attachment.target.mountPointId];
      const attach = own?.attach[attachment.role];
      if (mount && attach) {
        const backoff = scale(mount.insert, -mount.travelMm * SEATING_BACKOFF[attachment.seating]);
        const mountFrame: Frame = { at: add(mount.at, backoff), quat: mount.quat };
        const frame = compose(compose(host.frame, mountFrame), inverse(attach));
        // Each separately mounted body follows its own host; the part's frame is the first one.
        if (grouped) groupFrames[attachment.role] = frame;
        result ??= fallback(hostPart.instanceId, frame);
        if (grouped) continue;
      } else if (!result) {
        // No geometry for this joint: stand the part on top of its host's box, so it is visibly "on" it.
        result = fallback(hostPart.instanceId, compose(host.frame, { at: [0, host.size[1], 0], quat: IDENTITY }));
      }
      if (mount && attach) break;
    }
    visiting.delete(part.instanceId);
    const final = result ?? fallback(null, { at: [cursor, 0, 0], quat: IDENTITY });
    final.groupFrames = groupFrames;
    return final;
  }

  for (const part of state.parts) place(part);
  return placed;
}

/** The workbench top under every part that is not installed (x and z extent, millimetres), or null when nothing lies on it. */
export function workbenchArea(placed: ReadonlyMap<string, PlacedPart>, marginMm = 80): { min: [number, number]; max: [number, number] } | null {
  let area: { min: [number, number]; max: [number, number] } | null = null;
  for (const item of placed.values()) {
    if (!item.onBench) continue;
    const corners = boxCorners(item.frame, [0, 0, 0], item.size);
    for (const [x, , z] of corners) {
      area ??= { min: [x, z], max: [x, z] };
      area.min = [Math.min(area.min[0], x), Math.min(area.min[1], z)];
      area.max = [Math.max(area.max[0], x), Math.max(area.max[1], z)];
    }
  }
  return area && { min: [area.min[0] - marginMm, area.min[1] - marginMm], max: [area.max[0] + marginMm, area.max[1] + marginMm] };
}

/** The eight corners of a part's bounding box in scene coordinates, for projecting it to the screen. */
export function boxCorners(frame: Frame, min: Vec3, size: Vec3): Vec3[] {
  const corners: Vec3[] = [];
  for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) corners.push(add(frame.at, rotate(frame.quat, [min[0] + dx * size[0], min[1] + dy * size[1], min[2] + dz * size[2]])));
  return corners;
}

// ---------- Cable ends ----------

export interface PlacedCableEnd {
  at: Vec3;
  /** True when this end is in a port or in another cable's end. */
  plugged: boolean;
}

/** Where cable ends without a port lie: a strip beside the build, one row per cable. */
export const LOOSE_CABLE_STRIP: Vec3 = [-320, 0, 0];

/**
 * Where every cable end is in the scene. A plugged end is at its port (or at the end of the cable
 * it is plugged into); a loose end of a part's own cable hangs from where that cable leaves the
 * part; a loose end of a separate cable lies on the strip beside the build. Ends of parts with no
 * geometry are at the top of the part's box.
 */
export function placeCableEnds(state: PCBuildState, placed: ReadonlyMap<string, PlacedPart>, geometry: ReadonlyMap<string, PartGeometry>): Map<string, PlacedCableEnd> {
  const catalogOf = new Map(state.parts.map((part) => [part.instanceId, part.catalogId]));
  const byId = new Map(state.cables.map((cable) => [cable.id, cable]));
  const result = new Map<string, PlacedCableEnd>();
  const top = (item: PlacedPart): Vec3 => compose(item.frame, { at: [item.size[0] / 2, item.size[1], item.size[2] / 2], quat: IDENTITY }).at;

  function locate(cableId: string, endId: string, depth: number): PlacedCableEnd | null {
    const key = `${cableId}/${endId}`;
    const known = result.get(key);
    if (known) return known;
    const cable = byId.get(cableId);
    if (!cable || depth > 4) return null;
    const to = cable.ends[endId];
    let end: PlacedCableEnd | null = null;
    if (to?.kind === "part") {
      const host = placed.get(to.instanceId);
      const port = geometry.get(catalogOf.get(to.instanceId) ?? "")?.ports[to.portId];
      if (host) end = { at: port ? compose(host.frame, { at: port.at, quat: IDENTITY }).at : top(host), plugged: true };
    } else if (to?.kind === "cable") {
      const other = locate(to.cableId, to.endId, depth + 1);
      if (other) end = { at: other.at, plugged: true };
    } else {
      const endIndex = Math.max(0, Object.keys(cable.ends).indexOf(endId));
      const owner = cable.ownerInstanceId ? placed.get(cable.ownerInstanceId) : undefined;
      if (owner) {
        const lead = geometry.get(catalogOf.get(owner.instanceId) ?? "")?.leads[cable.cableSpecId];
        const exit = lead ? compose(owner.frame, { at: lead.at, quat: IDENTITY }).at : top(owner);
        // On the workbench a loose end lies in front of the part. In the case it hangs
        // below its lead, but never through the mat (a low PSU lead may be less than 60 mm up).
        end = owner.onBench
          ? { at: [exit[0] + 20 * endIndex, 8, owner.frame.at[2] + owner.size[2] + 30 + 25 * endIndex], plugged: false }
          : { at: [exit[0] + 20 * endIndex, Math.max(8, exit[1] - 60), exit[2] + 30 + 20 * endIndex], plugged: false };
      } else {
        const row = [...byId.keys()].indexOf(cableId);
        end = { at: add(LOOSE_CABLE_STRIP, [0, 10, row * 70 + endIndex * 160]), plugged: false };
      }
    }
    if (end) result.set(key, end);
    return end;
  }

  for (const cable of state.cables) for (const endId of Object.keys(cable.ends)) locate(cable.id, endId, 0);
  return result;
}
