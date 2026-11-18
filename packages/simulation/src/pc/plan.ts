// Compatibility of a planned build, before anything is assembled. The plan is checked by the same
// engine that runs the assembly: every part is added to an empty build and fitted where it would go,
// and each refusal (wrong socket, card too long, radiator too big, …) becomes a finding with the
// engine's own code. A few questions the physical fitting cannot ask (power, cable counts, BIOS,
// headers) are answered from the same catalog fields the startup check reads.
//
// Findings never come from colour, brand, preset membership or a power supply that is larger than
// needed. Severities:
//   incompatible   – the part cannot be fitted or the computer cannot start as planned.
//   conditional    – depends on something the catalog does not settle (BIOS not recorded, a hub needed, an exercise rule).
//   less_suitable  – works, but another choice fits the purpose better (below a recommendation).
import type { CatalogEntry, Localized, MountRef, PCAction, PCBuildState, PCCatalog, PCPartCategory } from "@ytl/contracts";
import { applyAction, createBuild } from "./reducer";
import { LOAD_MODEL } from "./startup";

export interface BuildPlan {
  case?: string | null;
  motherboard?: string | null;
  cpu?: string | null;
  cooler?: string | null;
  psu?: string | null;
  gpu?: string | null;
  /** The RAM kit and how many modules of it (a kit of two counts as 2). */
  ram?: { id: string; modules: number } | null;
  storage?: readonly string[];
  fans?: readonly string[];
}

export type PlanSeverity = "incompatible" | "conditional" | "less_suitable";
export type PlanSlot = "case" | "motherboard" | "cpu" | "cooler" | "psu" | "gpu" | "ram" | "storage" | "fans";

export interface PlanFinding {
  /** Engine refusal code when it came from a fitting step, otherwise a planner code. */
  code: string;
  severity: PlanSeverity;
  /** The parts involved, first the one to change. */
  slots: PlanSlot[];
  /** Values for the message: names, sizes, counts. */
  params: Record<string, string | number>;
  /** The engine's own sentence, when the finding is an engine refusal. */
  engineMessage?: Localized;
}

export interface PlanReport {
  missing: PlanSlot[];
  findings: PlanFinding[];
  /** Teaching estimate, not a measurement: CPU maximum power + card power + allowance. */
  estimatedLoadW: number | null;
  /** True when nothing is missing and no finding is incompatible: assembly may start. */
  ready: boolean;
}

/** Parts a build cannot do without. A graphics card is optional when the CPU has integrated graphics. */
export const REQUIRED_SLOTS: readonly PlanSlot[] = ["case", "motherboard", "cpu", "cooler", "psu", "ram", "storage"];

const UNRECORDED = "unrecorded";
/** Exercise rule of this lab (stated in the UI, not a manufacturer requirement). */
export const EXERCISE_LIQUID_CPU_IDS: ReadonlySet<string> = new Set(["intel-core-i9-14900k"]);

type Entry<C extends PCPartCategory> = Extract<CatalogEntry, { category: C }>;

/** Parts a case arrives with, by case: fan entries and the positions they come fitted in. */
export type SuppliedParts = Readonly<Record<string, readonly { catalogId: string; mountPointId: string }[]>>;

export function checkPlan(plan: BuildPlan, catalog: PCCatalog, opts: { supplied?: SuppliedParts } = {}): PlanReport {
  const byId = new Map(catalog.entries.map((e) => [e.id, e]));
  const get = <C extends PCPartCategory>(id: string | null | undefined, category: C): Entry<C> | undefined => {
    const e = id ? byId.get(id) : undefined;
    return e && e.category === category ? (e as Entry<C>) : undefined;
  };
  const caseE = get(plan.case, "case");
  const board = get(plan.motherboard, "motherboard");
  const cpu = get(plan.cpu, "cpu");
  const cooler = get(plan.cooler, "cooling");
  const psu = get(plan.psu, "psu");
  const gpu = get(plan.gpu, "gpu");
  const ram = get(plan.ram?.id, "ram");
  const modules = ram ? Math.max(1, plan.ram?.modules ?? ram.spec.modulesInKit) : 0;
  const drives = (plan.storage ?? []).map((id) => get(id, "storage")).filter((e): e is Entry<"storage"> => !!e);
  const fans = (plan.fans ?? []).map((id) => get(id, "fan")).filter((e): e is Entry<"fan"> => !!e);
  const findings: PlanFinding[] = [];
  const add = (f: PlanFinding) => findings.push(f);
  const name = (e: CatalogEntry | undefined) => (e ? `${e.brand} ${e.model}` : "");

  const missing: PlanSlot[] = [];
  if (!caseE) missing.push("case");
  if (!board) missing.push("motherboard");
  if (!cpu) missing.push("cpu");
  if (!cooler) missing.push("cooler");
  if (!psu) missing.push("psu");
  if (!ram) missing.push("ram");
  if (drives.length === 0) missing.push("storage");
  if (cpu && !gpu && cpu.spec.integratedGraphics === null) missing.push("gpu");

  // ---------- Fit everything with the engine ----------
  let state: PCBuildState = createBuild(catalog);
  const step = (action: PCAction): { ok: boolean; code?: string; message?: Localized } => {
    const r = applyAction(state, action, catalog);
    if (r.ok) {
      state = r.state;
      return { ok: true };
    }
    return { ok: false, code: r.rejection.code, message: r.rejection.message };
  };
  const addPart = (catalogId: string): string => {
    step({ type: "add_part", catalogId });
    return state.parts.at(-1)!.instanceId;
  };
  const host = (instanceId: string) => state.parts.find((p) => p.instanceId === instanceId)!;
  const fastenerCount = (target: MountRef) => {
    const h = host(target.hostInstanceId);
    return byId.get(h.catalogId)?.mountPoints.find((m) => m.id === target.mountPointId)?.fastener?.count ?? 0;
  };
  /** Mount, seat and fasten; the first refusal is returned. */
  const fit = (instanceId: string, target: MountRef, role?: string) => {
    const r = role ? { role } : {};
    const m = step({ type: "mount_part", instanceId, target, ...r });
    if (!m.ok) return m;
    step({ type: "set_seating", instanceId, seating: "seated", ...r });
    const n = fastenerCount(target);
    if (n > 0) step({ type: "set_fasteners", instanceId, secured: n, ...r });
    return m;
  };
  const refusal = (r: { ok: boolean; code?: string; message?: Localized }, slots: PlanSlot[], params: Record<string, string | number> = {}) => {
    if (r.ok || !r.code) return;
    add({ code: r.code, severity: "incompatible", slots, params, engineMessage: r.message });
  };
  const freeMounts = (hostId: string, kind: string, accept: (m: CatalogEntry["mountPoints"][number]) => boolean = () => true) => {
    const h = host(hostId);
    const taken = new Set(state.parts.flatMap((p) => p.attachments.filter((a) => a.target.hostInstanceId === hostId).map((a) => a.target.mountPointId)));
    return (byId.get(h.catalogId)?.mountPoints ?? []).filter((m) => m.kind === kind && !taken.has(m.id) && accept(m));
  };

  const caseId = caseE ? addPart(caseE.id) : null;
  // The case's own fans, fitted where the factory puts them: they take positions and headers too.
  const suppliedFanIds: string[] = [];
  if (caseId) {
    for (const item of opts.supplied?.[caseE!.id] ?? []) {
      const id = addPart(item.catalogId);
      if (fit(id, { hostInstanceId: caseId, mountPointId: item.mountPointId }).ok) suppliedFanIds.push(id);
    }
  }
  /** Moves the case's fans off the positions `blocks` covers, to free positions of their size; false when there is none. */
  const clearFans = (blocks: readonly string[]): boolean => {
    for (const fanId of suppliedFanIds) {
      const at = host(fanId).attachments[0];
      if (!at || !blocks.includes(at.target.mountPointId)) continue;
      const size = byId.get(host(fanId).catalogId);
      const sizeMm = size?.category === "fan" ? size.spec.sizeMm : 0;
      const to = freeMounts(caseId!, "fan_mount", (m) => m.kind === "fan_mount" && !blocks.includes(m.id) && m.sizesMm.includes(sizeMm))[0];
      if (!to) return false;
      if (!step({ type: "unmount_part", instanceId: fanId }).ok) return false;
      if (!fit(fanId, { hostInstanceId: caseId!, mountPointId: to.id }).ok) return false;
    }
    return true;
  };
  const boardId = board ? addPart(board.id) : null;
  let boardInCase = false;
  if (caseId && boardId) {
    const r = fit(boardId, { hostInstanceId: caseId, mountPointId: "motherboard-tray" });
    boardInCase = r.ok;
    refusal(r, ["case", "motherboard"], { board: name(board), case: name(caseE) });
  }

  // CPU in the socket.
  let cpuSeated = false;
  if (cpu && boardId) {
    const id = addPart(cpu.id);
    const r = fit(id, { hostInstanceId: boardId, mountPointId: "cpu-socket" });
    cpuSeated = r.ok;
    refusal(r, ["cpu", "motherboard"], { cpu: name(cpu), board: name(board) });
    if (r.ok) {
      const row = board!.spec.cpuSupport.find((s) => s.cpuId === cpu.id);
      if (!row) add({ code: "cpu_not_supported_by_board", severity: "incompatible", slots: ["cpu", "motherboard"], params: { cpu: name(cpu), board: name(board) } });
      else if (row.sinceBios === UNRECORDED) add({ code: "bios_unconfirmed", severity: "conditional", slots: ["motherboard", "cpu"], params: { cpu: name(cpu), board: name(board) } });
      else {
        const order = board!.spec.biosVersions.map((b) => b.version);
        const need = order.indexOf(row.sinceBios);
        if (need > order.indexOf(board!.spec.factoryBiosVersion)) {
          add({ code: "bios_update_needed", severity: "conditional", slots: ["motherboard", "cpu"], params: { cpu: name(cpu), board: name(board), bios: row.sinceBios } });
        }
      }
    }
  }

  // Cooler: the block (or air cooler) on the CPU, then a radiator in the case.
  if (cooler && boardId && cpuSeated) {
    const id = addPart(cooler.id);
    const liquid = cooler.spec.type === "aio_liquid";
    const r = fit(id, { hostInstanceId: boardId, mountPointId: "cooler-mount" }, liquid ? "block" : undefined);
    refusal(r, ["cooler", "cpu"], { cooler: name(cooler), cpu: name(cpu) });
    if (r.ok && liquid && caseId) {
      const places = freeMounts(caseId, "radiator_mount");
      let fitted = false;
      let first: { ok: boolean; code?: string; message?: Localized } | null = null;
      for (const m of places) {
        const before = state;
        // A radiator position covers fan places: the case's own fans move elsewhere first.
        if (m.kind === "radiator_mount" && !clearFans(m.blocks ?? [])) { state = before; continue; }
        const t = fit(id, { hostInstanceId: caseId, mountPointId: m.id }, "radiator");
        if (t.ok) { fitted = true; break; }
        state = before;
        first ??= t;
      }
      if (!fitted) {
        if (first?.code) add({ code: first.code, severity: "incompatible", slots: ["cooler", "case"], params: { cooler: name(cooler), case: name(caseE), size: cooler.spec.radiatorSizeMm ?? "" }, engineMessage: first.message });
        else add({ code: "radiator_size_unsupported", severity: "incompatible", slots: ["cooler", "case"], params: { cooler: name(cooler), case: name(caseE), size: cooler.spec.radiatorSizeMm ?? "" } });
      }
    }
    // Exercise rule of this lab: stated as such, never as a manufacturer requirement.
    // It blocks the start in this lab, so it blocks assembly too; the UI labels it as the exercise rule.
    if (cpu && EXERCISE_LIQUID_CPU_IDS.has(cpu.id) && !liquid) add({ code: "exercise_needs_liquid", severity: "incompatible", slots: ["cooler", "cpu"], params: { cpu: name(cpu) } });
    const capacity = cooler.spec.coolingCapacityW?.value ?? null;
    const cpuMax = cpu ? (cpu.spec.maxPowerW ?? cpu.spec.basePowerW) : null;
    if (capacity !== null && cpuMax !== null && capacity < cpuMax) add({ code: "cooler_below_cpu_power", severity: "less_suitable", slots: ["cooler", "cpu"], params: { cooler: name(cooler), cpu: name(cpu), coolerW: capacity, cpuW: cpuMax } });
  }

  // Memory: one module per slot, recommended slots first.
  if (ram && boardId) {
    const order = board!.spec.memory.recommendedPopulation.find((p) => p.modules === modules)?.slotIds ?? [];
    let placed = 0;
    let firstRefusal: { ok: boolean; code?: string; message?: Localized } | null = null;
    for (let i = 0; i < modules; i += 1) {
      const id = addPart(ram.id);
      const free = freeMounts(boardId, "dimm_slot").map((m) => m.id);
      const slot = order.find((s) => free.includes(s)) ?? free[0];
      if (!slot) break;
      const r = fit(id, { hostInstanceId: boardId, mountPointId: slot });
      if (!r.ok) { firstRefusal = r; break; }
      placed += 1;
    }
    if (firstRefusal) refusal(firstRefusal, ["ram", "motherboard"], { ram: name(ram), board: name(board), have: ram.spec.generation.toUpperCase(), need: board!.spec.memory.generation.toUpperCase() });
    else if (placed < modules) add({ code: "ram_slots_exceeded", severity: "incompatible", slots: ["ram", "motherboard"], params: { modules, slots: board!.spec.memory.slots } });
    const total = modules * ram.spec.capacityPerModuleGb;
    if (!firstRefusal && total > board!.spec.memory.maxTotalGb) add({ code: "ram_over_board_max", severity: "incompatible", slots: ["ram", "motherboard"], params: { total, max: board!.spec.memory.maxTotalGb } });
    const perModule = board!.spec.memory.maxPerModuleGb;
    if (!firstRefusal && perModule !== null && ram.spec.capacityPerModuleGb > perModule) add({ code: "ram_module_too_large", severity: "incompatible", slots: ["ram", "motherboard"], params: { size: ram.spec.capacityPerModuleGb, max: perModule } });
    if (cpu && !firstRefusal && !cpu.spec.memorySupport.some((m) => m.generation === ram.spec.generation)) {
      add({ code: "cpu_memory_generation", severity: "incompatible", slots: ["ram", "cpu"], params: { cpu: name(cpu), have: ram.spec.generation.toUpperCase() } });
    }
  }

  // Storage: M.2 drives in M.2 slots, the rest in the case's bays.
  let sataDrives = 0;
  for (const drive of drives) {
    const id = addPart(drive.id);
    if (drive.spec.formFactor.startsWith("m2_")) {
      if (!boardId) continue;
      const slots = freeMounts(boardId, "m2_slot");
      if (slots.length === 0) {
        add({ code: "m2_slots_exceeded", severity: "incompatible", slots: ["storage", "motherboard"], params: { drive: name(drive), board: name(board), slots: board!.mountPoints.filter((m) => m.kind === "m2_slot").length } });
        continue;
      }
      let ok = false;
      let first: { ok: boolean; code?: string; message?: Localized } | null = null;
      for (const m of slots) {
        const r = fit(id, { hostInstanceId: boardId, mountPointId: m.id });
        if (r.ok) { ok = true; break; }
        first ??= r;
      }
      if (!ok && first) refusal(first, ["storage", "motherboard"], { drive: name(drive), board: name(board) });
    } else {
      sataDrives += 1;
      if (!caseId) continue;
      const bays = freeMounts(caseId, "drive_bay", (m) => m.kind === "drive_bay" && (m.sizes as string[]).includes(drive.spec.formFactor));
      if (bays.length === 0) {
        add({ code: "drive_bays_exceeded", severity: "incompatible", slots: ["storage", "case"], params: { drive: name(drive), case: name(caseE), size: drive.spec.formFactor === "3.5_inch" ? "3.5\"" : "2.5\"" } });
        continue;
      }
      refusal(fit(id, { hostInstanceId: caseId, mountPointId: bays[0]!.id }), ["storage", "case"], { drive: name(drive) });
    }
  }
  const dataCables = board ? board.cables.filter((c) => c.kind === "sata_data").reduce((n, c) => n + c.quantity, 0) : 0;
  if (board && sataDrives > dataCables && sataDrives <= board.spec.sataPorts) add({ code: "sata_cables_short", severity: "conditional", slots: ["storage", "motherboard"], params: { drives: sataDrives, cables: dataCables } });
  if (board && sataDrives > board.spec.sataPorts) add({ code: "sata_ports_exceeded", severity: "incompatible", slots: ["storage", "motherboard"], params: { drives: sataDrives, ports: board.spec.sataPorts } });

  // Graphics card: the length check needs the board in the case.
  if (gpu && boardId) {
    const id = addPart(gpu.id);
    if (boardInCase) refusal(fit(id, { hostInstanceId: boardId, mountPointId: "pcie-x16-1" }), ["gpu", "case"], { gpu: name(gpu), case: name(caseE), length: gpu.spec.lengthMm ?? "", max: caseE?.spec.maxGpuLengthMm ?? "" });
    else if (caseE && gpu.spec.lengthMm !== null && caseE.spec.maxGpuLengthMm !== null && gpu.spec.lengthMm > caseE.spec.maxGpuLengthMm) {
      add({ code: "gpu_too_long", severity: "incompatible", slots: ["gpu", "case"], params: { gpu: name(gpu), case: name(caseE), length: gpu.spec.lengthMm, max: caseE.spec.maxGpuLengthMm } });
    }
  }

  // Power supply in its bay.
  if (psu && caseId) {
    const id = addPart(psu.id);
    refusal(fit(id, { hostInstanceId: caseId, mountPointId: "psu-bay" }), ["psu", "case"], { psu: name(psu), case: name(caseE) });
  }

  // Case fans in free positions of their size (a radiator may already cover some).
  if (caseId) {
    for (const fan of fans) {
      const id = addPart(fan.id);
      const places = freeMounts(caseId, "fan_mount");
      let ok = false;
      for (const m of places) {
        const before = state;
        if (fit(id, { hostInstanceId: caseId, mountPointId: m.id }).ok) { ok = true; break; }
        state = before;
      }
      if (!ok) {
        const fitsSize = caseE!.mountPoints.some((m) => m.kind === "fan_mount" && m.sizesMm.includes(fan.spec.sizeMm));
        add({ code: fitsSize ? "fan_positions_exceeded" : "fan_size_unsupported", severity: "incompatible", slots: ["fans", "case"], params: { fan: name(fan), size: fan.spec.sizeMm, case: name(caseE) } });
      }
    }
  }

  // ---------- Questions the fitting does not ask ----------
  const pumpOnFanHeader = !!board && cooler?.spec.type === "aio_liquid" && !board.ports.some((p) => p.function === "pump_header" || p.id === "cpu-opt");
  const allFans = fans.length + suppliedFanIds.length + (pumpOnFanHeader ? 1 : 0);
  if (board && allFans > 0) {
    const headers = board.ports.filter((p) => p.function === "system_fan_header").length;
    if (allFans > headers) add({ code: "fan_headers_short", severity: "conditional", slots: ["fans", "motherboard"], params: { fans: allFans, headers } });
  }
  const coolerRefused = findings.some((f) => f.slots[0] === "cooler" && f.severity === "incompatible");
  if (board && !coolerRefused && cooler?.spec.type === "aio_liquid" && !board.ports.some((p) => p.function === "pump_header")) {
    add({ code: "no_pump_header", severity: "conditional", slots: ["cooler", "motherboard"], params: { board: name(board) } });
  }

  let estimatedLoadW: number | null = null;
  if (psu) {
    const plugs = (kind: string) => psu.cables.reduce((n, c) => n + c.quantity * c.ends.filter((e) => e.connector === kind).length, 0);
    // CPU power: every required socket of the board needs a plug.
    if (board) {
      const need = board.ports.filter((p) => p.function === "cpu_power" && p.requirement === "required").length;
      const want = board.ports.filter((p) => p.function === "cpu_power" && p.requirement !== "optional").length;
      const have = plugs("eps_4plus4pin") + plugs("eps_8pin");
      if (have < need) add({ code: "psu_cpu_plugs_short", severity: "incompatible", slots: ["psu", "motherboard"], params: { have, need } });
      else if (have < want) add({ code: "psu_cpu_plugs_fewer_than_recommended", severity: "less_suitable", slots: ["psu", "motherboard"], params: { have, want } });
    }
    if (gpu) {
      const eight = gpu.ports.filter((p) => p.function === "gpu_power" && p.connector === "pcie_8pin").length;
      const sixteen = gpu.ports.filter((p) => p.function === "gpu_power" && (p.connector === "pcie_12vhpwr" || p.connector === "pcie_12v_2x6")).length;
      const adapterInputs = gpu.cables.filter((c) => c.kind === "gpu_power_adapter").reduce((n, c) => n + c.ends.filter((e) => e.id.startsWith("in-")).length, 0);
      const pcie = plugs("pcie_6plus2pin") + plugs("pcie_8pin");
      const native16 = plugs("pcie_12v_2x6") + plugs("pcie_12vhpwr");
      if (eight > pcie) add({ code: "psu_gpu_plugs_short", severity: "incompatible", slots: ["psu", "gpu"], params: { have: pcie, need: eight } });
      if (sixteen > 0 && native16 < sixteen && pcie < adapterInputs) add({ code: "psu_gpu_plugs_short", severity: "incompatible", slots: ["psu", "gpu"], params: { have: pcie, need: adapterInputs } });
      // The card's adapter would work in reality; this lab wires 16-pin cards only from a native cable.
      else if (sixteen > 0 && native16 < sixteen) add({ code: "lab_needs_native_16pin", severity: "incompatible", slots: ["psu", "gpu"], params: {} });
    }
    if (sataDrives > 0) {
      const have = plugs("sata_power");
      if (have < sataDrives) add({ code: "psu_sata_plugs_short", severity: "incompatible", slots: ["psu", "storage"], params: { have, need: sataDrives } });
    }
    // Power: a teaching estimate. More capacity than needed is never a finding.
    const cpuW = cpu ? (cpu.spec.maxPowerW ?? cpu.spec.basePowerW) : 0;
    const gpuW = gpu?.spec.powerDrawW ?? 0;
    estimatedLoadW = cpuW + gpuW + LOAD_MODEL.baseSystemW;
    if (estimatedLoadW > psu.spec.wattageW) add({ code: "psu_insufficient_for_load", severity: "incompatible", slots: ["psu"], params: { load: estimatedLoadW, psuW: psu.spec.wattageW } });
    else if (gpu?.spec.recommendedPsuW && gpu.spec.recommendedPsuW > psu.spec.wattageW) add({ code: "psu_below_gpu_recommendation", severity: "less_suitable", slots: ["psu", "gpu"], params: { psuW: psu.spec.wattageW, recommended: gpu.spec.recommendedPsuW } });
  }

  // One finding per code and parts.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.code}|${f.slots.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank: Record<PlanSeverity, number> = { incompatible: 0, conditional: 1, less_suitable: 2 };
  unique.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { missing, findings: unique, estimatedLoadW, ready: missing.length === 0 && !unique.some((f) => f.severity === "incompatible") };
}
