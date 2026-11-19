// The build reducer: (state, action, catalog) -> new state or a rejection with its reason.
// Pure and deterministic: no clock, no randomness, input state is never mutated.
import type {
  CableInstance,
  CatalogEntry,
  MechanismState,
  RetentionSpec,
  InstalledPart,
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
    if (!m.retention) continue;
    out[m.retention.id] = "closed";
    if (m.retention.kind === "lga_load_plate") out[`${m.retention.id}:cover`] = "closed";
  }
  return Object.keys(out).length ? { mechanisms: out } : {};
}

const isLatch = (kind: RetentionSpec["kind"] | undefined) => kind === "dimm_latch" || kind === "pcie_latch";

const retentionName = (kind: RetentionSpec["kind"]) =>
  kind === "dimm_latch" ? L("The slot's latch", "مشبك الفتحة")
  : kind === "pcie_latch" ? L("The PCIe slot latch", "مشبك فتحة PCIe")
  : kind === "slot_covers" ? L("The case's expansion slot covers", "أغطية فتحات التوسعة في الكيس")
  : kind === "m2_qlatch" ? L("The M.2 Q-Latch", "مشبك M.2 ‏(Q-Latch)")
  : kind === "zif_lever" ? L("The socket lever", "ذراع المقبس")
  : L("The socket's load plate and lever", "غطا المقبس وذراعه");

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
      const mount = entry.mountPoints.find((m) => m.retention?.id === action.mechanismId);
      if (!mount?.retention) return unknown(`${action.instanceId}/${action.mechanismId}`, pcTarget.part(action.instanceId));
      const ret = mount.retention;
      const at = { hostInstanceId: host.instanceId, mountPointId: mount.id };
      const occupant = state.parts.find((p) => p.attachments.some((a) => a.target.hostInstanceId === at.hostInstanceId && a.target.mountPointId === at.mountPointId));
      const occAttachment = occupant?.attachments.find((a) => a.target.hostInstanceId === at.hostInstanceId && a.target.mountPointId === at.mountPointId);
      const current = host.mechanisms?.[ret.id] ?? "closed";
      if (current === action.state) return ok({});
      const blocked = (en: string, ar: string) => fail("retention_blocked", pcTarget.mount(at), { why: L(en, ar) });
      const lever = mount.fastener?.count ?? 0;
      const setOccupant = (change: { seating?: "placed" | "seated"; fastenersSecured?: number }) =>
        occupant && occAttachment ? (p: InstalledPart) => (p.instanceId === occupant.instanceId ? { ...p, attachments: p.attachments.map((a) => (a === occAttachment ? { ...a, ...change } : a)) } : p) : (p: InstalledPart) => p;
      const setHost = (states: Record<string, MechanismState>) => (p: InstalledPart) => (p.instanceId === host.instanceId ? { ...p, mechanisms: { ...(p.mechanisms ?? {}), ...states } } : p);
      if (ret.kind === "lga_load_plate" || ret.kind === "zif_lever") {
        if (action.state === "open") {
          const cooler = state.parts.find((p) => p.attachments.some((a) => a.target.hostInstanceId === host.instanceId && entry.mountPoints.find((m) => m.id === a.target.mountPointId)?.kind === "cpu_cooler_mount"));
          if (cooler) return blocked("The cooler sits over the socket. Take the cooler off first.", "المبرّد فوق المقبس. شيل المبرّد أول.");
          return ok({ parts: state.parts.map(setHost({ [ret.id]: "open" })).map(setOccupant({ fastenersSecured: 0 })) });
        }
        if (occupant && occAttachment?.seating !== "seated") return blocked("Lower the CPU fully into the socket before closing the plate.", "نزّل المعالج في المقبس لين الآخر قبل ما تسكّر الغطا.");
        // Closing over a seated CPU pops the socket cover off; it is kept for a later return or repair.
        const cover = occupant ? { [`${ret.id}:cover`]: "open" as MechanismState } : {};
        return ok({ parts: state.parts.map(setHost({ [ret.id]: "closed", ...cover })).map(setOccupant({ fastenersSecured: lever })) });
      }
      if (ret.kind === "m2_qlatch") {
        // Turned open, the drive's free end springs up off the standoff; turned shut over a drive pressed flat, it holds it.
        if (action.state === "open") return ok({ parts: state.parts.map(setHost({ [ret.id]: "open" })).map(setOccupant({ fastenersSecured: 0 })) });
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
      return ok({ parts: state.parts.map(setHost({ [ret.id]: action.state })).map(action.state === "open" ? release : (p) => p) });
    }

    case "mount_part": {
      const check = checkMount(v, action.instanceId, action.role, action.target);
      if (!check.ok) return rejected(check.rejection);
      const hostPart = partById(v, action.target.hostInstanceId);
      const hostEntry = hostPart && entryOf(v, hostPart);
      const place = hostEntry?.mountPoints.find((m) => m.id === action.target.mountPointId);
      if (detailed && place?.retention && place.retention.kind !== "slot_covers" && (hostPart?.mechanisms?.[place.retention.id] ?? "closed") !== "open") {
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
      const held = detailed && holder && (hostOf?.mechanisms?.[holder.id] ?? "closed") !== "open";
      if (action.type === "unmount_part") {
        // A card comes out only with its power unplugged and its bracket unscrewed, then its latch released.
        if (detailed && placeSpec?.kind === "pcie_slot") {
          if (state.cables.some((c) => Object.values(c.ends).some((e) => e?.kind === "part" && e.instanceId === part.instanceId))) {
            return invalid(pcTarget.mount(attachment.target), "Unplug the card's power cable first.", "افصل كيبل طاقة الكرت أول.");
          }
          if (attachment.fastenersSecured > 0) return invalid(pcTarget.mount(attachment.target), "Remove the bracket screws first.", "فك براغي الحامل أول.");
        }
        if (held) return fail("retention_closed", pcTarget.mount(attachment.target), { mechanism: retentionName(placeSpec!.retention!.kind) });
        return ok({ parts: withPart(part.instanceId, (p) => ({ ...p, attachments: others })) });
      }

      const update = (change: Partial<typeof attachment>) =>
        ok({ parts: withPart(part.instanceId, (p) => ({ ...p, attachments: p.attachments.map((a) => (a === attachment ? { ...a, ...change } : a)) })) });
      if (action.type === "set_seating") {
        // Detailed builds: a CPU seats only while its plate is open; a module pressed home snaps its latch shut.
        if (held && !isLatch(placeSpec?.retention?.kind)) return fail("retention_closed", pcTarget.mount(attachment.target), { mechanism: retentionName(placeSpec!.retention!.kind) });
        const latch = detailed && isLatch(placeSpec?.retention?.kind) && action.seating === "seated" ? placeSpec!.retention!.id : null;
        const next = { seating: action.seating, ...(action.seating === "seated" ? {} : { fastenersSecured: 0 }) };
        if (!latch) return update(next);
        return ok({ parts: state.parts.map((p) => {
          if (p.instanceId === part.instanceId) return { ...p, attachments: p.attachments.map((a) => (a === attachment ? { ...a, ...next } : a)) };
          if (p.instanceId === attachment.target.hostInstanceId) return { ...p, mechanisms: { ...(p.mechanisms ?? {}), [latch]: "closed" } };
          return p;
        }) });
      }
      // In detailed builds a lever is moved with set_mechanism, so the scene and the count never disagree.
      if (detailed && holder && !isLatch(holder.kind)) return invalid(pcTarget.mount(attachment.target), "Use the lever or latch itself.", "استخدم الذراع أو المشبك نفسه.");
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
