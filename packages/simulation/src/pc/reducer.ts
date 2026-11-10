// The build reducer: (state, action, catalog) -> new state or a rejection with its reason.
// Pure and deterministic: no clock, no randomness, input state is never mutated.
import type {
  CableInstance,
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

    case "mount_part": {
      const check = checkMount(v, action.instanceId, action.role, action.target);
      if (!check.ok) return rejected(check.rejection);
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
      if (action.type === "unmount_part") return ok({ parts: withPart(part.instanceId, (p) => ({ ...p, attachments: others })) });

      const update = (change: Partial<typeof attachment>) =>
        ok({ parts: withPart(part.instanceId, (p) => ({ ...p, attachments: p.attachments.map((a) => (a === attachment ? { ...a, ...change } : a)) })) });
      if (action.type === "set_seating") {
        // Taking a part out of its seat releases whatever was holding it.
        return update({ seating: action.seating, ...(action.seating === "seated" ? {} : { fastenersSecured: 0 }) });
      }
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
