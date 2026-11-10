// Catalog lookup and structural validation. Pure data checks: no build state, no rendering.
import type { CableSpec, CatalogEntry, Localized, PCCatalog, PCCatalogCategory, PCPartCategory } from "@ytl/contracts";

export interface CatalogIndex {
  catalog: PCCatalog;
  byId: Map<string, CatalogEntry>;
}

const indexCache = new WeakMap<PCCatalog, CatalogIndex>();

export function indexCatalog(catalog: PCCatalog): CatalogIndex {
  let index = indexCache.get(catalog);
  if (!index) {
    index = { catalog, byId: new Map(catalog.entries.map((e) => [e.id, e])) };
    indexCache.set(catalog, index);
  }
  return index;
}

export function cableSpecOf(entry: CatalogEntry | undefined, cableSpecId: string): CableSpec | undefined {
  return entry?.cables.find((c) => c.id === cableSpecId);
}

/** The nine learner-facing categories of the brief (section 6). */
export const PC_PART_CATEGORIES: readonly PCPartCategory[] = ["case", "motherboard", "cpu", "ram", "gpu", "psu", "storage", "fan", "cooling"];
/** Options offered per category (owner decision 10, 2026-10-27, replacing the brief's twenty). */
export const CATALOG_OPTIONS_PER_CATEGORY = 2;

export interface CatalogCounts {
  category: PCPartCategory;
  total: number;
  /** Commercial entries with at least one fetched source. */
  sourced: number;
  generic: number;
  /** Entries whose asset quality is `educational` or `detailed`; only these count as finished. */
  finishedVisuals: number;
}

export function countCatalog(catalog: PCCatalog): CatalogCounts[] {
  return PC_PART_CATEGORIES.map((category) => {
    const entries = catalog.entries.filter((e) => e.category === category);
    return {
      category,
      total: entries.length,
      sourced: entries.filter((e) => !e.generic && e.sources.length > 0).length,
      generic: entries.filter((e) => e.generic).length,
      finishedVisuals: entries.filter((e) => e.asset.quality === "educational" || e.asset.quality === "detailed").length,
    };
  });
}

export interface CatalogIssue {
  entryId: string;
  /** Machine-readable rule name. */
  rule:
    | "duplicate_id"
    | "bad_id"
    | "missing_text"
    | "missing_source"
    | "bad_source"
    | "verification_mismatch"
    | "duplicate_local_id"
    | "unresolved_reference"
    | "missing_compatibility_data"
    | "bad_cable"
    | "rgb_mismatch";
  detail: string;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const filled = (t: Localized | undefined) => !!t && t.en.trim().length > 0 && t.ar.trim().length > 0;
const ACCESSORY: PCCatalogCategory[] = ["cable", "monitor"];

/** Returns every structural problem found; an empty array means the catalog is internally consistent. */
export function validateCatalog(catalog: PCCatalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const index = indexCatalog(catalog);
  const seen = new Set<string>();

  for (const e of catalog.entries) {
    const add = (rule: CatalogIssue["rule"], detail: string) => issues.push({ entryId: e.id, rule, detail });

    if (seen.has(e.id)) add("duplicate_id", e.id);
    seen.add(e.id);
    if (!ID.test(e.id)) add("bad_id", e.id);
    if (!e.brand.trim() || !e.model.trim()) add("missing_text", "brand/model");
    if (!filled(e.description)) add("missing_text", "description");

    // Sources and verification status must agree.
    if (e.generic !== (e.verification === "generic")) add("verification_mismatch", "generic flag and verification disagree");
    if (!e.generic && e.sources.length === 0) add("missing_source", "commercial entry without a source");
    if (e.verification === "verified" && e.unverifiedFields.length > 0) add("verification_mismatch", "verified entry lists unverified fields");
    if (e.verification === "partially_verified" && e.unverifiedFields.length === 0) add("verification_mismatch", "partially verified entry lists no unverified field");
    for (const s of e.sources) {
      if (!/^https:\/\//.test(s.url)) add("bad_source", `url ${s.url}`);
      if (!ISO_DATE.test(s.retrievedOn)) add("bad_source", `retrievedOn ${s.retrievedOn}`);
      if (!s.title.trim() || !s.publisher.trim()) add("bad_source", "title/publisher");
    }

    // Local IDs are unique and safe inside tutor target IDs.
    const local = (kind: string, ids: string[]) => {
      const set = new Set<string>();
      for (const id of ids) {
        if (set.has(id)) add("duplicate_local_id", `${kind} ${id}`);
        set.add(id);
        if (!ID.test(id)) add("bad_id", `${kind} ${id}`);
      }
      return set;
    };
    const mountIds = local("mountPoint", e.mountPoints.map((m) => m.id));
    local("port", e.ports.map((p) => p.id));
    local("role", e.mounting.map((m) => m.role));
    const zoneIds = local("zone", e.zones.map((z) => z.id));
    const cableIds = local("cable", e.cables.map((c) => c.id));

    for (const m of e.mountPoints) {
      if (!filled(m.label)) add("missing_text", `mountPoint ${m.id} label`);
      for (const b of m.blocks ?? []) if (!mountIds.has(b)) add("unresolved_reference", `mountPoint ${m.id} blocks ${b}`);
      if (m.zoneId && !zoneIds.has(m.zoneId)) add("unresolved_reference", `mountPoint ${m.id} zone ${m.zoneId}`);
      if (m.fastener && m.fastener.count < 1) add("missing_compatibility_data", `mountPoint ${m.id} fastener count`);
    }
    for (const p of e.ports) {
      if (!filled(p.label)) add("missing_text", `port ${p.id} label`);
      if (p.zoneId && !zoneIds.has(p.zoneId)) add("unresolved_reference", `port ${p.id} zone ${p.zoneId}`);
      if (p.connector === "psu_modular" && !p.keying) add("missing_compatibility_data", `port ${p.id} has no cable-family keying`);
    }
    for (const z of e.zones) if (!filled(z.label) || !filled(z.description)) add("missing_text", `zone ${z.id}`);
    for (const m of e.mounting) if (!filled(m.label)) add("missing_text", `role ${m.role} label`);

    for (const c of e.cables) {
      if (!filled(c.label)) add("missing_text", `cable ${c.id} label`);
      if (c.quantity < 1) add("bad_cable", `cable ${c.id} quantity`);
      local(`cable ${c.id} end`, c.ends.map((x) => x.id));
      for (const x of c.ends) {
        if (!filled(x.label)) add("missing_text", `cable ${c.id} end ${x.id} label`);
        if (x.connector === "psu_modular" && !x.keying) add("missing_compatibility_data", `cable ${c.id} end ${x.id} has no cable-family keying`);
      }
      const sources = c.ends.filter((x) => x.side === "source");
      const devices = c.ends.filter((x) => x.side !== "source");
      if (devices.length === 0) add("bad_cable", `cable ${c.id} has no device end`);
      if (c.attachment === "captive" && sources.length > 0) add("bad_cable", `captive cable ${c.id} lists a source end`);
      if (c.attachment === "modular" && (sources.length === 0 || sources.some((x) => x.connector !== "psu_modular"))) {
        add("bad_cable", `modular cable ${c.id} needs psu_modular source ends`);
      }
      // A modular cable must have a matching socket on its own power supply.
      if (c.attachment === "modular") {
        for (const x of sources) {
          if (!e.ports.some((p) => p.connector === "psu_modular" && p.keying === x.keying)) {
            add("unresolved_reference", `cable ${c.id} end ${x.id}: no socket keyed ${x.keying}`);
          }
        }
      }
    }

    // Lighting hardware must point at a real lighting lead of the right kind.
    if (e.rgb) {
      if (e.rgb.zones.length === 0) add("rgb_mismatch", "rgb hardware without zones");
      if (e.rgb.control !== "integrated") {
        const lead = e.cables.find((c) => c.id === e.rgb?.lightingCableId);
        if (!lead || !cableIds.has(lead.id)) add("unresolved_reference", `rgb.lightingCableId ${e.rgb.lightingCableId}`);
        else if (!lead.ends.some((x) => x.connector === e.rgb?.control)) add("rgb_mismatch", `lighting lead ${lead.id} has no ${e.rgb.control} plug`);
      }
    }

    // Where the part installs.
    if (!ACCESSORY.includes(e.category) && e.category !== "case" && e.mounting.length === 0) {
      add("missing_compatibility_data", "part has no mounting role");
    }

    // Category-specific compatibility metadata.
    switch (e.category) {
      case "case": {
        if (!e.mountPoints.some((m) => m.kind === "motherboard_tray")) add("missing_compatibility_data", "no motherboard tray");
        if (!e.mountPoints.some((m) => m.kind === "psu_bay")) add("missing_compatibility_data", "no PSU bay");
        if (!(e.spec.maxGpuLengthMm > 0) || !(e.spec.maxCpuCoolerHeightMm > 0)) add("missing_compatibility_data", "clearance limits");
        if (!e.cables.some((c) => c.ends.some((x) => x.function === "power_switch"))) add("missing_compatibility_data", "no power switch lead");
        break;
      }
      case "motherboard": {
        const dimms = e.mountPoints.filter((m) => m.kind === "dimm_slot");
        if (dimms.length !== e.spec.memory.slots) add("missing_compatibility_data", "DIMM slot count differs from spec.memory.slots");
        if (dimms.some((m) => m.kind === "dimm_slot" && m.generation !== e.spec.memory.generation)) add("missing_compatibility_data", "DIMM generation");
        if (!e.mountPoints.some((m) => m.kind === "cpu_socket" && m.socket === e.spec.socket)) add("missing_compatibility_data", "CPU socket mount");
        if (!e.mountPoints.some((m) => m.kind === "cpu_cooler_mount")) add("missing_compatibility_data", "cooler mount");
        if (!e.ports.some((p) => p.function === "atx_main_power" && p.requirement === "required")) add("missing_compatibility_data", "ATX 24-pin port");
        if (!e.ports.some((p) => p.function === "cpu_power" && p.requirement === "required")) add("missing_compatibility_data", "CPU power port");
        if (!e.ports.some((p) => p.function === "power_switch")) add("missing_compatibility_data", "power switch pins");
        if (e.ports.filter((p) => p.function === "sata_data").length !== e.spec.sataPorts) add("missing_compatibility_data", "SATA port count");
        if (e.spec.cpuSupport.length === 0) add("missing_compatibility_data", "empty CPU support list");
        if (e.spec.biosVersions.length === 0 || !e.spec.biosVersions.some((b) => b.version === e.spec.factoryBiosVersion)) {
          add("missing_compatibility_data", "factory BIOS not in the BIOS list");
        }
        for (const s of e.spec.cpuSupport) {
          const cpu = index.byId.get(s.cpuId);
          if (!cpu || cpu.category !== "cpu") add("unresolved_reference", `cpuSupport ${s.cpuId}`);
          else if (cpu.spec.socket !== e.spec.socket) add("unresolved_reference", `cpuSupport ${s.cpuId} has another socket`);
        }
        // Layout advice is optional data, but an entry without it must say that it was not read.
        if (e.spec.memory.recommendedPopulation.length === 0 && !e.unverifiedFields.some((f) => f.startsWith("spec.memory.recommendedPopulation"))) {
          add("missing_compatibility_data", "no recommended memory population");
        }
        for (const r of e.spec.memory.recommendedPopulation) {
          if (r.slotIds.length !== r.modules) add("missing_compatibility_data", `population rule for ${r.modules} modules`);
          for (const id of r.slotIds) if (!dimms.some((m) => m.id === id)) add("unresolved_reference", `population slot ${id}`);
        }
        break;
      }
      case "cpu":
        if (!(e.spec.basePowerW > 0) || e.spec.memorySupport.length === 0) add("missing_compatibility_data", "power or memory support");
        break;
      case "ram":
        if (e.spec.capacityPerModuleGb * e.spec.modulesInKit !== e.spec.kitCapacityGb) add("missing_compatibility_data", "kit capacity arithmetic");
        if (!(e.spec.ratedSpeedMTs > 0)) add("missing_compatibility_data", "rated speed");
        break;
      case "gpu":
        if (!(e.spec.lengthMm > 0)) add("missing_compatibility_data", "length");
        if (!e.ports.some((p) => p.function === "display_out")) add("missing_compatibility_data", "no display output");
        break;
      case "psu": {
        if (!(e.spec.wattageW > 0)) add("missing_compatibility_data", "wattage");
        const has = (fn: string) => e.cables.some((c) => c.ends.some((x) => x.function === fn && x.side === "device"));
        if (!has("atx_main_power") || !has("cpu_power")) add("missing_compatibility_data", "ATX or CPU power cable");
        if (e.spec.modularity !== "none" && !e.spec.cableFamily) add("missing_compatibility_data", "modular unit without cable family");
        break;
      }
      case "storage":
        if (!(e.spec.capacityGb > 0)) add("missing_compatibility_data", "capacity");
        if (e.spec.interface === "sata" && !e.spec.formFactor.startsWith("m2") && e.ports.filter((p) => p.requirement === "required").length < 2) {
          add("missing_compatibility_data", "SATA drive needs data and power ports");
        }
        break;
      case "fan":
        if (!e.cables.some((c) => c.ends.some((x) => x.function === "fan_motor"))) add("missing_compatibility_data", "no motor lead");
        break;
      case "cooling":
        if (e.spec.supportedSockets.length === 0) add("missing_compatibility_data", "sockets");
        if (e.spec.type === "air" && !(e.spec.heightMm && e.spec.heightMm > 0)) add("missing_compatibility_data", "air cooler height");
        if (e.spec.type === "aio_liquid" && !(e.spec.radiatorSizeMm && e.mounting.some((m) => m.kind === "radiator_mount"))) {
          add("missing_compatibility_data", "AIO radiator");
        }
        if (!e.cables.some((c) => c.ends.some((x) => x.function === "fan_motor" || x.function === "pump_motor"))) add("missing_compatibility_data", "no motor lead");
        break;
      case "cable":
        if (e.cables.length !== 1 || e.cables[0]?.attachment !== "loose") add("bad_cable", "cable entry needs exactly one loose cable");
        break;
      case "monitor":
        if (!e.ports.some((p) => p.function === "display_in")) add("missing_compatibility_data", "no display input");
        break;
    }
  }
  return issues;
}
