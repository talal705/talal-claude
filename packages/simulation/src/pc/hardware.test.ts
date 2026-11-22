import { describe, expect, it } from "vitest";
import type { PCAction, PCBuildState } from "@ytl/contracts";
import { pcCatalog } from "../../../../content/catalog";
import { applyAction, createBuild } from "./index";
import { B, codes, preset, start } from "./test-helpers";

// Engine level: the socket hardware of ARCTIC's contact-frame mounting (manuals for Freezer 36 and Liquid
// Freezer III): the board's backplate is supported, the ILM comes off, the contact frame holds the CPU.
const run = (s: PCBuildState, actions: PCAction[]) => actions.reduce((st, a) => { const r = applyAction(st, a, pcCatalog); if (!r.ok) throw new Error(`${a.type} ${JSON.stringify(a)}: ${r.rejection.code}`); return r.state; }, s);
const code = (s: PCBuildState, a: PCAction) => { const r = applyAction(s, a, pcCatalog); return r.ok ? "ok" : r.rejection.code; };
const idOf = (s: PCBuildState, catalogId: string) => s.parts.find((p) => p.catalogId === catalogId)!.instanceId;
const BOARD = "asus-tuf-gaming-z790-plus-wifi";
const CPU = "intel-core-i5-14600k";
const COOLER = "arctic-freezer-36";
const good = { rotationDeg: 0, offsetMm: [0, 0] as [number, number] };

const bare = (extra: string[] = [], mechanics: "detailed" | "basic" = "detailed") =>
  run(createBuild(pcCatalog), [{ type: "set_mechanics", mode: mechanics }, ...[BOARD, CPU, COOLER, ...extra].map((catalogId): PCAction => ({ type: "add_part", catalogId }))]);
const board = (s: PCBuildState) => idOf(s, BOARD);
const mech = (s: PCBuildState, mechanismId: string, state: "open" | "closed"): PCAction => ({ type: "set_mechanism", instanceId: board(s), mechanismId, state });
const hw = (s: PCBuildState, key: string, value: string, who = board(s)): PCAction => ({ type: "set_hardware", instanceId: who, key, value });
const backplate = (s: PCBuildState, value: string): PCAction => ({ type: "set_prep", instanceId: board(s), prep: "backplate", value });
const hardware = (s: PCBuildState, key: string) => s.parts.find((p) => p.instanceId === board(s))!.hardware?.[key];
const cpuAttachment = (s: PCBuildState) => s.parts.find((p) => p.catalogId === CPU)!.attachments[0];

/** The CPU placed with the ILM open (lever up, plate open): the first half of the manual's motherboard preparation. */
const cpuIn = (s: PCBuildState) => run(s, [
  mech(s, "cpu-socket-plate:lever", "open"), mech(s, "cpu-socket-plate", "open"),
  { type: "mount_part", instanceId: idOf(s, CPU), target: { hostInstanceId: board(s), mountPointId: "cpu-socket" }, alignment: good },
  { type: "set_seating", instanceId: idOf(s, CPU), seating: "seated" },
]);
/** Backplate supported (board on the bench), ILM taken off: ready for the frame. */
const ilmOff = (s: PCBuildState) => run(s, [backplate(s, "padding"), hw(s, "ilm", "removed")]);
const frameOn = (s: PCBuildState) => run(s, [hw(s, "frame", "placed")]);
const screws = (s: PCBuildState, value: string) => hw(s, "frame_screws", value);

/** The board in the case, so the backplate can only be taped. */
const inCase = (s: PCBuildState) => {
  let t = run(s, [{ type: "add_part", catalogId: "corsair-4000d-airflow-black" }, { type: "set_prep", instanceId: board(s), prep: "standoffs", value: "checked" }]);
  const caseId = idOf(t, "corsair-4000d-airflow-black");
  const mount: PCAction = { type: "mount_part", instanceId: board(t), target: { hostInstanceId: caseId, mountPointId: "motherboard-tray" } };
  if (code(t, mount) === "prep_missing") t = run(t, [{ type: "set_prep", instanceId: board(t), prep: "io_shield", value: "fitted" }]);
  return run(t, [mount]);
};

describe("the socket backplate (kept, and supported or taped)", () => {
  it("padding is for a board outside the case, painter's tape for one in the case", () => {
    const outside = bare();
    expect(code(outside, backplate(outside, "tape"))).toBe("prep_wrong");
    expect(code(outside, backplate(outside, "padding"))).toBe("ok");
    const inside = inCase(bare());
    expect(code(inside, backplate(inside, "padding"))).toBe("prep_wrong");
    expect(code(inside, backplate(inside, "tape"))).toBe("ok");
  });

  it("stays supported while the ILM is off and the frame is not tight; may come off once the frame is tight", () => {
    let s = frameOn(ilmOff(cpuIn(bare())));
    expect(code(s, backplate(s, ""))).toBe("retention_blocked");
    s = run(s, [screws(s, "1000"), screws(s, "1100"), screws(s, "1110"), screws(s, "1111"), screws(s, "2111"), screws(s, "2121"), screws(s, "2221"), screws(s, "2222")]);
    expect(code(s, backplate(s, ""))).toBe("ok");
  });
});

describe("taking the ILM off (T20 driver from the cooler's kit)", () => {
  it("needs the backplate supported, the lever up, the plate open, and a contact-frame cooler in the build", () => {
    const s = cpuIn(bare());
    expect(code(s, hw(s, "ilm", "removed"))).toBe("mounting_missing"); // no backplate support yet
    const supported = run(s, [backplate(s, "padding")]);
    expect(code(supported, hw(supported, "ilm", "removed"))).toBe("ok");
    const closed = run(bare(), [backplate(bare(), "padding")]);
    expect(code(closed, hw(closed, "ilm", "removed"))).toBe("retention_blocked"); // lever down, plate closed
    const noKit = run(createBuild(pcCatalog), [{ type: "set_mechanics", mode: "detailed" }, { type: "add_part", catalogId: BOARD }, { type: "add_part", catalogId: CPU }]);
    const noKitOpen = run(noKit, [mech(noKit, "cpu-socket-plate:lever", "open"), mech(noKit, "cpu-socket-plate", "open"), backplate(noKit, "padding")]);
    expect(code(noKitOpen, hw(noKitOpen, "ilm", "removed"))).toBe("mounting_missing"); // nothing here has a contact frame
  });

  it("with the ILM off the plate and lever cannot be moved: the frame holds the CPU", () => {
    const s = ilmOff(cpuIn(bare()));
    expect(hardware(s, "ilm")).toBe("removed");
    expect(code(s, mech(s, "cpu-socket-plate", "closed"))).toBe("retention_blocked");
    expect(code(s, mech(s, "cpu-socket-plate:lever", "closed"))).toBe("retention_blocked");
  });

  it("the ILM goes back only when no frame is on", () => {
    const s = frameOn(ilmOff(cpuIn(bare())));
    expect(code(s, hw(s, "ilm", ""))).toBe("retention_blocked");
    const off = run(s, [hw(s, "frame", "")]);
    expect(code(off, hw(off, "ilm", ""))).toBe("ok");
  });
});

describe("the CPU Contact Frame", () => {
  it("needs the ILM off, the CPU seated, and a contact-frame cooler in the build", () => {
    const withCpu = cpuIn(bare());
    expect(code(withCpu, hw(withCpu, "frame", "placed"))).toBe("mounting_missing"); // the ILM is still on
    const b = bare();
    const noCpu = run(b, [backplate(b, "padding"), mech(b, "cpu-socket-plate:lever", "open"), mech(b, "cpu-socket-plate", "open"), hw(b, "ilm", "removed")]);
    expect(code(noCpu, hw(noCpu, "frame", "placed"))).toBe("mounting_missing"); // no CPU in the socket yet
    const ready = ilmOff(cpuIn(bare()));
    expect(code(ready, hw(ready, "frame", "placed"))).toBe("ok");
    const noKit = run(ready, [{ type: "remove_part", instanceId: idOf(ready, COOLER) }]);
    expect(code(noKit, hw(noKit, "frame", "placed"))).toBe("mounting_missing"); // the frame comes in the cooler's box
  });

  it("four screws: all engaged a couple of turns before any is tightened; then tightened in a cross pattern", () => {
    const s = frameOn(ilmOff(cpuIn(bare())));
    expect(hardware(s, "frame_screws")).toBe("0000");
    expect(code(s, screws(s, "2000"))).toBe("hardware_order_wrong"); // out → tight in one go
    expect(code(s, screws(s, "1100"))).toBe("hardware_order_wrong"); // two characters at once
    const engaged = run(s, [screws(s, "0100"), screws(s, "0110"), screws(s, "1110")]);
    expect(code(engaged, screws(engaged, "2110"))).toBe("hardware_order_wrong"); // the fourth is not engaged yet
    const all = run(engaged, [screws(engaged, "1111")]);
    expect(code(all, screws(all, "2111"))).toBe("ok");
    const first = run(all, [screws(all, "2111")]);
    expect(code(first, screws(first, "2211"))).toBe("hardware_order_wrong"); // next to it, not across
    expect(code(first, screws(first, "2121"))).toBe("ok"); // across
    const third = run(first, [screws(first, "2121"), screws(first, "2221")]);
    expect(code(third, screws(third, "2222"))).toBe("ok");
  });

  it("tight on all four screws the frame holds the CPU: it counts as retained; one screw loosened and it does not", () => {
    let s = frameOn(ilmOff(cpuIn(bare())));
    expect(cpuAttachment(s)).toMatchObject({ seating: "seated", fastenersSecured: 0 });
    s = run(s, [screws(s, "1000"), screws(s, "1100"), screws(s, "1110"), screws(s, "1111"), screws(s, "2111"), screws(s, "2121"), screws(s, "2221")]);
    expect(cpuAttachment(s).fastenersSecured).toBe(0);
    s = run(s, [screws(s, "2222")]);
    expect(cpuAttachment(s)).toMatchObject({ seating: "seated", fastenersSecured: 1 });
    s = run(s, [screws(s, "2122")]);
    expect(cpuAttachment(s).fastenersSecured).toBe(0);
  });

  it("is taken off screw by screw (the cross pattern in reverse), and only with no screw left in", () => {
    let s = frameOn(ilmOff(cpuIn(bare())));
    s = run(s, [screws(s, "1000"), screws(s, "1100"), screws(s, "1110"), screws(s, "1111"), screws(s, "2111"), screws(s, "2121"), screws(s, "2221"), screws(s, "2222")]);
    expect(code(s, hw(s, "frame", ""))).toBe("retention_blocked"); // screws still in
    const one = run(s, [screws(s, "2122")]); // any first
    expect(code(one, screws(one, "1122"))).toBe("hardware_order_wrong"); // beside it, not across
    expect(code(one, screws(one, "2112"))).toBe("hardware_order_wrong");
    expect(code(one, screws(one, "2022"))).toBe("hardware_order_wrong"); // cannot back a tight screw out in one go
    expect(code(one, screws(one, "2128"))).toBe("invalid_action"); // not a screw state
    const two = run(one, [screws(one, "2121")]); // across
    const out = run(two, [screws(two, "1121"), screws(two, "1111"), screws(two, "0111"), screws(two, "0101"), screws(two, "0100"), screws(two, "0000")]);
    expect(code(out, hw(out, "frame", ""))).toBe("ok");
  });

  it("the CPU cannot be lifted out from under the frame", () => {
    const s = frameOn(ilmOff(cpuIn(bare())));
    expect(code(s, { type: "unmount_part", instanceId: idOf(s, CPU) })).toBe("retention_blocked");
  });
});

describe("basic builds", () => {
  it("do not use socket hardware: nothing changes there", () => {
    const s = bare([], "basic");
    expect(code(s, hw(s, "ilm", "removed"))).toBe("invalid_action");
    expect(s.parts.find((p) => p.instanceId === board(s))!.hardware).toBeUndefined();
  });
});

describe("startup with the ILM off", () => {
  /** The complete air-cooled starter, in detailed mode, with its cooler lifted and its ILM taken off. */
  const readyForFrame = () => {
    let s = run(preset("i5-ddr4-air"), [{ type: "set_mechanics", mode: "detailed" }, { type: "unmount_part", instanceId: B.cooler }]);
    s = run(s, [
      { type: "set_mechanism", instanceId: B.mb, mechanismId: "cpu-socket-plate:lever", state: "open" },
      { type: "set_mechanism", instanceId: B.mb, mechanismId: "cpu-socket-plate", state: "open" },
      { type: "set_prep", instanceId: B.mb, prep: "backplate", value: "tape" }, // the board is in the case
      { type: "set_hardware", instanceId: B.mb, key: "ilm", value: "removed" },
      { type: "set_hardware", instanceId: B.mb, key: "frame", value: "placed" },
    ]);
    return s;
  };
  const tighten = (s: PCBuildState) => run(s, ["1000", "1100", "1110", "1111", "2111", "2121", "2221", "2222"].map((value): PCAction => ({ type: "set_hardware", instanceId: B.mb, key: "frame_screws", value })));

  it("a loose frame stops POST with its own explanation, not 'the lever is not locked'", () => {
    const r = start(readyForFrame());
    expect(r.outcome).toBe("no_post");
    expect(codes(r)).toEqual(["cpu_frame_loose"]);
  });

  it("with the frame tight on all four screws the CPU check passes", () => {
    expect(codes(start(tighten(readyForFrame())))).not.toContain("cpu_frame_loose");
    expect(codes(start(tighten(readyForFrame())))).not.toContain("cpu_lever_open");
  });
});
