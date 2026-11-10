// Pure helpers for the PC lab view: reading stored projects, and turning a build state into the
// rows the structured view shows. Rules stay in the engine (@ytl/simulation); nothing here decides
// what is allowed.
import type {
  CableEndSpec,
  CableInstance,
  CableSpec,
  CatalogEntry,
  InstalledPart,
  Localized,
  MountPointSpec,
  MountRef,
  PCBuildState,
  PCCatalog,
  PCAction,
  PCDiagnostic,
  PCProjectData,
  PartAttachment,
  PortRef,
  PortSpec,
} from "@ytl/contracts";
import { pc } from "@ytl/simulation";

/** `ProjectRecord.dataVersion` for PC projects is the contract's own constant. */
export { PC_PROJECT_DATA_VERSION } from "@ytl/contracts";

const name = (entry: CatalogEntry) => `${entry.brand} ${entry.model}`;
/** A name that is the same in both languages, in the shape the selection machine reads out. */
export const sameInBoth = (text: string): Localized => ({ en: text, ar: text });

// ---------- Stored data ----------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that stored data has the shape of a PC project and names only catalog entries that
 * exist, so the view can render it without guarding every lookup. Returns null otherwise; the
 * record is then reported as unreadable and left alone.
 */
export function parsePCProjectData(raw: unknown, catalog: PCCatalog): PCProjectData | null {
  if (!isObject(raw) || !isObject(raw.state) || !Array.isArray(raw.log)) return null;
  const { state } = raw;
  const { byId } = pc.indexCatalog(catalog);
  if (state.rgbPreference !== "with_rgb" && state.rgbPreference !== "without_rgb") return null;
  if (typeof state.catalogVersion !== "string" || typeof state.sidePanelOpen !== "boolean") return null;
  if (typeof state.nextSerial !== "number" || !Number.isInteger(state.nextSerial) || state.nextSerial < 1) return null;
  const power = state.power;
  if (!isObject(power) || typeof power.wallConnected !== "boolean" || typeof power.psuSwitchOn !== "boolean" || typeof power.pressed !== "boolean") {
    return null;
  }
  if (!Array.isArray(state.parts) || !Array.isArray(state.cables)) return null;
  for (const part of state.parts) {
    if (!isObject(part) || typeof part.instanceId !== "string" || typeof part.catalogId !== "string") return null;
    if (!byId.has(part.catalogId) || !Array.isArray(part.attachments)) return null;
    for (const attachment of part.attachments) {
      if (!isObject(attachment) || typeof attachment.role !== "string" || !isObject(attachment.target)) return null;
    }
  }
  const kept: unknown[] = [];
  for (const cable of state.cables) {
    if (!isObject(cable) || typeof cable.id !== "string" || typeof cable.catalogId !== "string" || typeof cable.cableSpecId !== "string") return null;
    if (!isObject(cable.ends)) return null;
    if (!pc.cableSpecOf(byId.get(cable.catalogId), cable.cableSpecId)) {
      // A lead that a part no longer carries (a case's fan leads moved to its fitted fans, 2026-10-31) is left
      // out; the part itself is kept. Anything else naming an unknown cable is unreadable.
      const ownerKnown = typeof cable.ownerInstanceId === "string" && state.parts.some((part) => isObject(part) && part.instanceId === cable.ownerInstanceId);
      if (!ownerKnown) return null;
      continue;
    }
    kept.push(cable);
  }
  if (!raw.log.every((action) => isObject(action) && typeof action.type === "string")) return null;
  if (kept.length === state.cables.length) return raw as unknown as PCProjectData;
  // Ends plugged into a lead that was left out are loose now.
  const gone = new Set(state.cables.filter((cable) => !kept.includes(cable)).map((cable) => (cable as { id: string }).id));
  const cables = (kept as Record<string, unknown>[]).map((cable) => ({
    ...cable,
    ends: Object.fromEntries(Object.entries(cable.ends as Record<string, unknown>).map(([endId, to]) => [endId, isObject(to) && to.kind === "cable" && gone.has(String(to.cableId)) ? null : to])),
  }));
  return { ...raw, state: { ...state, cables } } as unknown as PCProjectData;
}

// ---------- Names that tell look-alikes apart ----------

/** Which of several identical cables this is: `psu-9.eps-2` is cable 2 of the `eps` spec; null when the part supplies one. */
function cableNumber(cable: CableInstance, spec: CableSpec): number | null {
  if (spec.quantity <= 1) return null;
  const k = /-(\d+)$/.exec(cable.id.slice(cable.id.lastIndexOf(".") + 1))?.[1];
  return k ? Number(k) : null;
}

/** "EPS … cable, Type 4 (cable 2)": unique on the page when a part supplies several of the same cable. */
export function cableLabelOf(cable: CableInstance, spec: CableSpec): Localized {
  const k = cableNumber(cable, spec);
  return k === null ? spec.label : { en: `${spec.label.en} (cable ${k})`, ar: `${spec.label.ar} (الكيبل ${k})` };
}

/** "PCIe 6+2-pin plug (end 2)": unique within its cable when several ends share a name. */
export function endLabelOf(spec: CableSpec, endId: string): Localized {
  const end = spec.ends.find((item) => item.id === endId);
  if (!end) return sameInBoth(endId);
  const same = spec.ends.filter((item) => item.label.en === end.label.en);
  if (same.length < 2) return end.label;
  const k = same.indexOf(end) + 1;
  return { en: `${end.label.en} (end ${k})`, ar: `${end.label.ar} (الطرف ${k})` };
}

// ---------- Older logs ----------

/**
 * A log written under an older catalog, with the steps the current catalog has no subject for left out:
 * plugging, unplugging or tidying a lead that its part no longer carries (on 2026-10-31 a case's fan leads
 * moved to its fitted fans, which are parts of their own). Those steps changed nothing that the current
 * rules judge, so leaving them out keeps the rest of the build exactly as it was. Every other step is kept,
 * and is still checked by the engine when the log is replayed.
 */
export function migrateLog(log: readonly PCAction[], catalog: PCCatalog): PCAction[] {
  const { byId } = pc.indexCatalog(catalog);
  // Instance IDs as the engine assigns them while the log is replayed: `<category>-<serial>`.
  const catalogOf = new Map<string, string>();
  let serial = 1;
  const out: PCAction[] = [];
  for (const action of log) {
    if (action.type === "add_part" || action.type === "add_cable") {
      const entry = byId.get(action.catalogId);
      if (action.type === "add_part") catalogOf.set(`${entry?.category ?? "part"}-${serial}`, action.catalogId);
      serial += 1;
    }
    if ((action.type === "connect_cable_end" || action.type === "disconnect_cable_end" || action.type === "set_cable_tidy" || action.type === "remove_cable") && typeof action.cableId === "string" && action.cableId.includes(".")) {
      const owner = action.cableId.slice(0, action.cableId.indexOf("."));
      const specId = action.cableId.slice(action.cableId.indexOf(".") + 1).replace(/-\d+$/, "");
      const entry = byId.get(catalogOf.get(owner) ?? "");
      if (entry && !entry.cables.some((cable) => cable.id === specId || cable.id === action.cableId.slice(action.cableId.indexOf(".") + 1))) continue;
    }
    out.push(action);
  }
  return out;
}

// ---------- Rows of the structured view ----------

export interface AttachmentRow {
  attachment: PartAttachment;
  /** What this role of the part is called ("pump block", "radiator"); from the catalog. */
  roleLabel: Localized;
  hostName: string;
  mountLabel: Localized;
  /** 0 when nothing has to be secured at this position. */
  fastenersTotal: number;
  fastenerKind: string | null;
}

export interface PlugRow {
  cableId: string;
  endId: string;
  cableLabel: Localized;
  endLabel: Localized;
}

export interface PortRow {
  spec: PortSpec;
  ref: PortRef;
  plugged: PlugRow | null;
}

export interface MountPointRow {
  spec: MountPointSpec;
  ref: MountRef;
  /** The part sitting here, if any. */
  occupant: { instanceId: string; name: string } | null;
}

export interface PartRow {
  part: InstalledPart;
  entry: CatalogEntry;
  name: string;
  /** Empty while the part is on the bench. */
  attachments: AttachmentRow[];
  /** True when the part still has a role that is not mounted anywhere (always false for the case). */
  canPlace: boolean;
  mountPoints: MountPointRow[];
  ports: PortRow[];
}

export interface CableEndRow {
  spec: CableEndSpec;
  /** The end's name, numbered when the cable has several ends of the same name (two PCIe plugs). */
  label: Localized;
  /** Where this end is plugged, in words, or null when it is loose. */
  pluggedInto: { owner: string; label: Localized } | null;
}

export interface CableRow {
  cable: CableInstance;
  spec: CableSpec;
  /** The cable's name, numbered when its part supplies several of the same cable (two EPS cables). */
  label: Localized;
  /** The part this cable came with, or null for a cable taken on its own. */
  ownerName: string | null;
  ends: CableEndRow[];
}

export interface BuildRows {
  parts: PartRow[];
  cables: CableRow[];
}

const samePort = (a: PortRef | null | undefined, b: PortRef) =>
  !!a && (a.kind === "part" ? b.kind === "part" && a.instanceId === b.instanceId && a.portId === b.portId : b.kind === "cable" && a.cableId === b.cableId && a.endId === b.endId);

/** Everything the structured view lists, in the build's own order. Parts or cables whose catalog entry is gone are skipped. */
export function buildRows(state: PCBuildState, catalog: PCCatalog): BuildRows {
  const { byId } = pc.indexCatalog(catalog);
  const entryOfPart = (instanceId: string) => {
    const part = state.parts.find((item) => item.instanceId === instanceId);
    return part ? byId.get(part.catalogId) : undefined;
  };
  const specOf = (cable: CableInstance) => pc.cableSpecOf(byId.get(cable.catalogId), cable.cableSpecId);

  function plugAt(ref: PortRef): PlugRow | null {
    for (const cable of state.cables) {
      const spec = specOf(cable);
      if (!spec) continue;
      for (const end of spec.ends) {
        if (samePort(cable.ends[end.id], ref)) return { cableId: cable.id, endId: end.id, cableLabel: cableLabelOf(cable, spec), endLabel: endLabelOf(spec, end.id) };
      }
    }
    return null;
  }

  const parts: PartRow[] = [];
  for (const part of state.parts) {
    const entry = byId.get(part.catalogId);
    if (!entry) continue;
    const attachments: AttachmentRow[] = part.attachments.map((attachment) => {
      const host = entryOfPart(attachment.target.hostInstanceId);
      const mount = host?.mountPoints.find((point) => point.id === attachment.target.mountPointId);
      return {
        attachment,
        roleLabel: entry.mounting.find((role) => role.role === attachment.role)?.label ?? sameInBoth(attachment.role),
        hostName: host ? name(host) : attachment.target.hostInstanceId,
        mountLabel: mount?.label ?? sameInBoth(attachment.target.mountPointId),
        fastenersTotal: mount?.fastener?.count ?? 0,
        fastenerKind: mount?.fastener?.kind ?? null,
      };
    });
    parts.push({
      part,
      entry,
      name: name(entry),
      attachments,
      canPlace: entry.mounting.some((role) => !part.attachments.some((attachment) => attachment.role === role.role)),
      mountPoints: entry.mountPoints.map((spec) => {
        const ref: MountRef = { hostInstanceId: part.instanceId, mountPointId: spec.id };
        const sitting = state.parts.find((other) =>
          other.attachments.some((a) => a.target.hostInstanceId === ref.hostInstanceId && a.target.mountPointId === ref.mountPointId),
        );
        const sittingEntry = sitting && byId.get(sitting.catalogId);
        return { spec, ref, occupant: sitting && sittingEntry ? { instanceId: sitting.instanceId, name: name(sittingEntry) } : null };
      }),
      ports: entry.ports.map((spec) => {
        const ref: PortRef = { kind: "part", instanceId: part.instanceId, portId: spec.id };
        return { spec, ref, plugged: plugAt(ref) };
      }),
    });
  }

  const cables: CableRow[] = [];
  for (const cable of state.cables) {
    const spec = specOf(cable);
    if (!spec) continue;
    const owner = cable.ownerInstanceId ? entryOfPart(cable.ownerInstanceId) : undefined;
    cables.push({
      cable,
      spec,
      label: cableLabelOf(cable, spec),
      ownerName: owner ? name(owner) : null,
      ends: spec.ends.map((end) => {
        const to = cable.ends[end.id];
        const label = endLabelOf(spec, end.id);
        if (!to) return { spec: end, label, pluggedInto: null };
        if (to.kind === "part") {
          const host = entryOfPart(to.instanceId);
          const port = host?.ports.find((item) => item.id === to.portId);
          return { spec: end, label, pluggedInto: { owner: host ? name(host) : to.instanceId, label: port?.label ?? sameInBoth(to.portId) } };
        }
        const other = state.cables.find((item) => item.id === to.cableId);
        const otherSpec = other && specOf(other);
        const otherEnd = otherSpec?.ends.find((item) => item.id === to.endId);
        return {
          spec: end,
          label,
          pluggedInto: { owner: other && otherSpec ? cableLabelOf(other, otherSpec).en : to.cableId, label: otherEnd && otherSpec ? endLabelOf(otherSpec, otherEnd.id) : sameInBoth(to.endId) },
        };
      }),
    });
  }
  // Two parts of the same kind (the case's two fitted fans) bring cables of the same name: number them.
  const byName = new Map<string, CableRow[]>();
  for (const row of cables) byName.set(row.label.en, [...(byName.get(row.label.en) ?? []), row]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.forEach((row, i) => {
      row.label = { en: `${row.label.en} (${i + 1})`, ar: `${row.label.ar} (${i + 1})` };
    });
  }
  // A port's "plugged by" names the cable the same way.
  const labelById = new Map(cables.map((row) => [row.cable.id, row.label]));
  for (const row of parts) for (const port of row.ports) if (port.plugged) port.plugged.cableLabel = labelById.get(port.plugged.cableId) ?? port.plugged.cableLabel;
  return { parts, cables };
}

/**
 * For a build saved under another catalog version: replays its log under the current rules and
 * returns the reason for the first action they now reject, or null when the build still stands
 * (or was saved under this version).
 */
export function catalogDrift(data: PCProjectData, catalog: PCCatalog): PCDiagnostic | null {
  if (data.state.catalogVersion === catalog.version) return null;
  const replayed = pc.replay(migrateLog(data.log, catalog), catalog);
  return replayed.events.find((event) => !event.accepted)?.rejection ?? null;
}

/**
 * Catalog entries a learner can add as parts, for one category, honouring the RGB build preference filter.
 * Archived entries (no longer offered) are never listed.
 */
export function pickerEntries(
  catalog: PCCatalog,
  category: CatalogEntry["category"],
  lighting: "all" | "with" | "without",
  archived: ReadonlySet<string> = new Set(),
): CatalogEntry[] {
  return catalog.entries.filter(
    (entry) => entry.category === category && !archived.has(entry.id) && (lighting === "all" || (lighting === "with") === (entry.rgb !== null)),
  );
}

/** Archived catalog entries this build still uses (as parts or as loose cables), once each, in build order. */
export function archivedInBuild(state: PCBuildState, catalog: PCCatalog, archived: ReadonlySet<string>): CatalogEntry[] {
  const ids = [...state.parts.map((p) => p.catalogId), ...state.cables.filter((c) => c.ownerInstanceId === null).map((c) => c.catalogId)];
  const seen = new Set<string>();
  const found: CatalogEntry[] = [];
  for (const id of ids) {
    if (!archived.has(id) || seen.has(id)) continue;
    seen.add(id);
    const entry = catalog.entries.find((e) => e.id === id);
    if (entry) found.push(entry);
  }
  return found;
}
