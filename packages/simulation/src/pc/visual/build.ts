// Small builder shared by the per-category generators. Generators think in minimum corners;
// the schema stores centres, so the conversion happens here, once.
import type { ConnectorType, PortSpec } from "@ytl/contracts";
import type { Basis, MountGeometry, PortGeometry, Quat, Solid, SolidRole, Vec3 } from "./types";

export const IDENTITY: Quat = [0, 0, 0, 1];
/** Quarter turn about +y. */
export const TURN_Y: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
export const r1 = (n: number) => Math.round(n * 10) / 10;
const v = (a: Vec3): Vec3 => [r1(a[0]), r1(a[1]), r1(a[2])];

/** Pin count, only when the connector's own name states one. */
export function statedPins(c: ConnectorType): number | undefined {
  if (c === "pcie_12vhpwr" || c === "pcie_12v_2x6") return 16;
  const m = /(\d+)pin/.exec(c);
  return m ? Number(m[1]) : undefined;
}

/** The marking printed next to a connector: the code in the label's brackets when it has one, else the ID. */
export function printedLabel(labelEn: string, id: string): string {
  // A code with an underscore (DIMM_A1, CPU_FAN, M.2_1) wins over a bracketed word such as "(DDR5)".
  const code = /\b([A-Z][A-Z0-9.]*_[A-Z0-9_]+)\b/.exec(labelEn)?.[1] ?? /\(([A-Z0-9][A-Z0-9_.]*[A-Z0-9])\)/.exec(labelEn)?.[1];
  return code ?? id.toUpperCase();
}

export class Builder {
  readonly solids: Solid[] = [];
  readonly mounts: Record<string, MountGeometry> = {};
  readonly ports: Record<string, PortGeometry> = {};

  /** `min` is the minimum corner. */
  box(id: string, role: SolidRole, min: Vec3, size: Vec3, basis: Basis = "schematic", extra: Partial<Solid> = {}): Solid {
    const solid: Solid = { id, shape: "box", at: v([min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2]), size: v(size), role, basis, ...extra };
    this.solids.push(solid);
    return solid;
  }

  /** `centre` is the centre of the cylinder; `height` runs along `axis`. */
  cylinder(id: string, role: SolidRole, centre: Vec3, radius: number, height: number, axis: "x" | "y" | "z", basis: Basis = "schematic"): Solid {
    const solid: Solid = { id, shape: "cylinder", at: v(centre), radius: r1(radius), height: r1(height), axis, role, basis };
    this.solids.push(solid);
    return solid;
  }

  /** `count` plates across `size` along `axis`; `min` is the minimum corner of the whole stack. */
  fins(id: string, role: SolidRole, min: Vec3, size: Vec3, count: number, axis: "x" | "y" | "z", basis: Basis = "schematic", extra: Partial<Solid> = {}): Solid {
    return this.box(id, role, min, size, basis, { shape: "fins", count, axis, ...extra });
  }

  /** A fan rotor of `blades` around its hub, filling a disc like a cylinder of `radius` and `height` along `axis`. */
  rotor(id: string, centre: Vec3, radius: number, height: number, axis: "x" | "y" | "z", blades: number, basis: Basis = "schematic", extra: Partial<Solid> = {}): Solid {
    const solid = this.cylinder(id, "fan", centre, radius, height, axis, basis);
    Object.assign(solid, { shape: "rotor", count: blades, ...extra });
    return solid;
  }

  /** A mount drawn by `solid`; `at` is where the child's attach frame lands. */
  mount(id: string, solid: Solid, at: Vec3, quat: Quat, insert: Vec3, travelMm: number, facing?: Vec3): void {
    // Unless told otherwise a mount is seen from where the part comes from.
    const seenFrom = facing ?? ([-insert[0], -insert[1], -insert[2]].map((n) => n + 0) as Vec3);
    this.mounts[id] = { at: v(at), quat, insert, travelMm, facing: seenFrom, size: solid.size ?? [0, 0, 0], solid: solid.id };
  }

  /** A socket: a box with its printed marking and stated pin count, opening toward `facing`. */
  port(spec: PortSpec, min: Vec3, size: Vec3, facing: Vec3): Solid {
    const pins = statedPins(spec.connector);
    const solid = this.box(spec.id, "port", min, size, "schematic", { label: printedLabel(spec.label.en, spec.id), ...(pins ? { pins } : {}) });
    const c = solid.at;
    // The opening is the face the cable leaves through.
    const half = (i: number) => (size[i]! / 2) * facing[i]!;
    this.ports[spec.id] = { at: v([c[0] + half(0), c[1] + half(1), c[2] + half(2)]), facing, size: solid.size!, solid: solid.id };
    return solid;
  }

  height(): number {
    return r1(Math.max(...this.solids.map((s) => extent(s).max[1])));
  }
}

/** Axis-aligned extent of a solid (rotation ignored: used for bounds checks and 2D drawing of unrotated parts). */
export function extent(s: Solid): { min: Vec3; max: Vec3 } {
  let half: Vec3;
  if (s.shape === "cylinder" || s.shape === "rotor") {
    const r = s.radius ?? 0;
    const h = (s.height ?? 0) / 2;
    half = s.axis === "x" ? [h, r, r] : s.axis === "y" ? [r, h, r] : [r, r, h];
  } else {
    const size = s.size ?? [0, 0, 0];
    half = [size[0] / 2, size[1] / 2, size[2] / 2];
  }
  return { min: [s.at[0] - half[0], s.at[1] - half[1], s.at[2] - half[2]], max: [s.at[0] + half[0], s.at[1] + half[1], s.at[2] + half[2]] };
}
