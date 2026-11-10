import { describe, expect, it } from "vitest";
import type { InstalledPart, PCBuildState } from "@ytl/contracts";
import { clickBox, fastenerMarkers, settingHotspots } from "./controls3d";
import { IDENTITY, type PlacedPart } from "./placement";

const placedAt = (instanceId: string, at: [number, number, number], size: [number, number, number]): PlacedPart => ({
  instanceId,
  frame: { at, quat: IDENTITY },
  size,
  hostInstanceId: null,
  onBench: true,
  groupFrames: {},
});

const part = (instanceId: string, catalogId: string, attachments: InstalledPart["attachments"] = []): InstalledPart => ({ instanceId, catalogId, attachments });
const build = (parts: InstalledPart[]): PCBuildState => ({
  catalogVersion: "test",
  rgbPreference: "with_rgb",
  parts,
  cables: [],
  sidePanelOpen: true,
  power: { wallConnected: false, psuSwitchOn: false, pressed: false },
  nextSerial: 9,
});

describe("switches drawn in the 3D view", () => {
  it("puts the power button on top of the case, the panel on its open side and the PSU switch and socket on its outer face", () => {
    const state = build([part("case-1", "case"), part("psu-2", "psu")]);
    const placed = new Map([
      ["case-1", placedAt("case-1", [0, 0, 0], [450, 470, 220])],
      ["psu-2", placedAt("psu-2", [600, 0, 0], [150, 86, 160])],
    ]);
    const spots = settingHotspots(state, placed, (p) => p.catalogId);
    expect(spots.map((spot) => spot.name)).toEqual(["power-button", "side-panel", "psu-switch", "wall-power"]);
    const by = Object.fromEntries(spots.map((spot) => [spot.name, spot]));
    expect(by["power-button"]!.frame.at[1]).toBeGreaterThan(470);
    expect(by["side-panel"]!.frame.at[2]).toBeGreaterThan(220);
    expect(by["psu-switch"]!.frame.at[0]).toBeLessThan(600);
    expect(by["wall-power"]!.ownerId).toBe("psu-2");
    // The panel takes clicks only along its top edge, so it never covers the parts inside.
    const handle = clickBox(by["side-panel"]!);
    expect(handle.size[1]).toBe(24);
    expect(handle.frame.at[1]).toBeGreaterThan(by["side-panel"]!.frame.at[1]);
  });

  it("offers no switch for a part that is not in the build", () => {
    expect(settingHotspots(build([]), new Map(), (p) => p.catalogId)).toEqual([]);
  });
});

describe("fastener markers", () => {
  it("one per fastener of each mounted role, the first ones secured as the engine counts them", () => {
    const board = part("motherboard-2", "board", [{ role: "main", target: { hostInstanceId: "case-1", mountPointId: "tray" }, seating: "seated", fastenersSecured: 3 }]);
    const placed = new Map([["case-1", placedAt("case-1", [0, 0, 0], [450, 470, 220])]]);
    const markers = fastenerMarkers(board, placed, new Map(), () => "case", () => 9);
    expect(markers).toHaveLength(9);
    expect(markers.filter((m) => m.secured).map((m) => m.index)).toEqual([0, 1, 2]);
    // All at different places.
    expect(new Set(markers.map((m) => m.at.map(Math.round).join(","))).size).toBe(9);
  });

  it("none for a part on the bench or a position without fasteners", () => {
    const placed = new Map([["case-1", placedAt("case-1", [0, 0, 0], [450, 470, 220])]]);
    expect(fastenerMarkers(part("ram-4", "ram"), placed, new Map(), () => "case", () => 2)).toEqual([]);
    const seated = part("ram-4", "ram", [{ role: "main", target: { hostInstanceId: "case-1", mountPointId: "dimm" }, seating: "seated", fastenersSecured: 0 }]);
    expect(fastenerMarkers(seated, placed, new Map(), () => "case", () => 0)).toEqual([]);
  });
});
