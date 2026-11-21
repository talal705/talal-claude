import { describe, expect, it } from "vitest";
import type { PCAction, PCBuildState } from "@ytl/contracts";
import { pcCatalog } from "../../../../content/catalog";
import { applyAction, createBuild } from "./index";

// Detailed mechanics, an M.2 drive on a bare board (no case needed for the M.2 steps).
const run = (s: PCBuildState, actions: PCAction[]) => actions.reduce((st, a) => { const r = applyAction(st, a, pcCatalog); if (!r.ok) throw new Error(`${a.type} ${JSON.stringify(a)}: ${r.rejection.code}`); return r.state; }, s);
const code = (s: PCBuildState, a: PCAction) => { const r = applyAction(s, a, pcCatalog); return r.ok ? "ok" : r.rejection.code; };
const board = (boardId: string, drives = 1) => run(createBuild(pcCatalog), [
  { type: "set_mechanics", mode: "detailed" },
  { type: "add_part", catalogId: boardId },
  ...Array.from({ length: drives }, (): PCAction => ({ type: "add_part", catalogId: "samsung-990-pro-1tb" })),
]);
const B = "motherboard-1";
const mech = (mechanismId: string, state: "open" | "closed"): PCAction => ({ type: "set_mechanism", instanceId: B, mechanismId, state });
const at = (mountPointId: string) => ({ hostInstanceId: B, mountPointId });
/** `tiltDeg: null` sends no tilt at all. */
const insert = (instanceId: string, slot: string, tiltDeg: number | null = 25): PCAction => ({ type: "mount_part", instanceId, target: at(slot), alignment: { rotationDeg: 0, offsetMm: [0, 0], ...(tiltDeg === null ? {} : { tiltDeg }) } });
const flat = (instanceId: string): PCAction => ({ type: "set_seating", instanceId, seating: "seated" });
const drive = (s: PCBuildState, id = "storage-2") => s.parts.find((p) => p.instanceId === id)!.attachments[0];
const mechs = (s: PCBuildState) => s.parts.find((p) => p.instanceId === B)!.mechanisms ?? {};
const lift = (hs: string) => [mech(`${hs}:screws`, "open"), mech(hs, "open")];
const refit = (hs: string) => [mech(`${hs}:film`, "open"), mech(hs, "closed"), mech(`${hs}:screws`, "closed")];
const TUF = "asus-tuf-gaming-z790-plus-wifi";

describe("M.2 heatsink (TUF GAMING Z790-PLUS WIFI, manual E21279 pp. 2-7 to 2-12)", () => {
  it("a drive goes into M.2_1 only with its heatsink lifted off; the heatsink comes off only with its screws loosened", () => {
    let s = board(TUF);
    // The Q-Latch and the slot are under the heatsink: nothing there can be reached yet.
    expect(code(s, mech("m2-1-qlatch", "open"))).toBe("retention_blocked");
    expect(code(s, insert("storage-2", "m2-1"))).toBe("retention_blocked");
    expect(code(s, mech("m2-hs-1", "open"))).toBe("retention_blocked");
    s = run(s, [mech("m2-hs-1:screws", "open"), mech("m2-hs-1", "open")]);
    // Now only the Q-Latch is in the way.
    expect(code(s, insert("storage-2", "m2-1"))).toBe("retention_closed");
    s = run(s, [mech("m2-1-qlatch", "open"), insert("storage-2", "m2-1")]);
    expect(drive(s)).toMatchObject({ seating: "placed", fastenersSecured: 0 });
  });

  it("screws are tightened only on a fitted heatsink; a lifted one is refitted first", () => {
    const s = run(board(TUF), lift("m2-hs-1"));
    expect(code(s, mech("m2-hs-1:screws", "closed"))).toBe("retention_blocked");
  });

  it("the drive goes in at an angle, not flat; then it is pressed flat and the Q-Latch turned to hold it", () => {
    let s = run(board(TUF), [...lift("m2-hs-1"), mech("m2-1-qlatch", "open")]);
    expect(code(s, insert("storage-2", "m2-1", 0))).toBe("insert_angle_wrong");
    expect(code(s, insert("storage-2", "m2-1", null))).toBe("insert_angle_wrong");
    expect(code(s, insert("storage-2", "m2-1", 60))).toBe("insert_angle_wrong");
    s = run(s, [insert("storage-2", "m2-1", 25), flat("storage-2"), mech("m2-1-qlatch", "closed")]);
    expect(drive(s)).toMatchObject({ seating: "seated", fastenersSecured: 1 });
  });

  it("the heatsink is refitted only after its pad film is peeled and every slot under it is empty or secured", () => {
    let s = run(board(TUF), [...lift("m2-hs-1"), mech("m2-1-qlatch", "open"), insert("storage-2", "m2-1")]);
    expect(code(s, mech("m2-hs-1", "closed"))).toBe("retention_blocked"); // film still on
    s = run(s, [mech("m2-hs-1:film", "open")]);
    expect(code(s, mech("m2-hs-1", "closed"))).toBe("retention_blocked"); // drive not secured
    s = run(s, [flat("storage-2"), mech("m2-1-qlatch", "closed"), mech("m2-hs-1", "closed"), mech("m2-hs-1:screws", "closed")]);
    expect(mechs(s)).toMatchObject({ "m2-hs-1": "closed", "m2-hs-1:screws": "closed", "m2-hs-1:film": "open" });
    // A peeled film is not put back.
    expect(code(s, mech("m2-hs-1:film", "closed"))).toBe("invalid_action");
  });

  it("one heatsink over M.2_3 and M.2_4: refitting waits for both drives; each drive keeps its own state", () => {
    let s = run(board(TUF, 2), [...lift("m2-hs-2"), mech("m2-hs-2:film", "open"), mech("m2-3-qlatch", "open"), mech("m2-4-qlatch", "open"),
      insert("storage-2", "m2-3"), flat("storage-2"), mech("m2-3-qlatch", "closed"), insert("storage-3", "m2-4")]);
    expect(code(s, mech("m2-hs-2", "closed"))).toBe("retention_blocked");
    s = run(s, [flat("storage-3"), mech("m2-4-qlatch", "closed"), ...refit("m2-hs-2").slice(1)]);
    expect([drive(s, "storage-2"), drive(s, "storage-3")].map((a) => [a!.target.mountPointId, a!.fastenersSecured])).toEqual([["m2-3", 1], ["m2-4", 1]]);
  });

  it("removal: heatsink off, Q-Latch turned open (the drive rises), then it comes out; never with the heatsink on", () => {
    let s = run(board(TUF), [...lift("m2-hs-1"), mech("m2-1-qlatch", "open"), insert("storage-2", "m2-1"), flat("storage-2"), mech("m2-1-qlatch", "closed"), ...refit("m2-hs-1")]);
    expect(code(s, { type: "unmount_part", instanceId: "storage-2" })).toBe("retention_blocked");
    s = run(s, lift("m2-hs-1"));
    expect(code(s, { type: "unmount_part", instanceId: "storage-2" })).toBe("retention_closed");
    s = run(s, [mech("m2-1-qlatch", "open")]);
    expect(drive(s)).toMatchObject({ seating: "placed", fastenersSecured: 0 });
    s = run(s, [{ type: "unmount_part", instanceId: "storage-2" }]);
    expect(drive(s)).toBeUndefined();
  });

  it("M.2_2 has no heatsink: the Q-Latch is the only step before the drive goes in", () => {
    const s = run(board(TUF), [mech("m2-2-qlatch", "open"), insert("storage-2", "m2-2"), flat("storage-2"), mech("m2-2-qlatch", "closed")]);
    expect(drive(s)).toMatchObject({ seating: "seated", fastenersSecured: 1 });
  });
});

describe("M.2 screw stand (PRIME B760M-A WIFI, manual E21693 p. 1-14)", () => {
  const B760 = "asus-prime-b760m-a-wifi";
  it("needs the screw stand fitted first, and is held by one screw (there is no Q-Latch)", () => {
    let s = run(board(B760), lift("m2-hs-1"));
    expect(code(s, insert("storage-2", "m2-1"))).toBe("retention_blocked");
    expect(code(s, mech("m2-1-qlatch", "open"))).toBe("unknown_reference");
    s = run(s, [mech("m2-1-screw:stand", "closed"), insert("storage-2", "m2-1")]);
    expect(code(s, mech("m2-1-screw", "closed"))).toBe("retention_blocked"); // not pressed flat yet
    s = run(s, [flat("storage-2"), mech("m2-1-screw", "closed")]);
    expect(drive(s)).toMatchObject({ seating: "seated", fastenersSecured: 1 });
    expect(code(s, { type: "unmount_part", instanceId: "storage-2" })).toBe("retention_closed");
    s = run(s, [mech("m2-1-screw", "open")]);
    expect(drive(s)).toMatchObject({ seating: "placed", fastenersSecured: 0 });
  });

  it("M.2_2 is bare: stand, drive, screw", () => {
    const s = run(board(B760), [mech("m2-2-screw:stand", "closed"), insert("storage-2", "m2-2"), flat("storage-2"), mech("m2-2-screw", "closed")]);
    expect(drive(s)).toMatchObject({ seating: "seated", fastenersSecured: 1 });
  });
});
