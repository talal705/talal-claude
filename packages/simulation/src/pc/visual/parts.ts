// Schematic geometry for every category except the motherboard and the graphics card.
// Outer sizes and counts come from the catalog (see dims.ts); positions inside a part are schematic.
import type { CableEntry, CaseEntry, CatalogEntry, CoolingEntry, CpuEntry, FanEntry, MonitorEntry, PsuEntry, RamEntry, StorageEntry } from "@ytl/contracts";
import { Builder, IDENTITY, TURN_Y, printedLabel, r1 } from "./build";
import { catalogAxes } from "./dims";
import { EDUCATIONAL_LABEL, GEOMETRY_SCHEMA, type Basis, type Frame, type PartGeometry, type Quat, type Vec3 } from "./types";

const S = Math.SQRT1_2;
/** Quarter turn about +x: a child's +y points along the host's +z, its +z along the host's -y (a board standing on a tray). */
const STAND_UP: Quat = [S, 0, 0, S];
/** Quarter turn about -x: a child's +z points along the host's +y (a fan blowing upward). */
const FACE_UP: Quat = [-S, 0, 0, S];

interface Extras {
  attach?: Record<string, Frame>;
  leads?: Record<string, { at: Vec3 }>;
  zones?: Record<string, string[]>;
  lights?: { zone: string; solids: string[] }[];
}

/** Assembles the result; an axis is `catalog` exactly when the catalog has that dimension. */
function finish(entry: CatalogEntry, catalogVersion: string, b: Builder, size: Vec3, x: Extras): PartGeometry {
  const axes = catalogAxes(entry);
  const basis = (a: "x" | "y" | "z"): Basis => (axes[a] !== undefined ? "catalog" : "schematic");
  return {
    schema: GEOMETRY_SCHEMA,
    catalogId: entry.id,
    catalogVersion,
    units: "mm",
    bounds: { size: [r1(size[0]), r1(size[1]), r1(size[2])], basis: { x: basis("x"), y: basis("y"), z: basis("z") } },
    solids: b.solids,
    attach: x.attach ?? {},
    mounts: b.mounts,
    ports: b.ports,
    leads: x.leads ?? {},
    zones: Object.fromEntries(entry.zones.map((z) => [z.id, { solids: x.zones?.[z.id] ?? [] }])),
    lights: x.lights ?? [],
    label: EDUCATIONAL_LABEL,
  };
}

/** Exit points for a part's captive cables, spread along a line. */
function leadExits(entry: CatalogEntry, start: Vec3, step: Vec3): Record<string, { at: Vec3 }> {
  const out: Record<string, { at: Vec3 }> = {};
  entry.cables.filter((c) => c.attachment === "captive").forEach((c, i) => {
    out[c.id] = { at: [r1(start[0] + step[0] * i), r1(start[1] + step[1] * i), r1(start[2] + step[2] * i)] };
  });
  return out;
}

/** Cases whose front is vertical wooden slats rather than mesh. */
const FRONT_SLATS = new Set(["fractal-north-charcoal-black-mesh"]);

// ---------- Case: x from the rear to the front, y up, z from the tray side to the open side panel ----------

export function caseGeometry(entry: CaseEntry, v: string): PartGeometry {
  const L = entry.dimensions.lengthMm ?? 450;
  const H = entry.dimensions.heightMm ?? 460;
  const W = entry.dimensions.widthMm ?? 220;
  const b = new Builder();
  const wall = 2;
  const shroudH = 0.22 * H;
  const trayZ = 0.14 * W;
  const feet = 12;
  const steel = { finish: "black_metal" as const };

  // Steel chassis: floor on four feet, roof, rear wall, the tray wall behind the board and the closed side.
  for (const [i, [x, z]] of ([[20, 20], [L - 50, 20], [20, W - 50], [L - 50, W - 50]] as [number, number][]).entries()) {
    b.box(`foot-${i + 1}`, "plate", [x, 0, z], [30, feet, 30], "schematic", { finish: "rubber" });
  }
  b.box("floor", "panel", [0, feet, 0], [L, wall, W], "catalog", steel);
  b.box("roof", "panel", [0, H - wall, 0], [L, wall, W], "catalog", steel);
  b.box("rear-panel", "panel", [0, feet, 0], [wall, H - feet, W], "catalog", steel);
  b.box("tray-wall", "panel", [0, feet, trayZ - wall], [L - 10, H - feet, wall], "schematic", steel);
  b.box("back-side-panel", "panel", [0, feet, 0], [L - 10, H - feet, wall], "schematic", steel);
  // Rear wall: the motherboard's I/O opening and seven expansion slot covers below it.
  b.box("io-cutout", "plate", [wall, H - 0.05 * H - 175, trayZ + 4], [1, 45, 162], "standard", { finish: "black_plastic", label: "I/O" });
  b.fins("slot-covers", "grille", [wall, H - 0.05 * H - 305, trayZ + 18], [1.2, 140, 130], 7, "y", "standard", steel);
  // Front: as the product pages read for the catalog show it (wooden slats on the North, perforated mesh on an AIRFLOW case).
  const slats = FRONT_SLATS.has(entry.id);
  const front = slats ? "wood" : "mesh";
  b.box("front-frame", "panel", [L - 8, feet, 0], [8, H - feet, W], "catalog", { finish: "black_plastic" });
  b.fins("front-panel", "grille", [L - 10, feet + 10, 10], [2, H - feet - 20, W - 20], slats ? 9 : 40, slats ? "z" : "y", "schematic", { finish: front });
  b.box("front-io", "plate", [L - 70, H - wall - 0.5, W * 0.3], [56, 0.5, W * 0.4], "schematic", { finish: "black_plastic", label: "POWER" });
  b.fins("top-filter", "grille", [L * 0.2, H - wall - 1, trayZ + 10], [L * 0.55, 1, W - trayZ - 20], 30, "x", "schematic", { finish: "mesh" });
  // The basement: power-supply shroud with cable cut-outs, and grommets beside the board.
  b.box("psu-shroud", "panel", [wall, feet + wall + shroudH, trayZ], [L - 40, wall, W - trayZ - 4], "schematic", steel);
  b.box("shroud-front", "panel", [L - 42, feet + wall, trayZ], [wall, shroudH, W - trayZ - 4], "schematic", steel);
  for (let i = 0; i < 3; i += 1) b.box(`grommet-${i + 1}`, "plate", [L * 0.72, feet + shroudH + 60 + i * 90, trayZ - wall - 0.5], [24, 60, 1], "schematic", { finish: "rubber" });

  for (const m of entry.mountPoints) {
    if (m.kind === "motherboard_tray") {
      // The board stands on the tray: its top-rear corner goes to the upper rear of the chamber.
      const top = H - 0.05 * H;
      const s = b.box(m.id, "tray", [18, top - 305, trayZ], [244, 305, 1], "schematic", { label: "MOTHERBOARD" });
      b.mount(m.id, s, [18, top, trayZ + 7], STAND_UP, [0, 0, -1], 30);
      // Standoffs at the ATX hole pattern's nine places (positions schematic).
      const holes: [number, number][] = [[6, 10], [6, 160], [6, 290], [128, 10], [128, 160], [128, 290], [236, 10], [236, 160], [236, 290]];
      holes.forEach(([x, z], i) => (b.cylinder(`standoff-${i + 1}`, "plate", [18 + x, top - z, trayZ + 3.5], 2.5, 6, "z").finish = "nickel"));
    } else if (m.kind === "psu_bay") {
      const s = b.box(m.id, "bay", [wall + 4, feet + wall + 2, trayZ + 4], [Math.min(m.maxLengthMm ?? 180, 180), shroudH - 6, 150], "schematic", { label: "PSU" });
      b.mount(m.id, s, [wall + 4, feet + wall + 2, trayZ + 4], IDENTITY, [-1, 0, 0], 60, [0, 0, 1]);
    }
  }
  // Fan positions by wall: front fans blow toward the rear (-x), top fans upward (+y), rear fan out of the back (-x).
  const fanAt = (location: string): ((i: number, n: number) => { at: Vec3; quat: Quat; axis: "x" | "y" | "z"; insert: Vec3 }) | undefined => {
    const zc = trayZ + (W - trayZ) / 2;
    if (location === "front") return (i) => ({ at: [L - 22, feet + 70 + i * 122, zc], quat: TURN_Y, axis: "x", insert: [1, 0, 0] });
    if (location === "top") return (i) => ({ at: [L * 0.35 + i * 124, H - 16, zc], quat: FACE_UP, axis: "y", insert: [0, 1, 0] });
    if (location === "rear") return () => ({ at: [14, H - 0.2 * H, zc], quat: TURN_Y, axis: "x", insert: [-1, 0, 0] });
    if (location === "side") return (i) => ({ at: [L * 0.5 + i * 122, H * 0.6, trayZ + 16], quat: IDENTITY, axis: "z", insert: [0, 0, -1] });
    return undefined;
  };
  for (const location of ["front", "top", "rear", "side"]) {
    const list = entry.mountPoints.filter((m) => m.kind === "fan_mount" && m.location === location);
    const place = fanAt(location);
    list.forEach((m, i) => {
      if (!place) return;
      const p = place(i, list.length);
      const s = b.cylinder(m.id, "fan_mount", p.at, 60, 4, p.axis);
      s.label = "FAN";
      b.mount(m.id, s, p.at, p.quat, p.insert, 40, [0, 0, 1]);
      b.mounts[m.id]!.size = p.axis === "x" ? [4, 120, 120] : p.axis === "y" ? [120, 4, 120] : [120, 120, 4];
    });
    // A radiator position spans the fan positions of the same wall.
    const rad = entry.mountPoints.find((m) => m.kind === "radiator_mount" && m.location === location);
    if (rad && place && rad.kind === "radiator_mount") {
      const n = Math.max(list.length, 1);
      const a = place(0, n).at;
      const z = place(n - 1, n).at;
      const longest = Math.max(...rad.radiatorSizesMm);
      const centre: Vec3 = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2, (a[2] + z[2]) / 2];
      const size: Vec3 = location === "top" ? [Math.min(longest + 37, L - 80), 6, 120] : [6, location === "rear" ? 157 : Math.min(longest + 37, H - shroudH - 30), 120];
      const s = b.box(rad.id, "radiator_mount", [centre[0] - size[0] / 2 + (location === "front" ? -8 : location === "rear" ? 8 : 0), centre[1] - size[1] / 2 + (location === "top" ? -8 : 0), centre[2] - size[2] / 2], size, "schematic", { label: `RAD ${longest}` });
      b.mount(rad.id, s, s.at, place(0, n).quat, place(0, n).insert, 40, [0, 0, 1]);
    }
  }
  const bays = entry.mountPoints.filter((m) => m.kind === "drive_bay");
  bays.forEach((m, i) => {
    const small = m.kind === "drive_bay" && !m.sizes.includes("3.5_inch");
    const size: Vec3 = small ? [104, 74, 10] : [150, 30, 104];
    const min: Vec3 = small ? [L * 0.42 + (i % 2) * 112, feet + wall + shroudH + 4, trayZ + 8 + Math.floor(i / 2) * 14] : [L - 200, feet + wall + 4 + (i % 2) * 36, trayZ + 20];
    const s = b.box(m.id, "bay", min, size, "schematic", { label: small ? "2.5" : "3.5" });
    b.mount(m.id, s, min, IDENTITY, small ? [0, -1, 0] : [1, 0, 0], 40, [0, 0, 1]);
  });

  return finish(entry, v, b, [L, H, W], {
    leads: leadExits(entry, [L - 70, H - 40, trayZ + 4], [0, -14, 0]),
    zones: {
      "front-panel": ["front-frame", "front-panel", "front-io"],
      "main-chamber": ["tray-wall", ...entry.mountPoints.filter((m) => m.kind === "motherboard_tray").map((m) => m.id)],
      "psu-shroud": ["psu-shroud", "shroud-front"],
    },
  });
}

// ---------- CPU: footprint in x and z, lid up ----------

export function cpuGeometry(entry: CpuEntry, v: string): PartGeometry {
  const X = entry.dimensions.lengthMm ?? 40;
  const Z = entry.dimensions.widthMm ?? 40;
  const b = new Builder();
  // Underside: a field of gold contact pads (an LGA package has pads, the pins are in the socket).
  b.fins("contacts", "plate", [2, 0, 2], [X - 4, 0.5, Z - 4], 24, "x", "schematic", { finish: "gold" });
  b.box("substrate", "pcb", [0, 0.5, 0], [X, 1.2, Z], entry.dimensions.lengthMm !== null ? "catalog" : "schematic", { finish: "pcb_green" });
  // Small surface components around the lid, then the nickel-plated heat spreader with its side flanges.
  b.fins("capacitors", "chip", [X * 0.08, 1.7, 1], [X * 0.84, 0.5, 2.5], 14, "x", "schematic", { finish: "silicon" });
  b.box("lid-flange", "plate", [X * 0.06, 1.7, Z * 0.12], [X * 0.88, 0.8, Z * 0.76], "schematic", { finish: "nickel" });
  // Two processors can share a package; the model marking on the lid is what tells them apart.
  b.box("heat-spreader", "plate", [X * 0.15, 2.5, Z * 0.15], [X * 0.7, 1.9, Z * 0.7], "schematic", { finish: "nickel", label: entry.model.replace(/^Core |^Ryzen \d /, "").toUpperCase() });
  // The gold triangle in one corner shows the one orientation in which the CPU drops into its socket.
  b.box("corner-mark", "chip", [1, 1.7, Z - 4], [3, 0.2, 3], "schematic", { finish: "gold" });
  return finish(entry, v, b, [X, 4.4, Z], {
    attach: { main: { at: [r1(X / 2), 0, r1(Z / 2)], quat: IDENTITY } },
    zones: { "heat-spreader": ["heat-spreader", "lid-flange"], contacts: ["contacts", "corner-mark"] },
  });
}

// ---------- Memory module: x along its length, y up from the contacts, z through its thickness ----------

export function ramGeometry(entry: RamEntry, v: string): PartGeometry {
  // The module length follows the JEDEC DIMM outline (133.35 mm); height and the notch offset are schematic.
  const X = 133.35;
  const Y = entry.rgb ? 44 : 34;
  const Z = 7;
  // The key notch sits at a different distance along the edge for each generation; that is what blocks a wrong slot.
  const notchX = entry.spec.generation === "ddr5" ? 0.51 * X : 0.545 * X;
  const b = new Builder();
  b.fins("contacts-left", "edge_connector", [3, 0, 2.7], [notchX - 5, 4, 1.6], 40, "x", "schematic", { finish: "gold" });
  b.fins("contacts-right", "edge_connector", [notchX + 2, 0, 2.7], [X - notchX - 5, 4, 1.6], 40, "x", "schematic", { finish: "gold" });
  b.box("notch", "chip", [notchX - 1, 0, 2.5], [2, 3, 2], "schematic", { label: entry.spec.generation.toUpperCase() });
  b.box("pcb", "pcb", [0, 4, 2.7], [X, Y - 12, 1.6], "standard", { finish: "pcb_green" });
  // Memory chips in a row on each face, under the spreader (seen at its open lower edge).
  const chips = entry.spec.generation === "ddr5" ? 10 : 8;
  for (const [side, z] of [["front", 4.3], ["back", 1.7]] as const) {
    for (let i = 0; i < chips; i += 1) b.box(`chip-${side}-${i + 1}`, "chip", [6 + i * ((X - 12) / chips), 6, z], [(X - 12) / chips - 2, 10, 1], "schematic", { finish: "silicon" });
  }
  // The aluminium heat spreader in two halves, with ridges along its top.
  const spreaderH = Y - (entry.rgb ? 16 : 8);
  b.box("heat-spreader", "heatsink", [2, 9, 0], [X - 4, spreaderH - 2, Z], "schematic", { finish: "black_metal" });
  b.fins("spreader-ridges", "heatsink", [8, 7 + spreaderH - 6, 0.2], [X - 16, 4, Z - 0.4], 12, "x", "schematic", { finish: "aluminium" });
  b.box("latch-end-left", "plate", [0, 4, 2], [2.5, 10, 3], "schematic", { finish: "black_plastic" });
  b.box("latch-end-right", "plate", [X - 2.5, 4, 2], [2.5, 10, 3], "schematic", { finish: "black_plastic" });
  const lights = (entry.rgb?.zones ?? []).map((zone) => {
    b.box(`light-${zone}`, "light", [4, Y - 8, 0.5], [X - 8, 8, Z - 1], "schematic", { finish: "white_plastic" });
    return { zone, solids: [`light-${zone}`] };
  });
  return finish(entry, v, b, [X, Y, Z], {
    // The module stands in its slot, centred along it.
    attach: { main: { at: [-4.5, 0, Z / 2], quat: IDENTITY } },
    zones: { notch: ["notch"], "edge-ends": ["latch-end-left", "latch-end-right"] },
    lights,
  });
}

// ---------- Power supply: x from the cable side to the mains side, y up, z across ----------

export function psuGeometry(entry: PsuEntry, v: string): PartGeometry {
  const X = entry.dimensions.lengthMm ?? 150;
  const Y = entry.dimensions.heightMm ?? 86;
  const Z = entry.dimensions.widthMm ?? 150;
  const b = new Builder();
  b.box("housing", "body", [0, 0, 0], [X, Y - 2, Z], "catalog", { finish: "black_metal" });
  // Fan on the top face: a guard of rings over a bladed rotor.
  const fanR = Math.min(X, Z) / 2 - 12;
  b.rotor("fan-rotor", [X / 2, Y - 3, Z / 2], fanR - 3, 2, "y", 9, "schematic", { finish: "black_plastic" });
  b.cylinder("fan-grille", "grille", [X / 2, Y - 1, Z / 2], fanR, 2, "y").finish = "black_metal";
  // Mains side: honeycomb vent, the IEC inlet and the rocker switch.
  b.fins("rear-vent", "grille", [X - 1, Y * 0.12, Z * 0.05], [1, Y * 0.76, Z * 0.35], 12, "z", "schematic", { finish: "black_metal" });
  b.box("mains-inlet", "plug", [X - 1.5, Y * 0.3, Z * 0.48], [1.5, 20, 28], "standard", { finish: "black_plastic", label: "AC" });
  b.box("mains-switch", "plug", [X - 1.5, Y * 0.35, Z * 0.76], [1.5, 14, 20], "schematic", { finish: "black_plastic", label: "I/O" });
  b.box("rating-label", "plate", [X * 0.25, Y * 0.3, Z - 0.5], [X * 0.5, Y * 0.4, 0.5], "schematic", { finish: "label", label: `${entry.spec.wattageW}W` });
  // Modular sockets in rows on the cable side; a unit with fixed cables has one exit instead.
  const perRow = Math.ceil(entry.ports.length / 2) || 1;
  entry.ports.forEach((p, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const w = (Z - 16) / perRow - 2;
    const s = b.port(p, [0, 12 + row * 30, 8 + col * (w + 2)], [1.5, p.keying?.endsWith("atx24") ? 24 : 12, Math.min(w, 22)], [-1, 0, 0]);
    s.finish = "black_plastic";
    // Marked with the socket class, as the unit's own panel groups them.
    const cls = p.keying?.split(":")[1] ?? "";
    s.label = cls === "atx24" ? "ATX" : cls === "cpu-pcie" ? "CPU/PCIE" : cls === "peripheral" ? "SATA/PATA" : cls.toUpperCase();
  });
  const fixed = entry.cables.some((c) => c.attachment === "captive");
  if (fixed) {
    b.box("cable-exit", "plug", [0, Y * 0.3, Z * 0.3], [1.5, Y * 0.4, Z * 0.4], "schematic", { finish: "rubber" });
    // The bundle of fixed cables leaving the unit, sleeved together.
    b.cylinder("cable-bundle", "tube", [6, Y * 0.5, Z * 0.5], Math.min(Y, Z) * 0.14, 10, "x").finish = "black_plastic";
  }
  return finish(entry, v, b, [X, Y, Z], {
    attach: { main: { at: [0, 0, 0], quat: IDENTITY } },
    leads: leadExits(entry, [0, Y * 0.5, Z * 0.34], [0, 0, Z * 0.08]),
    zones: { "rear-switch": ["mains-inlet", "mains-switch"], "cable-side": fixed ? ["cable-exit"] : entry.ports.map((p) => p.id), label: ["rating-label"] },
  });
}

// ---------- Storage ----------

export function storageGeometry(entry: StorageEntry, v: string): PartGeometry {
  const X = entry.dimensions.lengthMm ?? 80;
  const Y = entry.dimensions.heightMm ?? 3;
  const Z = entry.dimensions.widthMm ?? 22;
  const b = new Builder();
  if (entry.spec.formFactor.startsWith("m2")) {
    // The keyed edge enters the slot; the half-round cut-out at the far end takes the screw or latch.
    b.box("pcb", "pcb", [0, 0, 0], [X, 0.8, Z], "catalog", { finish: "pcb_black" });
    b.fins("connector-edge", "edge_connector", [0, 0, 1], [4, 0.8, Z - 6], 30, "z", "standard", { finish: "gold", label: "M" });
    b.box("controller", "chip", [10, 0.8, 4], [12, Y - 0.8, 14], "schematic", { finish: "silicon" });
    b.box("memory-1", "chip", [28, 0.8, 3], [18, Y - 0.8, 16], "schematic", { finish: "silicon" });
    b.box("memory-2", "chip", [50, 0.8, 3], [18, Y - 0.8, 16], "schematic", { finish: "silicon" });
    b.box("label", "plate", [26, Y - 0.1, 2], [X - 34, 0.1, Z - 4], "schematic", { finish: "label", label: `${entry.spec.capacityGb} GB` });
    b.cylinder("screw-notch", "plate", [X - 1.6, 0.4, Z / 2], 1.6, 0.8, "y").finish = "gold";
    return finish(entry, v, b, [X, Y, Z], { attach: { main: { at: [0, 0, r1(Z / 2)], quat: IDENTITY } }, zones: { "connector-edge": ["connector-edge"] } });
  }
  // 2.5-inch drive: a metal shell with a darker top cover and four threaded holes in each side.
  b.box("housing", "body", [0, 0, 0], [X, Y * 0.55, Z], "catalog", { finish: "black_metal" });
  b.box("top-cover", "body", [1, Y * 0.55, 1], [X - 2, Y * 0.45, Z - 2], "schematic", { finish: "black_plastic" });
  for (const [i, x] of [14, X - 14].entries()) {
    b.cylinder(`side-hole-${i + 1}`, "plate", [x, Y * 0.4, 0.5], 1.5, 1, "z").finish = "nickel";
    b.cylinder(`side-hole-${i + 3}`, "plate", [x, Y * 0.4, Z - 0.5], 1.5, 1, "z").finish = "nickel";
  }
  b.box("label", "plate", [X * 0.2, Y - 0.2, Z * 0.15], [X * 0.6, 0.2, Z * 0.7], "schematic", { finish: "label", label: `${entry.spec.capacityGb} GB` });
  // The two L-shaped connectors side by side on one end: short for data, long for power.
  for (const p of entry.ports) {
    const power = p.function === "sata_power";
    const s = b.port(p, [0, 1.2, power ? Z * 0.42 : Z * 0.16], [1.5, 4, power ? 22 : 12], [-1, 0, 0]);
    s.label = power ? "POWER" : "DATA";
    s.finish = "black_plastic";
  }
  return finish(entry, v, b, [X, Y, Z], { attach: { main: { at: [0, 0, 0], quat: IDENTITY } }, zones: { "sata-connectors": entry.ports.map((p) => p.id) } });
}

// ---------- Fan: square face in x and y, air moves along z ----------

/** Mounting-hole spacing of 120 mm and 140 mm fans (centre to centre). */
const HOLE_SPACING: Record<number, number> = { 120: 105, 140: 124.5 };

export function fanGeometry(entry: FanEntry, v: string): PartGeometry {
  const A = entry.spec.sizeMm;
  const T = entry.spec.thicknessMm;
  const b = new Builder();
  const side = 6;
  // The frame: four sides around the round opening, with solid corners that carry the screw holes.
  b.box("frame", "body", [0, 0, 0], [A, side, T], "catalog", { finish: "black_plastic" });
  b.box("frame-top", "body", [0, A - side, 0], [A, side, T], "catalog", { finish: "black_plastic" });
  b.box("frame-left", "body", [0, side, 0], [side, A - 2 * side, T], "schematic", { finish: "black_plastic" });
  b.box("frame-right", "body", [A - side, side, 0], [side, A - 2 * side, T], "schematic", { finish: "black_plastic" });
  const inset = (A - (HOLE_SPACING[A] ?? A - 15)) / 2;
  for (const [i, [x, y]] of ([[inset, inset], [A - inset, inset], [inset, A - inset], [A - inset, A - inset]] as [number, number][]).entries()) {
    b.box(`corner-${i + 1}`, "body", [x - inset, y - inset, 0], [inset * 2, inset * 2, T], "schematic", { finish: "black_plastic" });
    b.cylinder(`screw-hole-${i + 1}`, "plate", [x, y, T / 2], 2.2, T, "z", HOLE_SPACING[A] ? "standard" : "schematic").finish = "rubber";
  }
  // The rotor fills the frame's opening; four struts on the exhaust side hold the motor hub.
  b.rotor("rotor", [A / 2, A / 2, T / 2 + 1], A / 2 - side - 1, T - 4, "z", 7, "schematic", { finish: "black_plastic" });
  b.cylinder("motor-hub", "plate", [A / 2, A / 2, 2], A * 0.18, 4, "z").finish = "black_plastic";
  b.box("strut-h", "plate", [side, A / 2 - 1.5, 0], [A - 2 * side, 3, 2], "schematic", { finish: "black_plastic" });
  b.box("strut-v", "plate", [A / 2 - 1.5, side, 0], [3, A - 2 * side, 2], "schematic", { finish: "black_plastic" });
  // Where the lead leaves the frame, marked with its plug: 4-pin PWM or 3-pin DC.
  b.box("lead-exit", "plug", [A - 14, 0, 0], [10, 3, 4], "schematic", { finish: "rubber", label: entry.spec.control === "pwm_4pin" ? "4-PIN PWM" : "3-PIN" });
  // Anti-vortex vanes in the frame's corners on the exhaust side, where the product page names them.
  if (/AirGuide/.test(entry.model)) {
    for (const [i, [x, y]] of ([[side, side], [A - side - 14, side], [side, A - side - 14], [A - side - 14, A - side - 14]] as [number, number][]).entries()) {
      b.box(`vane-${i + 1}`, "plate", [x, y, 0], [14, 14, 3], "schematic", { finish: "black_plastic" });
    }
  }
  const lights = (entry.rgb?.zones ?? []).map((zone) => {
    b.cylinder(`light-${zone}`, "light", [A / 2, A / 2, T - 1], A * 0.16, 2, "z").finish = "white_plastic";
    return { zone, solids: [`light-${zone}`] };
  });
  return finish(entry, v, b, [A, A, T], {
    attach: { main: { at: [A / 2, A / 2, 0], quat: IDENTITY } },
    leads: leadExits(entry, [A - 9, 0, 2], [-4, 0, 0]),
    zones: { "frame-arrows": ["frame", "frame-top", "strut-h", "strut-v"], leads: ["lead-exit"] },
    lights,
  });
}

// ---------- CPU coolers ----------

export function coolingGeometry(entry: CoolingEntry, v: string): PartGeometry {
  const b = new Builder();
  if (entry.spec.type === "air") {
    const X = entry.dimensions.lengthMm ?? 95;
    const Y = entry.dimensions.heightMm ?? 60;
    const Z = entry.dimensions.widthMm ?? 95;
    const fans = entry.spec.fanCount;
    b.box("cold-plate", "plate", [X / 2 - 20, 0, Z / 2 - 20], [40, 4, 40], "schematic", { finish: "copper" });
    b.box("mounting-bar", "plate", [X / 2 - 4, 4, 2], [8, 4, Z - 4], "schematic", { finish: "black_metal" });
    if (Y > 100) {
      // Tower: heat pipes rise from the base into a stack of thin fins, with a fan on each side.
      const fanT = fans > 0 ? Math.min(25, X / 4.2) : 0;
      const stackX = X - fans * fanT;
      const x0 = fans >= 2 ? fanT : 0;
      for (let i = 0; i < 4; i += 1) {
        b.cylinder(`heat-pipe-${i + 1}`, "tube", [x0 + stackX / 2 + (i % 2 ? 4 : -4), 4 + (Y - 8) / 2, Z * (0.26 + i * 0.16)], 3, Y - 8, "y").finish = "nickel";
      }
      b.fins("fin-stack", "heatsink", [x0, 34, 2], [stackX, Y - 40, Z - 4], 46, "y", "schematic", { finish: "aluminium" });
      b.box("top-cover", "plate", [x0, Y - 6, 2], [stackX, 6, Z - 4], "schematic", { finish: "black_plastic" });
      for (let i = 0; i < fans; i += 1) {
        const fx = i === 0 && fans >= 2 ? fanT / 2 : X - fanT / 2;
        const r = Math.min(Z, Y - 34) / 2 - 2;
        b.box(`fan-frame-${i + 1}`, "body", [fx - fanT / 2, 34, Z / 2 - r - 2], [fanT, Y - 34 - 6, 2 * r + 4], "schematic", { finish: "black_plastic" });
        b.rotor(`fan-${i + 1}`, [fx, 34 + (Y - 40) / 2, Z / 2], r - 2, fanT - 4, "x", 7, "schematic", { finish: "black_plastic" });
      }
    } else {
      // Low profile: fins around the base with one fan on top.
      b.fins("fin-stack", "heatsink", [2, 4, 2], [X - 4, Y - 24, Z - 4], 30, "x", "schematic", { finish: "aluminium" });
      b.rotor("fan-1", [X / 2, Y - 10, Z / 2], Math.min(X, Z) / 2 - 2, 18, "y", 7, "schematic", { finish: "black_plastic" });
    }
    return finish(entry, v, b, [X, Y, Z], {
      attach: { main: { at: [r1(X / 2), 0, r1(Z / 2)], quat: IDENTITY } },
      leads: leadExits(entry, [X / 2, Math.min(Y - 6, 40), Z - 1], [6, 0, 0]),
      zones: { "cold-plate": ["cold-plate"], "fin-stack": ["fin-stack", ...b.solids.filter((s) => s.role === "fan").map((s) => s.id)] },
    });
  }
  // All-in-one: a radiator with its fans (group `radiator`) and a pump block (group `block`), joined by two hoses.
  const RL = entry.dimensions.lengthMm ?? 277;
  const RW = entry.dimensions.widthMm ?? 120;
  const RT = entry.dimensions.heightMm ?? 38;
  const fanT = 25;
  const g = { group: "radiator" };
  // Radiator: end tanks on both ends and a core of thin fins between them.
  b.box("radiator-tank-1", "radiator", [0, 0, 0], [14, RW, RT], "schematic", { ...g, finish: "black_metal" });
  b.box("radiator-tank-2", "radiator", [RL - 26, 0, 0], [14, RW, RT], "schematic", { ...g, finish: "black_metal" });
  b.fins("radiator-core", "radiator", [14, 2, 0], [RL - 40, RW - 4, RT], 90, "x", "schematic", { ...g, finish: "black_metal" });
  const fans = entry.spec.fanCount;
  for (let i = 0; i < fans; i += 1) {
    const cx = 14 + ((RL - 40) / fans) * (i + 0.5);
    const r = Math.min((RL - 40) / fans, RW) / 2 - 2;
    b.box(`fan-frame-${i + 1}`, "body", [cx - r - 2, RW / 2 - r - 2, RT], [2 * r + 4, 2 * r + 4, 4], "schematic", { ...g, finish: "black_plastic" });
    b.rotor(`fan-${i + 1}`, [cx, RW / 2, RT + 4 + (fanT - 4) / 2], r - 2, fanT - 6, "z", 9, "schematic", { ...g, finish: "black_plastic" });
  }
  b.box("hose-fittings", "plate", [RL - 12, RW / 2 - 18, 6], [12, 36, 14], "schematic", { ...g, finish: "black_metal" });
  const lights = (entry.rgb?.zones ?? []).map((zone) => {
    const ids: string[] = [];
    for (let i = 0; i < fans; i += 1) {
      const s = b.cylinder(`light-${zone}-${i + 1}`, "light", [14 + ((RL - 40) / fans) * (i + 0.5), RW / 2, RT + fanT - 1], RW * 0.15, 2, "z");
      s.group = "radiator";
      s.finish = "white_plastic";
      ids.push(s.id);
    }
    return { zone, solids: ids };
  });
  // The block is drawn beside the radiator; the scene places each group with its own attach frame.
  const bx = RL + 30;
  const blk = { group: "block" };
  b.box("cold-plate", "plate", [bx, 0, 20], [56, 4, 56], "schematic", { ...blk, finish: "copper" });
  b.box("mounting-ears", "plate", [bx - 6, 4, 42], [68, 3, 12], "schematic", { ...blk, finish: "black_metal" });
  const pump = b.cylinder("pump-block", "body", [bx + 28, 4 + 22, 48], 32, 40, "y");
  pump.group = "block";
  pump.finish = "black_plastic";
  const cap = b.cylinder("pump-cap", "plate", [bx + 28, 4 + 44, 48], 28, 4, "y");
  cap.group = "block";
  cap.finish = "black_metal";
  const h1 = b.cylinder("hose-1", "tube", [RL + 15, RW / 2 - 9, 13], 6, 30, "x");
  const h2 = b.cylinder("hose-2", "tube", [RL + 15, RW / 2 + 9, 13], 6, 30, "x");
  h1.group = "block";
  h2.group = "block";
  h1.finish = "rubber";
  h2.finish = "rubber";
  const size: Vec3 = [bx + 64, RW, Math.max(RT + fanT, 80)];
  return finish(entry, v, b, size, {
    attach: {
      block: { at: [bx + 28, 0, 48], quat: IDENTITY },
      // The fan side faces the mount; the radiator's long side runs along the mount.
      radiator: { at: [r1(RL / 2), r1(RW / 2), RT + fanT], quat: IDENTITY },
    },
    leads: leadExits(entry, [bx + 28, 30, 80], [6, 0, 0]),
    zones: { "cold-plate": ["cold-plate"], radiator: ["radiator-core", "radiator-tank-1", "radiator-tank-2", ...b.solids.filter((s) => s.role === "fan").map((s) => s.id)] },
    lights,
  });
}

// ---------- Loose cable: a plug at each end ----------

export function cableGeometry(entry: CableEntry, v: string): PartGeometry {
  const spec = entry.cables[0];
  const b = new Builder();
  const ends = spec?.ends ?? [];
  const X = 160;
  b.cylinder("cord", "tube", [X / 2, 5, 9], 2.5, X - 30, "x");
  ends.forEach((e, i) => b.box(`end-${e.id}`, "plug", [i === 0 ? 0 : X - 18, 1, 2], [18, 8, 14], "schematic", { label: printedLabel(e.label.en, `${e.connector}`.replace(/_/g, " ")).split(" ")[0]!.toUpperCase() }));
  return finish(entry, v, b, [X, 10, 18], {});
}

// ---------- Monitor: screen facing +z, inputs on the back ----------

export function monitorGeometry(entry: MonitorEntry, v: string): PartGeometry {
  const X = 540;
  const Y = 400;
  const Z = 180;
  const b = new Builder();
  b.box("stand-base", "plate", [X / 2 - 110, 0, 0], [220, 8, Z]);
  b.box("stand-neck", "plate", [X / 2 - 20, 8, 40], [40, 80, 20]);
  b.box("panel", "body", [0, 80, 60], [X, Y - 80, 30]);
  b.box("screen", "screen", [10, 92, 89], [X - 20, Y - 104, 1]);
  entry.ports.forEach((p, i) => b.port(p, [X / 2 - 50 + i * 60, 110, 58.5], [24, 10, 1.5], [0, 0, -1]));
  return finish(entry, v, b, [X, Y, Z], {});
}
