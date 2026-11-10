// Read-only helpers over a build state and its catalog. Shared by the reducer, the checks and the startup model.
import type {
  CableEndSpec,
  CableId,
  CableInstance,
  CableSpec,
  CaseEntry,
  CatalogEntry,
  ConnectorType,
  InstalledPart,
  InstanceId,
  Localized,
  MountPointSpec,
  MountRef,
  PartAttachment,
  PCBuildState,
  PCCatalog,
  PCDiagnostic,
  PCDiagnosticClass,
  PCDiagnosticCode,
  PCEvaluationContext,
  PCEvidence,
  PortFunction,
  PortRef,
  StartupStage,
  TutorTargetRef,
} from "@ytl/contracts";
import { type CatalogIndex, cableSpecOf, indexCatalog } from "./catalog";
import { diagnosticText, type TextParams } from "./messages";

export interface View {
  state: PCBuildState;
  index: CatalogIndex;
  ctx: PCEvaluationContext;
}

export function makeView(state: PCBuildState, catalog: PCCatalog, ctx: PCEvaluationContext = {}): View {
  return { state, index: indexCatalog(catalog), ctx };
}

export interface Placed<E extends CatalogEntry = CatalogEntry> {
  part: InstalledPart;
  entry: E;
}

export const partById = (v: View, id: InstanceId): InstalledPart | undefined => v.state.parts.find((p) => p.instanceId === id);
export const entryOf = (v: View, part: InstalledPart | undefined): CatalogEntry | undefined => (part ? v.index.byId.get(part.catalogId) : undefined);
export const displayName = (entry: CatalogEntry): string => `${entry.brand} ${entry.model}`;

export function partsOf<C extends CatalogEntry["category"]>(v: View, category: C): Placed<Extract<CatalogEntry, { category: C }>>[] {
  const out: Placed<Extract<CatalogEntry, { category: C }>>[] = [];
  for (const part of v.state.parts) {
    const entry = entryOf(v, part);
    if (entry && entry.category === category) out.push({ part, entry: entry as Extract<CatalogEntry, { category: C }> });
  }
  return out;
}

export const attachmentOf = (part: InstalledPart, role: string): PartAttachment | undefined => part.attachments.find((a) => a.role === role);
export const isMounted = (part: InstalledPart): boolean => part.attachments.length > 0;

export function mountSpec(v: View, ref: MountRef): MountPointSpec | undefined {
  return entryOf(v, partById(v, ref.hostInstanceId))?.mountPoints.find((m) => m.id === ref.mountPointId);
}

/** The part (and its attachment) installed on a mount point. */
export function occupant(v: View, ref: MountRef): { part: InstalledPart; attachment: PartAttachment } | undefined {
  for (const part of v.state.parts) {
    const attachment = part.attachments.find((a) => a.target.hostInstanceId === ref.hostInstanceId && a.target.mountPointId === ref.mountPointId);
    if (attachment) return { part, attachment };
  }
  return undefined;
}

/** Parts installed directly on `hostId`. */
export const childrenOf = (v: View, hostId: InstanceId): InstalledPart[] =>
  v.state.parts.filter((p) => p.attachments.some((a) => a.target.hostInstanceId === hostId));

/** The case this part ends up in, following its mounts upward. */
export function caseAbove(v: View, instanceId: InstanceId, depth = 0): Placed<CaseEntry> | undefined {
  const part = partById(v, instanceId);
  const entry = entryOf(v, part);
  if (!part || !entry || depth > 6) return undefined;
  if (entry.category === "case") return { part, entry };
  for (const a of part.attachments) {
    const found = caseAbove(v, a.target.hostInstanceId, depth + 1);
    if (found) return found;
  }
  return undefined;
}

// ---------- Cables ----------

export const cableById = (v: View, id: CableId): CableInstance | undefined => v.state.cables.find((c) => c.id === id);
export const cableSpec = (v: View, cable: CableInstance): CableSpec | undefined => cableSpecOf(v.index.byId.get(cable.catalogId), cable.cableSpecId);
export const endSpec = (v: View, cable: CableInstance, endId: string): CableEndSpec | undefined => cableSpec(v, cable)?.ends.find((e) => e.id === endId);

export interface SocketInfo {
  connector: ConnectorType;
  function: PortFunction;
  keying?: string;
  label: Localized;
  /** The part that carries the socket; for an adapter end, the adapter's owner. */
  ownerInstanceId: InstanceId | null;
}

/** Resolves a port on a part or a receptacle end of a cable. */
export function socketInfo(v: View, ref: PortRef): SocketInfo | undefined {
  if (ref.kind === "part") {
    const spec = entryOf(v, partById(v, ref.instanceId))?.ports.find((p) => p.id === ref.portId);
    return spec && { connector: spec.connector, function: spec.function, keying: spec.keying, label: spec.label, ownerInstanceId: ref.instanceId };
  }
  const cable = cableById(v, ref.cableId);
  const spec = cable && endSpec(v, cable, ref.endId);
  if (!cable || !spec || spec.gender !== "receptacle") return undefined;
  return { connector: spec.connector, function: spec.function, keying: spec.keying, label: spec.label, ownerInstanceId: cable.ownerInstanceId };
}

export const samePort = (a: PortRef | null | undefined, b: PortRef): boolean =>
  !!a &&
  ((a.kind === "part" && b.kind === "part" && a.instanceId === b.instanceId && a.portId === b.portId) ||
    (a.kind === "cable" && b.kind === "cable" && a.cableId === b.cableId && a.endId === b.endId));

/** The cable end plugged into this socket, if any. */
export function plugAt(v: View, ref: PortRef): { cable: CableInstance; endId: string } | undefined {
  for (const cable of v.state.cables) {
    for (const [endId, to] of Object.entries(cable.ends)) if (samePort(to, ref)) return { cable, endId };
  }
  return undefined;
}

export const cableLabel = (v: View, cable: CableInstance): Localized => cableSpec(v, cable)?.label ?? { en: cable.id, ar: cable.id };

// ---------- Diagnostics ----------

export function stamp(ref: TutorTargetRef, ctx: PCEvaluationContext, withExecution: boolean): TutorTargetRef {
  return {
    ...ref,
    ...(ctx.projectRevision !== undefined ? { projectRevision: ctx.projectRevision } : {}),
    ...(withExecution && ctx.executionId !== undefined ? { executionId: ctx.executionId } : {}),
  };
}

export const evidence = (labelEn: string, labelAr: string, observed: string, expected?: string, catalogId?: string): PCEvidence => ({
  label: { en: labelEn, ar: labelAr },
  observed,
  ...(expected !== undefined ? { expected } : {}),
  ...(catalogId !== undefined ? { catalogId } : {}),
});

export interface DiagOptions {
  /** Distinguishes the same code on different subjects; becomes part of the stable ID. */
  subject: string;
  target: TutorTargetRef;
  related?: TutorTargetRef[];
  stage?: StartupStage;
  params?: TextParams;
  evidence?: PCEvidence[];
  /** Startup-run results carry the execution ID; rejections and assembly checks do not. */
  startupRun?: boolean;
}

export function makeDiag(
  v: View,
  code: PCDiagnosticCode,
  cls: PCDiagnosticClass,
  severity: PCDiagnostic["severity"],
  o: DiagOptions,
): PCDiagnostic {
  const run = o.startupRun === true;
  return {
    id: `${code}:${o.subject}`,
    code,
    class: cls,
    severity,
    ...(o.stage ? { stage: o.stage } : {}),
    ...diagnosticText(code, o.params ?? {}),
    evidence: o.evidence ?? [],
    target: stamp(o.target, v.ctx, run),
    relatedTargets: (o.related ?? []).map((r) => stamp(r, v.ctx, run)),
  };
}
