// Shared by the PC engine tests only; not exported from the package.
import type { PCAction, PCBuildState, PCDiagnostic, StartupResult } from "@ytl/contracts";
import { pcCatalog } from "../../../../content/catalog";
import { pcPresets } from "../../../../content/catalog/presets";
import { applyAction, evaluateStartup, replay } from "./index";

/** Applies actions in order and fails the test with the rejection text if any is refused. */
export function run(state: PCBuildState, actions: PCAction[]): PCBuildState {
  for (const action of actions) {
    const r = applyAction(state, action, pcCatalog);
    if (!r.ok) throw new Error(`${action.type} rejected: ${r.rejection.code} — ${r.rejection.message.en}`);
    state = r.state;
  }
  return state;
}

/** The rejection of an action that must be refused. */
export function refusal(state: PCBuildState, action: PCAction): PCDiagnostic {
  const r = applyAction(state, action, pcCatalog);
  if (r.ok) throw new Error(`${action.type} was accepted but should have been rejected`);
  return r.rejection;
}

export function preset(id: string): PCBuildState {
  const p = pcPresets.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  const r = replay(p.actions, pcCatalog);
  const bad = r.events.find((e) => !e.accepted);
  if (bad) throw new Error(`preset ${id}: ${bad.action.type} rejected: ${bad.rejection?.code} — ${bad.rejection?.message.en}`);
  return r.state;
}

/** Presses the power button and returns the staged result. */
export function start(state: PCBuildState): StartupResult {
  return evaluateStartup(run(state, [{ type: "press_power" }]), pcCatalog, { projectRevision: 1, executionId: "run-1" });
}

export const statuses = (r: StartupResult) => r.stages.map((s) => s.status);
export const codes = (r: StartupResult) => r.stages.flatMap((s) => s.diagnostics.map((d) => d.code));

// IDs assigned by the two starter presets (one build-wide serial, in the order the preset adds things).
// ff1, ff2: the case's fitted front fans, added after the other parts.
// A: starter B, "i7-ddr5-rgb-aio" (lighting, liquid cooling). B: starter A, "i5-ddr4-air" (no lighting, air cooled).
export const A = { pc: "case-1", mb: "motherboard-2", cpu: "cpu-3", ram1: "ram-4", ram2: "ram-5", ssd: "storage-6", aio: "cooling-7", gpu: "gpu-8", psu: "psu-9", fan: "fan-10", ff1: "fan-11", ff2: "fan-12" };
export const B = { pc: "case-1", mb: "motherboard-2", cpu: "cpu-3", ram1: "ram-4", ram2: "ram-5", ssd: "storage-6", cooler: "cooling-7", gpu: "gpu-8", psu: "psu-9", fan: "fan-10", ff1: "fan-11", ff2: "fan-12", sata: "motherboard-2.sata-data-1" };
