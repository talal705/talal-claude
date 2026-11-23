import { describe, expect, it } from "vitest";
import type { CaseEntry, PCAction, PCBuildState, PCCatalog } from "@ytl/contracts";
import { pcCatalog } from "../../../../content/catalog";
import { applyAction, createBuild } from "./index";
import { B, codes, preset, start } from "./test-helpers";

// Engine level: how each offered cooler is actually fixed (ARCTIC's manuals): the contact-frame coolers need the
// frame tight first, their body screws go in two stages, an AIO's block, radiator and VRM module are separate
// steps, and the Freezer 7 X is held by its retention ring and four pins.
const run = (s: PCBuildState, actions: PCAction[], catalog: PCCatalog = pcCatalog) => actions.reduce((st, a) => { const r = applyAction(st, a, catalog); if (!r.ok) throw new Error(`${a.type} ${JSON.stringify(a)}: ${r.rejection.code}`); return r.state; }, s);
const code = (s: PCBuildState, a: PCAction, catalog: PCCatalog = pcCatalog) => { const r = applyAction(s, a, catalog); return r.ok ? "ok" : r.rejection.code; };
const idOf = (s: PCBuildState, catalogId: string) => s.parts.find((p) => p.catalogId === catalogId)!.instanceId;
const good = { rotationDeg: 0, offsetMm: [0, 0] as [number, number] };
const TUF = "asus-tuf-gaming-z790-plus-wifi";
const F36 = "arctic-freezer-36";
const LF280 = "arctic-liquid-freezer-iii-280";
const CPU = "intel-core-i5-14600k";

const build = (catalogIds: string[]) => run(createBuild(pcCatalog), [{ type: "set_mechanics", mode: "detailed" }, ...catalogIds.map((catalogId): PCAction => ({ type: "add_part", catalogId }))]);
const mech = (s: PCBuildState, boardId: string, mechanismId: string, state: "open" | "closed"): PCAction => ({ type: "set_mechanism", instanceId: boardId, mechanismId, state });
const hw = (instanceId: string, key: string, value: string): PCAction => ({ type: "set_hardware", instanceId, key, value });
const prep = (instanceId: string, p: "paste" | "film", value: string): PCAction => ({ type: "set_prep", instanceId, prep: p, value });
const hardware = (s: PCBuildState, id: string, key: string) => s.parts.find((p) => p.instanceId === id)!.hardware?.[key];
const attachment = (s: PCBuildState, id: string) => s.parts.find((p) => p.instanceId === id)!.attachments[0];
const TIGHTEN_FRAME = ["1000", "1100", "1110", "1111", "2111", "2121", "2221", "2222"];

/** The CPU placed, backplate supported, ILM off, contact frame fitted and tightened. */
function frameTight(catalogIds: string[]) {
  let s = build(catalogIds);
  const b = idOf(s, TUF);
  s = run(s, [
    mech(s, b, "cpu-socket-plate:lever", "open"), mech(s, b, "cpu-socket-plate", "open"),
    { type: "mount_part", instanceId: idOf(s, CPU), target: { hostInstanceId: b, mountPointId: "cpu-socket" }, alignment: good },
    { type: "set_seating", instanceId: idOf(s, CPU), seating: "seated" },
    { type: "set_prep", instanceId: b, prep: "backplate", value: "padding" },
    hw(b, "ilm", "removed"), hw(b, "frame", "placed"),
    ...TIGHTEN_FRAME.map((v) => hw(b, "frame_screws", v)),
  ]);
  return { s, b };
}
const cooler = (s: PCBuildState, b: string, id: string, role?: string): PCAction => ({ type: "mount_part", instanceId: id, target: { hostInstanceId: b, mountPointId: "cooler-mount" }, ...(role ? { role } : {}) });

describe("a contact-frame air cooler (Freezer 36 on the TUF board)", () => {
  it("goes on only with the frame tight, then with its film peeled and its paste applied", () => {
    const b = build([TUF, CPU, F36]);
    const board = idOf(b, TUF);
    const c = idOf(b, F36);
    // ILM closed, no frame: the manual replaces the ILM with the frame, so this order is refused with that reason.
    const closed = run(b, [mech(b, board, "cpu-socket-plate:lever", "open"), mech(b, board, "cpu-socket-plate", "open"),
      { type: "mount_part", instanceId: idOf(b, CPU), target: { hostInstanceId: board, mountPointId: "cpu-socket" }, alignment: good },
      { type: "set_seating", instanceId: idOf(b, CPU), seating: "seated" }, mech(b, board, "cpu-socket-plate", "closed"), mech(b, board, "cpu-socket-plate:lever", "closed")]);
    expect(code(closed, cooler(closed, board, c))).toBe("mounting_missing");
    const { s } = frameTight([TUF, CPU, F36]);
    expect(code(s, cooler(s, board, c))).toBe("prep_missing");
    const ready = run(s, [prep(c, "film", "removed"), prep(c, "paste", "applied")]);
    expect(code(ready, cooler(ready, board, c))).toBe("ok");
  });

  it("body screws: placed first, two a couple of turns, then tight; one at a time; the engine's one-shot fastening is refused", () => {
    const { s: framed, b } = frameTight([TUF, CPU, F36]);
    const c = idOf(framed, F36);
    expect(code(framed, hw(c, "screws", "10"))).toBe("mounting_missing"); // not placed yet
    let s = run(framed, [prep(c, "film", "removed"), prep(c, "paste", "applied"), cooler(framed, b, c), { type: "set_seating", instanceId: c, seating: "seated" }]);
    expect(code(s, { type: "set_fasteners", instanceId: c, secured: 2 })).toBe("invalid_action");
    expect(code(s, hw(c, "screws", "22"))).toBe("hardware_order_wrong"); // two at once
    expect(code(s, hw(c, "screws", "20"))).toBe("hardware_order_wrong"); // out → tight
    expect(code(s, hw(c, "screws", "10"))).toBe("ok");
    expect(code(s, hw(c, "screws", "x0"))).toBe("invalid_action"); // not a screw state
  });

  it("tightening waits until both screws are engaged; two screws are tightened alternately; then the cooler is secured", () => {
    const { s: framed, b } = frameTight([TUF, CPU, F36]);
    const c = idOf(framed, F36);
    let s = run(framed, [prep(c, "film", "removed"), prep(c, "paste", "applied"), cooler(framed, b, c), { type: "set_seating", instanceId: c, seating: "seated" }, hw(c, "screws", "10")]);
    expect(code(s, hw(c, "screws", "20"))).toBe("hardware_order_wrong"); // the second is not engaged yet
    s = run(s, [hw(c, "screws", "11")]);
    expect(attachment(s, c).fastenersSecured).toBe(0);
    s = run(s, [hw(c, "screws", "21")]);
    expect(attachment(s, c).fastenersSecured).toBe(1);
    s = run(s, [hw(c, "screws", "22")]);
    expect(attachment(s, c)).toMatchObject({ seating: "seated", fastenersSecured: 2 });
  });

  it("is secured for startup with two tight screws, and not with two merely engaged", () => {
    let s = run(preset("i5-ddr4-air"), [{ type: "set_mechanics", mode: "detailed" }, { type: "set_side_panel", open: true }, { type: "unmount_part", instanceId: B.cooler }]);
    s = run(s, [
      mech(s, B.mb, "cpu-socket-plate:lever", "open"), mech(s, B.mb, "cpu-socket-plate", "open"),
      { type: "set_prep", instanceId: B.mb, prep: "backplate", value: "tape" }, hw(B.mb, "ilm", "removed"), hw(B.mb, "frame", "placed"),
      ...TIGHTEN_FRAME.map((v) => hw(B.mb, "frame_screws", v)),
      hw(B.cooler, "clean", "done"), prep(B.cooler, "film", "removed"), prep(B.cooler, "paste", "applied"), // lifted off a CPU: used, so cleaned and re-pasted
      { type: "mount_part", instanceId: B.cooler, target: { hostInstanceId: B.mb, mountPointId: "cooler-mount" } },
      { type: "set_seating", instanceId: B.cooler, seating: "seated" }, hw(B.cooler, "screws", "10"), hw(B.cooler, "screws", "11"),
    ]);
    expect(codes(start(s))).toContain("cooler_not_secured");
    const tight = run(s, [hw(B.cooler, "screws", "21"), hw(B.cooler, "screws", "22")]);
    expect(codes(start(tight))).not.toContain("cooler_not_secured");
  });

  it("comes off only with its screws loosened; the plate is then used: paste must be applied again after cleaning", () => {
    const { s: framed, b } = frameTight([TUF, CPU, F36]);
    const c = idOf(framed, F36);
    let s = run(framed, [prep(c, "film", "removed"), prep(c, "paste", "applied"), cooler(framed, b, c), { type: "set_seating", instanceId: c, seating: "seated" },
      hw(c, "screws", "10"), hw(c, "screws", "11"), hw(c, "screws", "21"), hw(c, "screws", "22")]);
    expect(code(s, { type: "unmount_part", instanceId: c })).toBe("retention_blocked"); // screws still tight
    expect(code(s, hw(b, "frame_screws", "2122"))).toBe("retention_blocked"); // the cooler is over the frame
    s = run(s, [hw(c, "screws", "12"), hw(c, "screws", "11"), hw(c, "screws", "01"), hw(c, "screws", "00"), { type: "unmount_part", instanceId: c }]);
    expect(hardware(s, c, "contact")).toBe("used");
    expect(s.parts.find((p) => p.instanceId === c)!.prep?.paste).toBeUndefined(); // the old layer is spent
    expect(s.parts.find((p) => p.instanceId === c)!.prep?.film).toBe("removed"); // a peeled film stays peeled
    expect(code(s, cooler(s, b, c))).toBe("mounting_missing"); // the old compound is not wiped off yet
    const again = run(s, [prep(c, "paste", "applied")]);
    expect(code(again, cooler(again, b, c))).toBe("mounting_missing"); // fresh paste does not clean the plate
    expect(code(run(s, [hw(c, "clean", "done")]), cooler(run(s, [hw(c, "clean", "done")]), b, c))).toBe("prep_missing"); // cleaned, but no new paste
    const cleaned = run(again, [hw(c, "clean", "done")]);
    expect(code(cleaned, cooler(cleaned, b, c))).toBe("ok");
    expect(code(framed, hw(c, "clean", "done"))).toBe("invalid_action"); // a plate that never touched a CPU has nothing to clean
  });
});

describe("a liquid cooler (Liquid Freezer III 280): block, radiator and VRM module are separate", () => {
  const caseId = "corsair-4000d-airflow-black";
  /** The 4000D's radiator positions: the front takes 240/280/360 mm, the rear 120 mm only. */
  const radiatorMount = (_s: PCBuildState, location: string) => {
    const e = pcCatalog.entries.find((x) => x.id === caseId) as CaseEntry;
    return e.mountPoints.find((m) => m.kind === "radiator_mount" && m.location === location)!.id;
  };
  const setup = () => {
    const { s, b } = frameTight([TUF, CPU, LF280, caseId]);
    const c = idOf(s, LF280);
    const t = run(s, [prep(c, "film", "removed"), prep(c, "paste", "applied")]);
    return { s: t, b, c, caseInstance: idOf(t, caseId) };
  };

  it("the pump block goes on the frame and takes two screws, engaged then tightened alternately", () => {
    const { s, b, c } = setup();
    expect(code(s, cooler(s, b, c, "block"))).toBe("ok");
    let t = run(s, [cooler(s, b, c, "block"), { type: "set_seating", instanceId: c, role: "block", seating: "seated" }]);
    expect(code(t, { type: "set_fasteners", instanceId: c, role: "block", secured: 2 })).toBe("invalid_action");
    t = run(t, [hw(c, "screws", "01"), hw(c, "screws", "11"), hw(c, "screws", "12"), hw(c, "screws", "22")]);
    expect(attachment(t, c)).toMatchObject({ role: "block", fastenersSecured: 2 });
  });

  it("the radiator mounts on its own in the front (the rear takes 120 mm only), and the VRM module is a step of its own", () => {
    const { s, b, c, caseInstance } = setup();
    const rear = { hostInstanceId: caseInstance, mountPointId: radiatorMount(s, "rear") };
    const front = { hostInstanceId: caseInstance, mountPointId: radiatorMount(s, "front") };
    expect(code(s, { type: "mount_part", instanceId: c, role: "radiator", target: rear })).toBe("radiator_size_unsupported");
    expect(code(s, { type: "mount_part", instanceId: c, role: "radiator", target: front })).toBe("ok");
    expect(code(s, hw(c, "vrm_fan", "attached"))).toBe("ok");
    expect(code(s, hw(c, "vrm_fan", "installed"))).toBe("invalid_action");
    expect(hardware(run(s, [hw(c, "vrm_fan", "attached")]), c, "vrm_fan")).toBe("attached");
    // A cooler without a VRM module in its kit has nothing to attach.
    const air = frameTight([TUF, CPU, F36]);
    expect(code(air.s, hw(idOf(air.s, F36), "vrm_fan", "attached"))).toBe("invalid_action");
    void b;
  });

  it("a radiator below the pump is refused (ARCTIC: risk of bubbling noise); no offered case has such a position, so this is an engine test", () => {
    const { s, c, caseInstance } = setup();
    const mount = radiatorMount(s, "front");
    const lowered: PCCatalog = { ...pcCatalog, entries: pcCatalog.entries.map((e) => (e.id === caseId ? ({ ...e, mountPoints: e.mountPoints.map((m) => (m.id === mount ? { ...m, location: "bottom" } : m)) } as typeof e) : e)) };
    expect(code(s, { type: "mount_part", instanceId: c, role: "radiator", target: { hostInstanceId: caseInstance, mountPointId: mount } }, lowered)).toBe("radiator_below_pump");
  });
});

describe("the Freezer 7 X (retention ring and four pins) on the H81M-K", () => {
  const H81 = "asus-h81m-k";
  const CPU4 = "intel-core-i5-4590";
  const F7X = "arctic-freezer-7-x";
  const ready = () => {
    let s = build([H81, CPU4, F7X]);
    const b = idOf(s, H81);
    s = run(s, [
      mech(s, b, "cpu-socket-plate:lever", "open"), mech(s, b, "cpu-socket-plate", "open"),
      { type: "mount_part", instanceId: idOf(s, CPU4), target: { hostInstanceId: b, mountPointId: "cpu-socket" }, alignment: good },
      { type: "set_seating", instanceId: idOf(s, CPU4), seating: "seated" }, mech(s, b, "cpu-socket-plate", "closed"), mech(s, b, "cpu-socket-plate:lever", "closed"),
    ]);
    return { s, b, c: idOf(s, F7X) };
  };

  it("the mounting position must match the socket; then the ring, then all four pins, before the cooler goes on", () => {
    const { s, b, c } = ready();
    expect(code(s, hw(c, "position", "1700"))).toBe("mounting_missing"); // LGA1150 takes the LGA1200/115x position
    expect(code(s, hw(c, "ring", "placed"))).toBe("mounting_missing"); // position not chosen yet
    let t = run(s, [hw(c, "position", "1200"), hw(c, "ring", "placed")]);
    expect(code(t, { type: "mount_part", instanceId: c, target: { hostInstanceId: b, mountPointId: "cooler-mount" } })).toBe("mounting_missing"); // pins missing
    expect(code(t, hw(c, "pins", "1100"))).toBe("hardware_order_wrong"); // one at a time
    t = run(t, [hw(c, "pins", "1000"), hw(c, "pins", "1010"), hw(c, "pins", "1110"), hw(c, "pins", "1111")]);
    // Pre-applied paste: nothing to add; the film still has to come off.
    expect(code(t, prep(c, "paste", "applied"))).toBe("prep_wrong");
    expect(code(t, { type: "mount_part", instanceId: c, target: { hostInstanceId: b, mountPointId: "cooler-mount" } })).toBe("prep_missing");
    t = run(t, [prep(c, "film", "removed")]);
    expect(code(t, { type: "mount_part", instanceId: c, target: { hostInstanceId: b, mountPointId: "cooler-mount" } })).toBe("ok");
  });

  it("seated on its ring, the cooler is secured; it takes no body screws", () => {
    const { s, b, c } = ready();
    const t = run(s, [hw(c, "position", "1200"), hw(c, "ring", "placed"), hw(c, "pins", "1000"), hw(c, "pins", "1100"), hw(c, "pins", "1110"), hw(c, "pins", "1111"), prep(c, "film", "removed"),
      { type: "mount_part", instanceId: c, target: { hostInstanceId: b, mountPointId: "cooler-mount" } }, { type: "set_seating", instanceId: c, seating: "seated" }]);
    expect(attachment(t, c)).toMatchObject({ seating: "seated", fastenersSecured: 4 });
    expect(code(t, hw(c, "screws", "10"))).toBe("invalid_action");
  });
});

describe("what does not change", () => {
  it("a generic cooler, a basic-mode build and an unsupported socket keep their behaviour", () => {
    const generic = build([TUF, CPU, "generic-low-profile-air-cooler"]);
    const board = idOf(generic, TUF);
    const g = idOf(generic, "generic-low-profile-air-cooler");
    const seated = run(generic, [mech(generic, board, "cpu-socket-plate:lever", "open"), mech(generic, board, "cpu-socket-plate", "open"),
      { type: "mount_part", instanceId: idOf(generic, CPU), target: { hostInstanceId: board, mountPointId: "cpu-socket" }, alignment: good },
      { type: "set_seating", instanceId: idOf(generic, CPU), seating: "seated" }]);
    expect(code(seated, cooler(seated, board, g))).toBe("ok");
    const basic = run(createBuild(pcCatalog), [{ type: "add_part", catalogId: TUF }, { type: "add_part", catalogId: CPU }, { type: "add_part", catalogId: F36 }]);
    const bb = idOf(basic, TUF);
    const basicSeated = run(basic, [{ type: "mount_part", instanceId: idOf(basic, CPU), target: { hostInstanceId: bb, mountPointId: "cpu-socket" } }, { type: "set_seating", instanceId: idOf(basic, CPU), seating: "seated" }]);
    expect(code(basicSeated, cooler(basicSeated, bb, idOf(basic, F36)))).toBe("ok");
    const h81 = build(["asus-h81m-k", "intel-core-i5-4590", F36]);
    expect(code(h81, cooler(h81, idOf(h81, "asus-h81m-k"), idOf(h81, F36)))).toBe("cooler_socket_unsupported");
  });
});
