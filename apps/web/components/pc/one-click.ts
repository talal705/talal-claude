// One-click installation (owner decision, 2026-11-28): the learner selects a part and one button fits it
// completely, in the right orientation and place, with its latches, clips and screws done. Every step is an
// existing saved engine transition (the same ones the step-by-step controls take), only in the installing
// direction. The whole sequence is built and checked on a copy of the build first: a refusal changes nothing,
// and the page saves the steps as one grouped action, so one Undo takes them all back. Cables are never touched.
import type { PCBuildState } from "@ytl/contracts";
import { attachmentOf, nextHandStep, type HandStep } from "./click-assembly";
import { applyCoolerStep, coolerStepHistory, nextCoolerStep, type CoolerStep } from "./cooler-assembly";
import {
  ALL_SIMPLE_PARTS, applySimpleStep, firstAttachment, hasModelledMounting, isM2Key, isPositionKey, isRamKey, lowerSimplePart, lowerSimpleRam, lowerStep, M2_WHOLE_TILT_DEG, partSpec,
  placeRadiator, placeSimplePart, prepSimplePart, reseatSimplePart, roleOf, screwSimplePart, setRadiatorScrews, setSimpleMechanism, simpleBlock, simpleCoolerMounting, simpleFansInTheWay,
  simpleKeying, simpleM2Slots, simpleOrientationAdvice, simplePartInstalled, simplePositions, simplePrepFor, simpleRamRecommended, simpleRamSlotOffsets, simpleRamSlots, simpleRequiredScrews,
  simpleRetention, simpleScrewOrder, type SimpleBlock, type SimpleHeld, type SimplePartKey, type SimpleStep,
} from "./simple-model";

type Localized = { en: string; ar: string };

/** Why a part cannot go in now. The build and the saved progress are left exactly as they were. */
export type InstallBlock =
  | { reason: "turnOff" }
  | { reason: "alreadyIn" }
  /** A mandatory prerequisite: another part has to be in (or out) first. */
  | { reason: "required"; block: SimpleBlock }
  | { reason: "placeTaken"; place: string }
  | { reason: "placeWrong"; place: string }
  | { reason: "noPlace" }
  /** A fan sits where a liquid cooler's radiator goes; it is never moved for the learner. */
  | { reason: "fanInTheWay"; fan: SimplePartKey }
  /** The engine refused a step, in its own words when it gave them. */
  | { reason: "refused"; message?: Localized };

/** Either the whole installation (the part ends fully fitted), or why not; never a part-way result. */
export type InstallPlan =
  | { ok: true; steps: SimpleStep[]; state: PCBuildState; place: string | null }
  | ({ ok: false } & InstallBlock);

/** A place a part with several possible places can go: a memory slot, an M.2 slot, a drive bay or a fan place. */
export interface InstallPlace { id: string; label: Localized; free: boolean; fits: boolean; recommended: boolean }

/** Every place this part could go, with whether it is free, fits, and is the recommended one; [] for a part with one place. */
export function installPlaces(state: PCBuildState, key: SimplePartKey): InstallPlace[] {
  const free = (occupant: string | null) => !occupant || occupant === key;
  if (isRamKey(key)) {
    // The board manual's layout for this many modules (this one included).
    const count = ALL_SIMPLE_PARTS.filter((p) => p.key !== key && isRamKey(p.key) && attachmentOf(state, p.key)).length + 1;
    const recommended = simpleRamRecommended(state, count);
    return simpleRamSlots(state).map((s) => ({ id: s.id, label: s.label, free: free(s.occupant), fits: true, recommended: recommended.includes(s.id) }));
  }
  // The plan's own place is the recommended one; any other free place that fits works too.
  if (isM2Key(key)) return simpleM2Slots(state, key).map((s) => ({ id: s.id, label: s.label, free: free(s.occupant), fits: s.fits, recommended: s.id === partSpec(key).mount }));
  if (isPositionKey(key)) return simplePositions(state, key).map((p) => ({ id: p.id, label: p.label, free: free(p.occupant), fits: p.fits, recommended: p.id === partSpec(key).mount }));
  return [];
}

/** The place one click uses unless the learner picks another: where the part already is, else the first free recommended place, else any free one. */
export function autoPlace(state: PCBuildState, key: SimplePartKey): string | null {
  const places = installPlaces(state, key);
  const own = attachmentOf(state, key)?.target.mountPointId;
  if (own && places.some((p) => p.id === own)) return own;
  const usable = places.filter((p) => p.free && p.fits);
  return (usable.find((p) => p.recommended) ?? usable[0])?.id ?? null;
}

/** A part held by a mechanism (CPU, memory, card, M.2 drive) rather than prepared, placed and screwed. */
const isKeyed = (state: PCBuildState, key: SimplePartKey, place: string | null) =>
  Boolean(simpleRetention(state, key, isM2Key(key) ? place ?? undefined : undefined)) && !partSpec(key).radiator;

/**
 * How a keyed part is held over `place` the right way: turned to its key, centred over the place, and an M.2 drive
 * at its insertion angle. Null for a part without a mechanism, or a memory or M.2 part without a place.
 */
export function installPose(state: PCBuildState, key: SimplePartKey, place: string | null): SimpleHeld | null {
  if (!isKeyed(state, key, place)) return null;
  const keying = simpleKeying(state, key);
  const pose: SimpleHeld = { key, rotationDeg: keying?.rotationDeg ?? 0, offsetMm: [0, 0] };
  if (isRamKey(key)) {
    const at = place ? simpleRamSlotOffsets(state).get(place) : undefined;
    if (!at) return null;
    pose.offsetMm = [at[0], at[1]];
  }
  if (isM2Key(key)) {
    if (!place) return null;
    const range = keying?.insertTiltDeg;
    pose.tiltDeg = !range || (M2_WHOLE_TILT_DEG >= range[0] && M2_WHOLE_TILT_DEG <= range[1]) ? M2_WHOLE_TILT_DEG : Math.round((range[0] + range[1]) / 2);
    pose.slotId = place;
  }
  return pose;
}

type Done = { ok: true; state: PCBuildState; steps: SimpleStep[] };
type Run = Done | ({ ok: false } & InstallBlock);
type Engine = { ok: true; state: PCBuildState } | { ok: false; message?: Localized };
/** No fitting takes this many steps; reaching it means the sequence is not converging, and nothing is saved. */
const STEP_LIMIT = 80;
const refused = (r?: { message?: Localized }): Run => ({ ok: false, reason: "refused", ...(r?.message ? { message: r.message } : {}) });

/** Takes one engine step on the copy and records the saved step that replays it. */
function take(run: Done, result: Engine, step: SimpleStep): Run {
  if (!result.ok) return refused(result);
  return { ok: true, state: result.state, steps: [...run.steps, step] };
}
const mech = (run: Done, id: string, desired: "open" | "closed") => take(run, setSimpleMechanism(run.state, id, desired), `mech:${id}:${desired}`);

/**
 * One step of a keyed part, in the installing direction only: before the part is in its place, covers come out and
 * levers, plates, latches, clips and heatsinks open; once it is in, it is pressed home and everything closes and is
 * screwed. Any other step (aiming, a taken slot, a release) ends the sequence unsaved.
 */
function keyedStep(run: Done, key: SimplePartKey, step: Exclude<HandStep, null>, pose: SimpleHeld): Run {
  const s = run.state;
  const inPlace = Boolean(attachmentOf(s, key));
  const ret = simpleRetention(s, key, isM2Key(key) ? pose.slotId : undefined);
  const way = inPlace ? "closed" : "open";
  switch (step.kind) {
    case "covers": return inPlace ? refused() : mech(run, step.id, "open");
    case "lever": return step.desired === way && ret?.leverId ? mech(run, ret.leverId, way) : refused();
    case "mechanism": return step.desired === way && ret ? mech(run, ret.id, way) : refused();
    case "clip": {
      const slot = simpleRamSlots(s).find((x) => x.id === step.slotId);
      const id = step.near ? slot?.nearId : slot?.clipId;
      return !inPlace && id ? mech(run, id, "open") : refused();
    }
    case "stand": return !inPlace && ret?.standId ? mech(run, ret.standId, "closed") : refused();
    case "heatsink": {
      // Off (screws out, lift) before the drive goes in; film, refit and screws after.
      const off = step.step === "screws" || step.step === "lift";
      if (off === inPlace) return refused();
      const [id, desired] = ({ screws: [`${step.hsId}:screws`, "open"], lift: [step.hsId, "open"], film: [`${step.hsId}:film`, "open"], fit: [step.hsId, "closed"], tighten: [`${step.hsId}:screws`, "closed"] } as const)[step.step];
      return mech(run, id, desired);
    }
    case "lower": {
      if (inPlace) return refused();
      return take(run, isRamKey(key) ? lowerSimpleRam(s, key, pose) : lowerSimplePart(s, key, pose), lowerStep(key, pose));
    }
    case "seat": return inPlace ? take(run, reseatSimplePart(s, key), `seat:${key}`) : refused();
    case "fasten": return inPlace ? take(run, screwSimplePart(s, key), `screw:${key}:${firstAttachment(s, key)?.fastenersSecured ?? 0}`) : refused();
    default: return refused();
  }
}

function keyedRun(start: PCBuildState, key: SimplePartKey, place: string | null): Run {
  const pose = installPose(start, key, place);
  if (!pose) return { ok: false, reason: "noPlace" };
  let run: Done = { ok: true, state: start, steps: [] };
  for (let i = 0; i < STEP_LIMIT; i += 1) {
    const step = nextHandStep(run.state, key, pose);
    if (!step) return run;
    if (step.kind === "slotTaken") return { ok: false, reason: "placeTaken", place: step.slotId };
    const next = keyedStep(run, key, step, pose);
    if (!next.ok) return next;
    run = next;
  }
  return refused();
}

/** The documented cooler steps that fit it (never one that loosens, lifts or takes off). */
const COOLER_FITTING = new Set(["backplate", "lever", "plate", "ilm", "frame", "frameScrew", "clean", "paste", "film", "position", "ring", "pin", "place", "screw", "vrmFan", "radiator", "radiatorScrew"]);

/**
 * A cooler with a documented mounting, through `nextCoolerStep`. A liquid cooler goes in whole (pump block, VRM module,
 * radiator and their screws), so it needs the board in the case: before that the click is refused and nothing is
 * saved. Its pump block can still be fitted on the bench by the step-by-step controls (owner decision 15).
 */
function coolerRun(start: PCBuildState, key: SimplePartKey): Run {
  let run: Done = { ok: true, state: start, steps: [] };
  for (let i = 0; i < STEP_LIMIT; i += 1) {
    const step: CoolerStep = nextCoolerStep(run.state, key);
    if (!step) return run;
    if (step.kind === "boardFirst") return { ok: false, reason: "required", block: "boardFirst" };
    if (step.kind === "cpuFirst") return { ok: false, reason: "required", block: "cpuFirst" };
    if (step.kind === "clearFans") return { ok: false, reason: "fanInTheWay", fan: step.fan };
    if (!COOLER_FITTING.has(step.kind) || ("to" in step && step.to !== "engaged" && step.to !== "tight")) return refused();
    const next = take(run, applyCoolerStep(run.state, key, step), coolerStepHistory(run.state, key, step));
    if (!next.ok) return next;
    run = next;
  }
  return refused();
}

/** Ways a part faces that both fit (advice only): a direction the learner already chose stands. */
const FACING = new Set(["psu_fan", "airflow"]);
/** A cooler's corner screws go in across the diagonal (see `simpleScrewOrder`). */
const CORNERS = [0, 2, 1, 3];

/** A board, power supply, drive, fan or a cooler without a documented mounting: its preparation, placing, then its screws. */
function screwedRun(start: PCBuildState, key: SimplePartKey, place: string | null, history: readonly SimpleStep[]): Run {
  let run: Done = { ok: true, state: start, steps: [] };
  // Each step: taken on the copy, or the reason it was refused (then nothing is saved).
  const steps = function* (): Generator<[Engine, SimpleStep]> {
    if (!firstAttachment(run.state, key)) {
      for (const prep of simplePrepFor(run.state, key)) {
        // A fan's airflow follows the place it goes (front and bottom pull in, rear and top blow out).
        const value = prep.prep === "airflow" ? (simpleOrientationAdvice(run.state, key, place ?? undefined) ?? prep.value) : prep.value;
        const now = run.state.parts.find((p) => p.instanceId === partSpec(key).id)?.prep?.[prep.prep];
        if (now === value || (FACING.has(prep.prep) && now)) continue;
        yield [prepSimplePart(run.state, key, prep.prep, value), `prep:${key}:${prep.prep}:${value}`];
      }
      yield [placeSimplePart(run.state, key, place ?? undefined), place && isPositionKey(key) ? `place:${key}@${place}` : `place:${key}`];
    }
    for (let secured = firstAttachment(run.state, key)?.fastenersSecured ?? 0; secured < simpleRequiredScrews(run.state, key); secured += 1) {
      const done = simpleScrewOrder([...history, ...run.steps], key).done;
      yield [screwSimplePart(run.state, key), `screw:${key}:${roleOf(key) === "cooler" ? (CORNERS.find((c) => !done.includes(c)) ?? secured) : secured}`];
    }
    // A liquid cooler without a documented mounting: its radiator in the case, then the radiator's screws.
    const radiator = partSpec(key).radiator;
    if (!radiator) return;
    if (!run.state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments.some((a) => a.role === "radiator")) yield [placeRadiator(run.state, key), `rad:${key}`];
    for (let count = radiatorScrews(run.state, key); count < radiator.screws; count += 1) yield [setRadiatorScrews(run.state, key, count + 1), `radscrew:${key}:${count + 1}`];
  };
  for (const [result, step] of steps()) {
    // A fan in the radiator's place is refused with its name: it is never moved for the learner.
    const fan = step.startsWith("rad:") ? simpleFansInTheWay(run.state, key)[0] : undefined;
    if (fan) return { ok: false, reason: "fanInTheWay", fan };
    const next = take(run, result, step);
    if (!next.ok) return next;
    run = next;
  }
  return run;
}
const radiatorScrews = (state: PCBuildState, key: SimplePartKey) =>
  state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments.find((a) => a.role === "radiator")?.fastenersSecured ?? 0;

/** Whether anything but this part's own fitting changed: another part's attachments, or any cable. */
function touchesOthers(before: PCBuildState, after: PCBuildState, key: SimplePartKey): boolean {
  const own = partSpec(key).id;
  const was = new Map(before.parts.map((p) => [p.instanceId, JSON.stringify(p.attachments)]));
  return after.parts.length !== before.parts.length
    || JSON.stringify(after.cables) !== JSON.stringify(before.cables)
    || after.parts.some((p) => p.instanceId !== own && was.get(p.instanceId) !== JSON.stringify(p.attachments));
}

/**
 * The complete installation of `key` at `place` (memory, M.2, bay or fan place; ignored for parts with one place), or
 * why it cannot happen now. `history` is the saved progress so far (a cooler's corner screws continue across it).
 * On success the steps are known to replay, from `state`, to exactly the returned build.
 */
export function planInstall(state: PCBuildState, key: SimplePartKey, place: string | null = autoPlace(state, key), history: readonly SimpleStep[] = []): InstallPlan {
  if (state.power.pressed) return { ok: false, reason: "turnOff" };
  if (simplePartInstalled(state, key)) return { ok: false, reason: "alreadyIn" };
  const block = simpleBlock(state, key);
  if (block) return { ok: false, reason: "required", block };
  const places = installPlaces(state, key);
  const at = places.length ? place : null;
  if (places.length) {
    const chosen = places.find((p) => p.id === place);
    if (!chosen) return { ok: false, reason: "noPlace" };
    if (!chosen.free) return { ok: false, reason: "placeTaken", place: chosen.id };
    if (!chosen.fits) return { ok: false, reason: "placeWrong", place: chosen.id };
  }
  const run = isKeyed(state, key, at) ? keyedRun(state, key, at)
    : hasModelledMounting(key) && simpleCoolerMounting(state, key) ? coolerRun(state, key)
    : screwedRun(state, key, at, history);
  if (!run.ok) return run;
  // An explicit end state: the part fully fitted, nothing else moved, and the saved steps replay.
  if (run.steps.length === 0 || !simplePartInstalled(run.state, key) || touchesOthers(state, run.state, key)) return { ok: false, reason: "refused" };
  try {
    let replay = state;
    for (const step of run.steps) replay = applySimpleStep(replay, step);
    if (JSON.stringify(replay) !== JSON.stringify(run.state)) return { ok: false, reason: "refused" };
  } catch { return { ok: false, reason: "refused" }; }
  return { ok: true, steps: run.steps, state: run.state, place: at };
}
