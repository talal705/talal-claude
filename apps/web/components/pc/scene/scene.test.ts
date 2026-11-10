import { describe, expect, it } from "vitest";
import type { InstalledPart, PCBuildState } from "@ytl/contracts";
import { parseGeometry, type PartGeometry, type Quat, type Vec3 } from "./geometry";
import { IDENTITY, LOOSE_CABLE_STRIP, boxCorners, compose, inverse, multiply, placeCableEnds, placeParts, rotate, workbenchArea } from "./placement";

const close = (a: readonly number[], b: readonly number[]) => a.forEach((value, index) => expect(value).toBeCloseTo(b[index], 6));
/** 90 degrees about +y: +x turns to -z. */
const QUARTER_Y: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

function geometry(catalogId: string, size: Vec3, extra: Partial<PartGeometry> = {}): PartGeometry {
  return {
    schema: 2,
    catalogId,
    catalogVersion: "test",
    units: "mm",
    bounds: { size, basis: { x: "catalog", y: "catalog", z: "catalog" } },
    solids: [{ id: "body", shape: "box", at: [size[0] / 2, size[1] / 2, size[2] / 2], size, role: "pcb", basis: "schematic" }],
    attach: { main: { at: [0, 0, 0], quat: IDENTITY } },
    mounts: {},
    ports: {},
    leads: {},
    zones: {},
    lights: [],
    label: { en: "Educational model", ar: "نموذج تعليمي" },
    ...extra,
  };
}

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

describe("frame arithmetic", () => {
  it("rotates and composes like rigid transforms", () => {
    close(rotate(QUARTER_Y, [1, 0, 0]), [0, 0, -1]);
    close(multiply(QUARTER_Y, QUARTER_Y), [0, 1, 0, 0]);
    const frame = { at: [10, 20, 30] as Vec3, quat: QUARTER_Y };
    const there = compose(frame, { at: [5, 0, 0], quat: IDENTITY });
    close(there.at, [10, 20, 25]);
    const back = compose(frame, inverse(frame));
    close(back.at, [0, 0, 0]);
    close(back.quat, IDENTITY);
  });
});

describe("placeParts", () => {
  const board = geometry("board", [300, 10, 240], {
    mounts: { slot: { at: [100, 10, 50], quat: QUARTER_Y, insert: [0, -1, 0], travelMm: 20, solid: "body" } },
  });
  const card = geometry("card", [130, 30, 4], { attach: { main: { at: [10, 0, 2], quat: IDENTITY } } });
  const geometries = new Map([
    ["board", board],
    ["card", card],
  ]);
  const input = (state: PCBuildState) => ({ state, geometry: geometries, fallbackSize: () => [50, 50, 50] as Vec3 });
  const mounted = (seating: "placed" | "partial" | "seated") =>
    build([part("board-1", "board"), part("card-2", "card", [{ role: "main", target: { hostInstanceId: "board-1", mountPointId: "slot" }, seating, fastenersSecured: 0 }])]);

  it("lays unmounted parts out in a row, in build order, without overlap", () => {
    const placed = placeParts(input(build([part("board-1", "board"), part("card-2", "card"), part("mystery-3", "no-geometry")])));
    expect([...placed.values()].map((item) => item.frame.at[0])).toEqual([0, 360, 550]);
    expect(placed.get("mystery-3")).toMatchObject({ size: [50, 50, 50], onBench: true, hostInstanceId: null });
  });

  it("stands the case first and lays the other parts on the workbench in rows that wrap, inside the bench area", () => {
    const state = build([part("board-1", "board"), part("case-2", "no-geometry"), part("card-3", "card"), part("board-4", "board")]);
    const placed = placeParts({ ...input(state), standsFirst: (item) => item.instanceId.startsWith("case"), benchRowMm: 700 });
    expect(placed.get("case-2")!.frame.at).toEqual([0, 0, 0]);
    // The rows start after the case (50 mm wide + 60 mm gap).
    expect(placed.get("board-1")!.frame.at).toEqual([110, 0, 0]);
    expect(placed.get("card-3")!.frame.at).toEqual([470, 0, 0]);
    // 300 mm more would pass the 700 mm row: the second board starts the next row, in front.
    expect(placed.get("board-4")!.frame.at).toEqual([110, 0, 240 + 60]);
    const area = workbenchArea(placed)!;
    expect(area.min).toEqual([-80, -80]);
    expect(area.max).toEqual([470 + 130 + 80, 300 + 240 + 80]);
    expect([...placed.values()].every((item) => item.onBench)).toBe(true);
  });

  it("stands aside parts in a row of their own, behind the build", () => {
    const state = build([part("board-1", "board"), part("monitor-2", "no-geometry"), part("card-3", "card")]);
    const placed = placeParts({ ...input(state), isAside: (item) => item.instanceId.startsWith("monitor") });
    expect(placed.get("board-1")!.frame.at).toEqual([0, 0, 0]);
    expect(placed.get("card-3")!.frame.at).toEqual([360, 0, 0]);
    expect(placed.get("monitor-2")!.frame.at).toEqual([0, 0, -750]);
  });

  it("seats a part so its attach point meets the mount, turned as the mount is", () => {
    const placed = placeParts(input(mounted("seated")));
    const item = placed.get("card-2")!;
    expect(item).toMatchObject({ hostInstanceId: "board-1", onBench: false });
    // The card's attach point (10, 0, 2) must land exactly on the mount (100, 10, 50) of the board at the origin.
    close(compose(item.frame, { at: [10, 0, 2], quat: IDENTITY }).at, [100, 10, 50]);
    close(item.frame.quat, QUARTER_Y);
  });

  it("holds a placed part back by the mount's travel, and a partly seated one by half", () => {
    const y = (seating: "placed" | "partial" | "seated") => compose(placeParts(input(mounted(seating))).get("card-2")!.frame, { at: [10, 0, 2], quat: IDENTITY }).at[1];
    expect(y("seated")).toBeCloseTo(10);
    expect(y("partial")).toBeCloseTo(20);
    expect(y("placed")).toBeCloseTo(30);
  });

  it("moves a mounted part with its host", () => {
    const state = build([part("spare-0", "card"), ...mounted("seated").parts]);
    const placed = placeParts(input(state));
    const boardX = placed.get("board-1")!.frame.at[0];
    expect(boardX).toBe(190);
    close(compose(placed.get("card-2")!.frame, { at: [10, 0, 2], quat: IDENTITY }).at, [boardX + 100, 10, 50]);
  });

  it("stands a part on its host's box when the joint has no geometry", () => {
    const state = build([part("case-1", "no-geometry"), part("board-2", "board", [{ role: "main", target: { hostInstanceId: "case-1", mountPointId: "tray" }, seating: "seated", fastenersSecured: 0 }])]);
    const placed = placeParts(input(state));
    expect(placed.get("board-2")).toMatchObject({ hostInstanceId: "case-1", onBench: false });
    close(placed.get("board-2")!.frame.at, [0, 50, 0]);
  });

  it("places each body of a two-part cooler on its own host", () => {
    const cooler = geometry("cooler", [200, 40, 60], {
      solids: [
        { id: "block", shape: "box", at: [20, 10, 20], size: [40, 20, 40], role: "body", basis: "schematic", group: "block" },
        { id: "radiator", shape: "box", at: [140, 10, 30], size: [120, 20, 60], role: "radiator", basis: "schematic", group: "radiator" },
      ],
      attach: { block: { at: [20, 0, 20], quat: IDENTITY }, radiator: { at: [80, 0, 0], quat: IDENTITY } },
    });
    const host = geometry("board", [300, 10, 240], {
      mounts: {
        socket: { at: [100, 10, 50], quat: IDENTITY, insert: [0, -1, 0], travelMm: 10, solid: "body" },
        top: { at: [10, 10, 200], quat: IDENTITY, insert: [0, -1, 0], travelMm: 10, solid: "body" },
      },
    });
    const state = build([
      part("board-1", "board"),
      part("cooling-2", "cooler", [
        { role: "block", target: { hostInstanceId: "board-1", mountPointId: "socket" }, seating: "seated", fastenersSecured: 0 },
        { role: "radiator", target: { hostInstanceId: "board-1", mountPointId: "top" }, seating: "seated", fastenersSecured: 0 },
      ]),
    ]);
    const placed = placeParts({ state, geometry: new Map([["board", host], ["cooler", cooler]]), fallbackSize: () => [1, 1, 1] }).get("cooling-2")!;
    close(compose(placed.groupFrames.block, { at: [20, 0, 20], quat: IDENTITY }).at, [100, 10, 50]);
    close(compose(placed.groupFrames.radiator, { at: [80, 0, 0], quat: IDENTITY }).at, [10, 10, 200]);
  });

  it("puts plugged cable ends at their ports, loose captive ends near their part, and loose free ends on the strip", () => {
    const card = geometry("card", [130, 30, 4], {
      ports: { power: { at: [100, 30, 2], facing: [0, 1, 0], solid: "body" } },
      leads: { lead: { at: [5, 5, 0] } },
    });
    const state: PCBuildState = {
      ...build([part("card-1", "card")]),
      cables: [
        { id: "card-1.lead", catalogId: "card", cableSpecId: "lead", ownerInstanceId: "card-1", ends: { plug: null }, tidied: false },
        { id: "cable-2", catalogId: "x", cableSpecId: "y", ownerInstanceId: null, ends: { a: { kind: "part", instanceId: "card-1", portId: "power" }, b: null }, tidied: false },
        { id: "cable-3", catalogId: "x", cableSpecId: "y", ownerInstanceId: null, ends: { a: { kind: "cable", cableId: "cable-2", endId: "a" }, b: null }, tidied: false },
      ],
    };
    const geometries = new Map([["card", card]]);
    const placed = placeParts({ state, geometry: geometries, fallbackSize: () => [1, 1, 1] });
    const ends = placeCableEnds(state, placed, geometries);
    expect(ends.get("cable-2/a")).toEqual({ at: [100, 30, 2], plugged: true });
    expect(ends.get("cable-3/a")).toEqual({ at: [100, 30, 2], plugged: true });
    // The card lies on the workbench, so its loose lead lies on the bench top in front of it.
    expect(ends.get("card-1.lead/plug")).toEqual({ at: [5, 8, 4 + 30], plugged: false });
    expect(ends.get("cable-2/b")).toEqual({ at: [LOOSE_CABLE_STRIP[0], 10, 70 + 160], plugged: false });
  });

  it("keeps low mounted PSU cable heads above the mat without moving their source or connected ports", () => {
    const caseModel = geometry("case", [453, 466, 230], {
      mounts: { psu: { at: [6, 16, 36.2], quat: IDENTITY, insert: [-1, 0, 0], travelMm: 60, solid: "body" } },
    });
    const psu = geometry("psu", [125, 86, 150], {
      leads: { atx: { at: [0, 43, 51] }, eps: { at: [0, 43, 63] }, pcie: { at: [0, 43, 75] } },
      ports: { test: { at: [3, 2, 1], facing: [0, 1, 0], solid: "body" } },
    });
    const state: PCBuildState = {
      ...build([part("case-1", "case"), part("psu-2", "psu", [{ role: "main", target: { hostInstanceId: "case-1", mountPointId: "psu" }, seating: "seated", fastenersSecured: 4 }])]),
      cables: [
        ...["atx", "eps", "pcie"].map((id) => ({ id: `psu-2.${id}`, catalogId: "psu", cableSpecId: id, ownerInstanceId: "psu-2", ends: { plug: null }, tidied: false })),
        { id: "connected", catalogId: "psu", cableSpecId: "test", ownerInstanceId: null, ends: { plug: { kind: "part" as const, instanceId: "psu-2", portId: "test" } }, tidied: false },
      ],
    };
    const geometries = new Map([["case", caseModel], ["psu", psu]]);
    const placed = placeParts({ state, geometry: geometries, fallbackSize: () => [1, 1, 1], standsFirst: (item) => item.catalogId === "case" });
    const source = compose(placed.get("psu-2")!.frame, { at: psu.leads.atx.at, quat: IDENTITY }).at;
    close(source, [6, 59, 87.2]);
    const ends = placeCableEnds(state, placed, geometries);
    for (const id of ["atx", "eps", "pcie"]) {
      const end = ends.get(`psu-2.${id}/plug`)!;
      expect(end.plugged).toBe(false);
      expect(end.at[1]).toBe(8);
    }
    close(ends.get("psu-2.atx/plug")!.at, [6, 8, 117.2]);
    expect(ends.get("connected/plug")).toEqual({ at: [9, 18, 37.2], plugged: true });
    close(compose(placed.get("psu-2")!.frame, { at: psu.leads.atx.at, quat: IDENTITY }).at, source);
  });

  it("gives the corners of a turned box", () => {
    const corners = boxCorners({ at: [0, 0, 0], quat: QUARTER_Y }, [0, 0, 0], [2, 1, 0]);
    expect(corners).toHaveLength(8);
    close(corners[7], [0, 1, -2]);
  });
});

describe("parseGeometry", () => {
  const good = geometry("card", [130, 30, 4], {
    solids: [
      { id: "body", shape: "box", at: [65, 15, 2], size: [130, 30, 4], role: "pcb", basis: "schematic" },
      { id: "fan", shape: "cylinder", at: [40, 15, 4], radius: 12, height: 3, axis: "z", role: "fan", basis: "schematic" },
      { id: "future", shape: "extrusion", at: [0, 0, 0], role: "fin", basis: "schematic" },
    ],
    ports: { power: { at: [100, 30, 2], facing: [0, 1, 0], solid: "body" } },
    zones: { cooler: { solids: ["fan"] } },
    lights: [{ zone: "cooler", solids: ["fan"] }],
  });
  const problem = (raw: unknown) => {
    const parsed = parseGeometry(raw, "card");
    return parsed.ok ? null : parsed.problem;
  };

  it("accepts a well-formed file, including a shape it does not know how to draw", () => {
    expect(problem(JSON.parse(JSON.stringify(good)))).toBeNull();
  });

  it("refuses the wrong part, schema, sizes and references to solids that do not exist", () => {
    expect(problem(null)).toBe("not_object");
    expect(problem({ ...good, schema: 1 })).toBe("unsupported_schema");
    expect(parseGeometry(good, "another-part")).toMatchObject({ ok: false, problem: "wrong_part" });
    expect(problem({ ...good, bounds: { size: [130, 0, 4] } })).toBe("bad_bounds");
    expect(problem({ ...good, solids: [{ ...good.solids[0], size: [1, -1, 1] }] })).toBe("bad_solid");
    expect(problem({ ...good, solids: [good.solids[0], good.solids[0]] })).toBe("bad_solid");
    expect(problem({ ...good, solids: [{ ...good.solids[1], axis: "w" }] })).toBe("bad_solid");
    expect(problem({ ...good, solids: [{ ...good.solids[0], at: [0, NaN, 0] }] })).toBe("bad_solid");
    expect(problem({ ...good, ports: { power: { at: [0, 0, 0], facing: [0, 1, 0], solid: "ghost" } } })).toBe("dangling_reference");
    expect(problem({ ...good, zones: { cooler: { solids: ["ghost"] } } })).toBe("dangling_reference");
    expect(problem({ ...good, lights: [{ zone: "cooler", solids: ["ghost"] }] })).toBe("dangling_reference");
    expect(problem({ ...good, mounts: { slot: { at: [0, 0, 0], quat: [0, 0, 0, 1], insert: [0, -1, 0], travelMm: 5, solid: "ghost" } } })).toBe("dangling_reference");
    expect(problem({ ...good, mounts: { slot: { at: [0, 0, 0], quat: [0, 0, 0, 1], solid: "body" } } })).toBe("bad_frame");
  });
});

describe("generated geometry files", () => {
  it("every file listed in the manifest parses for its part", async () => {
    const { readFileSync } = await import("node:fs");
    const root = new URL("../../../../../assets/", import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("pc/manifest.json", root), "utf8")) as { assets: { catalogId: string; geometry: string }[] };
    expect(manifest.assets.length).toBeGreaterThan(0);
    for (const asset of manifest.assets) {
      const parsed = parseGeometry(JSON.parse(readFileSync(new URL(asset.geometry, root), "utf8")), asset.catalogId);
      expect(parsed.ok ? null : `${asset.catalogId}: ${parsed.problem} ${parsed.detail ?? ""}`).toBeNull();
    }
  });
});
