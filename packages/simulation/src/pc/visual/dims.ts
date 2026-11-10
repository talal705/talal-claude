// Which catalog dimension each geometry axis must equal, per category. Shared by the generators and the validator
// so "the drawing follows the catalog" is one rule, not two.
import type { CatalogEntry } from "@ytl/contracts";

export type Axis = "x" | "y" | "z";

/** Axis -> catalog value in millimetres, only for dimensions the catalog actually has. */
export function catalogAxes(entry: CatalogEntry): Partial<Record<Axis, number>> {
  const d = entry.dimensions;
  const out: Partial<Record<Axis, number>> = {};
  const set = (axis: Axis, value: number | null) => {
    if (value !== null) out[axis] = value;
  };
  switch (entry.category) {
    case "case": // length front to back, height, width across the side panels
      set("x", d.lengthMm); set("y", d.heightMm); set("z", d.widthMm);
      break;
    case "motherboard": // laid flat: width across, length top to bottom
      set("x", d.widthMm); set("z", d.lengthMm);
      break;
    case "cpu":
      set("x", d.lengthMm); set("z", d.widthMm);
      break;
    case "gpu": // length, height above the slot, thickness
      set("x", entry.spec.lengthMm); set("y", d.widthMm); set("z", d.heightMm);
      break;
    case "psu":
    case "storage":
      set("x", d.lengthMm); set("y", d.heightMm); set("z", d.widthMm);
      break;
    case "fan": // square face, thickness along the airflow
      set("x", d.lengthMm); set("y", d.widthMm); set("z", d.heightMm);
      break;
    case "cooling": // an AIO is several bodies joined by hoses, so its bounds are not one catalog size
      if (entry.spec.type === "air") { set("x", d.lengthMm); set("y", d.heightMm); set("z", d.widthMm); }
      break;
    default:
      break;
  }
  return out;
}
