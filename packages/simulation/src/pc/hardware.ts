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
const screwState = (n: number) => new RegExp(`^[012]{${n}}$`);

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
export function screwStep(current: string, next: string): Extract<HardwareResult, { ok: false }> | null {
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
    if (![...current].every((c) => c !== "0")) return { ok: false, code: "hardware_order_wrong", why: L("Engage all four screws a couple of turns before tightening any of them.", "دخّل البراغي الأربعة كم لفّة قبل ما تربط أي واحد.") };
    if (current.length === 4 && tight.length === 1 && i !== (tight[0]! + 2) % 4) return { ok: false, code: "hardware_order_wrong", why: L("Tighten across the frame: the screw opposite the one you just tightened.", "اربط بشكل متصالب: البرغي المقابل للي ربطته الحين.") };
    return null;
  }
  if (a === 2 && current.length === 4 && tight.length === 3) {
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
  if (entry.category === "cooling") return applyCoolerHardware(v, part, entry, action);
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
    if (!screwState(4).test(value)) return refuse("invalid_action", "A screw is out (0), engaged (1) or tight (2).", "البرغي إما طالع (0) أو داخل لفّتين (1) أو مربوط (2).");
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


// ---------- The cooler's own fixing ----------

/** The one motherboard of the build, and its socket name (a build has one). */
const boardOf = (v: View) => {
  const board = v.state.parts.find((p) => entryOf(v, p)?.category === "motherboard");
  const entry = entryOf(v, board);
  return board && entry?.category === "motherboard" ? { part: board, socket: entry.spec.socket as string } : undefined;
};
/** The mounting method that applies to a cooler part in this build, if the catalog records one. */
export function coolerMounting(v: View, cooler: InstalledPart): CoolerMountingSpec | undefined {
  const entry = entryOf(v, cooler);
  const board = boardOf(v);
  return entry?.category === "cooling" && board ? mountingFor(entry, board.socket) : undefined;
}
const coolerPlaced = (v: View, cooler: InstalledPart) => cooler.attachments.find((a) => mountSpec(v, a.target)?.kind === "cpu_cooler_mount");

/** How many of the cooler body's own screws the engine counts as "secured" (detailed builds with a modelled mounting). */
export function bodyScrewCount(v: View, cooler: InstalledPart): number | null {
  return v.state.mechanics === "detailed" ? (coolerMounting(v, cooler)?.bodyScrews?.count ?? null) : null;
}

/** What has to be done before the cooler body may go on, by its mounting. Null when it may. */
export function coolerMountingGate(v: View, cooler: InstalledPart): Extract<HardwareResult, { ok: false }> | null {
  const m = coolerMounting(v, cooler);
  const board = boardOf(v);
  if (!m || m.kind === "generic" || !board) return null;
  const hw = cooler.hardware ?? {};
  if (m.kind === "contact_frame" && board.part.hardware?.frame_screws !== "2222") {
    return { ok: false, code: "mounting_missing", why: L("This cooler is held by its contact frame, which replaces the socket's ILM: fit the frame and tighten its four screws before the cooler goes on.", "هذا المبرّد يتثبّت بإطار التلامس اللي يحل مكان الـ ILM: ركّب الإطار واربط براغيه الأربعة قبل ما يركب المبرّد.") };
  }
  if (m.kind === "retention_ring") {
    const position = m.ring?.positions.find((p) => p.id === hw.position);
    if (!position || !(position.sockets as string[]).includes(board.socket)) return { ok: false, code: "mounting_missing", why: L("Set the mounting position for this socket first.", "اضبط وضع التثبيت لهالمقبس أول.") };
    if (hw.ring !== "placed") return { ok: false, code: "mounting_missing", why: L("Place the retention ring on the board first.", "حط حلقة التثبيت على اللوحة أول.") };
    if (hw.pins !== "1".repeat(m.ring?.pins ?? 4)) return { ok: false, code: "mounting_missing", why: L("Push all four retention pins through the board's holes first.", "ادفع دبابيس التثبيت الأربعة في فتحات اللوحة أول.") };
  }
  if (hw.contact === "used" && hw.clean !== "done") return { ok: false, code: "mounting_missing", why: L("This cooler's plate has touched a CPU: wipe the old thermal compound off the plate and the CPU first, then apply it again.", "قاعدة هالمبرّد لمست معالج: امسح المعجون القديم عن القاعدة والمعالج أول، وبعدين حط جديد.") };
  return null;
}

/** A cooler body lifted off a CPU: its plate is used, its old paste spent (a peeled film stays peeled), its screws out. */
export function liftedCooler(p: InstalledPart): InstalledPart {
  const { screws: _s, clean: _c, ...hardware } = p.hardware ?? {};
  const { paste: _paste, ...prep } = p.prep ?? {};
  return { ...p, hardware: { ...hardware, contact: "used" }, prep };
}

function applyCoolerHardware(v: View, part: InstalledPart, entry: CatalogEntry, action: { instanceId: string; key: string; value: string }): HardwareResult {
  const m = coolerMounting(v, part);
  if (!m || m.kind === "generic") return refuse("invalid_action", "This cooler has no modelled mounting on this socket.", "هالمبرّد ما له تثبيت مجسّد على هالمقبس.");
  const hw = part.hardware ?? {};
  const { key, value } = action;
  const board = boardOf(v)!;
  const placed = coolerPlaced(v, part);
  const set = (change: Record<string, string | null>, parts = v.state.parts): HardwareResult => ({ ok: true, parts: withHardware(parts, part.instanceId, change) });

  if (key === "screws") {
    const n = m.bodyScrews?.count;
    if (!n) return refuse("invalid_action", "This cooler is not held by screws.", "هالمبرّد مو متثبّت ببراغي.");
    if (!placed) return refuse("mounting_missing", "Place the cooler first; its screws go in after.", "ركّب المبرّد أول؛ براغيه تدخل بعدين.");
    if (!screwState(n).test(value)) return refuse("invalid_action", "A screw is out (0), engaged (1) or tight (2).", "البرغي إما طالع (0) أو داخل لفّتين (1) أو مربوط (2).");
    const current = hw.screws ?? "0".repeat(n);
    if (value === current) return set({});
    const wrong = screwStep(current, value);
    if (wrong) return wrong;
    const tight = [...value].filter((c) => c === "2").length;
    const parts = v.state.parts.map((p) => (p.instanceId === part.instanceId ? { ...p, attachments: p.attachments.map((a) => (a === placed ? { ...a, fastenersSecured: tight } : a)) } : p));
    return set({ screws: value }, parts);
  }

  if (key === "position") {
    const wanted = m.ring?.positions.find((p) => p.id === value);
    if (m.kind !== "retention_ring" || !wanted) return refuse("invalid_action", "That is not a mounting position of this cooler.", "هذا مو وضع تثبيت لهالمبرّد.");
    if (!(wanted.sockets as string[]).includes(board.socket)) {
      const right = m.ring!.positions.find((p) => (p.sockets as string[]).includes(board.socket));
      return refuse("mounting_missing", `That position is for ${wanted.sockets.map((s) => s.toUpperCase()).join(" / ")}; this board's ${board.socket.toUpperCase()} takes the ${right?.label.en ?? "other"}.`, `هذا الوضع لـ ${wanted.sockets.map((s) => s.toUpperCase()).join(" / ")}؛ و${board.socket.toUpperCase()} حق هاللوحة يبي ${right?.label.ar ?? "الوضع الثاني"}.`);
    }
    if (hw.ring === "placed") return refuse("retention_blocked", "Take the ring off before changing the position.", "شيل الحلقة قبل ما تغيّر الوضع.");
    return set({ position: value });
  }

  if (key === "ring") {
    if (m.kind !== "retention_ring") return refuse("invalid_action", "This cooler has no retention ring.", "هالمبرّد ما له حلقة تثبيت.");
    if (value === "placed") {
      if (hw.ring === "placed") return set({});
      if (!hw.position) return refuse("mounting_missing", "Set the mounting position for this socket first.", "اضبط وضع التثبيت لهالمقبس أول.");
      return set({ ring: "placed", pins: "0000" });
    }
    if (value === "") {
      if (placed) return refuse("retention_blocked", "The cooler is on the ring. Take the cooler off first.", "المبرّد على الحلقة. شيل المبرّد أول.");
      if (hw.pins && hw.pins !== "0000") return refuse("retention_blocked", "Pull the retention pins out first.", "اسحب دبابيس التثبيت أول.");
      return set({ ring: null, pins: null });
    }
    return refuse("invalid_action", "That is not a ring state.", "هذي مو حالة للحلقة.");
  }

  if (key === "pins") {
    if (m.kind !== "retention_ring") return refuse("invalid_action", "This cooler has no retention pins.", "هالمبرّد ما له دبابيس تثبيت.");
    if (hw.ring !== "placed") return refuse("mounting_missing", "Place the retention ring first.", "حط حلقة التثبيت أول.");
    if (!/^[01]{4}$/.test(value)) return refuse("invalid_action", "A pin is out (0) or pushed in (1).", "الدبوس إما طالع (0) أو مدفوع (1).");
    if (placed) return refuse("retention_blocked", "The cooler is on the ring. Take the cooler off first.", "المبرّد على الحلقة. شيل المبرّد أول.");
    const current = hw.pins ?? "0000";
    if ([...current].filter((c, i) => c !== value[i]).length !== 1) return refuse("hardware_order_wrong", "One pin at a time.", "دبوس دبوس.");
    return set({ pins: value });
  }

  if (key === "vrm_fan") {
    if (!m.kit.some((k) => k.id === "vrm-fan-module")) return refuse("invalid_action", "This cooler has no VRM fan module in its kit.", "هالمبرّد ما في علبته مروحة VRM.");
    if (value === "attached") return set({ vrm_fan: "attached" });
    if (value === "") return set({ vrm_fan: null });
    return refuse("invalid_action", "That is not a VRM module state.", "هذي مو حالة لمروحة VRM.");
  }

  if (key === "clean") {
    if (hw.contact !== "used") return refuse("invalid_action", "This plate has not touched a CPU: there is nothing to clean off.", "هالقاعدة ما لمست معالج: ما في شي ينمسح.");
    if (value === "done") return set({ clean: "done" });
    if (value === "") return set({ clean: null });
    return refuse("invalid_action", "That is not a cleaning state.", "هذي مو حالة تنظيف.");
  }

  void entry;
  return refuse("invalid_action", "That hardware step does not exist.", "هذي الخطوة مو موجودة.");
}
