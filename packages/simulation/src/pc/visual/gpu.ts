// Schematic geometry for a graphics card: x along its length from the bracket, y up from the slot edge,
// z through its thickness with the fans on the +z face. Length, height, thickness, fan count and
// connector counts come from the catalog; positions on the card are schematic.
import type { GpuEntry } from "@ytl/contracts";
import { Builder, IDENTITY } from "./build";
import { EDUCATIONAL_LABEL, GEOMETRY_SCHEMA, type PartGeometry } from "./types";

/** Width of one expansion slot (the 20.32 mm pitch of the ATX standard). */
const SLOT_PITCH = 20.32;

export function gpuGeometry(entry: GpuEntry, catalogVersion: string): PartGeometry {
  const L = entry.spec.lengthMm;
  const H = entry.dimensions.widthMm ?? 120;
  const T = entry.dimensions.heightMm ?? (entry.spec.slotThickness ?? 2) * SLOT_PITCH;
  const b = new Builder();
  const edge = 12; // the gold edge connector hangs below the card body

  b.box("backplate", "backplate", [0, edge, 0], [L, H - edge, 3], "schematic", { finish: "black_metal" });
  b.box("pcb", "pcb", [0, edge, 3], [L * 0.8, H - edge - 14, 1.6], "schematic", { finish: "pcb_black" });
  // The cooler: a long stack of thin fins with heat pipes through it, under the shroud and fans.
  b.fins("heatsink", "heatsink", [6, edge + 4, 4.6], [L - 12, H - edge - 8, T - 14], Math.round((L - 12) / 2.2), "x", "schematic", { finish: "aluminium" });
  for (let i = 0; i < 4; i += 1) b.cylinder(`heat-pipe-${i + 1}`, "tube", [L / 2, edge + 14 + i * ((H - edge - 28) / 3), 7], 3, L - 30, "x").finish = "nickel";
  // The shroud stops just short of the fan faces so the fans are the outermost surface.
  b.box("shroud", "shroud", [2, edge, T - 10], [L - 2, H - edge - 0.5, 9.5], "catalog", { finish: "black_plastic" });
  b.box("bracket", "bracket", [0, 0, 0], [1.5, H, T], "catalog", { finish: "nickel" });
  b.fins("bracket-vent", "grille", [0, edge + 4, T * 0.5], [1.6, H - edge - 30, T * 0.45], 6, "y", "schematic", { finish: "black_metal" });
  b.fins("edge-connector", "edge_connector", [14, 0, 3], [89, edge, 1.6], 60, "x", "standard", { finish: "gold" });

  // Fans: as many as the product page states, evenly spaced along the shroud.
  const fans = entry.spec.fanCount ?? 0;
  const span = (L - 16) / Math.max(fans, 1);
  const radius = Math.min(span, H - edge - 10) / 2 - 2;
  for (let i = 0; i < fans; i += 1) b.rotor(`fan-${i + 1}`, [8 + span * (i + 0.5), edge + (H - edge) / 2, T - 3], radius, 6, "z", 11, "schematic", { finish: "black_plastic" });

  // Power sockets open upward on the top edge; display outputs open out of the bracket.
  const power = entry.ports.filter((p) => p.function === "gpu_power");
  power.forEach((p, i) => (b.port(p, [L * 0.62 + i * 24, H - 9, T * 0.4], [p.connector === "pcie_8pin" || p.connector === "pcie_6pin" ? 18 : 20, 9, 9], [0, 1, 0]).finish = "black_plastic"));
  const outs = entry.ports.filter((p) => p.function === "display_out");
  const pitch = (H - edge - 20) / Math.max(outs.length, 1);
  outs.forEach((p, i) => b.port(p, [0, edge + 10 + i * pitch, T * 0.25], [1.5, p.connector === "hdmi" ? 6 : 5, 15], [-1, 0, 0]));

  // Light sources exist only where the catalog entry has lighting hardware: a strip on the top edge per zone.
  const lights = (entry.rgb?.zones ?? []).map((zone, i) => {
    const id = `light-${zone}`;
    b.box(id, "light", [L * 0.2 + i * (L * 0.2), H - 3, T - 8], [L * 0.16, 3, 5], "schematic", { finish: "white_plastic" });
    return { zone, solids: [id] };
  });

  const zoneSolids: Record<string, string[]> = {
    "power-socket": power.map((p) => p.id),
    "display-outputs": outs.map((p) => p.id),
    "slot-edge": ["edge-connector", "bracket"],
  };
  return {
    schema: GEOMETRY_SCHEMA,
    catalogId: entry.id,
    catalogVersion,
    units: "mm",
    bounds: { size: [L, H, Math.round(T * 10) / 10], basis: { x: "catalog", y: "catalog", z: "catalog" } },
    solids: b.solids,
    // The start of the edge connector meets the start of the slot; the card stands on the board.
    attach: { main: { at: [14, 0, 3.8], quat: IDENTITY } },
    mounts: b.mounts,
    ports: b.ports,
    leads: {},
    zones: Object.fromEntries(entry.zones.map((zn) => [zn.id, { solids: zoneSolids[zn.id] ?? [] }])),
    lights,
    label: EDUCATIONAL_LABEL,
  };
}
