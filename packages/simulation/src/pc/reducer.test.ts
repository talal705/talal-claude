import { describe, expect, it } from "vitest";
import type { PCAction, PCBuildState } from "@ytl/contracts";
import { run } from "./test-helpers";
import { TARGET_ID_PATTERN } from "@ytl/contracts";
import { pcCatalog } from "../../../../content/catalog";
import { applyAction, canRedo, canUndo, createBuild, createHistory, dispatch, mountOptions, redo, replay, timelineLog, toProjectData, undo } from "./index";

const Z790 = "asus-tuf-gaming-z790-plus-wifi";
const B550 = "asus-tuf-gaming-b550-plus";
const DDR5 = "corsair-vengeance-rgb-ddr5-6000-32gb-kit";
const DDR4 = "corsair-vengeance-lpx-ddr4-3600-16gb-kit";

describe("build reducer", () => {
  it("creates deterministic instance IDs and the part's own cables", () => {
    const r = applyAction(createBuild(pcCatalog), { type: "add_part", catalogId: "corsair-cx550" }, pcCatalog);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created?.instanceId).toBe("psu-1");
    expect(r.state.cables.map((c) => c.id)).toEqual(["psu-1.atx24", "psu-1.eps", "psu-1.pcie", "psu-1.sata", "psu-1.peripheral"]);
    expect(r.state.cables.every((c) => Object.values(c.ends).every((to) => to === null))).toBe(true);
    expect(r.state.nextSerial).toBe(2);
  });

  it("does not mutate the input state", () => {
    const before = createBuild(pcCatalog);
    const frozen = JSON.stringify(before);
    applyAction(before, { type: "add_part", catalogId: Z790 }, pcCatalog);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("rejects a DDR4 module in a DDR5 slot at insertion, with the reason and evidence", () => {
    const state = run(createBuild(pcCatalog), [
      { type: "add_part", catalogId: Z790 },
      { type: "add_part", catalogId: DDR4 },
    ]);
    const r = applyAction(state, { type: "mount_part", instanceId: "ram-2", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-a2" } }, pcCatalog, { projectRevision: 7 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection.code).toBe("ram_generation_mismatch");
    expect(r.rejection.class).toBe("impossible_fit");
    expect(r.rejection.evidence.map((e) => [e.observed, e.expected])).toContainEqual(["DDR4", "DDR5"]);
    // The reason itself states the cause in one sentence, with both generations and without the product name.
    expect(r.rejection.message.en).toBe("This is a DDR4 module and the slot is DDR5: the notch is in a different place, so it physically cannot go in.");
    expect(r.rejection.message.ar).toMatch(/DDR4.*DDR5/);
    expect(r.rejection.message.en).not.toMatch(/Corsair|VENGEANCE/);
    expect(r.rejection.explanation.en).toMatch(/notch/);
    expect(r.rejection.explanation.ar.length).toBeGreaterThan(20);
    expect(r.rejection.target).toEqual({ id: "pc:connector:motherboard-1/dimm-a2", kind: "connector", projectRevision: 7 });
    expect(r.rejection.target.id).toMatch(TARGET_ID_PATTERN);
    // Nothing was placed.
    expect(r.state).toBe(state);
    expect(r.state.parts.find((p) => p.instanceId === "ram-2")?.attachments).toEqual([]);
  });

  it("rejects a DDR5 module in a DDR4 slot the same way, and accepts the matching generation", () => {
    const state = run(createBuild(pcCatalog), [
      { type: "add_part", catalogId: B550 },
      { type: "add_part", catalogId: DDR5 },
      { type: "add_part", catalogId: DDR4 },
    ]);
    const wrong = applyAction(state, { type: "mount_part", instanceId: "ram-2", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-b2" } }, pcCatalog);
    expect(wrong.ok === false && wrong.rejection.code).toBe("ram_generation_mismatch");
    const right = applyAction(state, { type: "mount_part", instanceId: "ram-3", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-b2" } }, pcCatalog);
    expect(right.ok).toBe(true);
    if (!right.ok) return;
    expect(right.state.parts.find((p) => p.instanceId === "ram-3")?.attachments).toEqual([
      { role: "main", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-b2" }, seating: "placed", fastenersSecured: 0 },
    ]);
  });

  it("lists every memory slot as a destination, with the mismatch reason, without logging anything", () => {
    const state = run(createBuild(pcCatalog), [
      { type: "add_part", catalogId: Z790 },
      { type: "add_part", catalogId: DDR4 },
      { type: "add_part", catalogId: DDR5 },
    ]);
    const ddr4 = mountOptions(state, pcCatalog, "ram-2");
    expect(ddr4.map((o) => o.target.mountPointId)).toEqual(["dimm-a1", "dimm-a2", "dimm-b1", "dimm-b2"]);
    expect(ddr4.every((o) => !o.ok && o.rejection?.code === "ram_generation_mismatch")).toBe(true);
    const ddr5 = mountOptions(state, pcCatalog, "ram-3");
    expect(ddr5.every((o) => o.ok && o.rejection === undefined)).toBe(true);
    // An option offered as valid is accepted by the reducer for the same state.
    const first = ddr5[0]!;
    expect(applyAction(state, { type: "mount_part", instanceId: "ram-3", role: first.role, target: first.target }, pcCatalog).ok).toBe(true);
  });

  it("refuses to secure a part that is not fully seated, and releases fasteners when it is unseated", () => {
    let state = run(createBuild(pcCatalog), [
      { type: "add_part", catalogId: Z790 },
      { type: "add_part", catalogId: "intel-core-i5-14600k" },
      { type: "mount_part", instanceId: "cpu-2", target: { hostInstanceId: "motherboard-1", mountPointId: "cpu-socket" } },
    ]);
    const early = applyAction(state, { type: "set_fasteners", instanceId: "cpu-2", secured: 1 }, pcCatalog);
    expect(early.ok === false && early.rejection.code).toBe("seating_blocked");
    state = run(state, [
      { type: "set_seating", instanceId: "cpu-2", seating: "seated" },
      { type: "set_fasteners", instanceId: "cpu-2", secured: 1 },
    ]);
    expect(state.parts[1]?.attachments[0]?.fastenersSecured).toBe(1);
    state = run(state, [{ type: "set_seating", instanceId: "cpu-2", seating: "placed" }]);
    expect(state.parts[1]?.attachments[0]?.fastenersSecured).toBe(0);
  });

  it("returns parts mounted on a removed part to the bench and unplugs cables that went into it", () => {
    let state = run(createBuild(pcCatalog), [
      { type: "add_part", catalogId: Z790 },
      { type: "add_part", catalogId: DDR5 },
      { type: "add_part", catalogId: "corsair-cx550" },
      { type: "mount_part", instanceId: "ram-2", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-a2" } },
      { type: "connect_cable_end", cableId: "psu-3.atx24", endId: "device", to: { kind: "part", instanceId: "motherboard-1", portId: "atx-24" } },
    ]);
    state = run(state, [{ type: "remove_part", instanceId: "motherboard-1" }]);
    expect(state.parts.map((p) => p.instanceId)).toEqual(["ram-2", "psu-3"]);
    expect(state.parts[0]?.attachments).toEqual([]);
    expect(state.cables.find((c) => c.id === "psu-3.atx24")?.ends.device).toBeNull();
  });

  it("refuses hardware changes while the power is on", () => {
    const state = run(createBuild(pcCatalog), [{ type: "add_part", catalogId: Z790 }, { type: "press_power" }]);
    const r = applyAction(state, { type: "add_part", catalogId: DDR5 }, pcCatalog);
    expect(r.ok === false && r.rejection.code).toBe("power_is_on");
    expect(applyAction(state, { type: "power_off" }, pcCatalog).ok).toBe(true);
  });
});

describe("undo, redo and replay", () => {
  const actions: PCAction[] = [
    { type: "add_part", catalogId: Z790 },
    { type: "add_part", catalogId: DDR5 },
    { type: "mount_part", instanceId: "ram-2", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-a2" } },
    { type: "set_seating", instanceId: "ram-2", seating: "seated" },
  ];

  it("undo restores the exact previous state and redo restores the undone one", () => {
    let h = createHistory(createBuild(pcCatalog));
    const seen: PCBuildState[] = [h.present];
    for (const a of actions) {
      h = dispatch(h, a, pcCatalog).history;
      seen.push(h.present);
    }
    expect(canRedo(h)).toBe(false);
    h = undo(h);
    expect(h.present).toBe(seen[3]);
    expect(h.present.parts[1]?.attachments[0]?.seating).toBe("placed");
    h = undo(h);
    expect(h.present).toBe(seen[2]);
    h = redo(h);
    h = redo(h);
    expect(h.present).toBe(seen[4]);
    expect(redo(h)).toBe(h);
    for (let i = 0; i < 4; i += 1) h = undo(h);
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(h.present).toBe(seen[0]);
  });

  it("a new action after undo discards the redo branch", () => {
    let h = createHistory(createBuild(pcCatalog));
    for (const a of actions) h = dispatch(h, a, pcCatalog).history;
    h = undo(h);
    h = dispatch(h, { type: "set_seating", instanceId: "ram-2", seating: "partial" }, pcCatalog).history;
    expect(canRedo(h)).toBe(false);
    expect(h.present.parts[1]?.attachments[0]?.seating).toBe("partial");
    expect(timelineLog(h).at(-1)).toEqual({ type: "set_seating", instanceId: "ram-2", seating: "partial" });
  });

  it("records a rejected attempt in the event log without adding an undo step", () => {
    let h = createHistory(createBuild(pcCatalog));
    h = dispatch(h, { type: "add_part", catalogId: Z790 }, pcCatalog).history;
    h = dispatch(h, { type: "add_part", catalogId: DDR4 }, pcCatalog).history;
    const before = h.present;
    const { history, result } = dispatch(h, { type: "mount_part", instanceId: "ram-2", target: { hostInstanceId: "motherboard-1", mountPointId: "dimm-a1" } }, pcCatalog);
    expect(result.ok).toBe(false);
    expect(history.present).toBe(before);
    expect(history.past.length).toBe(2);
    expect(history.events.map((e) => [e.seq, e.accepted])).toEqual([[1, true], [2, true], [3, false]]);
    expect(history.events[2]?.rejection?.code).toBe("ram_generation_mismatch");
    expect(timelineLog(history)).toHaveLength(2);
  });

  it("replaying the timeline log reproduces the state exactly, including after undo and redo", () => {
    let h = createHistory(createBuild(pcCatalog));
    for (const a of actions) h = dispatch(h, a, pcCatalog).history;
    h = undo(h);
    h = undo(h);
    h = redo(h);
    h = dispatch(h, { type: "add_part", catalogId: "corsair-cx550" }, pcCatalog).history;
    const data = toProjectData(h);
    const again = replay(data.log, pcCatalog);
    expect(again.clean).toBe(true);
    expect(again.state).toEqual(data.state);
    expect(replay(data.log, pcCatalog).state).toEqual(again.state);
    expect(again.state.parts.map((p) => p.instanceId)).toEqual(["motherboard-1", "ram-2", "psu-3"]);
  });
});


describe("motherboard-first workbench assembly", () => {
  it.each(["i5-ddr4-air", "i7-ddr5-rgb-aio"])("%s keeps attached parts when the prepared board moves into the case", async (kitId) => {
    const { pcStarterKits } = await import("../../../../content/catalog");
    const { evaluateStartup } = await import("./index");
    const kit = pcStarterKits.find((item) => item.id === kitId)!;
    const boardStep = kit.solution.findIndex((action) => action.type === "mount_part" && action.instanceId === "motherboard-2");
    expect(boardStep).toBeGreaterThan(0);
    const prepared = replay([...kit.actions, ...kit.solution.slice(0, boardStep)], pcCatalog);
    expect(prepared.clean).toBe(true);
    expect(prepared.state.parts.find((part) => part.instanceId === "motherboard-2")!.attachments).toEqual([]);
    const attached = prepared.state.parts.filter((part) => part.attachments.some((a) => a.target.hostInstanceId === "motherboard-2"));
    expect(attached.map((part) => part.instanceId)).toEqual(expect.arrayContaining(["cpu-3", "ram-4", "ram-5", "cooling-7"]));
    if (kitId === "i7-ddr5-rgb-aio") expect(attached.map((part) => part.instanceId)).toContain("storage-6");
    const mounted = replay(kit.solution.slice(boardStep, boardStep + 3), pcCatalog, prepared.state);
    expect(mounted.clean).toBe(true);
    expect(mounted.state.parts.filter((part) => attached.some((before) => before.instanceId === part.instanceId))).toEqual(attached);
    const completed = replay([...kit.solution.slice(boardStep + 3), { type: "press_power" }], pcCatalog, mounted.state);
    expect(completed.clean).toBe(true);
    expect(evaluateStartup(completed.state, pcCatalog).outcome).toBe("operational");
  });
});
