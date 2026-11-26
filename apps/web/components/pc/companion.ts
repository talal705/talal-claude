// What the build companion says, decided from the real build state and the learner's last action.
// Pure and deterministic: the page translates each line (`companion.*` messages) and shows it in the
// robot's speech bubble. Nothing here is a model's answer; free questions go to the AI tutor only
// when the server has one configured.
import type { PCBuildState } from "@ytl/contracts";
import { pcCatalog } from "./catalog";
import {
  ALL_SIMPLE_CABLES, ALL_SIMPLE_PARTS, hasModelledMounting, isPositionKey, isRamKey, partSpec, SIMPLE_PARTS, simpleAllPartsIn, simpleAssemblyComplete, simpleBlock, simpleCableBlock, simpleCableConnected, simpleCableMissingParts,
  simpleCablesFor, simpleCableOrder, simplePartInstalled, simplePartOrder, simplePrerequisites, simpleRuleBlock, REMOVABLE, simpleRamRecommended, simpleSlotFilled, simpleSlotPart, simpleTarget, slotOf,
  caseCoversClosed, isM2Key, simpleM2Slots, simpleRamSlots, simpleRamTargetFor, simpleRetention,
  type SimpleBlock, type SimpleCableBlock, type SimpleCableKey, type SimpleHeld, type SimplePartKey, type SimpleRemoveBlock, type SimpleRule, type SimpleStep,
} from "./simple-model";
import { attachmentOf, nextHandStep } from "./click-assembly";
import { nextCoolerStep, nextMountingRemoval, simpleCoolerProgress, type CoolerStep, type MountingStep } from "./cooler-assembly";

export type Selection = { kind: "part"; key: SimplePartKey } | { kind: "cable"; key: SimpleCableKey } | null;
export type CompanionMood = "idle" | "wave" | "point" | "happy" | "concerned" | "thinking" | "celebrate";
/**
 * One sentence of the bubble: a message key under `companion`, and its values. A value written
 * `{ part: key }`, `{ cable: key }`, `{ place: id }` or `{ parts: keys }` is a name the page translates.
 */
export type CompanionValue = string | number | { part: SimplePartKey } | { cable: SimpleCableKey } | { place: string } | { parts: SimplePartKey[] };
export interface CompanionLine { key: string; values?: Record<string, CompanionValue> }
export interface CompanionSay {
  lines: CompanionLine[];
  mood: CompanionMood;
  /** What the robot points at, if anything: the 3D view (a highlighted place), or a control. */
  point?: "scene" | "power" | "parts" | "cables";
}

export type NextAction =
  | { kind: "part"; key: SimplePartKey }
  | { kind: "cable"; key: SimpleCableKey }
  | { kind: "power" }
  | { kind: "swapCooler" }
  | { kind: "turnOff" }
  | { kind: "done" };

export type CompanionEvent =
  | { type: "start" }
  /** After a reload: `held` is the part saved in hand with its pose, if any. */
  | { type: "resume"; held?: SimpleHeld | null }
  | { type: "select"; selection: Exclude<Selection, null> }
  | { type: "installed"; key: SimplePartKey }
  | { type: "connected"; key: SimpleCableKey }
  | { type: "unplugged"; key: SimpleCableKey }
  | { type: "wrongPlace"; key: SimplePartKey; place: string }
  | { type: "wrongPort"; key: SimpleCableKey; portOf: SimpleCableKey | null }
  | { type: "notSelectable" }
  | { type: "missedTarget" }
  | { type: "cancel" }
  | { type: "undo"; step: SimpleStep }
  | { type: "nothingToUndo" }
  | { type: "restart" }
  | { type: "powerFail"; missingCable: SimpleCableKey | null; rule?: SimpleRule | null }
  | { type: "removed"; key: SimplePartKey }
  | { type: "swapped"; from: SimplePartKey; key: SimplePartKey }
  | { type: "removeBlocked"; key: SimplePartKey; reason: SimpleRemoveBlock }
  | { type: "powerOn" }
  | { type: "powerOff" }
  | { type: "ask"; intent: "next" | "help" | "explain" }
  | { type: "question"; text: string };

/**
 * The order a builder would follow; the learner may take another valid order. With the air cooler it
 * goes on the board on the bench; with the Core i9 (or once the liquid cooler is chosen) the board
 * goes into the case first and the liquid cooler follows, its radiator in the top of the case.
 */
function partOrder(state: PCBuildState): SimplePartKey[] {
  return simplePartOrder(state);
}

export const partName = (key: SimplePartKey): { part: SimplePartKey } => ({ part: key });

/** What the learner should do next, from the build alone. */
export function nextAction(state: PCBuildState, powered: boolean): NextAction {
  if (powered) return simpleAssemblyComplete(state) ? { kind: "done" } : { kind: "turnOff" };
  const order = partOrder(state);
  const open = (key: SimplePartKey) => !simpleSlotFilled(state, slotOf(key));
  const part = order.find((key) => open(key) && !simpleBlock(state, key));
  if (part) return { kind: "part", key: part };
  const blockedPart = order.find(open);
  if (blockedPart) return { kind: "part", key: blockedPart };
  const leads = new Set(simpleCablesFor(state).map((c) => c.key));
  const cable = simpleCableOrder().find((key) => leads.has(key) && !simpleCableConnected(state, key) && !simpleCableBlock(state, key));
  if (cable) return { kind: "cable", key: cable };
  return simpleRuleBlock(state) ? { kind: "swapCooler" } : { kind: "power" };
}

const RAM_IN = (state: PCBuildState) => SIMPLE_PARTS.filter((p) => isRamKey(p.key) && simplePartInstalled(state, p.key)).length;

/** The sentence that says what to do next. */
export function nextLine(state: PCBuildState, powered: boolean): CompanionLine {
  const next = nextAction(state, powered);
  if (next.kind === "part") {
    if (isRamKey(next.key)) return { key: RAM_IN(state) === 1 ? "next.ramSecond" : "next.ram" };
    return { key: `next.${partTopic(next.key)}` };
  }
  if (next.kind === "cable") {
    const first = simpleCablesFor(state).every((c) => !simpleCableConnected(state, c.key));
    return { key: first ? "next.firstCable" : "next.cable", values: { cable: { cable: next.key } } };
  }
  return { key: `next.${next.kind}` };
}

function pointFor(next: NextAction): CompanionSay["point"] {
  return next.kind === "part" ? "scene" : next.kind === "cable" ? "cables" : next.kind === "swapCooler" ? "parts" : next.kind === "power" || next.kind === "turnOff" ? "power" : undefined;
}

/** A memory line with the manual's recommendation, or its no-recommendation form when the manual gives none. */
const ramLine = (state: PCBuildState, kind: "help" | "explain"): CompanionLine => {
  const rec = ramRecommendation(state);
  return rec ? { key: `${kind}.ram`, values: { rec } } : { key: `${kind}.ramNoRec` };
};

/** The board manual's recommended slots for two modules (the build's kit), by their printed labels. */
export function ramRecommendation(state: PCBuildState): string {
  const host = state.parts.find((p) => p.instanceId === ALL_SIMPLE_PARTS.find((x) => isRamKey(x.key))?.host);
  const entry = host ? pcCatalog.entries.find((e) => e.id === host.catalogId) : undefined;
  const ids = simpleRamRecommended(state, 2);
  // The silkscreen name (DIMM_A2), the same in either language.
  return ids.map((id) => entry?.mountPoints.find((m) => m.id === id)?.label.en.match(/DIMM_[A-Z0-9]+/)?.[0] ?? id).join(" + ");
}

/** The place a selected part goes, for the bubble: a mount ID the page names (`places.*`). */
export function placeOf(state: PCBuildState, key: SimplePartKey): string {
  return simpleTarget(state, key).mountPointId;
}

function blockLine(state: PCBuildState, key: SimplePartKey, reason: SimpleBlock): CompanionLine {
  if (reason === "socketTaken" || reason === "coolerTaken") {
    const other = simpleSlotPart(state, slotOf(key));
    return { key: `blocked.${reason}`, values: { part: partName(key), other: partName(other ?? key) } };
  }
  if (reason === "prepareBoard") {
    const missing = simplePrerequisites(key).filter((k) => !simpleSlotFilled(state, slotOf(k)));
    return { key: "blocked.prepareBoard", values: { parts: { parts: missing } } };
  }
  return { key: `blocked.${reason}`, values: { part: partName(key) } };
}

function cableBlockLine(key: SimpleCableKey, reason: SimpleCableBlock, state: PCBuildState): CompanionLine {
  if (reason === "fitCableParts") return { key: "blocked.cableParts", values: { cable: { cable: key }, parts: { parts: simpleCableMissingParts(state, key) } } };
  return { key: reason === "turnOffFirst" ? "blocked.turnOff" : "blocked.cannotConnect" };
}

/** Lines that explain why the current (or selected) step matters. */
const cableTopic = (key: SimpleCableKey) =>
  key.startsWith("caseFan") ? "caseFan" : key.startsWith("sata") ? "sata" : key.startsWith("argb") ? "argb" : key.replace(/\d+$/, "");
/** The message topic of a part key: a second drive or an added fan speaks like the first. */
const partTopic = (key: SimplePartKey) => (isRamKey(key) ? "ram" : /^storage\d+$/.test(key) ? "storage" : /^fan\d+$/.test(key) ? "fan" : key);
function explainLines(state: PCBuildState, powered: boolean, selection: Selection): CompanionLine[] {
  if (selection?.kind === "part") return [isRamKey(selection.key) ? ramLine(state, "explain") : { key: `explain.${partTopic(selection.key)}` }];
  if (selection?.kind === "cable") return [{ key: `explain.${cableTopic(selection.key)}` }];
  const next = nextAction(state, powered);
  if (next.kind === "part") return [isRamKey(next.key) ? ramLine(state, "explain") : { key: `explain.${partTopic(next.key)}` }];
  if (next.kind === "cable") return [{ key: `explain.${cableTopic(next.key)}` }];
  if (next.kind === "swapCooler") return [{ key: "explain.liquidRule" }];
  return [{ key: next.kind === "done" ? "explain.done" : "explain.power" }];
}

/** Help with what is in hand: the selection's place, or why it cannot go in yet; else the next step. */
function helpLines(state: PCBuildState, powered: boolean, selection: Selection): CompanionSay {
  if (selection?.kind === "part") {
    if (simplePartInstalled(state, selection.key)) return { lines: [{ key: "already", values: { part: partName(selection.key) } }, nextLine(state, powered)], mood: "idle" };
    const blocked = simpleBlock(state, selection.key);
    if (blocked) return { lines: [blockLine(state, selection.key, blocked)], mood: "thinking" };
    // A memory module: no glowing default slot; how to choose one, and what the manual recommends.
    if (isRamKey(selection.key)) return { lines: [ramLine(state, "help")], mood: "point", point: "scene" };
    if (isPositionKey(selection.key)) return { lines: [{ key: "hands.pickPosition", values: { part: partName(selection.key) } }], mood: "point", point: "scene" };
    return { lines: [{ key: "help.part", values: { part: partName(selection.key), place: { place: placeOf(state, selection.key) } } }], mood: "point", point: "scene" };
  }
  if (selection?.kind === "cable") {
    const blocked = simpleCableBlock(state, selection.key);
    if (blocked) return { lines: [cableBlockLine(selection.key, blocked, state)], mood: "thinking" };
    return { lines: [{ key: "help.cable", values: { cable: { cable: selection.key } } }], mood: "point", point: "scene" };
  }
  const next = nextAction(state, powered);
  return { lines: [{ key: "help.general" }, nextLine(state, powered)], mood: "point", point: pointFor(next) };
}

/**
 * Recognises the three quick questions in a typed message, in English or Arabic. Anything else is a
 * free question: answered by the AI tutor when the server has one, otherwise the robot says so.
 */
/**
 * What the robot says after an undo, from the kind of step that was taken back. Every step kind in the
 * history has its own line; anything unknown gets a plain "undone" (never a raw key).
 */
export function undoLine(step: string): CompanionLine {
  const colon = step.indexOf(":");
  const kind = step.slice(0, colon);
  const rest = step.slice(colon + 1);
  const key = rest.split(/[:@]/)[0] ?? "";
  const part = () => (ALL_SIMPLE_PARTS.some((p) => p.key === key) ? { part: partName(key as SimplePartKey) } : null);
  const cable = (k: string) => (ALL_SIMPLE_CABLES.some((c) => c.key === k) ? { cable: { cable: k as SimpleCableKey } } : null);
  const withPart = (line: string) => { const v = part(); return v ? { key: `undo.${line}`, values: v } : { key: "undo.step" }; };
  switch (kind) {
    case "part": return withPart("part");
    case "cable": { const v = cable(rest); return v ? { key: "undo.cable", values: v } : { key: "undo.step" }; }
    case "plug": { const v = cable(rest.slice(0, rest.lastIndexOf(":"))); return v ? { key: "undo.plug", values: v } : { key: "undo.step" }; }
    case "lower": return withPart("lower");
    case "seat": return withPart("seat");
    case "lift": return withPart("lift");
    case "place": return withPart("place");
    case "screw": return withPart("screw");
    case "unscrew": return withPart("unscrew");
    case "fasten": return withPart("fasten");
    case "unfasten": return withPart("unfasten");
    case "prep": return withPart("prep");
    case "mech": {
      const id = rest.slice(0, rest.lastIndexOf(":"));
      if (id.endsWith(":lever") || id === "cpu-socket-lever") return { key: "undo.lever" };
      if (id === "cpu-socket-plate") return { key: "undo.plate" };
      if (id.startsWith("slot-covers")) return { key: "undo.covers" };
      return { key: "undo.latch" };
    }
    default: return { key: "undo.step" };
  }
}

export function intentOf(text: string): "next" | "help" | "explain" | "undo" | null {
  const t = text.toLowerCase().trim();
  if (/\b(undo|go back)\b|تراجع|ارجع/.test(t)) return "undo";
  if (/\b(why|explain|what is|what's|what does)\b|ليش|لماذا|اشرح|وش فايدة|ايش فايدة|وش هو|ما هو/.test(t)) return "explain";
  if (/\b(next|now what|what do i do|what should i)\b|التالي|الخطوة|وش اسوي|ايش اسوي|بعدين|الحين وش/.test(t)) return "next";
  if (/\b(help|stuck|how|where|can'?t|cannot)\b|ساعد|مساعدة|كيف|وين|ما اقدر|مو قادر/.test(t)) return "help";
  return null;
}

/**
 * The part or lead a typed question is about, as an `explain.*` key, in English or Arabic; null when
 * it names none. Cables are checked first ("CPU power" is about the lead, not the processor).
 */
export function topicOf(text: string): string | null {
  const t = text.toLowerCase();
  const topics: [string, RegExp][] = [
    ["atx", /24[- ]?pin|\batx\b|motherboard power|طاقة اللوحة/],
    ["cpuPower", /\beps\b|8[- ]?pin cpu|cpu power|طاقة المعالج/],
    ["gpuPower", /pcie power|gpu power|graphics card power|طاقة كرت/],
    ["aioPump", /\bpump\b|aio[_ ]pump|مضخة|المضخة/],
    ["aioFan", /radiator fans?|مراوح الرادياتير/],
    ["cpuFan", /cpu[_ ]fan|cooler fan|مروحة المبرد|مروحة المبرّد/],
    ["powerSwitch", /power (button|switch)|pwr_?sw|f_panel|front panel|زر التشغيل|زر تشغيل/],
    ["caseFan", /case fan|cha[_ ]fan|مراوح الكيس|مروحة الكيس/],
    ["ram", /\bram\b|memory|dimm|\ba2\b|\bb2\b|dual channel|رام|الذاكرة|ذاكرة/],
    ["liquidRule", /\bi9\b|14900|liquid.*(need|requir)|(need|requir).*liquid|يحتاج.*مائي|ليش.*مائي/],
    ["aio", /liquid|\baio\b|radiator|water cool|مائي|رادياتير|الرادياتير/],
    ["cpu", /\bcpu\b|processor|\bsocket\b|المعالج|معالج/],
    ["cooler", /cooler|heatsink|المبرد|المبرّد|مبرد/],
    ["storage", /\bssd\b|m\.?2|storage|\bdrive\b|القرص|قرص|التخزين/],
    ["motherboard", /motherboard|\bboard\b|اللوحة|لوحة/],
    ["gpu", /\bgpu\b|graphics|video card|كرت الشاشة|كرت/],
    ["psu", /\bpsu\b|power supply|الباور|باور|مزود الطاقة/],
  ];
  return topics.find(([, pattern]) => pattern.test(t))?.[0] ?? null;
}

/** A memory slot's silkscreen name (DIMM_B1), the same in either language. */
function ramSlotName(state: PCBuildState, id: string): string {
  return simpleRamSlots(state).find((x) => x.id === id)?.label.en.match(/DIMM_[A-Z0-9]+/)?.[0] ?? id;
}

/**
 * The first physical step a keyed part needs when it is picked up (or found in hand after a reload):
 * the socket's lever or plate, the card slot's covers or latch, or how to bring a module over a slot.
 * Null for a part with no mechanism of its own, or one already in its place.
 */
export function pickupLine(state: PCBuildState, key: SimplePartKey): CompanionLine | null {
  // An M.2 drive: the learner chooses the slot; its heatsink and latch depend on that choice.
  if (isM2Key(key)) return simplePartInstalled(state, key) || state.parts.find((p) => p.instanceId === ALL_SIMPLE_PARTS.find((x) => x.key === key)?.id)?.attachments.length ? null : { key: "hands.m2Pick" };
  const ret = simpleRetention(state, key);
  const inPlace = (state.parts.find((p) => p.instanceId === ALL_SIMPLE_PARTS.find((x) => x.key === key)?.id)?.attachments.length ?? 0) > 0;
  if (!ret || inPlace || simplePartInstalled(state, key)) return null;
  const k = ret.kind === "dimm_latch" ? "ram" : ret.kind === "pcie_latch" ? "gpu" : ret.kind === "m2_qlatch" ? "m2" : "cpu";
  const line = k === "ram" ? "ramPick" : k === "gpu" ? (caseCoversClosed(state) ? "gpuCoversFirst" : ret.open ? "gpuOpen" : "gpuLatchFirst")
    : ret.leverId && ret.leverOpen && !ret.open ? "cpuPlateNext" : ret.open ? `${k}Open` : `${k}OpenFirst`;
  return { key: `hands.${line}` };
}

/**
 * What the part in hand needs next, from where it is held (after a click aims it, or after a reload): a
 * module over a slot names that slot and what it needs (its clip or clips, a turn, lining up, lowering);
 * a CPU, card or drive over its place says to turn it, or that it is ready to go in. Null when the part is
 * not in hand any more (in its place, or with no mechanism of its own).
 */
/**
 * The one line for the next step of fitting a cooler (the same step the toolbar offers): it names the screw,
 * the frame or the position. Null when the cooler is fitted or has no modelled mounting.
 */
export function coolerStepLine(state: PCBuildState, key: SimplePartKey): CompanionLine | null {
  const step = nextCoolerStep(state, key);
  if (!step) return null;
  const spec = partSpec(key);
  const bodyTotal = state.parts.find((p) => p.instanceId === spec.id)?.hardware?.screws?.length ?? 2;
  switch (step.kind) {
    case "cpuFirst": return { key: "cooler.cpuFirst" };
    case "boardFirst": return { key: "cooler.boardFirst" };
    case "backplate": return { key: step.value === "tape" ? "cooler.backplateTape" : "cooler.backplatePadding" };
    case "frameScrew": return { key: step.to === "engaged" ? "cooler.frameScrewEngage" : "cooler.frameScrewTight", values: { n: step.index + 1, total: 4 } };
    case "position": return { key: step.id === "1700" ? "cooler.position1700" : "cooler.position1200" };
    case "pin": return { key: "cooler.pin", values: { n: step.index + 1, total: 4 } };
    case "place": return { key: spec.radiator ? "cooler.placeBlock" : "cooler.place" };
    case "screw": return { key: step.to === "engaged" ? "cooler.screwEngage" : "cooler.screwTight", values: { n: step.index + 1, total: Math.max(bodyTotal, 2) } };
    case "radiatorScrew": return { key: "cooler.radiatorScrew", values: { n: step.count, total: spec.radiator?.screws ?? 8 } };
    case "lever": case "plate": case "ilm": case "frame": case "clean": case "paste": case "film": case "ring": case "vrmFan": case "clearFans": case "radiator": return { key: `cooler.${step.kind}` };
    default: return null;
  }
}
/** The line for one step of taking a cooler off. */
export function coolerRemovalLine(step: CoolerStep, key: SimplePartKey): CompanionLine | null {
  const total = ALL_SIMPLE_PARTS.find((p) => p.key === key)?.radiator?.screws ?? 8;
  switch (step?.kind) {
    case "radiatorUnscrew": return { key: "cooler.unscrewRadiator", values: { n: step.count + 1, total } };
    case "liftRadiator": return { key: "cooler.liftRadiator" };
    case "screw": return { key: step.to === "loosened" ? "cooler.looseScrew" : "cooler.outScrew", values: { n: step.index + 1 } };
    case "liftBody": return { key: "cooler.liftBody" };
    default: return null;
  }
}
/** The line for one optional step of taking the contact frame off and the original ILM back on. */
export function mountingRemovalLine(step: MountingStep): CompanionLine | null {
  switch (step?.kind) {
    case "frameScrew": return { key: step.to === "out" ? "cooler.frameScrewOut" : "cooler.frameScrewLoosen", values: { n: step.index + 1, total: 4 } };
    case "frameOff": return { key: "cooler.frameOff" };
    case "ilmRefit": return { key: "cooler.ilmRefit" };
    default: return null;
  }
}
/**
 * The line for a cooler the learner has started: the removal step while they are taking the frame off
 * (`dismantling`, from `mountingDismantling`), else the next fitting step.
 */
function coolerGuideLine(state: PCBuildState, key: SimplePartKey, dismantling: boolean): CompanionLine | null {
  return (dismantling ? mountingRemovalLine(nextMountingRemoval(state)) : null) ?? coolerStepLine(state, key);
}
/** What the robot says when a cooler is mechanically fitted: wiring is its own stage, so the lead is not connected yet. */
export function coolerDoneLine(state: PCBuildState, key: SimplePartKey): CompanionLine | null {
  const progress = simpleCoolerProgress(state, key);
  return progress.mechanicallyComplete ? { key: progress.connected ? "cooler.done" : "cooler.notWired" } : null;
}
/** A cooler the learner started and has not finished: the board's frame work, or its own preparation or fixing. */
const coolerInProgress = (state: PCBuildState) =>
  ALL_SIMPLE_PARTS.find((p) => /^(cooler|aio)$/.test(p.key) && nextCoolerStep(state, p.key) && (() => {
    const board = state.parts.find((x) => x.instanceId === ALL_SIMPLE_PARTS.find((q) => q.key === "motherboard")?.id);
    const part = state.parts.find((x) => x.instanceId === p.id);
    return Boolean(board?.hardware?.ilm || board?.hardware?.frame || board?.prep?.backplate || part?.hardware || part?.prep?.paste || part?.prep?.film || part?.attachments.length);
  })())?.key ?? null;

/** An M.2 slot's printed name (M.2_1), the same in either language. */
function m2SlotName(state: PCBuildState, key: SimplePartKey, id: string): string {
  return simpleM2Slots(state, key).find((x) => x.id === id)?.label.en.match(/M\.2_\d+/)?.[0] ?? id;
}

/**
 * The one next thing to do with an M.2 drive, from the same step the toolbar offers (so the robot,
 * the button and the welcome back never disagree). Null when the drive and its heatsink are done.
 */
export function m2StepLine(state: PCBuildState, key: SimplePartKey, held: SimpleHeld | null): CompanionLine | null {
  const step = nextHandStep(state, key, held);
  if (!step) return null;
  const at = attachmentOf(state, key);
  const slotId = at?.target.mountPointId ?? (held?.key === key ? held.slotId : undefined);
  const slot = slotId ? { slot: m2SlotName(state, key, slotId) } : null;
  switch (step.kind) {
    case "aim": return { key: "hands.m2Pick" };
    case "slotTaken": return { key: "hands.m2SlotTaken", values: { slot: m2SlotName(state, key, step.slotId) } };
    case "heatsink": return step.step === "screws" && slot ? { key: "hands.m2HsScrewsFirst", values: slot } : { key: ({ screws: "hands.m2HsLiftNext", lift: "hands.m2HsLiftNext", film: "hands.m2FilmNext", fit: "hands.m2FitNext", tighten: "hands.m2TightenNext" } as const)[step.step] };
    case "stand": return { key: "hands.m2StandFirst" };
    case "tilt": return { key: "hands.m2TiltFirst" };
    case "lower": return slot ? { key: "hands.m2Ready", values: slot } : { key: "hands.m2Pick" };
    case "seat": return slot ? { key: "hands.m2PressFlat", values: slot } : null;
    case "mechanism": {
      if (step.desired === "open") return { key: "hands.m2OpenFirst" };
      return { key: simpleRetention(state, key, slotId)?.kind === "m2_screw" ? "hands.m2ScrewNow" : "hands.m2LatchNow" };
    }
    default: return null;
  }
}

export function heldLines(state: PCBuildState, held: SimpleHeld): CompanionLine[] | null {
  // An M.2 drive in hand: the slot it is over, then its one next step there.
  if (isM2Key(held.key)) {
    const line = m2StepLine(state, held.key, held);
    if (!line) return null;
    return held.slotId && line.key !== "hands.m2Pick" ? [{ key: "resume.m2Over", values: { slot: m2SlotName(state, held.key, held.slotId) } }, line] : [line];
  }
  const first = pickupLine(state, held.key);
  if (!first) return null;
  if (isRamKey(held.key)) {
    const target = simpleRamTargetFor(state, held.offsetMm);
    const slot = target && simpleRamSlots(state).find((x) => x.id === target.slotId);
    if (!target || !slot) return [first];
    const name = ramSlotName(state, slot.id);
    if (slot.occupant) return [{ key: "hands.ramSlotTaken", values: { slot: name } }];
    const over: CompanionLine = { key: "resume.ramOver", values: { slot: name } };
    if (!slot.clipOpen || (slot.nearId && !slot.nearOpen)) return [over, { key: slot.nearId ? "hands.ramOpenBoth" : "hands.ramOpenFirst" }];
    if (held.rotationDeg !== 0) return [over, { key: "hands.ramTurn" }];
    // The same tolerance the slot accepts when the module is lowered.
    if (Math.hypot(target.residual[0], target.residual[1]) > 1.5) return [over, { key: "hands.ramCentre" }];
    return [{ key: "resume.ramReady", values: { slot: name } }];
  }
  // Over its place only when a click put it there (exactly centred); a socket or latch still shut comes first.
  const ret = simpleRetention(state, held.key);
  if (!ret?.open || Math.hypot(held.offsetMm[0], held.offsetMm[1]) > 0.05) return [first];
  const k = ret.kind === "pcie_latch" ? "gpu" : ret.kind === "m2_qlatch" ? "m2" : "cpu";
  return [{ key: held.rotationDeg === 0 ? "aim.ready" : `hands.${k}Turn` }];
}

/**
 * After a reload, what the learner left part-way, from the saved build and hand: the module in hand
 * (the slot it is over and what that slot needs next), another keyed part in hand, or a module resting
 * in a slot not yet pressed home. Null when nothing is part-way: the build's next step applies.
 */
function resumeLines(state: PCBuildState, held: SimpleHeld | null, dismantling: boolean): CompanionLine[] | null {
  const inHand = held ? heldLines(state, held) : null;
  if (inHand) return inHand;
  // A cooler started and not finished: the next documented step, not the build's next part.
  const coolerKey = !held ? coolerInProgress(state) : null;
  const coolerLine = coolerKey ? coolerGuideLine(state, coolerKey, dismantling) : null;
  if (coolerLine && !["cooler.cpuFirst", "cooler.boardFirst"].includes(coolerLine.key)) return [coolerLine];
  // An M.2 drive left in its slot part-way (at an angle, not yet held, or its heatsink still off).
  const m2 = !held && ALL_SIMPLE_PARTS.find((p) => isM2Key(p.key) && state.parts.find((x) => x.instanceId === p.id)?.attachments.length && !simplePartInstalled(state, p.key));
  const m2Line = m2 ? m2StepLine(state, m2.key, null) : null;
  if (m2Line) return [m2Line];
  const resting = ALL_SIMPLE_PARTS.find((p) => isRamKey(p.key) && state.parts.find((x) => x.instanceId === p.id)?.attachments.some((a) => a.seating !== "seated"));
  const at = resting && state.parts.find((x) => x.instanceId === resting.id)?.attachments[0];
  return at ? [{ key: "hands.ramResting", values: { slot: ramSlotName(state, at.target.mountPointId) } }] : null;
}

/** The bubble after an event. `state` is the build after the event; `selection` is what is in hand now. */
export function companionSay(event: CompanionEvent, state: PCBuildState, powered: boolean, selection: Selection, dismantling = false): CompanionSay {
  const next = nextAction(state, powered);
  const nextSay = (lines: CompanionLine[], mood: CompanionMood): CompanionSay => ({ lines: [...lines, nextLine(state, powered)], mood, point: pointFor(next) });
  switch (event.type) {
    case "start":
      return { lines: [{ key: "hello" }, nextLine(state, powered)], mood: "wave", point: pointFor(next) };
    case "resume": {
      // What was saved mid-step comes first: the part in hand, or a module resting in its slot.
      const unfinished = resumeLines(state, event.held ?? null, dismantling);
      if (unfinished) return { lines: [{ key: "welcomeBack" }, ...unfinished], mood: "wave", point: "scene" };
      return { lines: [{ key: "welcomeBack" }, nextLine(state, powered)], mood: "wave", point: pointFor(next) };
    }
    case "select": {
      if (event.selection.kind === "part") {
        const key = event.selection.key;
        if (simplePartInstalled(state, key)) return REMOVABLE.includes(key)
          ? { lines: [{ key: "alreadySwap", values: { part: partName(key) } }], mood: "idle", point: "parts" }
          : nextSay([{ key: "already", values: { part: partName(key) } }], "idle");
        const blocked = simpleBlock(state, key);
        if (blocked) return { lines: [blockLine(state, key, blocked)], mood: "concerned" };
        const coolerLine = hasModelledMounting(key) ? coolerGuideLine(state, key, dismantling) : null;
        if (coolerLine) return { lines: [coolerLine], mood: "point", point: "scene" };
        const place = placeOf(state, key);
        // A SATA drive or a case fan goes where the learner chooses: the plan's own place is not suggested as the only one.
        if (isPositionKey(key)) return { lines: [{ key: "hands.pickPosition", values: { part: partName(key) } }], mood: "point", point: "scene" };
        // A module is placed by hand over the slot of the learner's choice: no slot is named for it here.
        if (isRamKey(key)) return { lines: [{ key: "hands.ramPick" }], mood: "point", point: "scene" };
        return { lines: [{ key: "selected.part", values: { part: partName(key), place: { place } } }], mood: "point", point: "scene" };
      }
      const key = event.selection.key;
      if (simpleCableConnected(state, key)) return { lines: [{ key: "selected.cableDone", values: { cable: { cable: key } } }], mood: "idle" };
      const blocked = simpleCableBlock(state, key);
      if (blocked) return { lines: [cableBlockLine(key, blocked, state)], mood: "concerned" };
      return { lines: [{ key: "selected.cable", values: { cable: { cable: key } } }], mood: "point", point: "scene" };
    }
    case "installed": {
      let line: CompanionLine;
      if (isRamKey(event.key)) line = { key: RAM_IN(state) === 2 ? "installed.ramBoth" : "installed.ramFirst" };
      else line = { key: `installed.${partTopic(event.key)}` };
      const partsDone = simpleAllPartsIn(state);
      return nextSay([partsDone ? { key: "installed.allParts" } : line], "happy");
    }
    case "connected": {
      const leads = simpleCablesFor(state);
      const essentialsDone = leads.filter((c) => c.essential).every((c) => simpleCableConnected(state, c.key));
      const all = leads.every((c) => simpleCableConnected(state, c.key));
      return nextSay([{ key: all ? "connected.all" : essentialsDone && !event.key.startsWith("caseFan") ? "connected.essentials" : "connected.one", values: { cable: { cable: event.key } } }], "happy");
    }
    case "unplugged":
      return nextSay([{ key: "unplugged", values: { cable: { cable: event.key } } }], "idle");
    case "wrongPlace": {
      const right = placeOf(state, event.key);
      if (isRamKey(event.key) && event.place.startsWith("dimm-")) return { lines: [{ key: "wrong.ramSlot", values: { place: { place: right } } }], mood: "concerned", point: "scene" };
      return { lines: [{ key: "wrong.place", values: { part: partName(event.key), place: { place: right } } }], mood: "concerned", point: "scene" };
    }
    case "wrongPort":
      return {
        lines: [event.portOf ? { key: "wrong.portOf", values: { other: { cable: event.portOf }, cable: { cable: event.key } } } : { key: "wrong.port", values: { cable: { cable: event.key } } }],
        mood: "concerned",
        point: "scene",
      };
    case "notSelectable":
      return nextSay([{ key: "notSelectable" }], "thinking");
    case "missedTarget":
      return { lines: [{ key: "missedTarget" }], mood: "point", point: "scene" };
    case "cancel":
      return nextSay([{ key: "cancelled" }], "idle");
    case "undo":
      // A lowering or a pressing-home undone leaves the part in hand or resting: the next thing is to finish it, not a new step.
      return event.step.startsWith("lower:") || event.step.startsWith("seat:") ? { lines: [undoLine(event.step)], mood: "idle", point: "scene" } : nextSay([undoLine(event.step)], "idle");
    case "nothingToUndo":
      return { lines: [{ key: powered ? "undo.turnOff" : "undo.nothing" }], mood: "thinking", point: powered ? "power" : undefined };
    case "restart":
      return nextSay([{ key: "restart" }], "wave");
    case "powerFail":
      if (!simpleAllPartsIn(state)) return nextSay([{ key: "power.partsMissing" }], "concerned");
      if (event.rule === "needsLiquidCooler") return { lines: [{ key: "power.needsLiquid" }], mood: "concerned", point: "parts" };
      return {
        lines: event.missingCable ? [{ key: "power.cableMissing", values: { cable: { cable: event.missingCable } } }] : [{ key: "power.failed" }],
        mood: "concerned",
        point: "cables",
      };
    case "removed":
      return nextSay([{ key: "removed", values: { part: partName(event.key) } }], "idle");
    case "swapped":
      return nextSay([{ key: "swapped", values: { part: partName(event.key), other: partName(event.from) } }], "happy");
    case "removeBlocked":
      if (event.reason === "boardFirst") return { lines: [{ key: "blocked.boardFirst", values: { part: partName("aio") } }], mood: "concerned", point: "parts" };
      return { lines: [{ key: `blocked.${event.reason}`, values: { part: partName(event.key) } }], mood: "concerned", point: event.reason === "turnOffFirst" ? "power" : event.reason === "unplugCoolerFirst" ? "cables" : "parts" };
    case "powerOn":
      if (simpleAssemblyComplete(state)) return { lines: [{ key: "complete.title" }, { key: simplePartInstalled(state, "aio") ? "complete.summaryLiquid" : "complete.summary" }], mood: "celebrate" };
      return { lines: [{ key: "power.bootsFansMissing" }], mood: "happy", point: "power" };
    case "powerOff":
      return nextSay([{ key: "power.off" }], "idle");
    case "ask":
      if (event.intent === "next") return nextSay([], next.kind === "done" ? "celebrate" : "point");
      if (event.intent === "explain") return { lines: explainLines(state, powered, selection), mood: "thinking", point: selection ? "scene" : pointFor(next) };
      return helpLines(state, powered, selection);
    case "question":
      return { lines: [{ key: "noAi" }, nextLine(state, powered)], mood: "thinking", point: pointFor(next) };
  }
}

/**
 * A plain-text description of the build for the AI tutor: what is fitted, where, what is connected,
 * what is in hand and what comes next. Only facts from the engine; no names the page did not show.
 */
export function buildContext(state: PCBuildState, powered: boolean, selection: Selection): string {
  const filled = SIMPLE_PARTS.flatMap((p) => simpleSlotPart(state, slotOf(p.key)) ?? []);
  const fitted = filled.map((key) => (isRamKey(key) ? `${key} (${simpleTarget(state, key).mountPointId})` : key));
  const missing = SIMPLE_PARTS.filter((p) => !simpleSlotFilled(state, slotOf(p.key))).map((p) => p.key);
  const leads = simpleCablesFor(state);
  const connected = leads.filter((c) => simpleCableConnected(state, c.key)).map((c) => c.key);
  const loose = leads.filter((c) => !simpleCableConnected(state, c.key)).map((c) => c.key);
  const next = nextAction(state, powered);
  return [
    "PC: ASUS TUF GAMING Z790-PLUS WIFI motherboard, 2 x Corsair Vengeance DDR5 (slots A2 and B2), Samsung 990 PRO M.2, ASUS Dual RTX 4060, Corsair CX550, Corsair 4000D case.",
    "CPU: one of Intel Core i5-14600K (key cpu) or Intel Core i9-14900K (key cpu2). Cooler: one of ARCTIC Freezer 36 air cooler (key cooler, lead cpuFan to CPU_FAN) or ARCTIC Liquid Freezer III 280 AIO (key aio: block on the CPU, radiator in the case's top 280 mm position, leads aioPump to AIO_PUMP and aioFan to CPU_FAN).",
    "Lab rule (educational, for this simulation only): the Core i9-14900K starts only with the 280 mm liquid cooler fitted and connected. It is not a general real-world rule.",
    `Fitted: ${fitted.join(", ") || "nothing"}. Not fitted: ${missing.join(", ") || "none"}.`,
    `Cables connected: ${connected.join(", ") || "none"}. Not connected: ${loose.join(", ") || "none"}.`,
    `Powered on: ${powered ? "yes" : "no"}. In hand: ${selection ? `${selection.kind} ${selection.key}` : "nothing"}.`,
    `Next step: ${next.kind}${"key" in next ? ` ${next.key}` : ""}.`,
  ].join("\n");
}
