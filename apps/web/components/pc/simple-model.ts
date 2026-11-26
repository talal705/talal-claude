// One beginner PC. Learners place parts and connect their leads; seating and fasteners stay automatic.
//
// The page runs one *model* at a time: the original fixed build (with its CPU and cooler alternatives,
// kept so every saved build replays) or a build the learner planned (`plan-model.ts`). The exported
// lists below are live bindings that `activateSimpleModel` replaces, so every reader sees the build
// that is on the page.
import { slotCoverIds, slotCoverOpen, type PCAction, type PCBuildState, type PortSpec, type PrepKind, type StartupResult } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { pcCatalog, SUPPLIED_PARTS, suppliedPartActions } from "./catalog";
import { installCoolerWhole, migrateCoolerSteps } from "./cooler-assembly";

const RAM_ID = "corsair-vengeance-rgb-ddr5-6000-32gb-kit";
const BOARD_ID = "asus-tuf-gaming-z790-plus-wifi";

/**
 * Memory slots for two modules on the ASUS TUF GAMING Z790-PLUS WIFI, from its manual's
 * recommended population (`spec.memory.recommendedPopulation`): the first module goes in A2,
 * the second in B2. Either stick may be fitted first; the order of fitting picks the slot.
 */
const LEGACY_RAM_SLOTS = (() => {
  const board = pcCatalog.entries.find((entry) => entry.id === BOARD_ID) as { spec?: { memory?: { recommendedPopulation?: { modules: number; slotIds: string[] }[] } } } | undefined;
  const two = board?.spec?.memory?.recommendedPopulation?.find((row) => row.modules === 2)?.slotIds;
  return (two && two.length === 2 ? two : ["dimm-a2", "dimm-b2"]) as unknown as readonly [string, string];
})();

const LEGACY_PARTS = [
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
 * it is fitted once the board is in the case. That position covers the front fan places, so the
 * case's own front fan moves to a top fan place, as exhaust, while the radiator is in (its rear fan stays);
 * their leads stay on CHA_FAN1 and CHA_FAN2.
 */
const LEGACY_ALTERNATIVES = [
  { key: "cpu2", id: "cpu-12", catalogId: "intel-core-i9-14900k", host: "motherboard-2", mount: "cpu-socket", screws: 1, slot: "cpu" },
  { key: "aio", id: "cooling-13", catalogId: "arctic-liquid-freezer-iii-280", host: "motherboard-2", mount: "cooler-mount", screws: 4, slot: "cooler", radiator: { host: "case-1", mount: "rad-front", screws: 8, moveFans: [["fan-9", "fan-top-1"]] } },
] as const;

/** A learner-installed part, by key. `cpu`, `ram2`, `storage2`, `fan1`, `aio` … */
export type SimplePartKey = string;
export type SimpleAltKey = string;
/** A place in the build that one part fills: the base part's key (`cpu` is filled by either CPU). */
export type SimpleSlot = string;
/** What a part is, for its label and explanation: the key without its number. */
export type SimpleRole = "cpu" | "ram" | "storage" | "cooler" | "aio" | "motherboard" | "gpu" | "psu" | "fan";
export interface PartSpec {
  key: SimplePartKey; id: string; catalogId: string; host: string; mount: string; screws: number; slot?: SimpleSlot;
  /** A liquid cooler's radiator: where it goes, and the case fans that make room for it (instance → new fan place). */
  radiator?: { host: string; mount: string; screws: number; moveFans: readonly (readonly [string, string])[] };
  /** One of the case's own fans: fitted from the start, optional, and worked on like any other case fan. */
  supplied?: true;
}
/** Screws of a case fan place. */
const FAN_SCREWS = 4;

/**
 * The case's own fans as parts the learner can select (`sfan1`, `sfan2`, in the order the case lists them): they keep
 * their instance IDs and start fitted, and are not required, so taking one out never stops the PC. They are listed
 * beside the other parts and take the same steps as a fan the learner chose.
 */
export function suppliedFanSpecs(caseCatalogId: string, instanceIds: readonly string[]): PartSpec[] {
  const caseEntry = pcCatalog.entries.find((e) => e.id === caseCatalogId);
  return instanceIds.flatMap((id, i): PartSpec[] => {
    const item = SUPPLIED_PARTS[caseCatalogId]?.[i];
    if (!item || pcCatalog.entries.find((e) => e.id === item.catalogId)?.category !== "fan") return [];
    const screws = caseEntry?.mountPoints.find((m) => m.id === item.mountPointId)?.fastener?.count ?? FAN_SCREWS;
    return [{ key: `sfan${i + 1}`, id, catalogId: item.catalogId, host: "case-1", mount: item.mountPointId, screws, supplied: true }];
  });
}

/** The supplied PSU has captive leads. Each step connects its free device end. */
const LEGACY_CABLES = [
  { key: "atx", id: "psu-8.atx24", endId: "device", instanceId: "motherboard-2", portId: "atx-24", requires: ["psu", "motherboard"], essential: true },
  { key: "cpuPower", id: "psu-8.eps", endId: "device", instanceId: "motherboard-2", portId: "eps-1", requires: ["psu", "motherboard"], essential: true },
  { key: "gpuPower", id: "psu-8.pcie", endId: "device-1", instanceId: "gpu-7", portId: "power-8pin", requires: ["psu", "gpu"], essential: true },
  { key: "cpuFan", id: "cooling-6.fan", endId: "plug", instanceId: "motherboard-2", portId: "cpu-fan", requires: ["cpu", "cooler"], essential: true },
  { key: "powerSwitch", id: "case-1.power-switch", endId: "plug", instanceId: "motherboard-2", portId: "panel-pwrsw", requires: ["motherboard"], essential: true },
  { key: "caseFan1", id: "fan-9.fan", endId: "plug", instanceId: "motherboard-2", portId: "cha-fan-1", requires: ["motherboard", "sfan1"], essential: false },
  { key: "caseFan2", id: "fan-10.fan", endId: "plug", instanceId: "motherboard-2", portId: "cha-fan-2", requires: ["motherboard", "sfan2"], essential: false },
] as const;

/** The liquid cooler's two leads, in place of the air cooler's fan lead when it is the cooler fitted. */
const LEGACY_AIO_CABLES = [
  { key: "aioPump", id: "cooling-13.pump", endId: "plug", instanceId: "motherboard-2", portId: "aio-pump", requires: ["aio", "motherboard"], essential: true },
  { key: "aioFan", id: "cooling-13.fan", endId: "plug", instanceId: "motherboard-2", portId: "cpu-fan", requires: ["aio", "motherboard"], essential: true },
] as const;

/** One more cable end connected in the same learner step: the PSU side of a modular cable, the board side of a SATA data cable. */
export interface CableExtraEnd { cableId: string; endId: string; instanceId: string; portId: string }
export interface CableSpec {
  key: SimpleCableKey; id: string; endId: string; instanceId: string; portId: string; requires: readonly SimplePartKey[]; essential: boolean;
  extra?: readonly CableExtraEnd[];
}
export type SimpleCableKey = string;

/** Everything the page needs to know about the build it runs. */
export interface SimpleModel {
  kind: "legacy" | "plan";
  /** Learner parts that fill the build, one per slot. */
  parts: readonly PartSpec[];
  /** Other parts on the bench that are not required: the other choice for a slot (legacy only) and the case's own fans. */
  alternatives: readonly PartSpec[];
  partList: readonly SimplePartKey[];
  swappable: readonly SimplePartKey[];
  removable: readonly SimplePartKey[];
  /** Parts that go on the board before it moves into the case. */
  boardPrep: readonly SimplePartKey[];
  ramSlots: readonly string[];
  cables: readonly CableSpec[];
  /** Leads shown only while that part is fitted, in place of `replaces` (legacy liquid cooler). */
  swapCables: readonly CableSpec[];
  swapCablesWith: SimplePartKey | null;
  swapCablesReplace: readonly SimpleCableKey[];
  /** The order a builder would follow (another valid order is always allowed). */
  partOrder: (state: PCBuildState) => SimplePartKey[];
  cableOrder: readonly SimpleCableKey[];
  /** The lab's exercise rule: these CPU keys start only with one of these cooler keys. */
  rule: { cpuKeys: readonly SimplePartKey[]; coolerKeys: readonly SimplePartKey[] } | null;
  /** The engine actions of the empty starting build. */
  createActions: () => PCAction[];
  /** The planned build this model was made from (plan models only). */
  plan?: unknown;
}

const legacyPartOrder = (state: PCBuildState): SimplePartKey[] => {
  const cpu = simpleSlotPart(state, "cpu") ?? "cpu";
  const cooler = simpleSlotPart(state, "cooler") ?? (cpu === "cpu2" ? "aio" : "cooler");
  return [cpu, "ram", "ram2", "storage", ...(cooler === "aio" ? ["motherboard", "aio"] : ["cooler", "motherboard"]), "gpu", "psu"];
};

const LEGACY_SUPPLIED_FANS = suppliedFanSpecs("corsair-4000d-airflow-black", ["fan-9", "fan-10"]);

export const LEGACY_MODEL: SimpleModel = {
  kind: "legacy",
  parts: LEGACY_PARTS,
  alternatives: [...LEGACY_ALTERNATIVES, ...LEGACY_SUPPLIED_FANS],
  partList: ["cpu", "cpu2", "ram", "ram2", "cooler", "aio", "storage", "motherboard", "gpu", "psu", ...LEGACY_SUPPLIED_FANS.map((f) => f.key)],
  swappable: ["cpu", "cpu2", "cooler", "aio"],
  removable: ["cooler", "aio"],
  boardPrep: ["cpu", "ram", "ram2", "storage"],
  ramSlots: LEGACY_RAM_SLOTS,
  cables: LEGACY_CABLES,
  swapCables: LEGACY_AIO_CABLES,
  swapCablesWith: "aio",
  swapCablesReplace: ["cpuFan"],
  partOrder: legacyPartOrder,
  cableOrder: ["atx", "cpuPower", "gpuPower", "cpuFan", "aioPump", "aioFan", "powerSwitch", "caseFan1", "caseFan2"],
  rule: { cpuKeys: ["cpu2"], coolerKeys: ["aio"] },
  createActions: () => {
    const firstParts = LEGACY_PARTS.filter((p) => p.key !== "ram2");
    const order = ["corsair-4000d-airflow-black", ...[...firstParts].sort((a, b) => Number(a.id.split("-").at(-1)) - Number(b.id.split("-").at(-1))).map((p) => p.catalogId)];
    return [
      { type: "set_rgb_preference", preference: "without_rgb" },
      ...order.map((catalogId): PCAction => ({ type: "add_part", catalogId })),
      ...suppliedPartActions(order[0]!, "case-1", 9).actions,
      { type: "add_part", catalogId: RAM_ID },
      // The alternatives: cpu-12 and cooling-13.
      ...LEGACY_ALTERNATIVES.map((p): PCAction => ({ type: "add_part", catalogId: p.catalogId })),
      { type: "update_bios", instanceId: "motherboard-2", version: "1840" },
    ];
  },
};

// ---------- The active model (live bindings) ----------

let active: SimpleModel = LEGACY_MODEL;
/** Memory slots in the order modules fill them (the board manual's recommended population). */
export let RAM_SLOTS: readonly string[] = LEGACY_MODEL.ramSlots;
export let SIMPLE_PARTS: readonly PartSpec[] = LEGACY_MODEL.parts;
export let SIMPLE_ALTERNATIVES: readonly PartSpec[] = LEGACY_MODEL.alternatives;
/** Every part on the bench: the base build, then the alternatives. */
export let ALL_SIMPLE_PARTS: readonly PartSpec[] = [...LEGACY_MODEL.parts, ...LEGACY_MODEL.alternatives];
/** The order the parts are listed in: each alternative beside the part it replaces. */
export let SIMPLE_PART_LIST: readonly SimplePartKey[] = LEGACY_MODEL.partList;
/** Parts that have an alternative: either one may be swapped for the other. */
export let SWAPPABLE: readonly SimplePartKey[] = LEGACY_MODEL.swappable;
/** Parts a learner may also just take out. */
export let REMOVABLE: readonly SimplePartKey[] = LEGACY_MODEL.removable;
/** Parts fitted to the motherboard while it is still on the workbench. */
export let BOARD_PREP: readonly SimplePartKey[] = LEGACY_MODEL.boardPrep;
export let SIMPLE_CABLES: readonly CableSpec[] = LEGACY_MODEL.cables;
export let SIMPLE_AIO_CABLES: readonly CableSpec[] = LEGACY_MODEL.swapCables;
export let ALL_SIMPLE_CABLES: readonly CableSpec[] = [...LEGACY_MODEL.cables, ...LEGACY_MODEL.swapCables];

/** Puts `model` on the page. Every list above and every function below follow it. */
export function activateSimpleModel(model: SimpleModel): void {
  active = model;
  RAM_SLOTS = model.ramSlots;
  SIMPLE_PARTS = model.parts;
  SIMPLE_ALTERNATIVES = model.alternatives;
  ALL_SIMPLE_PARTS = [...model.parts, ...model.alternatives];
  SIMPLE_PART_LIST = model.partList;
  SWAPPABLE = model.swappable;
  REMOVABLE = model.removable;
  BOARD_PREP = model.boardPrep;
  SIMPLE_CABLES = model.cables;
  SIMPLE_AIO_CABLES = model.swapCables;
  ALL_SIMPLE_CABLES = [...model.cables, ...model.swapCables];
}
export const activeSimpleModel = (): SimpleModel => active;
/** The order a builder would follow for the build on the page. */
export const simplePartOrder = (state: PCBuildState): SimplePartKey[] => active.partOrder(state);
export const simpleCableOrder = (): readonly SimpleCableKey[] => active.cableOrder;

export const slotOf = (key: SimplePartKey): SimpleSlot => ALL_SIMPLE_PARTS.find((p) => p.key === key)?.slot ?? key;
/** The other parts that fill the same slot. */
export const rivalsOf = (key: SimplePartKey): SimplePartKey[] => ALL_SIMPLE_PARTS.filter((p) => p.key !== key && slotOf(p.key) === slotOf(key)).map((p) => p.key);
export const isRamKey = (key: SimplePartKey) => /^ram\d*$/.test(key);
/** An M.2 drive: planned into one of the board's M.2 slots (the learner may choose another). */
export const isM2Key = (key: SimplePartKey) => /^m2-\d+$/.test(ALL_SIMPLE_PARTS.find((p) => p.key === key)?.mount ?? "");
/** A part the learner puts into one of several equal places of the case: a SATA drive in a drive bay, a case fan at a fan place. */
export const isPositionKey = (key: SimplePartKey) => roleOf(key) === "fan" || (roleOf(key) === "storage" && !isM2Key(key));
/** What a key is: `ram2` → ram, `storage3` → storage, `fan1` → fan, `cpu2` → cpu. */
export const roleOf = (key: SimplePartKey): SimpleRole => {
  const base = key.replace(/\d+$/, "");
  return (base === "" ? "cpu" : base === "sfan" ? "fan" : base) as SimpleRole;
};
const isCoolerKey = (key: SimplePartKey) => slotOf(key) === "cooler";

/**
 * One learner step, in the order it was taken.
 * - `mech:<retentionId>:open|closed`: the learner moved a lever, plate or latch.
 * - `lower:<key>[:<turn>:<x>:<z>]`: the part, aligned by the learner, was lowered into its open place (a
 *   module pressed home). The pose it was held in just before (turn in degrees, offset in mm) is kept, so
 *   undoing puts it back in hand exactly as it was.
 * - `seat:<key>` / `lift:<key>`: a released part pushed home again / taken out of its open place.
 * - `part:<key>`: the whole fitting as one step. Only saves from before the detailed mechanics use it for
 *   a CPU or a module; replaying it opens and closes their mechanisms (the explicit migration of those saves).
 * - `cable:<key>`: a lead connected.
 */
export type SimpleStep = `part:${string}` | `cable:${string}` | `mech:${string}` | `lower:${string}` | `seat:${string}` | `lift:${string}` | `fasten:${string}` | `unfasten:${string}` | `prep:${string}` | `place:${string}` | `unscrew:${string}` | `screw:${string}` | `plug:${string}` | `unplug:${string}` | `hw:${string}` | `rad:${string}` | `fans:${string}` | `radscrew:${string}`;
/**
 * Saved progress. `placed` and `connected` say what is fitted; `history` is the same steps in the
 * order they were taken, so the latest one can be undone without breaking what depends on it.
 * Version 4 also carries the planned build it belongs to.
 */
/** A part the learner is holding over its place: how it is turned and how far off centre (mm, along the place's own axes). */
export interface SimpleHeld {
  key: SimplePartKey; rotationDeg: number; offsetMm: [number, number];
  /** An M.2 drive: how far it is tilted up from flat (degrees), and the slot the learner chose. */
  tiltDeg?: number; slotId?: string;
}
export type SimpleSnapshot =
  | { version: 3; placed: SimplePartKey[]; connected: SimpleCableKey[]; history: SimpleStep[]; powered: boolean; held?: SimpleHeld | null }
  | { version: 4; plan: unknown; placed: SimplePartKey[]; connected: SimpleCableKey[]; history: SimpleStep[]; powered: boolean; held?: SimpleHeld | null };
/** A held pose read from a save: a known part, a right-angle turn, an offset within reach. */
export function parseHeld(value: unknown): SimpleHeld | null {
  if (!value || typeof value !== "object") return null;
  const h = value as Record<string, unknown>;
  const off = h.offsetMm;
  if (typeof h.key !== "string" || !ALL_SIMPLE_PARTS.some((p) => p.key === h.key)) return null;
  if (typeof h.rotationDeg !== "number" || ![0, 90, 180, 270].includes(h.rotationDeg)) return null;
  if (!Array.isArray(off) || off.length !== 2 || !off.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= HELD_REACH_MM)) return null;
  const tilt = typeof h.tiltDeg === "number" && Number.isFinite(h.tiltDeg) && h.tiltDeg >= 0 && h.tiltDeg <= 90 ? { tiltDeg: h.tiltDeg } : {};
  const slot = typeof h.slotId === "string" && /^m2-\d$/.test(h.slotId) ? { slotId: h.slotId } : {};
  return { key: h.key, rotationDeg: h.rotationDeg, offsetMm: [off[0] as number, off[1] as number], ...tilt, ...slot };
}
/** How far from its place a held part can be moved (it stays over the board, above the socket area). */
export const HELD_REACH_MM = 40;
export type SimpleBlock = "cpuFirst" | "boardFirst" | "prepareBoard" | "cannotFit" | "socketTaken" | "coolerTaken" | "openFirst" | "turnPart" | "centrePart" | "closeBlocked" | "alreadyIn" | "unplugFirst" | "unscrewFirst" | "prepMissing" | "prepWrong" | "tiltPart" | "mountingMissing" | "orderWrong" | "positionTaken" | "positionWrong" | "fanInTheWay";
export type SimpleCableBlock = "fitCableParts" | "turnOffFirst" | "cannotConnect";
export type SimpleRemoveBlock = "turnOffFirst" | "removeCoolerFirst" | "unplugCoolerFirst" | "notSwappable" | "boardFirst";
/**
 * The lab's own startup rule, on top of the engine: in this simulation the Core i9-14900K is set to
 * need a liquid cooler. An exercise rule of this lab for this one CPU, not a manufacturer requirement.
 */
export type SimpleRule = "needsLiquidCooler";
// Keep the original storage key so an existing learner's progress can migrate in place.
export const SIMPLE_SAVE_KEY = "ytl_simple_pc_v1";
export const emptySimpleSnapshot = (): SimpleSnapshot =>
  active.kind === "plan" ? { version: 4, plan: active.plan, placed: [], connected: [], history: [], powered: false } : { version: 3, placed: [], connected: [], history: [], powered: false };

/** The spec of a part or lead by key. An unknown key is a programming error (undefined, not a fallback). */
export const partSpec = (key: SimplePartKey): PartSpec => ALL_SIMPLE_PARTS.find((p) => p.key === key)!;
export const cableSpec = (key: SimpleCableKey): CableSpec => ALL_SIMPLE_CABLES.find((c) => c.key === key)!;
/** Where a part is fitted: its first attachment, undefined while it is loose. */
export const firstAttachment = (state: PCBuildState, key: SimplePartKey) =>
  state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];

function run(state: PCBuildState, actions: readonly PCAction[]): PCBuildState {
  for (const action of actions) {
    const step = pc.applyAction(state, action, pcCatalog);
    if (!step.ok) throw new Error(`Simple PC: ${step.rejection.code}`);
    state = step.state;
  }
  return state;
}

export function createSimpleBuild(): PCBuildState {
  return run(pc.createBuild(pcCatalog), [{ type: "set_mechanics", mode: "detailed" }, ...active.createActions()]);
}

// ---------- Mechanisms (CPU load plate, memory latches) ----------

/** The retention of the place a part goes, with the host that carries it; null for parts held by screws only. */
export function simpleRetention(state: PCBuildState, key: SimplePartKey, slotId?: string): { hostInstanceId: string; id: string; kind: string; open: boolean; mountPointId: string; leverId: string | null; leverOpen: boolean; nearId: string | null; nearOpen: boolean; standId: string | null; standIn: boolean } | null {
  const target = simpleTarget(state, key, slotId);
  const host = state.parts.find((p) => p.instanceId === target.hostInstanceId);
  const mount = pcCatalog.entries.find((e) => e.id === host?.catalogId)?.mountPoints.find((m) => m.id === target.mountPointId);
  // The case's slot covers are not what holds the board: they matter for a card (see caseCoversClosed).
  if (!host || !mount?.retention || mount.retention.kind === "slot_covers") return null;
  // An Intel load plate has a separate lever (released and lifted before the plate opens).
  const leverId = mount.retention.kind === "lga_load_plate" ? `${mount.retention.id}:lever` : null;
  // A memory slot with a clip at each end: the near clip is its own mechanism.
  const nearId = mount.retention.kind === "dimm_latch" && mount.retention.latches === "both" ? `${mount.retention.id}:near` : null;
  // A screw-held M.2 slot: its stand at the length hole is a step of its own ("closed" = fitted).
  const standId = mount.retention.kind === "m2_screw" ? `${mount.retention.id}:stand` : null;
  return { hostInstanceId: host.instanceId, id: mount.retention.id, kind: mount.retention.kind, open: host.mechanisms?.[mount.retention.id] === "open", mountPointId: mount.id, leverId, leverOpen: leverId ? host.mechanisms?.[leverId] === "open" : false, nearId, nearOpen: nearId ? host.mechanisms?.[nearId] === "open" : true, standId, standIn: standId ? host.mechanisms?.[standId] === "closed" : true };
}
/** The keying the learner must match at a part's place (CPU triangle, DIMM notch), if any. */
export function simpleKeying(state: PCBuildState, key: SimplePartKey) {
  const target = simpleTarget(state, key);
  const host = state.parts.find((p) => p.instanceId === target.hostInstanceId);
  return pcCatalog.entries.find((e) => e.id === host?.catalogId)?.mountPoints.find((m) => m.id === target.mountPointId)?.keying ?? null;
}
/** The part a mechanism is on: a retention (`<id>`, `<id>:lever|near|stand`) or an M.2 heatsink (`<id>`, `<id>:screws|film`). */
const hostOfRetention = (state: PCBuildState, mechanismId: string) => {
  const base = mechanismId.replace(/:(lever|near|stand|screws|film|\d+)$/, "");
  return state.parts.find((p) => pcCatalog.entries.find((e) => e.id === p.catalogId)?.mountPoints.some((m) => m.retention?.id === base || (m.kind === "m2_slot" && m.heatsink?.id === base)));
};

/** Moves a lever, plate or latch. The engine refuses what cannot happen (a plate over a cooler, a latch over a half-in module). */
export function setSimpleMechanism(state: PCBuildState, retentionId: string, desired: "open" | "closed"): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock; message?: { en: string; ar: string } } {
  if (state.power.pressed) return { ok: false, reason: "cannotFit" };
  const host = hostOfRetention(state, retentionId);
  if (!host) return { ok: false, reason: "cannotFit" };
  const r = pc.applyAction(state, { type: "set_mechanism", instanceId: host.instanceId, mechanismId: retentionId, state: desired }, pcCatalog);
  return r.ok ? { ok: true, state: r.state } : { ok: false, reason: "closeBlocked", message: r.rejection.message };
}

/** Closes a socket over a seated CPU: the plate, then (Intel) the lever under its tab. */
function closeRetention(state: PCBuildState, ret: { id: string; leverId: string | null }): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  const c = setSimpleMechanism(state, ret.id, "closed");
  if (!c.ok) return { ok: false, reason: "cannotFit" };
  if (!ret.leverId) return c;
  const l = setSimpleMechanism(c.state, ret.leverId, "closed");
  return l.ok ? l : { ok: false, reason: "cannotFit" };
}

/** How the learner holds a part over its place. */
export interface SimpleAlignment { rotationDeg: number; offsetMm: [number, number]; tiltDeg?: number; slotId?: string }
export const ALIGNED: SimpleAlignment = { rotationDeg: 0, offsetMm: [0, 0] };

/**
 * Lowers a part the learner has aligned into its place (its mechanism must be open). A module is
 * pressed home, which closes its latch; a CPU rests seated until the learner closes the plate.
 */
export function lowerSimplePart(state: PCBuildState, key: SimplePartKey, alignment: SimpleAlignment): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock; message?: { en: string; ar: string } } {
  const blocked = simpleBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  const spec = partSpec(key);
  if (state.parts.find((p) => p.instanceId === spec.id)?.attachments.length) return { ok: false, reason: "alreadyIn" };
  const m2 = isM2Key(key);
  const { slotId, ...pose } = alignment;
  const r = pc.applyAction(state, { type: "mount_part", instanceId: spec.id, target: simpleTarget(state, key, m2 ? slotId : undefined), alignment: pose }, pcCatalog);
  if (!r.ok) {
    const code = r.rejection.code;
    const reason: SimpleBlock = code === "retention_closed" ? "openFirst" : code === "keying_wrong" ? "turnPart" : code === "alignment_off" ? "centrePart" : code === "insert_angle_wrong" ? "tiltPart" : "cannotFit";
    return { ok: false, reason, message: r.rejection.message };
  }
  // An M.2 drive goes in at an angle and rests there: pressing it flat is its own step.
  if (m2) return { ok: true, state: r.state };
  const seated = pc.applyAction(r.state, { type: "set_seating", instanceId: spec.id, seating: "seated" }, pcCatalog);
  return seated.ok ? { ok: true, state: seated.state } : { ok: false, reason: "cannotFit" };
}

// ---------- M.2: the learner chooses the slot; a board heatsink may cover it ----------

const boardOf = (state: PCBuildState, key: SimplePartKey) => {
  const host = state.parts.find((p) => p.instanceId === partSpec(key).host);
  return { host, entry: pcCatalog.entries.find((e) => e.id === host?.catalogId) };
};

/** The board's M.2 heatsink over a slot and its state; null for a bare slot. */
export function simpleM2Heatsink(state: PCBuildState, slotId: string): { id: string; screws: number; padFilm: boolean; fitted: boolean; screwsIn: boolean; filmOn: boolean } | null {
  const host = state.parts.find((p) => pcCatalog.entries.find((e) => e.id === p.catalogId)?.mountPoints.some((m) => m.id === slotId && m.kind === "m2_slot"));
  const slot = pcCatalog.entries.find((e) => e.id === host?.catalogId)?.mountPoints.find((m) => m.id === slotId);
  if (!host || slot?.kind !== "m2_slot" || !slot.heatsink) return null;
  const m = host.mechanisms ?? {};
  const { id, screws, padFilm } = slot.heatsink;
  return { id, screws, padFilm, fitted: (m[id] ?? "closed") !== "open", screwsIn: (m[`${id}:screws`] ?? "closed") !== "open", filmOn: padFilm && (m[`${id}:film`] ?? "closed") !== "open" };
}

/** The board's M.2 slots for this drive: whether it fits (length and interface), its heatsink, what is in it. */
export function simpleM2Slots(state: PCBuildState, key: SimplePartKey): { id: string; label: { en: string; ar: string }; heatsinkId: string | null; fits: boolean; occupant: SimplePartKey | null }[] {
  const { entry } = boardOf(state, key);
  const drive = pcCatalog.entries.find((e) => e.id === partSpec(key).catalogId);
  const spec = drive?.category === "storage" ? drive.spec : null;
  const occupantOf = (slotId: string) => ALL_SIMPLE_PARTS.find((p) => state.parts.find((x) => x.instanceId === p.id)?.attachments.some((a) => a.target.hostInstanceId === partSpec(key).host && a.target.mountPointId === slotId))?.key ?? null;
  return (entry?.mountPoints ?? []).flatMap((m) => (m.kind === "m2_slot" ? [{
    id: m.id, label: m.label, heatsinkId: m.heatsink?.id ?? null, occupant: occupantOf(m.id),
    fits: Boolean(spec && (m.lengths as string[]).includes(spec.formFactor) && (m.interfaces as string[]).includes(spec.interface)),
  }] : []));
}

// ---------- Memory: the slot is where the learner holds the module ----------

/** The board's memory slots, in catalog order (A1, A2, B1, B2), with their labels and clips. */
export function simpleRamSlots(state: PCBuildState): { id: string; label: { en: string; ar: string }; clipId: string; nearId: string | null; clipOpen: boolean; nearOpen: boolean; occupant: string | null }[] {
  const hostId = partSpec(ALL_SIMPLE_PARTS.find((p) => isRamKey(p.key))?.key ?? "ram").host;
  const host = state.parts.find((p) => p.instanceId === hostId);
  const entry = pcCatalog.entries.find((e) => e.id === host?.catalogId);
  return (entry?.mountPoints ?? []).filter((m) => m.kind === "dimm_slot" && m.retention).map((m) => {
    const nearId = m.retention!.latches === "both" ? `${m.retention!.id}:near` : null;
    const occupant = state.parts.find((p) => p.attachments.some((a) => a.target.hostInstanceId === hostId && a.target.mountPointId === m.id));
    return { id: m.id, label: m.label, clipId: m.retention!.id, nearId, clipOpen: host?.mechanisms?.[m.retention!.id] === "open", nearOpen: nearId ? host?.mechanisms?.[nearId] === "open" : true, occupant: occupant ? (ALL_SIMPLE_PARTS.find((p) => p.id === occupant.instanceId)?.key ?? occupant.instanceId) : null };
  });
}
/** The memory slots the board's manual recommends for `count` modules (empty when not recorded). */
export function simpleRamRecommended(state: PCBuildState, count: number): string[] {
  const hostId = partSpec(ALL_SIMPLE_PARTS.find((p) => isRamKey(p.key))?.key ?? "ram").host;
  const entry = pcCatalog.entries.find((e) => e.id === state.parts.find((p) => p.instanceId === hostId)?.catalogId);
  return entry?.category === "motherboard" ? [...(entry.spec.memory.recommendedPopulation.find((r) => r.modules === count)?.slotIds ?? [])] : [];
}
/** The slot a held module's pose is measured from: the one the manual recommends for a single module (else the first). */
export function simpleRamReference(state: PCBuildState): { hostInstanceId: string; mountPointId: string } {
  const spec = partSpec(ALL_SIMPLE_PARTS.find((p) => isRamKey(p.key))?.key ?? "ram");
  const slots = simpleRamSlots(state);
  const one = simpleRamRecommended(state, 1)[0];
  return { hostInstanceId: spec.host, mountPointId: slots.find((s) => s.id === one)?.id ?? slots[0]?.id ?? spec.mount };
}
const geometryCache = new Map<string, ReturnType<typeof pc.visual.partGeometry>>();
const inverseRotate = (q: readonly number[], v: readonly number[]): [number, number, number] => {
  // Rotate by the conjugate quaternion.
  const [x, y, z, w] = [-q[0]!, -q[1]!, -q[2]!, q[3]!];
  const [vx, vy, vz] = v as [number, number, number];
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
/**
 * Where each memory slot is, as an offset from the reference slot along the held module's own axes
 * (x along the module, z across the slots), from the same geometry the 3D view draws.
 */
export function simpleRamSlotOffsets(state: PCBuildState): Map<string, [number, number]> {
  const ref = simpleRamReference(state);
  const catalogId = state.parts.find((p) => p.instanceId === ref.hostInstanceId)?.catalogId ?? "";
  const entry = pcCatalog.entries.find((e) => e.id === catalogId);
  if (!entry) return new Map();
  let g = geometryCache.get(catalogId);
  if (!g) { g = pc.visual.partGeometry(entry, pcCatalog.version); geometryCache.set(catalogId, g); }
  const base = g.mounts[ref.mountPointId];
  const out = new Map<string, [number, number]>();
  if (!base) return out;
  for (const slot of simpleRamSlots(state)) {
    const m = g.mounts[slot.id];
    if (!m) continue;
    const local = inverseRotate(base.quat, [m.at[0] - base.at[0], m.at[1] - base.at[1], m.at[2] - base.at[2]]);
    out.set(slot.id, [Math.round(local[0] * 10) / 10, Math.round(local[2] * 10) / 10]);
  }
  return out;
}
/** The slot a held module is over (the nearest across the slots, if within half a slot's spacing) and how far off it is. */
export function simpleRamTargetFor(state: PCBuildState, offsetMm: readonly [number, number]): { slotId: string; residual: [number, number] } | null {
  let best: { slotId: string; residual: [number, number] } | null = null;
  for (const [slotId, [sx, sz]] of simpleRamSlotOffsets(state)) {
    const residual: [number, number] = [Math.round((offsetMm[0] - sx) * 10) / 10, Math.round((offsetMm[1] - sz) * 10) / 10];
    if (Math.abs(residual[1]) > 4) continue;
    if (!best || Math.abs(residual[1]) < Math.abs(best.residual[1])) best = { slotId, residual };
  }
  return best;
}
/**
 * Lowers a held module into the slot it is over, as held: it rests in the slot (not yet pressed home,
 * clips still open). The engine checks the clips, the notch, the alignment and the slot's generation.
 */
export function lowerSimpleRam(state: PCBuildState, key: SimplePartKey, pose: SimpleAlignment): { ok: true; state: PCBuildState; slotId: string } | { ok: false; reason: SimpleBlock | "noSlot" | "slotTaken"; message?: { en: string; ar: string }; slotId?: string } {
  const blocked = simpleBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  const spec = partSpec(key);
  if (state.parts.find((p) => p.instanceId === spec.id)?.attachments.length) return { ok: false, reason: "alreadyIn" };
  const target = simpleRamTargetFor(state, pose.offsetMm);
  if (!target) return { ok: false, reason: "noSlot" };
  const slot = simpleRamSlots(state).find((s) => s.id === target.slotId)!;
  if (slot.occupant) return { ok: false, reason: "slotTaken", slotId: slot.id };
  const r = pc.applyAction(state, { type: "mount_part", instanceId: spec.id, target: { hostInstanceId: spec.host, mountPointId: slot.id }, alignment: { rotationDeg: pose.rotationDeg, offsetMm: target.residual } }, pcCatalog);
  if (!r.ok) {
    const code = r.rejection.code;
    const reason: SimpleBlock = code === "retention_closed" ? "openFirst" : code === "keying_wrong" ? "turnPart" : code === "alignment_off" ? "centrePart" : "cannotFit";
    return { ok: false, reason, message: r.rejection.message, slotId: slot.id };
  }
  return { ok: true, state: r.state, slotId: slot.id };
}

/** Pushes a released part home again (a module whose latch was opened, or one left half in). */
export function reseatSimplePart(state: PCBuildState, key: SimplePartKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  const spec = partSpec(key);
  const part = state.parts.find((p) => p.instanceId === spec.id);
  if (!part?.attachments.length) return { ok: false, reason: "cannotFit" };
  const r = pc.applyAction(state, { type: "set_seating", instanceId: spec.id, seating: "seated" }, pcCatalog);
  return r.ok ? { ok: true, state: r.state } : { ok: false, reason: "openFirst" };
}

export const SLOT_COVERS_ID = "slot-covers";
/**
 * The case's expansion-slot covers a card's bracket needs out, from the first x16 slot, each with its mechanism id and
 * whether it is out. Empty until the board is in a case. The count is the lab's schematic (see `SLOT_COVERS`).
 */
export function slotCovers(state: PCBuildState): { id: string; open: boolean }[] {
  const board = state.parts.find((p) => p.instanceId === active.parts.find((x) => x.key === "motherboard")?.id);
  const casePart = board?.attachments[0] && state.parts.find((p) => p.instanceId === board.attachments[0]!.target.hostInstanceId);
  const covers = casePart && pcCatalog.entries.find((e) => e.id === casePart.catalogId)?.mountPoints.find((m) => m.retention?.kind === "slot_covers")?.retention;
  return covers ? slotCoverIds(covers).map((id) => ({ id, open: slotCoverOpen(casePart.mechanisms, covers, id) })) : [];
}
/** True when the board is in a case with an expansion-slot cover a card's bracket needs still in. */
export const caseCoversClosed = (state: PCBuildState): boolean => slotCovers(state).some((c) => !c.open);

/**
 * Whole-card fit for old saves and tests only: the bare `slot-covers` step opens or shuts every cover a bracket needs
 * and `fasten:`/`unfasten:` set every bracket screw. The page's controls take one cover and one screw per step instead.
 */
/** Screws all of a seated part's bracket screws to the case (a graphics card). */
export function fastenSimplePart(state: PCBuildState, key: SimplePartKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  const spec = partSpec(key);
  const r = pc.applyAction(state, { type: "set_fasteners", instanceId: spec.id, secured: spec.screws }, pcCatalog);
  return r.ok ? { ok: true, state: r.state } : { ok: false, reason: "cannotFit" };
}
/** Takes a card's bracket screws out again. */
export function unfastenSimplePart(state: PCBuildState, key: SimplePartKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  const r = pc.applyAction(state, { type: "set_fasteners", instanceId: partSpec(key).id, secured: 0 }, pcCatalog);
  return r.ok ? { ok: true, state: r.state } : { ok: false, reason: "cannotFit" };
}
/** True when a part's bracket or screws are all in. */
export function simpleFastened(state: PCBuildState, key: SimplePartKey): boolean {
  const spec = partSpec(key);
  const at = firstAttachment(state, key);
  return Boolean(at && spec.screws && at.fastenersSecured >= spec.screws);
}

type InstalledPartLike = PCBuildState["parts"][number];
/**
 * True when a lead joins a part of `inside` to a part outside it: both ends in, or a fixed lead of one plugged into
 * the other. A lead wholly within the set (a cooler's fan lead on the board that carries the cooler) is not crossing.
 */
const leadCrosses = (state: PCBuildState, inside: ReadonlySet<string>) => state.cables.some((c) => {
  const joined = new Set(Object.values(c.ends).flatMap((e) => (e?.kind === "part" ? [e.instanceId] : [])));
  const fixed = pcCatalog.entries.find((e) => e.id === c.catalogId)?.cables.find((x) => x.id === c.cableSpecId)?.attachment === "captive";
  if (fixed && c.ownerInstanceId) joined.add(c.ownerInstanceId);
  const parts = [...joined];
  return parts.some((id) => inside.has(id)) && parts.some((id) => !inside.has(id));
});

/**
 * Why a screwed part (board, power supply, SATA drive, case fan) cannot be lifted out yet: its screws come
 * out first, one at a time; a power supply or board also needs every lead unplugged. A board carries its
 * CPU, memory, drive and cooler block out with it, but not a card still screwed to the case or a radiator.
 */
export function simpleLiftBlock(state: PCBuildState, key: SimplePartKey): SimpleBlock | null {
  if (!simpleUsesScrews(key) || isCoolerKey(key)) return null;
  const spec = partSpec(key);
  const at = firstAttachment(state, key);
  if (!at) return null;
  if (at.fastenersSecured > 0) return "unscrewFirst";
  const board = roleOf(key) === "motherboard";
  const carried = board ? state.parts.filter((p) => p.attachments.some((a) => a.target.hostInstanceId === spec.id)) : [];
  const screwedToCase = (p: InstalledPartLike) => p.attachments.some((a) => a.role === "radiator" || (a.target.hostInstanceId === spec.id && a.fastenersSecured > 0 && pcCatalog.entries.find((e) => e.id === p.catalogId)?.category === "gpu"));
  if (board && state.parts.some(screwedToCase)) return "unscrewFirst";
  if (leadCrosses(state, new Set([spec.id, ...carried.map((p) => p.instanceId)]))) return "unplugFirst";
  return null;
}

/** Takes a part out of its open place back to the bench. */
export function liftSimplePart(state: PCBuildState, key: SimplePartKey, role?: "block" | "radiator"): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock; message?: { en: string; ar: string } } {
  const spec = partSpec(key);
  const liftBlocked = simpleLiftBlock(state, key);
  if (liftBlocked) return { ok: false, reason: liftBlocked };
  const roleOf = role ?? (spec.radiator ? "block" : undefined);
  const r = pc.applyAction(state, { type: "unmount_part", instanceId: spec.id, ...(roleOf ? { role: roleOf } : {}) }, pcCatalog);
  if (r.ok) return { ok: true, state: r.state };
  const text = r.rejection.message.en;
  const reason: SimpleBlock = /power cable/.test(text) ? "unplugFirst" : /screws/.test(text) ? "unscrewFirst" : "openFirst";
  return { ok: false, reason, message: r.rejection.message };
}

/** The slot or place a part is fitted to. A RAM stick takes A2 when it is first in, B2 when the other stick holds A2. */
export function simpleTarget(state: PCBuildState, key: SimplePartKey, slotId?: string): { hostInstanceId: string; mountPointId: string } {
  const spec = partSpec(key);
  // An M.2 drive, a SATA drive or a case fan: the place it is in, else the one the learner chose, else the plan's.
  if (isM2Key(key) || isPositionKey(key)) {
    const own = firstAttachment(state, key);
    return { hostInstanceId: spec.host, mountPointId: own?.target.mountPointId ?? slotId ?? spec.mount };
  }
  if (!isRamKey(key)) return { hostInstanceId: spec.host, mountPointId: spec.mount };
  const own = state.parts.find((p) => p.instanceId === spec.id)?.attachments.find((a) => a.target.hostInstanceId === spec.host);
  if (own) return { hostInstanceId: spec.host, mountPointId: own.target.mountPointId };
  const taken = new Set(state.parts.flatMap((p) => p.attachments.filter((a) => a.target.hostInstanceId === spec.host).map((a) => a.target.mountPointId)));
  return { hostInstanceId: spec.host, mountPointId: RAM_SLOTS.find((slot) => !taken.has(slot)) ?? RAM_SLOTS[0] };
}

/** Where a SATA drive or a case fan may go: each of the case's bays or fan places, whether this part fits it, and who holds it. */
export interface SimplePosition { id: string; label: { en: string; ar: string }; fits: boolean; occupant: string | null; supplied: boolean; radiator: boolean }
export function simplePositions(state: PCBuildState, key: SimplePartKey): SimplePosition[] {
  const spec = partSpec(key);
  const hostEntry = pcCatalog.entries.find((e) => e.id === state.parts.find((p) => p.instanceId === spec.host)?.catalogId);
  const part = pcCatalog.entries.find((e) => e.id === spec.catalogId);
  if (!hostEntry || !part) return [];
  const heldBy = (mountId: string) => state.parts.find((p) => p.attachments.some((a) => a.target.hostInstanceId === spec.host && a.target.mountPointId === mountId));
  // A radiator in place covers the fan places it lists as `blocks`.
  const covered = new Set(hostEntry.mountPoints.flatMap((m) => (m.kind === "radiator_mount" && heldBy(m.id) ? (m.blocks ?? []) : [])));
  return hostEntry.mountPoints.flatMap((m): SimplePosition[] => {
    const fits = part.category === "storage" ? m.kind === "drive_bay" && (m.sizes as string[]).includes(part.spec.formFactor)
      : part.category === "fan" && m.kind === "fan_mount" && m.sizesMm.includes(part.spec.sizeMm);
    if (!fits && !(m.kind === (part.category === "storage" ? "drive_bay" : "fan_mount"))) return [];
    const occupant = heldBy(m.id);
    const known = ALL_SIMPLE_PARTS.find((p) => p.id === occupant?.instanceId)?.key;
    return [{ id: m.id, label: m.label, fits: fits && !covered.has(m.id), occupant: occupant ? (known ?? occupant.instanceId) : null, supplied: Boolean(occupant && (!known || partSpec(known).supplied)), radiator: covered.has(m.id) }];
  });
}

export function simplePartInstalled(state: PCBuildState, key: SimplePartKey): boolean {
  const spec = partSpec(key);
  // A module counts in any memory slot of its board (the learner chooses the slot); the recommendation is advice.
  const m2 = isM2Key(key);
  const mounts: readonly string[] = isRamKey(key) ? simpleRamSlots(state).map((x) => x.id) : m2 ? simpleM2Slots(state, key).map((x) => x.id) : isPositionKey(key) ? simplePositions(state, key).map((x) => x.id) : [spec.mount];
  const part = state.parts.find((p) => p.instanceId === spec.id);
  if (!part) return false;
  const fitted = (host: string, ids: readonly string[], screws: number) =>
    part.attachments.some((a) => a.target.hostInstanceId === host && ids.includes(a.target.mountPointId) && a.seating === "seated" && a.fastenersSecured >= screws);
  if (m2) {
    // Pressed flat, held, and the board's heatsink over it back on and screwed down.
    const at = part.attachments.find((a) => a.target.hostInstanceId === spec.host && mounts.includes(a.target.mountPointId));
    const hs = at ? simpleM2Heatsink(state, at.target.mountPointId) : null;
    return fitted(spec.host, mounts, spec.screws) && (!hs || (hs.fitted && hs.screwsIn));
  }
  return fitted(spec.host, mounts, simpleRequiredScrews(state, key)) && (!spec.radiator || fitted(spec.radiator.host, [spec.radiator.mount], spec.radiator.screws));
}

/** The part filling a slot, or null: `cpu` → the i5 or the i9, `cooler` → the air or the liquid cooler. */
export function simpleSlotPart(state: PCBuildState, slot: SimpleSlot): SimplePartKey | null {
  return ALL_SIMPLE_PARTS.find((p) => slotOf(p.key) === slot && simplePartInstalled(state, p.key))?.key ?? null;
}
export const simpleSlotFilled = (state: PCBuildState, slot: SimpleSlot) => simpleSlotPart(state, slot) !== null;
/** Every slot filled: one CPU, every RAM stick, the drives, one cooler, the board, the card, the PSU and the fans. */
export const simpleAllPartsIn = (state: PCBuildState) => SIMPLE_PARTS.every((p) => simpleSlotFilled(state, slotOf(p.key)));
/** How many of the slots are filled. */
export const simplePartsProgress = (state: PCBuildState) => SIMPLE_PARTS.filter((p) => simpleSlotFilled(state, slotOf(p.key))).length;
/** A part a lead or another part needs: `cpu` is met by either CPU; any other key by that part. */
const requirementMet = (state: PCBuildState, key: SimplePartKey) => (key === "cpu" ? simpleSlotFilled(state, "cpu") : simplePartInstalled(state, key));

/** Parts that must be in before this one, in the order a learner would fit them. */
export function simplePrerequisites(key: SimplePartKey): SimplePartKey[] {
  if (key === "motherboard") return [...BOARD_PREP];
  // A liquid cooler with a modelled mounting has its pump block fitted on the bench (owner decision 15): only its radiator needs the case.
  if (isCoolerKey(key)) return partSpec(key)?.radiator && !hasModelledMounting(key) ? ["cpu", "motherboard"] : ["cpu"];
  // A power supply sits in the case's own bay: it needs no board (the guide only suggests the order).
  if (key === "gpu") return ["motherboard"];
  return [];
}

export function simpleBlock(state: PCBuildState, key: SimplePartKey): SimpleBlock | null {
  if (!simplePartInstalled(state, key)) {
    if (slotOf(key) === "cpu" && rivalsOf(key).some((k) => simplePartInstalled(state, k))) return "socketTaken";
    if (slotOf(key) === "cooler" && rivalsOf(key).some((k) => simplePartInstalled(state, k))) return "coolerTaken";
  }
  const modelled = isCoolerKey(key) && Boolean(simpleCoolerMounting(state, key));
  if (isCoolerKey(key) && !(modelled ? seatedCpuKey(state) !== null : simpleSlotFilled(state, "cpu"))) return "cpuFirst";
  if (key === "motherboard" && !BOARD_PREP.every((k) => requirementMet(state, k))) return "prepareBoard";
  // A modelled liquid cooler's pump block goes on the board on the bench (owner decision 15); only its radiator needs the case.
  if ((key === "gpu" || (isCoolerKey(key) && partSpec(key)?.radiator && !modelled)) && !simplePartInstalled(state, "motherboard")) return "boardFirst";
  return null;
}

/** The airflow a fan position needs: rear and top blow out, the rest pull in. */
export const airflowFor = (location: string) => (location === "rear" || location === "top" ? "exhaust" : "intake");

/**
 * The preparation a part needs before it is fitted, the right way: paste and film for a cooler,
 * standoffs and I/O shield for a board, the PSU's fan direction, a fan's airflow. Only what the
 * catalog records is asked for.
 */
export function simplePrepFor(state: PCBuildState, key: SimplePartKey): { prep: PrepKind; value: string; optional?: boolean }[] {
  const spec = partSpec(key);
  const entry = pcCatalog.entries.find((e) => e.id === spec.catalogId);
  const target = simpleTarget(state, key);
  const host = state.parts.find((p) => p.instanceId === target.hostInstanceId);
  const place = pcCatalog.entries.find((e) => e.id === host?.catalogId)?.mountPoints.find((m) => m.id === target.mountPointId);
  if (!entry) return [];
  if (entry.category === "cooling") {
    const paste = entry.spec.paste;
    return [...(paste?.film ? [{ prep: "film" as const, value: "removed" }] : []), ...(paste?.supplied === "tube" ? [{ prep: "paste" as const, value: "applied" }] : [])];
  }
  if (entry.category === "motherboard") return [{ prep: "standoffs", value: "checked" }, ...(entry.spec.ioShield?.kind === "separate" ? [{ prep: "io_shield" as const, value: "fitted" }] : [])];
  if (entry.category === "psu") return [{ prep: "psu_fan", value: "down" }];
  if (entry.category === "fan" && place && (place.kind === "fan_mount" || place.kind === "radiator_mount")) return [{ prep: "airflow", value: airflowFor(place.location) }];
  return [];
}
/**
 * The usual advice for the way a power supply or fan faces, or null. Advice only: both ways fit and nothing
 * refuses either. A power supply over the case's filtered vent faces down; a fan at the front or bottom
 * draws air in, one at the rear or top blows it out (`positionId`: the place the learner chose).
 */
export function simpleOrientationAdvice(state: PCBuildState, key: SimplePartKey, positionId?: string): "psuDown" | "intake" | "exhaust" | null {
  const target = simpleTarget(state, key, positionId);
  const host = pcCatalog.entries.find((e) => e.id === state.parts.find((p) => p.instanceId === target.hostInstanceId)?.catalogId);
  const place = host?.mountPoints.find((m) => m.id === target.mountPointId);
  if (place?.kind === "psu_bay") return place.bottomVent?.present ? "psuDown" : null;
  return place && (place.kind === "fan_mount" || place.kind === "radiator_mount") ? airflowFor(place.location) : null;
}
const prepActions = (state: PCBuildState, key: SimplePartKey): PCAction[] => {
  const part = state.parts.find((p) => p.instanceId === partSpec(key).id);
  return simplePrepFor(state, key).filter((p) => part?.prep?.[p.prep] !== p.value).map((p) => ({ type: "set_prep", instanceId: partSpec(key).id, prep: p.prep, value: p.value }));
};

// ---------- Hands-on: preparation, placing and screws (cooler, board, PSU, fans) ----------

type Engine = { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock; message?: { en: string; ar: string } };
const engineResult = (r: ReturnType<typeof pc.applyAction>): Engine => {
  if (r.ok) return { ok: true, state: r.state };
  const code = r.rejection.code;
  const reason: SimpleBlock = code === "prep_missing" ? "prepMissing" : code === "prep_wrong" ? "prepWrong" : code === "mounting_missing" ? "mountingMissing" : code === "hardware_order_wrong" ? "orderWrong" : "cannotFit";
  return { ok: false, reason, message: r.rejection.message };
};
/** Does a preparation step on a part in hand (paste, film, standoffs, I/O shield, PSU fan, fan airflow); "" undoes it. */
export function prepSimplePart(state: PCBuildState, key: SimplePartKey, prep: PrepKind, value: string): Engine {
  if (state.power.pressed) return { ok: false, reason: "cannotFit" };
  return engineResult(pc.applyAction(state, { type: "set_prep", instanceId: partSpec(key).id, prep, value }, pcCatalog));
}
/** One step of kit hardware on a part (`who`: a part key; the board's ILM and frame, a cooler's screws, ring and pins). */
export function setSimpleHardware(state: PCBuildState, who: SimplePartKey, key: string, value: string): Engine {
  if (state.power.pressed) return { ok: false, reason: "cannotFit" };
  return engineResult(pc.applyAction(state, { type: "set_hardware", instanceId: partSpec(who).id, key, value }, pcCatalog));
}

/** How a cooler is fixed on this build's socket (detailed builds only); undefined when the lab's generic fixing applies. */
export function simpleCoolerMounting(state: PCBuildState, key: SimplePartKey) {
  if (state.mechanics !== "detailed") return undefined;
  const spec = ALL_SIMPLE_PARTS.find((p) => p.key === key);
  const entry = pcCatalog.entries.find((e) => e.id === spec?.catalogId);
  if (!spec || entry?.category !== "cooling") return undefined;
  const board = pcCatalog.entries.find((e) => e.id === state.parts.find((p) => p.instanceId === spec.host)?.catalogId);
  const socket = board?.category === "motherboard" ? board.spec.socket : undefined;
  return socket ? entry.spec.mounting?.find((m) => (m.sockets as string[]).includes(socket)) : undefined;
}
/** The CPU that is seated in the socket, installed or not (a CPU waiting for its contact frame is seated, not yet retained). */
export function seatedCpuKey(state: PCBuildState): SimplePartKey | null {
  return ALL_SIMPLE_PARTS.find((p) => slotOf(p.key) === "cpu" && state.parts.find((x) => x.instanceId === p.id)?.attachments.some((a) => a.seating === "seated" && a.target.mountPointId === "cpu-socket"))?.key ?? null;
}
/** Whether the catalog models this cooler's mounting on the active build's socket, whatever the state of the build. */
export function hasModelledMounting(key: SimplePartKey): boolean {
  const entry = pcCatalog.entries.find((e) => e.id === partSpec(key)?.catalogId);
  const boardId = ALL_SIMPLE_PARTS.find((p) => roleOf(p.key) === "motherboard")?.catalogId;
  const board = pcCatalog.entries.find((e) => e.id === boardId);
  return entry?.category === "cooling" && board?.category === "motherboard" && Boolean(entry.spec.mounting?.some((m) => (m.sockets as string[]).includes(board.spec.socket)));
}
/** How many screws hold the cooler body: its own mounting's count, else the lab's generic count. */
export const simpleRequiredScrews = (state: PCBuildState, key: SimplePartKey): number => {
  const mounting = simpleCoolerMounting(state, key)?.bodyScrews?.count;
  if (mounting !== undefined || !isPositionKey(key)) return mounting ?? partSpec(key).screws;
  // The bay or fan place the part is actually in has its own fastener count.
  const at = firstAttachment(state, key);
  const host = state.parts.find((p) => p.instanceId === partSpec(key).host);
  return pcCatalog.entries.find((e) => e.id === host?.catalogId)?.mountPoints.find((m) => m.id === at?.target.mountPointId)?.fastener?.count ?? partSpec(key).screws;
};

/** The fan places a liquid cooler's radiator covers, and the instances sitting in them now. */
function radiatorCover(state: PCBuildState, key: SimplePartKey): { fans: string[]; supplied: string[] } {
  const radiator = partSpec(key).radiator;
  const place = pcCatalog.entries.find((e) => e.id === state.parts.find((p) => p.instanceId === radiator?.host)?.catalogId)?.mountPoints.find((m) => m.id === radiator?.mount);
  const covered = new Set(place?.kind === "radiator_mount" ? (place.blocks ?? []) : []);
  const fans = state.parts.filter((p) => p.attachments.some((a) => a.target.hostInstanceId === radiator?.host && covered.has(a.target.mountPointId))).map((p) => p.instanceId);
  const own = new Set(radiator?.moveFans.map(([fan]) => fan));
  return { fans, supplied: fans.filter((id) => own.has(id)) };
}
/** The fans (case's own or the learner's) sitting where the radiator goes, as part keys: each is taken out by its own steps. */
export const simpleFansInTheWay = (state: PCBuildState, key: SimplePartKey): SimplePartKey[] =>
  radiatorCover(state, key).fans.flatMap((id) => ALL_SIMPLE_PARTS.find((p) => p.id === id)?.key ?? []);

/** The steps that move one case fan to its place for a radiator: out, the airflow it needs there, in, home, screwed. */
const moveFanActions = (state: PCBuildState, radiator: NonNullable<PartSpec["radiator"]>, only?: ReadonlySet<string>): PCAction[] =>
  radiator.moveFans.flatMap(([fan, place]): PCAction[] => (state.parts.find((p) => p.instanceId === fan)?.attachments.length && (!only || only.has(fan)) ? [
    { type: "unmount_part", instanceId: fan },
    { type: "set_prep", instanceId: fan, prep: "airflow", value: airflowFor(radiatorLocation(state, radiator.host, place)) },
    { type: "mount_part", instanceId: fan, target: { hostInstanceId: radiator.host, mountPointId: place } },
    { type: "set_seating", instanceId: fan, seating: "seated" },
    { type: "set_fasteners", instanceId: fan, secured: FAN_SCREWS },
  ] : []));

/**
 * Old saves only (`fans:<key>`, from before the case's fans could be worked on one by one): the case's own fans that
 * cover the radiator's places move to the top, as exhaust. No control calls this; a fan in the way is taken out by hand.
 */
export function clearRadiatorFans(state: PCBuildState, key: SimplePartKey): Engine {
  const radiator = partSpec(key).radiator;
  const cover = radiatorCover(state, key);
  if (!radiator || cover.supplied.length === 0) return { ok: false, reason: "cannotFit" };
  try { return { ok: true, state: run(state, moveFanActions(state, radiator, new Set(cover.supplied))) }; } catch { return { ok: false, reason: "cannotFit" }; }
}

/**
 * Puts the liquid cooler's radiator in the case. Any fan in its way is refused (`fanInTheWay`): the learner takes
 * it out themself, one step at a time. Only replaying an old save (`migrate`) moves the case's own fans here.
 */
export function placeRadiator(state: PCBuildState, key: SimplePartKey, migrate = false): Engine {
  const spec = partSpec(key);
  const radiator = spec.radiator;
  if (!radiator) return { ok: false, reason: "cannotFit" };
  if (state.parts.find((p) => p.instanceId === spec.id)?.attachments.some((a) => a.role === "radiator")) return { ok: false, reason: "alreadyIn" };
  const cover = radiatorCover(state, key);
  if (migrate ? cover.fans.length > cover.supplied.length : cover.fans.length > 0) return { ok: false, reason: "fanInTheWay" };
  try {
    return { ok: true, state: run(state, [
      ...(migrate ? moveFanActions(state, radiator, new Set(cover.supplied)) : []),
      { type: "mount_part", instanceId: spec.id, role: "radiator", target: { hostInstanceId: radiator.host, mountPointId: radiator.mount } },
      { type: "set_seating", instanceId: spec.id, role: "radiator", seating: "seated" },
    ]) };
  } catch { return { ok: false, reason: "cannotFit" }; }
}
/** Sets how many of the radiator's fasteners are in (the page takes them one at a time). */
export function setRadiatorScrews(state: PCBuildState, key: SimplePartKey, count: number): Engine {
  return engineResult(pc.applyAction(state, { type: "set_fasteners", instanceId: partSpec(key).id, role: "radiator", secured: count }, pcCatalog));
}

/**
 * Puts a prepared part in its place, home but not yet screwed. A SATA drive or a case fan goes where the
 * learner chose (`positionId`); a bay that is taken or too small, or a fan place under a radiator, is refused.
 */
export function placeSimplePart(state: PCBuildState, key: SimplePartKey, positionId?: string): Engine {
  const blocked = simpleBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  const spec = partSpec(key);
  if (state.parts.find((p) => p.instanceId === spec.id)?.attachments.length) return { ok: false, reason: "alreadyIn" };
  if (positionId && isPositionKey(key)) {
    const position = simplePositions(state, key).find((x) => x.id === positionId);
    if (!position) return { ok: false, reason: "cannotFit" };
    if (position.occupant) return { ok: false, reason: "positionTaken" };
    if (!position.fits) return { ok: false, reason: "positionWrong" };
  }
  const role = spec.radiator ? { role: "block" } : {};
  const m = pc.applyAction(state, { type: "mount_part", instanceId: spec.id, target: simpleTarget(state, key, positionId), ...role }, pcCatalog);
  if (!m.ok) return engineResult(m);
  return engineResult(pc.applyAction(m.state, { type: "set_seating", instanceId: spec.id, seating: "seated", ...role }, pcCatalog));
}
/** Tightens one more screw of a placed part. Which screw is the learner's (see simpleScrewOrder). */
export function screwSimplePart(state: PCBuildState, key: SimplePartKey): Engine {
  const spec = partSpec(key);
  const at = firstAttachment(state, key);
  if (!at) return { ok: false, reason: "cannotFit" };
  if (at.fastenersSecured >= simpleRequiredScrews(state, key)) return { ok: false, reason: "alreadyIn" };
  return engineResult(pc.applyAction(state, { type: "set_fasteners", instanceId: spec.id, secured: at.fastenersSecured + 1 }, pcCatalog));
}
/** Takes one screw of a placed part out again (the reverse of one `screwSimplePart`). */
export function unscrewSimplePart(state: PCBuildState, key: SimplePartKey): Engine {
  const at = firstAttachment(state, key);
  if (!at || at.fastenersSecured <= 0) return { ok: false, reason: "cannotFit" };
  return engineResult(pc.applyAction(state, { type: "set_fasteners", instanceId: partSpec(key).id, secured: at.fastenersSecured - 1 }, pcCatalog));
}
/** True for parts fitted with preparation, placing and screws in the scene (not a mechanism, not a one-step install). */
export function simpleUsesScrews(key: SimplePartKey): boolean {
  const spec = partSpec(key);
  const role = roleOf(key);
  return !spec.radiator && (role === "cooler" || role === "motherboard" || role === "psu" || isPositionKey(key));
}
/** A liquid cooler: its paste is the learner's; the pump block and radiator then go in together. */
export const simpleIsLiquid = (key: SimplePartKey) => Boolean(partSpec(key)?.radiator);

/**
 * The cooler's screws go in corner by corner across the diagonal, so the plate meets the CPU evenly:
 * after one corner, its opposite corner next. Returns the corner that has to come next, or null.
 */
export function simpleScrewOrder(history: readonly SimpleStep[], key: SimplePartKey): { done: number[]; next: number | null } {
  const lastPlace = history.lastIndexOf(`place:${key}`);
  const done = history.slice(lastPlace + 1).filter((st) => st.startsWith(`screw:${key}:`)).map((st) => Number(st.slice(st.lastIndexOf(":") + 1)));
  if (roleOf(key) !== "cooler" || done.length === 0) return { done, next: null };
  const last = done.at(-1)!;
  const opposite = (last + 2) % 4;
  return { done, next: done.includes(opposite) ? null : opposite };
}

export function installSimplePart(state: PCBuildState, key: SimplePartKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  if (simplePartInstalled(state, key)) return { ok: true, state };
  const blocked = simpleBlock(state, key);
  if (blocked) return { ok: false, reason: blocked };
  if (isM2Key(key)) return installM2Whole(state, key);
  // A cooler with a modelled mounting is fitted through its documented steps, one after another (old saves and tests; the page never calls this).
  if (isCoolerKey(key) && simpleCoolerMounting(state, key)) return installCoolerWhole(state, key);
  const spec = partSpec(key);
  // A liquid cooler has two bodies: the pump block on the CPU, then the radiator in the case.
  const role = (name: string) => (spec.radiator ? { role: name } : {});
  const target = simpleTarget(state, key);
  // Already in its place but not pushed home (a fault to find): pushing it in is the whole step.
  const resting = state.parts.find((p) => p.instanceId === spec.id)?.attachments.some((a) => a.target.hostInstanceId === target.hostInstanceId && a.target.mountPointId === target.mountPointId);
  if (resting && !spec.radiator && simpleRetention(state, key)) {
    const r = reseatSimplePart(state, key);
    if (!r.ok) return r;
    const ret = simpleRetention(r.state, key)!;
    if (ret.kind !== "dimm_latch" && !ret.open) return r;
    if (ret.kind !== "dimm_latch") return closeRetention(r.state, ret);
    return r;
  }
  if (resting && !spec.radiator) {
    try {
      return { ok: true, state: run(state, [
        { type: "set_seating", instanceId: spec.id, seating: "seated" },
        ...(spec.screws ? [{ type: "set_fasteners", instanceId: spec.id, secured: spec.screws } as PCAction] : []),
      ]) };
    } catch { return { ok: false, reason: "cannotFit" }; }
  }
  // A part behind a mechanism, in one step (older saves, tests): open, lower aligned, close the plate.
  const retention = simpleRetention(state, key);
  if (retention && !spec.radiator) {
    let next = state;
    // A card in a case needs the case's slot covers out first.
    if (retention.kind === "pcie_latch" && caseCoversClosed(next)) { const c = setSimpleMechanism(next, SLOT_COVERS_ID, "open"); if (!c.ok) return { ok: false, reason: "cannotFit" }; next = c.state; }
    if (retention.leverId && !retention.leverOpen) { const o = setSimpleMechanism(next, retention.leverId, "open"); if (!o.ok) return { ok: false, reason: "cannotFit" }; next = o.state; }
    if (!retention.open) { const o = setSimpleMechanism(next, retention.id, "open"); if (!o.ok) return { ok: false, reason: "cannotFit" }; next = o.state; }
    if (retention.nearId && !retention.nearOpen) { const o = setSimpleMechanism(next, retention.nearId, "open"); if (!o.ok) return { ok: false, reason: "cannotFit" }; next = o.state; }
    const l = lowerSimplePart(next, key, ALIGNED);
    if (!l.ok) return { ok: false, reason: l.reason };
    next = l.state;
    if (retention.kind === "pcie_latch") { const f = fastenSimplePart(next, key); if (!f.ok) return { ok: false, reason: "cannotFit" }; next = f.state; }
    else if (retention.kind !== "dimm_latch") { const c = closeRetention(next, retention); if (!c.ok) return c; next = c.state; }
    return { ok: true, state: next };
  }
  try {
    return { ok: true, state: run(state, [
      ...prepActions(state, key),
      { type: "mount_part", instanceId: spec.id, target, ...role("block") },
      { type: "set_seating", instanceId: spec.id, seating: "seated", ...role("block") },
      ...(spec.screws ? [{ type: "set_fasteners", instanceId: spec.id, secured: spec.screws, ...role("block") } as PCAction] : []),
      ...(spec.radiator ? [
        ...spec.radiator.moveFans.flatMap(([fan, place]): PCAction[] => [
          { type: "unmount_part", instanceId: fan },
          { type: "set_prep", instanceId: fan, prep: "airflow", value: airflowFor(radiatorLocation(state, spec.radiator!.host, place)) },
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

/** The mechanism steps (`mech:` ids and states) that take the heatsink over this slot off, if it is on. */
export function m2HeatsinkOff(state: PCBuildState, slotId: string): [string, "open" | "closed"][] {
  const hs = simpleM2Heatsink(state, slotId);
  if (!hs?.fitted) return [];
  return [...(hs.screwsIn ? [[`${hs.id}:screws`, "open"] as [string, "open"]] : []), [hs.id, "open"]];
}
/** The steps that put the heatsink over this slot back on: film peeled, refitted, screws in. */
export function m2HeatsinkOn(state: PCBuildState, slotId: string): [string, "open" | "closed"][] {
  const hs = simpleM2Heatsink(state, slotId);
  if (!hs) return [];
  return [...(hs.filmOn ? [[`${hs.id}:film`, "open"] as [string, "open"]] : []), ...(hs.fitted ? [] : [[hs.id, "closed"] as [string, "closed"]]), ...(hs.screwsIn ? [] : [[`${hs.id}:screws`, "closed"] as [string, "closed"]])];
}
/** The angle the lab uses when a whole M.2 fitting is done in one step (older saves, tests): inside 15–35°. */
export const M2_WHOLE_TILT_DEG = 25;

/** An M.2 drive in one step (older saves, tests): every documented step of the plan's slot, in order. */
function installM2Whole(state: PCBuildState, key: SimplePartKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleBlock } {
  const slotId = simpleTarget(state, key).mountPointId;
  let next = state;
  const mech = (id: string, desired: "open" | "closed") => { const r = setSimpleMechanism(next, id, desired); if (!r.ok) throw new Error(id); next = r.state; };
  try {
    for (const [id, st] of m2HeatsinkOff(next, slotId)) mech(id, st);
    const ret = simpleRetention(next, key)!;
    const resting = next.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments.length;
    if (!resting) {
      if (ret.standId && !ret.standIn) mech(ret.standId, "closed");
      if (ret.kind === "m2_qlatch" && !ret.open) mech(ret.id, "open");
      const l = lowerSimplePart(next, key, { ...ALIGNED, tiltDeg: M2_WHOLE_TILT_DEG, slotId });
      if (!l.ok) return { ok: false, reason: l.reason };
      next = l.state;
    }
    const seated = reseatSimplePart(next, key);
    if (!seated.ok) return seated;
    next = seated.state;
    mech(ret.id, "closed");
    for (const [id, st] of m2HeatsinkOn(next, slotId)) mech(id, st);
  } catch { return { ok: false, reason: "cannotFit" }; }
  return { ok: true, state: next };
}

function radiatorLocation(state: PCBuildState, hostInstanceId: string, mountPointId: string): string {
  const host = state.parts.find((p) => p.instanceId === hostInstanceId)?.catalogId;
  const m = pcCatalog.entries.find((e) => e.id === host)?.mountPoints.find((x) => x.id === mountPointId);
  return m && (m.kind === "fan_mount" || m.kind === "radiator_mount") ? m.location : "front";
}

/** Where the radiator of a liquid cooler goes, for the 3D view; null for every other part. */
export function simpleRadiatorTarget(key: SimplePartKey): { hostInstanceId: string; mountPointId: string } | null {
  const radiator = partSpec(key).radiator;
  return radiator ? { hostInstanceId: radiator.host, mountPointId: radiator.mount } : null;
}

/** The leads of the build as it stands: the liquid cooler's two in place of the air cooler's one when it is fitted. */
export function simpleCablesFor(state: PCBuildState): CableSpec[] {
  const swapped = active.swapCablesWith !== null && simplePartInstalled(state, active.swapCablesWith);
  return [...SIMPLE_CABLES.filter((c) => !(swapped && active.swapCablesReplace.includes(c.key))), ...(swapped ? SIMPLE_AIO_CABLES : [])];
}

/** Why a fitted part cannot come out (a cooler, or a CPU as part of a swap), or null when it can. */
export function simpleRemoveBlock(state: PCBuildState, key: SimplePartKey): SimpleRemoveBlock | null {
  if (!SWAPPABLE.includes(key)) return "notSwappable";
  if (state.power.pressed) return "turnOffFirst";
  if (slotOf(key) === "cpu" && simpleSlotFilled(state, "cooler")) return "removeCoolerFirst";
  if (isCoolerKey(key) && ALL_SIMPLE_CABLES.some((c) => c.requires.includes(key) && simpleCableConnected(state, c.key))) return "unplugCoolerFirst";
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
  if (partSpec(key)?.radiator && !simplePartInstalled(state, "motherboard")) return "boardFirst";
  return null;
}

/** The lab rule that stops this build from starting, if any (see `SimpleRule`). */
export function simpleRuleBlock(state: PCBuildState): SimpleRule | null {
  const rule = active.rule;
  if (!rule) return null;
  return rule.cpuKeys.some((k) => simplePartInstalled(state, k)) && !rule.coolerKeys.some((k) => simplePartInstalled(state, k)) ? "needsLiquidCooler" : null;
}

/** The catalog port `portId` of a fitted part, or undefined. */
const portOf = (state: PCBuildState, instanceId: string, portId: string) => {
  const part = state.parts.find((p) => p.instanceId === instanceId);
  return pcCatalog.entries.find((e) => e.id === part?.catalogId)?.ports.find((x) => x.id === portId);
};
/** Two sockets that take the same plug the same way: connector, function, keying and role (a board's main EPS and its auxiliary one are not swapped) all match. */
const sameKind = (a: PortSpec, b: PortSpec) => a.connector === b.connector && a.function === b.function && a.keying === b.keying && a.requirement === b.requirement;
/** The port of `instanceId` this end is plugged into now, or null. */
export function actualEndPort(state: PCBuildState, end: CableExtraEnd): string | null {
  const to = state.cables.find((c) => c.id === end.cableId)?.ends[end.endId];
  return to?.kind === "part" && to.instanceId === end.instanceId ? to.portId : null;
}
/** Plugged into the planned socket or an equivalent one (a preferred port is a recommendation, not the only fit). */
const endAt = (state: PCBuildState, end: CableExtraEnd) => {
  const actual = actualEndPort(state, end);
  if (!actual) return false;
  if (actual === end.portId) return true;
  const [planned, there] = [portOf(state, end.instanceId, end.portId), portOf(state, end.instanceId, actual)];
  return Boolean(planned && there && sameKind(planned, there));
};
export function simpleCableConnected(state: PCBuildState, key: SimpleCableKey): boolean {
  const spec = cableSpec(key);
  if (!spec) return false;
  return simpleCableEnds(key).every((end) => endAt(state, end));
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
  // A modular cable goes into the power supply first, then into the part; a SATA data cable into the drive, then the board.
  const ends = [...(spec.extra ?? []), { cableId: spec.id, endId: spec.endId, instanceId: spec.instanceId, portId: spec.portId }];
  for (const e of ends) {
    if (endAt(state, e)) continue;
    // A plug in the wrong header comes out before it goes into the right one.
    if (state.cables.find((c) => c.id === e.cableId)?.ends[e.endId]) {
      const off = pc.applyAction(state, { type: "disconnect_cable_end", cableId: e.cableId, endId: e.endId }, pcCatalog);
      if (!off.ok) return { ok: false, reason: "cannotConnect" };
      state = off.state;
    }
    const step = pc.applyAction(state, { type: "connect_cable_end", cableId: e.cableId, endId: e.endId, to: { kind: "part", instanceId: e.instanceId, portId: e.portId } }, pcCatalog);
    if (!step.ok) return { ok: false, reason: "cannotConnect" };
    state = step.state;
  }
  return { ok: true, state };
}

// ---------- Hands-on cables: each end into its own port, the right way round ----------

/** The ends of a lead in the order a learner plugs them: a modular cable's PSU side, a data cable's drive side, then the device end. */
export function simpleCableEnds(key: SimpleCableKey): CableExtraEnd[] {
  const spec = cableSpec(key);
  return [...(spec.extra ?? []), { cableId: spec.id, endId: spec.endId, instanceId: spec.instanceId, portId: spec.portId }];
}
export const simpleEndPlugged = endAt;
/** What a plug of this connector is held and keyed by, for the orientation hint. */
export function simplePlugKeying(connector: string): "latch" | "ramp" | "pin" | "none" {
  if (/atx|eps|pcie|psu_modular|12v|12vhpwr|sata_power|sata_data/.test(connector)) return "latch";
  if (/fan|pump/.test(connector)) return "ramp";
  if (/argb|rgb/.test(connector)) return "pin";
  return "none";
}
type Localized = { en: string; ar: string };
export interface SimplePortChoice { portId: string; label: Localized; connector: string; /** Takes this lead's plug (the planned socket or an equivalent one). */ fits: boolean; occupied: boolean }
const taken = (state: PCBuildState, instanceId: string, portId: string) =>
  state.cables.some((c) => Object.values(c.ends).some((to) => to?.kind === "part" && to.instanceId === instanceId && to.portId === portId));
/**
 * The ports a learner can try one end in: the sockets that really take it (the planned one and every equivalent one:
 * same connector, function and keying) and the look-alikes on the same part (an EPS socket beside a PCIe one, a 12 V
 * RGB header beside a 5 V ARGB one, a CPU fan header beside a case fan header), which the engine refuses.
 */
export function simplePortChoices(state: PCBuildState, end: CableExtraEnd): SimplePortChoice[] {
  const part = state.parts.find((p) => p.instanceId === end.instanceId);
  const entry = pcCatalog.entries.find((e) => e.id === part?.catalogId);
  const right = entry?.ports.find((p) => p.id === end.portId);
  if (!entry || !right) return [];
  const family = (c: string) => (/argb|rgb|fan|pump/.test(c) ? "header" : /atx|eps|pcie|psu_modular|12v|sata_power/.test(c) ? "power" : /sata_data/.test(c) ? "data" : c);
  const fits = (p: PortSpec) => p.id === right.id || sameKind(p, right);
  const related = entry.ports.filter((p) => fits(p) || family(p.connector) === family(right.connector));
  // Every socket that takes the plug is listed; only the look-alikes are capped.
  return [...related.filter(fits), ...related.filter((p) => !fits(p)).slice(0, 8)]
    .map((p) => ({ portId: p.id, label: p.label, connector: p.connector, fits: fits(p), occupied: taken(state, end.instanceId, p.id) }));
}
/** A socket's name for the learner (null when the part has no such socket). */
export const simpleSocketName = (state: PCBuildState, instanceId: string, portId: string) => portOf(state, instanceId, portId)?.label ?? null;
/** The socket to point at for this end: where it sits (when it is in a fitting one), else its planned one, else the first free equivalent. */
export function simpleEndSocket(state: PCBuildState, end: CableExtraEnd): string {
  if (endAt(state, end)) return actualEndPort(state, end)!;
  if (!taken(state, end.instanceId, end.portId)) return end.portId;
  return simplePortChoices(state, end).find((c) => c.fits && !c.occupied)?.portId ?? end.portId;
}

// Recorded forms: `plug:<lead>:<end>@<port>` (the socket actually used), `plug:<lead>:<end>` (older saves: the planned one)
// and `unplug:<lead>:<end>` (one end taken out). Always read through `parseEndStep`.
const END_STEP = /^(.+):(\d+)(?:@([\w.-]+))?$/;
export function parseEndStep(rest: string): { key: SimpleCableKey; index: number; portId: string | null } | null {
  const m = END_STEP.exec(rest);
  return m ? { key: m[1]!, index: Number(m[2]), portId: m[3] ?? null } : null;
}
export const endStep = (kind: "plug" | "unplug", key: SimpleCableKey, index: number, portId?: string): SimpleStep => `${kind}:${key}:${index}${portId ? `@${portId}` : ""}`;

export type SimplePlugBlock = "reversed" | "wrongPort" | "turnOffFirst" | "fitCableParts";
const wrongSocket = (state: PCBuildState, end: CableExtraEnd, portId: string): Localized => {
  const [planned, chosen] = [portOf(state, end.instanceId, end.portId), portOf(state, end.instanceId, portId)];
  return chosen && planned
    ? { en: `${chosen.label.en} is not a socket for this plug. It goes in ${planned.label.en}, or a socket of the same kind.`, ar: `${chosen.label.ar} مو مدخل لهذا الراس. مكانه ${planned.label.ar} أو مدخل من نفس النوع.` }
    : { en: "That socket is not on this part.", ar: "هذا المدخل مو في هذي القطعة." };
};
/**
 * Plugs one end into a socket, turned as the learner holds it. The planned socket and any equivalent free one (same
 * connector, function and keying) take it, the right way round; the engine still checks keying, cable family and occupancy.
 */
export function plugSimpleEnd(state: PCBuildState, key: SimpleCableKey, endIndex: number, portId: string, reversed: boolean): { ok: true; state: PCBuildState } | { ok: false; reason: SimplePlugBlock; message?: Localized } {
  const blocked = simpleCableBlock(state, key);
  if (blocked === "turnOffFirst") return { ok: false, reason: "turnOffFirst" };
  if (blocked) return { ok: false, reason: "fitCableParts" };
  const end = simpleCableEnds(key)[endIndex];
  if (!end) return { ok: false, reason: "wrongPort" };
  const [planned, chosen] = [portOf(state, end.instanceId, end.portId), portOf(state, end.instanceId, portId)];
  if (!planned || !chosen || !(chosen.id === planned.id || sameKind(chosen, planned))) {
    // Look-alike or unknown socket: the engine's own reason when it refuses, else why it is still not this plug's place.
    const tryIt = pc.applyAction(state, { type: "connect_cable_end", cableId: end.cableId, endId: end.endId, to: { kind: "part", instanceId: end.instanceId, portId } }, pcCatalog);
    return { ok: false, reason: "wrongPort", message: tryIt.ok ? wrongSocket(state, end, portId) : tryIt.rejection.message };
  }
  if (reversed && simplePlugKeying(planned.connector) !== "none") return { ok: false, reason: "reversed" };
  if (simpleEndPlugged(state, end)) return { ok: true, state };
  // A plug sitting in a wrong header comes out before it goes into the right one.
  if (state.cables.find((c) => c.id === end.cableId)?.ends[end.endId]) {
    const off = pc.applyAction(state, { type: "disconnect_cable_end", cableId: end.cableId, endId: end.endId }, pcCatalog);
    if (!off.ok) return { ok: false, reason: "wrongPort", message: off.rejection.message };
    state = off.state;
  }
  const r = pc.applyAction(state, { type: "connect_cable_end", cableId: end.cableId, endId: end.endId, to: { kind: "part", instanceId: end.instanceId, portId } }, pcCatalog);
  return r.ok ? { ok: true, state: r.state } : { ok: false, reason: "wrongPort", message: r.rejection.message };
}

/** Takes one end of a lead out; every other end stays where it is. The PC must be off. */
export function unplugSimpleEnd(state: PCBuildState, key: SimpleCableKey, endIndex: number): { ok: true; state: PCBuildState } | { ok: false; reason: "turnOffFirst" | "notPlugged" } {
  if (state.power.pressed) return { ok: false, reason: "turnOffFirst" };
  const end = simpleCableEnds(key)[endIndex];
  if (!end || !actualEndPort(state, end)) return { ok: false, reason: "notPlugged" };
  const off = pc.applyAction(state, { type: "disconnect_cable_end", cableId: end.cableId, endId: end.endId }, pcCatalog);
  return off.ok ? { ok: true, state: off.state } : { ok: false, reason: "notPlugged" };
}

export function disconnectSimpleCable(state: PCBuildState, key: SimpleCableKey): { ok: true; state: PCBuildState } | { ok: false; reason: SimpleCableBlock } {
  if (state.power.pressed) return { ok: false, reason: "turnOffFirst" };
  if (!simpleCableConnected(state, key)) return { ok: true, state };
  const spec = cableSpec(key);
  // The device end comes off; the other end (a modular cable's PSU side, a SATA cable's drive side) stays in.
  const step = pc.applyAction(state, { type: "disconnect_cable_end", cableId: spec.id, endId: spec.endId }, pcCatalog);
  if (!step.ok) return { ok: false, reason: "cannotConnect" };
  state = step.state;
  return { ok: true, state };
}

/** Only mains/PSU switches remain automatic; internal leads must be connected by the learner. */
export function startSimplePC(state: PCBuildState, opts: { evenIfIncomplete?: boolean } = {}): { ok: boolean; state: PCBuildState; startup: StartupResult; rule: SimpleRule | null } {
  // "Find the fault" presses power on whatever is there: a half-seated module must show as a failed POST.
  if (!opts.evenIfIncomplete && !simpleAllPartsIn(state)) return { ok: false, state, startup: pc.evaluateStartup(state, pcCatalog), rule: null };
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

/** Applies one recorded step; throws when it cannot be taken (an invalid save). */
export function applySimpleStep(state: PCBuildState, step: SimpleStep): PCBuildState {
  const colon = step.indexOf(":");
  const kind = step.slice(0, colon);
  const rest = step.slice(colon + 1);
  const result = kind === "part" ? installSimplePart(state, rest)
    : kind === "cable" ? connectSimpleCable(state, rest)
    : kind === "lower" ? (() => {
      const pose = loweredPose(step);
      const key = rest.split(":")[0]!;
      // A module lowered by hand rests in the slot it was held over; pressing it home is its own step.
      if (pose && isRamKey(key)) return lowerSimpleRam(state, key, { rotationDeg: pose.rotationDeg, offsetMm: pose.offsetMm });
      return lowerSimplePart(state, key, pose ? { rotationDeg: pose.rotationDeg, offsetMm: pose.offsetMm, ...(pose.tiltDeg === undefined ? {} : { tiltDeg: pose.tiltDeg }), ...(pose.slotId ? { slotId: pose.slotId } : {}) } : ALIGNED);
    })()
    : kind === "seat" ? reseatSimplePart(state, rest)
    : kind === "lift" ? (rest.endsWith(":rad") ? liftSimplePart(state, rest.slice(0, -":rad".length), "radiator") : liftSimplePart(state, rest))
    : kind === "fasten" ? fastenSimplePart(state, rest)
    : kind === "unfasten" ? unfastenSimplePart(state, rest)
    : kind === "plug" || kind === "unplug" ? (() => {
      const e = parseEndStep(rest);
      const end = e && simpleCableEnds(e.key)[e.index];
      if (!e || !end) return null;
      return kind === "unplug" ? unplugSimpleEnd(state, e.key, e.index) : plugSimpleEnd(state, e.key, e.index, e.portId ?? end.portId, false);
    })()
    : kind === "prep" ? (() => { const [k, prep, value] = rest.split(":"); return prepSimplePart(state, k!, prep as PrepKind, value ?? ""); })()
    : kind === "place" ? placeSimplePart(state, rest.split("@")[0]!, rest.split("@")[1])
    : kind === "unscrew" ? unscrewSimplePart(state, rest)
    : kind === "screw" ? screwSimplePart(state, rest.slice(0, rest.lastIndexOf(":")))
    : kind === "mech" ? setSimpleMechanism(state, rest.slice(0, rest.lastIndexOf(":")), rest.slice(rest.lastIndexOf(":") + 1) as "open" | "closed")
    : kind === "hw" ? (() => { const [who, hwKey, value] = rest.split(":"); return setSimpleHardware(state, who!, hwKey!, value ?? ""); })()
    : kind === "rad" ? placeRadiator(state, rest, true)
    : kind === "fans" ? clearRadiatorFans(state, rest)
    : kind === "radscrew" ? (() => { const i = rest.lastIndexOf(":"); return setRadiatorScrews(state, rest.slice(0, i), Number(rest.slice(i + 1))); })()
    : null;
  if (!result?.ok) throw new Error(`Invalid simple step ${step}`);
  return result.state;
}

export function simpleBuildFromSnapshot(snapshot: SimpleSnapshot): PCBuildState {
  let state = createSimpleBuild();
  for (const step of snapshot.history) state = applySimpleStep(state, step);
  return snapshot.powered ? startSimplePC(state).state : state;
}

/** Parts in and leads connected, from the steps (a lifted part is out again). */
export function deriveSimpleLists(history: readonly SimpleStep[]): { placed: SimplePartKey[]; connected: SimpleCableKey[] } {
  const placed: SimplePartKey[] = [];
  const connected: SimpleCableKey[] = [];
  const plugged = new Map<SimpleCableKey, Set<number>>();
  for (const step of history) {
    const kind = step.slice(0, step.indexOf(":"));
    const key = kind === "lower" ? step.slice(step.indexOf(":") + 1).split(":")[0]! : kind === "place" ? step.slice(step.indexOf(":") + 1).split("@")[0]! : step.slice(step.indexOf(":") + 1);
    if ((kind === "part" || kind === "lower" || kind === "place") && !placed.includes(key)) placed.push(key);
    // A lift of the radiator alone (`lift:aio:rad`) leaves the cooler's block where it is.
    if (kind === "lift" && !step.endsWith(":rad") && placed.includes(key)) placed.splice(placed.indexOf(key), 1);
    if (kind === "cable" && !connected.includes(key)) { connected.push(key); if (cableSpec(key)) plugged.set(key, new Set(simpleCableEnds(key).keys())); }
    if (kind === "plug" || kind === "unplug") {
      // An end is in from its plug step until its unplug step; a lead is connected while every end is in.
      const e = parseEndStep(step.slice(step.indexOf(":") + 1));
      const total = e && cableSpec(e.key) ? simpleCableEnds(e.key).length : 0;
      if (!e || !total) continue;
      const ends = plugged.get(e.key) ?? new Set<number>();
      if (kind === "plug") ends.add(e.index); else ends.delete(e.index);
      plugged.set(e.key, ends);
      const whole = ends.size >= total;
      if (whole && !connected.includes(e.key)) connected.push(e.key);
      if (!whole && connected.includes(e.key)) connected.splice(connected.indexOf(e.key), 1);
    }
  }
  return { placed, connected };
}
const withStep = (snapshot: SimpleSnapshot, step: SimpleStep): SimpleSnapshot => {
  const history = [...snapshot.history, step];
  return { ...snapshot, history, ...deriveSimpleLists(history) };
};
export const withSimpleStep = withStep;
export const withMechanism = (snapshot: SimpleSnapshot, retentionId: string, state: "open" | "closed") => withStep(snapshot, `mech:${retentionId}:${state}`);
export const withLower = (snapshot: SimpleSnapshot, key: SimplePartKey, pose?: SimpleAlignment) =>
  withStep(snapshot, pose ? `lower:${key}:${pose.rotationDeg}:${pose.offsetMm[0]}:${pose.offsetMm[1]}${pose.tiltDeg === undefined ? "" : `:t${pose.tiltDeg}`}${pose.slotId ? `:s${pose.slotId}` : ""}` : `lower:${key}`);
/** The pose a lowered part was held in just before (from its `lower:` step), or null when not recorded. */
export function loweredPose(step: string): SimpleHeld | null {
  // An M.2 drive's step also says its tilt and the slot chosen: `…:t25:sm2-3`.
  const m = /^lower:([a-z0-9]+):(0|90|180|270):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)(?::t(\d{1,2}))?(?::s(m2-\d))?$/.exec(step);
  if (!m) return null;
  return { key: m[1]!, rotationDeg: Number(m[2]), offsetMm: [Number(m[3]), Number(m[4])], ...(m[5] === undefined ? {} : { tiltDeg: Number(m[5]) }), ...(m[6] ? { slotId: m[6] } : {}) };
}
export const withSeat = (snapshot: SimpleSnapshot, key: SimplePartKey) => withStep(snapshot, `seat:${key}`);
export const withLift = (snapshot: SimpleSnapshot, key: SimplePartKey) => withStep(snapshot, `lift:${key}`);
export const withFasten = (snapshot: SimpleSnapshot, key: SimplePartKey) => withStep(snapshot, `fasten:${key}`);
export const withUnfasten = (snapshot: SimpleSnapshot, key: SimplePartKey) => withStep(snapshot, `unfasten:${key}`);
export const withPrep = (snapshot: SimpleSnapshot, key: SimplePartKey, prep: PrepKind, value: string) => withStep(snapshot, `prep:${key}:${prep}:${value}`);
export const withPlace = (snapshot: SimpleSnapshot, key: SimplePartKey, positionId?: string) => withStep(snapshot, positionId ? `place:${key}@${positionId}` : `place:${key}`);
export const withUnscrew = (snapshot: SimpleSnapshot, key: SimplePartKey) => withStep(snapshot, `unscrew:${key}`);
export const withScrew = (snapshot: SimpleSnapshot, key: SimplePartKey, corner: number) => withStep(snapshot, `screw:${key}:${corner}`);

// ---------- Learner steps on a snapshot ----------

/** The whole fitting as one step (parts without a mechanism; tests and older saves for the others). */
export const withPart = (snapshot: SimpleSnapshot, key: SimplePartKey): SimpleSnapshot =>
  snapshot.placed.includes(key) ? snapshot : withStep(snapshot, `part:${key}`);

export const withCable = (snapshot: SimpleSnapshot, key: SimpleCableKey): SimpleSnapshot =>
  snapshot.connected.includes(key) ? snapshot : withStep(snapshot, `cable:${key}`);

const withHistory = (snapshot: SimpleSnapshot, history: SimpleStep[]): SimpleSnapshot => ({ ...snapshot, history, ...deriveSimpleLists(history) });

/** Whole-lead removal for older flows and tests: every step of that lead leaves the history. */
export const withoutCable = (snapshot: SimpleSnapshot, key: SimpleCableKey): SimpleSnapshot => {
  const ofLead = (step: string) => step === `cable:${key}` || (/^(un)?plug:/.test(step) && parseEndStep(step.slice(step.indexOf(":") + 1))?.key === key);
  return withHistory(snapshot, snapshot.history.filter((step) => !ofLead(step)));
};
/** One end plugged into the socket it actually went in, or taken out again. */
export const withPlug = (snapshot: SimpleSnapshot, key: SimpleCableKey, endIndex: number, portId?: string) => withStep(snapshot, endStep("plug", key, endIndex, portId));
export const withUnplug = (snapshot: SimpleSnapshot, key: SimpleCableKey, endIndex: number) => withStep(snapshot, endStep("unplug", key, endIndex));

/** Takes a cooler back out (`simpleRemoveBlock` must allow it): its step leaves the history. */
export const withoutPart = (snapshot: SimpleSnapshot, key: SimplePartKey): SimpleSnapshot =>
  withHistory(snapshot, snapshot.history.filter((step) => step !== `part:${key}`));

/**
 * Puts `to` in place of `from`, the part of the same slot (`simpleSwapBlock` must allow it). A CPU
 * takes the other CPU's step where it was, so the board still had a CPU before it went into the
 * case; a cooler leaves its step and the new one is fitted now.
 */
export function withSwap(snapshot: SimpleSnapshot, from: SimplePartKey, to: SimplePartKey): SimpleSnapshot {
  if (slotOf(from) !== "cpu") return withPart(withoutPart(snapshot, from), to);
  const swap = (item: SimpleStep) => (item === `part:${from}` ? `part:${to}` : item === `lower:${from}` || item.startsWith(`lower:${from}:`) ? `lower:${to}` : item) as SimpleStep;
  return withHistory(snapshot, snapshot.history.map(swap));
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
  const history = snapshot.history.slice(0, -1);
  return { ...snapshot, history, ...deriveSimpleLists(history) };
}

// ---------- Saved progress ----------

const isPartKey = (k: unknown): k is SimplePartKey => ALL_SIMPLE_PARTS.some((p) => p.key === k);
const isCableKey = (k: unknown): k is SimpleCableKey => ALL_SIMPLE_CABLES.some((c) => c.key === k);
const isStep = (step: unknown): step is SimpleStep => {
  if (typeof step !== "string") return false;
  const colon = step.indexOf(":");
  const kind = step.slice(0, colon);
  const rest = step.slice(colon + 1);
  if (kind === "cable") return isCableKey(rest);
  if (kind === "lower") return isPartKey(rest) || Boolean(loweredPose(step) && isPartKey((rest as string).split(":")[0]));
  if (kind === "part" || kind === "seat" || kind === "fasten" || kind === "unfasten" || kind === "unscrew" || kind === "rad" || kind === "fans") return isPartKey(rest);
  if (kind === "place") { const [key, position, extra] = rest.split("@"); return isPartKey(key) && extra === undefined && (position === undefined || /^[a-z0-9-]+$/.test(position)); }
  if (kind === "lift") { const base = rest.split(":")[0]; return isPartKey(rest) || (/^[a-z0-9]+:rad$/.test(rest) && isPartKey(base)); }
  if (kind === "hw") { const m = /^([a-z0-9]+):([a-z_]+):([a-z0-9]*)$/.exec(rest); return Boolean(m && isPartKey(m[1])); }
  if (kind === "radscrew") { const m = /^([a-z0-9]+):(\d{1,2})$/.exec(rest); return Boolean(m && isPartKey(m[1])); }
  if (kind === "plug" || kind === "unplug") {
    const end = parseEndStep(rest);
    return Boolean(end && isCableKey(end.key) && Number.isSafeInteger(end.index) && end.index < simpleCableEnds(end.key).length && (kind === "plug" || end.portId === null));
  }
  if (kind === "prep") { const m = /^([a-z0-9]+):(paste|film|standoffs|io_shield|psu_fan|airflow|backplate):([a-z]*)$/.exec(rest); return Boolean(m && isPartKey(m[1])); }
  if (kind === "screw") { const m = /^([a-z0-9]+):(\d{1,2})$/.exec(rest); return Boolean(m && isPartKey(m[1])); }
  return kind === "mech" && /^[a-z0-9-]+(:lever|:near|:stand|:screws|:film|:\d)?:(open|closed)$/.test(rest);
};

/**
 * Saves from before the Intel lever became its own step said `mech:cpu-socket-plate:open|closed` for
 * lever and plate together. They are read as the two steps they stood for, in the real order.
 */
export function migrateLeverSteps(history: readonly string[]): string[] {
  if (history.some((st) => st.includes(":lever:"))) return [...history];
  return history.flatMap((st) => {
    const m = /^mech:(cpu-socket-plate):(open|closed)$/.exec(st);
    if (!m) return [st];
    return m[2] === "open" ? [`mech:${m[1]}:lever:open`, st] : [st, `mech:${m[1]}:lever:closed`];
  });
}

/**
 * Saves from before M.2 heatsinks, screw stands and the insertion angle: the drive's steps are read as
 * what they stood for on that board. The heatsink over the slot is taken off before the first step
 * there and put back once the drive is held; an old lowering (which also pressed the drive flat) is
 * an angled insertion and a press; a Q-Latch step on a screw-held slot is its stand and screw.
 * Newer saves (any heatsink, stand or tilt step) are left as they are.
 */
export function migrateM2Steps(history: readonly string[]): string[] {
  const keyOf = (st: string) => st.slice(st.indexOf(":") + 1).split(":")[0]!;
  const driveStep = (st: string) => /^(lower|seat|lift):/.test(st) && isPartKey(keyOf(st)) && isM2Key(keyOf(st));
  const qlatch = (st: string) => /^mech:(m2-\d)-qlatch:(open|closed)$/.exec(st);
  if (!history.some((st) => qlatch(st) || driveStep(st))) return [...history];
  if (history.some((st) => /:(stand|screws|film):(open|closed)$/.test(st) || /^lower:[a-z0-9]+:.*:t\d+/.test(st))) return [...history];
  const out: string[] = [];
  let state = createSimpleBuild();
  const push = (st: string) => { state = applySimpleStep(state, st as SimpleStep); out.push(st); };
  const mechs = (list: [string, "open" | "closed"][]) => { for (const [id, st] of list) push(`mech:${id}:${st}`); };
  const slotOfKey = (key: SimplePartKey) => simpleTarget(state, key).mountPointId;
  try {
    for (const st of history) {
      const q = qlatch(st);
      const slotId = q ? q[1]! : driveStep(st) ? slotOfKey(keyOf(st)) : null;
      if (!slotId) { push(st); continue; }
      mechs(m2HeatsinkOff(state, slotId));
      const screwHeld = state.parts.some((p) => pcCatalog.entries.find((e) => e.id === p.catalogId)?.mountPoints.some((m) => m.id === slotId && m.retention?.kind === "m2_screw"));
      if (q && screwHeld) {
        const standIn = state.parts.some((p) => p.mechanisms?.[`${slotId}-screw:stand`] === "closed");
        if (q[2] === "open") { if (!standIn) push(`mech:${slotId}-screw:stand:closed`); }
        else { push(`mech:${slotId}-screw:closed`); mechs(m2HeatsinkOn(state, slotId)); }
        continue;
      }
      if (st.startsWith("lower:")) {
        const pose = loweredPose(st);
        push(`lower:${keyOf(st)}:${pose?.rotationDeg ?? 0}:${pose?.offsetMm[0] ?? 0}:${pose?.offsetMm[1] ?? 0}:t${M2_WHOLE_TILT_DEG}:s${slotId}`);
        push(`seat:${keyOf(st)}`);
        continue;
      }
      push(st);
      if (q?.[2] === "closed") mechs(m2HeatsinkOn(state, slotId));
    }
  } catch { return [...history]; }
  return out;
}

export function parseSimpleSnapshot(value: unknown): SimpleSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  // A planned build's progress only parses while that build's model is on the page (the caller activates it).
  if (data.version === 4 && active.kind !== "plan") return null;
  if (data.version !== 4 && active.kind !== "legacy") return null;
  if ((data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4) || !Array.isArray(data.placed) || typeof data.powered !== "boolean" || new Set(data.placed).size !== data.placed.length || !data.placed.every(isPartKey)) return null;
  const connected = data.version === 1 ? (data.powered ? SIMPLE_CABLES.map((c) => c.key) : []) : data.connected;
  if (!Array.isArray(connected) || new Set(connected).size !== connected.length || !connected.every(isCableKey)) return null;
  let placed = [...data.placed] as SimplePartKey[];
  // Saved before the second stick existed: the board was prepared with one. Fit the second one
  // right after the first, so the build the learner had is still complete.
  if (data.version !== 3 && data.version !== 4 && placed.includes("ram") && !placed.includes("ram2")) placed.splice(placed.indexOf("ram") + 1, 0, "ram2");
  let history: SimpleStep[];
  if (data.version === 3 || data.version === 4) {
    if (!Array.isArray(data.history) || data.history.length > 400 || !data.history.every(isStep)) return null;
    history = migrateCoolerSteps(migrateM2Steps(migrateLeverSteps(data.history as string[]))) as SimpleStep[];
    // The lists must say what the steps say.
    const derived = deriveSimpleLists(history);
    const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (!same(derived.placed, placed) || !same(derived.connected, connected as string[])) return null;
    placed = derived.placed;
  } else {
    history = [...placed.map((k): SimpleStep => `part:${k}`), ...(connected as SimpleCableKey[]).map((k): SimpleStep => `cable:${k}`)];
  }
  const cables = data.version === 3 || data.version === 4 ? deriveSimpleLists(history).connected : ([...connected] as SimpleCableKey[]);
  const held = parseHeld(data.held);
  const migrated: SimpleSnapshot = data.version === 4
    ? { version: 4, plan: active.plan, placed, connected: cables, history, powered: data.powered, ...(held ? { held } : {}) }
    : { version: 3, placed, connected: cables, history, powered: data.powered, ...(held ? { held } : {}) };
  try {
    const state = simpleBuildFromSnapshot(migrated);
    if (migrated.powered && (pc.evaluateStartup(state, pcCatalog).outcome !== "operational" || simpleRuleBlock(state))) return null;
    // Every prefix of the history must have been a valid build, so undoing never meets an impossible state.
    let replay = createSimpleBuild();
    for (const step of history) replay = applySimpleStep(replay, step);
    return migrated;
  } catch { return null; }
}
