// Kit hardware that is more than open/closed, in detailed builds: the contact-frame mounting ARCTIC's manuals
// describe for Intel LGA1700/1851 (Freezer 36, Liquid Freezer III). The board's own socket backplate stays and is
// supported or taped; the socket's Independent Loading Mechanism (ILM) comes off; a CPU Contact Frame, held by four
// screws that go in a couple of turns each and are then tightened in a cross pattern, holds the CPU instead.
// Pure rules: they return the new parts or the reason for a refusal, and the reducer wraps the result.
import type { CatalogEntry, CoolerMountingSpec, InstalledPart, Localized, MountPointSpec } from "@ytl/contracts";
import { L } from "./messages";
import { type View, entryOf, mountSpec, partById } from "./view";

export type HardwareResult =
  | { ok: true; parts: InstalledPart[] }
  | { ok: false; code: "mounting_missing" | "hardware_order_wrong" | "retention_blocked" | "invalid_action" | "prep_wrong"; why: Localized };

const refuse = (code: Extract<HardwareResult, { ok: false }>["code"], en: string, ar: string): HardwareResult => ({ ok: false, code, why: L(en, ar) });
const SCREW_STATE = /^[012]{4}$/;

/** The mounting method of a cooler entry on a socket, if the catalog records one. */
export function mountingFor(entry: CatalogEntry | undefined, socket: string | undefined): CoolerMountingSpec | undefined {
  return entry?.category === "cooling" && socket ? entry.spec.mounting?.find((m) => (m.sockets as string[]).includes(socket)) : undefined;
}

const socketMount = (entry: CatalogEntry | undefined): Extract<MountPointSpec, { kind: "cpu_socket" }> | undefined =>
  entry?.mountPoints.find((m): m is Extract<MountPointSpec, { kind: "cpu_socket" }> => m.kind === "cpu_socket" && m.retention?.kind === "lga_load_plate");

const withHardware = (parts: InstalledPart[], id: string, change: Record<string, string | null>): InstalledPart[] =>
  parts.map((p) => {
    if (p.instanceId !== id) return p;
    const next = { ...(p.hardware ?? {}) };
    for (const [k, value] of Object.entries(change)) { if (value === null) delete next[k]; else next[k] = value; }
    const { hardware: _old, ...rest } = p;
    return Object.keys(next).length ? { ...rest, hardware: next } : rest;
  });

/** Every part installed on a board's socket area: the CPU and the cooler. */
const onBoard = (v: View, board: InstalledPart) =>
  v.state.parts.flatMap((p) => p.attachments.filter((a) => a.target.hostInstanceId === board.instanceId).map((a) => ({ part: p, attachment: a, place: mountSpec(v, a.target) })));
const cpuOn = (v: View, board: InstalledPart) => onBoard(v, board).find((x) => x.place?.kind === "cpu_socket");
const coolerOn = (v: View, board: InstalledPart) => onBoard(v, board).find((x) => x.place?.kind === "cpu_cooler_mount");
/** Whether a cooler in the build brings a contact frame for this board's socket. */
const contactFrameCoolerIn = (v: View, board: InstalledPart) => {
  const socket = (entryOf(v, board) as { spec?: { socket?: string } } | undefined)?.spec?.socket;
  return v.state.parts.some((p) => mountingFor(entryOf(v, p), socket)?.kind === "contact_frame");
};
export const boardInCase = (v: View, board: InstalledPart) => board.attachments.some((a) => mountSpec(v, a.target)?.kind === "motherboard_tray");

/**
 * The backplate preparation (`set_prep backplate`): padding under it while the board is outside the case, painter's
 * tape on its back once the board is in the case. It stays while the ILM is off and the frame is not yet tight.
 */
export function backplateRule(v: View, board: InstalledPart, value: string): Extract<HardwareResult, { ok: false }> | null {
  if (value === "padding" && boardInCase(v, board)) return { ok: false, code: "prep_wrong", why: L("The board is in the case: padding cannot support its backplate there. Use painter's tape on the back of the board.", "اللوحة داخل الكيس: الحشوة ما تقدر تسند الباك بليت هناك. استخدم شريط لاصق ورقي على ظهر اللوحة.") };
  if (value === "tape" && !boardInCase(v, board)) return { ok: false, code: "prep_wrong", why: L("The board is outside the case: lay it flat with the backplate resting on thick padding (the packaging's inner card).", "اللوحة برا الكيس: حطها مسطّحة والباك بليت على حشوة سميكة (الكرتون الداخلي للعلبة).") };
  if (value === "" && board.hardware?.ilm === "removed" && board.hardware?.frame_screws !== "2222") {
    return { ok: false, code: "retention_blocked", why: L("Keep the backplate supported until the contact frame is tight.", "خلّ الباك بليت مسنود لين يتثبّت إطار التلامس.") };
  }
  return null;
}

/** The one place the frame's cross pattern is decided, from the state alone. `from` and `to` differ in one character. */
function screwStep(current: string, next: string): Extract<HardwareResult, { ok: false }> | null {
  const changed = [...current].flatMap((c, i) => (c !== next[i] ? [i] : []));
  if (changed.length !== 1) return { ok: false, code: "hardware_order_wrong", why: L("One screw at a time.", "برغي برغي.") };
  const i = changed[0]!;
  const a = Number(current[i]);
  const b = Number(next[i]);
  const tight = [...current].flatMap((c, k) => (c === "2" ? [k] : []));
  if (Math.abs(b - a) !== 1) {
    return { ok: false, code: "hardware_order_wrong", why: b > a ? L("A screw goes in a couple of turns first, and is tightened after the others are in.", "البرغي يدخل كم لفّة أول، وينربط بعد ما تدخل الباقي.") : L("Loosen a tight screw first; it comes out after that.", "فكّ البرغي المربوط أول، وبعدين يطلع.") };
  }
  if (b > a) {
    if (a === 0) return null; // any order
    if (!(current.length === 4 && [...current].every((c) => c !== "0"))) return { ok: false, code: "hardware_order_wrong", why: L("Engage all four screws a couple of turns before tightening any of them.", "دخّل البراغي الأربعة كم لفّة قبل ما تربط أي واحد.") };
    if (tight.length === 1 && i !== (tight[0]! + 2) % 4) return { ok: false, code: "hardware_order_wrong", why: L("Tighten across the frame: the screw opposite the one you just tightened.", "اربط بشكل متصالب: البرغي المقابل للي ربطته الحين.") };
    return null;
  }
  if (a === 2 && tight.length === 3) {
    const k = [...current].findIndex((c) => c !== "2");
    if (i !== (k + 2) % 4) return { ok: false, code: "hardware_order_wrong", why: L("Loosen across the frame: the screw opposite the one you just loosened.", "فكّ بشكل متصالب: البرغي المقابل للي فككته الحين.") };
  }
  if (a === 1 && tight.length > 0) return { ok: false, code: "hardware_order_wrong", why: L("Loosen the tight screws first.", "فكّ البراغي المربوطة أول.") };
  return null;
}

/** One step of kit hardware (`set_hardware`); the board's keys are `ilm`, `frame` and `frame_screws`. */
export function applyHardware(v: View, action: { instanceId: string; key: string; value: string }): HardwareResult {
  const part = partById(v, action.instanceId);
  const entry = entryOf(v, part);
  if (!part || !entry) return refuse("invalid_action", "That part is not in the build.", "هذي القطعة مو في التجميعة.");
  if (entry.category !== "motherboard") return refuse("invalid_action", "That hardware step does not apply to this part.", "هذي الخطوة ما تنطبق على هالقطعة.");
  const socket = socketMount(entry);
  const plate = socket?.retention?.id;
  if (!socket || !plate) return refuse("invalid_action", "This board's socket has no loading mechanism to work on.", "مقبس هاللوحة ما فيه آلية تحميل نشتغل عليها.");
  const hw = part.hardware ?? {};
  const { key, value } = action;
  const set = (change: Record<string, string | null>): HardwareResult => ({ ok: true, parts: withHardware(v.state.parts, part.instanceId, change) });

  if (key === "ilm") {
    if (value === "removed") {
      if (hw.ilm === "removed") return set({});
      if (!contactFrameCoolerIn(v, part)) return refuse("mounting_missing", "No cooler in your build comes with a contact frame, so the ILM stays on.", "ما فيه مبرّد في تجميعتك يجي معه إطار تلامس، فالـ ILM يبقى مركّب.");
      if (!part.prep?.backplate) return refuse("mounting_missing", "Support the socket backplate first: padding under it (board outside the case) or painter's tape (board in the case).", "اسند الباك بليت أول: حشوة تحته (اللوحة برا الكيس) أو شريط لاصق ورقي (اللوحة داخل الكيس).");
      if (part.mechanisms?.[`${plate}:lever`] !== "open" || part.mechanisms?.[plate] !== "open") return refuse("retention_blocked", "Lift the lever and open the load plate first: the ILM comes off with them open.", "ارفع الذراع وافتح غطا التحميل أول: الـ ILM يطلع وهم مفتوحين.");
      return set({ ilm: "removed" });
    }
    if (value === "") {
      if (hw.frame === "placed") return refuse("retention_blocked", "Take the contact frame off first; the ILM goes back where it was.", "شيل إطار التلامس أول؛ الـ ILM يرجع مكانه.");
      return set({ ilm: null });
    }
    return refuse("invalid_action", "That is not an ILM state.", "هذي مو حالة للـ ILM.");
  }

  if (key === "frame") {
    if (value === "placed") {
      if (hw.frame === "placed") return set({});
      if (hw.ilm !== "removed") return refuse("mounting_missing", "Take the ILM off first: the contact frame goes where it was.", "شيل الـ ILM أول: إطار التلامس يركب مكانه.");
      if (!cpuOn(v, part)) return refuse("mounting_missing", "Place the CPU in the socket first: the frame goes over it.", "حط المعالج في المقبس أول: الإطار يركب فوقه.");
      if (!contactFrameCoolerIn(v, part)) return refuse("mounting_missing", "The contact frame comes in the cooler's box, and no cooler here has one.", "إطار التلامس يجي في علبة المبرّد، وما فيه مبرّد هنا معه إطار.");
      return set({ frame: "placed", frame_screws: "0000" });
    }
    if (value === "") {
      if (hw.frame !== "placed") return set({});
      if (coolerOn(v, part)) return refuse("retention_blocked", "The cooler sits over the frame. Take the cooler off first.", "المبرّد فوق الإطار. شيل المبرّد أول.");
      if (hw.frame_screws !== "0000") return refuse("retention_blocked", "Unscrew all four frame screws first.", "فكّ براغي الإطار الأربعة أول.");
      return set({ frame: null, frame_screws: null });
    }
    return refuse("invalid_action", "That is not a frame state.", "هذي مو حالة للإطار.");
  }

  if (key === "frame_screws") {
    if (hw.frame !== "placed") return refuse("mounting_missing", "Place the contact frame first.", "ركّب إطار التلامس أول.");
    if (!SCREW_STATE.test(value)) return refuse("invalid_action", "A screw is out (0), engaged (1) or tight (2).", "البرغي إما طالع (0) أو داخل لفّتين (1) أو مربوط (2).");
    if (coolerOn(v, part)) return refuse("retention_blocked", "The cooler sits over the frame. Take the cooler off first.", "المبرّد فوق الإطار. شيل المبرّد أول.");
    const current = hw.frame_screws ?? "0000";
    if (value === current) return set({});
    const wrong = screwStep(current, value);
    if (wrong) return wrong;
    const result = set({ frame_screws: value });
    // Tight on all four screws the frame holds the CPU the way the ILM would have; any looser and it does not.
    const cpu = cpuOn(v, part);
    if (result.ok && cpu && (value === "2222") !== (current === "2222")) {
      return { ok: true, parts: result.parts.map((p) => (p.instanceId === cpu.part.instanceId ? { ...p, attachments: p.attachments.map((a) => (a === cpu.attachment ? { ...a, fastenersSecured: value === "2222" ? 1 : 0 } : a)) } : p)) };
    }
    return result;
  }

  return refuse("invalid_action", "That hardware step does not exist.", "هذي الخطوة مو موجودة.");
}

