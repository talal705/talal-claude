// Playback of a packet journey in the network lab: play, pause, step, step back, restart, speed.
// Pure and UI-free. It shows exactly the events the engine reported, in the engine's order, and
// ends where the engine's list ends; it never adds, skips or reorders an event, and it takes the
// outcome and its wording from the engine. Time enters only through `tick`.
import type { Journey, JourneyEvent, Localized, TutorTargetRef } from "@ytl/contracts";

// ---------- State ----------

export const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Time one event stays on screen at speed 1. Long enough for its sentence to be read out. */
export const STEP_MS = 1600;
/** The part of a step during which the packet travels; the rest it rests on the place. */
export const TRAVEL_SHARE = 0.6;

export type PlaybackStatus =
  /** Nothing shown yet. */
  | "ready"
  | "playing"
  | "paused"
  /** The learner is moving one event at a time. */
  | "stepping"
  /** The last reported event is shown, with the engine's outcome. */
  | "finished";

export interface PlaybackAnnouncement {
  seq: number;
  /** A key in `tutor.playback.announce`, or `event` for an engine sentence with its position. */
  kind: "event" | "finished" | "paused" | "restarted" | "speed" | "empty";
  /** Engine text read after the localized lead-in: the event's message and reason, or the summary. */
  text?: Localized;
  values?: Record<string, number>;
  /** `assertive` for a failure. */
  politeness: "polite" | "assertive";
}

export interface PlaybackState {
  journey: Journey;
  status: PlaybackStatus;
  /** Index of the event on screen; -1 before the first. */
  index: number;
  /** Milliseconds of journey time spent in the current event (already scaled by speed). */
  inStepMs: number;
  speed: PlaybackSpeed;
  /** No tween: the packet is drawn at the place of the current event and jumps to the next. */
  reducedMotion: boolean;
  announcement: PlaybackAnnouncement | null;
}

export type PlaybackEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "step-forward" }
  | { type: "step-back" }
  | { type: "restart" }
  | { type: "set-speed"; speed: PlaybackSpeed }
  | { type: "set-reduced-motion"; reduced: boolean }
  /** Real time that passed since the last tick, from an animation frame or a timer. */
  | { type: "tick"; elapsedMs: number }
  /** The engine produced a new journey (the network changed or the learner sent again). */
  | { type: "load"; journey: Journey };

export function createPlaybackState(journey: Journey, options: { reducedMotion?: boolean; speed?: PlaybackSpeed } = {}): PlaybackState {
  return {
    journey,
    status: "ready",
    index: -1,
    inStepMs: 0,
    speed: options.speed ?? 1,
    reducedMotion: options.reducedMotion ?? false,
    announcement: null,
  };
}

// ---------- Reducer ----------

export function playbackReducer(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  const { events } = state.journey;
  const last = events.length - 1;
  let seq = state.announcement?.seq ?? 0;
  const say = (announcement: Omit<PlaybackAnnouncement, "seq">): PlaybackAnnouncement => ({ seq: (seq += 1), ...announcement });
  const sayEvent = (index: number): PlaybackAnnouncement => {
    const shown = events[index];
    const text = shown.reason ? joinLocalized(shown.message, shown.reason) : shown.message;
    return say({ kind: "event", text, values: { current: index + 1, total: events.length }, politeness: shown.result === "failed" ? "assertive" : "polite" });
  };
  const sayFinished = (): PlaybackAnnouncement =>
    say({ kind: events.length === 0 ? "empty" : "finished", text: state.journey.summary, politeness: state.journey.outcome === "delivered" ? "polite" : "assertive" });
  /** Shows event `index` from its start (playing) or complete (stepping). */
  const show = (index: number, status: PlaybackStatus, inStepMs: number): PlaybackState => ({
    ...state,
    status,
    index,
    inStepMs,
    announcement: sayEvent(index),
  });
  const finish = (): PlaybackState => ({ ...state, status: "finished", index: last, inStepMs: STEP_MS, announcement: sayFinished() });

  switch (event.type) {
    case "load":
      return { ...createPlaybackState(event.journey, { reducedMotion: state.reducedMotion, speed: state.speed }), announcement: state.announcement };

    case "play": {
      if (state.status === "playing") return state;
      if (events.length === 0) return finish();
      // From the end, play starts over. From a step, it continues with the next event.
      if (state.status === "finished" || state.index < 0) return show(0, "playing", 0);
      if (state.status === "stepping") return state.index >= last ? finish() : show(state.index + 1, "playing", 0);
      return { ...state, status: "playing" };
    }

    case "pause":
      if (state.status !== "playing") return state;
      return { ...state, status: "paused", announcement: say({ kind: "paused", values: { current: state.index + 1, total: events.length }, politeness: "polite" }) };

    case "step-forward": {
      if (events.length === 0) return state.status === "finished" ? state : finish();
      if (state.status === "finished") return state;
      // A step taken while an event is still arriving completes that event first.
      if ((state.status === "playing" || state.status === "paused") && state.index >= 0 && state.inStepMs < STEP_MS * TRAVEL_SHARE) {
        return { ...state, status: "stepping", inStepMs: STEP_MS };
      }
      if (state.index >= last) return finish();
      return show(state.index + 1, "stepping", STEP_MS);
    }

    case "step-back":
      // There is nothing before the first event; use restart to clear the view.
      if (state.index <= 0) return state;
      return show(state.index - 1, "stepping", STEP_MS);

    case "restart":
      return { ...state, status: "ready", index: -1, inStepMs: 0, announcement: say({ kind: "restarted", politeness: "polite" }) };

    case "set-speed":
      if (!PLAYBACK_SPEEDS.includes(event.speed) || event.speed === state.speed) return state;
      return { ...state, speed: event.speed, announcement: say({ kind: "speed", values: { speed: event.speed }, politeness: "polite" }) };

    case "set-reduced-motion":
      return event.reduced === state.reducedMotion ? state : { ...state, reducedMotion: event.reduced };

    case "tick": {
      if (state.status !== "playing" || !(event.elapsedMs > 0)) return state;
      const inStepMs = state.inStepMs + event.elapsedMs * state.speed;
      if (inStepMs < STEP_MS) return { ...state, inStepMs };
      if (state.index >= last) return finish();
      // At most one event per tick: after a long gap (a hidden tab, a slow frame) no event is
      // skipped and each one is still announced. The time left over carries into the next event.
      return show(state.index + 1, "playing", Math.min(inStepMs - STEP_MS, STEP_MS - 1));
    }
  }
}

function joinLocalized(a: Localized, b: Localized): Localized {
  return { en: `${a.en} ${b.en}`, ar: `${a.ar} ${b.ar}` };
}

// ---------- What to draw ----------

export interface PlaybackView {
  status: PlaybackStatus;
  /** The event on screen, or null before the first. */
  current: JourneyEvent | null;
  /** What to highlight (and what the tutor can point at): the current event's target. */
  target: TutorTargetRef | null;
  /**
   * How far the packet is along the current event's place: 0 at its start, 1 arrived. On a link,
   * draw it at this fraction from `fromNodeId` to `toNodeId`. Always 1 with reduced motion.
   */
  progress: number;
  /** 1-based position and total, for "Step 3 of 7". */
  position: number;
  total: number;
  /** The engine's verdict, only once every reported event has been shown. */
  outcome: Journey["outcome"] | null;
  summary: Localized | null;
  canPlay: boolean;
  canPause: boolean;
  canStepForward: boolean;
  canStepBack: boolean;
  canRestart: boolean;
  /** True while a timer or animation frame should keep sending `tick`. */
  needsTicks: boolean;
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

export function viewOf(state: PlaybackState): PlaybackView {
  const { events } = state.journey;
  const current = state.index >= 0 ? (events[state.index] ?? null) : null;
  const finished = state.status === "finished";
  const travel = Math.min(1, state.inStepMs / (STEP_MS * TRAVEL_SHARE));
  return {
    status: state.status,
    current,
    target: current?.target ?? null,
    progress: !current ? 0 : state.reducedMotion ? 1 : easeInOut(travel),
    position: state.index + 1,
    total: events.length,
    outcome: finished ? state.journey.outcome : null,
    summary: finished ? state.journey.summary : null,
    canPlay: state.status !== "playing",
    canPause: state.status === "playing",
    canStepForward: !finished,
    canStepBack: state.index > 0,
    canRestart: state.index >= 0 || finished,
    needsTicks: state.status === "playing",
  };
}

/** Renders an announcement with next-intl's `t` scoped to `tutor.playback.announce`. */
export function renderPlaybackAnnouncement(
  announcement: PlaybackAnnouncement,
  locale: "en" | "ar",
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const lead = t(announcement.kind, announcement.values);
  return announcement.text ? `${lead} ${announcement.text[locale]}` : lead;
}
