// Non-drag cabling for the network lab, in two pure state machines:
// 1. "Select a cable end, then a port" to connect devices (the shared select-then-place machine).
// 2. The Ethernet-plug exercise: eight wires in eight positions, moved with the keyboard, a
//    wiring standard chosen, the plug crimped, the wiremap result read.
// Neither decides correctness. Which ports can take a cable end, and whether a plug is wired
// correctly, come from the network engine; these machines only carry the learner's choices to
// it and its answers back.
import {
  PLUG_POSITIONS,
  WIRE_COLORS,
  networkTarget,
  type CablePortOption,
  type CablingAction,
  type Localized,
  type PlugAttempt,
  type PlugWiremap,
  type WireColor,
  type WiringStandard,
} from "@ytl/contracts";
import {
  selectionReducer,
  type KeyLike,
  type SelectionCandidate,
  type SelectionEffect,
  type SelectionEvent,
  type SelectionOptions,
  type SelectionState,
  type SelectionStep,
} from "./selection";

// =====================================================================================
// 1. Connect a cable end to a port
// =====================================================================================

// ---------- Machine ----------

export interface CablingSubject {
  kind: "cable-end";
  cableId: string;
  endId: string;
  /** Read out, e.g. "Ethernet cable 2, free end". */
  label: Localized;
}

export type CablingState = SelectionState<CablingSubject, CablingAction>;
export type CablingEvent = SelectionEvent<CablingSubject, CablingAction>;
export type CablingEffect = SelectionEffect<CablingSubject, CablingAction>;

export const initialCablingState: CablingState = { phase: "idle", announcement: null };

export function portCandidates(cableId: string, endId: string, options: readonly CablePortOption[]): SelectionCandidate<CablingAction>[] {
  return options.map((option) => {
    const target = networkTarget.port(option.to);
    return {
      id: target.id,
      label: option.label,
      ok: option.ok,
      reason: option.ok ? undefined : option.reason,
      action: { type: "connect_cable_end", cableId, endId, to: option.to },
      target,
    };
  });
}

/**
 * Same states, keys and effects as the PC lab's assembly flow (see ./selection.ts): pick a cable
 * end, go through the ports, place, hear the result. Announcement keys live in `tutor.cabling.announce`.
 */
export function cablingReducer(state: CablingState, event: CablingEvent, options: SelectionOptions = {}): SelectionStep<CablingSubject, CablingAction> {
  return selectionReducer(state, event, options);
}

// =====================================================================================
// 2. The Ethernet-plug exercise
// =====================================================================================

// ---------- State ----------

export type PlugAnnouncementKey =
  | "grabbed"
  | "moved"
  | "dropped"
  | "grabCancelled"
  | "atEdge"
  | "standardChosen"
  | "needStandard"
  | "crimping"
  | "passed"
  | "failed"
  | "locked"
  | "reset";

export interface PlugAnnouncement {
  seq: number;
  key: PlugAnnouncementKey;
  /** Named in the sentence through `tutor.cabling.plug.wire.<colour>`. */
  wire?: WireColor;
  values?: Record<string, number | string>;
  /** The engine's sentence, appended as-is (the wiremap summary). */
  detail?: Localized;
  politeness: "polite" | "assertive";
}

export interface PlugState {
  /**
   * `arranging`: wires can be moved. `crimping`: the attempt is with the engine.
   * `crimped`: the result is shown and the wires are fixed until the learner cuts the plug off.
   */
  phase: "arranging" | "crimping" | "crimped";
  /** The wire in each position, pin 1 first. */
  order: readonly WireColor[];
  /** Position (0-based) that has the roving focus. */
  activeIndex: number;
  /** While a wire is picked up, the order to restore if the learner cancels. */
  grabbedFrom: readonly WireColor[] | null;
  standard: WiringStandard | null;
  /** The engine's wiremap, present only in `crimped`. */
  result: PlugWiremap | null;
  announcement: PlugAnnouncement | null;
}

export type PlugEvent =
  /** Arrow keys: move the focus, or the picked-up wire. `left` is always toward pin 1. */
  | { type: "arrow"; direction: "left" | "right" }
  | { type: "jump"; to: "first" | "last" }
  /** Focus moved by pointer or by focus itself. */
  | { type: "focus"; index: number }
  /** Space or Enter: pick the focused wire up, or put it down. */
  | { type: "toggle-grab" }
  /** Escape: put the picked-up wire back where it was. */
  | { type: "cancel" }
  /** "Move left" / "Move right" buttons: moves the wire at `index` one position without picking it up. */
  | { type: "shift"; index: number; direction: "left" | "right" }
  | { type: "choose-standard"; standard: WiringStandard }
  | { type: "crimp" }
  /** The engine's wiremap for the attempt that was sent. */
  | { type: "result"; wiremap: PlugWiremap }
  /** Cut the plug off and start again. `order` is the new starting arrangement from the lab. */
  | { type: "reset"; order?: readonly WireColor[] };

export type PlugEffect =
  /** Send this attempt to the engine, then send `result`. */
  | { type: "crimp"; attempt: PlugAttempt }
  /** Move DOM focus to the wire now at this position. */
  | { type: "focus-position"; index: number };

export interface PlugStep {
  state: PlugState;
  effects: PlugEffect[];
}

/** `order` is the starting arrangement, supplied by the lab or the lesson; it is not judged here. */
export function createPlugState(order: readonly WireColor[]): PlugState {
  if (order.length !== PLUG_POSITIONS || new Set(order).size !== PLUG_POSITIONS || !order.every((wire) => WIRE_COLORS.includes(wire))) {
    throw new Error("A plug needs each of the eight wires exactly once");
  }
  return { phase: "arranging", order: [...order], activeIndex: 0, grabbedFrom: null, standard: null, result: null, announcement: null };
}

// ---------- Keyboard ----------

/**
 * Key map for the row of wires. Left and Right are physical: Left is toward pin 1 in English and
 * in Arabic alike, because a connector's pin order is not mirrored. Returns null for keys the
 * exercise does not use (Tab leaves the row).
 */
export function keyToPlugEvent(key: KeyLike): PlugEvent | null {
  if (key.ctrlKey || key.metaKey || key.altKey) return null;
  switch (key.key) {
    case "ArrowLeft":
      return { type: "arrow", direction: "left" };
    case "ArrowRight":
      return { type: "arrow", direction: "right" };
    case "Home":
      return { type: "jump", to: "first" };
    case "End":
      return { type: "jump", to: "last" };
    case " ":
    case "Enter":
      return { type: "toggle-grab" };
    case "Escape":
      return { type: "cancel" };
    default:
      return null;
  }
}

// ---------- Reducer ----------

export function plugReducer(state: PlugState, event: PlugEvent): PlugStep {
  const seq = (state.announcement?.seq ?? 0) + 1;
  const say = (key: PlugAnnouncementKey, extra: Omit<PlugAnnouncement, "seq" | "key" | "politeness"> = {}, politeness: PlugAnnouncement["politeness"] = "polite"): PlugAnnouncement => ({
    seq,
    key,
    politeness,
    ...extra,
  });
  const stay: PlugStep = { state, effects: [] };
  const last = PLUG_POSITIONS - 1;

  if (event.type === "result") {
    if (state.phase !== "crimping") return stay;
    const { wiremap } = event;
    return {
      state: {
        ...state,
        phase: "crimped",
        result: wiremap,
        announcement: say(wiremap.passed ? "passed" : "failed", { detail: wiremap.summary }, wiremap.passed ? "polite" : "assertive"),
      },
      effects: [],
    };
  }
  if (event.type === "reset") {
    if (state.phase === "crimping") return stay;
    const fresh = createPlugState(event.order ?? state.order);
    return { state: { ...fresh, standard: state.standard, announcement: say("reset") }, effects: [{ type: "focus-position", index: 0 }] };
  }
  if (state.phase === "crimping") return stay;

  // Looking around stays possible on a crimped plug; changing it does not.
  const moveFocus = (index: number): PlugStep =>
    index === state.activeIndex ? stay : { state: { ...state, activeIndex: index }, effects: [{ type: "focus-position", index }] };
  if (event.type === "focus") {
    if (!Number.isInteger(event.index) || event.index < 0 || event.index > last || state.grabbedFrom) return stay;
    return event.index === state.activeIndex ? stay : { state: { ...state, activeIndex: event.index }, effects: [] };
  }
  if (state.phase === "crimped") {
    if (event.type === "arrow") return moveFocus(Math.min(last, Math.max(0, state.activeIndex + (event.direction === "left" ? -1 : 1))));
    if (event.type === "jump") return moveFocus(event.to === "first" ? 0 : last);
    if (event.type === "cancel") return stay;
    return { state: { ...state, announcement: say("locked", {}, "assertive") }, effects: [] };
  }

  /** Moves the wire at `from` to `to` (shifting the ones between) and keeps the focus on it. */
  const moveWire = (from: number, to: number, grabbedFrom: PlugState["grabbedFrom"]): PlugStep => {
    const wire = state.order[from];
    if (to < 0 || to > last) {
      return { state: { ...state, activeIndex: from, announcement: say("atEdge", { wire, values: { position: from + 1 } }) }, effects: [] };
    }
    const order = [...state.order];
    order.splice(from, 1);
    order.splice(to, 0, wire);
    return {
      state: { ...state, order, activeIndex: to, grabbedFrom, announcement: say("moved", { wire, values: { position: to + 1 } }) },
      effects: [{ type: "focus-position", index: to }],
    };
  };

  switch (event.type) {
    case "arrow": {
      const next = state.activeIndex + (event.direction === "left" ? -1 : 1);
      if (state.grabbedFrom) return moveWire(state.activeIndex, next, state.grabbedFrom);
      return moveFocus(Math.min(last, Math.max(0, next)));
    }
    case "jump": {
      const to = event.to === "first" ? 0 : last;
      if (state.grabbedFrom) return to === state.activeIndex ? stay : moveWire(state.activeIndex, to, state.grabbedFrom);
      return moveFocus(to);
    }
    case "toggle-grab": {
      const wire = state.order[state.activeIndex];
      const values = { position: state.activeIndex + 1 };
      if (state.grabbedFrom) return { state: { ...state, grabbedFrom: null, announcement: say("dropped", { wire, values }) }, effects: [] };
      return { state: { ...state, grabbedFrom: state.order, announcement: say("grabbed", { wire, values }) }, effects: [] };
    }
    case "cancel": {
      if (!state.grabbedFrom) return stay;
      const wire = state.order[state.activeIndex];
      const index = state.grabbedFrom.indexOf(wire);
      return {
        state: { ...state, order: state.grabbedFrom, grabbedFrom: null, activeIndex: index, announcement: say("grabCancelled", { wire, values: { position: index + 1 } }) },
        effects: [{ type: "focus-position", index }],
      };
    }
    case "shift": {
      if (!Number.isInteger(event.index) || event.index < 0 || event.index > last || state.grabbedFrom) return stay;
      return moveWire(event.index, event.index + (event.direction === "left" ? -1 : 1), null);
    }
    case "choose-standard":
      if (event.standard !== "T568A" && event.standard !== "T568B") return stay;
      return { state: { ...state, standard: event.standard, announcement: say("standardChosen", { values: { standard: event.standard } }) }, effects: [] };
    case "crimp": {
      // A wire still in the hand is put down where it is; then the attempt goes to the engine as made.
      if (!state.standard) return { state: { ...state, announcement: say("needStandard", {}, "assertive") }, effects: [] };
      return {
        state: { ...state, phase: "crimping", grabbedFrom: null, announcement: say("crimping") },
        effects: [{ type: "crimp", attempt: { standard: state.standard, order: [...state.order] } }],
      };
    }
  }
}

/**
 * Renders a plug announcement with next-intl's `t` scoped to `tutor.cabling.plug`.
 * The wire's name comes from `wire.<colour>`, the sentence from `announce.<key>`.
 */
export function renderPlugAnnouncement(
  announcement: PlugAnnouncement,
  locale: "en" | "ar",
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const values: Record<string, string | number> = { ...announcement.values };
  if (announcement.wire) values.wire = t(`wire.${announcement.wire}`);
  const sentence = t(`announce.${announcement.key}`, values);
  return announcement.detail ? `${sentence} ${announcement.detail[locale]}` : sentence;
}
