// Schematic geometry for a motherboard, laid flat: x runs from the rear-I/O edge to the right edge,
// z from the top edge to the bottom edge, y up from the board. Outline and counts come from the catalog;
// positions are schematic (manufacturers do not publish connector coordinates).
import type { MotherboardEntry, PortFunction, PortSpec } from "@ytl/contracts";
import { Builder, IDENTITY, TURN_Y, printedLabel } from "./build";
import { EDUCATIONAL_LABEL, GEOMETRY_SCHEMA, type PartGeometry, type Vec3 } from "./types";

const PCB = 1.6;
const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];

export function motherboardGeometry(entry: MotherboardEntry, catalogVersion: string): PartGeometry {
  const W = entry.dimensions.widthMm ?? 244;
  const L = entry.dimensions.lengthMm ?? 305;
  const b = new Builder();
  const by = (...fns: PortFunction[]) => entry.ports.filter((p) => fns.includes(p.function));

  b.box("pcb", "pcb", [0, 0, 0], [W, PCB, L], "catalog", { finish: "pcb_black" });
  // Mounting holes where the standoffs go (nine on an ATX board; positions schematic), and the CMOS battery.
  const holes: [number, number][] = [[6, 10], [6, 160], [6, 290], [128, 10], [128, 160], [128, 290], [236, 10], [236, 160], [236, 290]];
  holes.forEach(([x, z], i) => b.cylinder(`mount-hole-${i + 1}`, "plate", [Math.min(x, W - 4), PCB / 2, Math.min(z, L - 4)], 3.2, PCB, "y").finish = "gold");
  b.cylinder("cmos-battery", "plate", [0.62 * W, PCB + 1.6, 0.88 * L], 10, 3.2, "y", "standard").finish = "nickel";

  // Rear I/O cover, with the catalog's rear ports opening out of the back edge.
  const ioZ = 0.05 * L;
  b.box("rear-io", "io_shield", [0, PCB, ioZ], [0.16 * W, 34, 0.5 * L], "schematic", { finish: "black_metal" });
  by("display_out").forEach((p, i) => b.port(p, [0, PCB + 6, ioZ + 14 + i * 24], [14, p.connector === "hdmi" ? 6 : 5, 16], [-1, 0, 0]));
  // The rest of the back panel as the spec page lists it, stacked in columns along the I/O cover.
  const SOCKET: Record<string, { y: number; z: number; label: string }> = {
    usb_a: { y: 6, z: 13, label: "USB-A" },
    usb_c: { y: 3.5, z: 9, label: "USB-C" },
    ethernet: { y: 13, z: 16, label: "LAN" },
    audio_jack: { y: 6, z: 6, label: "AUDIO" },
    optical_spdif: { y: 6, z: 6, label: "S/PDIF" },
    wifi_antenna: { y: 6, z: 6, label: "WI-FI" },
    bios_flashback_button: { y: 5, z: 5, label: "FLASHBACK" },
    hdmi: { y: 6, z: 16, label: "HDMI" },
    displayport: { y: 5, z: 16, label: "DP" },
  };
  let colZ = ioZ + 14 + by("display_out").length * 24 + 4;
  let y = PCB + 3;
  let colWidth = 0;
  for (const item of entry.spec.rearPanel ?? []) {
    if (item.portId) continue;
    const sock = SOCKET[item.kind]!;
    for (let k = 0; k < item.count; k += 1) {
      if (y + sock.y > PCB + 32) {
        colZ += colWidth + 4;
        y = PCB + 3;
        colWidth = 0;
      }
      b.box(`rear-${item.kind.replace(/_/g, "-")}-${k + 1}-${Math.round(colZ)}-${Math.round(y)}`, "port", [0, y, colZ], [3, sock.y, sock.z], "catalog", { facing: [-1, 0, 0], ...(k === 0 ? { label: sock.label } : {}) });
      y += sock.y + 2;
      colWidth = Math.max(colWidth, sock.z);
    }
  }

  // Finned heatsinks over the power stages around the socket, and a flat one over the chipset.
  b.fins("vrm-left", "heatsink", [0.19 * W, PCB, 0.1 * L], [0.1 * W, 28, 0.28 * L], 14, "z", "schematic", { finish: "black_metal" });
  b.fins("vrm-top", "heatsink", [0.31 * W, PCB, 0.075 * L], [0.3 * W, 24, 0.045 * L], 16, "x", "schematic", { finish: "black_metal" });
  b.box("chipset", "heatsink", [0.76 * W, PCB, 0.62 * L], [0.17 * W, 9, 0.2 * L], "schematic", { finish: "black_metal", label: entry.spec.chipset.replace(/^Intel |^AMD /, "") });
  // The power stages under the heatsinks show as a row of chokes along their inner edge.
  b.fins("vrm-chokes", "chip", [0.29 * W, PCB, 0.12 * L], [6, 6, 0.24 * L], 8, "z", "schematic", { finish: "silicon" });

  // Socket and the cooler position around it.
  const sx = 0.33 * W;
  const sz = 0.145 * L;
  for (const m of entry.mountPoints) {
    if (m.kind === "cpu_socket") {
      const s = b.box(m.id, "cpu_socket", [sx, PCB, sz], [54, 6, 54], "schematic", { finish: "black_plastic", label: m.socket.toUpperCase() });
      b.mount(m.id, s, [sx + 27, PCB + 6, sz + 27], IDENTITY, DOWN, 25);
      // The retention mechanism: a load plate over the socket frame and the lever along one side.
      b.box(`${m.id}-load-plate`, "plate", [sx + 2, PCB + 6, sz + 2], [50, 0.8, 4], "schematic", { finish: "nickel" });
      b.box(`${m.id}-load-plate-far`, "plate", [sx + 2, PCB + 6, sz + 48], [50, 0.8, 4], "schematic", { finish: "nickel" });
      b.cylinder(`${m.id}-lever`, "plate", [sx + 57, PCB + 2, sz + 27], 1, 54, "z").finish = "nickel";
    } else if (m.kind === "cpu_cooler_mount") {
      const s = b.box(m.id, "cooler_keepout", [sx - 14, PCB, sz - 14], [82, 1, 82]);
      b.mount(m.id, s, [sx + 27, PCB + 10, sz + 27], IDENTITY, DOWN, 60);
    }
  }

  // Memory slots, in the catalog's order (A1, A2, B1, B2) left to right.
  const dimms = entry.mountPoints.filter((m) => m.kind === "dimm_slot");
  dimms.forEach((m, i) => {
    const x = 0.66 * W + i * 9.5;
    const z = 0.05 * L;
    const s = b.box(m.id, "dimm_slot", [x, PCB, z], [7, 9, 142], "schematic", { finish: i % 2 ? "black_plastic" : "grey_plastic", label: printedLabel(m.label.en, m.id) });
    b.mount(m.id, s, [x + 3.5, PCB + 9, z + 142], TURN_Y, DOWN, 35);
    // The latch at the slot's far end (one-latch slots: the near end is fixed).
    b.box(`${m.id}-latch`, "plate", [x - 0.5, PCB + 9, z + 142 - 6], [8, 3, 6], "schematic", { finish: "grey_plastic" });
  });

  // First M.2 slot above the expansion slot, the others below it.
  const slotX = 0.17 * W;
  const z0 = 0.5 * L;
  const m2 = entry.mountPoints.filter((m) => m.kind === "m2_slot");
  const m2Slot = (m: (typeof m2)[number], z: number) => {
    const len = m.kind === "m2_slot" && m.lengths.includes("m2_22110") ? 110 : 80;
    const s = b.box(m.id, "m2_slot", [slotX, PCB, z], [len + 8, 5, 24], "schematic", { finish: "black_plastic", label: printedLabel(m.label.en, m.id) });
    // The drive slides in sideways, but the slot is seen from above.
    b.mount(m.id, s, [slotX + 2, PCB + 3, z + 12], IDENTITY, [-1, 0, 0], 20, UP);
  };
  if (m2[0]) m2Slot(m2[0], z0 - 30);
  entry.mountPoints
    .filter((m) => m.kind === "pcie_slot")
    .forEach((m, i) => {
      const z = z0 + i * 61;
      const s = b.box(m.id, "pcie_slot", [slotX, PCB, z], [89, 11, 7.5], "standard", { finish: "nickel", label: m.kind === "pcie_slot" ? `PCIE ${m.mechanical.toUpperCase()}` : "" });
      b.mount(m.id, s, [slotX, PCB + 11, z + 3.75], IDENTITY, DOWN, 25);
      // The release latch at the slot's inner end.
      b.box(`${m.id}-latch`, "plate", [slotX + 89, PCB, z - 1], [6, 9, 9.5], "schematic", { finish: "black_plastic" });
    });
  m2.slice(1).forEach((m, i) => m2Slot(m, z0 + 16 + i * 28));

  // Headers and power sockets along the edges where such connectors normally sit.
  const rail = (list: PortSpec[], start: Vec3, step: Vec3, size: Vec3) =>
    list.forEach((p, i) => b.port(p, [start[0] + step[0] * i, start[1], start[2] + step[2] * i], size, UP));
  rail(by("cpu_power"), [0.2 * W, PCB, 2], [15, 0, 0], [13, 12, 10]);
  rail(by("pump_header", "cpu_fan_header"), [0.5 * W, PCB, 2], [11, 0, 0], [8, 9, 3]);
  by("atx_main_power").forEach((p) => b.port(p, [W - 12, PCB, 0.2 * L], [10, 13, 52], UP));
  rail(by("front_usb_c", "front_usb3"), [W - 14, PCB, 0.42 * L], [0, 0, 26], [12, 9, 22]);
  rail(by("sata_data"), [W - 9, PCB, 0.62 * L], [0, 0, 14], [7, 8, 12]);
  // Bottom edge, left to right: audio, lighting, USB 2.0, chassis fans, system panel pin pairs.
  const bottom = [...by("front_audio"), ...by("argb_header", "rgb_header"), ...by("front_usb2"), ...by("system_fan_header"), ...by("power_switch", "reset_switch", "power_led", "drive_led")];
  const pitch = (W - 20) / Math.max(bottom.length, 1);
  bottom.forEach((p, i) => b.port(p, [10 + i * pitch, PCB, L - 8], [Math.min(pitch - 2, p.connector === "front_panel_2pin" ? 5 : 12), 9, 5], UP));

  const zoneSolids: Record<string, string[]> = {
    "cpu-area": ["vrm-left", "vrm-top", ...entry.mountPoints.filter((m) => m.kind === "cpu_socket").map((m) => m.id)],
    "memory-slots": dimms.map((m) => m.id),
    "rear-io": ["rear-io", ...by("display_out").map((p) => p.id)],
    "system-panel": by("power_switch", "reset_switch", "power_led", "drive_led").map((p) => p.id),
  };
  return {
    schema: GEOMETRY_SCHEMA,
    catalogId: entry.id,
    catalogVersion,
    units: "mm",
    bounds: { size: [W, b.height(), L], basis: { x: "catalog", y: "schematic", z: "catalog" } },
    solids: b.solids,
    // The board lies on the tray's standoffs: its underside corner meets the tray frame.
    attach: { main: { at: [0, 0, 0], quat: IDENTITY } },
    mounts: b.mounts,
    ports: b.ports,
    leads: {},
    zones: Object.fromEntries(entry.zones.map((zn) => [zn.id, { solids: zoneSolids[zn.id] ?? [] }])),
    lights: [],
    label: EDUCATIONAL_LABEL,
  };
}
