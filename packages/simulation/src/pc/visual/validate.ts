// Checks committed assets against the catalog. Pure: the caller supplies file contents.
import type { CatalogEntry, PCCatalog } from "@ytl/contracts";
import { extent } from "./build";
import { catalogAxes, type Axis } from "./dims";
import { generateAssets } from "./generate";
import { GEOMETRY_SCHEMA, MANIFEST_PATH, type AssetManifest, type PartGeometry, type Solid, type SolidRole } from "./types";

export interface AssetIssue {
  catalogId: string;
  rule:
    | "missing_manifest_row"
    | "missing_file"
    | "bad_json"
    | "bounds_mismatch"
    | "unmapped_element"
    | "unknown_reference"
    | "outside_bounds"
    | "mounts_overlap"
    | "missing_label"
    | "not_reproducible"
    | "duplicate_geometry"
    | "too_little_detail";
  detail: string;
}

/** What a drawing must contain at the least, so a bare box can never be counted as finished. */
const MINIMUM_DETAIL: Record<CatalogEntry["category"], SolidRole[]> = {
  case: ["panel", "tray", "bay", "fan_mount"],
  motherboard: ["pcb", "cpu_socket", "dimm_slot", "pcie_slot", "port", "heatsink"],
  cpu: ["pcb", "plate", "chip"],
  ram: ["pcb", "edge_connector", "heatsink", "chip"],
  gpu: ["shroud", "fan", "bracket", "edge_connector", "port"],
  psu: ["body", "grille", "plug", "plate"],
  storage: ["plate"],
  fan: ["body", "fan", "plate"],
  cooling: ["plate", "fan"],
  cable: ["plug", "tube"],
  monitor: ["screen", "port", "plate"],
};

const boxOf = (s: Solid) => extent(s);

/**
 * `files` maps a path under `assets/` to its content. `requireAll` demands an asset for every catalog entry
 * (the final state); without it only the entries present in the manifest are checked.
 */
export function validateAssets(catalog: PCCatalog, files: Record<string, string>, requireAll = false): AssetIssue[] {
  const issues: AssetIssue[] = [];
  const add = (catalogId: string, rule: AssetIssue["rule"], detail: string) => issues.push({ catalogId, rule, detail });

  let manifest: AssetManifest;
  try {
    manifest = JSON.parse(files[MANIFEST_PATH] ?? "") as AssetManifest;
  } catch {
    return [{ catalogId: "*", rule: "missing_file", detail: MANIFEST_PATH }];
  }
  const rows = new Map(manifest.assets.map((r) => [r.catalogId, r]));
  const expected = generateAssets(catalog, [...rows.keys()]);
  const seenShapes = new Map<string, string>();

  for (const entry of catalog.entries) {
    const row = rows.get(entry.id);
    if (!row) {
      if (requireAll) add(entry.id, "missing_manifest_row", "no asset");
      continue;
    }
    if (!row.provenance || !row.license || !row.label?.en || !row.label?.ar) add(entry.id, "missing_label", "provenance, licence or educational label");
    const raw = files[row.geometry];
    const svg = files[row.thumbnail];
    if (raw === undefined) add(entry.id, "missing_file", row.geometry);
    if (svg === undefined) add(entry.id, "missing_file", row.thumbnail);
    if (raw === undefined || svg === undefined) continue;
    if (!svg.includes(row.label.en)) add(entry.id, "missing_label", "thumbnail title lacks the educational label");

    // Byte-for-byte reproducible from the catalog.
    if (expected.files[row.geometry] !== raw) add(entry.id, "not_reproducible", row.geometry);
    if (expected.files[row.thumbnail] !== svg) add(entry.id, "not_reproducible", row.thumbnail);

    let g: PartGeometry;
    try {
      g = JSON.parse(raw) as PartGeometry;
    } catch {
      add(entry.id, "bad_json", row.geometry);
      continue;
    }
    if (g.schema !== GEOMETRY_SCHEMA) add(entry.id, "bad_json", `schema ${String(g.schema)}`);
    const solids = new Map(g.solids.map((s) => [s.id, s]));
    if (solids.size !== g.solids.length) add(entry.id, "unknown_reference", "duplicate solid id");

    // Bounds follow the catalog wherever the catalog has a dimension.
    for (const [axis, value] of Object.entries(catalogAxes(entry)) as [Axis, number][]) {
      const k = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      if (Math.abs(g.bounds.size[k] - value) > 0.1) add(entry.id, "bounds_mismatch", `${axis}: ${g.bounds.size[k]} vs catalog ${value}`);
      if (g.bounds.basis[axis] !== "catalog") add(entry.id, "bounds_mismatch", `${axis} basis is not "catalog"`);
    }

    // Every mount point, port, zone and lighting zone is drawn, and nothing refers to an element the entry lacks.
    const need = (kind: string, ids: string[], have: Record<string, unknown>) => {
      for (const id of ids) if (!(id in have)) add(entry.id, "unmapped_element", `${kind} ${id}`);
      for (const id of Object.keys(have)) if (!ids.includes(id)) add(entry.id, "unknown_reference", `${kind} ${id}`);
    };
    need("mount", entry.mountPoints.map((m) => m.id), g.mounts);
    need("port", entry.ports.map((p) => p.id), g.ports);
    need("zone", entry.zones.map((z) => z.id), g.zones);
    need("light", entry.rgb ? entry.rgb.zones : [], Object.fromEntries(g.lights.map((l) => [l.zone, l])));
    const refs = [
      ...Object.values(g.mounts).map((m) => m.solid),
      ...Object.values(g.ports).map((p) => p.solid),
      ...Object.values(g.zones).flatMap((z) => z.solids),
      ...g.lights.flatMap((l) => l.solids),
    ];
    for (const id of refs) if (!solids.has(id)) add(entry.id, "unknown_reference", `solid ${id}`);
    for (const [id, z] of Object.entries(g.zones)) if (z.solids.length === 0) add(entry.id, "unmapped_element", `zone ${id} has no solid`);

    // Everything inside the bounds; mount solids do not collide (the cooler outline surrounds the socket by design).
    for (const s of g.solids) {
      const b = boxOf(s);
      if (b.min.some((v) => v < -0.11) || b.max.some((v, i) => v > g.bounds.size[i]! + 0.11)) add(entry.id, "outside_bounds", s.id);
    }
    // Mounts that the catalog says block each other (a radiator position and the fan positions it covers) may share space.
    const blocks = (x: string, y: string) => entry.mountPoints.some((m) => (m.id === x && (m.blocks ?? []).includes(y)) || (m.id === y && (m.blocks ?? []).includes(x)));
    const mountSolids = Object.entries(g.mounts)
      .map(([id, m]) => ({ id, solid: solids.get(m.solid) }))
      .filter((x): x is { id: string; solid: Solid } => !!x.solid && x.solid.role !== "cooler_keepout");
    for (let i = 0; i < mountSolids.length; i += 1) {
      for (let j = i + 1; j < mountSolids.length; j += 1) {
        const [p, q] = [mountSolids[i]!, mountSolids[j]!];
        if (blocks(p.id, q.id)) continue;
        const a = boxOf(p.solid);
        const b = boxOf(q.solid);
        if ([0, 1, 2].every((k) => a.min[k]! < b.max[k]! - 0.05 && b.min[k]! < a.max[k]! - 0.05)) add(entry.id, "mounts_overlap", `${p.id} and ${q.id}`);
      }
    }
    // Captive cables have an exit point; a part with several mounting roles has an attach frame for each.
    for (const c of entry.cables) if (c.attachment === "captive" && !(c.id in g.leads)) add(entry.id, "unmapped_element", `lead ${c.id}`);
    for (const role of entry.mounting) if (!(role.role in g.attach)) add(entry.id, "unmapped_element", `attach ${role.role}`);

    // Not a bare box, and not a copy of another entry.
    const roles = new Set(g.solids.map((s) => s.role));
    for (const role of MINIMUM_DETAIL[entry.category]) if (!roles.has(role)) add(entry.id, "too_little_detail", `no ${role}`);
    const shape = JSON.stringify([g.bounds.size, g.solids]);
    const twin = seenShapes.get(shape);
    if (twin) add(entry.id, "duplicate_geometry", `same geometry as ${twin}`);
    seenShapes.set(shape, entry.id);
  }
  for (const id of rows.keys()) if (!catalog.entries.some((e) => e.id === id)) add(id, "unknown_reference", "manifest row without a catalog entry");
  return issues;
}
