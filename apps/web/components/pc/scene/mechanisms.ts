// The scene's view of the retention mechanisms the engine tracks: the CPU load plate and lever, the
// socket cover, and memory latches. The drawing follows `InstalledPart.mechanisms`, so what the
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

/** The host's geometry with its mechanisms drawn in their current state (and the socket's orientation mark). */
export function withMechanisms(geometry: PartGeometry | undefined, part: InstalledPart): PartGeometry | undefined {
  if (!geometry) return geometry;
  const entry = catalogIndex.byId.get(part.catalogId);
  const retained = entry?.mountPoints.filter((m) => m.retention) ?? [];
  if (retained.length === 0) return geometry;
  const solids = geometry.solids.map((s) => ({ ...s }));
  const extra: Solid[] = [];
  for (const mount of retained) {
    const ret = mount.retention!;
    const open = part.mechanisms?.[ret.id] === "open";
    const place = solids.find((s) => s.id === mount.id);
    if (!place?.size) continue;
    const [cx, cy, cz] = place.at;
    const [sx, sy, sz] = place.size;
    if (ret.kind === "lga_load_plate" || ret.kind === "zif_lever") {
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
    if (ret.kind === "dimm_latch" && open) {
      const latch = solids.find((s) => s.id === `${mount.id}-latch`);
      if (latch) {
        // The latch tips outward, away from the slot.
        latch.at = [latch.at[0], latch.at[1] + 1.5, latch.at[2] + 3];
        latch.rotation = aboutX((35 * Math.PI) / 180);
      }
    }
  }
  return { ...geometry, solids: [...solids, ...extra] };
}

/**
 * A part the learner holds over its place: the frame it would have when placed (not pushed home),
 * turned about its own vertical axis through its attachment point, shifted off centre and lifted.
 */
export function heldFrame(placedAt: PlacedPart, geometry: PartGeometry | undefined, held: { rotationDeg: number; offsetMm: [number, number]; liftMm: number }): PlacedPart {
  const attach = geometry?.attach.main?.at ?? [0, 0, 0];
  const q = placedAt.frame.quat;
  const turn = aboutY((held.rotationDeg * Math.PI) / 180);
  const pivot = rotate(q, [attach[0] - rotate(turn, attach)[0], attach[1] - rotate(turn, attach)[1], attach[2] - rotate(turn, attach)[2]]);
  const shifted = add(add(placedAt.frame.at, pivot), rotate(q, [held.offsetMm[0], held.liftMm, held.offsetMm[1]]));
  const frame = compose({ at: shifted, quat: q }, { at: [0, 0, 0], quat: turn });
  return { ...placedAt, frame, onBench: false };
}

export { IDENTITY, aboutZ };
