import type { PartGeometry, Quat, Solid, Vec3 } from "./geometry";

const box = (id: string, at: Vec3, size: Vec3, finish = "black_metal"): Solid => ({ id: `detail-${id}`, shape: "box", at, size, finish, role: "detail", basis: "schematic" });
const ring = (id: string, at: Vec3, radius: number, axis: "x" | "y" | "z", finish = "black_metal"): Solid => ({ id: `detail-${id}`, shape: "ring", at, radius, height: 1, axis, finish, role: "detail", basis: "schematic" });
/**
 * A light diffuser ring for the optional RGB lighting. Role `rgb`: the scene draws it only while RGB is
 * on (and lights it only while the build runs), so with RGB off the part looks exactly as before.
 */
const rgbRing = (id: string, at: Vec3, radius: number, axis: "x" | "y" | "z", group?: string): Solid =>
  ({ id: `rgb-${id}`, shape: "ring", at, radius, height: 1, axis, role: "rgb", basis: "schematic", ...(group ? { group } : {}) });
const screw = (id: string, at: Vec3, axis: "x" | "y" | "z" = "y"): Solid => ({ id: `detail-${id}`, shape: "cylinder", at, radius: 1.8, height: 1.2, axis, finish: "nickel", role: "detail", basis: "schematic" });

/** Original schematic details. Mechanical anchors and catalog bounds remain unchanged. */
export function withVisualDetails(source: PartGeometry): PartGeometry {
  const solids = source.solids.map((solid) => ({ ...solid }));
  const extra: Solid[] = [];
  const [w, h, d] = source.bounds.size;
  if (source.catalogId === "corsair-4000d-airflow-black") {
    const frame = solids.find((solid) => solid.id === "front-frame");
    if (frame) { frame.at = [w - 4, h / 2, 5]; frame.size = [8, h - 24, 10]; }
    extra.push(box("front-right-rail", [w - 4, h / 2, d - 5], [8, h - 24, 10], "black_plastic"));
    for (const y of [19, h - 8]) extra.push(box(`front-edge-${y}`, [w - 4, y, d / 2], [8, 12, d - 12], "black_plastic"));
    const roof = solids.find((solid) => solid.id === "roof");
    if (roof) { roof.at = [w / 2, h - 1, 6]; roof.size = [w, 2, 12]; }
    extra.push(box("roof-side", [w / 2, h - 1, d - 6], [w, 2, 12]));
    for (const x of [8, w - 8]) extra.push(box(`roof-edge-${x}`, [x, h - 1, d / 2], [16, 2, d - 24]));
    const front = solids.find((solid) => solid.id === "front-panel");
    if (front) { front.at = [w - 9, h / 2, d / 2]; front.count = 40; front.axis = "y"; }
    extra.push({ ...box("front-mesh", [w - 10, h / 2, d / 2], [1, h - 38, d - 30], "mesh"), shape: "fins", count: 20, axis: "z" });
    for (const x of [8, w - 10]) {
      extra.push(box(`side-upright-${x}`, [x, h / 2, d - 3], [7, h - 30, 6]));
      for (const y of [28, h - 25]) extra.push(screw(`side-${x}-${y}`, [x, y, d - 0.8], "z"));
    }
    extra.push(box("front-usb-insert", [w - 50, h - 1.8, d / 2 - 18], [13, 1, 6], "silicon"));
    extra.push({ id: "detail-front-power-button", shape: "cylinder", at: [w - 26, h - 1, d / 2 + 18], radius: 5, height: 1, axis: "y", role: "detail", finish: "nickel", basis: "schematic" });
  }
  if (source.catalogId === "arctic-freezer-36") {
    for (const frame of solids.filter((solid) => solid.id.startsWith("fan-frame-") && solid.size)) {
      const [sx, sy, sz] = frame.size!;
      const [x, y, z] = frame.at;
      frame.at = [x, y - sy / 2 + 4, z]; frame.size = [sx, 8, sz];
      extra.push(box(`${frame.id}-top`, [x, y + sy / 2 - 4, z], [sx, 8, sz], "black_plastic"));
      for (const side of [-1, 1]) extra.push(box(`${frame.id}-side-${side}`, [x, y, z + side * (sz / 2 - 4)], [sx, sy - 16, 8], "black_plastic"));
      extra.push(ring(`${frame.id}-rim`, [x + (x < w / 2 ? -1 : 1) * (sx / 2 - 1), y, z], Math.min(sy, sz) * 0.46, "x", "grey_plastic"));
      for (const yy of [-1, 1]) for (const zz of [-1, 1]) extra.push(screw(`${frame.id}-${yy}-${zz}`, [x, y + yy * (sy / 2 - 8), z + zz * (sz / 2 - 8)], "x"));
    }
    for (const z of [34, 54, 74, 94]) extra.push({ id: `detail-heatpipe-tip-${z}`, shape: "cylinder", at: [52, h - 1.5, z], radius: 3, height: 2, axis: "y", role: "detail", finish: "nickel", basis: "schematic" });
  }
  if (source.catalogId === "asus-dual-rtx4060-o8g") {
    const shroud = solids.find((solid) => solid.id === "shroud");
    if (shroud) { shroud.at = [w / 2, 15, d - 5]; shroud.size = [w - 4, 7, 9]; }
    extra.push(box("gpu-top-rail", [w / 2, h - 7, d - 5], [w - 4, 9, 9], "black_plastic"));
    extra.push(box("gpu-middle-strut", [w / 2, h / 2 + 5, d - 5], [9, h - 27, 9], "black_plastic"));
    for (const rotor of solids.filter((solid) => solid.shape === "rotor")) extra.push(ring(`${rotor.id}-rim`, [rotor.at[0], rotor.at[1], d - 0.7], (rotor.radius ?? 48) * 1.03, "z", "grey_plastic"));
    for (const x of [20, w - 20]) for (const y of [22, h - 20]) extra.push(screw(`gpu-${x}-${y}`, [x, y, 3.5], "z"));
    for (let i = 0; i < 7; i++) extra.push(box(`gpu-back-vent-${i}`, [w - 30, 28 + i * 10, 3.4], [27, 3, 0.5], "silicon"));
  }
  if (source.catalogId === "corsair-cx550") {
    const grille = solids.find((solid) => solid.id === "fan-grille");
    if (grille) { grille.shape = "ring"; grille.radius = 52; }
    for (const r of [18, 29, 40]) extra.push(ring(`psu-grille-${r}`, [w / 2, h - 0.6, d / 2], r, "y", "nickel"));
    extra.push(box("psu-grille-cross-x", [w / 2, h - 0.4, d / 2], [108, 1, 2], "nickel"));
    extra.push(box("psu-grille-cross-z", [w / 2, h - 0.4, d / 2], [2, 1, 108], "nickel"));
    for (const x of [9, w - 9]) for (const z of [14, d - 14]) extra.push(screw(`psu-${x}-${z}`, [x, h - 0.3, z]));
    extra.push(box("psu-label-band", [w / 2, 49, d - 0.1], [w * 0.42, 4, 0.3], "gold"));
  }
  if (source.catalogId === "asus-tuf-gaming-z790-plus-wifi") {
    for (let i = 0; i < 12; i++) {
      extra.push({ id: `detail-vrm-cap-${i}`, shape: "cylinder", at: [60, 5.1, 28 + i * 8], radius: 2.3, height: 7, axis: "y", finish: "nickel", role: "detail", basis: "schematic" });
      extra.push(box(`board-chip-${i}`, [208 + (i % 2) * 12, 2.6, 177 + Math.floor(i / 2) * 16], [7, 2, 10], "silicon"));
      extra.push(box(`board-trace-${i}`, [112, 1.68, 185 + i * 7], [42 + (i % 3) * 10, 0.08, 0.45], "copper"));
    }
    for (const port of Object.values(source.ports)) {
      if (port.facing[1] <= 0 || !port.size) continue;
      const [x, y, z] = port.at;
      const pins = port.solid === "atx-24" ? 12 : port.solid.startsWith("eps") ? 4 : 3;
      for (let i = 0; i < pins; i++) extra.push(box(`pin-${port.solid}-${i}`, [x + (i - (pins - 1) / 2) * Math.min(2, port.size[0] / pins), y + 0.3, z], [0.6, 0.6, 1.8], "gold"));
    }
  }
  if (source.catalogId === "arctic-liquid-freezer-iii-280") liquidCooler280(solids, extra);
  // The case's two fans: a light ring on each face of the frame, just outside the blades.
  if (source.catalogId === "corsair-airguide-120-4000d") for (const z of [0.8, d - 0.8]) extra.push(rgbRing(`fan-${z}`, [w / 2, h / 2, z], 55.5, "z"));
  // The i9-14900K shares the i5's LGA1700 package and lid, so it gets the same lid markings.
  if (source.catalogId === "intel-core-i5-14600k" || source.catalogId === "intel-core-i9-14900k") {
    extra.push(box("cpu-lid-mark", [w / 2, h - 0.01, d / 2], [14, 0.02, 8], "brushed_mark"));
    for (let i = 0; i < 4; i++) extra.push(box(`cpu-mark-line-${i}`, [w / 2 - 1, h, d / 2 - 2.7 + i * 1.6], [9 - i, 0.02, 0.3], "nickel"));
  }
  if (source.catalogId === "samsung-990-pro-1tb") {
    for (let i = 0; i < 18; i++) extra.push(box(`ssd-code-${i}`, [29 + i * 1.7, 2.27, d / 2], [i % 3 === 0 ? 1 : 0.45, 0.02, 8 + (i % 3) * 2], "silicon"));
    for (const x of [10, 23, 48, 70]) extra.push(box(`ssd-component-${x}`, [x, 1.1, 2.3], [2.1, 0.7, 1.4], "nickel"));
  }
  if (source.catalogId === "corsair-vengeance-rgb-ddr5-6000-32gb-kit") {
    for (const z of [0.02, d - 0.02]) {
      for (let i = 0; i < 7; i++) extra.push(box(`ram-rib-${z}-${i}`, [19 + i * 16, 22, z], [1, 19, 0.04], "grey_plastic"));
      extra.push(box(`ram-badge-${z}`, [w / 2, 22, z], [23, 8, 0.05], "brushed_mark"));
    }
  }
  refine(source, solids, extra);
  return extra.length ? { ...source, solids: [...solids, ...extra] } : source;
}

// ---------- ARCTIC Liquid Freezer III 280 ----------
//
// The generator draws every AIO from its catalog size (here 317 x 138 x 38 mm, two 140 mm fans). This
// adds what makes it read as one: real 25 mm fan frames with an opening, corner screws and motor
// struts; the flat coolant tubes running through the fins; end tanks with a fill port; and a square
// pump block with an offset cap and two hose fittings, matched by two fittings on the radiator's
// end tank. Every added solid moves with its own body (`group`), so nothing is left on the bench.
// Coordinates are the part's own frame as generated: radiator x 0..317, y 0..138, z 0..63 (fans on +z);
// the block's cold plate centred at x 375, z 48, on y 0.

const RL = 317;
const RW = 138;
const RT = 38;
const FAN_T = 25;
/** Where each hose meets its body, and the way it leaves (in the part's frame): block first, radiator second. */
export const HOSE_ROUTES: Record<string, { block: { at: Vec3; dir: Vec3 }[]; radiator: { at: Vec3; dir: Vec3 }[]; radius: number }> = {
  "arctic-liquid-freezer-iii-280": {
    block: [{ at: [397, 46, 37], dir: [0, 1, 0] }, { at: [397, 46, 59], dir: [0, 1, 0] }],
    // Both on the end tank's back, side by side across the radiator, so the two hoses run beside each other.
    radiator: [{ at: [303, RW / 2 - 13, -10], dir: [0, 0, -1] }, { at: [303, RW / 2 + 13, -10], dir: [0, 0, -1] }],
    radius: 6.2,
  },
};

const turnZ = (deg: number): Quat => [0, 0, Math.sin((deg * Math.PI) / 360), Math.cos((deg * Math.PI) / 360)];

function liquidCooler280(solids: Solid[], extra: Solid[]) {
  const rad = (s: Solid): Solid => ({ ...s, group: "radiator" });
  const blk = (s: Solid): Solid => ({ ...s, group: "block" });
  // Radiator core: denser fins, and the flat tubes the coolant runs through.
  const core = solids.find((solid) => solid.id === "radiator-core");
  if (core) core.count = 150;
  for (let k = 0; k < 12; k++) extra.push(rad(box(`rad-tube-${k}`, [14 + 277 / 2, 2 + 11 * (k + 0.5), RT / 2], [277, 1.4, RT - 1], "black_metal")));
  for (const y of [1, RW - 1]) extra.push(rad(box(`rad-rail-${y}`, [14 + 277 / 2, y, RT / 2], [277, 2, RT], "black_metal")));
  // End tanks: a fill port on the far one; the near one carries the two hose fittings.
  extra.push(rad({ ...screw("rad-fill-port", [-0.6, RW / 2, RT / 2], "x"), radius: 5 }));
  const cap = solids.find((solid) => solid.id === "hose-fittings");
  if (cap) { cap.at = [311, RW / 2, RT / 2]; cap.size = [12, RW - 12, RT]; cap.finish = "black_plastic"; }
  for (const route of HOSE_ROUTES["arctic-liquid-freezer-iii-280"]!.radiator) {
    const [x, y] = route.at;
    extra.push(rad({ id: `detail-rad-fitting-${y}`, shape: "cylinder", at: [x, y, -4.5], radius: 7, height: 11, axis: "z", finish: "black_metal", role: "detail", basis: "schematic" }));
    extra.push(rad(ring(`rad-fitting-collar-${y}`, [x, y, -1.5], 7.4, "z", "nickel")));
  }
  // Fans: the generator's plate behind each rotor becomes a real 25 mm frame with a round opening.
  for (const frame of solids.filter((solid) => solid.id.startsWith("fan-frame-") && solid.size)) {
    const [cx, cy] = frame.at;
    const half = frame.size![0] / 2;
    const z = RT + FAN_T / 2;
    frame.at = [cx - half + 3.5, cy, z];
    frame.size = [7, half * 2, FAN_T];
    frame.finish = "black_plastic";
    extra.push(rad(box(`${frame.id}-right`, [cx + half - 3.5, cy, z], [7, half * 2, FAN_T], "black_plastic")));
    for (const side of [-1, 1]) extra.push(rad(box(`${frame.id}-edge-${side}`, [cx, cy + side * (half - 3.5), z], [half * 2 - 14, 7, FAN_T], "black_plastic")));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const at: Vec3 = [cx + sx * (half - 9), cy + sy * (half - 9), z];
      extra.push(rad(box(`${frame.id}-corner-${sx}-${sy}`, at, [16, 16, FAN_T], "black_plastic")));
      extra.push(rad(screw(`${frame.id}-screw-${sx}-${sy}`, [at[0] + sx * 1.5, at[1] + sy * 1.5, RT + FAN_T + 0.6], "z")));
    }
    // The round duct of the frame, at both faces, and the motor mount with three struts on the radiator side.
    for (const face of [RT + 1.2, RT + FAN_T - 1.2]) extra.push(rad(ring(`${frame.id}-duct-${face}`, [cx, cy, face], half - 3, "z", "grey_plastic")));
    extra.push(rgbRing(`${frame.id}-front`, [cx, cy, RT + FAN_T - 0.4], half - 5, "z", "radiator"));
    extra.push(rad({ id: `detail-${frame.id}-motor`, shape: "cylinder", at: [cx, cy, RT + 2.5], radius: 20, height: 3, axis: "z", finish: "black_plastic", role: "detail", basis: "schematic" }));
    for (const deg of [90, 210, 330]) {
      const a = (deg * Math.PI) / 180;
      const len = half - 22;
      extra.push(rad({ ...box(`${frame.id}-strut-${deg}`, [cx + Math.cos(a) * (20 + len / 2), cy + Math.sin(a) * (20 + len / 2), RT + 2.5], [len, 3.2, 3]), rotation: turnZ(deg) }));
    }
  }
  // Pump block: a square housing with rounded edges, an offset round cap and the two hose fittings.
  const pump = solids.find((solid) => solid.id === "pump-block");
  if (pump) { pump.shape = "box"; pump.at = [375, 20, 48]; pump.size = [64, 32, 64]; delete pump.radius; delete pump.height; delete pump.axis; pump.finish = "black_plastic"; }
  const top = solids.find((solid) => solid.id === "pump-cap");
  if (top) { top.at = [369, 38.5, 48]; top.radius = 21; top.height = 5; top.finish = "black_metal"; }
  extra.push(blk(ring("pump-cap-rim", [369, 41.1, 48], 21.4, "y", "nickel")));
  extra.push(rgbRing("pump-cap", [369, 41.4, 48], 17.5, "y", "block"));
  extra.push(blk({ id: "detail-pump-cap-disc", shape: "cylinder", at: [369, 41.2, 48], radius: 13, height: 0.4, axis: "y", finish: "brushed_mark", role: "detail", basis: "schematic" }));
  for (let i = 0; i < 4; i++) extra.push(blk(box(`pump-cap-line-${i}`, [369 - 4 + i * 2.6, 41.45, 48], [1, 0.1, 9 - Math.abs(i - 1.5) * 2], "nickel")));
  const routes = HOSE_ROUTES["arctic-liquid-freezer-iii-280"]!.block;
  solids.filter((solid) => solid.role === "tube").forEach((stub, i) => {
    const route = routes[i];
    if (!route) return;
    stub.at = [route.at[0], route.at[1] - 5, route.at[2]];
    stub.axis = "y";
    stub.radius = 6.6;
    stub.height = 10;
    stub.finish = "black_metal";
    extra.push(blk(ring(`pump-fitting-collar-${i}`, [route.at[0], route.at[1] - 1.5, route.at[2]], 7, "y", "nickel")));
    extra.push(blk({ id: `detail-pump-fitting-base-${i}`, shape: "cylinder", at: [route.at[0], 36.8, route.at[2]], radius: 8.5, height: 1.6, axis: "y", finish: "black_metal", role: "detail", basis: "schematic" }));
  });
  // Mounting bracket: a cross of two bars over the cold plate, with a thumb screw at each end.
  extra.push(blk(box("bracket-bar-z", [375, 5.5, 48], [12, 3, 56], "black_metal")));
  for (const [x, z] of [[343, 48], [407, 48], [375, 23], [375, 73]] as [number, number][]) {
    extra.push(blk({ id: `detail-thumb-screw-${x}-${z}`, shape: "cylinder", at: [x, 9, z], radius: 3.6, height: 6, axis: "y", finish: "nickel", role: "detail", basis: "schematic" }));
  }
  // Small marks on the housing's sides: the seam of the lid and a short vent slot row.
  for (const side of [-1, 1]) extra.push(blk(box(`pump-seam-${side}`, [375, 30.5, 48 + side * 32.05], [60, 0.8, 0.2], "grey_plastic")));
  for (let i = 0; i < 5; i++) extra.push(blk(box(`pump-vent-${i}`, [343 - 0.05, 14 + i * 3.4, 48], [0.2, 1.6, 34], "silicon")));
}

// ---------- Finer surface detail (visual only) ----------
//
// Small parts real hardware shows at a glance: mounting screws, surface-mount parts, audio capacitors,
// heatsink grooves, vents, heat-pipe ends, fan clips. Each one sits on a surface of its part, inside the
// part's catalog size, keeps the part's colours, and never covers a place where something is installed
// or plugged in (slots, socket, cooler area, headers, ports): `clear()` checks that against the part's
// own solids for those places.

/** Solids that are places to install into or plug into: nothing decorative may cover them. */
const PLACE_ROLE = /^(cpu_socket|dimm_slot|m2_slot|pcie_slot|cooler_keepout|port|io_shield|edge_connector)$/;
type Box3 = { min: Vec3; max: Vec3 };
const boxOf = (s: Solid): Box3 => {
  const size = (s.size ?? (["x", "y", "z"] as const).map((a) => (a === (s.axis ?? "y") ? s.height ?? 1 : 2 * (s.radius ?? 1)))) as Vec3;
  return { min: [s.at[0] - size[0] / 2, s.at[1] - size[1] / 2, s.at[2] - size[2] / 2], max: [s.at[0] + size[0] / 2, s.at[1] + size[1] / 2, s.at[2] + size[2] / 2] };
};
const apart = (a: Box3, b: Box3, gap: number) => [0, 2].some((k) => a.max[k] + gap <= b.min[k] || b.max[k] + gap <= a.min[k]);
/** A deterministic sequence, so every load draws the same parts in the same places. */
function sequence(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

function refine(source: PartGeometry, solids: Solid[], extra: Solid[]) {
  const [w, h, d] = source.bounds.size;
  const places = solids.filter((solid) => PLACE_ROLE.test(solid.role)).map(boxOf);
  /** Adds a detail only where it covers no place (seen from above, with a small margin). */
  const clear = (detail: Solid, gap = 1.5) => { if (places.every((place) => apart(boxOf(detail), place, gap))) extra.push(detail); };
  const id = source.catalogId;

  if (id === "asus-tuf-gaming-z790-plus-wifi") {
    // Mounting screws in the nine standoff holes: a pan head with a cross slot.
    for (const hole of solids.filter((solid) => solid.id.startsWith("mount-hole-"))) {
      const [x, , z] = hole.at;
      clear({ id: `detail-board-screw-${hole.id}`, shape: "cylinder", at: [x, 2.2, z], radius: 3.4, height: 1.2, axis: "y", finish: "nickel", role: "detail", basis: "schematic" }, 0.5);
      clear(box(`board-screw-slot-${hole.id}-a`, [x, 2.85, z], [4.2, 0.1, 0.7], "black_metal"), 0.5);
      clear(box(`board-screw-slot-${hole.id}-b`, [x, 2.85, z], [0.7, 0.1, 4.2], "black_metal"), 0.5);
    }
    // Surface-mount resistors and capacitors scattered over the free board.
    const random = sequence(7);
    for (let i = 0; i < 90; i++) {
      const at: Vec3 = [8 + random() * (w - 16), 1.9, 8 + random() * (d - 16)];
      const long = random() > 0.5;
      clear(box(`board-smd-${i}`, at, long ? [1.6, 0.55, 0.8] : [0.8, 0.55, 1.6], random() > 0.7 ? "nickel" : "silicon"), 2);
    }
    // Audio corner: capacitors beside the audio isolation line.
    for (let i = 0; i < 6; i++) clear({ id: `detail-audio-cap-${i}`, shape: "cylinder", at: [14 + (i % 2) * 9, 4.6, 258 + Math.floor(i / 2) * 11], radius: 3.1, height: 6, axis: "y", finish: "gold", role: "detail", basis: "schematic" }, 1);
    clear(box("audio-isolation-line", [36, 1.62, 262], [0.5, 0.06, 70], "gold"), 0.5);
    // Grooves across the chipset heatsink, and fine ridges along the top of the VRM heatsinks.
    const chipset = solids.find((solid) => solid.id === "chipset");
    if (chipset?.size) for (let i = 0; i < 6; i++) extra.push(box(`chipset-groove-${i}`, [chipset.at[0], chipset.at[1] + chipset.size[1] / 2 + 0.03, chipset.at[2] - chipset.size[2] / 2 + 8 + i * ((chipset.size[2] - 16) / 5)], [chipset.size[0] - 6, 0.1, 1.1], "silicon"));
    for (const sink of solids.filter((solid) => solid.id === "vrm-left" || solid.id === "vrm-top")) {
      if (!sink.size) continue;
      extra.push(box(`${sink.id}-cap`, [sink.at[0], sink.at[1] + sink.size[1] / 2 + 0.2, sink.at[2]], [sink.size[0] - 1, 0.4, sink.size[2] - 1], "brushed_mark"));
    }
  }

  if (id === "corsair-4000d-airflow-black") {
    // Vent slots in the power-supply shroud's top, thumbscrews on the rear, a grille behind the rear fan place.
    const shroud = solids.find((solid) => solid.id === "psu-shroud");
    if (shroud?.size) for (let i = 0; i < 14; i++) extra.push(box(`shroud-vent-${i}`, [shroud.at[0] - shroud.size[0] * 0.38 + i * 9, shroud.at[1] + shroud.size[1] / 2 + 0.05, shroud.at[2]], [4, 0.2, shroud.size[2] * 0.5], "black_plastic"));
    for (const [y, z] of [[30, 20], [30, d - 20], [h - 30, 20], [h - 30, d - 20]] as [number, number][]) {
      extra.push({ id: `detail-rear-thumbscrew-${y}-${z}`, shape: "cylinder", at: [0.8, y, z], radius: 4, height: 1.6, axis: "x", finish: "black_metal", role: "detail", basis: "schematic" });
    }
    const rear = source.mounts["fan-rear-1"];
    if (rear) for (const r of [14, 28, 42, 54]) extra.push(ring(`rear-grille-${r}`, [1.2, rear.at[1], rear.at[2]], r, "x", "black_metal"));
  }

  if (id === "asus-dual-rtx4060-o8g") {
    // Fan hub caps, the heat pipes' bent ends at both sides, and vent slots in the backplate.
    for (const rotor of solids.filter((solid) => solid.shape === "rotor")) {
      extra.push({ id: `detail-${rotor.id}-cap`, shape: "cylinder", at: [rotor.at[0], rotor.at[1], d - 0.2], radius: 13, height: 0.6, axis: "z", finish: "black_plastic", role: "detail", basis: "schematic" });
      extra.push(ring(`${rotor.id}-cap-rim`, [rotor.at[0], rotor.at[1], d - 0.05], 13.2, "z", "grey_plastic"));
    }
    for (const pipe of solids.filter((solid) => solid.id.startsWith("heat-pipe-"))) {
      for (const x of [5, w - 5]) extra.push({ id: `detail-${pipe.id}-end-${x}`, shape: "cylinder", at: [x, pipe.at[1], pipe.at[2] + 6], radius: 3, height: 12, axis: "z", finish: "nickel", role: "detail", basis: "schematic" });
    }
    for (let i = 0; i < 10; i++) extra.push(box(`gpu-backplate-vent-${i}`, [150 + i * 6.5, 72, -0.12], [3, 52, 0.2], "black_plastic"));
  }

  if (id === "corsair-cx550") {
    // Rubber feet on the base, and a thin chamfer trim along the fan side's edges.
    for (const [x, z] of [[12, 12], [w - 12, 12], [12, d - 12], [w - 12, d - 12]] as [number, number][]) extra.push({ id: `detail-psu-foot-${x}-${z}`, shape: "cylinder", at: [x, 0.6, z], radius: 5, height: 1.2, axis: "y", finish: "rubber", role: "detail", basis: "schematic" });
    for (const z of [1, d - 1]) extra.push(box(`psu-top-trim-${z}`, [w / 2, h - 1, z], [w - 2, 2, 2], "grey_plastic"));
    for (const x of [1, w - 1]) extra.push(box(`psu-top-trim-x-${x}`, [x, h - 1, d / 2], [2, 2, d - 4], "grey_plastic"));
  }

  if (id === "arctic-freezer-36") {
    // The wire clips that hold each fan to the fin stack, and a logo plate on the top cover.
    for (const frame of solids.filter((solid) => solid.id.startsWith("fan-frame-") && solid.size)) {
      const inner = frame.at[0] < w / 2 ? frame.at[0] + 13 : frame.at[0] - 13;
      for (const y of [44, h - 12]) extra.push(box(`${frame.id}-clip-${y}`, [inner, y, d / 2], [1.2, 1.2, d - 30], "nickel"));
    }
    extra.push(box("cooler-logo-plate", [w / 2, h - 0.05, d / 2], [30, 0.1, 10], "brushed_mark"));
  }

  if (id === "samsung-990-pro-1tb") {
    // Passive parts beside the controller and the printed lines of the label.
    for (let i = 0; i < 8; i++) extra.push(box(`ssd-passive-${i}`, [6 + (i % 4) * 2.2, 1.0, 4 + Math.floor(i / 4) * 14], [1.2, 0.4, 0.7], "nickel"));
    for (let i = 0; i < 4; i++) extra.push(box(`ssd-label-line-${i}`, [42 + i * 0.5, 2.26, 8 + i * 2.2], [28 - i * 4, 0.02, 0.5], "silicon"));
  }

  if (id === "corsair-vengeance-rgb-ddr5-6000-32gb-kit") {
    // The heat spreader's two halves meet at a seam along the top; the PCB shows between the clips.
    extra.push(box("ram-spreader-seam", [w / 2, 35.2, 3.5], [w - 8, 0.4, 0.5], "silicon"));
  }

  if (id === "intel-core-i5-14600k" || id === "intel-core-i9-14900k") {
    // The substrate's fine passive row along one long edge, outside the lid.
    for (let i = 0; i < 10; i++) extra.push(box(`cpu-passive-${i}`, [6 + i * 3.6, 1.85, d - 2.8], [1.4, 0.3, 0.7], "nickel"));
  }
}
