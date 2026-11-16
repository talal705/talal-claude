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

/**
 * Alternatives to two of the parts above, added after every earlier instance (and every saved build
 * that names one) so nothing older moves. Only one part of each slot can be in at a time: a CPU in
 * the socket, a cooler on it. The liquid cooler's block goes on the CPU like the air cooler; its
 * radiator goes in the case's front radiator position (Corsair lists 240, 280 and 360 mm there), so
 * it is fitted once the board is in the case. That position covers the front fan places, so the two
 * fans the case came with move to its top fan places, as exhaust, while the radiator is in; their
 * leads stay on CHA_FAN1 and CHA_FAN2.
 */
export const SIMPLE_ALTERNATIVES = [
  { key: "cpu2", id: "cpu-12", catalogId: "intel-core-i9-14900k", host: "motherboard-2", mount: "cpu-socket", screws: 1, slot: "cpu" },
  { key: "aio", id: "cooling-13", catalogId: "arctic-liquid-freezer-iii-280", host: "motherboard-2", mount: "cooler-mount", screws: 4, slot: "cooler", radiator: { host: "case-1", mount: "rad-front", screws: 8, moveFans: [["fan-9", "fan-top-1"], ["fan-10", "fan-top-2"]] } },
] as const;

type BasePartKey = (typeof SIMPLE_PARTS)[number]["key"];
export type SimpleAltKey = (typeof SIMPLE_ALTERNATIVES)[number]["key"];
export type SimplePartKey = BasePartKey | SimpleAltKey;
/** A place in the build that one part fills: the base part's key (`cpu` is filled by either CPU). */
export type SimpleSlot = BasePartKey;
interface PartSpec {
  key: SimplePartKey; id: string; catalogId: string; host: string; mount: string; screws: number; slot?: SimpleSlot;
  /** A liquid cooler's radiator: where it goes, and the case fans that make room for it (instance → new fan place). */
  radiator?: { host: string; mount: string; screws: number; moveFans: readonly (readonly [string, string])[] };
}
/** Screws of a case fan place on the 4000D. */
const FAN_SCREWS = 4;
/** Every part on the bench: the base build, then the alternatives. */
export const ALL_SIMPLE_PARTS: readonly PartSpec[] = [...SIMPLE_PARTS, ...SIMPLE_ALTERNATIVES];
/** The order the parts are listed in: each alternative beside the part it replaces. */
export const SIMPLE_PART_LIST: readonly SimplePartKey[] = ["cpu", "cpu2", "ram", "ram2", "cooler", "aio", "storage", "motherboard", "gpu", "psu"];
export const slotOf = (key: SimplePartKey): SimpleSlot => (ALL_SIMPLE_PARTS.find((p) => p.key === key)?.slot ?? key) as SimpleSlot;
/** The other parts that fill the same slot. */
export const rivalsOf = (key: SimplePartKey): SimplePartKey[] => ALL_SIMPLE_PARTS.filter((p) => p.key !== key && slotOf(p.key) === slotOf(key)).map((p) => p.key);
/** Parts that have an alternative: either one may be swapped for the other. */
export const SWAPPABLE: readonly SimplePartKey[] = ["cpu", "cpu2", "cooler", "aio"];
/** Parts a learner may also just take out: the coolers (a CPU is only ever swapped, so the board never stands without one). */
export const REMOVABLE: readonly SimplePartKey[] = ["cooler", "aio"];
const RAM_KEYS: readonly SimplePartKey[] = ["ram", "ram2"];
export const isRamKey = (key: SimplePartKey) => RAM_KEYS.includes(key);
/**
 * Parts fitted to the motherboard while it is still on the workbench. The air cooler may go on here
 * too (the helper suggests it); the liquid cooler waits for the board to be in the case.
 */
export const BOARD_PREP: readonly SimplePartKey[] = ["cpu", "ram", "ram2", "storage"];

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

/** The liquid cooler's two leads, in place of the air cooler's fan lead when it is the cooler fitted. */
export const SIMPLE_AIO_CABLES = [
  { key: "aioPump", id: "cooling-13.pump", endId: "plug", instanceId: "motherboard-2", portId: "aio-pump", requires: ["aio", "motherboard"], essential: true },
  { key: "aioFan", id: "cooling-13.fan", endId: "plug", instanceId: "motherboard-2", portId: "cpu-fan", requires: ["aio", "motherboard"], essential: true },
] as const satisfies readonly { key: string; id: string; endId: string; instanceId: string; portId: string; requires: readonly SimplePartKey[]; essential: boolean }[];

interface CableSpec { key: SimpleCableKey; id: string; endId: string; instanceId: string; portId: string; requires: readonly SimplePartKey[]; essential: boolean }
export type SimpleCableKey = (typeof SIMPLE_CABLES)[number]["key"] | (typeof SIMPLE_AIO_CABLES)[number]["key"];
export const ALL_SIMPLE_CABLES: readonly CableSpec[] = [...SIMPLE_CABLES, ...SIMPLE_AIO_CABLES];
/** One learner step, in the order it was taken: `part:cpu`, `cable:atx`. */
export type SimpleStep = `part:${SimplePartKey}` | `cable:${SimpleCableKey}`;
/**
 * Saved progress. `placed` and `connected` say what is fitted; `history` is the same steps in the
 * order they were taken, so the latest one can be undone without breaking what depends on it.
 */
export type SimpleSnapshot = { version: 3; placed: SimplePartKey[]; connected: SimpleCableKey[]; history: SimpleStep[]; powered: boolean };
export type SimpleBlock = "cpuFirst" | "boardFirst" | "prepareBoard" | "cannotFit" | "socketTaken" | "coolerTaken";
export type SimpleCableBlock = "fitCableParts" | "turnOffFirst" | "cannotConnect";
export type SimpleRemoveBlock = "turnOffFirst" | "removeCoolerFirst" | "unplugCoolerFirst" | "notSwappable" | "boardFirst";
/**
 * The lab's own startup rule, on top of the engine: in this simulation the Core i9-14900K is set to
 * need the 280 mm liquid cooler. An educational rule for this one CPU, not a claim about all CPUs.
 */
export type SimpleRule = "needsLiquidCooler";
// Keep the original storage key so an existing learner's progress can migrate in place.
export const SIMPLE_SAVE_KEY = "ytl_simple_pc_v1";
export const emptySimpleSnapshot = (): SimpleSnapshot => ({ version: 3, placed: [], connected: [], history: [], powered: false });

const partSpec = (key: SimplePartKey): PartSpec => ALL_SIMPLE_PARTS.find((p) => p.key === key)!;
const cableSpec = (key: SimpleCableKey): CableSpec => ALL_SIMPLE_CABLES.find((c) => c.key === key)!;

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
    // The alternatives: cpu-12 and cooling-13.
    ...SIMPLE_ALTERNATIVES.map((p): PCAction => ({ type: "add_part", catalogId: p.catalogId })),
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
  const part = state.parts.find((p) => p.instanceId === spec.id);
  if (!part) return false;
  const fitted = (host: string, ids: readonly string[], screws: number) =>
    part.attachments.some((a) => a.target.hostInstanceId === host && ids.includes(a.target.mountPointId) && a.seating === "seated" && a.fastenersSecured >= screws);
  return fitted(spec.host, mounts, spec.screws) && (!spec.radiator || fitted(spec.radiator.host, [spec.radiator.mount], spec.radiator.screws));
}

/** The part filling a slot, or null: `cpu` → the i5 or the i9, `cooler` → the air or the liquid cooler. */
export function simpleSlotPart(state: PCBuildState, slot: SimpleSlot): SimplePartKey | null {
  return ALL_SIMPLE_PARTS.find((p) => slotOf(p.key) === slot && simplePartInstalled(state, p.key))?.key ?? null;
}
export const simpleSlotFilled = (state: PCBuildState, slot: SimpleSlot) => simpleSlotPart(state, slot) !== null;
/** Every slot filled: one CPU, both RAM sticks, storage, one cooler, the board, the card and the PSU. */
export const simpleAllPartsIn = (state: PCBuildState) => SIMPLE_PARTS.every((p) => simpleSlotFilled(state, p.key));
/** How many of the eight slots are filled. */
export const simplePartsProgress = (state: PCBuildState) => SIMPLE_PARTS.filter((p) => simpleSlotFilled(state, p.key)).length;
/** A part a lead or another part needs: `cpu` is met by either CPU; any other key by that part. */
const requirementMet = (state: PCBuildState, key: SimplePartKey) => (key === "cpu" ? simpleSlotFilled(state, "cpu") : simplePartInstalled(state, key));

/** Parts that must be in before this one, in the order a learner would fit them. */
export function simplePrerequisites(key: SimplePartKey): SimplePartKey[] {
  if (key === "cooler") return ["cpu"];
  if (key === "aio") return ["cpu", "motherboard"];
  if (key === "motherboard") return [...BOARD_PREP];
  if (key === "gpu" || key === "psu") return ["motherboard"];
  return [];
}

export function simpleBlock(state: PCBuildState, key: SimplePartKey): SimpleBlock | null {
  if (!simplePartInstalled(state, key)) {
    if (slotOf(key) === "cpu" && rivalsOf(key).some((k) => simplePartInstalled(state, k))) return "socketTaken";
    if (slotOf(key) === "cooler" && rivalsOf(key).some((k) => simplePartInstalled(state, k))) return "coolerTaken";
  }
  if ((key === "cooler" || key === "aio") && !simpleSlotFilled(state, "cpu")) return "cpuFirst";
  if (key === "motherboard" && !BOARD_PREP.every((k) => requirementMet(state, k))) return "prepareBoard";
  if ((key === "gpu" || key === "psu" || key === "aio") && !simplePartInstalled(state, "motherboard")) return "boardFirst";
  return null;
}

export function installSimplePart(state: PCBuildState, key: SimplePartKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  if (simplePartInstalled(state, key)) return { ok: true, state };
  const blocked = simpleBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  const spec = partSpec(key);
  // A liquid cooler has two bodies: the pump block on the CPU, then the radiator in the case.
  const role = (name: string) => (spec.radiator ? { role: name } : {});
  try {
    return { ok: true, state: run(state, [
      { type: "mount_part", instanceId: spec.id, target: simpleTarget(state, key), ...role("block") },
      { type: "set_seating", instanceId: spec.id, seating: "seated", ...role("block") },
      ...(spec.screws ? [{ type: "set_fasteners", instanceId: spec.id, secured: spec.screws, ...role("block") } as PCAction] : []),
      ...(spec.radiator ? [
        ...spec.radiator.moveFans.flatMap(([fan, place]): PCAction[] => [
          { type: "unmount_part", instanceId: fan },
          { type: "mount_part", instanceId: fan, target: { hostInstanceId: spec.radiator!.host, mountPointId: place } },
          { type: "set_seating", instanceId: fan, seating: "seated" },
          { type: "set_fasteners", instanceId: fan, secured: FAN_SCREWS },
        ]),
        { type: "mount_part", instanceId: spec.id, role: "radiator", target: { hostInstanceId: spec.radiator.host, mountPointId: spec.radiator.mount } } as PCAction,
        { type: "set_seating", instanceId: spec.id, role: "radiator", seating: "seated" } as PCAction,
        { type: "set_fasteners", instanceId: spec.id, role: "radiator", secured: spec.radiator.screws } as PCAction,
      ] : []),
    ]) };
  } catch { return { ok: false, reason: "cannotFit" }; }
}

/** Where the radiator of a liquid cooler goes, for the 3D view; null for every other part. */
export function simpleRadiatorTarget(key: SimplePartKey): { hostInstanceId: string; mountPointId: string } | null {
  const radiator = partSpec(key).radiator;
  return radiator ? { hostInstanceId: radiator.host, mountPointId: radiator.mount } : null;
}

/** The leads of the build as it stands: the liquid cooler's two in place of the air cooler's one when it is fitted. */
export function simpleCablesFor(state: PCBuildState): CableSpec[] {
  const liquid = simplePartInstalled(state, "aio");
  return [...SIMPLE_CABLES.filter((c) => !(liquid && c.key === "cpuFan")), ...(liquid ? SIMPLE_AIO_CABLES : [])];
}

/** Why a fitted part cannot come out (a cooler, or a CPU as part of a swap), or null when it can. */
export function simpleRemoveBlock(state: PCBuildState, key: SimplePartKey): SimpleRemoveBlock | null {
  if (!SWAPPABLE.includes(key)) return "notSwappable";
  if (state.power.pressed) return "turnOffFirst";
  if (slotOf(key) === "cpu" && simpleSlotFilled(state, "cooler")) return "removeCoolerFirst";
  if (key === "cooler" && simpleCableConnected(state, "cpuFan")) return "unplugCoolerFirst";
  if (key === "aio" && (simpleCableConnected(state, "aioPump") || simpleCableConnected(state, "aioFan"))) return "unplugCoolerFirst";
  return null;
}

/**
 * Why `key` cannot replace the part of its slot that is fitted now, or null when it can. Null too
 * when nothing is to be replaced (then it is an ordinary install).
 */
export function simpleSwapBlock(state: PCBuildState, key: SimplePartKey): SimpleRemoveBlock | null {
  const rival = simpleSlotPart(state, slotOf(key));
  if (!rival || rival === key) return null;
  const out = simpleRemoveBlock(state, rival);
  if (out) return out;
  if (key === "aio" && !simplePartInstalled(state, "motherboard")) return "boardFirst";
  return null;
}

/** The lab rule that stops this build from starting, if any (see `SimpleRule`). */
export function simpleRuleBlock(state: PCBuildState): SimpleRule | null {
  return simplePartInstalled(state, "cpu2") && !simplePartInstalled(state, "aio") ? "needsLiquidCooler" : null;
}

export function simpleCableConnected(state: PCBuildState, key: SimpleCableKey): boolean {
  const spec = cableSpec(key);
  const end = state.cables.find((c) => c.id === spec.id)?.ends[spec.endId];
  return end?.kind === "part" && end.instanceId === spec.instanceId && end.portId === spec.portId;
}

export function simpleCableBlock(state: PCBuildState, key: SimpleCableKey): SimpleCableBlock | null {
  if (state.power.pressed) return "turnOffFirst";
  const spec = cableSpec(key);
  return spec.requires.every((part) => requirementMet(state, part)) ? null : "fitCableParts";
}

/** The parts a lead still waits for (either CPU meets `cpu`). */
export const simpleCableMissingParts = (state: PCBuildState, key: SimpleCableKey): SimplePartKey[] => cableSpec(key).requires.filter((part) => !requirementMet(state, part));

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
export function startSimplePC(state: PCBuildState): { ok: boolean; state: PCBuildState; startup: StartupResult; rule: SimpleRule | null } {
  if (!simpleAllPartsIn(state)) return { ok: false, state, startup: pc.evaluateStartup(state, pcCatalog), rule: null };
  if (!state.power.pressed) {
    state = run(state, [
      { type: "set_side_panel", open: false },
      { type: "set_wall_power", connected: true },
      { type: "set_psu_switch", on: true },
      { type: "press_power" },
    ]);
  }
  const startup = pc.evaluateStartup(state, pcCatalog);
  const rule = simpleRuleBlock(state);
  const ok = startup.outcome === "operational" && !rule;
  // A failed try leaves wiring editable. Preserve its diagnostics for the caller's feedback.
  if (!ok && state.power.pressed) state = run(state, [{ type: "power_off" }]);
  return { ok, state, startup, rule };
}

/** Every part fitted and every lead connected, case fans included: the whole build, not only what boots. */
export function simpleAssemblyComplete(state: PCBuildState): boolean {
  return simpleAllPartsIn(state) && simpleCablesFor(state).every((c) => simpleCableConnected(state, c.key));
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

/** Takes a cooler back out (`simpleRemoveBlock` must allow it): its step leaves the history. */
export const withoutPart = (snapshot: SimpleSnapshot, key: SimplePartKey): SimpleSnapshot =>
  ({ ...snapshot, placed: snapshot.placed.filter((k) => k !== key), history: snapshot.history.filter((step) => step !== `part:${key}`) });

/**
 * Puts `to` in place of `from`, the part of the same slot (`simpleSwapBlock` must allow it). A CPU
 * takes the other CPU's step where it was, so the board still had a CPU before it went into the
 * case; a cooler leaves its step and the new one is fitted now.
 */
export function withSwap(snapshot: SimpleSnapshot, from: SimplePartKey, to: SimplePartKey): SimpleSnapshot {
  if (slotOf(from) !== "cpu") return withPart(withoutPart(snapshot, from), to);
  const swap = <T extends string>(item: T) => (item === `part:${from}` ? `part:${to}` : item === from ? to : item) as T;
  return { ...snapshot, placed: snapshot.placed.map(swap), history: snapshot.history.map(swap) };
}

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

const isPartKey = (k: unknown): k is SimplePartKey => ALL_SIMPLE_PARTS.some((p) => p.key === k);
const isCableKey = (k: unknown): k is SimpleCableKey => ALL_SIMPLE_CABLES.some((c) => c.key === k);

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
    if (migrated.powered && (pc.evaluateStartup(state, pcCatalog).outcome !== "operational" || simpleRuleBlock(state))) return null;
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
