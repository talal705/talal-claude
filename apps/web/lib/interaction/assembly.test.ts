import { describe, expect, it } from "vitest";
import type { PCCableEndOption, PCDiagnostic, PCMountOption } from "@ytl/contracts";
import {
  assemblyReducer,
  cableEndCandidates,
  initialAssemblyState,
  keyToAssemblyEvent,
  mountCandidates,
  moveIndex,
  renderAnnouncement,
  rovingTabIndex,
  type AssemblyEffect,
  type AssemblyEvent,
  type AssemblyOptions,
  type AssemblyState,
  type AssemblySubject,
} from "./assembly";

const rejection = (en: string, ar: string): PCDiagnostic =>
  ({
    id: "x",
    code: "unknown_reference",
    class: "impossible_fit",
    severity: "blocking",
    message: { en, ar },
    explanation: { en, ar },
    evidence: [],
    target: { id: "pc:component:ram-1", kind: "component" },
    relatedTargets: [],
  }) as PCDiagnostic;

// Fake engine answers: slot A1 is occupied, A2 and B2 are free, the M.2 slot is the wrong kind.
const ramOptions: PCMountOption[] = [
  { role: "dimm", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-a1" }, label: { en: "Slot A1", ar: "الفتحة A1" }, ok: false, rejection: rejection("Slot A1 already holds a module.", "الفتحة A1 فيها رام.") },
  { role: "dimm", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-a2" }, label: { en: "Slot A2", ar: "الفتحة A2" }, ok: true },
  { role: "dimm", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-b2" }, label: { en: "Slot B2", ar: "الفتحة B2" }, ok: true },
  { role: "dimm", target: { hostInstanceId: "motherboard-1", mountPointId: "m2-1" }, label: { en: "M.2 slot", ar: "فتحة M.2" }, ok: false, rejection: rejection("A memory module does not fit an M.2 slot.", "الرام ما يركب في فتحة M.2.") },
];
const ram: AssemblySubject = { kind: "part", instanceId: "ram-2", label: { en: "DDR5 16 GB module", ar: "رام DDR5 16 قيقا" } };
const candidates = mountCandidates("ram-2", ramOptions);

function run(events: AssemblyEvent[], options?: AssemblyOptions, from: AssemblyState = initialAssemblyState) {
  let state = from;
  const effects: AssemblyEffect[] = [];
  for (const event of events) {
    const step = assemblyReducer(state, event, options);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}
const select: AssemblyEvent = { type: "select", subject: ram, candidates };

describe("candidates from engine options", () => {
  it("a mount option becomes a mount_part action with the engine's role and target, in the engine's order", () => {
    expect(candidates.map((c) => c.ok)).toEqual([false, true, true, false]);
    expect(candidates[1].action).toEqual({ type: "mount_part", instanceId: "ram-2", role: "dimm", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-a2" } });
    expect(candidates[1].target).toEqual({ id: "pc:connector:motherboard-1/dimm-a2", kind: "connector" });
    expect(candidates[0].rejection?.message.en).toBe("Slot A1 already holds a module.");
    expect(new Set(candidates.map((c) => c.id)).size).toBe(4);
  });

  it("a cable-end option becomes a connect_cable_end action naming both ends", () => {
    const options: PCCableEndOption[] = [
      { to: { kind: "part", instanceId: "motherboard-1", portId: "atx-24" }, label: { en: "ATX 24-pin", ar: "ATX 24 بن" }, ok: true },
      { to: { kind: "cable", cableId: "cable-3", endId: "socket" }, label: { en: "Extension socket", ar: "مقبس التمديد" }, ok: true },
    ];
    const list = cableEndCandidates("psu-1.atx", "device", options);
    expect(list[0].action).toEqual({ type: "connect_cable_end", cableId: "psu-1.atx", endId: "device", to: { kind: "part", instanceId: "motherboard-1", portId: "atx-24" } });
    expect(list[0].target).toEqual({ id: "pc:port:motherboard-1/atx-24", kind: "port" });
    expect(list[1].target.kind).toBe("cable-end");
  });
});

describe("select a part, then its destination", () => {
  it("selecting lists every destination, focuses the first available one and announces how many are available", () => {
    const { state, effects } = run([select]);
    expect(state).toMatchObject({ phase: "choosing", activeIndex: 1 });
    expect(state.phase === "choosing" && state.candidates).toHaveLength(4);
    expect(state.announcement).toMatchObject({ key: "selected", values: { available: 2, total: 4 }, labels: { subject: ram.label }, politeness: "polite" });
    expect(effects).toEqual([{ type: "focus-candidate", candidateId: candidates[1].id }]);
  });

  it("Enter on an available destination hands the action to the lab and waits for the result", () => {
    const { state, effects } = run([select, { type: "move", to: "next" }, { type: "choose" }]);
    expect(state).toMatchObject({ phase: "placing", activeIndex: 2 });
    expect(effects.at(-1)).toEqual({ type: "dispatch", action: candidates[2].action });
  });

  it("an accepted result announces the placement, returns to idle and sends focus back to the part", () => {
    const { state, effects } = run([select, { type: "choose" }, { type: "result", ok: true }]);
    expect(state.phase).toBe("idle");
    expect(state.announcement).toMatchObject({ key: "placed", labels: { subject: ram.label, destination: candidates[1].label } });
    expect(effects.at(-1)).toEqual({ type: "focus-subject", subject: ram });
  });

  it("Enter on a rejected destination dispatches nothing and reads out the engine's reason", () => {
    const { state, effects } = run([select, { type: "move", to: "first" }, { type: "choose" }]);
    expect(state).toMatchObject({ phase: "choosing", activeIndex: 0 });
    expect(state.announcement).toMatchObject({ key: "notAvailable", politeness: "assertive", detail: { en: "Slot A1 already holds a module." } });
    expect(effects.some((effect) => effect.type === "dispatch")).toBe(false);
  });

  it("a result refused by the engine returns to the list on the same row with the reason", () => {
    const refused = rejection("The latch is closed.", "القفل مسكّر.");
    const { state, effects } = run([select, { type: "choose" }, { type: "result", ok: false, rejection: refused }]);
    expect(state).toMatchObject({ phase: "choosing", activeIndex: 1 });
    expect(state.announcement).toMatchObject({ key: "refused", politeness: "assertive", detail: refused.message });
    expect(effects.at(-1)).toEqual({ type: "focus-candidate", candidateId: candidates[1].id });
  });

  it("while placing, every input except the result is ignored", () => {
    const placing = run([select, { type: "choose" }]).state;
    for (const event of [{ type: "choose" }, { type: "cancel" }, { type: "move", to: "next" }, { type: "undo" }, select] as AssemblyEvent[]) {
      const step = assemblyReducer(placing, event);
      expect(step.state).toBe(placing);
      expect(step.effects).toEqual([]);
    }
  });

  it("Escape cancels, announces it and sends focus back to the part", () => {
    const { state, effects } = run([select, { type: "cancel" }]);
    expect(state.phase).toBe("idle");
    expect(state.announcement?.key).toBe("cancelled");
    expect(effects.at(-1)).toEqual({ type: "focus-subject", subject: ram });
  });

  it("a part with no destination at all stays idle and says so", () => {
    const { state, effects } = run([{ type: "select", subject: ram, candidates: [] }]);
    expect(state.phase).toBe("idle");
    expect(state.announcement?.key).toBe("selectedNowhere");
    expect(effects).toEqual([]);
  });

  it("when every destination is rejected the list still opens so the reasons can be read", () => {
    const none = candidates.filter((c) => !c.ok);
    const { state } = run([{ type: "select", subject: ram, candidates: none }]);
    expect(state).toMatchObject({ phase: "choosing", activeIndex: 0 });
    expect(state.announcement).toMatchObject({ key: "selectedNone", values: { available: 0, total: 2 } });
  });

  it("a click on a destination focuses and places it in one step; an unknown id does nothing", () => {
    const { state, effects } = run([select, { type: "pick", candidateId: candidates[2].id }]);
    expect(state).toMatchObject({ phase: "placing", activeIndex: 2 });
    expect(effects.at(-1)).toEqual({ type: "dispatch", action: candidates[2].action });
    const before = run([select]).state;
    expect(assemblyReducer(before, { type: "pick", candidateId: "nope" }).state).toBe(before);
  });

  it("selecting another part while choosing replaces the list", () => {
    const other: AssemblySubject = { kind: "part", instanceId: "ssd-1", label: { en: "NVMe drive", ar: "قرص NVMe" } };
    const { state } = run([select, { type: "select", subject: other, candidates: [candidates[3]] }]);
    expect(state.phase === "choosing" && state.subject).toEqual(other);
  });

  it("every announcement gets a new sequence number, so a repeated sentence is read again", () => {
    const first = run([select, { type: "move", to: "first" }, { type: "choose" }]).state;
    const second = assemblyReducer(first, { type: "choose" }).state;
    expect(second.announcement?.key).toBe("notAvailable");
    expect(second.announcement?.seq).toBe((first.announcement?.seq ?? 0) + 1);
  });
});

describe("confirm step", () => {
  const confirm = { confirm: true };

  it("Enter asks first, a second Enter places", () => {
    const asked = run([select, { type: "choose" }], confirm);
    expect(asked.state).toMatchObject({ phase: "confirming", activeIndex: 1 });
    expect(asked.state.announcement?.key).toBe("confirm");
    expect(asked.effects.some((effect) => effect.type === "dispatch")).toBe(false);
    const placed = assemblyReducer(asked.state, { type: "choose" }, confirm);
    expect(placed.state.phase).toBe("placing");
    expect(placed.effects).toEqual([{ type: "dispatch", action: candidates[1].action }]);
  });

  it("Escape during confirmation goes back to the list, not out of it", () => {
    const { state } = run([select, { type: "choose" }, { type: "cancel" }], confirm);
    expect(state).toMatchObject({ phase: "choosing", activeIndex: 1 });
    expect(state.announcement?.key).toBe("backToList");
  });

  it("moving to another row withdraws the confirmation; clicking another row asks about that row", () => {
    const moved = run([select, { type: "choose" }, { type: "move", to: "next" }], confirm);
    expect(moved.state).toMatchObject({ phase: "choosing", activeIndex: 2 });
    const clicked = run([select, { type: "choose" }, { type: "pick", candidateId: candidates[2].id }], confirm);
    expect(clicked.state).toMatchObject({ phase: "confirming", activeIndex: 2 });
    expect(clicked.effects.some((effect) => effect.type === "dispatch")).toBe(false);
  });
});

describe("select a cable end, then the other end", () => {
  it("runs the same flow and dispatches connect_cable_end", () => {
    const end: AssemblySubject = { kind: "cable-end", cableId: "psu-1.cpu-1", endId: "device", label: { en: "CPU power cable, loose end", ar: "سلك طاقة المعالج، الطرف الحر" } };
    const options: PCCableEndOption[] = [
      { to: { kind: "part", instanceId: "motherboard-1", portId: "atx-24" }, label: { en: "ATX 24-pin", ar: "ATX 24 بن" }, ok: false, rejection: rejection("An 8-pin CPU plug does not fit the 24-pin socket.", "فيشة المعالج 8 بن ما تركب في مقبس 24 بن.") },
      { to: { kind: "part", instanceId: "motherboard-1", portId: "eps-8" }, label: { en: "CPU power 8-pin", ar: "طاقة المعالج 8 بن" }, ok: true },
    ];
    const list = cableEndCandidates("psu-1.cpu-1", "device", options);
    const { state, effects } = run([{ type: "select", subject: end, candidates: list }, { type: "choose" }, { type: "result", ok: true }]);
    expect(effects).toContainEqual({ type: "dispatch", action: { type: "connect_cable_end", cableId: "psu-1.cpu-1", endId: "device", to: { kind: "part", instanceId: "motherboard-1", portId: "eps-8" } } });
    expect(state.announcement).toMatchObject({ key: "placed", labels: { destination: { en: "CPU power 8-pin" } } });
  });
});

describe("undo and redo", () => {
  it("asks the lab to undo and announces what happened", () => {
    const asked = assemblyReducer(initialAssemblyState, { type: "undo" });
    expect(asked.effects).toEqual([{ type: "undo" }]);
    expect(assemblyReducer(asked.state, { type: "history", did: "undo", changed: true }).state.announcement?.key).toBe("undone");
    expect(assemblyReducer(asked.state, { type: "history", did: "undo", changed: false }).state.announcement?.key).toBe("nothingToUndo");
    expect(assemblyReducer(asked.state, { type: "history", did: "redo", changed: true }).state.announcement?.key).toBe("redone");
    expect(assemblyReducer(asked.state, { type: "history", did: "redo", changed: false }).state.announcement?.key).toBe("nothingToRedo");
  });

  it("an undo that changed the build closes an open list, because its destinations are out of date", () => {
    const { state, effects } = run([select, { type: "undo" }, { type: "history", did: "undo", changed: true }]);
    expect(state.phase).toBe("idle");
    expect(effects.at(-1)).toEqual({ type: "focus-subject", subject: ram });
  });

  it("an undo with nothing to undo leaves the open list as it is", () => {
    const { state } = run([select, { type: "undo" }, { type: "history", did: "undo", changed: false }]);
    expect(state).toMatchObject({ phase: "choosing", activeIndex: 1 });
  });
});

describe("keyboard map", () => {
  it("maps the list keys", () => {
    expect(keyToAssemblyEvent({ key: "ArrowDown" })).toEqual({ type: "move", to: "next" });
    expect(keyToAssemblyEvent({ key: "ArrowUp" })).toEqual({ type: "move", to: "previous" });
    expect(keyToAssemblyEvent({ key: "Home" })).toEqual({ type: "move", to: "first" });
    expect(keyToAssemblyEvent({ key: "End" })).toEqual({ type: "move", to: "last" });
    expect(keyToAssemblyEvent({ key: "Enter" })).toEqual({ type: "choose" });
    expect(keyToAssemblyEvent({ key: " " })).toEqual({ type: "choose" });
    expect(keyToAssemblyEvent({ key: "Escape" })).toEqual({ type: "cancel" });
  });

  it("maps undo and redo on Ctrl and on Cmd", () => {
    expect(keyToAssemblyEvent({ key: "z", ctrlKey: true })).toEqual({ type: "undo" });
    expect(keyToAssemblyEvent({ key: "Z", metaKey: true, shiftKey: true })).toEqual({ type: "redo" });
    expect(keyToAssemblyEvent({ key: "y", ctrlKey: true })).toEqual({ type: "redo" });
  });

  it("leaves Tab, letters and other shortcuts to the browser", () => {
    for (const key of [{ key: "Tab" }, { key: "a" }, { key: "z" }, { key: "c", ctrlKey: true }, { key: "ArrowDown", altKey: true }, { key: "ArrowLeft" }]) {
      expect(keyToAssemblyEvent(key)).toBeNull();
    }
  });
});

describe("roving focus", () => {
  it("moves with wrap by default and clamps without it", () => {
    expect(moveIndex(3, 4, "next")).toBe(0);
    expect(moveIndex(0, 4, "previous")).toBe(3);
    expect(moveIndex(3, 4, "next", false)).toBe(3);
    expect(moveIndex(0, 4, "previous", false)).toBe(0);
    expect(moveIndex(2, 4, "first")).toBe(0);
    expect(moveIndex(0, 4, "last")).toBe(3);
    expect(moveIndex(0, 0, "next")).toBe(-1);
  });

  it("arrow keys visit rejected rows too, so their reasons can be reached", () => {
    const { state } = run([select, { type: "move", to: "previous" }]);
    expect(state).toMatchObject({ activeIndex: 0 });
    expect(run([select, { type: "move", to: "last" }]).state).toMatchObject({ activeIndex: 3 });
  });

  it("exactly one row is in the tab order", () => {
    expect([0, 1, 2, 3].map((index) => rovingTabIndex(index, 2))).toEqual([-1, -1, 0, -1]);
    expect([0, 1].map((index) => rovingTabIndex(index, -1))).toEqual([0, -1]);
  });
});

describe("announcement text", () => {
  const t = (key: string, values?: Record<string, string | number>) => `${key}:${JSON.stringify(values)}`;

  it("fills names in the reader's language and appends the engine's reason", () => {
    const { state } = run([select, { type: "move", to: "first" }, { type: "choose" }]);
    const en = renderAnnouncement(state.announcement!, "en", t);
    const ar = renderAnnouncement(state.announcement!, "ar", t);
    expect(en).toBe('notAvailable:{"subject":"DDR5 16 GB module","destination":"Slot A1"} Slot A1 already holds a module.');
    expect(ar).toContain("الفتحة A1 فيها رام.");
    expect(ar).toContain("رام DDR5 16 قيقا");
  });
});
