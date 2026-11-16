// One beginner PC. Learners place parts and connect their leads; seating and fasteners stay automatic.
import type { PCAction, PCBuildState, StartupResult } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { pcCatalog, suppliedPartActions } from "./catalog";

const RAM_ID = "corsair-vengeance-rgb-ddr5-6000-32gb-kit";
const BOARD_ID = "asus-tuf-gaming-z790-plus-wifi";

/**
 * Memory slots for two modules on the ASUS TUF GAMING Z790-PLUS WIFI, from its manual's
 * recommended population (`spec.memory.recommendedPopulation`): the first module goes in A2,
 * the second in B2. Either stick may be fitted first; the order of fitting picks the slot.
 */
export const RAM_SLOTS = (() => {
  const board = pcCatalog.entries.find((entry) => entry.id === BOARD_ID) as { spec?: { memory?: { recommendedPopulation?: { modules: number; slotIds: string[] }[] } } } | undefined;
  const two = board?.spec?.memory?.recommendedPopulation?.find((row) => row.modules === 2)?.slotIds;
  return (two && two.length === 2 ? two : ["dimm-a2", "dimm-b2"]) as unknown as readonly [string, string];
})();

export const SIMPLE_PARTS = [
  { key: "cpu", id: "cpu-3", catalogId: "intel-core-i5-14600k", host: "motherboard-2", mount: "cpu-socket", screws: 1 },
  { key: "ram", id: "ram-4", catalogId: RAM_ID, host: "motherboard-2", mount: "dimm", screws: 0 },
  // The second stick of the kit is added after the case's supplied fans, so every older instance ID
  // (and every saved build and cable that names one) is unchanged.
  { key: "ram2", id: "ram-11", catalogId: RAM_ID, host: "motherboard-2", mount: "dimm", screws: 0 },
  { key: "storage", id: "storage-5", catalogId: "samsung-990-pro-1tb", host: "motherboard-2", mount: "m2-1", screws: 1 },
  { key: "cooler", id: "cooling-6", catalogId: "arctic-freezer-36", host: "motherboard-2", mount: "cooler-mount", screws: 4 },
  { key: "motherboard", id: "motherboard-2", catalogId: BOARD_ID, host: "case-1", mount: "motherboard-tray", screws: 9 },
  { key: "gpu", id: "gpu-7", catalogId: "asus-dual-rtx4060-o8g", host: "motherboard-2", mount: "pcie-x16-1", screws: 2 },
  { key: "psu", id: "psu-8", catalogId: "corsair-cx550", host: "case-1", mount: "psu-bay", screws: 4 },
] as const;

export type SimplePartKey = (typeof SIMPLE_PARTS)[number]["key"];
const RAM_KEYS: readonly SimplePartKey[] = ["ram", "ram2"];
export const isRamKey = (key: SimplePartKey) => RAM_KEYS.includes(key);
/** Parts fitted to the motherboard while it is still on the workbench. */
export const BOARD_PREP: readonly SimplePartKey[] = ["cpu", "ram", "ram2", "storage", "cooler"];

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
/** One learner step, in the order it was taken: `part:cpu`, `cable:atx`. */
export type SimpleStep = `part:${SimplePartKey}` | `cable:${SimpleCableKey}`;
/**
 * Saved progress. `placed` and `connected` say what is fitted; `history` is the same steps in the
 * order they were taken, so the latest one can be undone without breaking what depends on it.
 */
export type SimpleSnapshot = { version: 3; placed: SimplePartKey[]; connected: SimpleCableKey[]; history: SimpleStep[]; powered: boolean };
export type SimpleBlock = "cpuFirst" | "boardFirst" | "prepareBoard" | "cannotFit";
export type SimpleCableBlock = "fitCableParts" | "turnOffFirst" | "cannotConnect";
// Keep the original storage key so an existing learner's progress can migrate in place.
export const SIMPLE_SAVE_KEY = "ytl_simple_pc_v1";
export const emptySimpleSnapshot = (): SimpleSnapshot => ({ version: 3, placed: [], connected: [], history: [], powered: false });

const partSpec = (key: SimplePartKey) => SIMPLE_PARTS.find((p) => p.key === key)!;
const cableSpec = (key: SimpleCableKey) => SIMPLE_CABLES.find((c) => c.key === key)!;

function run(state: PCBuildState, actions: readonly PCAction[]): PCBuildState {
  for (const action of actions) {
    const step = pc.applyAction(state, action, pcCatalog);
    if (!step.ok) throw new Error(`Simple PC: ${step.rejection.code}`);
    state = step.state;
  }
  return state;
}

export function createSimpleBuild(): PCBuildState {
  const firstParts = SIMPLE_PARTS.filter((p) => p.key !== "ram2");
  const order = ["corsair-4000d-airflow-black", ...[...firstParts].sort((a, b) => Number(a.id.split("-").at(-1)) - Number(b.id.split("-").at(-1))).map((p) => p.catalogId)];
  const actions: PCAction[] = [
    { type: "set_rgb_preference", preference: "without_rgb" },
    ...order.map((catalogId): PCAction => ({ type: "add_part", catalogId })),
    ...suppliedPartActions(order[0], "case-1", 9).actions,
    { type: "add_part", catalogId: RAM_ID },
    { type: "update_bios", instanceId: "motherboard-2", version: "1840" },
  ];
  return run(pc.createBuild(pcCatalog), actions);
}

/** The slot or place a part is fitted to. A RAM stick takes A2 when it is first in, B2 when the other stick holds A2. */
export function simpleTarget(state: PCBuildState, key: SimplePartKey): { hostInstanceId: string; mountPointId: string } {
  const spec = partSpec(key);
  if (!isRamKey(key)) return { hostInstanceId: spec.host, mountPointId: spec.mount };
  const own = state.parts.find((p) => p.instanceId === spec.id)?.attachments.find((a) => a.target.hostInstanceId === spec.host);
  if (own) return { hostInstanceId: spec.host, mountPointId: own.target.mountPointId };
  const taken = new Set(state.parts.flatMap((p) => p.attachments.filter((a) => a.target.hostInstanceId === spec.host).map((a) => a.target.mountPointId)));
  return { hostInstanceId: spec.host, mountPointId: RAM_SLOTS.find((slot) => !taken.has(slot)) ?? RAM_SLOTS[0] };
}

export function simplePartInstalled(state: PCBuildState, key: SimplePartKey): boolean {
  const spec = partSpec(key);
  const mounts: readonly string[] = isRamKey(key) ? RAM_SLOTS : [spec.mount];
  return state.parts.some((p) => p.instanceId === spec.id && p.attachments.some((a) => a.target.hostInstanceId === spec.host && mounts.includes(a.target.mountPointId) && a.seating === "seated" && a.fastenersSecured >= spec.screws));
}

/** Parts that must be in before this one, in the order a learner would fit them. */
export function simplePrerequisites(key: SimplePartKey): SimplePartKey[] {
  if (key === "cooler") return ["cpu"];
  if (key === "motherboard") return [...BOARD_PREP];
  if (key === "gpu" || key === "psu") return ["motherboard"];
  return [];
}

export function simpleBlock(state: PCBuildState, key: SimplePartKey): SimpleBlock | null {
  if (key === "cooler" && !simplePartInstalled(state, "cpu")) return "cpuFirst";
  if (key === "motherboard" && !BOARD_PREP.every((k) => simplePartInstalled(state, k))) return "prepareBoard";
  if ((key === "gpu" || key === "psu") && !simplePartInstalled(state, "motherboard")) return "boardFirst";
  return null;
}

export function installSimplePart(state: PCBuildState, key: SimplePartKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  if (simplePartInstalled(state, key)) return { ok: true, state };
  const blocked = simpleBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  const spec = partSpec(key);
  try {
    return { ok: true, state: run(state, [
      { type: "mount_part", instanceId: spec.id, target: simpleTarget(state, key) },
      { type: "set_seating", instanceId: spec.id, seating: "seated" },
      ...(spec.screws ? [{ type: "set_fasteners", instanceId: spec.id, secured: spec.screws } as PCAction] : []),
    ]) };
  } catch { return { ok: false, reason: "cannotFit" }; }
}

export function simpleCableConnected(state: PCBuildState, key: SimpleCableKey): boolean {
  const spec = cableSpec(key);
  const end = state.cables.find((c) => c.id === spec.id)?.ends[spec.endId];
  return end?.kind === "part" && end.instanceId === spec.instanceId && end.portId === spec.portId;
}

export function simpleCableBlock(state: PCBuildState, key: SimpleCableKey): SimpleCableBlock | null {
  if (state.power.pressed) return "turnOffFirst";
  const spec = cableSpec(key);
  return spec.requires.every((part) => simplePartInstalled(state, part)) ? null : "fitCableParts";
}

export function connectSimpleCable(state: PCBuildState, key: SimpleCableKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleCableBlock } {
  const blocked = simpleCableBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  if (simpleCableConnected(state, key)) return { ok: true, state };
  const spec = cableSpec(key);
  const step = pc.applyAction(state, { type: "connect_cable_end", cableId: spec.id, endId: spec.endId, to: { kind: "part", instanceId: spec.instanceId, portId: spec.portId } }, pcCatalog);
  return step.ok ? { ok: true, state: step.state } : { ok: false, reason: "cannotConnect" };
}

export function disconnectSimpleCable(state: PCBuildState, key: SimpleCableKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleCableBlock } {
  if (state.power.pressed) return { ok: false, reason: "turnOffFirst" };
  if (!simpleCableConnected(state, key)) return { ok: true, state };
  const spec = cableSpec(key);
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

/** Every part fitted and every lead connected, case fans included: the whole build, not only what boots. */
export function simpleAssemblyComplete(state: PCBuildState): boolean {
  return SIMPLE_PARTS.every((p) => simplePartInstalled(state, p.key)) && SIMPLE_CABLES.every((c) => simpleCableConnected(state, c.key));
}

export function simpleBuildFromSnapshot(snapshot: SimpleSnapshot): PCBuildState {
  let state = createSimpleBuild();
  // Parts in the order they were fitted (the RAM slot follows it), then leads.
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

// ---------- Learner steps on a snapshot ----------

export const withPart = (snapshot: SimpleSnapshot, key: SimplePartKey): SimpleSnapshot =>
  snapshot.placed.includes(key) ? snapshot : { ...snapshot, placed: [...snapshot.placed, key], history: [...snapshot.history, `part:${key}`] };

export const withCable = (snapshot: SimpleSnapshot, key: SimpleCableKey): SimpleSnapshot =>
  snapshot.connected.includes(key) ? snapshot : { ...snapshot, connected: [...snapshot.connected, key], history: [...snapshot.history, `cable:${key}`] };

export const withoutCable = (snapshot: SimpleSnapshot, key: SimpleCableKey): SimpleSnapshot =>
  ({ ...snapshot, connected: snapshot.connected.filter((k) => k !== key), history: snapshot.history.filter((step) => step !== `cable:${key}`) });

/** The step `undoSimpleStep` would take back, or null when there is none (or the PC is on). */
export function lastSimpleStep(snapshot: SimpleSnapshot): SimpleStep | null {
  return snapshot.powered ? null : (snapshot.history.at(-1) ?? null);
}

/**
 * Takes back the latest step. Steps are undone newest first, so nothing still fitted can depend on
 * the one removed: a lead is connected only after its parts, and the board moves into the case only
 * after everything it carries. The PC must be off.
 */
export function undoSimpleStep(snapshot: SimpleSnapshot): SimpleSnapshot | null {
  const last = lastSimpleStep(snapshot);
  if (!last) return null;
  const [kind, key] = last.split(":") as ["part" | "cable", string];
  return {
    ...snapshot,
    placed: kind === "part" ? snapshot.placed.filter((k) => k !== key) : snapshot.placed,
    connected: kind === "cable" ? snapshot.connected.filter((k) => k !== key) : snapshot.connected,
    history: snapshot.history.slice(0, -1),
  };
}

// ---------- Saved progress ----------

const isPartKey = (k: unknown): k is SimplePartKey => SIMPLE_PARTS.some((p) => p.key === k);
const isCableKey = (k: unknown): k is SimpleCableKey => SIMPLE_CABLES.some((c) => c.key === k);

export function parseSimpleSnapshot(value: unknown): SimpleSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if ((data.version !== 1 && data.version !== 2 && data.version !== 3) || !Array.isArray(data.placed) || typeof data.powered !== "boolean" || new Set(data.placed).size !== data.placed.length || !data.placed.every(isPartKey)) return null;
  const connected = data.version === 1 ? (data.powered ? SIMPLE_CABLES.map((c) => c.key) : []) : data.connected;
  if (!Array.isArray(connected) || new Set(connected).size !== connected.length || !connected.every(isCableKey)) return null;
  let placed = [...data.placed] as SimplePartKey[];
  // Saved before the second stick existed: the board was prepared with one. Fit the second one
  // right after the first, so the build the learner had is still complete.
  if (data.version !== 3 && placed.includes("ram") && !placed.includes("ram2")) placed.splice(placed.indexOf("ram") + 1, 0, "ram2");
  let history: SimpleStep[];
  if (data.version === 3) {
    if (!Array.isArray(data.history)) return null;
    history = [...data.history] as SimpleStep[];
    const expected = new Set<string>([...placed.map((k) => `part:${k}`), ...(connected as string[]).map((k) => `cable:${k}`)]);
    if (history.length !== expected.size || new Set(history).size !== history.length || !history.every((step) => expected.has(step))) return null;
    // The order of fitting decides the RAM slots: take it from the history.
    placed = history.filter((step) => step.startsWith("part:")).map((step) => step.slice(5) as SimplePartKey);
  } else {
    history = [...placed.map((k): SimpleStep => `part:${k}`), ...(connected as SimpleCableKey[]).map((k): SimpleStep => `cable:${k}`)];
  }
  const cables = data.version === 3 ? history.filter((step) => step.startsWith("cable:")).map((step) => step.slice(6) as SimpleCableKey) : ([...connected] as SimpleCableKey[]);
  const migrated: SimpleSnapshot = { version: 3, placed, connected: cables, history, powered: data.powered };
  try {
    const state = simpleBuildFromSnapshot(migrated);
    if (migrated.powered && pc.evaluateStartup(state, pcCatalog).outcome !== "operational") return null;
    // Every prefix of the history must have been a valid build, so undoing never meets an impossible state.
    let replay = emptySimpleSnapshot();
    for (const step of history) {
      const [kind, key] = step.split(":") as ["part" | "cable", string];
      replay = kind === "part" ? withPart(replay, key as SimplePartKey) : withCable(replay, key as SimpleCableKey);
      simpleBuildFromSnapshot(replay);
    }
    return migrated;
  } catch { return null; }
}
