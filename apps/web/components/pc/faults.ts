// "Find the fault": a finished build with one realistic mistake in it. The learner presses power,
// reads what the computer does (power, fans and lights, POST), finds the cause and fixes it with the
// ordinary assembly steps (push a module home, plug a lead in, move a plug, flash the BIOS).
import type { PCAction, PCBuildState } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import { connectSimpleCable, createSimpleBuild, installSimplePart, SIMPLE_PARTS, simplePartOrder, simpleCablesFor } from "./simple-model";

export type FaultKind = "ramUnseated" | "cpuPowerMissing" | "coolerLeadMissing" | "frontPanelWrong" | "biosTooOld";
export const FAULT_KINDS: readonly FaultKind[] = ["ramUnseated", "cpuPowerMissing", "coolerLeadMissing", "frontPanelWrong", "biosTooOld"];

function apply(state: PCBuildState, actions: readonly PCAction[]): PCBuildState | null {
  for (const action of actions) {
    const r = pc.applyAction(state, action, pcCatalog);
    if (!r.ok) return null;
    state = r.state;
  }
  return state;
}

/** The build on the page, every part fitted and every lead connected. */
export function finishedBuild(): PCBuildState {
  let state = createSimpleBuild();
  for (const key of simplePartOrder(state)) { const p = { key };
    const r = installSimplePart(state, p.key);
    if (!r.ok) throw new Error(`fault build: ${p.key}`);
    state = r.state;
  }
  for (const c of simpleCablesFor(state)) {
    const r = connectSimpleCable(state, c.key);
    if (!r.ok) throw new Error(`fault build: ${c.key}`);
    state = r.state;
  }
  return state;
}

const boardOf = (state: PCBuildState) => state.parts.find((p) => pcCatalog.entries.find((e) => e.id === p.catalogId)?.category === "motherboard");

/** The latest BIOS the catalog records for the board, when the CPU needs a newer one than the factory version. */
function biosStep(state: PCBuildState): { instanceId: string; factory: string; latest: string } | null {
  const board = boardOf(state);
  const entry = pcCatalog.entries.find((e) => e.id === board?.catalogId);
  const cpu = state.parts.find((p) => pcCatalog.entries.find((e) => e.id === p.catalogId)?.category === "cpu" && p.attachments.length > 0);
  if (!board || entry?.category !== "motherboard" || !cpu) return null;
  const versions = entry.spec.biosVersions.map((b) => b.version);
  const since = entry.spec.cpuSupport.find((s) => s.cpuId === cpu.catalogId)?.sinceBios;
  if (!since || versions.indexOf(since) <= versions.indexOf(entry.spec.factoryBiosVersion)) return null;
  return { instanceId: board.instanceId, factory: entry.spec.factoryBiosVersion, latest: versions.at(-1)! };
}

/** The finished build with `kind` put in; null when this build cannot have that fault. */
export function withFault(kind: FaultKind): PCBuildState | null {
  const state = finishedBuild();
  const leads = simpleCablesFor(state);
  const lead = (key: string) => leads.find((c) => c.key === key);
  switch (kind) {
    case "ramUnseated": {
      const ram = SIMPLE_PARTS.find((p) => /^ram\d*$/.test(p.key));
      return ram ? apply(state, [{ type: "set_seating", instanceId: ram.id, seating: "partial" }]) : null;
    }
    case "cpuPowerMissing": {
      const c = lead("cpuPower");
      return c ? apply(state, [{ type: "disconnect_cable_end", cableId: c.id, endId: c.endId }]) : null;
    }
    case "coolerLeadMissing": {
      const c = lead("cpuFan") ?? lead("aioPump");
      return c ? apply(state, [{ type: "disconnect_cable_end", cableId: c.id, endId: c.endId }]) : null;
    }
    case "frontPanelWrong": {
      const c = lead("powerSwitch");
      if (!c) return null;
      return apply(state, [
        { type: "disconnect_cable_end", cableId: c.id, endId: c.endId },
        { type: "connect_cable_end", cableId: c.id, endId: c.endId, to: { kind: "part", instanceId: c.instanceId, portId: "panel-reset" } },
      ]);
    }
    case "biosTooOld": {
      const b = biosStep(state);
      return b ? apply(state, [{ type: "update_bios", instanceId: b.instanceId, version: b.factory }]) : null;
    }
  }
}

/** Faults this build can have. */
export const availableFaults = (): FaultKind[] => FAULT_KINDS.filter((k) => withFault(k) !== null);

/** Flashing the newest recorded BIOS: the fix for `biosTooOld` (null when nothing to flash). */
export function flashBios(state: PCBuildState): PCBuildState | null {
  const board = boardOf(state);
  const entry = pcCatalog.entries.find((e) => e.id === board?.catalogId);
  if (!board || entry?.category !== "motherboard") return null;
  const latest = entry.spec.biosVersions.at(-1)?.version;
  if (!latest || latest === board.biosVersion) return null;
  return apply(state, [{ type: "update_bios", instanceId: board.instanceId, version: latest }]);
}
