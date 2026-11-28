// The scene's view of the retention mechanisms the engine tracks: the CPU load plate and lever, the
// socket cover, memory, PCIe and M.2 latches, and the case's expansion-slot covers. The drawing follows `InstalledPart.mechanisms`, so what the
// learner sees is always the state the engine checks (no separate animation state).
import { slotCoverIds, slotCoverOpen, type InstalledPart, type MountPointSpec } from "@ytl/contracts";
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
      // Each cover is its own mechanism, counted from the top (the first x16 slot): the covers still in are drawn as
      // runs of plates (one run when none is out), so an out cover leaves its own gap in the rear wall.
      const covers = solids.find((s) => s.id === "slot-covers");
      if (!covers?.size) continue;
      const total = covers.count ?? 7;
      const per = covers.size[1] / total;
      const out = new Set(slotCoverIds(ret).flatMap((id, i) => (slotCoverOpen(part.mechanisms, ret, id) ? [i] : [])));
      const top = covers.at[1] + covers.size[1] / 2;
      solids.splice(solids.indexOf(covers), 1);
      for (let from = 0; from < total; ) {
        if (out.has(from)) { from += 1; continue; }
        let to = from;
        while (to < total && !out.has(to)) to += 1;
        extra.push({ ...covers, id: from === 0 && to === total ? covers.id : `${covers.id}-${from + 1}`, count: to - from, size: [covers.size[0], per * (to - from), covers.size[2]], at: [covers.at[0], top - (per * (from + to)) / 2, covers.at[2]] });
        from = to;
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
    if (ret.kind === "m2_screw") {
      // The screw stand at the drive's length hole (the slot's far end), and the screw over a drive held down.
      const standIn = part.mechanisms?.[`${ret.id}:stand`] === "closed";
      if (standIn) extra.push(box(`${mount.id}-stand`, [cx + sx / 2 - 3, cy + sy / 2 + 1, cz], [3, 2, 3], "nickel"));
      if (standIn && !open) extra.push(box(`${mount.id}-screw`, [cx + sx / 2 - 3, cy + sy / 2 + 3, cz], [4, 1, 4], "nickel"));
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
  extra.push(...m2Heatsinks(solids, entry?.mountPoints ?? [], part));
  return { ...geometry, solids: [...solids, ...extra] };
}

/**
 * A board's M.2 heatsinks: a plate over the slots it covers, two screws at its ends (standing up when
 * loosened). Lifted off, it rests beside those slots with its thermal pad's film showing until peeled.
 */
function m2Heatsinks(solids: Solid[], mounts: readonly MountPointSpec[], part: InstalledPart): Solid[] {
  const covered = new Map<string, Solid[]>();
  for (const m of mounts) {
    if (m.kind !== "m2_slot" || !m.heatsink) continue;
    const slot = solids.find((s) => s.id === m.id);
    if (slot?.size) covered.set(m.heatsink.id, [...(covered.get(m.heatsink.id) ?? []), slot]);
  }
  const out: Solid[] = [];
  for (const [id, slots] of covered) {
    const lo = (i: 0 | 1 | 2) => Math.min(...slots.map((s) => s.at[i] - s.size![i] / 2));
    const hi = (i: 0 | 1 | 2) => Math.max(...slots.map((s) => s.at[i] + s.size![i] / 2));
    const size: Vec3 = [hi(0) - lo(0) + 4, 5, hi(2) - lo(2) + 4];
    const fittedAt: Vec3 = [(lo(0) + hi(0)) / 2, hi(1) + 6, (lo(2) + hi(2)) / 2];
    const lifted = part.mechanisms?.[id] === "open";
    // Lifted: beside its slots and a little up, so the slots underneath are in plain view.
    const at: Vec3 = lifted ? [fittedAt[0], fittedAt[1] + 14, fittedAt[2] + size[2] + 10] : fittedAt;
    out.push(box(id, at, size, "black_metal"));
    const loose = part.mechanisms?.[`${id}:screws`] === "open";
    for (const [i, x] of [at[0] - size[0] / 2 + 3, at[0] + size[0] / 2 - 3].entries()) {
      out.push(box(`${id}-screw-${i}`, [x, at[1] + size[1] / 2 + (loose ? 3 : 0.5), at[2]], [3, loose ? 5 : 1, 3], "nickel"));
    }
    if (lifted && part.mechanisms?.[`${id}:film`] !== "open") out.push(box(`${id}-film`, [at[0], at[1] - size[1] / 2 - 0.4, at[2]], [size[0] - 4, 0.6, size[2] - 4], "glass"));
  }
  return out;
}

/**
 * A part the learner holds over its place: the frame it would have when placed (not pushed home),
 * turned about its own vertical axis through the middle of its footprint (the way a hand turns it: a
 * module flipped end for end stays over the same slot), shifted off centre and lifted.
 */
export function heldFrame(placedAt: PlacedPart, geometry: PartGeometry | undefined, held: { rotationDeg: number; offsetMm: [number, number]; liftMm: number; tiltDeg?: number }): PlacedPart {
  const size = geometry?.bounds.size;
  const attach: [number, number, number] = size ? [size[0] / 2, 0, size[2] / 2] : [0, 0, 0];
  const q = placedAt.frame.quat;
  const turn = aboutY((held.rotationDeg * Math.PI) / 180);
  const pivot = rotate(q, [attach[0] - rotate(turn, attach)[0], attach[1] - rotate(turn, attach)[1], attach[2] - rotate(turn, attach)[2]]);
  const shifted = add(add(placedAt.frame.at, pivot), rotate(q, [held.offsetMm[0], held.liftMm, held.offsetMm[1]]));
  const turned = compose({ at: shifted, quat: q }, { at: [0, 0, 0], quat: turn });
  // An M.2 drive tilted up for insertion: its far end rises about its connector end.
  const frame = held.tiltDeg ? compose(turned, { at: [0, 0, 0], quat: aboutZ((held.tiltDeg * Math.PI) / 180) }) : turned;
  return { ...placedAt, frame, onBench: false };
}

export { IDENTITY, aboutZ };
