// Click-based assembly for parts that are held and keyed (CPU, memory, card, M.2 drive). A click on a
// real place brings the part in hand over that place, exactly as the learner turned it (it is never
// turned for them); each further click or the toolbar's action then takes ONE checked mechanical step:
// a lever, a plate, a clip, lowering, pressing home. The engine still refuses what cannot happen.
import type { PCBuildState } from "@ytl/contracts";
import type { SimpleSceneTarget } from "./simple-scene";
import {
  ALL_SIMPLE_PARTS, isM2Key, isRamKey, M2_WHOLE_TILT_DEG, partSpec, simpleBlock, simpleFastened, simpleKeying, simpleM2Heatsink, simpleM2Slots, simpleRamReference, simpleRamSlotOffsets, simpleRamSlots, slotCovers,
  simpleRamTargetFor, simpleRetention, simplePartInstalled, type SimpleBlock, type SimpleHeld, type SimplePartKey,
} from "./simple-model";

/** The tolerance a held part's place accepts when the catalog gives none (the memory slots' 1.5 mm). */
const DEFAULT_TOLERANCE_MM = 1.5;

/** Lenient on purpose (an unknown key reads as no attachment); companion.ts reads the same lookup. */
export const attachmentOf = (state: PCBuildState, key: SimplePartKey) =>
  state.parts.find((p) => p.instanceId === ALL_SIMPLE_PARTS.find((x) => x.key === key)?.id)?.attachments[0];

export type AimResult =
  | { ok: true; held: SimpleHeld; placeId: string }
  | { ok: false; reason: SimpleBlock | "slotTaken" | "notItsPlace" | "doesNotFit"; placeId: string };

/**
 * Brings the part in hand over the place the learner clicked: a memory module over that slot (any of
 * the board's slots), any other keyed part over the centre of its own place. The turn is kept as held.
 */
export function aimHeld(state: PCBuildState, held: SimpleHeld, placeId: string): AimResult {
  const blocked = simpleBlock(state, held.key);
  if (blocked) return { ok: false, reason: blocked, placeId };
  // An M.2 drive: any of the board's M.2 slots it fits (length and interface), over its connector, turn and tilt kept.
  if (isM2Key(held.key)) {
    const slot = simpleM2Slots(state, held.key).find((x) => x.id === placeId);
    if (!slot) return { ok: false, reason: "notItsPlace", placeId };
    if (slot.occupant && slot.occupant !== held.key) return { ok: false, reason: "slotTaken", placeId };
    if (!slot.fits) return { ok: false, reason: "doesNotFit", placeId };
    return { ok: true, held: { ...held, offsetMm: [0, 0], slotId: placeId }, placeId };
  }
  if (isRamKey(held.key)) {
    const slot = simpleRamSlots(state).find((x) => x.id === placeId);
    const offset = simpleRamSlotOffsets(state).get(placeId);
    if (!slot || !offset) return { ok: false, reason: "notItsPlace", placeId };
    if (slot.occupant && slot.occupant !== held.key) return { ok: false, reason: "slotTaken", placeId };
    return { ok: true, held: { ...held, offsetMm: [...offset] as [number, number] }, placeId };
  }
  const ret = simpleRetention(state, held.key);
  if (!ret || ret.mountPointId !== placeId) return { ok: false, reason: "notItsPlace", placeId };
  return { ok: true, held: { ...held, offsetMm: [0, 0] }, placeId };
}

/**
 * How an M.2 drive is held once the learner takes it out of its slot, read from where it is BEFORE the
 * removal: over that same slot's connector, turned as it was in (0°: the M-key only lets it in that way)
 * and at the insertion angle it rises to once its latch or screw is off. Null for anything that is not an
 * M.2 drive in a slot. Never another slot, and never a turn it did not have.
 */
export function m2LiftPose(state: PCBuildState, key: SimplePartKey): SimpleHeld | null {
  if (!isM2Key(key)) return null;
  const slotId = attachmentOf(state, key)?.target.mountPointId;
  if (!slotId) return null;
  return { key, rotationDeg: 0, offsetMm: [0, 0], tiltDeg: M2_WHOLE_TILT_DEG, slotId };
}

/**
 * Whether two holds are over the same place in the same way: the part, the slot it is over (M.2 drives
 * are all aimed at their connector centre, [0, 0], so only the slot tells M.2_1 from M.2_2) and the offset.
 */
export function sameAim(a: SimpleHeld, b: SimpleHeld): boolean {
  return a.key === b.key && (a.slotId ?? null) === (b.slotId ?? null) && a.offsetMm[0] === b.offsetMm[0] && a.offsetMm[1] === b.offsetMm[1];
}

export type AimClick = Extract<AimResult, { ok: false }> | { ok: true; held: SimpleHeld; placeId: string; moved: boolean };

/**
 * What a click on a place does with a keyed part in hand: refused (as aimHeld says), a move of the hand
 * over another place (turn and tilt kept, the build untouched), or, on the place it is already over, the
 * next mechanical step there (moved: false).
 */
export function aimClick(state: PCBuildState, held: SimpleHeld, placeId: string): AimClick {
  const r = aimHeld(state, held, placeId);
  if (!r.ok) return r;
  return { ok: true, held: r.held, placeId: r.placeId, moved: !sameAim(r.held, held) };
}

/**
 * One hand step at a time, whichever input asked for it (a click in the view, the toolbar, a panel
 * button, Enter or T). take() lets one step through per `ms`; calls nested inside that same input event
 * (the toolbar → the step → the mechanism) pass too, until `defer` runs at the end of the event. arm()
 * starts the wait without being refused itself: aiming the hand is never blocked, but a double click on
 * a slot does not also take a step.
 */
export function createStepGate(ms: number, defer: (f: () => void) => void = queueMicrotask) {
  let until = -Infinity;
  let open = false;
  return {
    take(now: number): boolean {
      if (open) return true;
      if (now < until) return false;
      until = now + ms;
      open = true;
      defer(() => { open = false; });
      return true;
    },
    arm(now: number): void { until = Math.max(until, now + ms); },
  };
}

/**
 * The places a click can aim the selected keyed part at. Memory: every slot, free or taken (a taken one
 * says so), as invisible pick boxes so no slot is suggested; once resting in a slot, only that slot (to
 * press it home). CPU: its socket, only while the socket is open and the CPU is not yet in it (before
 * that, the lever and the plate are clicked themselves).
 */
export function aimTargets(state: PCBuildState, key: SimplePartKey, held: SimpleHeld | null): SimpleSceneTarget[] {
  const at = attachmentOf(state, key);
  // An M.2 drive: every M.2 slot answers a click (none is suggested); once in, only its own slot.
  if (isM2Key(key)) {
    const host = partSpec(key).host;
    return simpleM2Slots(state, key).filter((slot) => !at || slot.id === at.target.mountPointId)
      .map((slot): SimpleSceneTarget => ({ id: `aim:${slot.id}`, kind: "mount", hostInstanceId: host, placeId: slot.id, role: at ? "target" : "decoy" }));
  }
  if (isRamKey(key)) {
    if (at?.seating === "seated") return [];
    const host = simpleRamReference(state).hostInstanceId;
    return simpleRamSlots(state)
      .filter((slot) => !at || slot.id === at.target.mountPointId)
      .map((slot): SimpleSceneTarget => ({ id: `aim:${slot.id}`, kind: "mount", hostInstanceId: host, placeId: slot.id, role: "decoy" }));
  }
  const ret = simpleRetention(state, key);
  if (!ret || at || !ret.open || held?.key !== key) return [];
  return [{ id: `aim:${ret.mountPointId}`, kind: "mount", hostInstanceId: ret.hostInstanceId, placeId: ret.mountPointId, role: "target" }];
}

/** The one mechanical step a click on the part's place (or the toolbar's action) takes next. */
export type HandStep =
  | { kind: "aim" }
  | { kind: "slotTaken"; slotId: string }
  | { kind: "clip"; slotId: string; near: boolean }
  | { kind: "lever"; desired: "open" | "closed" }
  | { kind: "mechanism"; desired: "open" | "closed" }
  /** One of the case's expansion-slot covers (its mechanism id), taken out for the card's bracket. */
  | { kind: "covers"; id: string }
  | { kind: "lower" }
  | { kind: "seat" }
  | { kind: "fasten" }
  /** An M.2 heatsink: loosen its screws, lift it off, peel its pad film, refit it, tighten its screws. */
  | { kind: "heatsink"; hsId: string; step: "screws" | "lift" | "film" | "fit" | "tighten" }
  /** A screw-held M.2 slot: fit the screw stand at the drive's length hole. */
  | { kind: "stand" }
  /** An M.2 drive in hand, not yet tilted to its insertion angle. */
  | { kind: "tilt" }
  | null;

/**
 * What comes next for a keyed part, from the build and the hand: null when there is nothing (the part is
 * in, or it has no mechanism of its own). A part in hand that is not over its place needs aiming first;
 * a part over its place is lowered as held, so a wrong turn is refused by the engine, not corrected.
 */
export function nextHandStep(state: PCBuildState, key: SimplePartKey, held: SimpleHeld | null): HandStep {
  const ret = simpleRetention(state, key);
  // In and done: taking it out again is its own choice in the panel, never the next click.
  if (!ret || simplePartInstalled(state, key)) return null;
  const at = attachmentOf(state, key);
  const hand = held?.key === key ? held : null;
  if (isM2Key(key)) return nextM2Step(state, key, hand, at);
  if (isRamKey(key)) {
    if (at) return at.seating !== "seated" ? { kind: "seat" } : null;
    const target = hand ? simpleRamTargetFor(state, hand.offsetMm) : null;
    const slot = target && simpleRamSlots(state).find((x) => x.id === target.slotId);
    if (!target || !slot) return { kind: "aim" };
    if (slot.occupant && slot.occupant !== key) return { kind: "slotTaken", slotId: slot.id };
    if (!slot.clipOpen) return { kind: "clip", slotId: slot.id, near: false };
    if (slot.nearId && !slot.nearOpen) return { kind: "clip", slotId: slot.id, near: true };
    return { kind: "lower" };
  }
  const gpu = ret.kind === "pcie_latch";
  const nextCover = !at && gpu ? slotCovers(state).find((c) => !c.open) : undefined;
  if (nextCover) return { kind: "covers", id: nextCover.id };
  if (ret.leverId && !ret.leverOpen && !ret.open) return { kind: "lever", desired: "open" };
  if (!at && !ret.open) return { kind: "mechanism", desired: "open" };
  if (!at) {
    const tolerance = simpleKeying(state, key)?.toleranceMm ?? DEFAULT_TOLERANCE_MM;
    return hand && Math.hypot(hand.offsetMm[0], hand.offsetMm[1]) <= tolerance ? { kind: "lower" } : { kind: "aim" };
  }
  if (at.seating !== "seated") return { kind: "seat" };
  if (gpu) return simpleFastened(state, key) ? null : { kind: "fasten" };
  // With the ILM off a contact frame holds the CPU (or will): the engine refuses the plate and lever, so they are not offered.
  if (ret.leverId && state.parts.find((p) => p.instanceId === ret.hostInstanceId)?.hardware?.ilm === "removed") return null;
  if (ret.open && ret.kind !== "dimm_latch") return { kind: "mechanism", desired: "closed" };
  if (ret.leverId && ret.leverOpen) return { kind: "lever", desired: "closed" };
  return null;
}

/**
 * An M.2 drive, in the order of the board's manual: the slot is chosen first (its heatsink and retention
 * depend on it); the heatsink comes off; the stand goes in or the Q-Latch is turned open; the drive is
 * tilted and inserted, pressed flat and held; then the film, the heatsink and its screws.
 */
function nextM2Step(state: PCBuildState, key: SimplePartKey, hand: SimpleHeld | null, at: ReturnType<typeof attachmentOf>): HandStep {
  const slotId = at?.target.mountPointId ?? hand?.slotId;
  if (!slotId) return { kind: "aim" };
  const ret = simpleRetention(state, key, slotId);
  if (!ret) return null;
  const hs = simpleM2Heatsink(state, slotId);
  if (!at) {
    if (hs?.fitted) return { kind: "heatsink", hsId: hs.id, step: hs.screwsIn ? "screws" : "lift" };
    const slot = simpleM2Slots(state, key).find((x) => x.id === slotId);
    if (slot?.occupant && slot.occupant !== key) return { kind: "slotTaken", slotId };
    if (ret.standId && !ret.standIn) return { kind: "stand" };
    if (ret.kind === "m2_qlatch" && !ret.open) return { kind: "mechanism", desired: "open" };
    const range = simpleKeying(state, key)?.insertTiltDeg;
    const tilt = hand?.tiltDeg;
    if (range && (tilt === undefined || tilt < range[0] || tilt > range[1])) return { kind: "tilt" };
    return { kind: "lower" };
  }
  if (at.seating !== "seated") return { kind: "seat" };
  // Pressed flat: the Q-Latch turned shut, or the screw in.
  if (ret.open) return { kind: "mechanism", desired: "closed" };
  if (hs?.filmOn) return { kind: "heatsink", hsId: hs.id, step: "film" };
  if (hs && !hs.fitted) return { kind: "heatsink", hsId: hs.id, step: "fit" };
  if (hs && !hs.screwsIn) return { kind: "heatsink", hsId: hs.id, step: "tighten" };
  return null;
}
