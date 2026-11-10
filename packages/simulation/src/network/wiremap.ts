// Ethernet plug and cable checks. T568A and T568B are both valid colour orders; neither is
// presented as faster or better. A cable passes on continuity and pairing, the way a wiremap
// tester judges it; whether a link then needs a straight-through or a crossover cable is decided
// from the two ports (see links.ts), not here.
import {
  PLUG_POSITIONS,
  WIRE_COLORS,
  type CableWiremap,
  type CableWiremapPin,
  type NetworkCable,
  type PlugAttempt,
  type PlugPinResult,
  type PlugTermination,
  type PlugWiremap,
  type WireColor,
  type WiringStandard,
} from "@ytl/contracts";
import { L, WIRE_NAMES, fill } from "./text";

/** Pin 1 first. Source: ANSI/TIA-568 pin/pair assignments. */
export const STANDARD_ORDER: Record<WiringStandard, readonly WireColor[]> = {
  T568A: ["white-green", "green", "white-orange", "blue", "white-blue", "orange", "white-brown", "brown"],
  T568B: ["white-orange", "orange", "white-green", "blue", "white-blue", "green", "white-brown", "brown"],
};

/** The pins that carry one signal together and must therefore be one twisted pair. */
const SIGNAL_PAIRS: readonly (readonly [number, number])[] = [[1, 2], [3, 6], [4, 5], [7, 8]];
/** Where each pin arrives at the far end of a T568A-to-T568B cable. */
const CROSSOVER: Record<number, number> = { 1: 3, 2: 6, 3: 1, 6: 2, 4: 4, 5: 5, 7: 7, 8: 8 };

const pairOf = (wire: WireColor): string => wire.replace("white-", "");

export function isValidOrder(order: readonly unknown[]): order is WireColor[] {
  return order.length === PLUG_POSITIONS && new Set(order).size === PLUG_POSITIONS && order.every((wire) => (WIRE_COLORS as readonly unknown[]).includes(wire));
}

/** The standard this colour order is, or null when it is neither. */
export function matchStandard(order: readonly WireColor[]): WiringStandard | null {
  for (const standard of ["T568A", "T568B"] as const) {
    if (STANDARD_ORDER[standard].every((wire, index) => order[index] === wire)) return standard;
  }
  return null;
}

/** One plug against the standard the learner chose. */
export function checkPlug(attempt: PlugAttempt): PlugWiremap {
  const expected = STANDARD_ORDER[attempt.standard];
  const valid = isValidOrder(attempt.order);
  const pins: PlugPinResult[] = Array.from({ length: PLUG_POSITIONS }, (_, index) => {
    const wire = attempt.order[index];
    const ok = valid && wire === expected[index];
    return {
      position: index + 1,
      wire,
      ok,
      detail: ok
        ? undefined
        : fill(L("Pin {pin} holds the {have} wire. {standard} puts the {want} wire here.", "البن {pin} فيه السلك {have}. في {standard} مكانه السلك {want}."), {
            pin: index + 1,
            have: WIRE_NAMES[wire] ?? L("missing", "ناقص"),
            want: WIRE_NAMES[expected[index]],
            standard: attempt.standard,
          }),
    };
  });
  const wrong = pins.filter((pin) => !pin.ok).map((pin) => pin.position);
  const other: WiringStandard = attempt.standard === "T568A" ? "T568B" : "T568A";
  const matchesOther = valid && matchStandard(attempt.order) === other;
  const summary =
    wrong.length === 0
      ? fill(L("All eight wires are in the {standard} order.", "الأسلاك الثمانية مرتبة على {standard}."), { standard: attempt.standard })
      : matchesOther
        ? fill(L("This plug is wired as {other}, which is a valid order, but you chose {standard}. Pins {pins} differ.", "هذي الفيشة مرتبة على {other}، وهو ترتيب صحيح، بس إنت اخترت {standard}. البنات {pins} تختلف."), {
            other,
            standard: attempt.standard,
            pins: wrong.join(", "),
          })
        : fill(L("Pins {pins} do not match {standard}.", "البنات {pins} ما تطابق {standard}."), { pins: wrong.join(", "), standard: attempt.standard });
  return { passed: wrong.length === 0, pins, summary };
}

const FACTORY: PlugTermination = { order: [...STANDARD_ORDER.T568B] };

/** The whole cable, end A to end B. A cable without `plugs` is a factory straight-through patch cable. */
export function checkCable(cable: Pick<NetworkCable, "plugs">): CableWiremap {
  const a = cable.plugs ? cable.plugs.a : FACTORY;
  const b = cable.plugs ? cable.plugs.b : FACTORY;
  if (!a || !b || !isValidOrder(a.order) || !isValidOrder(b.order)) {
    const missing = !a ? "A" : !b ? "B" : null;
    return {
      passed: false,
      wiring: null,
      ends: { a: a && isValidOrder(a.order) ? matchStandard(a.order) : null, b: b && isValidOrder(b.order) ? matchStandard(b.order) : null },
      pins: Array.from({ length: PLUG_POSITIONS }, (_, index) => ({
        pin: index + 1,
        farPin: null,
        status: "open" as const,
        detail: L("No connection: one end has no finished plug.", "ما في توصيل: واحد من الطرفين ما له فيشة جاهزة."),
      })),
      summary: missing
        ? fill(L("End {end} has no plug yet, so nothing is connected.", "الطرف {end} ما له فيشة للحين، فما في شي موصّل."), { end: missing })
        : L("A plug does not hold each of the eight wires once.", "في فيشة ما فيها كل سلك من الثمانية مرة وحدة."),
    };
  }

  const openA = new Set(a.open ?? []);
  const openB = new Set(b.open ?? []);
  const shortedA = new Set((a.shorted ?? []).flat());
  const shortedB = new Set((b.shorted ?? []).flat());
  const far = (pin: number) => b.order.indexOf(a.order[pin - 1]) + 1;
  const all = Array.from({ length: PLUG_POSITIONS }, (_, index) => index + 1);

  // Which intended wiring this cable is closest to; ties go to straight-through.
  const straightMisses = all.filter((pin) => far(pin) !== pin).length;
  const crossMisses = all.filter((pin) => far(pin) !== CROSSOVER[pin]).length;
  const reference: "straight_through" | "crossover" = crossMisses < straightMisses ? "crossover" : "straight_through";
  const intended = (pin: number) => (reference === "crossover" ? CROSSOVER[pin] : pin);
  const oneToOne = straightMisses === 0 || crossMisses === 0;

  const split = new Set<number>();
  if (oneToOne) {
    for (const [first, second] of SIGNAL_PAIRS) {
      if (pairOf(a.order[first - 1]) !== pairOf(a.order[second - 1])) {
        split.add(first);
        split.add(second);
      }
    }
  }

  const pins: CableWiremapPin[] = all.map((pin) => {
    const farPin = far(pin);
    if (openA.has(pin) || openB.has(farPin)) {
      return { pin, farPin: null, status: "open", detail: fill(L("Pin {pin} is open: its wire does not make contact.", "البن {pin} مفتوح: سلكه ما يلامس."), { pin }) };
    }
    if (shortedA.has(pin) || shortedB.has(farPin)) {
      return { pin, farPin, status: "short", detail: fill(L("Pin {pin} is shorted to another pin.", "البن {pin} ملامس لبن ثاني (شورت)."), { pin }) };
    }
    if (farPin !== intended(pin)) {
      return {
        pin,
        farPin,
        status: "swapped",
        detail: fill(L("Pin {pin} arrives at pin {far} on the other end instead of pin {want}.", "البن {pin} يوصل للبن {far} في الطرف الثاني بدل البن {want}."), { pin, far: farPin, want: intended(pin) }),
      };
    }
    if (split.has(pin)) {
      return {
        pin,
        farPin,
        status: "split_pair",
        detail: fill(L("Pin {pin} connects end to end, but its signal partner is a wire from a different twisted pair.", "البن {pin} موصّل من الطرفين، بس شريكه في الإشارة سلك من زوج مجدول ثاني."), { pin }),
      };
    }
    return { pin, farPin, status: "ok" };
  });

  const bad = (status: CableWiremapPin["status"]) => pins.filter((pin) => pin.status === status).map((pin) => pin.pin);
  const passed = pins.every((pin) => pin.status === "ok");
  const ends = { a: matchStandard(a.order), b: matchStandard(b.order) };
  let summary;
  if (passed) {
    const kind = reference === "crossover" ? L("a crossover cable", "سلك كروس أوفر") : L("a straight-through cable", "سلك مباشر (سترايت)");
    summary =
      ends.a && ends.b
        ? fill(L("Wiremap passed: {kind} ({a} to {b}).", "فحص الأسلاك نجح: {kind} ({a} إلى {b})."), { kind, a: ends.a, b: ends.b })
        : fill(L("Wiremap passed: {kind}. The colours do not follow T568A or T568B, but every pin and pair is connected correctly.", "فحص الأسلاك نجح: {kind}. الألوان ما تتبع T568A ولا T568B، بس كل بن وكل زوج موصّل صح."), { kind });
  } else {
    const parts: { en: string; ar: string }[] = [];
    const add = (pinsOf: number[], en: string, ar: string) => {
      if (pinsOf.length) parts.push(fill(L(en, ar), { pins: pinsOf.join(", ") }));
    };
    add(bad("open"), "open on pins {pins}", "مفتوح في البنات {pins}");
    add(bad("short"), "short on pins {pins}", "شورت في البنات {pins}");
    add(bad("swapped"), "wires swapped on pins {pins}", "أسلاك متبدّلة في البنات {pins}");
    add(bad("split_pair"), "split pair on pins {pins}", "زوج مقسوم في البنات {pins}");
    summary = L(`Wiremap failed: ${parts.map((p) => p.en).join("; ")}.`, `فحص الأسلاك ما نجح: ${parts.map((p) => p.ar).join("؛ ")}.`);
  }
  return { passed, wiring: passed ? reference : null, ends, pins, summary };
}

/**
 * A starting arrangement for the plug exercise: the eight wires in a scrambled order that is the
 * same every time for the same `seed`, and is never already T568A or T568B.
 */
export function scrambledWireOrder(seed = 1): WireColor[] {
  const order = [...WIRE_COLORS];
  // A small linear congruential generator: deterministic, no randomness from the environment.
  let state = (Math.abs(Math.trunc(seed)) % 2147483647) + 1;
  const next = () => (state = (state * 48271) % 2147483647);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = next() % (index + 1);
    [order[index], order[other]] = [order[other], order[index]];
  }
  if (matchStandard(order)) [order[0], order[7]] = [order[7], order[0]];
  return order;
}
