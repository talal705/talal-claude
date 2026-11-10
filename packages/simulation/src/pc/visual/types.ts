// Schema of the generated educational geometry, version 2 (agreed with the 3D scene and tutor owners).
//
// Frame: part-local, right-handed, +y up, millimetres. The origin is the minimum corner of the part's
// bounding box, so every coordinate lies inside [0, bounds.size] on its axis. Scene scale: 0.001 m per unit.
import type { Localized } from "@ytl/contracts";

export const GEOMETRY_SCHEMA = 2;

/** Where a number comes from. Never claim more than this says. */
export type Basis =
  /** A dimension or count read from the catalog entry. */
  | "catalog"
  /** Fixed by a published form-factor standard. */
  | "standard"
  /** Placed by a layout rule in the right region and order; not a measured position. */
  | "schematic";

export type Vec3 = [number, number, number];
/** Unit quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

export interface Frame {
  at: Vec3;
  quat: Quat;
}

export type SolidRole =
  | "pcb"
  | "heatsink"
  | "shroud"
  | "io_shield"
  | "cpu_socket"
  | "cooler_keepout"
  | "dimm_slot"
  | "pcie_slot"
  | "m2_slot"
  | "port"
  | "fan"
  | "bracket"
  | "edge_connector"
  | "backplate"
  | "light"
  // General shapes used by cases, drives, power supplies, coolers, cables and the monitor.
  | "body"
  | "panel"
  | "tray"
  | "bay"
  | "fan_mount"
  | "radiator_mount"
  | "grille"
  | "radiator"
  | "tube"
  | "plate"
  | "chip"
  | "plug"
  | "screen";

/**
 * The surface a solid is drawn with. Absent means the scene picks a colour from the role and the category.
 * Finishes are generic surface kinds (bare circuit board, gold contacts, black anodised aluminium…), not a
 * product's exact colours.
 */
export type Finish =
  | "pcb_black"
  | "pcb_green"
  | "gold"
  | "copper"
  | "nickel"
  | "aluminium"
  | "black_metal"
  | "black_plastic"
  | "grey_plastic"
  | "white_plastic"
  | "rubber"
  | "glass"
  | "mesh"
  | "wood"
  | "silicon"
  | "label";

export interface Solid {
  /** Unique within the part. */
  id: string;
  /**
   * `box`: `size` along x, y, z. `cylinder`: `radius`, and `height` measured along `axis`.
   * `fins`: `count` thin plates spaced evenly across `size` along `axis`, each plate filling the other two
   * dimensions (a heatsink fin stack, a grille, slats). `rotor`: a fan rotor of `count` blades around a hub,
   * `radius` and `height` along `axis` as for a cylinder.
   * Open for later shapes: a reader skips a solid whose shape it does not know.
   */
  shape: "box" | "cylinder" | "fins" | "rotor" | (string & {});
  /** Plates of a `fins` solid, blades of a `rotor`. */
  count?: number;
  finish?: Finish;
  /** Centre of the solid. */
  at: Vec3;
  size?: Vec3;
  radius?: number;
  height?: number;
  axis?: "x" | "y" | "z";
  /** Extra orientation about the centre; absent means axis-aligned. */
  rotation?: Quat;
  role: SolidRole;
  basis: Basis;
  /** Short printed marking, as on a board's silkscreen (e.g. `CPU_FAN`, `DIMM_A2`). Language-neutral. */
  label?: string;
  /** Pin count, only where the connector's own name states it. */
  pins?: number;
  /**
   * Which way an opening faces, for solids that are sockets in the drawing but not modelled ports
   * (the USB and audio sockets of a board's back panel). Modelled ports carry it in `ports` instead.
   */
  facing?: Vec3;
  /**
   * For a part with more than one mounting role (an AIO cooler: `block` and `radiator`): the role this solid
   * moves with. Each group is placed with its own `attach[role]` frame; solids without a group follow the first role.
   */
  group?: string;
}

export interface MountGeometry extends Frame {
  /** Unit vector in the HOST's frame: the direction a part travels to seat. A placed, unseated part sits at `-insert * travelMm`. */
  insert: Vec3;
  travelMm: number;
  /** Unit vector in the host's frame pointing from the mount toward a viewer who can see it. */
  facing: Vec3;
  /** Extent of the mount, centred on `at`. */
  size: Vec3;
  /** The solid that draws this mount. */
  solid: string;
}

export interface PortGeometry {
  /** Centre of the opening. */
  at: Vec3;
  /** Unit vector: the direction a plugged cable leaves the socket. */
  facing: Vec3;
  size: Vec3;
  solid: string;
}

export interface PartGeometry {
  schema: typeof GEOMETRY_SCHEMA;
  catalogId: string;
  catalogVersion: string;
  units: "mm";
  /** Extent along x, y, z. `basis` says, per axis, whether it is the catalog's dimension. */
  bounds: { size: Vec3; basis: { x: Basis; y: Basis; z: Basis } };
  solids: Solid[];
  /** Where this part meets its host, per mounting role: world(part) = world(host) x host.mounts[id] x inverse(attach[role]). */
  attach: Record<string, Frame>;
  mounts: Record<string, MountGeometry>;
  ports: Record<string, PortGeometry>;
  /** Where each captive cable leaves the part, keyed by cable spec ID. */
  leads: Record<string, { at: Vec3 }>;
  zones: Record<string, { solids: string[] }>;
  /** Present only for entries with lighting hardware. */
  lights: { zone: string; solids: string[] }[];
  label: Localized;
}

export const EDUCATIONAL_LABEL: Localized = {
  en: "Educational model — not manufacturer-accurate",
  ar: "نموذج تعليمي، مو مطابق لشكل المنتج الحقيقي",
};

export interface AssetManifestRow {
  catalogId: string;
  catalogVersion: string;
  /** Paths under `assets/`. */
  geometry: string;
  thumbnail: string;
  generator: string;
  provenance: string;
  license: string;
  label: Localized;
  orientation: { up: "+y"; front: "+z" };
  metresPerUnit: number;
}

export interface AssetManifest {
  schema: typeof GEOMETRY_SCHEMA;
  assets: AssetManifestRow[];
}

export const geometryPath = (catalogId: string) => `pc/geometry/${catalogId}.json`;
export const thumbnailPath = (catalogId: string) => `pc/thumbnails/${catalogId}.svg`;
export const MANIFEST_PATH = "pc/manifest.json";
