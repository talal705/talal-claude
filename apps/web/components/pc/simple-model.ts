// One beginner PC. Learners place parts and connect their leads; seating and fasteners stay automatic.
import type { PCAction, PCBuildState, StartupResult } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { pcCatalog, suppliedPartActions } from "./catalog";

export const SIMPLE_PARTS = [
  { key: "cpu", id: "cpu-3", catalogId: "intel-core-i5-14600k", host: "motherboard-2", mount: "cpu-socket", screws: 1 },
  { key: "ram", id: "ram-4", catalogId: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", host: "motherboard-2", mount: "dimm-a2", screws: 0 },
  { key: "storage", id: "storage-5", catalogId: "samsung-990-pro-1tb", host: "motherboard-2", mount: "m2-1", screws: 1 },
  { key: "cooler", id: "cooling-6", catalogId: "arctic-freezer-36", host: "motherboard-2", mount: "cooler-mount", screws: 4 },
  { key: "motherboard", id: "motherboard-2", catalogId: "asus-tuf-gaming-z790-plus-wifi", host: "case-1", mount: "motherboard-tray", screws: 9 },
  { key: "gpu", id: "gpu-7", catalogId: "asus-dual-rtx4060-o8g", host: "motherboard-2", mount: "pcie-x16-1", screws: 2 },
  { key: "psu", id: "psu-8", catalogId: "corsair-cx550", host: "case-1", mount: "psu-bay", screws: 4 },
] as const;

export type SimplePartKey = (typeof SIMPLE_PARTS)[number]["key"];

/** The supplied PSU has captive leads. Each step connects its free device end. */
export const SIMPLE_CABLES = [
  { key: "atx", id: "psu-8.atx24", endId: "device", instanceId: "motherboard-2", portId: "atx-24", requires: ["psu", "motherboard"], essential: true },
  { key: "cpuPower", id: "psu-8.eps", endId: "device", instanceId: "motherboard-2", portId: "eps-1", requires: ["psu", "motherboard"], essential: true },
  { key: "gpuPower", id: "psu-8.pcie", endId: "device-1", instanceId: "gpu-7", portId: "power-8pin", requires: ["psu", "gpu"], essential: true },
  { key: "cpuFan", id: "cooling-6.fan", endId: "plug", instanceId: "motherboard-2", portId: "cpu-fan", requires: ["cpu", "cooler"], essential: true },
  { key: "powerSwitch", id: "case-1.power-switch", endId: "plug", instanceId: "motherboard-2", portId: "panel-pwrsw", requires: ["motherboard"], essential: true },
  { key: "caseFan1", id: "fan-9.fan", endId: "plug", instanceId: "motherboard-2", portId: "cha-fan-1", requires: ["motherboard"], essential: false },
  { key: "caseFan2", id: "fan-10.fan", endId: "plug", instanceId: "motherboard-2", portId: "cha-fan-2", requires: ["motherboard"], essential: false },
] as const satisfies readonly { key: string; id: string; endId: string; instanceId: string; portId: string; requires: readonly SimplePartKey[]; essential: boolean }[];

export type SimpleCableKey = (typeof SIMPLE_CABLES)[number]["key"];
export type SimpleSnapshot = { version: 2; placed: SimplePartKey[]; connected: SimpleCableKey[]; powered: boolean };
export type SimpleBlock = "cpuFirst" | "boardFirst" | "prepareBoard" | "cannotFit";
export type SimpleCableBlock = "fitCableParts" | "turnOffFirst" | "cannotConnect";
// Keep the original storage key so an existing learner's progress can migrate in place.
export const SIMPLE_SAVE_KEY = "ytl_simple_pc_v1";
export const emptySimpleSnapshot = (): SimpleSnapshot => ({ version: 2, placed: [], connected: [], powered: false });

function run(state: PCBuildState, actions: readonly PCAction[]): PCBuildState {
  for (const action of actions) {
    const step = pc.applyAction(state, action, pcCatalog);
    if (!step.ok) throw new Error(`Simple PC: ${step.rejection.code}`);
    state = step.state;
  }
  return state;
}

export function createSimpleBuild(): PCBuildState {
  const order = ["corsair-4000d-airflow-black", ...[...SIMPLE_PARTS].sort((a, b) => Number(a.id.split("-").at(-1)) - Number(b.id.split("-").at(-1))).map((p) => p.catalogId)];
  const actions: PCAction[] = [
    { type: "set_rgb_preference", preference: "without_rgb" },
    ...order.map((catalogId): PCAction => ({ type: "add_part", catalogId })),
    ...suppliedPartActions(order[0], "case-1", 9).actions,
    { type: "update_bios", instanceId: "motherboard-2", version: "1840" },
  ];
  return run(pc.createBuild(pcCatalog), actions);
}

export function simplePartInstalled(state: PCBuildState, key: SimplePartKey): boolean {
  const spec = SIMPLE_PARTS.find((p) => p.key === key)!;
  return state.parts.some((p) => p.instanceId === spec.id && p.attachments.some((a) => a.target.hostInstanceId === spec.host && a.target.mountPointId === spec.mount && a.seating === "seated" && a.fastenersSecured >= spec.screws));
}

export function simpleBlock(state: PCBuildState, key: SimplePartKey): SimpleBlock | null {
  if (key === "cooler" && !simplePartInstalled(state, "cpu")) return "cpuFirst";
  if (key === "motherboard" && !(["cpu", "ram", "storage", "cooler"] as const).every((k) => simplePartInstalled(state, k))) return "prepareBoard";
  if ((key === "gpu" || key === "psu") && !simplePartInstalled(state, "motherboard")) return "boardFirst";
  return null;
}

export function installSimplePart(state: PCBuildState, key: SimplePartKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  if (simplePartInstalled(state, key)) return { ok: true, state };
  const blocked = simpleBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  const spec = SIMPLE_PARTS.find((p) => p.key === key)!;
  try {
    return { ok: true, state: run(state, [
      { type: "mount_part", instanceId: spec.id, target: { hostInstanceId: spec.host, mountPointId: spec.mount } },
      { type: "set_seating", instanceId: spec.id, seating: "seated" },
      ...(spec.screws ? [{ type: "set_fasteners", instanceId: spec.id, secured: spec.screws } as PCAction] : []),
    ]) };
  } catch { return { ok: false, reason: "cannotFit" }; }
}

export function simpleCableConnected(state: PCBuildState, key: SimpleCableKey): boolean {
  const spec = SIMPLE_CABLES.find((c) => c.key === key)!;
  const end = state.cables.find((c) => c.id === spec.id)?.ends[spec.endId];
  return end?.kind === "part" && end.instanceId === spec.instanceId && end.portId === spec.portId;
}

export function simpleCableBlock(state: PCBuildState, key: SimpleCableKey): SimpleCableBlock | null {
  if (state.power.pressed) return "turnOffFirst";
  const spec = SIMPLE_CABLES.find((c) => c.key === key)!;
  return spec.requires.every((part) => simplePartInstalled(state, part)) ? null : "fitCableParts";
}

export function connectSimpleCable(state: PCBuildState, key: SimpleCableKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleCableBlock } {
  const blocked = simpleCableBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  if (simpleCableConnected(state, key)) return { ok: true, state };
  const spec = SIMPLE_CABLES.find((c) => c.key === key)!;
  const step = pc.applyAction(state, { type: "connect_cable_end", cableId: spec.id, endId: spec.endId, to: { kind: "part", instanceId: spec.instanceId, portId: spec.portId } }, pcCatalog);
  return step.ok ? { ok: true, state: step.state } : { ok: false, reason: "cannotConnect" };
}

export function disconnectSimpleCable(state: PCBuildState, key: SimpleCableKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleCableBlock } {
  if (state.power.pressed) return { ok: false, reason: "turnOffFirst" };
  if (!simpleCableConnected(state, key)) return { ok: true, state };
  const spec = SIMPLE_CABLES.find((c) => c.key === key)!;
  const step = pc.applyAction(state, { type: "disconnect_cable_end", cableId: spec.id, endId: spec.endId }, pcCatalog);
  return step.ok ? { ok: true, state: step.state } : { ok: false, reason: "cannotConnect" };
}

/** Only mains/PSU switches remain automatic; internal leads must be connected by the learner. */
export function startSimplePC(state: PCBuildState): { ok: boolean; state: PCBuildState; startup: StartupResult } {
  if (!SIMPLE_PARTS.every((p) => simplePartInstalled(state, p.key))) return { ok: false, state, startup: pc.evaluateStartup(state, pcCatalog) };
  if (!state.power.pressed) {
    state = run(state, [
      { type: "set_side_panel", open: false },
      { type: "set_wall_power", connected: true },
      { type: "set_psu_switch", on: true },
      { type: "press_power" },
    ]);
  }
  const startup = pc.evaluateStartup(state, pcCatalog);
  const ok = startup.outcome === "operational";
  // A failed try leaves wiring editable. Preserve its diagnostics for the caller's feedback.
  if (!ok && state.power.pressed) state = run(state, [{ type: "power_off" }]);
  return { ok, state, startup };
}

export function simpleBuildFromSnapshot(snapshot: SimpleSnapshot): PCBuildState {
  let state = createSimpleBuild();
  for (const key of snapshot.placed) {
    const step = installSimplePart(state, key);
    if (!step.ok) throw new Error("Invalid simple assembly order");
    state = step.state;
  }
  for (const key of snapshot.connected) {
    const step = connectSimpleCable(state, key);
    if (!step.ok) throw new Error("Invalid simple cable connection");
    state = step.state;
  }
  return snapshot.powered ? startSimplePC(state).state : state;
}

export function parseSimpleSnapshot(value: unknown): SimpleSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.placed) || typeof data.powered !== "boolean" || new Set(data.placed).size !== data.placed.length || !data.placed.every((k) => SIMPLE_PARTS.some((p) => p.key === k))) return null;
  const connected = data.version === 1 ? (data.powered ? SIMPLE_CABLES.map((c) => c.key) : []) : data.connected;
  if (!Array.isArray(connected) || new Set(connected).size !== connected.length || !connected.every((k) => SIMPLE_CABLES.some((c) => c.key === k))) return null;
  const migrated: SimpleSnapshot = { version: 2, placed: [...data.placed] as SimplePartKey[], connected: [...connected] as SimpleCableKey[], powered: data.powered };
  try {
    const state = simpleBuildFromSnapshot(migrated);
    if (migrated.powered && pc.evaluateStartup(state, pcCatalog).outcome !== "operational") return null;
    return migrated;
  } catch { return null; }
}
