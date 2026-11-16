// What the 3D view of the single-PC page needs beyond the build: a workbench where parts keep their
// places, and the places to click for what is in hand.
import type { PCBuildState } from "@ytl/contracts";
import { catalogIndex } from "./catalog";
import type { Selection } from "./companion";
import { ALL_SIMPLE_CABLES, ALL_SIMPLE_PARTS, simpleBlock, simpleCableBlock, simpleCableConnected, simpleCablesFor, simplePartInstalled, simpleRadiatorTarget, simpleTarget } from "./simple-model";

/** The second stick lies beside the first; every other part keeps the place it always had. */
export const SECOND_RAM_ID = "ram-11";
const FIRST_RAM_ID = "ram-4";
/** The second CPU lies beside the first, like the second RAM stick; the liquid cooler takes the next free bench place. */
export const SECOND_CPU_ID = "cpu-12";
const FIRST_CPU_ID = "cpu-3";
const BESIDE: Record<string, string> = { [SECOND_RAM_ID]: FIRST_RAM_ID, [SECOND_CPU_ID]: FIRST_CPU_ID };

export function simpleBenchLayout(initial: PCBuildState): { benchOrder: string[]; beside: Record<string, string> } {
  return {
    benchOrder: initial.parts.filter((part) => part.attachments.length === 0 && !BESIDE[part.instanceId]).map((part) => part.instanceId),
    beside: { ...BESIDE },
  };
}

/**
 * A place drawn in the 3D view. `target` is where the selection goes and glows; a `decoy` is another
 * slot or port of the same kind, drawn plainly but clickable, so a wrong click can be explained.
 */
export interface SimpleSceneTarget {
  id: string;
  kind: "mount" | "port";
  hostInstanceId: string;
  placeId: string;
  role: "target" | "decoy";
}

/** Slots of the same family as `mountId` on a host (`dimm-a1` … `dimm-b2`, `m2-1` …, `pcie-x16-1` …). */
function siblingMounts(hostCatalogId: string, mountId: string): string[] {
  const family = mountId.startsWith("dimm-") ? "dimm-" : mountId.startsWith("m2-") ? "m2-" : mountId.startsWith("pcie-") ? "pcie-" : null;
  if (!family) return [];
  return (catalogIndex.byId.get(hostCatalogId)?.mountPoints ?? []).map((m) => m.id).filter((id) => id.startsWith(family) && id !== mountId);
}

export function simpleSceneTargets(state: PCBuildState, selection: Selection): SimpleSceneTarget[] {
  if (!selection || state.power.pressed) return [];
  if (selection.kind === "part") {
    if (simplePartInstalled(state, selection.key) || simpleBlock(state, selection.key)) return [];
    const target = simpleTarget(state, selection.key);
    const host = state.parts.find((part) => part.instanceId === target.hostInstanceId);
    if (!host) return [];
    const taken = new Set(state.parts.flatMap((part) => part.attachments.filter((a) => a.target.hostInstanceId === host.instanceId).map((a) => a.target.mountPointId)));
    // A liquid cooler's radiator position in the case glows too: one tap fits block and radiator.
    const radiator = simpleRadiatorTarget(selection.key);
    return [
      { id: `target:${target.mountPointId}`, kind: "mount", hostInstanceId: host.instanceId, placeId: target.mountPointId, role: "target" },
      ...(radiator ? [{ id: `target:${radiator.mountPointId}`, kind: "mount", hostInstanceId: radiator.hostInstanceId, placeId: radiator.mountPointId, role: "target" } as SimpleSceneTarget] : []),
      ...siblingMounts(host.catalogId, target.mountPointId)
        .filter((id) => !taken.has(id))
        .map((id): SimpleSceneTarget => ({ id: `decoy:${id}`, kind: "mount", hostInstanceId: host.instanceId, placeId: id, role: "decoy" })),
    ];
  }
  if (simpleCableConnected(state, selection.key) || simpleCableBlock(state, selection.key)) return [];
  const own = ALL_SIMPLE_CABLES.find((cable) => cable.key === selection.key)!;
  const hostReady = (instanceId: string) => ALL_SIMPLE_PARTS.some((part) => part.id === instanceId && simplePartInstalled(state, part.key));
  const free = (instanceId: string, portId: string) => !state.cables.some((cable) => Object.values(cable.ends).some((end) => end?.kind === "part" && end.instanceId === instanceId && end.portId === portId));
  // Other leads' free ports, and the look-alike headers next to this one (CPU_OPT beside CPU_FAN, EPS_2 beside EPS_1, …).
  const decoys = new Map<string, string>();
  for (const cable of simpleCablesFor(state)) if (cable.key !== own.key && !simpleCableConnected(state, cable.key) && hostReady(cable.instanceId)) decoys.set(`${cable.instanceId}/${cable.portId}`, cable.portId);
  const family = PORT_FAMILIES.find((prefixes) => prefixes.some((prefix) => own.portId.startsWith(prefix)));
  const host = state.parts.find((part) => part.instanceId === own.instanceId);
  if (family && host) {
    for (const port of catalogIndex.byId.get(host.catalogId)?.ports ?? []) {
      if (port.id !== own.portId && family.some((prefix) => port.id.startsWith(prefix)) && free(host.instanceId, port.id)) decoys.set(`${host.instanceId}/${port.id}`, port.id);
    }
  }
  return [
    { id: `target:${own.portId}`, kind: "port", hostInstanceId: own.instanceId, placeId: own.portId, role: "target" },
    ...[...decoys].filter(([key]) => key !== `${own.instanceId}/${own.portId}`).map(([key, portId]): SimpleSceneTarget => ({ id: `decoy:${portId}`, kind: "port", hostInstanceId: key.slice(0, key.indexOf("/")), placeId: portId, role: "decoy" })),
  ];
}

/** Headers that look alike on the board. */
const PORT_FAMILIES: readonly (readonly string[])[] = [["cpu-fan", "cpu-opt", "aio-pump", "cha-fan-"], ["eps-"], ["panel-"]];

/** The lead whose port this is, for "that port is for …". */
export const cableOfPort = (portId: string, state?: PCBuildState) => (state ? simpleCablesFor(state) : ALL_SIMPLE_CABLES).find((cable) => cable.portId === portId)?.key ?? null;
