// "Select a thing, then its destination": the non-drag pattern shared by the PC lab (parts and
// cable ends) and the network lab (cable ends and ports). A pure state machine with no UI and no
// engine. It never decides whether a destination is allowed: candidates arrive with `ok` and, when
// not, the engine's reason; placing is an action handed back to the lab to dispatch.
import type { Localized, TutorTargetRef } from "@ytl/contracts";

/** What the learner picked up. `label` is the name read out. */
export interface SelectionSubject {
  label: Localized;
}

/** One destination offered for the subject, in the engine's order. Rejected ones stay in the list with their reason. */
export interface SelectionCandidate<A> {
  /** Unique within the list; also usable as a DOM id suffix. */
  id: string;
  label: Localized;
  ok: boolean;
  /** Present when `ok` is false: the engine's reason, shown and read out as-is. */
  reason?: Localized;
  /** The action that places the subject here. Dispatched only for an `ok` candidate. */
  action: A;
  /** The destination's tutor target, so a list row and a drawing can highlight the same thing. */
  target: TutorTargetRef;
}

// ---------- Announcements ----------

/**
 * Text for the live region. `key` is inside the caller's `announce` messages (`tutor.assembly.announce`, `tutor.cabling.announce`); `labels` are names in
 * both languages for its placeholders, `values` are numbers. `detail` is an engine sentence
 * (a rejection reason) appended as-is. `seq` changes on every announcement so that the same
 * sentence twice in a row is still read twice.
 */
export interface Announcement {
  seq: number;
  key: AnnouncementKey;
  labels?: Record<string, Localized>;
  values?: Record<string, number>;
  detail?: Localized;
  /** `assertive` only for a refusal the learner must hear before continuing. */
  politeness: "polite" | "assertive";
}

export type AnnouncementKey =
  | "selected"
  | "selectedNone"
  | "selectedNowhere"
  | "notAvailable"
  | "confirm"
  | "placing"
  | "placed"
  | "refused"
  | "cancelled"
  | "backToList"
  | "undone"
  | "redone"
  | "nothingToUndo"
  | "nothingToRedo";

/** Renders an announcement with next-intl's `t` scoped to the flow's `announce` messages. */
export function renderAnnouncement(
  announcement: Announcement,
  locale: "en" | "ar",
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const values: Record<string, string | number> = { ...announcement.values };
  for (const [name, label] of Object.entries(announcement.labels ?? {})) values[name] = label[locale];
  const sentence = t(announcement.key, values);
  return announcement.detail ? `${sentence} ${announcement.detail[locale]}` : sentence;
}

// ---------- State ----------

interface Shared {
  /** The latest thing to read out; null before anything happened. */
  announcement: Announcement | null;
}

export type SelectionState<S extends SelectionSubject, A> =
  /** Nothing picked up. */
  | (Shared & { phase: "idle" })
  /** A subject is picked up and its destinations are listed; `activeIndex` has the roving focus. */
  | (Shared & { phase: "choosing"; subject: S; candidates: readonly SelectionCandidate<A>[]; activeIndex: number })
  /** An available destination was chosen; waiting for the learner to confirm. Only with `confirm: true`. */
  | (Shared & { phase: "confirming"; subject: S; candidates: readonly SelectionCandidate<A>[]; activeIndex: number })
  /** The action was handed to the lab; waiting for the engine's result. Input other than the result is ignored. */
  | (Shared & { phase: "placing"; subject: S; candidates: readonly SelectionCandidate<A>[]; activeIndex: number });

export type SelectionMove = "next" | "previous" | "first" | "last";

export type SelectionEvent<S extends SelectionSubject, A> =
  /** The learner picked a part or a cable end. `candidates` come from the engine query for it. */
  | { type: "select"; subject: S; candidates: readonly SelectionCandidate<A>[] }
  | { type: "move"; to: SelectionMove }
  /** Roving focus moved by pointer or by focus itself. */
  | { type: "focus"; index: number }
  /** Enter or Space on the active candidate; also confirms in the confirm step. */
  | { type: "choose" }
  /** A click or tap on a specific candidate: focus it and choose it. */
  | { type: "pick"; candidateId: string }
  | { type: "cancel" }
  /** The engine's answer to the dispatched action. */
  | { type: "result"; ok: true }
  | { type: "result"; ok: false; reason?: Localized }
  | { type: "undo" }
  | { type: "redo" }
  /** The lab's answer to an undo or redo request: whether there was anything to undo or redo. */
  | { type: "history"; did: "undo" | "redo"; changed: boolean };

/** What the lab must do after an event. The machine itself touches nothing. */
export type SelectionEffect<S extends SelectionSubject, A> =
  /** Run this action through the engine, then send `result`. */
  | { type: "dispatch"; action: A }
  /** Run undo or redo on the project history, then send `history`. */
  | { type: "undo" }
  | { type: "redo" }
  /** Move DOM focus to this candidate's row. */
  | { type: "focus-candidate"; candidateId: string }
  /** Move DOM focus back to the control the subject was picked from. */
  | { type: "focus-subject"; subject: S };

export interface SelectionOptions {
  /** Ask for a second Enter before placing. Off by default: every placement can be undone. */
  confirm?: boolean;
  /** Arrow keys wrap from the last candidate to the first. On by default. */
  wrap?: boolean;
}

export interface SelectionStep<S extends SelectionSubject, A> {
  state: SelectionState<S, A>;
  effects: SelectionEffect<S, A>[];
}

export const initialSelectionState = { phase: "idle", announcement: null } as const;

// ---------- Roving focus ----------

/** The index the roving focus lands on. Works for any list; `count` 0 gives -1. */
export function moveIndex(current: number, count: number, to: SelectionMove, wrap = true): number {
  if (count <= 0) return -1;
  if (to === "first") return 0;
  if (to === "last") return count - 1;
  const next = current + (to === "next" ? 1 : -1);
  if (next < 0) return wrap ? count - 1 : 0;
  if (next >= count) return wrap ? 0 : count - 1;
  return next;
}

/** `tabIndex` for item `index` of a roving-focus group: exactly one item is in the tab order. */
export function rovingTabIndex(index: number, activeIndex: number): 0 | -1 {
  return index === Math.max(0, activeIndex) ? 0 : -1;
}

// ---------- Keyboard ----------

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * The key map for the destination list. Returns null for a key the machine does not use, so
 * the caller leaves it to the browser (Tab always leaves the list).
 * Up/Down move, Home/End jump, Enter or Space place, Escape cancels,
 * Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes.
 */
export function keyToSelectionEvent(key: KeyLike): SelectionEvent<never, never> | null {
  const command = Boolean(key.ctrlKey || key.metaKey);
  if (command && !key.altKey) {
    const letter = key.key.toLowerCase();
    if (letter === "z") return key.shiftKey ? { type: "redo" } : { type: "undo" };
    if (letter === "y" && !key.shiftKey) return { type: "redo" };
    return null;
  }
  if (key.altKey) return null;
  switch (key.key) {
    case "ArrowDown":
      return { type: "move", to: "next" };
    case "ArrowUp":
      return { type: "move", to: "previous" };
    case "Home":
      return { type: "move", to: "first" };
    case "End":
      return { type: "move", to: "last" };
    case "Enter":
    case " ":
      return { type: "choose" };
    case "Escape":
      return { type: "cancel" };
    default:
      return null;
  }
}

// ---------- Reducer ----------

export function selectionReducer<S extends SelectionSubject, A>(
  state: SelectionState<S, A>,
  event: SelectionEvent<S, A>,
  options: SelectionOptions = {},
): SelectionStep<S, A> {
  const seq = (state.announcement?.seq ?? 0) + 1;
  const say = (key: AnnouncementKey, extra: Omit<Announcement, "seq" | "key" | "politeness"> = {}, politeness: Announcement["politeness"] = "polite"): Announcement => ({
    seq,
    key,
    politeness,
    ...extra,
  });
  const stay: SelectionStep<S, A> = { state, effects: [] };

  // Undo and redo are available whenever nothing is in flight.
  if (event.type === "undo" || event.type === "redo") {
    if (state.phase === "placing") return stay;
    return { state, effects: [{ type: event.type }] };
  }
  if (event.type === "history") {
    const key: AnnouncementKey = event.changed ? (event.did === "undo" ? "undone" : "redone") : event.did === "undo" ? "nothingToUndo" : "nothingToRedo";
    // The build changed under any open list, so the list is closed rather than left out of date.
    if (event.changed && state.phase !== "idle") {
      return { state: { phase: "idle", announcement: say(key) }, effects: [{ type: "focus-subject", subject: state.subject }] };
    }
    return { state: { ...state, announcement: say(key) }, effects: [] };
  }

  if (event.type === "select") {
    if (state.phase === "placing") return stay;
    const { subject, candidates } = event;
    const labels = { subject: subject.label };
    if (candidates.length === 0) {
      return { state: { phase: "idle", announcement: say("selectedNowhere", { labels }) }, effects: [] };
    }
    const available = candidates.filter((candidate) => candidate.ok).length;
    const firstOk = candidates.findIndex((candidate) => candidate.ok);
    const activeIndex = Math.max(0, firstOk);
    return {
      state: {
        phase: "choosing",
        subject,
        candidates,
        activeIndex,
        announcement: say(available === 0 ? "selectedNone" : "selected", { labels, values: { available, total: candidates.length } }),
      },
      effects: [{ type: "focus-candidate", candidateId: candidates[activeIndex].id }],
    };
  }

  if (state.phase === "idle") return stay;

  if (state.phase === "placing") {
    if (event.type !== "result") return stay;
    const candidate = state.candidates[state.activeIndex];
    const labels = { subject: state.subject.label, destination: candidate.label };
    if (event.ok) {
      return { state: { phase: "idle", announcement: say("placed", { labels }) }, effects: [{ type: "focus-subject", subject: state.subject }] };
    }
    // The engine refused at the last moment (the build changed): back to the list, reason read out.
    return {
      state: { ...state, phase: "choosing", announcement: say("refused", { labels, detail: event.reason }, "assertive") },
      effects: [{ type: "focus-candidate", candidateId: candidate.id }],
    };
  }

  const place = (index: number): SelectionStep<S, A> => {
    const candidate = state.candidates[index];
    const labels = { subject: state.subject.label, destination: candidate.label };
    if (!candidate.ok) {
      return {
        state: { ...state, phase: "choosing", activeIndex: index, announcement: say("notAvailable", { labels, detail: candidate.reason }, "assertive") },
        effects: [],
      };
    }
    if (options.confirm && state.phase === "choosing") {
      return { state: { ...state, phase: "confirming", activeIndex: index, announcement: say("confirm", { labels }) }, effects: [] };
    }
    return {
      state: { ...state, phase: "placing", activeIndex: index, announcement: say("placing", { labels }) },
      effects: [{ type: "dispatch", action: candidate.action }],
    };
  };

  switch (event.type) {
    case "move":
    case "focus": {
      const index =
        event.type === "move"
          ? moveIndex(state.activeIndex, state.candidates.length, event.to, options.wrap ?? true)
          : event.index;
      if (!Number.isInteger(index) || index < 0 || index >= state.candidates.length) return stay;
      if (index === state.activeIndex) return stay;
      // Moving away from a pending confirmation withdraws it. Focus itself reads the row out;
      // nothing is added to the live region.
      return {
        state: { ...state, phase: "choosing", activeIndex: index },
        effects: event.type === "move" ? [{ type: "focus-candidate", candidateId: state.candidates[index].id }] : [],
      };
    }
    case "choose":
      return place(state.activeIndex);
    case "pick": {
      const index = state.candidates.findIndex((candidate) => candidate.id === event.candidateId);
      if (index < 0) return stay;
      // A click on another row during confirmation starts over on that row.
      if (state.phase === "confirming" && index !== state.activeIndex) {
        return selectionReducer<S, A>({ ...state, phase: "choosing", activeIndex: index }, { type: "choose" }, options);
      }
      return place(index);
    }
    case "cancel": {
      const labels = { subject: state.subject.label };
      if (state.phase === "confirming") {
        return {
          state: { ...state, phase: "choosing", announcement: say("backToList", { labels }) },
          effects: [{ type: "focus-candidate", candidateId: state.candidates[state.activeIndex].id }],
        };
      }
      return { state: { phase: "idle", announcement: say("cancelled", { labels }) }, effects: [{ type: "focus-subject", subject: state.subject }] };
    }
    case "result":
      return stay;
  }
}
