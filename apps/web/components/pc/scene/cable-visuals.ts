import type { Vec3 } from "./geometry";

/** A lifted, floor-safe visual route; routing is cosmetic and never changes simulation results. */
export function cableRoutePoints(from: Vec3, to: Vec3): Vec3[] {
  const span = Math.hypot(...from.map((value, i) => to[i] - value));
  const lift = Math.min(48, Math.max(12, span * 0.12));
  const y = Math.max(8, Math.min(from[1], to[1]) + lift);
  return [from, [from[0], Math.max(from[1] + 8, y), from[2] + lift],
    [to[0], Math.max(to[1] + 8, y), to[2] + lift], to];
}

/** Connector silhouettes are intentionally distinct; these are schematic dimensions in millimetres. */
export function connectorSize(kind: string): [number, number, number] {
  if (kind === "atx_main") return [12, 12, 48];
  if (kind === "cpu_power" || kind === "gpu_power" || kind === "gpu_power_adapter") return [18, 10, 12];
  if (kind === "sata_power" || kind === "sata_data") return [22, 5, 8];
  if (kind === "fan_lead" || kind === "pump_lead") return [10, 6, 6];
  if (kind === "front_panel_lead") return [6, 6, 5];
  return [12, 7, 8];
}
