import { describe, expect, it } from "vitest";
import type { InstalledPart } from "@ytl/contracts";
import { coolerHardwareDraw } from "./cooler-hardware";
import type { SocketLayout } from "./SocketMechanism";

const layout: SocketLayout = {
  kind: "lga", replaces: [], centre: [100, 2, 80], size: [40, 4, 40], leverPivot: [0, 0, 0], leverLength: 50, plateHinge: [0, 0, 0], mark: [0, 0, 0],
};
const board = (hardware?: Record<string, string>, prep?: Record<string, string>): InstalledPart =>
  ({ instanceId: "b", catalogId: "x", attachments: [], hardware, prep }) as unknown as InstalledPart;
const cooler = (hardware?: Record<string, string>, placed = true): InstalledPart =>
  ({ instanceId: "c", catalogId: "y", attachments: placed ? [{ role: "main", target: { hostInstanceId: "b", mountPointId: "s" }, seating: "seated", fastenersSecured: 0 }] : [], hardware }) as unknown as InstalledPart;

describe("what the scene draws of the cooler's hardware", () => {
  it("draws nothing extra for a board nobody has touched", () => {
    const d = coolerHardwareDraw(board(), undefined, layout);
    expect(d.ilmRemoved).toBe(false);
    expect(d.frame).toBeNull();
    expect(d.frameScrews).toEqual([]);
    expect(d.bodyScrews).toEqual([]);
    expect(d.ring).toBeNull();
    expect(d.backplate).toBeNull();
  });
  it("a removed socket frame leaves four empty screw holes at the corners, and no contact frame yet", () => {
    const d = coolerHardwareDraw(board({ ilm: "removed" }), undefined, layout);
    expect(d.ilmRemoved).toBe(true);
    expect(d.frame).toBeNull();
    expect(d.frameScrews.map((s) => s.state)).toEqual(["empty", "empty", "empty", "empty"]);
    const xs = new Set(d.frameScrews.map((s) => s.at[0]));
    expect(xs.size).toBe(2);
    expect(Math.min(...xs)).toBeLessThan(100);
    expect(Math.max(...xs)).toBeGreaterThan(100);
  });
  it("frame screws follow the engine's characters one by one: empty, engaged, tight", () => {
    const d = coolerHardwareDraw(board({ ilm: "removed", frame: "placed", frame_screws: "2102" }), undefined, layout);
    expect(d.frame).not.toBeNull();
    expect(d.frameScrews.map((s) => s.state)).toEqual(["tight", "engaged", "empty", "tight"]);
    // an engaged screw stands taller than a tight one
    expect(d.frameScrews[1]!.at[1]).toBeGreaterThan(d.frameScrews[0]!.at[1]);
  });
  it("screw 0 and screw 2 are opposite corners (the cross pattern the controls name)", () => {
    const d = coolerHardwareDraw(board({ ilm: "removed", frame: "placed", frame_screws: "0000" }), undefined, layout);
    const [a, , c] = d.frameScrews;
    expect(a!.at[0] + c!.at[0]).toBeCloseTo(200);
    expect(a!.at[2] + c!.at[2]).toBeCloseTo(160);
  });
  it("body screws appear only once the cooler is placed, with their own states", () => {
    expect(coolerHardwareDraw(board({ ilm: "removed", frame: "placed" }), cooler({ screws: "00" }, false), layout).bodyScrews).toEqual([]);
    const d = coolerHardwareDraw(board({ ilm: "removed", frame: "placed" }), cooler({ screws: "12" }), layout);
    expect(d.bodyScrews.map((s) => s.state)).toEqual(["engaged", "tight"]);
  });
  it("a placed cooler on the contact frame shows its two screw holes before the first screw is turned", () => {
    const d = coolerHardwareDraw(board({ ilm: "removed", frame: "placed", frame_screws: "2222" }), cooler(undefined), layout);
    expect(d.bodyScrews.map((s) => s.state)).toEqual(["empty", "empty"]);
  });
  it("a retention ring and its pins show their placed and pushed-in states, and no contact frame", () => {
    const d = coolerHardwareDraw(board(), cooler({ position: "1200", ring: "placed", pins: "1100" }, false), layout);
    expect(d.ring).not.toBeNull();
    expect(d.frame).toBeNull();
    expect(d.pins.map((p) => p.state)).toEqual(["tight", "tight", "empty", "empty"]);
  });
  it("the backplate shows the support chosen, and is gone when there is none", () => {
    expect(coolerHardwareDraw(board({}, { backplate: "padding" }), undefined, layout).backplate?.kind).toBe("padding");
    expect(coolerHardwareDraw(board({}, { backplate: "tape" }), undefined, layout).backplate?.kind).toBe("tape");
  });
  it("a cooler that was lifted off leaves its screws and ring out of the picture", () => {
    const d = coolerHardwareDraw(board({ ilm: "removed", frame: "placed", frame_screws: "2222" }), cooler({ screws: "00" }, false), layout);
    expect(d.bodyScrews).toEqual([]);
    expect(d.ring).toBeNull();
  });
});
