// Physical placement rules: can this part go on that mount point? Used by the reducer and by `mountOptions`,
// so a destination offered as valid is always accepted.
import type {
  CaseEntry,
  CatalogEntry,
  InstalledPart,
  InstanceId,
  MountPointSpec,
  MountRef,
  PCBuildState,
  PCCatalog,
  PCDiagnostic,
  PCDiagnosticCode,
  PCEvaluationContext,
  PCEvidence,
  PCMountOption,
} from "@ytl/contracts";
import { pcTarget } from "@ytl/contracts";
import { L, type TextParams } from "./messages";
import { type View, caseAbove, childrenOf, displayName, entryOf, evidence, makeDiag, makeView, mountSpec, occupant, partById } from "./view";

export type MountCheck = { ok: true; role: string } | { ok: false; rejection: PCDiagnostic };

const mm = (n: number) => `${n} mm`;

function reject(v: View, code: PCDiagnosticCode, part: InstalledPart, target: MountRef, params: TextParams, ev: PCEvidence[] = []): MountCheck {
  return {
    ok: false,
    rejection: makeDiag(v, code, code === "unknown_reference" || code === "invalid_action" || code === "host_not_ready" ? "assembly" : "impossible_fit", "blocking", {
      subject: `${part.instanceId}@${target.hostInstanceId}/${target.mountPointId}`,
      target: pcTarget.mount(target),
      related: [pcTarget.part(part.instanceId)],
      // The first evidence row carries the two values the one-sentence reason names.
      params: { ...params, have: ev[0]?.observed ?? "", want: (ev[0]?.expected ?? ev[1]?.observed ?? "").replace(/^<= /, "") },
      evidence: ev,
    }),
  };
}

/** Clearance of one part against the case it would end up in. */
function clearance(v: View, entry: CatalogEntry, theCase: CaseEntry): { code: PCDiagnosticCode; ev: PCEvidence[] } | undefined {
  if (entry.category === "gpu" && entry.spec.lengthMm > theCase.spec.maxGpuLengthMm) {
    return {
      code: "gpu_too_long",
      ev: [
        evidence("Graphics card length", "طول كرت الشاشة", mm(entry.spec.lengthMm), `<= ${mm(theCase.spec.maxGpuLengthMm)}`, entry.id),
        evidence("Case maximum graphics card length", "أقصى طول لكرت الشاشة في الهيكل", mm(theCase.spec.maxGpuLengthMm), undefined, theCase.id),
      ],
    };
  }
  if (entry.category === "cooling" && entry.spec.type === "air" && entry.spec.heightMm !== null && entry.spec.heightMm > theCase.spec.maxCpuCoolerHeightMm) {
    return {
      code: "cooler_too_tall",
      ev: [
        evidence("Cooler height", "ارتفاع المبرّد", mm(entry.spec.heightMm), `<= ${mm(theCase.spec.maxCpuCoolerHeightMm)}`, entry.id),
        evidence("Case maximum CPU cooler height", "أقصى ارتفاع لمبرّد المعالج في الهيكل", mm(theCase.spec.maxCpuCoolerHeightMm), undefined, theCase.id),
      ],
    };
  }
  return undefined;
}

/** Everything installed on `hostId`, directly or through other parts. */
function descendants(v: View, hostId: InstanceId, depth = 0): InstalledPart[] {
  if (depth > 6) return [];
  return childrenOf(v, hostId).flatMap((c) => [c, ...descendants(v, c.instanceId, depth + 1)]);
}

export function checkMount(v: View, instanceId: InstanceId, role: string | undefined, target: MountRef): MountCheck {
  const part = partById(v, instanceId);
  const entry = entryOf(v, part);
  if (!part || !entry) {
    const ghost: InstalledPart = { instanceId, catalogId: "", attachments: [] };
    return reject(v, "unknown_reference", ghost, target, { what: instanceId });
  }
  const host = partById(v, target.hostInstanceId);
  const hostEntry = entryOf(v, host);
  const mount = mountSpec(v, target);
  if (!host || !hostEntry || !mount) return reject(v, "unknown_reference", part, target, { what: `${target.hostInstanceId}/${target.mountPointId}` });

  const p: TextParams = { part: displayName(entry), host: displayName(hostEntry), mount: mount.label };

  // Which of the part's roles is being placed.
  const free = entry.mounting.filter((m) => !part.attachments.some((a) => a.role === m.role));
  const roleSpec = role ? entry.mounting.find((m) => m.role === role) : (free.find((m) => m.kind === mount.kind) ?? free[0] ?? entry.mounting[0]);
  if (!roleSpec) return reject(v, "mount_kind_mismatch", part, target, p);
  if (part.attachments.some((a) => a.role === roleSpec.role)) {
    return reject(v, "invalid_action", part, target, {
      why: L("This part is already installed. Take it out of its place before you put it somewhere else.", "هذي القطعة مركّبة. شيلها من مكانها قبل ما تحطها في مكان ثاني."),
    });
  }
  if (roleSpec.kind !== mount.kind) return reject(v, "mount_kind_mismatch", part, target, p);
  if (host.instanceId === part.instanceId) return reject(v, "mount_kind_mismatch", part, target, p);

  if (occupant(v, target)) return reject(v, "mount_occupied", part, target, p);
  const blocked = hostEntry.mountPoints.some((other) => {
    if (other.id === mount.id) return false;
    const taken = !!occupant(v, { hostInstanceId: host.instanceId, mountPointId: other.id });
    return taken && ((other.blocks ?? []).includes(mount.id) || (mount.blocks ?? []).includes(other.id));
  });
  if (blocked) return reject(v, "mount_blocked", part, target, p);

  const theCase = caseAbove(v, host.instanceId);
  if (theCase && !v.state.sidePanelOpen) {
    return reject(v, "host_not_ready", part, target, {
      ...p,
      why: L("The side panel of the case is closed. Open it to work inside the case.", "الغطا الجانبي للهيكل مسكّر. افتحه عشان تشتغل داخل الهيكل."),
    });
  }

  const specific = kindRules(v, part, entry, host, hostEntry, mount, target, p);
  if (specific) return specific;

  // Clearance against the case, for this part and for anything already installed on it.
  if (theCase) {
    for (const candidate of [part, ...descendants(v, part.instanceId)]) {
      const e = entryOf(v, candidate);
      const hit = e && clearance(v, e, theCase.entry);
      if (hit && e) return reject(v, hit.code, candidate, target, { part: displayName(e), host: displayName(theCase.entry), mount: mount.label }, hit.ev);
    }
  }
  return { ok: true, role: roleSpec.role };
}

function kindRules(
  v: View,
  part: InstalledPart,
  entry: CatalogEntry,
  host: InstalledPart,
  hostEntry: CatalogEntry,
  mount: MountPointSpec,
  target: MountRef,
  p: TextParams,
): MountCheck | undefined {
  switch (mount.kind) {
    case "motherboard_tray":
      if (entry.category === "motherboard" && !mount.formFactors.includes(entry.spec.formFactor)) {
        return reject(v, "board_form_factor_unsupported", part, target, p, [
          evidence("Motherboard form factor", "مقاس اللوحة الأم", entry.spec.formFactor, mount.formFactors.join(" / "), entry.id),
        ]);
      }
      return undefined;
    case "psu_bay":
      if (entry.category !== "psu") return undefined;
      if (!mount.formFactors.includes(entry.spec.formFactor)) {
        return reject(v, "psu_form_factor_unsupported", part, target, p, [
          evidence("Power supply form factor", "مقاس مزوّد الطاقة", entry.spec.formFactor, mount.formFactors.join(" / "), entry.id),
        ]);
      }
      if (mount.maxLengthMm !== null && entry.dimensions.lengthMm !== null && entry.dimensions.lengthMm > mount.maxLengthMm) {
        return reject(v, "psu_too_long", part, target, p, [
          evidence("Power supply length", "طول مزوّد الطاقة", mm(entry.dimensions.lengthMm), `<= ${mm(mount.maxLengthMm)}`, entry.id),
        ]);
      }
      return undefined;
    case "drive_bay":
      if (entry.category === "storage" && !(mount.sizes as string[]).includes(entry.spec.formFactor)) {
        return reject(v, "drive_bay_mismatch", part, target, p, [
          evidence("Drive form factor", "مقاس القرص", entry.spec.formFactor, mount.sizes.join(" / "), entry.id),
        ]);
      }
      return undefined;
    case "fan_mount":
      if (entry.category === "fan" && !mount.sizesMm.includes(entry.spec.sizeMm)) {
        return reject(v, "fan_size_unsupported", part, target, p, [
          evidence("Fan size", "مقاس المروحة", mm(entry.spec.sizeMm), mount.sizesMm.map(mm).join(" / "), entry.id),
        ]);
      }
      return undefined;
    case "radiator_mount":
      if (entry.category === "cooling" && (entry.spec.radiatorSizeMm === null || !mount.radiatorSizesMm.includes(entry.spec.radiatorSizeMm))) {
        return reject(v, "radiator_size_unsupported", part, target, p, [
          evidence("Radiator size", "مقاس الرادياتير", entry.spec.radiatorSizeMm === null ? "-" : mm(entry.spec.radiatorSizeMm), mount.radiatorSizesMm.map(mm).join(" / "), entry.id),
        ]);
      }
      return undefined;
    case "cpu_socket":
      if (entry.category === "cpu" && entry.spec.socket !== mount.socket) {
        return reject(v, "cpu_socket_mismatch", part, target, p, [
          evidence("CPU socket", "مقبس المعالج", entry.spec.socket.toUpperCase(), mount.socket.toUpperCase(), entry.id),
          evidence("Motherboard socket", "مقبس اللوحة الأم", mount.socket.toUpperCase(), undefined, hostEntry.id),
        ]);
      }
      return undefined;
    case "cpu_cooler_mount": {
      if (entry.category !== "cooling") return undefined;
      if (!entry.spec.supportedSockets.includes(mount.socket)) {
        return reject(v, "cooler_socket_unsupported", part, target, p, [
          evidence("Sockets the cooler supports", "المقابس اللي يركب عليها المبرّد", entry.spec.supportedSockets.map((s) => s.toUpperCase()).join(" / "), mount.socket.toUpperCase(), entry.id),
        ]);
      }
      const socket = hostEntry.mountPoints.find((m) => m.kind === "cpu_socket");
      const cpu = socket && occupant(v, { hostInstanceId: host.instanceId, mountPointId: socket.id });
      if (!cpu || cpu.attachment.seating !== "seated") {
        return reject(v, "host_not_ready", part, target, {
          ...p,
          why: L("Install and seat the CPU first: the cooler goes on top of it.", "ركّب المعالج وثبّته أول: المبرّد يركب فوقه."),
        });
      }
      return undefined;
    }
    case "dimm_slot":
      if (entry.category !== "ram") return undefined;
      if (entry.spec.generation !== mount.generation) {
        return reject(v, "ram_generation_mismatch", part, target, p, [
          evidence("Module generation", "جيل الرام", entry.spec.generation.toUpperCase(), mount.generation.toUpperCase(), entry.id),
          evidence("Slot generation", "جيل الفتحة", mount.generation.toUpperCase(), undefined, hostEntry.id),
        ]);
      }
      if (entry.spec.moduleType !== mount.moduleType) {
        return reject(v, "ram_module_type_mismatch", part, target, p, [
          evidence("Module type", "نوع الرام", entry.spec.moduleType.toUpperCase(), mount.moduleType.toUpperCase(), entry.id),
        ]);
      }
      return undefined;
    case "pcie_slot":
      if (entry.category === "gpu" && mount.mechanical !== "x16") return reject(v, "mount_kind_mismatch", part, target, p);
      return undefined;
    case "m2_slot":
      if (entry.category !== "storage") return undefined;
      if (!mount.lengths.includes(entry.spec.formFactor)) {
        return reject(v, "m2_length_unsupported", part, target, p, [
          evidence("Drive form factor", "مقاس القرص", entry.spec.formFactor, mount.lengths.join(" / "), entry.id),
        ]);
      }
      if (!mount.interfaces.includes(entry.spec.interface)) {
        return reject(v, "m2_interface_unsupported", part, target, p, [
          evidence("Drive interface", "واجهة القرص", entry.spec.interface.toUpperCase(), mount.interfaces.map((i) => i.toUpperCase()).join(" / "), entry.id),
          evidence("Slot interfaces", "واجهات الفتحة", mount.interfaces.map((i) => i.toUpperCase()).join(" / "), undefined, hostEntry.id),
        ]);
      }
      return undefined;
  }
}

/**
 * Every mount point in the build whose kind matches one of the part's roles that is not yet installed,
 * each with whether the part can go there and, if not, why. Pure: nothing is logged.
 */
export function mountOptions(state: PCBuildState, catalog: PCCatalog, instanceId: InstanceId, ctx: PCEvaluationContext = {}): PCMountOption[] {
  const v = makeView(state, catalog, ctx);
  const part = partById(v, instanceId);
  const entry = entryOf(v, part);
  if (!part || !entry) return [];
  const options: PCMountOption[] = [];
  for (const role of entry.mounting) {
    if (part.attachments.some((a) => a.role === role.role)) continue;
    for (const host of state.parts) {
      if (host.instanceId === instanceId) continue;
      for (const mount of entryOf(v, host)?.mountPoints ?? []) {
        if (mount.kind !== role.kind) continue;
        const target: MountRef = { hostInstanceId: host.instanceId, mountPointId: mount.id };
        const check = checkMount(v, instanceId, role.role, target);
        options.push({ role: role.role, target, label: mount.label, ok: check.ok, ...(check.ok ? {} : { rejection: check.rejection }) });
      }
    }
  }
  return options;
}
