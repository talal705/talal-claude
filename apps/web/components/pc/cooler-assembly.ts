// How a cooler is fitted and taken off, one documented step at a time (ARCTIC's manuals for Freezer 36, Liquid
// Freezer III and Freezer 7 X): the toolbar, the robot, the welcome back and the old-save helper all read the same
// `nextCoolerStep`, and `applyCoolerStep` takes exactly that step, so they cannot disagree. The engine still decides
// what is allowed; a step the learner picks by hand and the engine refuses is simply refused with its reason.
import type { PCBuildState } from "@ytl/contracts";
import { pcCatalog } from "./catalog";
import {
  ALL_SIMPLE_CABLES, ALL_SIMPLE_PARTS, applySimpleStep, createSimpleBuild, liftSimplePart, partSpec, placeRadiator, placeSimplePart, prepSimplePart, roleOf, seatedCpuKey,
  setRadiatorScrews, setSimpleHardware, setSimpleMechanism, simpleCableConnected, simpleCoolerMounting, simplePartInstalled, simpleRequiredScrews, simpleRetention,
  type SimpleBlock, type SimplePartKey, type SimpleStep,
} from "./simple-model";

type Result = { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock; message?: { en: string; ar: string } };
export type ScrewMove = "engaged" | "tight" | "loosened" | "out";

export type CoolerStep =
  | { kind: "cpuFirst" } | { kind: "boardFirst" }
  | { kind: "backplate"; value: "padding" | "tape" }
  | { kind: "lever" } | { kind: "plate" } | { kind: "ilm" } | { kind: "frame" }
  | { kind: "frameScrew"; index: number; to: ScrewMove; value: string }
  | { kind: "clean" } | { kind: "paste" } | { kind: "film" }
  | { kind: "position"; id: string } | { kind: "ring" } | { kind: "pin"; index: number; value: string }
  | { kind: "place" }
  | { kind: "screw"; index: number; to: ScrewMove; value: string }
  | { kind: "vrmFan" } | { kind: "radiator" } | { kind: "radiatorScrew"; count: number }
  | { kind: "radiatorUnscrew"; count: number } | { kind: "liftRadiator" } | { kind: "liftBody" }
  | null;

const instance = (state: PCBuildState, key: SimplePartKey) => state.parts.find((p) => p.instanceId === partSpec(key).id);
const swap = (value: string, i: number, c: string) => value.slice(0, i) + c + value.slice(i + 1);
const indices = (value: string, c: string) => [...value].flatMap((x, i) => (x === c ? [i] : []));

/** The screw to tighten next: across the frame (the opposite of the one just tightened) when there are four. */
const nextTight = (value: string) => {
  const tight = indices(value, "2");
  const engaged = indices(value, "1");
  if (value.length === 4 && tight.length === 1 && engaged.includes((tight[0]! + 2) % 4)) return (tight[0]! + 2) % 4;
  return engaged[0]!;
};
/** The screw to loosen next: across the frame from the one just loosened, when there are four. */
const nextLoosen = (value: string) => {
  const tight = indices(value, "2");
  if (value.length === 4 && tight.length === 3) return ((indices(value, "1")[0] ?? 0) + 2) % 4;
  return tight[0]!;
};
const screwStep = (value: string, move: ScrewMove, i: number) => ({ index: i, to: move, value: swap(value, i, move === "engaged" ? "1" : move === "tight" ? "2" : move === "loosened" ? "1" : "0") });

const boardInCase = (state: PCBuildState) => (instance(state, "motherboard")?.attachments.length ?? 0) > 0;
const bodyOf = (state: PCBuildState, key: SimplePartKey) =>
  instance(state, key)?.attachments.find((a) => a.target.hostInstanceId === partSpec(key).host && a.target.mountPointId === partSpec(key).mount);
const radiatorOf = (state: PCBuildState, key: SimplePartKey) => instance(state, key)?.attachments.find((a) => a.role === "radiator");

/** The next documented step for a cooler with a modelled mounting; null when it is fitted (or has no modelled mounting). */
export function nextCoolerStep(state: PCBuildState, key: SimplePartKey): CoolerStep {
  const m = simpleCoolerMounting(state, key);
  const part = instance(state, key);
  const board = instance(state, "motherboard");
  const cpu = seatedCpuKey(state);
  const entry = pcCatalog.entries.find((e) => e.id === partSpec(key).catalogId);
  if (!m || !part || !board || entry?.category !== "cooling") return null;
  if (!cpu) return { kind: "cpuFirst" };
  const hw = part.hardware ?? {};
  const bhw = board.hardware ?? {};
  const body = bodyOf(state, key);

  if (!body) {
    if (m.kind === "contact_frame" && bhw.frame_screws !== "2222") {
      if (!board.prep?.backplate && bhw.ilm !== "removed") return { kind: "backplate", value: boardInCase(state) ? "tape" : "padding" };
      const ret = simpleRetention(state, cpu)!;
      if (bhw.ilm !== "removed") {
        if (!ret.leverOpen) return { kind: "lever" };
        if (!ret.open) return { kind: "plate" };
        return { kind: "ilm" };
      }
      if (bhw.frame !== "placed") return { kind: "frame" };
      const screws = bhw.frame_screws ?? "0000";
      if (screws.includes("0")) return { kind: "frameScrew", ...screwStep(screws, "engaged", screws.indexOf("0")) };
      return { kind: "frameScrew", ...screwStep(screws, "tight", nextTight(screws)) };
    }
    if (m.kind === "retention_ring" && m.ring) {
      if (!hw.position) {
        const boardEntry = pcCatalog.entries.find((e) => e.id === board.catalogId);
        const socket = boardEntry?.category === "motherboard" ? boardEntry.spec.socket : undefined;
        return { kind: "position", id: (m.ring.positions.find((p) => (p.sockets as string[]).includes(socket ?? "")) ?? m.ring.positions[0]!).id };
      }
      if (hw.ring !== "placed") return { kind: "ring" };
      const pins = hw.pins ?? "0000";
      if (pins.includes("0")) return { kind: "pin", index: pins.indexOf("0"), value: swap(pins, pins.indexOf("0"), "1") };
    }
    if (hw.contact === "used" && hw.clean !== "done") return { kind: "clean" };
    const paste = entry.spec.paste;
    if ((paste?.supplied === "tube" || hw.contact === "used") && part.prep?.paste !== "applied" && paste) return { kind: "paste" };
    if (paste?.film && part.prep?.film !== "removed") return { kind: "film" };
    return { kind: "place" };
  }

  if (m.bodyScrews) {
    const screws = hw.screws ?? "0".repeat(m.bodyScrews.count);
    if (screws.includes("0")) return { kind: "screw", ...screwStep(screws, "engaged", screws.indexOf("0")) };
    if (screws.includes("1")) return { kind: "screw", ...screwStep(screws, "tight", nextTight(screws)) };
  }
  if (partSpec(key).radiator) {
    if (m.kit.some((k) => k.id === "vrm-fan-module") && hw.vrm_fan !== "attached") return { kind: "vrmFan" };
    const radiator = radiatorOf(state, key);
    if (!radiator) return boardInCase(state) ? { kind: "radiator" } : { kind: "boardFirst" };
    if (radiator.fastenersSecured < partSpec(key).radiator!.screws) return { kind: "radiatorScrew", count: radiator.fastenersSecured + 1 };
  }
  return null;
}

/** The next step of taking a cooler off: radiator first, then the body's screws (across, loosened before they come out), then the body. */
export function nextCoolerRemoval(state: PCBuildState, key: SimplePartKey): CoolerStep {
  const m = simpleCoolerMounting(state, key);
  const part = instance(state, key);
  if (!m || !part) return null;
  const radiator = radiatorOf(state, key);
  if (radiator) return radiator.fastenersSecured > 0 ? { kind: "radiatorUnscrew", count: radiator.fastenersSecured - 1 } : { kind: "liftRadiator" };
  if (!bodyOf(state, key)) return null;
  const screws = part.hardware?.screws;
  if (m.bodyScrews && screws?.includes("2")) return { kind: "screw", ...screwStep(screws, "loosened", nextLoosen(screws)) };
  if (m.bodyScrews && screws?.includes("1")) return { kind: "screw", ...screwStep(screws, "out", screws.indexOf("1")) };
  return { kind: "liftBody" };
}

/**
 * Optional, after a contact-frame cooler's body is off: taking the board's mounting hardware back off, in the
 * reverse of the manual's order (frame screws loosened across, then out; the frame off; the original ILM back on).
 * The frame is reusable, so this is never the next step of removing a cooler; the learner chooses it to lift the
 * CPU (the engine refuses that while the frame is over it) or to return the socket to its own mechanism.
 */
export type MountingStep = Extract<CoolerStep, { kind: "frameScrew" }> | { kind: "frameOff" } | { kind: "ilmRefit" } | null;
const COOLER_ROLES = new Set(["cooler", "aio"]);

/** The next step of taking the contact frame off and the ILM back on; null while a cooler body is on the socket, or when there is none. */
export function nextMountingRemoval(state: PCBuildState): MountingStep {
  if (state.mechanics !== "detailed") return null;
  const board = instance(state, "motherboard");
  if (!board) return null;
  // Anything on the socket's cooler mount sits over the frame: it comes off first, through its own removal.
  if (ALL_SIMPLE_PARTS.some((p) => COOLER_ROLES.has(roleOf(p.key)) && bodyOf(state, p.key))) return null;
  const hw = board.hardware ?? {};
  if (hw.frame === "placed") {
    const screws = hw.frame_screws ?? "0000";
    if (screws.includes("2")) return { kind: "frameScrew", ...screwStep(screws, "loosened", nextLoosen(screws)) };
    if (screws.includes("1")) return { kind: "frameScrew", ...screwStep(screws, "out", screws.indexOf("1")) };
    return { kind: "frameOff" };
  }
  if (hw.ilm === "removed") return { kind: "ilmRefit" };
  return null;
}

/**
 * Whether the learner is taking the board's mounting hardware off, read from the last saved step on it: a frame
 * screw loosened or out (fewer turns than the screw state before it), the frame lifted off, or the original ILM
 * put back. Fitting steps (a screw engaged or tightened, the frame placed, the ILM removed) mean they are fitting.
 * The engine states alone cannot say (a loosened screw and an engaged one are both "1"); the saved steps can.
 */
export function mountingDismantling(history: readonly SimpleStep[]): boolean {
  const turns = (v: string) => [...v].reduce((n, c) => n + Number(c), 0);
  let screws = "0000";
  let removing = false;
  for (const h of history) {
    const [, part, field, value = ""] = h.split(":");
    if (!h.startsWith("hw:") || part !== "motherboard") continue;
    if (field === "frame_screws") { removing = turns(value) < turns(screws); screws = value; }
    else if (field === "frame" || field === "ilm") removing = value === "";
  }
  return removing;
}

/** Takes one mounting step: one engine `set_hardware` change on the board, with the engine's own guards. */
export function applyMountingStep(state: PCBuildState, step: MountingStep): Result {
  switch (step?.kind) {
    case "frameScrew": return setSimpleHardware(state, "motherboard", "frame_screws", step.value);
    case "frameOff": return setSimpleHardware(state, "motherboard", "frame", "");
    case "ilmRefit": return setSimpleHardware(state, "motherboard", "ilm", "");
    default: return { ok: false, reason: "cannotFit" };
  }
}

/** The mounting step as it is saved: replayed on reload, popped by Undo, like every other step. */
export function mountingStepHistory(step: MountingStep): SimpleStep {
  switch (step?.kind) {
    case "frameScrew": return `hw:motherboard:frame_screws:${step.value}`;
    case "frameOff": return "hw:motherboard:frame:";
    case "ilmRefit": return "hw:motherboard:ilm:";
    default: throw new Error("not a savable mounting step");
  }
}

/** Takes one step. Hardware and fastener steps are one engine change each. */
export function applyCoolerStep(state: PCBuildState, key: SimplePartKey, step: CoolerStep): Result {
  if (!step) return { ok: false, reason: "cannotFit" };
  const cpu = seatedCpuKey(state);
  const ret = cpu ? simpleRetention(state, cpu) : null;
  switch (step.kind) {
    case "cpuFirst": return { ok: false, reason: "cpuFirst" };
    case "boardFirst": return { ok: false, reason: "boardFirst" };
    case "backplate": return prepSimplePart(state, "motherboard", "backplate", step.value);
    case "lever": return ret?.leverId ? setSimpleMechanism(state, ret.leverId, "open") : { ok: false, reason: "cannotFit" };
    case "plate": return ret ? setSimpleMechanism(state, ret.id, "open") : { ok: false, reason: "cannotFit" };
    case "ilm": return setSimpleHardware(state, "motherboard", "ilm", "removed");
    case "frame": return setSimpleHardware(state, "motherboard", "frame", "placed");
    case "frameScrew": return setSimpleHardware(state, "motherboard", "frame_screws", step.value);
    case "clean": return setSimpleHardware(state, key, "clean", "done");
    case "paste": return prepSimplePart(state, key, "paste", "applied");
    case "film": return prepSimplePart(state, key, "film", "removed");
    case "position": return setSimpleHardware(state, key, "position", step.id);
    case "ring": return setSimpleHardware(state, key, "ring", "placed");
    case "pin": return setSimpleHardware(state, key, "pins", step.value);
    case "place": return placeSimplePart(state, key);
    case "screw": return setSimpleHardware(state, key, "screws", step.value);
    case "vrmFan": return setSimpleHardware(state, key, "vrm_fan", "attached");
    case "radiator": return placeRadiator(state, key);
    case "radiatorScrew": case "radiatorUnscrew": return setRadiatorScrews(state, key, step.count);
    case "liftRadiator": return liftSimplePart(state, key, "radiator");
    case "liftBody": return liftSimplePart(state, key);
  }
}

/** The step as it is saved (see `SimpleStep`): the build before the step names the CPU socket's own mechanism ids. */
export function coolerStepHistory(state: PCBuildState, key: SimplePartKey, step: CoolerStep): SimpleStep {
  const cpu = seatedCpuKey(state);
  const ret = cpu ? simpleRetention(state, cpu) : null;
  switch (step?.kind) {
    case "backplate": return `prep:motherboard:backplate:${step.value}`;
    case "lever": return `mech:${ret?.leverId}:open`;
    case "plate": return `mech:${ret?.id}:open`;
    case "ilm": return "hw:motherboard:ilm:removed";
    case "frame": return "hw:motherboard:frame:placed";
    case "frameScrew": return `hw:motherboard:frame_screws:${step.value}`;
    case "clean": return `hw:${key}:clean:done`;
    case "paste": return `prep:${key}:paste:applied`;
    case "film": return `prep:${key}:film:removed`;
    case "position": return `hw:${key}:position:${step.id}`;
    case "ring": return `hw:${key}:ring:placed`;
    case "pin": return `hw:${key}:pins:${step.value}`;
    case "place": return `place:${key}`;
    case "screw": return `hw:${key}:screws:${step.value}`;
    case "vrmFan": return `hw:${key}:vrm_fan:attached`;
    case "radiator": return `rad:${key}`;
    case "radiatorScrew": case "radiatorUnscrew": return `radscrew:${key}:${step.count}`;
    case "liftRadiator": return `lift:${key}:rad`;
    case "liftBody": return `lift:${key}`;
    default: throw new Error("not a savable cooler step");
  }
}

export interface CoolerProgress {
  /** The body (the pump block, for a liquid cooler) is on the socket. */
  placed: boolean;
  /** Its screws that are tight, of how many. */
  secured: number;
  total: number;
  /** Everything mechanical is done: body, screws, and for a liquid cooler its radiator, fasteners and VRM module. */
  mechanicallyComplete: boolean;
  /** Every lead this cooler needs is connected (wiring is its own stage; false until then). */
  connected: boolean;
}
export function simpleCoolerProgress(state: PCBuildState, key: SimplePartKey): CoolerProgress {
  const leads = ALL_SIMPLE_CABLES.filter((c) => c.requires.includes(key));
  return {
    placed: Boolean(bodyOf(state, key)),
    secured: bodyOf(state, key)?.fastenersSecured ?? 0,
    total: simpleRequiredScrews(state, key),
    mechanicallyComplete: simplePartInstalled(state, key) && (!partSpec(key).radiator || instance(state, key)?.hardware?.vrm_fan === "attached" || !simpleCoolerMounting(state, key)?.kit.some((k) => k.id === "vrm-fan-module")),
    connected: leads.length > 0 && leads.every((c) => simpleCableConnected(state, c.key)),
  };
}

/**
 * The documented sequence in one call: only for old saves (`part:` steps) and tests. The page never calls it: a
 * learner takes the steps one by one.
 */
export function installCoolerWhole(state: PCBuildState, key: SimplePartKey): Result {
  let s = state;
  for (let i = 0; i < 80; i += 1) {
    const step = nextCoolerStep(s, key);
    if (!step) return { ok: true, state: s };
    if (step.kind === "cpuFirst" || step.kind === "boardFirst") return { ok: false, reason: step.kind };
    const r = applyCoolerStep(s, key, step);
    if (!r.ok) return r;
    s = r.state;
  }
  return { ok: false, reason: "cannotFit" };
}

const PREREQUISITE_KINDS = new Set(["backplate", "lever", "plate", "ilm", "frame", "frameScrew", "position", "ring", "pin", "clean"]);
/** The four corner screws of an older save, read as the two a contact-frame cooler really has. */
const OLD_SCREWS = ["10", "11", "21", "22"];
/**
 * Saves from before the documented cooler mounting: a cooler placed over a locked ILM with four corner screws.
 * Before the cooler is placed, the steps the manual puts first are inserted (backplate, ILM off, frame across,
 * or position, ring and pins); the four corner screws become the cooler's own two; a ring cooler takes none.
 * `part:` steps stay as they are (they run the whole sequence). A failure returns the history untouched.
 */
export function migrateCoolerSteps(history: readonly string[]): string[] {
  const coolerKeys = ALL_SIMPLE_PARTS.filter((p) => ["cooler", "aio"].includes(roleOf(p.key))).map((p) => p.key);
  const touches = (st: string) => coolerKeys.some((k) => st === `place:${k}` || st.startsWith(`screw:${k}:`));
  if (!history.some(touches) || history.some((st) => st.startsWith("hw:") || st.startsWith("rad:"))) return [...history];
  let state = createSimpleBuild();
  const out: string[] = [];
  const screwsDone: Record<string, number> = {};
  try {
    for (const st of history) {
      const place = coolerKeys.find((k) => st === `place:${k}` && simpleCoolerMounting(state, k));
      const screw = coolerKeys.find((k) => st.startsWith(`screw:${k}:`) && simpleCoolerMounting(state, k));
      if (place) {
        for (let i = 0; i < 40; i += 1) {
          const next = nextCoolerStep(state, place);
          if (!next || !PREREQUISITE_KINDS.has(next.kind)) break;
          const r = applyCoolerStep(state, place, next);
          if (!r.ok) return [...history];
          out.push(coolerStepHistory(state, place, next));
          state = r.state;
        }
      }
      if (screw) {
        if (!simpleCoolerMounting(state, screw)?.bodyScrews) continue; // a ring cooler has none
        const n = screwsDone[screw] ?? 0;
        screwsDone[screw] = n + 1;
        const next = `hw:${screw}:screws:${OLD_SCREWS[Math.min(n, OLD_SCREWS.length - 1)]}` as SimpleStep;
        state = applySimpleStep(state, next);
        out.push(next);
        continue;
      }
      state = applySimpleStep(state, st as SimpleStep);
      out.push(st);
    }
  } catch { return [...history]; }
  return out;
}
