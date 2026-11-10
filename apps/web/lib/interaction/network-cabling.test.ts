import { describe, expect, it } from "vitest";
import type { CablePortOption, PlugWiremap, WireColor } from "@ytl/contracts";
import {
  cablingReducer,
  createPlugState,
  initialCablingState,
  keyToPlugEvent,
  plugReducer,
  portCandidates,
  renderPlugAnnouncement,
  type CablingEffect,
  type CablingEvent,
  type CablingSubject,
  type PlugEffect,
  type PlugEvent,
  type PlugState,
} from "./network-cabling";
import { keyToSelectionEvent, renderAnnouncement } from "./selection";

// ---------- Connect a cable end to a port ----------

// Fake engine answers: port 1 is taken, ports 2 and 3 are free, the fibre port is the wrong kind.
const options: CablePortOption[] = [
  { to: { deviceId: "sw-1", portId: "p1" }, label: { en: "Switch 1, port 1", ar: "السويتش 1، المنفذ 1" }, ok: false, reason: { en: "Port 1 already has a cable.", ar: "المنفذ 1 فيه سلك." } },
  { to: { deviceId: "sw-1", portId: "p2" }, label: { en: "Switch 1, port 2", ar: "السويتش 1، المنفذ 2" }, ok: true },
  { to: { deviceId: "pc-b", portId: "eth0" }, label: { en: "PC-B, network port", ar: "PC-B، منفذ الشبكة" }, ok: true },
  { to: { deviceId: "ont-1", portId: "pon" }, label: { en: "ONT, fibre port", ar: "ONT، منفذ الألياف" }, ok: false, reason: { en: "An Ethernet plug does not fit a fibre port.", ar: "فيشة الإيثرنت ما تركب في منفذ الألياف." } },
];
const end: CablingSubject = { kind: "cable-end", cableId: "cable-2", endId: "b", label: { en: "Ethernet cable 2, free end", ar: "سلك الإيثرنت 2، الطرف الحر" } };
const candidates = portCandidates("cable-2", "b", options);
const select: CablingEvent = { type: "select", subject: end, candidates };

function connect(events: CablingEvent[]) {
  let state = initialCablingState;
  const effects: CablingEffect[] = [];
  for (const event of events) {
    const step = cablingReducer(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

describe("select a cable end, then a port", () => {
  it("builds one candidate per engine option, with the action naming both ends and the port's target", () => {
    expect(candidates.map((c) => c.ok)).toEqual([false, true, true, false]);
    expect(candidates[1].action).toEqual({ type: "connect_cable_end", cableId: "cable-2", endId: "b", to: { deviceId: "sw-1", portId: "p2" } });
    expect(candidates[1].target).toEqual({ id: "network:port:sw-1/p2", kind: "port" });
    expect(candidates[0].reason).toEqual(options[0].reason);
    expect(candidates[1].reason).toBeUndefined();
  });

  it("lists every port, focuses the first one that can take the end and says how many can", () => {
    const { state, effects } = connect([select]);
    expect(state).toMatchObject({ phase: "choosing", activeIndex: 1 });
    expect(state.announcement).toMatchObject({ key: "selected", values: { available: 2, total: 4 } });
    expect(effects).toEqual([{ type: "focus-candidate", candidateId: "network:port:sw-1/p2" }]);
  });

  it("Enter on a free port dispatches the connection; the engine's acceptance is announced", () => {
    const { state, effects } = connect([select, { type: "move", to: "next" }, { type: "choose" }, { type: "result", ok: true }]);
    expect(effects).toContainEqual({ type: "dispatch", action: candidates[2].action });
    expect(state.phase).toBe("idle");
    expect(state.announcement).toMatchObject({ key: "placed", labels: { destination: options[2].label } });
  });

  it("Enter on a port the engine rejected dispatches nothing and reads out the engine's reason", () => {
    const { state, effects } = connect([select, { type: "move", to: "last" }, { type: "choose" }]);
    expect(effects.some((effect) => effect.type === "dispatch")).toBe(false);
    expect(state.announcement).toMatchObject({ key: "notAvailable", politeness: "assertive", detail: options[3].reason });
  });

  it("a connection the engine refuses returns to the list with the engine's reason", () => {
    const reason = { en: "The cable is too short to reach.", ar: "السلك قصير وما يوصل." };
    const { state } = connect([select, { type: "choose" }, { type: "result", ok: false, reason }]);
    expect(state).toMatchObject({ phase: "choosing", activeIndex: 1 });
    expect(state.announcement).toMatchObject({ key: "refused", detail: reason, politeness: "assertive" });
  });

  it("Escape cancels and returns focus to the cable end; the list keys are the shared ones", () => {
    const { state, effects } = connect([select, { type: "cancel" }]);
    expect(state.phase).toBe("idle");
    expect(effects.at(-1)).toEqual({ type: "focus-subject", subject: end });
    expect(keyToSelectionEvent({ key: "ArrowDown" })).toEqual({ type: "move", to: "next" });
  });

  it("announcements render in both languages with the engine's reason appended", () => {
    const { state } = connect([select, { type: "move", to: "first" }, { type: "choose" }]);
    const t = (key: string, values?: Record<string, string | number>) => `${key}|${values?.subject}|${values?.destination}`;
    expect(renderAnnouncement(state.announcement!, "en", t)).toBe("notAvailable|Ethernet cable 2, free end|Switch 1, port 1 Port 1 already has a cable.");
    expect(renderAnnouncement(state.announcement!, "ar", t)).toContain("المنفذ 1 فيه سلك.");
  });
});

// ---------- The Ethernet-plug exercise ----------

const start: WireColor[] = ["blue", "white-orange", "orange", "white-green", "white-blue", "green", "white-brown", "brown"];

function plug(events: PlugEvent[], from: PlugState = createPlugState(start)) {
  let state = from;
  const effects: PlugEffect[] = [];
  for (const event of events) {
    const step = plugReducer(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}
const left: PlugEvent = { type: "arrow", direction: "left" };
const right: PlugEvent = { type: "arrow", direction: "right" };
const grab: PlugEvent = { type: "toggle-grab" };

// What a fake engine might answer. The machine must show either without judging the order itself.
const pass: PlugWiremap = { passed: true, pins: start.map((wire, i) => ({ position: i + 1, wire, ok: true })), summary: { en: "All eight wires match T568B.", ar: "الأسلاك الثمانية مطابقة لـ T568B." } };
const fail: PlugWiremap = {
  passed: false,
  pins: start.map((wire, i) => ({ position: i + 1, wire, ok: i > 3, detail: i > 3 ? undefined : { en: "Wrong wire for this pin.", ar: "سلك غلط لهذا البن." } })),
  summary: { en: "Pins 1 to 4 do not match T568B.", ar: "البنات من 1 إلى 4 ما تطابق T568B." },
};

describe("Ethernet plug: arranging the wires", () => {
  it("starts with the arrangement it was given and rejects anything that is not the eight wires once each", () => {
    const state = createPlugState(start);
    expect(state).toMatchObject({ phase: "arranging", order: start, activeIndex: 0, standard: null, result: null, grabbedFrom: null });
    expect(() => createPlugState(start.slice(0, 7))).toThrow();
    expect(() => createPlugState([...start.slice(0, 7), "blue"])).toThrow();
  });

  it("arrows move the focus between positions and stop at pin 1 and pin 8", () => {
    expect(plug([right, right]).state.activeIndex).toBe(2);
    expect(plug([left]).state.activeIndex).toBe(0);
    expect(plug([{ type: "jump", to: "last" }, right]).state.activeIndex).toBe(7);
    expect(plug([right]).effects).toEqual([{ type: "focus-position", index: 1 }]);
    expect(plug([right, right]).state.order).toEqual(start);
  });

  it("Space picks a wire up, arrows then move the wire, Space puts it down", () => {
    const { state, effects } = plug([grab, right, right, grab]);
    expect(state.order).toEqual(["white-orange", "orange", "blue", "white-green", "white-blue", "green", "white-brown", "brown"]);
    expect(state).toMatchObject({ activeIndex: 2, grabbedFrom: null });
    expect(state.announcement).toMatchObject({ key: "dropped", wire: "blue", values: { position: 3 } });
    expect(effects.filter((effect) => effect.type === "focus-position")).toEqual([
      { type: "focus-position", index: 1 },
      { type: "focus-position", index: 2 },
    ]);
  });

  it("each move of a held wire is announced with the wire and its new pin", () => {
    const held = plug([grab]).state;
    expect(held.announcement).toMatchObject({ key: "grabbed", wire: "blue", values: { position: 1 } });
    const moved = plugReducer(held, right).state;
    expect(moved.announcement).toMatchObject({ key: "moved", wire: "blue", values: { position: 2 } });
  });

  it("a held wire cannot leave the plug: at pin 1 or pin 8 it stays and says so", () => {
    const { state } = plug([grab, left]);
    expect(state.order).toEqual(start);
    expect(state.announcement).toMatchObject({ key: "atEdge", wire: "blue", values: { position: 1 } });
    expect(state.grabbedFrom).not.toBeNull();
  });

  it("Home and End carry a held wire to pin 1 or pin 8", () => {
    const { state } = plug([right, right, grab, { type: "jump", to: "last" }]);
    expect(state.order).toEqual(["blue", "white-orange", "white-green", "white-blue", "green", "white-brown", "brown", "orange"]);
    expect(state.activeIndex).toBe(7);
  });

  it("Escape puts a held wire back where it was picked up", () => {
    const { state, effects } = plug([right, grab, right, right, right, { type: "cancel" }]);
    expect(state.order).toEqual(start);
    expect(state).toMatchObject({ activeIndex: 1, grabbedFrom: null });
    expect(state.announcement).toMatchObject({ key: "grabCancelled", wire: "white-orange", values: { position: 2 } });
    expect(effects.at(-1)).toEqual({ type: "focus-position", index: 1 });
  });

  it("the move buttons shift one wire one position without picking it up", () => {
    const { state } = plug([{ type: "shift", index: 3, direction: "left" }]);
    expect(state.order.slice(0, 4)).toEqual(["blue", "white-orange", "white-green", "orange"]);
    expect(state).toMatchObject({ activeIndex: 2, grabbedFrom: null });
    expect(plug([{ type: "shift", index: 0, direction: "left" }]).state.announcement?.key).toBe("atEdge");
    expect(plug([{ type: "shift", index: 9, direction: "left" }]).state.order).toEqual(start);
  });

  it("the order always holds each wire exactly once, whatever the sequence of moves", () => {
    const moves: PlugEvent[] = [grab, right, right, grab, right, grab, left, left, left, left, grab, { type: "jump", to: "last" }, grab, { type: "jump", to: "first" }, { type: "cancel" }, { type: "shift", index: 4, direction: "right" }];
    const { state } = plug(moves);
    expect([...state.order].sort()).toEqual([...start].sort());
  });
});

describe("Ethernet plug: standard, crimp, wiremap", () => {
  it("crimping without a chosen standard sends nothing and asks for one", () => {
    const { state, effects } = plug([{ type: "crimp" }]);
    expect(effects).toEqual([]);
    expect(state.phase).toBe("arranging");
    expect(state.announcement).toMatchObject({ key: "needStandard", politeness: "assertive" });
  });

  it("crimping sends the learner's standard and the order exactly as arranged; nothing is judged here", () => {
    const { state, effects } = plug([grab, right, grab, { type: "choose-standard", standard: "T568B" }, { type: "crimp" }]);
    expect(state.phase).toBe("crimping");
    expect(state.result).toBeNull();
    expect(effects.at(-1)).toEqual({
      type: "crimp",
      attempt: { standard: "T568B", order: ["white-orange", "blue", "orange", "white-green", "white-blue", "green", "white-brown", "brown"] },
    });
  });

  it("a wire still held when crimping is put down where it is", () => {
    const { state, effects } = plug([{ type: "choose-standard", standard: "T568A" }, grab, right, { type: "crimp" }]);
    expect(state.grabbedFrom).toBeNull();
    expect(effects.at(-1)).toMatchObject({ type: "crimp", attempt: { order: ["white-orange", "blue", "orange", "white-green", "white-blue", "green", "white-brown", "brown"] } });
  });

  it("shows whatever wiremap the engine returns: a pass is announced politely with the engine's summary", () => {
    const { state } = plug([{ type: "choose-standard", standard: "T568B" }, { type: "crimp" }, { type: "result", wiremap: pass }]);
    expect(state).toMatchObject({ phase: "crimped", result: pass });
    expect(state.announcement).toMatchObject({ key: "passed", detail: pass.summary, politeness: "polite" });
  });

  it("a failed wiremap is announced assertively and kept pin by pin for reading", () => {
    const { state } = plug([{ type: "choose-standard", standard: "T568B" }, { type: "crimp" }, { type: "result", wiremap: fail }]);
    expect(state.announcement).toMatchObject({ key: "failed", detail: fail.summary, politeness: "assertive" });
    expect(state.result?.pins.filter((pin) => !pin.ok).map((pin) => pin.position)).toEqual([1, 2, 3, 4]);
  });

  it("the same arrangement passes or fails only as the engine says", () => {
    const base: PlugEvent[] = [{ type: "choose-standard", standard: "T568B" }, { type: "crimp" }];
    expect(plug([...base, { type: "result", wiremap: pass }]).state.result?.passed).toBe(true);
    expect(plug([...base, { type: "result", wiremap: fail }]).state.result?.passed).toBe(false);
  });

  it("while the engine is testing, input is ignored; a result with no crimp pending is ignored", () => {
    const crimping = plug([{ type: "choose-standard", standard: "T568B" }, { type: "crimp" }]).state;
    for (const event of [grab, right, { type: "crimp" }, { type: "reset" }, { type: "choose-standard", standard: "T568A" }] as PlugEvent[]) {
      expect(plugReducer(crimping, event).state).toBe(crimping);
    }
    const arranging = createPlugState(start);
    expect(plugReducer(arranging, { type: "result", wiremap: pass }).state).toBe(arranging);
  });

  it("a crimped plug cannot be rearranged, but its pins can still be visited to read the result", () => {
    const crimped = plug([{ type: "choose-standard", standard: "T568B" }, { type: "crimp" }, { type: "result", wiremap: fail }]).state;
    const tried = plugReducer(crimped, grab).state;
    expect(tried.order).toEqual(start);
    expect(tried.grabbedFrom).toBeNull();
    expect(tried.announcement).toMatchObject({ key: "locked", politeness: "assertive" });
    expect(plugReducer(crimped, { type: "shift", index: 2, direction: "left" }).state.order).toEqual(start);
    expect(plugReducer(crimped, right).state.activeIndex).toBe(1);
    expect(plugReducer(crimped, right).state.result).toBe(fail);
  });

  it("cutting the plug off starts a new attempt: wires loose, result gone, standard kept", () => {
    const crimped = plug([{ type: "choose-standard", standard: "T568B" }, { type: "crimp" }, { type: "result", wiremap: fail }]).state;
    const fresh = plugReducer(crimped, { type: "reset" });
    expect(fresh.state).toMatchObject({ phase: "arranging", result: null, standard: "T568B", order: start, activeIndex: 0 });
    expect(fresh.state.announcement?.key).toBe("reset");
    const shuffled: WireColor[] = [...start].reverse();
    expect(plugReducer(crimped, { type: "reset", order: shuffled }).state.order).toEqual(shuffled);
  });
});

describe("Ethernet plug: keyboard and text", () => {
  it("maps the row keys; Left is toward pin 1 in every language", () => {
    expect(keyToPlugEvent({ key: "ArrowLeft" })).toEqual({ type: "arrow", direction: "left" });
    expect(keyToPlugEvent({ key: "ArrowRight" })).toEqual({ type: "arrow", direction: "right" });
    expect(keyToPlugEvent({ key: "Home" })).toEqual({ type: "jump", to: "first" });
    expect(keyToPlugEvent({ key: "End" })).toEqual({ type: "jump", to: "last" });
    expect(keyToPlugEvent({ key: " " })).toEqual({ type: "toggle-grab" });
    expect(keyToPlugEvent({ key: "Enter" })).toEqual({ type: "toggle-grab" });
    expect(keyToPlugEvent({ key: "Escape" })).toEqual({ type: "cancel" });
  });

  it("leaves Tab, vertical arrows and shortcuts to the browser", () => {
    for (const key of [{ key: "Tab" }, { key: "ArrowUp" }, { key: "ArrowLeft", altKey: true }, { key: "z", ctrlKey: true }]) {
      expect(keyToPlugEvent(key)).toBeNull();
    }
  });

  it("renders the wire's name from the messages and appends the engine's summary", () => {
    const t = (key: string, values?: Record<string, string | number>) => (key.startsWith("wire.") ? `<${key}>` : `${key} ${JSON.stringify(values)}`);
    const held = plug([grab]).state;
    expect(renderPlugAnnouncement(held.announcement!, "en", t)).toBe('announce.grabbed {"position":1,"wire":"<wire.blue>"}');
    const failed = plug([{ type: "choose-standard", standard: "T568B" }, { type: "crimp" }, { type: "result", wiremap: fail }]).state;
    expect(renderPlugAnnouncement(failed.announcement!, "ar", t)).toBe("announce.failed {} البنات من 1 إلى 4 ما تطابق T568B.");
  });

  it("every announcement has a new sequence number", () => {
    const a = plugReducer(createPlugState(start), grab).state;
    const b = plugReducer(a, left).state;
    const c = plugReducer(b, left).state;
    expect([a, b, c].map((s) => s.announcement?.seq)).toEqual([1, 2, 3]);
  });
});
