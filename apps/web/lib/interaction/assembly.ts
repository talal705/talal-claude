// Non-drag assembly for the PC lab: "select a part, then its destination" and "select a cable
// end, then the other end". A pure state machine with no UI and no engine import. It never
// decides compatibility: destinations and the reasons for rejected ones come from the engine's
// queries (PCMountOption / PCCableEndOption), and placing is a PCAction the lab dispatches.
// The same machine serves keyboard, click-then-click and switch input.
import {
  pcTarget,
  type CableId,
  type InstanceId,
  type Localized,
  type PCAction,
  type PCCableEndOption,
  type PCDiagnostic,
  type PCMountOption,
  type TutorTargetRef,
} from "@ytl/contracts";
import {
  selectionReducer,
  type SelectionCandidate,
  type SelectionEffect,
  type SelectionEvent,
  type SelectionOptions,
  type SelectionState,
  type SelectionStep,
} from "./selection";

export {
  keyToSelectionEvent as keyToAssemblyEvent,
  moveIndex,
  renderAnnouncement,
  rovingTabIndex,
  type Announcement,
  type AnnouncementKey,
  type KeyLike,
  type SelectionMove as AssemblyMove,
} from "./selection";

// ---------- Subjects and candidates ----------

/** What the learner picked up. `label` is the name read out, e.g. the part's catalog name. */
export type AssemblySubject =
  | { kind: "part"; instanceId: InstanceId; label: Localized }
  | { kind: "cable-end"; cableId: CableId; endId: string; label: Localized };

/** A destination for a part or cable end. `rejection` is the engine's full diagnostic behind `reason`. */
export interface AssemblyCandidate extends SelectionCandidate<PCAction> {
  rejection?: PCDiagnostic;
}

export function mountCandidates(instanceId: InstanceId, options: readonly PCMountOption[]): AssemblyCandidate[] {
  return options.map((option) => {
    const target = pcTarget.mount(option.target);
    return {
      id: `${target.id}@${option.role}`,
      label: option.label,
      ok: option.ok,
      reason: option.ok ? undefined : option.rejection?.message,
      rejection: option.ok ? undefined : option.rejection,
      action: { type: "mount_part", instanceId, role: option.role, target: option.target },
      target,
    };
  });
}

export function cableEndCandidates(cableId: CableId, endId: string, options: readonly PCCableEndOption[]): AssemblyCandidate[] {
  return options.map((option) => {
    const target = pcTarget.port(option.to);
    return {
      id: target.id,
      label: option.label,
      ok: option.ok,
      reason: option.ok ? undefined : option.rejection?.message,
      rejection: option.ok ? undefined : option.rejection,
      action: { type: "connect_cable_end", cableId, endId, to: option.to },
      target,
    };
  });
}

// ---------- The machine, specialised for PC actions ----------

export type AssemblyState = SelectionState<AssemblySubject, PCAction>;
export type AssemblyEffect = SelectionEffect<AssemblySubject, PCAction>;
export type AssemblyOptions = SelectionOptions;
export type AssemblyStep = SelectionStep<AssemblySubject, PCAction>;
/** As the shared events, except that a refusal carries the engine's `PCActionResult.rejection`. */
export type AssemblyEvent =
  | Exclude<SelectionEvent<AssemblySubject, PCAction>, { type: "result"; ok: false }>
  | { type: "result"; ok: false; rejection: PCDiagnostic };

export const initialAssemblyState: AssemblyState = { phase: "idle", announcement: null };

export function assemblyReducer(state: AssemblyState, event: AssemblyEvent, options: AssemblyOptions = {}): AssemblyStep {
  if (event.type === "result" && !event.ok) {
    return selectionReducer(state, { type: "result", ok: false, reason: event.rejection.message }, options);
  }
  return selectionReducer(state, event, options);
}

// ---------- Structured list view (for the page that renders it) ----------

/**
 * The structured view is the equivalent of the 3D scene for people who do not use it: a list of
 * parts, each with its mounts and ports. Every row below must be reachable by keyboard and carry
 * these facts as text; the engine supplies the values, the page renders them.
 */
export interface AssemblyPartRow {
  instanceId: InstanceId;
  /** Catalog name, both languages. */
  name: Localized;
  /** Part category label ("Memory", "Power supply"). */
  category: Localized;
  /** Where it is: on the bench, or the label of the mount it sits on. */
  location: { kind: "bench" } | { kind: "mounted"; on: Localized; seating: "placed" | "partial" | "seated"; fastenersSecured: number; fastenersTotal: number };
  /** Open diagnostics about this part, most severe first, as the engine worded them. */
  problems: readonly PCDiagnostic[];
  /** Same target the 3D part registers, so "Show me where" works from either view. */
  target: TutorTargetRef;
  /** Row actions offered as buttons: pick up to place, remove, seat, secure. */
  actions: readonly ("select" | "unmount" | "remove" | "seat" | "fasten")[];
  ports: readonly AssemblyPortRow[];
}

export interface AssemblyPortRow {
  /** Port label as printed on the part ("ATX 24-pin", "CPU_FAN"). Shown left to right. */
  label: Localized;
  /** Connector family in words, for people who cannot see the shape. */
  connector: Localized;
  /** Empty, or the cable end plugged into it. */
  connection: { kind: "empty" } | { kind: "connected"; cable: Localized; cableId: CableId; endId: string };
  target: TutorTargetRef;
}

export interface AssemblyCableRow {
  cableId: CableId;
  name: Localized;
  /** One entry per end: its label and what it is plugged into, or loose. */
  ends: readonly { endId: string; label: Localized; pluggedInto: Localized | null; target: TutorTargetRef }[];
  /** Row actions: pick up a loose end to connect, disconnect a plugged end, remove the cable. */
  actions: readonly ("select-end" | "disconnect-end" | "remove")[];
}
