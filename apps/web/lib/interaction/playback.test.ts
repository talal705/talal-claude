import { describe, expect, it } from "vitest";
import type { Journey, JourneyEvent } from "@ytl/contracts";
import {
  STEP_MS,
  TRAVEL_SHARE,
  createPlaybackState,
  playbackReducer,
  renderPlaybackAnnouncement,
  viewOf,
  type PlaybackEvent,
  type PlaybackState,
} from "./playback";

const node = (id: string, nodeId: string, en: string, over: Partial<JourneyEvent> = {}): JourneyEvent => ({
  id,
  at: { kind: "node", nodeId },
  result: "ok",
  message: { en, ar: `${en} (ar)` },
  target: { id: `network:component:${nodeId}`, kind: "component", projectRevision: 3, executionId: "ping-1" },
  ...over,
});
const link = (id: string, linkId: string, from: string, to: string, en: string): JourneyEvent => ({
  id,
  at: { kind: "link", linkId, fromNodeId: from, toNodeId: to },
  result: "ok",
  message: { en, ar: `${en} (ar)` },
  target: { id: `network:connector:${linkId}`, kind: "connector", projectRevision: 3, executionId: "ping-1" },
});

const delivered: Journey = {
  id: "ping-1",
  outcome: "delivered",
  summary: { en: "PC-A reached PC-B.", ar: "PC-A وصل لـ PC-B." },
  events: [
    node("e1", "pc-a", "PC-A builds the packet."),
    link("e2", "l1", "pc-a", "sw-1", "The frame travels to the switch."),
    node("e3", "sw-1", "The switch forwards it out of port 2."),
    link("e4", "l2", "sw-1", "pc-b", "The frame travels to PC-B."),
    node("e5", "pc-b", "PC-B accepts the packet."),
  ],
};
// The engine stopped at the router: its list ends there, and so must the playback.
const failed: Journey = {
  id: "ping-2",
  outcome: "failed",
  summary: { en: "The packet did not reach 10.0.2.5.", ar: "الباكت ما وصل لـ 10.0.2.5." },
  events: [
    node("f1", "pc-a", "PC-A builds the packet."),
    link("f2", "l1", "pc-a", "r-1", "The frame travels to the router."),
    node("f3", "r-1", "The router drops the packet.", { result: "failed", reason: { en: "It has no route to 10.0.2.0/24.", ar: "ما عنده مسار لـ 10.0.2.0/24." } }),
  ],
};

function run(journey: Journey, events: PlaybackEvent[], options?: { reducedMotion?: boolean }) {
  let state = createPlaybackState(journey, options);
  const shown: string[] = [];
  for (const event of events) {
    const before = state.announcement?.seq;
    state = playbackReducer(state, event);
    if (state.announcement && state.announcement.seq !== before && state.announcement.kind === "event") {
      shown.push(state.journey.events[state.index].id);
    }
  }
  return { state, shown };
}
const tick = (elapsedMs: number): PlaybackEvent => ({ type: "tick", elapsedMs });
const ticks = (totalMs: number, frameMs = 1000 / 60): PlaybackEvent[] => Array.from({ length: Math.ceil(totalMs / frameMs) }, () => tick(frameMs));

describe("success path", () => {
  it("starts with nothing shown and no outcome", () => {
    const view = viewOf(createPlaybackState(delivered));
    expect(view).toMatchObject({ status: "ready", current: null, target: null, position: 0, total: 5, outcome: null, canPlay: true, canStepBack: false, needsTicks: false });
  });

  it("plays every reported event once, in order, then shows the engine's outcome", () => {
    const { state, shown } = run(delivered, [{ type: "play" }, ...ticks(STEP_MS * 5 + 50)]);
    expect(shown).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    const view = viewOf(state);
    expect(view).toMatchObject({ status: "finished", outcome: "delivered", summary: delivered.summary, position: 5, needsTicks: false });
    expect(state.announcement).toMatchObject({ kind: "finished", text: delivered.summary, politeness: "polite" });
  });

  it("takes the same time whatever the tick rate: driven by elapsed time, not by tick count", () => {
    const elapsedUntilFinished = (frameMs: number) => {
      let state = playbackReducer(createPlaybackState(delivered), { type: "play" });
      let elapsed = 0;
      while (state.status !== "finished") {
        state = playbackReducer(state, tick(frameMs));
        elapsed += frameMs;
      }
      return elapsed;
    };
    const total = STEP_MS * 5;
    for (const frameMs of [1000 / 60, 1000 / 30, 250]) {
      expect(elapsedUntilFinished(frameMs)).toBeGreaterThanOrEqual(total - 0.001);
      expect(elapsedUntilFinished(frameMs)).toBeLessThan(total + frameMs + 0.001);
    }
  });

  it("a very long tick (a hidden tab) advances one event at a time, so none is skipped or left unannounced", () => {
    const { shown, state } = run(delivered, [{ type: "play" }, tick(STEP_MS * 30), tick(1), tick(1)]);
    // The long tick shows e2; the excess is capped just under one step, so the next tick shows e3 and no more.
    expect(shown).toEqual(["e1", "e2", "e3"]);
    expect(state.status).toBe("playing");
  });

  it("the packet travels along the event's place and then rests there; the highlight is the event's target", () => {
    let state = playbackReducer(createPlaybackState(delivered), { type: "play" });
    state = playbackReducer(state, tick(STEP_MS));
    expect(viewOf(state).current?.id).toBe("e2");
    expect(viewOf(state).progress).toBe(0);
    state = playbackReducer(state, tick((STEP_MS * TRAVEL_SHARE) / 2));
    expect(viewOf(state).progress).toBeCloseTo(0.5);
    state = playbackReducer(state, tick(STEP_MS * TRAVEL_SHARE));
    expect(viewOf(state).progress).toBe(1);
    expect(viewOf(state).target).toEqual(delivered.events[1].target);
    expect(viewOf(state).current?.at).toEqual({ kind: "link", linkId: "l1", fromNodeId: "pc-a", toNodeId: "sw-1" });
  });

  it("speed changes how fast journey time passes, not what is shown", () => {
    const fast = run(delivered, [{ type: "set-speed", speed: 2 }, { type: "play" }, ...ticks((STEP_MS * 5) / 2 + 50)]);
    expect(fast.shown).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(fast.state.status).toBe("finished");
    const slow = run(delivered, [{ type: "set-speed", speed: 0.5 }, { type: "play" }, ...ticks(STEP_MS * 5)]);
    expect(slow.state.status).toBe("playing");
    expect(slow.state.index).toBe(2);
    const bad = playbackReducer(createPlaybackState(delivered), { type: "set-speed", speed: 7 as never });
    expect(bad.speed).toBe(1);
  });
});

describe("failure mid-path", () => {
  it("stops where the engine's list stops and reports the engine's failure, never a delivery", () => {
    const { state, shown } = run(failed, [{ type: "play" }, ...ticks(STEP_MS * 10)]);
    expect(shown).toEqual(["f1", "f2", "f3"]);
    const view = viewOf(state);
    expect(view).toMatchObject({ status: "finished", outcome: "failed", summary: failed.summary, position: 3, total: 3 });
    expect(view.current?.id).toBe("f3");
    expect(view.canStepForward).toBe(false);
    expect(state.announcement).toMatchObject({ kind: "finished", politeness: "assertive", text: failed.summary });
  });

  it("the failing event is announced assertively with the engine's reason", () => {
    const { state } = run(failed, [{ type: "step-forward" }, { type: "step-forward" }, { type: "step-forward" }]);
    expect(state.announcement).toMatchObject({ kind: "event", politeness: "assertive", values: { current: 3, total: 3 } });
    expect(state.announcement?.text?.en).toBe("The router drops the packet. It has no route to 10.0.2.0/24.");
    expect(viewOf(state).outcome).toBeNull();
  });

  it("does not show an outcome before every reported event has been shown", () => {
    const { state } = run(failed, [{ type: "play" }, ...ticks(STEP_MS * 2.5)]);
    expect(viewOf(state)).toMatchObject({ status: "playing", outcome: null, summary: null });
  });

  it("an incomplete journey ends as incomplete", () => {
    const incomplete: Journey = { ...failed, outcome: "incomplete", summary: { en: "The simulation stopped after 64 hops.", ar: "المحاكاة وقفت بعد 64 قفزة." } };
    const { state } = run(incomplete, [{ type: "play" }, ...ticks(STEP_MS * 4)]);
    expect(viewOf(state).outcome).toBe("incomplete");
  });

  it("a journey with no events finishes at once with the engine's summary", () => {
    const empty: Journey = { id: "ping-3", outcome: "failed", events: [], summary: { en: "PC-A has no IP address, so nothing was sent.", ar: "PC-A ما عنده عنوان IP، فما انرسل شي." } };
    const { state } = run(empty, [{ type: "play" }]);
    expect(viewOf(state)).toMatchObject({ status: "finished", outcome: "failed", current: null, total: 0 });
    expect(state.announcement).toMatchObject({ kind: "empty", text: empty.summary });
  });
});

describe("pause, step, resume, replay", () => {
  it("pause freezes journey time and play resumes from the same place", () => {
    const paused = run(delivered, [{ type: "play" }, ...ticks(STEP_MS * 1.5), { type: "pause" }, ...ticks(5000)]).state;
    expect(paused.status).toBe("paused");
    expect(paused.index).toBe(1);
    expect(paused.announcement).toMatchObject({ kind: "paused", values: { current: 2, total: 5 } });
    const before = paused.inStepMs;
    const resumed = playbackReducer(paused, { type: "play" });
    expect(resumed).toMatchObject({ status: "playing", index: 1, inStepMs: before });
    expect(viewOf(paused).needsTicks).toBe(false);
  });

  it("step forward shows one more event, complete, and waits", () => {
    const { state, shown } = run(delivered, [{ type: "step-forward" }, { type: "step-forward" }, ...ticks(5000)]);
    expect(shown).toEqual(["e1", "e2"]);
    expect(viewOf(state)).toMatchObject({ status: "stepping", position: 2, progress: 1, needsTicks: false });
  });

  it("a step while an event is still arriving completes that event before moving on", () => {
    let state = run(delivered, [{ type: "play" }, tick(100)]).state;
    state = playbackReducer(state, { type: "step-forward" });
    expect(state).toMatchObject({ status: "stepping", index: 0 });
    expect(viewOf(state).progress).toBe(1);
    state = playbackReducer(state, { type: "step-forward" });
    expect(state.index).toBe(1);
  });

  it("step back shows the previous event again and stops at the first", () => {
    const { state, shown } = run(delivered, [
      { type: "step-forward" }, { type: "step-forward" }, { type: "step-forward" },
      { type: "step-back" }, { type: "step-back" }, { type: "step-back" }, { type: "step-back" },
    ]);
    expect(shown).toEqual(["e1", "e2", "e3", "e2", "e1"]);
    expect(viewOf(state)).toMatchObject({ position: 1, canStepBack: false, status: "stepping" });
  });

  it("stepping past the last event finishes; stepping back from the end leaves the outcome", () => {
    const end = run(failed, Array.from({ length: 4 }, () => ({ type: "step-forward" }) as PlaybackEvent)).state;
    expect(viewOf(end)).toMatchObject({ status: "finished", outcome: "failed" });
    const back = playbackReducer(end, { type: "step-back" });
    expect(viewOf(back)).toMatchObject({ status: "stepping", position: 2, outcome: null });
  });

  it("play after stepping continues with the next event", () => {
    const { state, shown } = run(delivered, [{ type: "step-forward" }, { type: "step-forward" }, { type: "play" }, ...ticks(STEP_MS + 20)]);
    expect(shown).toEqual(["e1", "e2", "e3", "e4"]);
    expect(state.status).toBe("playing");
  });

  it("restart clears the view; play from the end replays from the first event", () => {
    const finished = run(delivered, [{ type: "play" }, ...ticks(STEP_MS * 6)]).state;
    const restarted = playbackReducer(finished, { type: "restart" });
    expect(viewOf(restarted)).toMatchObject({ status: "ready", current: null, outcome: null, position: 0 });
    expect(restarted.announcement?.kind).toBe("restarted");
    const replay = playbackReducer(finished, { type: "play" });
    expect(replay).toMatchObject({ status: "playing", index: 0, inStepMs: 0 });
  });

  it("loading a new journey resets the position and keeps speed and motion settings", () => {
    let state: PlaybackState = run(delivered, [{ type: "set-speed", speed: 2 }, { type: "play" }, ...ticks(STEP_MS)], { reducedMotion: true }).state;
    state = playbackReducer(state, { type: "load", journey: failed });
    expect(state).toMatchObject({ status: "ready", index: -1, speed: 2, reducedMotion: true });
    expect(state.journey).toBe(failed);
  });

  it("ticks do nothing unless playing", () => {
    const ready = createPlaybackState(delivered);
    expect(playbackReducer(ready, tick(5000))).toBe(ready);
    const stepping = playbackReducer(ready, { type: "step-forward" });
    expect(playbackReducer(stepping, tick(5000))).toBe(stepping);
    const playing = playbackReducer(ready, { type: "play" });
    expect(playbackReducer(playing, tick(0))).toBe(playing);
    expect(playbackReducer(playing, tick(-5))).toBe(playing);
  });
});

describe("reduced motion", () => {
  it("never tweens: the packet is always drawn arrived at the current event", () => {
    let state = playbackReducer(createPlaybackState(delivered, { reducedMotion: true }), { type: "play" });
    const seen = new Set<number>();
    for (const event of ticks(STEP_MS * 5 + 50)) {
      state = playbackReducer(state, event);
      seen.add(viewOf(state).progress);
    }
    expect([...seen]).toEqual([1]);
    expect(state.status).toBe("finished");
  });

  it("still plays in discrete steps with the same timing and the same events", () => {
    const { shown, state } = run(delivered, [{ type: "play" }, ...ticks(STEP_MS * 2.5)], { reducedMotion: true });
    expect(shown).toEqual(["e1", "e2", "e3"]);
    expect(state.index).toBe(2);
  });

  it("can be switched while playing without losing the place", () => {
    let state = run(delivered, [{ type: "play" }, ...ticks(STEP_MS * 1.2)]).state;
    expect(viewOf(state).progress).toBeLessThan(1);
    state = playbackReducer(state, { type: "set-reduced-motion", reduced: true });
    expect(state.index).toBe(1);
    expect(viewOf(state).progress).toBe(1);
  });
});

describe("announcement text", () => {
  const t = (key: string, values?: Record<string, string | number>) => `[${key} ${JSON.stringify(values ?? {})}]`;

  it("puts the position before the engine's own sentence, in the reader's language", () => {
    const { state } = run(failed, [{ type: "step-forward" }]);
    expect(renderPlaybackAnnouncement(state.announcement!, "en", t)).toBe('[event {"current":1,"total":3}] PC-A builds the packet.');
    expect(renderPlaybackAnnouncement(state.announcement!, "ar", t)).toContain("(ar)");
  });

  it("every announcement has a new sequence number", () => {
    const a = playbackReducer(createPlaybackState(delivered), { type: "step-forward" });
    const b = playbackReducer(a, { type: "step-forward" });
    const c = playbackReducer(b, { type: "step-back" });
    expect([a, b, c].map((s) => s.announcement?.seq)).toEqual([1, 2, 3]);
  });
});
