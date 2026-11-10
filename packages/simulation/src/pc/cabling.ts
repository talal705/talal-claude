// Cable rules: which end goes where, and whether power actually reaches a socket.
import type {
  CableId,
  CableInstance,
  InstanceId,
  PCBuildState,
  PCCableEndOption,
  PCCatalog,
  PCDiagnostic,
  PCDiagnosticClass,
  PCDiagnosticCode,
  PCEvaluationContext,
  PCEvidence,
  PortRef,
  PsuEntry,
} from "@ytl/contracts";
import { pcTarget } from "@ytl/contracts";
import { CONNECTOR_NAME, connectorGroup, connectorsMate, lookAlike } from "./connectors";
import { L, type TextParams } from "./messages";
import {
  type Placed,
  type View,
  cableById,
  cableSpec,
  displayName,
  endSpec,
  entryOf,
  evidence,
  isMounted,
  makeDiag,
  makeView,
  partById,
  partsOf,
  plugAt,
  socketInfo,
} from "./view";

export type ConnectCheck = { ok: true } | { ok: false; rejection: PCDiagnostic };

function reject(
  v: View,
  code: PCDiagnosticCode,
  cls: PCDiagnosticClass,
  cableId: CableId,
  endId: string,
  to: PortRef,
  params: TextParams,
  ev: PCEvidence[] = [],
): ConnectCheck {
  return {
    ok: false,
    rejection: makeDiag(v, code, cls, "blocking", {
      subject: `${cableId}/${endId}@${pcTarget.port(to).id}`,
      target: pcTarget.port(to),
      related: [pcTarget.cableEnd(cableId, endId)],
      params: { ...params, have: params.have ?? ev[0]?.observed ?? "", want: params.want ?? ev[0]?.expected ?? ev[1]?.observed ?? "" },
      evidence: ev,
    }),
  };
}

/** `corsair-type4` -> `Corsair Type 4`: the cable family as the manufacturer names it. */
const familyName = (keying: string | undefined): string =>
  (family(keying) ?? "-")
    .split("-")
    .map((w) => w.replace(/^type(\d+)$/, "Type $1").replace(/^[a-z]/, (c) => c.toUpperCase()))
    .join(" ");

const family = (keying: string | undefined) => keying?.split(":")[0];

export function checkConnect(v: View, cableId: CableId, endId: string, to: PortRef): ConnectCheck {
  const cable = cableById(v, cableId);
  const plug = cable && endSpec(v, cable, endId);
  const socket = socketInfo(v, to);
  if (!cable || !plug) return reject(v, "unknown_reference", "assembly", cableId, endId, to, { what: `${cableId}/${endId}` });
  if (!socket) return reject(v, "unknown_reference", "assembly", cableId, endId, to, { what: pcTarget.port(to).id });

  const owner = socket.ownerInstanceId ? entryOf(v, partById(v, socket.ownerInstanceId)) : undefined;
  const p: TextParams = { port: socket.label, part: owner ? displayName(owner) : "" };

  if (plug.gender !== "plug") {
    return reject(v, "invalid_action", "assembly", cableId, endId, to, {
      why: L("This end is a socket: another cable's plug goes into it.", "هذا الطرف مدخل: يدخل فيه راس كيبل ثاني."),
    });
  }
  if (to.kind === "cable" && to.cableId === cableId) {
    return reject(v, "invalid_action", "assembly", cableId, endId, to, { why: L("A cable cannot be plugged into itself.", "الكيبل ما يتوصّل بنفسه.") });
  }
  if (cable.ends[endId]) {
    return reject(v, "invalid_action", "assembly", cableId, endId, to, {
      why: L("This end is already plugged in. Unplug it before you move it.", "هذا الطرف موصّل. افصله قبل ما تنقله."),
    });
  }
  if (plugAt(v, to)) return reject(v, "port_occupied", "assembly", cableId, endId, to, p);

  const shapes = [
    evidence("Plug", "الراس", CONNECTOR_NAME[plug.connector]),
    evidence("Socket", "المدخل", CONNECTOR_NAME[socket.connector], CONNECTOR_NAME[plug.connector]),
  ];
  p.have = CONNECTOR_NAME[plug.connector];
  p.want = CONNECTOR_NAME[socket.connector];
  if (!connectorsMate(plug.connector, socket.connector)) {
    const a = connectorGroup(plug.connector);
    const b = connectorGroup(socket.connector);
    if ((a === "cpu_power" && b === "gpu_power_8") || (a === "gpu_power_8" && b === "cpu_power")) {
      return reject(v, "eps_pcie_not_interchangeable", "impossible_fit", cableId, endId, to, p, shapes);
    }
    if (a === "lighting" && b === "lighting") return reject(v, "rgb_argb_not_interchangeable", "impossible_fit", cableId, endId, to, p, shapes);
    return reject(v, "connector_mismatch", "impossible_fit", cableId, endId, to, p, shapes);
  }
  if (plug.keying !== socket.keying && (plug.keying || socket.keying)) {
    const keys = [
      evidence("Cable type", "نوع الكيبل", plug.keying ?? "-", socket.keying ?? "-", cable.catalogId),
      evidence("Socket type", "نوع المدخل", socket.keying ?? "-", undefined, owner?.id),
    ];
    // Same shape, different manufacturer cable family: it may even fit, which is exactly the danger.
    if (family(plug.keying) !== family(socket.keying)) {
      return reject(v, "modular_cable_mismatch", "assembly", cableId, endId, to, { ...p, have: familyName(plug.keying), want: familyName(socket.keying) }, keys);
    }
    return reject(v, "connector_mismatch", "impossible_fit", cableId, endId, to, p, keys);
  }
  return { ok: true };
}

/**
 * Every socket in the build that has the same connector shape as this cable end or a look-alike shape,
 * each with whether the end can go there and, if not, why. Pure: nothing is logged.
 */
export function cableEndOptions(state: PCBuildState, catalog: PCCatalog, cableId: CableId, endId: string, ctx: PCEvaluationContext = {}): PCCableEndOption[] {
  const v = makeView(state, catalog, ctx);
  const cable = cableById(v, cableId);
  const plug = cable && endSpec(v, cable, endId);
  if (!cable || !plug || plug.gender !== "plug" || cable.ends[endId]) return [];
  const options: PCCableEndOption[] = [];
  const consider = (to: PortRef) => {
    const socket = socketInfo(v, to);
    if (!socket || !lookAlike(plug.connector, socket.connector)) return;
    const check = checkConnect(v, cableId, endId, to);
    options.push({ to, label: socket.label, ok: check.ok, ...(check.ok ? {} : { rejection: check.rejection }) });
  };
  for (const part of state.parts) {
    for (const port of entryOf(v, part)?.ports ?? []) consider({ kind: "part", instanceId: part.instanceId, portId: port.id });
  }
  for (const other of state.cables) {
    if (other.id === cableId) continue;
    for (const e of cableSpec(v, other)?.ends ?? []) if (e.gender === "receptacle") consider({ kind: "cable", cableId: other.id, endId: e.id });
  }
  return options;
}

// ---------- Power tracing ----------

/** The power supply that is installed in the case (the first one, if several were added). */
export function installedPsu(v: View): Placed<PsuEntry> | undefined {
  return partsOf(v, "psu").find((x) => isMounted(x.part));
}

export const psuLive = (v: View): boolean => !!installedPsu(v) && v.state.power.wallConnected && v.state.power.psuSwitchOn;

export type Feed =
  /** A cable is plugged in and traces back to the installed power supply. */
  | "connected"
  /** A cable is plugged in here, but its power-supply side is loose or leads nowhere. */
  | "source_loose"
  | "none";

/** Whether the cable is electrically joined to the installed power supply (regardless of the mains switch). */
export function cableReachesPsu(v: View, cable: CableInstance, depth = 0): boolean {
  const spec = cableSpec(v, cable);
  const psu = installedPsu(v);
  if (!spec || !psu || depth > 4) return false;
  const sources = spec.ends.filter((e) => e.side === "source");
  if (spec.attachment === "captive") return cable.ownerInstanceId === psu.part.instanceId;
  if (sources.length === 0) return false;
  return sources.every((s) => {
    if (s.gender === "plug") {
      const to = cable.ends[s.id];
      return !!to && to.kind === "part" && to.instanceId === psu.part.instanceId;
    }
    // Adapter input: a live cable's plug must be in it.
    const incoming = plugAt(v, { kind: "cable", cableId: cable.id, endId: s.id });
    return !!incoming && cableReachesPsu(v, incoming.cable, depth + 1);
  });
}

export function feedOf(v: View, instanceId: InstanceId, portId: string): { feed: Feed; cable?: CableInstance; endId?: string } {
  const plug = plugAt(v, { kind: "part", instanceId, portId });
  if (!plug) return { feed: "none" };
  return { feed: cableReachesPsu(v, plug.cable) ? "connected" : "source_loose", cable: plug.cable, endId: plug.endId };
}

/** For an adapter or modular cable that does not reach the PSU: how many of its source ends are connected. */
export function sourceProgress(v: View, cable: CableInstance): { done: number; total: number; firstLoose?: string } {
  const sources = cableSpec(v, cable)?.ends.filter((e) => e.side === "source") ?? [];
  let done = 0;
  let firstLoose: string | undefined;
  for (const s of sources) {
    const ok = s.gender === "plug" ? !!cable.ends[s.id] : !!plugAt(v, { kind: "cable", cableId: cable.id, endId: s.id });
    if (ok) done += 1;
    else firstLoose ??= s.id;
  }
  return { done, total: sources.length, ...(firstLoose ? { firstLoose } : {}) };
}
