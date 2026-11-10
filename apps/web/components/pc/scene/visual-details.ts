import type { PartGeometry, Solid, Vec3 } from "./geometry";

const box = (id: string, at: Vec3, size: Vec3, finish = "black_metal"): Solid => ({ id: `detail-${id}`, shape: "box", at, size, finish, role: "detail", basis: "schematic" });
const ring = (id: string, at: Vec3, radius: number, axis: "x" | "y" | "z", finish = "black_metal"): Solid => ({ id: `detail-${id}`, shape: "ring", at, radius, height: 1, axis, finish, role: "detail", basis: "schematic" });
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
  if (source.catalogId === "intel-core-i5-14600k") {
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
  return extra.length ? { ...source, solids: [...solids, ...extra] } : source;
}
