// What the build companion says, decided from the real build state and the learner's last action.
// Pure and deterministic: the page translates each line (`companion.*` messages) and shows it in the
// robot's speech bubble. Nothing here is a model's answer; free questions go to the AI tutor only
// when the server has one configured.
import type { PCBuildState } from "@ytl/contracts";
import {
  ALL_SIMPLE_CABLES, ALL_SIMPLE_PARTS, isRamKey, RAM_SLOTS, SIMPLE_PARTS, simpleAllPartsIn, simpleAssemblyComplete, simpleBlock, simpleCableBlock, simpleCableConnected, simpleCableMissingParts,
  simpleCablesFor, simpleCableOrder, simplePartInstalled, simplePartOrder, simplePrerequisites, simpleRuleBlock, REMOVABLE, simpleSlotFilled, simpleSlotPart, simpleTarget, slotOf,
  type SimpleBlock, type SimpleCableBlock, type SimpleCableKey, type SimplePartKey, type SimpleRemoveBlock, type SimpleRule, type SimpleStep,
} from "./simple-model";

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
  | { type: "resume" }
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
  if (selection?.kind === "part") return [{ key: `explain.${partTopic(selection.key)}` }];
  if (selection?.kind === "cable") return [{ key: `explain.${cableTopic(selection.key)}` }];
  const next = nextAction(state, powered);
  if (next.kind === "part") return [{ key: `explain.${partTopic(next.key)}` }];
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
  const key = rest.split(":")[0] ?? "";
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
    case "fasten": return withPart("fasten");
    case "unfasten": return withPart("unfasten");
    case "prep": return withPart("prep");
    case "mech": {
      const id = rest.slice(0, rest.lastIndexOf(":"));
      if (id.endsWith(":lever") || id === "cpu-socket-lever") return { key: "undo.lever" };
      if (id === "cpu-socket-plate") return { key: "undo.plate" };
      if (id === "slot-covers") return { key: "undo.covers" };
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

/** The bubble after an event. `state` is the build after the event; `selection` is what is in hand now. */
export function companionSay(event: CompanionEvent, state: PCBuildState, powered: boolean, selection: Selection): CompanionSay {
  const next = nextAction(state, powered);
  const nextSay = (lines: CompanionLine[], mood: CompanionMood): CompanionSay => ({ lines: [...lines, nextLine(state, powered)], mood, point: pointFor(next) });
  switch (event.type) {
    case "start":
      return { lines: [{ key: "hello" }, nextLine(state, powered)], mood: "wave", point: pointFor(next) };
    case "resume":
      return { lines: [{ key: "welcomeBack" }, nextLine(state, powered)], mood: "wave", point: pointFor(next) };
    case "select": {
      if (event.selection.kind === "part") {
        const key = event.selection.key;
        if (simplePartInstalled(state, key)) return REMOVABLE.includes(key)
          ? { lines: [{ key: "alreadySwap", values: { part: partName(key) } }], mood: "idle", point: "parts" }
          : nextSay([{ key: "already", values: { part: partName(key) } }], "idle");
        const blocked = simpleBlock(state, key);
        if (blocked) return { lines: [blockLine(state, key, blocked)], mood: "concerned" };
        const place = placeOf(state, key);
        if (isRamKey(key)) return { lines: [{ key: place === RAM_SLOTS[0] ? "selected.ramFirst" : "selected.ramSecond" }], mood: "point", point: "scene" };
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
      // A lowering undone leaves the part in hand: the next thing is to lower it again, not a new step.
      return event.step.startsWith("lower:") ? { lines: [undoLine(event.step)], mood: "idle", point: "scene" } : nextSay([undoLine(event.step)], "idle");
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
