// What the build companion says, decided from the real build state and the learner's last action.
// Pure and deterministic: the page translates each line (`companion.*` messages) and shows it in the
// robot's speech bubble. Nothing here is a model's answer; free questions go to the AI tutor only
// when the server has one configured.
import type { PCBuildState } from "@ytl/contracts";
import {
  isRamKey, RAM_SLOTS, SIMPLE_CABLES, SIMPLE_PARTS, simpleAssemblyComplete, simpleBlock, simpleCableBlock, simpleCableConnected,
  simplePartInstalled, simplePrerequisites, simpleTarget, type SimpleBlock, type SimpleCableBlock, type SimpleCableKey, type SimplePartKey, type SimpleStep,
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
  | { type: "powerFail"; missingCable: SimpleCableKey | null }
  | { type: "powerOn" }
  | { type: "powerOff" }
  | { type: "ask"; intent: "next" | "help" | "explain" }
  | { type: "question"; text: string };

/** The order a builder would follow; the learner may take another valid order. */
const PART_ORDER: readonly SimplePartKey[] = ["cpu", "ram", "ram2", "storage", "cooler", "motherboard", "gpu", "psu"];
const CABLE_ORDER: readonly SimpleCableKey[] = ["atx", "cpuPower", "gpuPower", "cpuFan", "powerSwitch", "caseFan1", "caseFan2"];

export const partName = (key: SimplePartKey): { part: SimplePartKey } => ({ part: key });

/** What the learner should do next, from the build alone. */
export function nextAction(state: PCBuildState, powered: boolean): NextAction {
  if (powered) return simpleAssemblyComplete(state) ? { kind: "done" } : { kind: "turnOff" };
  const part = PART_ORDER.find((key) => !simplePartInstalled(state, key) && !simpleBlock(state, key));
  if (part) return { kind: "part", key: part };
  const blockedPart = PART_ORDER.find((key) => !simplePartInstalled(state, key));
  if (blockedPart) return { kind: "part", key: blockedPart };
  const cable = CABLE_ORDER.find((key) => !simpleCableConnected(state, key) && !simpleCableBlock(state, key));
  if (cable) return { kind: "cable", key: cable };
  return { kind: "power" };
}

const RAM_IN = (state: PCBuildState) => (["ram", "ram2"] as const).filter((key) => simplePartInstalled(state, key)).length;

/** The sentence that says what to do next. */
export function nextLine(state: PCBuildState, powered: boolean): CompanionLine {
  const next = nextAction(state, powered);
  if (next.kind === "part") {
    if (isRamKey(next.key)) return { key: RAM_IN(state) === 1 ? "next.ramSecond" : "next.ram" };
    return { key: `next.${next.key}` };
  }
  if (next.kind === "cable") {
    const first = SIMPLE_CABLES.every((c) => !simpleCableConnected(state, c.key));
    return { key: first ? "next.firstCable" : "next.cable", values: { cable: { cable: next.key } } };
  }
  return { key: `next.${next.kind}` };
}

function pointFor(next: NextAction): CompanionSay["point"] {
  return next.kind === "part" ? "scene" : next.kind === "cable" ? "cables" : next.kind === "power" || next.kind === "turnOff" ? "power" : undefined;
}

/** The place a selected part goes, for the bubble: a mount ID the page names (`places.*`). */
export function placeOf(state: PCBuildState, key: SimplePartKey): string {
  return simpleTarget(state, key).mountPointId;
}

function blockLine(state: PCBuildState, key: SimplePartKey, reason: SimpleBlock): CompanionLine {
  if (reason === "prepareBoard") {
    const missing = simplePrerequisites(key).filter((k) => !simplePartInstalled(state, k));
    return { key: "blocked.prepareBoard", values: { parts: { parts: missing } } };
  }
  return { key: `blocked.${reason}`, values: { part: partName(key) } };
}

function cableBlockLine(key: SimpleCableKey, reason: SimpleCableBlock, state: PCBuildState): CompanionLine {
  if (reason === "fitCableParts") {
    const spec = SIMPLE_CABLES.find((c) => c.key === key)!;
    return { key: "blocked.cableParts", values: { cable: { cable: key }, parts: { parts: spec.requires.filter((p) => !simplePartInstalled(state, p)) } } };
  }
  return { key: reason === "turnOffFirst" ? "blocked.turnOff" : "blocked.cannotConnect" };
}

/** Lines that explain why the current (or selected) step matters. */
function explainLines(state: PCBuildState, powered: boolean, selection: Selection): CompanionLine[] {
  if (selection?.kind === "part") return [{ key: `explain.${isRamKey(selection.key) ? "ram" : selection.key}` }];
  if (selection?.kind === "cable") return [{ key: `explain.${selection.key.startsWith("caseFan") ? "caseFan" : selection.key}` }];
  const next = nextAction(state, powered);
  if (next.kind === "part") return [{ key: `explain.${isRamKey(next.key) ? "ram" : next.key}` }];
  if (next.kind === "cable") return [{ key: `explain.${next.key.startsWith("caseFan") ? "caseFan" : next.key}` }];
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
    ["cpuFan", /cpu[_ ]fan|cooler fan|مروحة المبرد|مروحة المبرّد/],
    ["powerSwitch", /power (button|switch)|pwr_?sw|f_panel|front panel|زر التشغيل|زر تشغيل/],
    ["caseFan", /case fan|cha[_ ]fan|مراوح الكيس|مروحة الكيس/],
    ["ram", /\bram\b|memory|dimm|\ba2\b|\bb2\b|dual channel|رام|الذاكرة|ذاكرة/],
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
        if (simplePartInstalled(state, key)) return nextSay([{ key: "already", values: { part: partName(key) } }], "idle");
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
      else line = { key: `installed.${event.key}` };
      const partsDone = SIMPLE_PARTS.every((p) => simplePartInstalled(state, p.key));
      return nextSay(partsDone ? [line, { key: "installed.allParts" }] : [line], "happy");
    }
    case "connected": {
      const essentialsDone = SIMPLE_CABLES.filter((c) => c.essential).every((c) => simpleCableConnected(state, c.key));
      const all = SIMPLE_CABLES.every((c) => simpleCableConnected(state, c.key));
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
    case "undo": {
      const [kind, key] = event.step.split(":") as ["part" | "cable", string];
      return nextSay([kind === "part" ? { key: "undo.part", values: { part: partName(key as SimplePartKey) } } : { key: "undo.cable", values: { cable: { cable: key as SimpleCableKey } } }], "idle");
    }
    case "nothingToUndo":
      return { lines: [{ key: powered ? "undo.turnOff" : "undo.nothing" }], mood: "thinking", point: powered ? "power" : undefined };
    case "restart":
      return nextSay([{ key: "restart" }], "wave");
    case "powerFail":
      if (!SIMPLE_PARTS.every((p) => simplePartInstalled(state, p.key))) return nextSay([{ key: "power.partsMissing" }], "concerned");
      return {
        lines: event.missingCable ? [{ key: "power.cableMissing", values: { cable: { cable: event.missingCable } } }] : [{ key: "power.failed" }],
        mood: "concerned",
        point: "cables",
      };
    case "powerOn":
      if (simpleAssemblyComplete(state)) return { lines: [{ key: "complete.title" }, { key: "complete.summary" }], mood: "celebrate" };
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
  const fitted = SIMPLE_PARTS.filter((p) => simplePartInstalled(state, p.key)).map((p) => (isRamKey(p.key) ? `${p.key} (${simpleTarget(state, p.key).mountPointId})` : p.key));
  const missing = SIMPLE_PARTS.filter((p) => !simplePartInstalled(state, p.key)).map((p) => p.key);
  const connected = SIMPLE_CABLES.filter((c) => simpleCableConnected(state, c.key)).map((c) => c.key);
  const loose = SIMPLE_CABLES.filter((c) => !simpleCableConnected(state, c.key)).map((c) => c.key);
  const next = nextAction(state, powered);
  return [
    "PC: ASUS TUF GAMING Z790-PLUS WIFI motherboard, Intel Core i5-14600K, 2 x Corsair Vengeance DDR5 (slots A2 and B2), Samsung 990 PRO M.2, Arctic Freezer 36, ASUS Dual RTX 4060, Corsair CX550, Corsair 4000D case.",
    `Fitted: ${fitted.join(", ") || "nothing"}. Not fitted: ${missing.join(", ") || "none"}.`,
    `Cables connected: ${connected.join(", ") || "none"}. Not connected: ${loose.join(", ") || "none"}.`,
    `Powered on: ${powered ? "yes" : "no"}. In hand: ${selection ? `${selection.kind} ${selection.key}` : "nothing"}.`,
    `Next step: ${next.kind}${"key" in next ? ` ${next.key}` : ""}.`,
  ].join("\n");
}
