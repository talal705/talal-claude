// The build reducer: (state, action, catalog) -> new state or a rejection with its reason.
// Pure and deterministic: no clock, no randomness, input state is never mutated.
import type {
  CableInstance,
  CatalogEntry,
  MechanismState,
  MountPointSpec,
  PrepKind,
  RetentionSpec,
  InstalledPart,
  Localized,
  PCAction,
  PCActionResult,
  PCBuildState,
  PCCatalog,
  PCDiagnostic,
  PCDiagnosticClass,
  PCDiagnosticCode,
  PCEvaluationContext,
  PortRef,
  RgbPreference,
  TutorTargetRef,
} from "@ytl/contracts";
import { pcTarget } from "@ytl/contracts";
import { checkConnect } from "./cabling";
import { applyHardware, backplateRule, coolerMounting, coolerMountingGate, liftedCooler } from "./hardware";
import { cableSpecOf } from "./catalog";
import { L, type TextParams } from "./messages";
import { checkMount } from "./placement";
import { type View, cableById, displayName, entryOf, makeDiag, makeView, mountSpec, partById } from "./view";

export function createBuild(catalog: PCCatalog, rgbPreference: RgbPreference = "with_rgb"): PCBuildState {
  return {
    catalogVersion: catalog.version,
    rgbPreference,
    parts: [],
    cables: [],
    sidePanelOpen: true,
    power: { wallConnected: false, psuSwitchOn: false, pressed: false },
    nextSerial: 1,
  };
}

/** Every retention mechanism of a new part starts closed; an LGA socket also has its cover on. */
function initialMechanisms(entry: CatalogEntry): { mechanisms?: Record<string, MechanismState> } {
  const out: Record<string, MechanismState> = {};
  for (const m of entry.mountPoints) {
    // A board's M.2 heatsink starts fitted, its screws in and the film still on its thermal pad.
    if (m.kind === "m2_slot" && m.heatsink) { out[m.heatsink.id] = "closed"; out[`${m.heatsink.id}:screws`] = "closed"; out[`${m.heatsink.id}:film`] = "closed"; }
    if (!m.retention) continue;
    // A screw-held M.2 slot starts with no stand at the length hole and no screw in ("open").
    if (m.retention.kind === "m2_screw") { out[m.retention.id] = "open"; out[`${m.retention.id}:stand`] = "open"; continue; }
    out[m.retention.id] = "closed";
    if (m.retention.kind === "lga_load_plate") { out[`${m.retention.id}:cover`] = "closed"; out[`${m.retention.id}:lever`] = "closed"; }
    // A slot with a clip at each end: the near clip is its own mechanism.
    if (m.retention.kind === "dimm_latch" && m.retention.latches === "both") out[`${m.retention.id}:near`] = "closed";
  }
  return Object.keys(out).length ? { mechanisms: out } : {};
}

const isLatch = (kind: RetentionSpec["kind"] | undefined) => kind === "dimm_latch" || kind === "pcie_latch";

const retentionName = (kind: RetentionSpec["kind"]) =>
  kind === "dimm_latch" ? L("The slot's latch", "مشبك الفتحة")
  : kind === "pcie_latch" ? L("The PCIe slot latch", "مشبك فتحة PCIe")
  : kind === "slot_covers" ? L("The case's expansion slot covers", "أغطية فتحات التوسعة في الكيس")
  : kind === "m2_qlatch" ? L("The M.2 Q-Latch", "مشبك M.2 ‏(Q-Latch)")
  : kind === "m2_screw" ? L("The M.2 screw", "برغي M.2")
  : kind === "zif_lever" ? L("The socket lever", "ذراع المقبس")
  : L("The socket's load plate and lever", "غطا المقبس وذراعه");

const HEATSINK_NAME = L("The M.2 heatsink", "مشتّت M.2");
/** The M.2 slots of a board under the heatsink with this id. */
const slotsUnderHeatsink = (entry: CatalogEntry, hsId: string) => entry.mountPoints.filter((m) => m.kind === "m2_slot" && m.heatsink?.id === hsId);
/** True while an M.2 place cannot be reached: its heatsink is on, or (screw-held) its stand is not fitted. */
function m2Blocker(host: InstalledPart, place: MountPointSpec | undefined): Localized | null {
  if (place?.kind !== "m2_slot") return null;
  if (place.heatsink && (host.mechanisms?.[place.heatsink.id] ?? "closed") !== "open") return HEATSINK_NAME;
  return null;
}

/** Detailed builds: what has to be done to a part before it goes in a place. Null when nothing is missing. */
function prepGate(v: View, instanceId: string, place: MountPointSpec, fail: (code: PCDiagnosticCode, target: TutorTargetRef, params: TextParams) => PCActionResult) {
  const part = partById(v, instanceId);
  const entry = part && entryOf(v, part);
  if (!part || !entry) return null;
  const prep = part.prep ?? {};
  const target = pcTarget.part(instanceId);
  const missing = (en: string, ar: string) => fail("prep_missing", target, { what: L(en, ar) });
  if (place.kind === "cpu_cooler_mount" && entry.category === "cooling" && entry.spec.paste) {
    if (entry.spec.paste.film && prep.film !== "removed") return missing("Peel the protective film off the cooler's plate first.", "شيل غلاف الحماية عن قاعدة المبرّد أول.");
    if (entry.spec.paste.supplied === "tube" && prep.paste !== "applied") return missing("Put a small amount of thermal paste on the CPU first.", "حط كمية صغيرة من المعجون الحراري على المعالج أول.");
  }
  if (place.kind === "motherboard_tray" && entry.category === "motherboard") {
    if (prep.standoffs !== "checked") return missing("Check the case's standoffs line up with the board's screw holes first.", "تأكد إن القواعد في الكيس تطابق فتحات البراغي في اللوحة أول.");
    if (entry.spec.ioShield?.kind === "separate" && prep.io_shield !== "fitted") return missing("Press the board's I/O shield into the case's rear opening first.", "ركّب غطا المنافذ الخلفي في فتحة الكيس أول.");
  }
  if (place.kind === "psu_bay" && entry.category === "psu") {
    if (!prep.psu_fan) return missing("Decide which way the PSU's fan faces before sliding it in.", "حدّد اتجاه مروحة مزوّد الطاقة قبل ما تدخله.");
    // Fan up or down both fit (Corsair: the choice affects airflow, not fit); the page only advises a direction.
  }
  if ((place.kind === "fan_mount" || place.kind === "radiator_mount") && entry.category === "fan") {
    if (!prep.airflow) return missing("Check the arrows on the fan frame and choose which way its air will move first.", "شوف الأسهم على إطار المروحة وحدّد وين يمشي الهوا أول.");
    // The arrows can be set either way: front/bottom intake and rear/top exhaust are the usual advice, not a mounting limit.
  }
  return null;
}

export const DEFAULT_LIGHTING = { enabled: true, color: "#00e5ff", effect: "static" } as const;

/** Changes that are safe while the machine is running. Everything else needs the power off first. */
const ALLOWED_WHILE_ON: PCAction["type"][] = [
  "power_off",
  "set_part_lighting",
  "set_rgb_preference",
  "set_cable_tidy",
  "set_side_panel",
  "set_wall_power",
  "set_psu_switch",
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function applyAction(state: PCBuildState, action: PCAction, catalog: PCCatalog, ctx: PCEvaluationContext = {}): PCActionResult {
  const v = makeView(state, catalog, ctx);
  const fail = (code: PCDiagnosticCode, target: TutorTargetRef, params: TextParams = {}, cls: PCDiagnosticClass = "assembly"): PCActionResult => ({
    ok: false,
    state,
    rejection: makeDiag(v, code, cls, "blocking", { subject: action.type, target, params }),
  });
  const rejected = (rejection: PCDiagnostic): PCActionResult => ({ ok: false, state, rejection });
  const unknown = (what: string, target: TutorTargetRef) => fail("unknown_reference", target, { what });
  const invalid = (target: TutorTargetRef, en: string, ar: string) => fail("invalid_action", target, { why: L(en, ar) });
  const ok = (next: Partial<PCBuildState>, created?: { instanceId?: string; cableIds?: string[] }): PCActionResult => ({
    ok: true,
    state: { ...state, ...next },
    ...(created ? { created } : {}),
  });
  const withPart = (id: string, change: (p: InstalledPart) => InstalledPart) => state.parts.map((p) => (p.instanceId === id ? change(p) : p));
  const withCable = (id: string, change: (c: CableInstance) => CableInstance) => state.cables.map((c) => (c.id === id ? change(c) : c));
  const detailed = state.mechanics === "detailed";

  if (state.power.pressed && !ALLOWED_WHILE_ON.includes(action.type)) return fail("power_is_on", pcTarget.setting("power-button"));

  switch (action.type) {
    case "set_rgb_preference":
      return ok({ rgbPreference: action.preference });

    case "add_part": {
      const entry = v.index.byId.get(action.catalogId);
      if (!entry) return unknown(action.catalogId, pcTarget.setting("rgb-preference"));
      if (entry.category === "cable") return invalid(pcTarget.setting("rgb-preference"), "A loose cable is added with add_cable.", "الكيبل المنفصل ينضاف بـ add_cable.");
      const instanceId = `${entry.category}-${state.nextSerial}`;
      const part: InstalledPart = {
        instanceId,
        catalogId: entry.id,
        attachments: [],
        ...(entry.rgb ? { lighting: { ...DEFAULT_LIGHTING } } : {}),
        ...(entry.category === "motherboard" ? { biosVersion: entry.spec.factoryBiosVersion } : {}),
        ...(entry.category === "storage" ? { bootable: true } : {}),
        ...(detailed ? initialMechanisms(entry) : {}),
      };
      const cables: CableInstance[] = entry.cables.flatMap((spec) =>
        Array.from({ length: spec.quantity }, (_, k) => ({
          id: spec.quantity > 1 ? `${instanceId}.${spec.id}-${k + 1}` : `${instanceId}.${spec.id}`,
          catalogId: entry.id,
          cableSpecId: spec.id,
          ownerInstanceId: instanceId,
          ends: Object.fromEntries(spec.ends.map((e) => [e.id, null])),
          tidied: false,
        })),
      );
      return ok(
        { parts: [...state.parts, part], cables: [...state.cables, ...cables], nextSerial: state.nextSerial + 1 },
        { instanceId, cableIds: cables.map((c) => c.id) },
      );
    }

    case "remove_part": {
      if (!partById(v, action.instanceId)) return unknown(action.instanceId, pcTarget.part(action.instanceId));
      const goneCables = new Set(state.cables.filter((c) => c.ownerInstanceId === action.instanceId).map((c) => c.id));
      const dangling = (to: PortRef | null) => !!to && (to.kind === "part" ? to.instanceId === action.instanceId : goneCables.has(to.cableId));
      return ok({
        // Parts installed on the removed part go back to the bench.
        parts: state.parts
          .filter((p) => p.instanceId !== action.instanceId)
          .map((p) =>
            p.attachments.some((a) => a.target.hostInstanceId === action.instanceId)
              ? { ...p, attachments: p.attachments.filter((a) => a.target.hostInstanceId !== action.instanceId) }
              : p,
          ),
        cables: state.cables
          .filter((c) => !goneCables.has(c.id))
          .map((c) =>
            Object.values(c.ends).some(dangling) ? { ...c, ends: Object.fromEntries(Object.entries(c.ends).map(([k, to]) => [k, dangling(to) ? null : to])) } : c,
          ),
      });
    }

    case "set_mechanics":
      return ok({ mechanics: action.mode, parts: state.parts.map((p) => {
        const entry = v.index.byId.get(p.catalogId);
        return entry && !p.mechanisms ? { ...p, ...initialMechanisms(entry) } : p;
      }) });

    case "set_mechanism": {
      const host = partById(v, action.instanceId);
      const entry = host && entryOf(v, host);
      if (!host || !entry) return unknown(action.instanceId, pcTarget.part(action.instanceId));
      // An Intel load plate has its lever as a second mechanism, `<plate>:lever` (released and up = "open").
      const leverOf = action.mechanismId.endsWith(":lever") ? action.mechanismId.slice(0, -":lever".length) : null;
      const nearOf = action.mechanismId.endsWith(":near") ? action.mechanismId.slice(0, -":near".length) : null;
      // A board's M.2 heatsink: `<id>` (lifted off = "open"), `<id>:screws` (loosened = "open"), `<id>:film` (peeled = "open").
      const hsBase = action.mechanismId.replace(/:(screws|film)$/, "");
      const covered = slotsUnderHeatsink(entry, hsBase);
      if (covered.length) {
        const m = host.mechanisms ?? {};
        if ((m[action.mechanismId] ?? "closed") === action.state) return ok({});
        const why = (en: string, ar: string) => fail("retention_blocked", pcTarget.part(host.instanceId), { why: L(en, ar) });
        const set = () => ok({ parts: state.parts.map((p) => (p.instanceId === host.instanceId ? { ...p, mechanisms: { ...m, [action.mechanismId]: action.state } } : p)) });
        const fitted = (m[hsBase] ?? "closed") !== "open";
        if (action.mechanismId.endsWith(":screws")) {
          return fitted ? set() : why("Put the heatsink back on first; its screws hold it to the board.", "رجّع المشتّت مكانه أول؛ براغيه تثبّته على اللوحة.");
        }
        if (action.mechanismId.endsWith(":film")) {
          if (action.state === "closed") return invalid(pcTarget.part(host.instanceId), "A peeled film is not put back on.", "الغلاف اللي انشال ما يرجع.");
          return fitted ? why("Lift the heatsink off first; the film is on the thermal pad underneath.", "شيل المشتّت أول؛ الغلاف على الوسادة الحرارية اللي تحته.") : set();
        }
        if (action.state === "open") return (m[`${hsBase}:screws`] ?? "closed") === "open" ? set() : why("Loosen the heatsink's screws first.", "فك براغي المشتّت أول.");
        const hsSpec = covered[0]!.kind === "m2_slot" ? covered[0]!.heatsink : undefined;
        if (hsSpec?.padFilm && (m[`${hsBase}:film`] ?? "closed") !== "open") return why("Peel the plastic film off the heatsink's thermal pad before refitting it.", "شيل الغلاف البلاستيكي عن الوسادة الحرارية قبل ما ترجّع المشتّت.");
        const loose = covered.some((slot) => state.parts.some((p) => p.attachments.some((a) => a.target.hostInstanceId === host.instanceId && a.target.mountPointId === slot.id && (a.seating !== "seated" || a.fastenersSecured < (slot.fastener?.count ?? 0)))));
        if (loose) return why("Secure the drive under it first: pressed flat and held.", "ثبّت الدسك اللي تحته أول: مضغوط ومقفول.");
        return set();
      }
      // A screw-held M.2 slot's stand: `<slot>-screw:stand` (fitted at the length hole = "closed").
      const standOf = action.mechanismId.endsWith(":stand") ? action.mechanismId.slice(0, -":stand".length) : null;
      const mount = entry.mountPoints.find((m) => m.retention?.id === (leverOf ?? nearOf ?? standOf ?? action.mechanismId)
        && (!leverOf || m.retention.kind === "lga_load_plate") && (!nearOf || (m.retention.kind === "dimm_latch" && m.retention.latches === "both"))
        && (!standOf || m.retention.kind === "m2_screw"));
      if (!mount?.retention) return unknown(`${action.instanceId}/${action.mechanismId}`, pcTarget.part(action.instanceId));
      const ret = mount.retention;
      const at = { hostInstanceId: host.instanceId, mountPointId: mount.id };
      const occupant = state.parts.find((p) => p.attachments.some((a) => a.target.hostInstanceId === at.hostInstanceId && a.target.mountPointId === at.mountPointId));
      const occAttachment = occupant?.attachments.find((a) => a.target.hostInstanceId === at.hostInstanceId && a.target.mountPointId === at.mountPointId);
      const current = host.mechanisms?.[action.mechanismId] ?? "closed";
      if (current === action.state) return ok({});
      const blocked = (en: string, ar: string) => fail("retention_blocked", pcTarget.mount(at), { why: L(en, ar) });
      const lever = mount.fastener?.count ?? 0;
      const setOccupant = (change: { seating?: "placed" | "seated"; fastenersSecured?: number }) =>
        occupant && occAttachment ? (p: InstalledPart) => (p.instanceId === occupant.instanceId ? { ...p, attachments: p.attachments.map((a) => (a === occAttachment ? { ...a, ...change } : a)) } : p) : (p: InstalledPart) => p;
      const setHost = (states: Record<string, MechanismState>) => (p: InstalledPart) => (p.instanceId === host.instanceId ? { ...p, mechanisms: { ...(p.mechanisms ?? {}), ...states } } : p);
      const coolerOn = () => state.parts.some((p) => p.attachments.some((a) => a.target.hostInstanceId === host.instanceId && entry.mountPoints.find((m) => m.id === a.target.mountPointId)?.kind === "cpu_cooler_mount"));
      if (ret.kind === "lga_load_plate") {
        if (host.hardware?.ilm === "removed") return blocked("The ILM is off: the contact frame holds the CPU. Put the ILM back (after taking the frame off) to use the plate and lever.", "الـ ILM مشال: إطار التلامس يمسك المعالج. رجّع الـ ILM (بعد ما تشيل الإطار) عشان تستخدم الغطا والذراع.");
        // Intel's loading mechanism: the lever is released from its retention tab and lifted, then the
        // plate is opened; to close, the plate comes down first, then the lever is pushed down under its tab.
        const leverId = `${ret.id}:lever`;
        const leverUp = (host.mechanisms?.[leverId] ?? "closed") === "open";
        const plateOpen = (host.mechanisms?.[ret.id] ?? "closed") === "open";
        if (coolerOn() && action.state === "open") return blocked("The cooler sits over the socket. Take the cooler off first.", "المبرّد فوق المقبس. شيل المبرّد أول.");
        if (leverOf) {
          if (action.state === "open") return ok({ parts: state.parts.map(setHost({ [leverId]: "open" })).map(setOccupant({ fastenersSecured: 0 })) });
          if (plateOpen) return blocked("Close the load plate first; the lever then holds it down.", "سكّر غطا المقبس أول؛ بعدين الذراع يثبّته.");
          // Locking the lever over a seated CPU pops the protective cover off; it is kept for a later return or repair.
          const cover = occupant ? { [`${ret.id}:cover`]: "open" as MechanismState } : {};
          return ok({ parts: state.parts.map(setHost({ [leverId]: "closed", ...cover })).map(setOccupant({ fastenersSecured: lever })) });
        }
        if (action.state === "open") {
          if (!leverUp) return blocked("Release the lever from its retention tab and lift it first.", "حرّر الذراع من مكانه وارفعه أول.");
          return ok({ parts: state.parts.map(setHost({ [ret.id]: "open" })) });
        }
        if (occupant && occAttachment?.seating !== "seated") return blocked("Lower the CPU fully into the socket before closing the plate.", "نزّل المعالج في المقبس لين الآخر قبل ما تسكّر الغطا.");
        return ok({ parts: state.parts.map(setHost({ [ret.id]: "closed" })) });
      }
      if (ret.kind === "zif_lever") {
        if (action.state === "open") {
          const cooler = state.parts.find((p) => p.attachments.some((a) => a.target.hostInstanceId === host.instanceId && entry.mountPoints.find((m) => m.id === a.target.mountPointId)?.kind === "cpu_cooler_mount"));
          if (cooler) return blocked("The cooler sits over the socket. Take the cooler off first.", "المبرّد فوق المقبس. شيل المبرّد أول.");
          return ok({ parts: state.parts.map(setHost({ [ret.id]: "open" })).map(setOccupant({ fastenersSecured: 0 })) });
        }
        // AM4 (ASUS FAQ 1047659): the lever goes up to 90°, the CPU drops in, the lever comes down. No socket cap is modelled.
        if (occupant && occAttachment?.seating !== "seated") return blocked("Let the CPU drop fully into the socket before lowering the lever.", "خلّ المعالج ينزل في المقبس لين الآخر قبل ما تنزّل الذراع.");
        return ok({ parts: state.parts.map(setHost({ [ret.id]: "closed" })).map(setOccupant({ fastenersSecured: lever })) });
      }
      if (m2Blocker(host, mount)) return blocked("Lift the M.2 heatsink off first; it covers this slot.", "شيل مشتّت M.2 أول؛ هو مغطّي هالفتحة.");
      if (ret.kind === "m2_screw") {
        if (standOf) {
          if (action.state === "open" && occupant) return blocked("Take the drive out before removing its screw stand.", "طلّع الدسك قبل ما تفك قاعدة البرغي.");
          return ok({ parts: state.parts.map(setHost({ [action.mechanismId]: action.state })) });
        }
        // Screwed down over a drive pressed flat onto the stand; taken out, the drive's end springs up.
        if (action.state === "open") return ok({ parts: state.parts.map(setHost({ [ret.id]: "open" })).map(setOccupant({ seating: "placed", fastenersSecured: 0 })) });
        if (!occupant) return blocked("There is no drive here to screw down.", "ما فيه دسك هنا تثبّته بالبرغي.");
        if (occAttachment?.seating !== "seated") return blocked("Press the drive flat onto the stand before screwing it down.", "اضغط الدسك مسطّح على القاعدة قبل ما تثبّته بالبرغي.");
        return ok({ parts: state.parts.map(setHost({ [ret.id]: "closed" })).map(setOccupant({ fastenersSecured: lever })) });
      }
      if (ret.kind === "m2_qlatch") {
        // Turned open, the drive's free end springs up off the standoff; turned shut over a drive pressed flat, it holds it.
        if (action.state === "open") return ok({ parts: state.parts.map(setHost({ [ret.id]: "open" })).map(setOccupant({ seating: "placed", fastenersSecured: 0 })) });
        if (occupant && occAttachment?.seating !== "seated") return blocked("Push the drive fully into the slot before pressing it down and turning the latch.", "ادفع الدسك لين آخر الفتحة قبل ما تنزّله وتلف المشبك.");
        return ok({ parts: state.parts.map(setHost({ [ret.id]: "closed" })).map(setOccupant({ fastenersSecured: lever })) });
      }
      if (ret.kind === "slot_covers") {
        const cardIn = state.parts.some((p) => p.attachments.some((a) => entryOf(v, partById(v, a.target.hostInstanceId) ?? p)?.mountPoints.find((m) => m.id === a.target.mountPointId)?.kind === "pcie_slot" && partById(v, a.target.hostInstanceId)?.attachments[0]?.target.hostInstanceId === host.instanceId));
        if (action.state === "closed" && cardIn) return blocked("A card's bracket is in that opening. Take the card out first.", "حامل الكرت في الفتحة. طلّع الكرت أول.");
        return ok({ parts: state.parts.map(setHost({ [ret.id]: action.state })) });
      }
      // A memory or PCIe latch: closing holds a part that is fully in; opening releases it from its contacts.
      if (action.state === "closed" && occupant && occAttachment?.seating !== "seated") return blocked("Press the module fully in; the latch closes by itself when it is home.", "اضغط الشريحة لين الآخر؛ المشبك يتسكّر لحاله لما تدخل.");
      // A card stays seated when its latch is released (it is lifted out by hand); a module pops up.
      const release = ret.kind === "dimm_latch" ? setOccupant({ seating: "placed", fastenersSecured: 0 }) : (p: InstalledPart) => p;
      return ok({ parts: state.parts.map(setHost({ [action.mechanismId]: action.state })).map(action.state === "open" ? release : (p) => p) });
    }

    case "set_hardware": {
      if (!detailed) return invalid(pcTarget.part(action.instanceId), "Kit hardware is worked on in detailed builds only.", "عدّة التثبيت تنشتغل في التجميعات المفصّلة بس.");
      if (!partById(v, action.instanceId)) return unknown(action.instanceId, pcTarget.part(action.instanceId));
      const result = applyHardware(v, action);
      return result.ok ? ok({ parts: result.parts }) : fail(result.code, pcTarget.part(action.instanceId), { why: result.why });
    }

    case "set_prep": {
      const part = partById(v, action.instanceId);
      const entry = part && entryOf(v, part);
      if (!part || !entry) return unknown(action.instanceId, pcTarget.part(action.instanceId));
      const target = pcTarget.part(part.instanceId);
      const wrong = (en: string, ar: string) => fail("prep_wrong", target, { why: L(en, ar) });
      const allowed: Record<PrepKind, { category: CatalogEntry["category"]; values: string[] }> = {
        paste: { category: "cooling", values: ["applied"] }, film: { category: "cooling", values: ["removed"] },
        standoffs: { category: "motherboard", values: ["checked"] }, io_shield: { category: "motherboard", values: ["fitted"] },
        backplate: { category: "motherboard", values: ["padding", "tape"] },
        psu_fan: { category: "psu", values: ["down", "up"] }, airflow: { category: "fan", values: ["intake", "exhaust"] },
      };
      const rule = allowed[action.prep];
      if (!rule || entry.category !== rule.category || (action.value !== "" && !rule.values.includes(action.value))) {
        return invalid(target, "That step does not apply to this part.", "هذي الخطوة ما تنطبق على هالقطعة.");
      }
      // The socket backplate is supported or taped with the board either outside or inside the case.
      if (action.prep === "backplate") {
        const refusal = backplateRule(v, part, action.value);
        if (refusal) return fail(refusal.code, target, { why: refusal.why });
      } else if (part.attachments.length > 0 && action.prep !== "airflow") return invalid(target, "Take the part out first; this is done before it is fitted.", "طلّع القطعة أول؛ هذي الخطوة قبل التركيب.");
      if (part.attachments.length > 0 && action.prep !== "backplate") return invalid(target, "Take the fan off before turning it round.", "فك المروحة قبل ما تقلبها.");
      if (action.value !== "" && entry.category === "cooling") {
        const paste = entry.spec.paste;
        if (action.prep === "paste" && paste?.supplied === "pre_applied" && part.hardware?.contact !== "used") return wrong("This cooler's paste is already on its plate. Adding more on top makes too thick a layer.", "المعجون محطوط على قاعدة هالمبرّد من المصنع. إضافة فوقه تخلّي الطبقة سميكة زيادة.");
        if (action.prep === "paste" && part.prep?.paste === "applied") return wrong("There is paste on already; one small amount is enough.", "فيه معجون من قبل؛ كمية صغيرة وحدة تكفي.");
        if (action.prep === "film" && paste?.film === false) return wrong("This cooler's plate has no protective film to peel.", "قاعدة هالمبرّد ما عليها غلاف حماية ينشال.");
        if (action.prep === "film" && !paste?.film) return wrong("The lab has no record of a film on this cooler's plate. On a real one, look: peel a film if there is one.", "ما عندنا معلومة عن غلاف على قاعدة هالمبرّد. على القطعة الحقيقية شوف بنفسك: إذا فيه غلاف شيله.");
      }
      if (action.value !== "" && entry.category === "motherboard" && action.prep === "io_shield" && entry.spec.ioShield?.kind === "pre_mounted") {
        return wrong("This board's I/O shield is already fixed to it. There is no separate plate to fit in the case.", "غطا المنافذ الخلفي مركّب على هاللوحة من المصنع. ما فيه غطا منفصل تركّبه في الكيس.");
      }
      const prep = { ...(part.prep ?? {}) };
      if (action.value === "") delete prep[action.prep];
      else prep[action.prep] = action.value;
      return ok({ parts: withPart(part.instanceId, (p) => ({ ...p, prep })) });
    }

    case "mount_part": {
      const check = checkMount(v, action.instanceId, action.role, action.target);
      if (!check.ok) return rejected(check.rejection);
      const hostPart = partById(v, action.target.hostInstanceId);
      const hostEntry = hostPart && entryOf(v, hostPart);
      const place = hostEntry?.mountPoints.find((m) => m.id === action.target.mountPointId);
      const coolerPart = partById(v, action.instanceId);
      const mountingGate = detailed && place?.kind === "cpu_cooler_mount" && coolerPart ? coolerMountingGate(v, coolerPart) : null;
      if (mountingGate) return fail(mountingGate.code, pcTarget.mount(action.target), { why: mountingGate.why });
      const gate = detailed && place ? prepGate(v, action.instanceId, place, fail) : null;
      if (gate) return gate;
      if (detailed && hostPart && m2Blocker(hostPart, place)) return fail("retention_blocked", pcTarget.mount(action.target), { why: L("Lift the M.2 heatsink off first; it covers this slot.", "شيل مشتّت M.2 أول؛ هو مغطّي هالفتحة.") });
      if (detailed && place?.retention?.kind === "m2_screw" && hostPart?.mechanisms?.[`${place.retention.id}:stand`] !== "closed") {
        return fail("retention_blocked", pcTarget.mount(action.target), { why: L("Fit the screw stand at the drive's length hole first.", "ركّب قاعدة البرغي في فتحة طول الدسك أول.") });
      }
      if (detailed && place?.retention && place.retention.kind !== "slot_covers" && (hostPart?.mechanisms?.[place.retention.id] ?? "closed") !== "open") {
        return fail("retention_closed", pcTarget.mount(action.target), { mechanism: retentionName(place.retention.kind) });
      }
      if (detailed && place?.retention?.kind === "dimm_latch" && place.retention.latches === "both" && (hostPart?.mechanisms?.[`${place.retention.id}:near`] ?? "closed") !== "open") {
        return fail("retention_closed", pcTarget.mount(action.target), { mechanism: retentionName(place.retention.kind) });
      }
      // A card's bracket needs the case's slot covers out once the board is in a case.
      if (detailed && place?.kind === "pcie_slot" && hostPart) {
        const caseAt = hostPart.attachments[0]?.target;
        const casePart = caseAt && partById(v, caseAt.hostInstanceId);
        const covers = casePart && entryOf(v, casePart)?.mountPoints.find((m) => m.retention?.kind === "slot_covers")?.retention;
        if (covers && (casePart.mechanisms?.[covers.id] ?? "closed") !== "open") return fail("retention_closed", pcTarget.mount(action.target), { mechanism: retentionName("slot_covers") });
      }
      if (detailed && place?.keying) {
        const a = action.alignment;
        if (!a) return fail("alignment_required", pcTarget.mount(action.target));
        const turn = ((Math.round(a.rotationDeg) % 360) + 360) % 360;
        const valid = [place.keying.rotationDeg, ...(place.keying.alsoValid ?? [])].map((r) => ((r % 360) + 360) % 360);
        const placeName = place.kind === "cpu_socket" ? L("socket", "المقبس") : L("slot", "الفتحة");
        if (!valid.includes(turn)) {
          return fail("keying_wrong", pcTarget.mount(action.target), { mark: place.keying.mark === "triangle" ? L("triangle", "المثلث") : place.keying.mark === "bracket" ? L("bracket", "الحامل المعدني") : L("notch", "الشق"), place: placeName });
        }
        const distance = Math.hypot(a.offsetMm[0], a.offsetMm[1]);
        if (distance > place.keying.toleranceMm) return fail("alignment_off", pcTarget.mount(action.target), { distance: Math.round(distance * 10) / 10, place: placeName });
        const tilt = place.keying.insertTiltDeg;
        if (tilt && (a.tiltDeg === undefined || a.tiltDeg < tilt[0] || a.tiltDeg > tilt[1])) return fail("insert_angle_wrong", pcTarget.mount(action.target), { low: tilt[0], high: tilt[1] });
      }
      return ok({
        parts: withPart(action.instanceId, (p) => ({
          ...p,
          attachments: [...p.attachments, { role: check.role, target: { ...action.target }, seating: "placed", fastenersSecured: 0 }],
        })),
      });
    }

    case "unmount_part":
    case "set_seating":
    case "set_fasteners": {
      const part = partById(v, action.instanceId);
      const target = pcTarget.part(action.instanceId);
      if (!part) return unknown(action.instanceId, target);
      const attachment = action.role ? part.attachments.find((a) => a.role === action.role) : part.attachments.length === 1 ? part.attachments[0] : undefined;
      if (!attachment) {
        return part.attachments.length > 1 && !action.role
          ? invalid(target, "This part is installed in more than one place; say which role is meant.", "هذي القطعة مركّبة في أكثر من مكان؛ حدّد أي جزء تقصد.")
          : invalid(target, "This part is not installed there.", "هذي القطعة مو مركّبة هناك.");
      }
      const others = part.attachments.filter((a) => a !== attachment);
      const hostOf = partById(v, attachment.target.hostInstanceId);
      const placeSpec = mountSpec(v, attachment.target);
      const holder = placeSpec?.retention?.kind === "slot_covers" ? undefined : placeSpec?.retention;
      const nearHeld = holder?.kind === "dimm_latch" && holder.latches === "both" && (hostOf?.mechanisms?.[`${holder.id}:near`] ?? "closed") !== "open";
      const held = detailed && holder && ((hostOf?.mechanisms?.[holder.id] ?? "closed") !== "open" || nearHeld);
      if (action.type === "unmount_part") {
        // A card comes out only with its power unplugged and its bracket unscrewed, then its latch released.
        if (detailed && placeSpec?.kind === "pcie_slot") {
          if (state.cables.some((c) => Object.values(c.ends).some((e) => e?.kind === "part" && e.instanceId === part.instanceId))) {
            return invalid(pcTarget.mount(attachment.target), "Unplug the card's power cable first.", "افصل كيبل طاقة الكرت أول.");
          }
          if (attachment.fastenersSecured > 0) return invalid(pcTarget.mount(attachment.target), "Remove the bracket screws first.", "فك براغي الحامل أول.");
        }
        if (detailed && hostOf && m2Blocker(hostOf, placeSpec)) return fail("retention_blocked", pcTarget.mount(attachment.target), { why: L("Lift the M.2 heatsink off first; it covers this slot.", "شيل مشتّت M.2 أول؛ هو مغطّي هالفتحة.") });
        if (detailed && placeSpec?.kind === "cpu_cooler_mount" && coolerMounting(v, part)) {
          if (part.hardware?.screws && /[12]/.test(part.hardware.screws)) return fail("retention_blocked", pcTarget.mount(attachment.target), { why: L("Loosen and take out the cooler's screws first.", "فكّ براغي المبرّد وطلّعها أول.") });
          return ok({ parts: state.parts.map((p) => (p.instanceId === part.instanceId ? liftedCooler({ ...p, attachments: others }) : p)) });
        }
        if (detailed && hostOf?.hardware?.frame === "placed" && placeSpec?.kind === "cpu_socket") return fail("retention_blocked", pcTarget.mount(attachment.target), { why: L("The contact frame is over the CPU. Take the frame off first.", "إطار التلامس فوق المعالج. شيل الإطار أول.") });
        if (held) return fail("retention_closed", pcTarget.mount(attachment.target), { mechanism: retentionName(placeSpec!.retention!.kind) });
        return ok({ parts: withPart(part.instanceId, (p) => ({ ...p, attachments: others })) });
      }

      const update = (change: Partial<typeof attachment>) =>
        ok({ parts: withPart(part.instanceId, (p) => ({ ...p, attachments: p.attachments.map((a) => (a === attachment ? { ...a, ...change } : a)) })) });
      if (action.type === "set_seating") {
        // Detailed builds: a CPU seats only while its plate is open; a module pressed home snaps its latch shut.
        if (held && !isLatch(placeSpec?.retention?.kind)) return fail("retention_closed", pcTarget.mount(attachment.target), { mechanism: retentionName(placeSpec!.retention!.kind) });
        const latch = detailed && isLatch(placeSpec?.retention?.kind) && action.seating === "seated" ? placeSpec!.retention!.id : null;
        const ringHeld = detailed && placeSpec?.kind === "cpu_cooler_mount" && coolerMounting(v, part)?.kind === "retention_ring";
        const next = { seating: action.seating, ...(action.seating === "seated" ? (ringHeld ? { fastenersSecured: placeSpec?.fastener?.count ?? 0 } : {}) : { fastenersSecured: 0 }) };
        if (!latch) return update(next);
        return ok({ parts: state.parts.map((p) => {
          if (p.instanceId === part.instanceId) return { ...p, attachments: p.attachments.map((a) => (a === attachment ? { ...a, ...next } : a)) };
          if (p.instanceId === attachment.target.hostInstanceId) return { ...p, mechanisms: { ...(p.mechanisms ?? {}), [latch]: "closed", ...(placeSpec?.retention?.kind === "dimm_latch" && placeSpec.retention.latches === "both" ? { [`${latch}:near`]: "closed" } : {}) } };
          return p;
        }) });
      }
      // In detailed builds a lever is moved with set_mechanism, so the scene and the count never disagree.
      if (detailed && holder && !isLatch(holder.kind)) return invalid(pcTarget.mount(attachment.target), "Use the lever or latch itself.", "استخدم الذراع أو المشبك نفسه.");
      if (detailed && placeSpec?.kind === "cpu_cooler_mount" && coolerMounting(v, part)?.bodyScrews) return invalid(pcTarget.mount(attachment.target), "This cooler's screws go in one at a time: a couple of turns each, then tightened.", "براغي هالمبرّد تدخل وحدة وحدة: كم لفّة لكل واحد، وبعدين تنربط.");
      const count = mountSpec(v, attachment.target)?.fastener?.count ?? 0;
      if (count === 0) return invalid(pcTarget.mount(attachment.target), "Nothing needs to be secured at this position.", "ما في شي يحتاج تقفيل في هذا المكان.");
      if (!Number.isInteger(action.secured) || action.secured < 0 || action.secured > count) {
        return invalid(pcTarget.mount(attachment.target), `This position has ${count} fastener(s).`, `هذا المكان فيه ${count} مثبّتات.`);
      }
      if (action.secured > 0 && attachment.seating !== "seated") {
        const entry = entryOf(v, part);
        return fail("seating_blocked", pcTarget.mount(attachment.target), { part: entry ? displayName(entry) : part.instanceId });
      }
      return update({ fastenersSecured: action.secured });
    }

    case "add_cable": {
      const entry = v.index.byId.get(action.catalogId);
      const specId = action.cableSpecId ?? (entry && entry.cables.length === 1 ? entry.cables[0]?.id : undefined);
      const spec = specId ? cableSpecOf(entry, specId) : undefined;
      if (!entry || !spec) return unknown(`${action.catalogId}/${action.cableSpecId ?? ""}`, pcTarget.setting("rgb-preference"));
      if (spec.attachment === "captive") {
        return invalid(pcTarget.setting("rgb-preference"), "That cable is fixed to its part and cannot be taken on its own.", "هذا الكيبل ثابت في قطعته وما ينوخذ لحاله.");
      }
      const id = `cable-${state.nextSerial}`;
      const cable: CableInstance = {
        id,
        catalogId: entry.id,
        cableSpecId: spec.id,
        ownerInstanceId: null,
        ends: Object.fromEntries(spec.ends.map((e) => [e.id, null])),
        tidied: false,
      };
      return ok({ cables: [...state.cables, cable], nextSerial: state.nextSerial + 1 }, { cableIds: [id] });
    }

    case "remove_cable": {
      const cable = cableById(v, action.cableId);
      if (!cable) return unknown(action.cableId, pcTarget.setting("rgb-preference"));
      if (cable.ownerInstanceId) {
        return invalid(pcTarget.part(cable.ownerInstanceId), "This cable belongs to a part; unplug it instead, or remove the part.", "هذا الكيبل تابع لقطعة؛ افصله أو شيل القطعة.");
      }
      const intoIt = (to: PortRef | null) => !!to && to.kind === "cable" && to.cableId === cable.id;
      return ok({
        cables: state.cables
          .filter((c) => c.id !== cable.id)
          .map((c) => (Object.values(c.ends).some(intoIt) ? { ...c, ends: Object.fromEntries(Object.entries(c.ends).map(([k, to]) => [k, intoIt(to) ? null : to])) } : c)),
      });
    }

    case "connect_cable_end": {
      const check = checkConnect(v, action.cableId, action.endId, action.to);
      if (!check.ok) return rejected(check.rejection);
      return ok({ cables: withCable(action.cableId, (c) => ({ ...c, ends: { ...c.ends, [action.endId]: { ...action.to } } })) });
    }

    case "disconnect_cable_end": {
      const cable = cableById(v, action.cableId);
      const target = pcTarget.cableEnd(action.cableId, action.endId);
      if (!cable || !(action.endId in cable.ends)) return unknown(`${action.cableId}/${action.endId}`, target);
      if (!cable.ends[action.endId]) return invalid(target, "This end is not plugged in.", "هذا الطرف مو موصّل.");
      return ok({ cables: withCable(cable.id, (c) => ({ ...c, ends: { ...c.ends, [action.endId]: null } })) });
    }

    case "set_cable_tidy": {
      if (!cableById(v, action.cableId)) return unknown(action.cableId, pcTarget.setting("rgb-preference"));
      return ok({ cables: withCable(action.cableId, (c) => ({ ...c, tidied: action.tidied })) });
    }

    case "set_part_lighting": {
      const part = partById(v, action.instanceId);
      const target = pcTarget.part(action.instanceId);
      if (!part) return unknown(action.instanceId, target);
      if (!entryOf(v, part)?.rgb || !part.lighting) return invalid(target, "This part has no lighting hardware.", "هذي القطعة ما فيها إضاءة أصلًا.");
      if (action.lighting.color !== undefined && !HEX.test(action.lighting.color)) return invalid(target, "Colour must be #rrggbb.", "اللون لازم يكون بصيغة #rrggbb.");
      const lighting = { ...part.lighting, ...action.lighting };
      return ok({ parts: withPart(part.instanceId, (p) => ({ ...p, lighting })) });
    }

    case "set_side_panel":
      return ok({ sidePanelOpen: action.open });
    case "set_wall_power":
      return ok({ power: { ...state.power, wallConnected: action.connected } });
    case "set_psu_switch":
      return ok({ power: { ...state.power, psuSwitchOn: action.on } });
    case "press_power":
      return ok({ power: { ...state.power, pressed: true } });
    case "power_off":
      if (!state.power.pressed) return invalid(pcTarget.setting("power-button"), "The computer is already off.", "الكمبيوتر مطفّي أصلًا.");
      return ok({ power: { ...state.power, pressed: false } });

    case "update_bios": {
      const part = partById(v, action.instanceId);
      const entry = entryOf(v, part);
      const target = pcTarget.part(action.instanceId);
      if (!part || !entry) return unknown(action.instanceId, target);
      if (entry.category !== "motherboard") return invalid(target, "Only a motherboard has a BIOS to update.", "بس اللوحة الأم فيها بايوس يتحدّث.");
      if (!entry.spec.biosVersions.some((b) => b.version === action.version)) return unknown(`BIOS ${action.version}`, target);
      return ok({ parts: withPart(part.instanceId, (p) => ({ ...p, biosVersion: action.version })) });
    }

    case "set_storage_bootable": {
      const part = partById(v, action.instanceId);
      const target = pcTarget.part(action.instanceId);
      if (!part) return unknown(action.instanceId, target);
      if (entryOf(v, part)?.category !== "storage") return invalid(target, "Only a storage drive can hold an operating system.", "بس قرص التخزين يشيل نظام تشغيل.");
      return ok({ parts: withPart(part.instanceId, (p) => ({ ...p, bootable: action.bootable })) });
    }
  }
}

// View is re-exported for callers that want to run several queries on one state.
export type { View };
