// The scene's view of the retention mechanisms the engine tracks: the CPU load plate and lever, the
// socket cover, memory, PCIe and M.2 latches, and the case's expansion-slot covers. The drawing follows `InstalledPart.mechanisms`, so what the
// learner sees is always the state the engine checks (no separate animation state).
import type { InstalledPart } from "@ytl/contracts";
import { catalogIndex } from "../catalog";
import type { PartGeometry, Quat, Solid, Vec3 } from "./geometry";
import { add, compose, IDENTITY, rotate, type PlacedPart } from "./placement";

const aboutX = (angle: number): Quat => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
const aboutZ = (angle: number): Quat => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
const aboutY = (angle: number): Quat => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const box = (id: string, at: Vec3, size: Vec3, finish: Solid["finish"], rotation?: Quat): Solid =>
  ({ id, shape: "box", at, size, finish, role: "detail", basis: "schematic", ...(rotation ? { rotation } : {}) }) as Solid;

// The same geometry and mechanism states give the same object, so a part's meshes are rebuilt only when
// one of its own mechanisms moves (not on every change elsewhere in the build).
const drawn = new WeakMap<PartGeometry, Map<string, PartGeometry>>();

/** The host's geometry with its mechanisms drawn in their current state (and the socket's orientation mark). */
export function withMechanisms(geometry: PartGeometry | undefined, part: InstalledPart, socketDrawnApart = false): PartGeometry | undefined {
  if (!geometry) return geometry;
  const key = `${part.catalogId}|${socketDrawnApart}|${JSON.stringify(part.mechanisms ?? {})}`;
  let cache = drawn.get(geometry);
  if (!cache) { cache = new Map(); drawn.set(geometry, cache); }
  const hit = cache.get(key);
  if (hit) return hit;
  const result = drawMechanisms(geometry, part, socketDrawnApart);
  if (result) cache.set(key, result);
  return result;
}

function drawMechanisms(geometry: PartGeometry, part: InstalledPart, socketDrawnApart: boolean): PartGeometry {
  const entry = catalogIndex.byId.get(part.catalogId);
  const retained = entry?.mountPoints.filter((m) => m.retention) ?? [];
  if (retained.length === 0) return geometry;
  const solids = geometry.solids.map((s) => ({ ...s }));
  const extra: Solid[] = [];
  for (const mount of retained) {
    const ret = mount.retention!;
    const open = part.mechanisms?.[ret.id] === "open";
    if (ret.kind === "slot_covers") {
      // With the covers out, the top two (beside the first x16 slot) are gone from the rear wall.
      const covers = solids.find((s) => s.id === "slot-covers");
      if (covers?.size && open) {
        const per = covers.size[1] / (covers.count ?? 7);
        covers.count = Math.max(1, (covers.count ?? 7) - 2);
        covers.size = [covers.size[0], per * covers.count, covers.size[2]];
        covers.at = [covers.at[0], covers.at[1] - per, covers.at[2]];
      }
      continue;
    }
    const place = solids.find((s) => s.id === mount.id);
    if (!place?.size) continue;
    const [cx, cy, cz] = place.at;
    const [sx, sy, sz] = place.size;
    // The practice view draws the socket's lever and plate as moving parts of their own (SocketMechanism).
    if ((ret.kind === "lga_load_plate" || ret.kind === "zif_lever") && !socketDrawnApart) {
      // The socket's own corner mark, at the corner where the CPU's gold triangle must sit.
      extra.push(box(`${mount.id}-mark`, [cx - sx / 2 + 3, cy + sy / 2 + 0.2, cz + sz / 2 - 3], [3, 0.4, 3], "gold"));
      const lever = solids.find((s) => s.id === `${mount.id}-lever`);
      if (lever && open) {
        // The lever swings up about its end nearest the board edge.
        const half = (lever.height ?? 54) / 2;
        const a = (80 * Math.PI) / 180;
        lever.at = [lever.at[0], lever.at[1] + half * Math.sin(a), lever.at[2] - half + half * Math.cos(a)];
        lever.rotation = aboutX(-a);
      }
      const near = solids.find((s) => s.id === `${mount.id}-load-plate`);
      const far = solids.find((s) => s.id === `${mount.id}-load-plate-far`);
      if (near && far && open) {
        // The plate stands up on its hinge side, leaving the socket contacts uncovered.
        near.size = [0.8, sz - 4, 4];
        near.at = [cx + sx / 2 - 1, cy + sy / 2 + (sz - 4) / 2, cz - sz / 2 + 4];
        far.size = [0.8, sz - 4, 4];
        far.at = [cx + sx / 2 - 1, cy + sy / 2 + (sz - 4) / 2, cz + sz / 2 - 4];
        extra.push(box(`${mount.id}-plate-top`, [cx + sx / 2 - 1, cy + sy / 2 + sz - 4, cz], [0.8, 3, sz - 4], "nickel"));
      }
      if (ret.kind === "lga_load_plate" && part.mechanisms?.[`${ret.id}:cover`] !== "open") {
        // The protective socket cover sits on the plate until a seated CPU pushes it off as the plate closes.
        const lift = open ? sz - 4 : 1.5;
        extra.push(open
          ? box(`${mount.id}-cover`, [cx + sx / 2 + 1.5, cy + sy / 2 + lift / 2, cz], [2.5, sz - 10, sz - 10], "black_plastic")
          : box(`${mount.id}-cover`, [cx, cy + sy / 2 + 1.8, cz], [sx - 10, 2.5, sz - 10], "black_plastic"));
      }
    }
    if (ret.kind === "m2_qlatch") {
      // The Q-Latch at the slot's far end: across the drive's end when locked, turned aside when unlocked.
      extra.push(box(`${mount.id}-qlatch`, [cx + sx / 2 - 3, cy + sy / 2 + 2, cz], open ? [3, 3, 9] : [9, 3, 3], "black_plastic", open ? aboutY(Math.PI / 4) : undefined));
    }
    if (ret.kind === "pcie_latch" && open) {
      // The slot's push latch at its far end, pressed down and tipped away from the slot.
      const latch = solids.find((s) => s.id === `${mount.id}-latch`);
      if (latch?.size) {
        latch.at = [latch.at[0] + 2, latch.at[1] - latch.size[1] / 4, latch.at[2]];
        latch.rotation = aboutZ((-35 * Math.PI) / 180);
      }
    }
    if (ret.kind === "dimm_latch" && open && !socketDrawnApart) {
      const latch = solids.find((s) => s.id === `${mount.id}-latch`);
      if (latch) {
        // The latch tips outward, away from the middle of its slot (at whichever end it is).
        const slot = solids.find((s) => s.id === mount.id);
        const out = slot && latch.at[2] < slot.at[2] ? -1 : 1;
        latch.at = [latch.at[0], latch.at[1] + 1.5, latch.at[2] + 3 * out];
        latch.rotation = aboutX((out * 35 * Math.PI) / 180);
      }
    }
  }
  return { ...geometry, solids: [...solids, ...extra] };
}

/**
 * A part the learner holds over its place: the frame it would have when placed (not pushed home),
 * turned about its own vertical axis through the middle of its footprint (the way a hand turns it: a
 * module flipped end for end stays over the same slot), shifted off centre and lifted.
 */
export function heldFrame(placedAt: PlacedPart, geometry: PartGeometry | undefined, held: { rotationDeg: number; offsetMm: [number, number]; liftMm: number }): PlacedPart {
  const size = geometry?.bounds.size;
  const attach: [number, number, number] = size ? [size[0] / 2, 0, size[2] / 2] : [0, 0, 0];
  const q = placedAt.frame.quat;
  const turn = aboutY((held.rotationDeg * Math.PI) / 180);
  const pivot = rotate(q, [attach[0] - rotate(turn, attach)[0], attach[1] - rotate(turn, attach)[1], attach[2] - rotate(turn, attach)[2]]);
  const shifted = add(add(placedAt.frame.at, pivot), rotate(q, [held.offsetMm[0], held.liftMm, held.offsetMm[1]]));
  const frame = compose({ at: shifted, quat: q }, { at: [0, 0, 0], quat: turn });
  return { ...placedAt, frame, onBench: false };
}

export { IDENTITY, aboutZ };
