import { describe, expect, it } from "vitest";
import type { InstalledPart } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "../catalog";
import type { PartGeometry } from "./geometry";
import { heldFrame, withMechanisms } from "./mechanisms";
import { add, placeParts, rotate } from "./placement";

// The scene draws the M.2 heatsinks, their screws, the pad film and the screw stand from the engine's
// mechanism states, so what is seen is always what the engine checks.
const geometryOf = (id: string) => pc.visual.partGeometry(pcCatalog.entries.find((e) => e.id === id)!, pcCatalog.version) as unknown as PartGeometry;
const board = (catalogId: string, mechanisms: Record<string, "open" | "closed">): InstalledPart => ({ instanceId: "motherboard-1", catalogId, attachments: [], mechanisms } as InstalledPart);
const solid = (g: PartGeometry | undefined, id: string) => g?.solids.find((s) => s.id === id);
const TUF = "asus-tuf-gaming-z790-plus-wifi";
const fitted = { "m2-hs-1": "closed", "m2-hs-1:screws": "closed", "m2-hs-1:film": "closed", "m2-hs-2": "closed", "m2-hs-2:screws": "closed", "m2-hs-2:film": "closed" } as const;

describe("M.2 heatsinks in the scene", () => {
  it("TUF: one heatsink over M.2_1, one over M.2_3 and M.2_4, none over M.2_2", () => {
    const g = withMechanisms(geometryOf(TUF), board(TUF, { ...fitted }));
    const hs1 = solid(g, "m2-hs-1")!;
    const hs2 = solid(g, "m2-hs-2")!;
    const slot = (id: string) => solid(g, id)!;
    const over = (hs: typeof hs1, id: string) => Math.abs(hs.at[0] - slot(id).at[0]) <= hs.size![0] / 2 && Math.abs(hs.at[2] - slot(id).at[2]) <= hs.size![2] / 2 && hs.at[1] > slot(id).at[1];
    expect([over(hs1, "m2-1"), over(hs1, "m2-2"), over(hs2, "m2-3"), over(hs2, "m2-4"), over(hs2, "m2-2")]).toEqual([true, false, true, true, false]);
    expect(["m2-hs-1-screw-0", "m2-hs-1-screw-1", "m2-hs-2-screw-0", "m2-hs-2-screw-1"].every((id) => solid(g, id))).toBe(true);
  });

  it("screws stand up when loosened; a lifted heatsink is no longer over its slot and shows its pad film until peeled", () => {
    const loose = withMechanisms(geometryOf(TUF), board(TUF, { ...fitted, "m2-hs-1:screws": "open" }));
    const tight = withMechanisms(geometryOf(TUF), board(TUF, { ...fitted }));
    expect(solid(loose, "m2-hs-1-screw-0")!.at[1]).toBeGreaterThan(solid(tight, "m2-hs-1-screw-0")!.at[1]);
    const lifted = withMechanisms(geometryOf(TUF), board(TUF, { ...fitted, "m2-hs-1:screws": "open", "m2-hs-1": "open" }));
    const slot = solid(lifted, "m2-1")!;
    const hs = solid(lifted, "m2-hs-1")!;
    expect(Math.abs(hs.at[2] - slot.at[2])).toBeGreaterThan(hs.size![2]);
    expect(solid(lifted, "m2-hs-1-film")).toBeDefined();
    const peeled = withMechanisms(geometryOf(TUF), board(TUF, { ...fitted, "m2-hs-1:screws": "open", "m2-hs-1": "open", "m2-hs-1:film": "open" }));
    expect(solid(peeled, "m2-hs-1-film")).toBeUndefined();
    expect(solid(tight, "m2-hs-1-film")).toBeUndefined(); // under a fitted heatsink, not seen
  });

  it("PRIME B760M-A WIFI: the screw stand appears when fitted, the screw when the drive is screwed down", () => {
    const id = "asus-prime-b760m-a-wifi";
    const base = { "m2-hs-1": "open", "m2-hs-1:screws": "open", "m2-hs-1:film": "closed", "m2-1-screw": "open", "m2-1-screw:stand": "open", "m2-2-screw": "open", "m2-2-screw:stand": "open" } as const;
    expect(solid(withMechanisms(geometryOf(id), board(id, { ...base })), "m2-1-stand")).toBeUndefined();
    const stand = withMechanisms(geometryOf(id), board(id, { ...base, "m2-1-screw:stand": "closed" }));
    expect(solid(stand, "m2-1-stand")).toBeDefined();
    expect(solid(stand, "m2-1-screw")).toBeUndefined();
    expect(solid(withMechanisms(geometryOf(id), board(id, { ...base, "m2-1-screw:stand": "closed", "m2-1-screw": "closed" })), "m2-1-screw")).toBeDefined();
  });
});

describe("an M.2 drive at an angle", () => {
  const geometry = new Map<string, PartGeometry>();
  for (const id of ["asus-tuf-gaming-z790-plus-wifi", "samsung-990-pro-1tb"]) geometry.set(id, geometryOf(id));
  const state = (seating: "placed" | "seated") => ({
    parts: [
      { instanceId: "motherboard-1", catalogId: "asus-tuf-gaming-z790-plus-wifi", attachments: [] },
      { instanceId: "storage-2", catalogId: "samsung-990-pro-1tb", attachments: [{ role: "main", target: { hostInstanceId: "motherboard-1", mountPointId: "m2-2" }, seating, fastenersSecured: 0 }] },
    ],
  }) as unknown as Parameters<typeof placeParts>[0]["state"];
  const tilt = (_host: string, mountPointId: string) => (mountPointId.startsWith("m2-") ? 25 : 0);
  const far = (seating: "placed" | "seated") => {
    const p = placeParts({ state: state(seating), geometry, fallbackSize: () => [10, 10, 10], placedTiltDeg: tilt }).get("storage-2")!;
    // The drive's far end (its own +x end) in the scene.
    return add(p.frame.at, rotate(p.frame.quat, [p.size[0], 0, 0]));
  };

  it("inserted but not pressed flat, it stands up from its connector at the insertion angle; pressed, it lies flat", () => {
    const up = far("placed");
    const flat = far("seated");
    expect(up[1] - flat[1]).toBeGreaterThan(20); // 80 mm long at 25°: its far end is about 34 mm up
  });

  it("held, it shows the tilt the learner chose", () => {
    const base = placeParts({ state: state("seated"), geometry, fallbackSize: () => [10, 10, 10] }).get("storage-2")!;
    const level = heldFrame(base, geometry.get("samsung-990-pro-1tb"), { rotationDeg: 0, offsetMm: [0, 0], liftMm: 8 });
    const tilted = heldFrame(base, geometry.get("samsung-990-pro-1tb"), { rotationDeg: 0, offsetMm: [0, 0], liftMm: 8, tiltDeg: 25 });
    const end = (p: typeof base) => add(p.frame.at, rotate(p.frame.quat, [p.size[0], 0, 0]))[1];
    expect(end(tilted) - end(level)).toBeGreaterThan(20);
  });
});
