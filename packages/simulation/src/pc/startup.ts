// Build diagnostics and the five-stage startup result.
// This is an educational model with explicit, documented rules. It is not firmware emulation, a benchmark
// or a physical simulation, and it says so in every result (`model`, `disclaimer`).
import type {
  CableInstance,
  CpuEntry,
  GpuEntry,
  InstalledPart,
  LightingStatus,
  Localized,
  MotherboardEntry,
  PCBuildState,
  PCCatalog,
  PCDiagnostic,
  PCDiagnosticClass,
  PCDiagnosticCode,
  PCEvaluationContext,
  PCEvidence,
  PortRef,
  ScreenState,
  StageResult,
  StartupOutcome,
  StartupResult,
  StartupStage,
  TutorTargetRef,
} from "@ytl/contracts";
import { STARTUP_STAGES, pcTarget } from "@ytl/contracts";
import { cableReachesPsu, feedOf, installedPsu, psuLive, sourceProgress } from "./cabling";
import { CONNECTOR_NAME, connectorsMate, isMotorHeader, isMotorLead } from "./connectors";
import {
  CATEGORY_NAME,
  DISCLAIMER,
  L,
  STAGE_FAILED,
  STAGE_IDLE,
  STAGE_NOT_REACHED,
  STAGE_PASSED,
  SYMPTOM,
  type TextParams,
} from "./messages";
import {
  type Placed,
  type View,
  attachmentOf,
  cableLabel,
  cableSpec,
  displayName,
  entryOf,
  evidence,
  isMounted,
  makeDiag,
  makeView,
  mountSpec,
  occupant,
  partById,
  partsOf,
  socketInfo,
} from "./view";

/**
 * Teaching constants of the load stage. They are deliberately simple and visible:
 * estimated draw = CPU maximum power + graphics card power + `baseSystemW`.
 * `baseSystemW` stands for the motherboard, memory, drives, fans and pump together.
 */
export const LOAD_MODEL = { baseSystemW: 50 } as const;

interface Analysis {
  stages: Record<StartupStage, PCDiagnostic[]>;
  advisories: PCDiagnostic[];
  loadModel: StartupResult["loadModel"];
}

const WHY_POWER: Record<string, Localized> = {
  atx_main_power: L(
    "The 24-pin cable is the motherboard's main supply. Without it the board has no power and nothing starts.",
    "كيبل الـ 24 سنّ هو الكهرباء الرئيسية للوحة الأم. بدونه اللوحة ما فيها كهرباء وما يبدأ شي.",
  ),
  cpu_power: L(
    "The processor is fed through its own 12 V plug next to the socket, separately from the 24-pin cable. Fans can spin without it, but the CPU cannot run, so the self-test never completes.",
    "المعالج له راس 12 فولت خاص فيه جنب المقبس، غير كيبل الـ 24 سنّ. المراوح ممكن تدور بدونه، بس المعالج ما يشتغل والفحص الذاتي ما يكمّل.",
  ),
  gpu_power: L(
    "The slot cannot supply all the power this graphics card needs. Without its power cable the card does not start, and the self-test stops at the graphics check.",
    "الفتحة ما تقدر تعطي كل الطاقة اللي يحتاجها هذا الكرت. بدون كيبل الطاقة حقه الكرت ما يشتغل، والفحص الذاتي يوقف عند فحص كرت الشاشة.",
  ),
  sata_power: L(
    "A SATA drive needs two cables: data to the motherboard and power from the power supply. Without power the drive is not detected.",
    "قرص SATA يحتاج كيبلين: بيانات للوحة الأم وطاقة من مزوّد الطاقة. بدون الطاقة اللوحة ما تشوف القرص.",
  ),
};

function analyse(v: View, run: boolean): Analysis {
  const stages: Record<StartupStage, PCDiagnostic[]> = { power: [], post: [], firmware_display: [], boot_device: [], operating_load: [] };
  const advisories: PCDiagnostic[] = [];
  const settingTarget = pcTarget.setting("power-button");

  const blocking = (
    stage: StartupStage,
    code: PCDiagnosticCode,
    cls: PCDiagnosticClass,
    subject: string,
    target: TutorTargetRef,
    params: TextParams = {},
    ev: PCEvidence[] = [],
    related: TutorTargetRef[] = [],
  ) => stages[stage].push(makeDiag(v, code, cls, "blocking", { subject, target, related, stage, params, evidence: ev, startupRun: run }));
  const advise = (
    code: PCDiagnosticCode,
    cls: PCDiagnosticClass,
    severity: "warning" | "info",
    subject: string,
    target: TutorTargetRef,
    params: TextParams = {},
    ev: PCEvidence[] = [],
    related: TutorTargetRef[] = [],
  ) => advisories.push(makeDiag(v, code, cls, severity, { subject, target, related, params, evidence: ev, startupRun: run }));

  const missing = (stage: StartupStage, category: string, symptom: Localized, why: Localized, target: TutorTargetRef) =>
    blocking(stage, "part_missing", "assembly", category, target, { category: CATEGORY_NAME[category] ?? category, symptom, why });
  const notMounted = (stage: StartupStage, x: Placed, symptom: Localized) =>
    blocking(stage, "part_not_mounted", "assembly", x.part.instanceId, pcTarget.part(x.part.instanceId), { part: displayName(x.entry), symptom });

  /** A required power socket: reports nothing when a cable from the installed power supply is in it. */
  const needPower = (stage: StartupStage, x: Placed, portId: string, symptom: Localized) => {
    const port = x.entry.ports.find((p) => p.id === portId);
    if (!port) return;
    const ref: PortRef = { kind: "part", instanceId: x.part.instanceId, portId };
    const { feed, cable } = feedOf(v, x.part.instanceId, portId);
    if (feed === "connected") return;
    const p: TextParams = { port: port.label, part: displayName(x.entry), symptom, why: WHY_POWER[port.function] ?? WHY_POWER.atx_main_power! };
    if (feed === "source_loose" && cable) {
      const progress = sourceProgress(v, cable);
      const loose = progress.firstLoose ? [pcTarget.cableEnd(cable.id, progress.firstLoose)] : [];
      blocking(stage, "power_cable_source_loose", "assembly", `${x.part.instanceId}/${portId}`, loose[0] ?? pcTarget.port(ref), p, [
        evidence("Power-supply side ends connected", "الأطراف الموصّلة من جهة مزوّد الطاقة", `${progress.done} / ${progress.total}`, `${progress.total} / ${progress.total}`, cable.catalogId),
      ], [pcTarget.port(ref)]);
      return;
    }
    blocking(stage, "required_power_missing", "assembly", `${x.part.instanceId}/${portId}`, pcTarget.port(ref), p, [
      evidence("Socket", "المدخل", CONNECTOR_NAME[port.connector], undefined, x.entry.id),
      evidence("Cable connected", "الكيبل الموصّل", "-", CONNECTOR_NAME[port.connector]),
    ]);
  };

  // ---------- Who is in the build ----------
  const theCase = partsOf(v, "case")[0];
  const boards = partsOf(v, "motherboard");
  const board = boards.find((b) => isMounted(b.part)) ?? boards[0];
  const psu = installedPsu(v) ?? partsOf(v, "psu")[0];
  const onBoard = <T extends Placed>(kind: string, list: T[]): T[] =>
    board
      ? list.filter((x) => x.part.attachments.some((a) => a.target.hostInstanceId === board.part.instanceId && mountSpec(v, a.target)?.kind === kind))
      : [];
  const cpus = partsOf(v, "cpu");
  const cpu = onBoard("cpu_socket", cpus)[0] as Placed<CpuEntry> | undefined;
  const modules = onBoard("dimm_slot", partsOf(v, "ram"));
  const gpus = partsOf(v, "gpu");
  const gpu = onBoard("pcie_slot", gpus)[0] as Placed<GpuEntry> | undefined;
  const coolers = partsOf(v, "cooling");
  const cooler = onBoard("cpu_cooler_mount", coolers)[0];
  const storages = partsOf(v, "storage");
  const anchor = theCase ? pcTarget.part(theCase.part.instanceId) : settingTarget;
  const boardTarget = board ? pcTarget.part(board.part.instanceId) : anchor;
  const psuBay = theCase?.entry.mountPoints.find((m) => m.kind === "psu_bay");

  // ---------- Stage 1: power availability ----------
  if (!psu) {
    missing("power", "psu", SYMPTOM.dead, L("Every part gets its electricity from the power supply.", "كل القطع تاخذ كهرباءها من مزوّد الطاقة."), psuBay && theCase ? pcTarget.mount({ hostInstanceId: theCase.part.instanceId, mountPointId: psuBay.id }) : anchor);
  } else if (!isMounted(psu.part)) {
    notMounted("power", psu, SYMPTOM.dead);
  }
  if (psu && !v.state.power.wallConnected) blocking("power", "wall_power_disconnected", "assembly", "wall", pcTarget.setting("wall-power"));
  if (psu && !v.state.power.psuSwitchOn) blocking("power", "psu_switch_off", "assembly", "switch", pcTarget.setting("psu-switch"));
  if (!theCase) missing("power", "case", SYMPTOM.dead, L("The case holds the parts and carries the power button.", "الهيكل يشيل القطع وفيه زر التشغيل."), settingTarget);
  if (!board) {
    missing("power", "motherboard", SYMPTOM.dead, L("Every other part connects to the motherboard.", "كل القطع الثانية تتوصّل باللوحة الأم."), anchor);
  } else {
    const tray = board.part.attachments[0];
    if (!tray) notMounted("power", board, SYMPTOM.dead);
    else if (tray.seating !== "seated") {
      blocking("power", "part_not_seated", "assembly", board.part.instanceId, pcTarget.part(board.part.instanceId), {
        part: displayName(board.entry),
        mount: mountSpec(v, tray.target)?.label ?? "",
        symptom: SYMPTOM.dead,
      });
    }
    for (const port of board.entry.ports) if (port.function === "atx_main_power" && port.requirement === "required") needPower("power", board, port.id, SYMPTOM.dead);

    // The case button reaches the board through a two-pin lead that fits several pin pairs.
    if (theCase) {
      const lead = v.state.cables.find((c) => c.ownerInstanceId === theCase.part.instanceId && cableSpec(v, c)?.ends.some((e) => e.function === "power_switch"));
      const leadEnd = lead && cableSpec(v, lead)?.ends.find((e) => e.function === "power_switch");
      const to = lead && leadEnd ? lead.ends[leadEnd.id] : null;
      const pins = board.entry.ports.find((p) => p.function === "power_switch");
      const pinsRef = pins ? pcTarget.port({ kind: "part", instanceId: board.part.instanceId, portId: pins.id }) : boardTarget;
      const leadRef = lead && leadEnd ? pcTarget.cableEnd(lead.id, leadEnd.id) : anchor;
      if (!to) blocking("power", "power_switch_not_connected", "assembly", "power-switch", leadRef, {}, [], [pinsRef]);
      else if (socketInfo(v, to)?.function !== "power_switch") {
        blocking("power", "power_switch_wrong_header", "assembly", "power-switch", pcTarget.port(to), {}, [
          evidence("Lead is on", "السلك موصّل على", socketInfo(v, to)?.label.en ?? "-", pins?.label.en),
        ], [leadRef, pinsRef]);
      }
    }
  }

  // ---------- Stage 2: POST and component checks ----------
  if (board) {
    const socket = board.entry.mountPoints.find((m) => m.kind === "cpu_socket");
    if (!cpu) {
      const loose = cpus[0];
      if (loose) notMounted("post", loose, SYMPTOM.noPost);
      else {
        missing("post", "cpu", SYMPTOM.noPost, L("The processor runs the self-test; without it nothing can start.", "المعالج هو اللي يسوي الفحص الذاتي؛ وبدونه ما يبدأ شي."),
          socket ? pcTarget.mount({ hostInstanceId: board.part.instanceId, mountPointId: socket.id }) : boardTarget);
      }
    } else {
      const a = cpu.part.attachments[0]!;
      const cpuTarget = pcTarget.part(cpu.part.instanceId);
      if (a.seating !== "seated") {
        blocking("post", "part_not_seated", "assembly", cpu.part.instanceId, cpuTarget, { part: displayName(cpu.entry), mount: socket?.label ?? "", symptom: SYMPTOM.noPost });
      } else if ((socket?.fastener?.count ?? 0) > a.fastenersSecured) {
        blocking("post", "cpu_lever_open", "assembly", cpu.part.instanceId, pcTarget.mount(a.target), {}, [], [cpuTarget]);
      }
      // Fitting the socket is not support: the board's own list decides, and it names a first BIOS version.
      const row = board.entry.spec.cpuSupport.find((s) => s.cpuId === cpu.entry.id);
      const p: TextParams = { part: displayName(cpu.entry), host: displayName(board.entry) };
      if (!row) {
        blocking("post", "cpu_not_supported_by_board", "startup_fault", cpu.part.instanceId, cpuTarget, p, [
          evidence("CPU on the board's support list", "المعالج في قائمة دعم اللوحة", "no", "yes", board.entry.id),
        ], [boardTarget]);
      } else {
        const order = board.entry.spec.biosVersions.map((b) => b.version);
        const need = order.indexOf(row.sinceBios);
        const have = order.indexOf(board.part.biosVersion ?? board.entry.spec.factoryBiosVersion);
        // A `sinceBios` older than every published version means every published version supports the CPU.
        if (need > -1 && have < need) {
          blocking("post", "cpu_needs_bios_update", "startup_fault", cpu.part.instanceId, boardTarget, p, [
            evidence("BIOS version on the board", "إصدار البايوس في اللوحة", board.part.biosVersion ?? "-", `>= ${row.sinceBios}`, board.entry.id),
            evidence("First BIOS that supports this CPU", "أول إصدار بايوس يدعم هذا المعالج", row.sinceBios, undefined, board.entry.id),
          ], [cpuTarget]);
        }
      }
    }
    for (const port of board.entry.ports) {
      if (port.function !== "cpu_power") continue;
      if (port.requirement === "required") needPower("post", board, port.id, SYMPTOM.noPost);
      else if (port.requirement === "recommended" && feedOf(v, board.part.instanceId, port.id).feed !== "connected") {
        advise("required_power_missing", "assembly", "warning", `${board.part.instanceId}/${port.id}`, pcTarget.port({ kind: "part", instanceId: board.part.instanceId, portId: port.id }), {
          port: port.label,
          part: displayName(board.entry),
          why: L(
            "The board's manual says to connect every CPU power plug. In this model the computer still starts with the first one alone.",
            "دليل اللوحة يقول وصّل كل رؤوس طاقة المعالج. في هذا النموذج الكمبيوتر يشتغل بالأول لحاله.",
          ),
        });
      }
    }

    // Memory.
    const ramParts = partsOf(v, "ram");
    const firstSlot = board.entry.mountPoints.find((m) => m.kind === "dimm_slot");
    if (modules.length === 0) {
      const loose = ramParts[0];
      if (loose) notMounted("post", loose, SYMPTOM.noPost);
      else {
        missing("post", "ram", SYMPTOM.noPost, L("The self-test needs working memory; with none it stops.", "الفحص الذاتي يحتاج رام شغّالة؛ وبدونها يوقف."),
          firstSlot ? pcTarget.mount({ hostInstanceId: board.part.instanceId, mountPointId: firstSlot.id }) : boardTarget);
      }
    }
    let totalGb = 0;
    for (const m of modules) {
      const a = m.part.attachments[0]!;
      const p: TextParams = { part: displayName(m.entry), mount: mountSpec(v, a.target)?.label ?? "" };
      totalGb += m.entry.spec.capacityPerModuleGb;
      if (a.seating === "partial") {
        blocking("post", "ram_partially_seated", "assembly", m.part.instanceId, pcTarget.part(m.part.instanceId), p, [
          evidence("Seating", "حالة التثبيت", "partial", "seated"),
        ], [pcTarget.mount(a.target)]);
      } else if (a.seating === "placed") {
        blocking("post", "part_not_seated", "assembly", m.part.instanceId, pcTarget.part(m.part.instanceId), { ...p, symptom: SYMPTOM.noPost }, [], [pcTarget.mount(a.target)]);
      }
      const perModule = board.entry.spec.memory.maxPerModuleGb;
      if (perModule !== null && m.entry.spec.capacityPerModuleGb > perModule) {
        blocking("post", "ram_capacity_exceeded", "startup_fault", m.part.instanceId, pcTarget.part(m.part.instanceId), { host: displayName(board.entry) }, [
          evidence("Capacity of this module", "سعة هذي الرام", `${m.entry.spec.capacityPerModuleGb} GB`, `<= ${perModule} GB`, m.entry.id),
        ]);
      }
    }
    if (totalGb > board.entry.spec.memory.maxTotalGb) {
      blocking("post", "ram_capacity_exceeded", "startup_fault", "total", boardTarget, { host: displayName(board.entry) }, [
        evidence("Total installed memory", "مجموع الرام المركّبة", `${totalGb} GB`, `<= ${board.entry.spec.memory.maxTotalGb} GB`, board.entry.id),
      ]);
    }

    // Graphics card, when one is installed.
    if (gpu) {
      const a = gpu.part.attachments[0]!;
      if (a.seating !== "seated") {
        blocking("post", "part_not_seated", "assembly", gpu.part.instanceId, pcTarget.part(gpu.part.instanceId), {
          part: displayName(gpu.entry),
          mount: mountSpec(v, a.target)?.label ?? "",
          symptom: SYMPTOM.noPost,
        });
      }
      for (const port of gpu.entry.ports) if (port.function === "gpu_power" && port.requirement === "required") needPower("post", gpu, port.id, SYMPTOM.noPost);
    }
  }

  // ---------- Stage 3: firmware and graphics readiness ----------
  // No monitor or display cable is part of the lab (owner decision 11): the stage checks that the build has
  // a working graphics device for the firmware, either a graphics card or the CPU's integrated graphics.
  if (cpu && cpu.entry.spec.integratedGraphics === null && !gpu) {
    const slot = board?.entry.mountPoints.find((m) => m.kind === "pcie_slot");
    const loose = gpus[0];
    if (loose) notMounted("firmware_display", loose, SYMPTOM.noGraphics);
    else {
      blocking("firmware_display", "graphics_missing", "startup_fault", "graphics", slot && board ? pcTarget.mount({ hostInstanceId: board.part.instanceId, mountPointId: slot.id }) : boardTarget, {}, [
        evidence("Integrated graphics of the CPU", "الكرت المدمج في المعالج", "none", undefined, cpu.entry.id),
        evidence("Graphics card installed", "كرت شاشة مركّب", "no", "yes"),
      ]);
    }
  }

  // ---------- Stage 4: bootable storage ----------
  if (storages.length === 0) {
    const slot = board?.entry.mountPoints.find((m) => m.kind === "m2_slot");
    blocking("boot_device", "storage_missing", "startup_fault", "storage", slot && board ? pcTarget.mount({ hostInstanceId: board.part.instanceId, mountPointId: slot.id }) : boardTarget);
  } else {
    const undetected: PCDiagnostic[] = [];
    let detected = 0;
    let bootable = 0;
    for (const s of storages) {
      const name = displayName(s.entry);
      const target = pcTarget.part(s.part.instanceId);
      const miss = (why: Localized, t: TutorTargetRef, ev: PCEvidence[], related: TutorTargetRef[] = []) =>
        undetected.push(makeDiag(v, "storage_not_detected", "assembly", "blocking", { subject: s.part.instanceId, target: t, related, stage: "boot_device", params: { part: name, why }, evidence: ev, startupRun: run }));
      const a = s.part.attachments[0];
      if (s.entry.spec.formFactor.startsWith("m2")) {
        const inSlot = a && board && a.target.hostInstanceId === board.part.instanceId;
        if (!inSlot) {
          miss(L("An M.2 drive connects through its slot; on the bench it is connected to nothing.", "قرص M.2 يتوصّل عن طريق فتحته؛ وهو على الطاولة مو موصّل بشي."), target, [evidence("Installed in an M.2 slot", "مركّب في فتحة M.2", "no", "yes")]);
          continue;
        }
        if (a.seating !== "seated") {
          miss(L("The drive is resting in the slot but is not pushed in and held down, so its contacts do not connect.", "القرص محطوط في الفتحة بس ما اندفع وتثبّت، فنقاط تلامسه ما توصل."), target, [evidence("Seating", "حالة التثبيت", a.seating, "seated")], [pcTarget.mount(a.target)]);
          continue;
        }
      } else {
        const dataPort = s.entry.ports.find((p) => p.function === "sata_data");
        const powerPort = s.entry.ports.find((p) => p.function === "sata_power");
        const dataRef: PortRef | undefined = dataPort && { kind: "part", instanceId: s.part.instanceId, portId: dataPort.id };
        const dataCable = dataRef && v.state.cables.find((c) => Object.values(c.ends).some((to) => !!to && to.kind === "part" && to.instanceId === dataRef.instanceId && to.portId === dataRef.portId));
        const dataFar = dataCable && Object.values(dataCable.ends).find((to) => !!to && !(to.kind === "part" && to.instanceId === s.part.instanceId));
        const dataOk = !!dataFar && !!board && dataFar.kind === "part" && dataFar.instanceId === board.part.instanceId && socketInfo(v, dataFar)?.function === "sata_data";
        const powerOk = !!powerPort && feedOf(v, s.part.instanceId, powerPort.id).feed === "connected";
        if (!dataOk || !powerOk) {
          const first = !dataOk ? dataRef : powerPort && ({ kind: "part", instanceId: s.part.instanceId, portId: powerPort.id } as PortRef);
          miss(
            L(
              "A SATA drive needs two separate cables: a data cable to a SATA port on the motherboard and a SATA power plug from the power supply. Both must be connected for the drive to be detected.",
              "قرص SATA يحتاج كيبلين منفصلين: كيبل بيانات لمنفذ SATA في اللوحة الأم، وراس طاقة SATA من مزوّد الطاقة. لازم الثنين يتوصّلون عشان اللوحة تشوف القرص.",
            ),
            first ? pcTarget.port(first) : target,
            [evidence("SATA data to the motherboard", "بيانات SATA إلى اللوحة الأم", dataOk ? "yes" : "no", "yes"), evidence("SATA power from the power supply", "طاقة SATA من مزوّد الطاقة", powerOk ? "yes" : "no", "yes")],
            [target],
          );
          continue;
        }
        if (!a) advise("part_not_mounted", "assembly", "warning", s.part.instanceId, target, { part: name });
      }
      detected += 1;
      if (s.part.bootable !== false) bootable += 1;
    }
    if (detected === 0) stages.boot_device.push(...undetected);
    else {
      // A drive that is not detected does not stop the boot when another one works; it is still worth knowing.
      for (const d of undetected) advisories.push({ ...d, severity: "warning" });
      if (bootable === 0) {
        blocking("boot_device", "storage_not_bootable", "startup_fault", "storage", pcTarget.part(storages[0]!.part.instanceId), {}, [
          evidence("Drives detected", "الأقراص المقروءة", String(detected)),
          evidence("Drives with an operating system", "الأقراص اللي عليها نظام تشغيل", "0", ">= 1"),
        ]);
      }
    }
  }

  // ---------- Stage 5: simplified operating load ----------
  const cpuW = cpu ? (cpu.entry.spec.maxPowerW ?? cpu.entry.spec.basePowerW) : null;
  const gpuW = gpu ? (gpu.entry.spec.powerDrawW ?? 0) : 0;
  const estimatedDrawW = (cpuW ?? 0) + gpuW + LOAD_MODEL.baseSystemW;
  const psuW = psu ? psu.entry.spec.wattageW : null;
  const coolerW = cooler?.entry.spec.coolingCapacityW?.value ?? null;
  if (psu && psuW !== null && estimatedDrawW > psuW) {
    blocking("operating_load", "psu_insufficient_for_load", "operating_load_fault", psu.part.instanceId, pcTarget.part(psu.part.instanceId), { part: displayName(psu.entry) }, [
      evidence("Estimated load (teaching model)", "الحمل المقدَّر (نموذج تعليمي)", `${estimatedDrawW} W`, `<= ${psuW} W`),
      evidence("CPU maximum power", "أقصى طاقة للمعالج", `${cpuW ?? 0} W`, undefined, cpu?.entry.id),
      evidence("Graphics card power", "طاقة كرت الشاشة", `${gpuW} W`, undefined, gpu?.entry.id),
      evidence("Allowance for the rest of the system", "هامش لبقية النظام", `${LOAD_MODEL.baseSystemW} W`),
      evidence("Power supply rated output", "قدرة مزوّد الطاقة المكتوبة", `${psuW} W`, undefined, psu.entry.id),
    ], gpu ? [pcTarget.part(gpu.part.instanceId)] : []);
  } else if (psu && psuW !== null && gpu && gpu.entry.spec.recommendedPsuW !== null && gpu.entry.spec.recommendedPsuW > psuW) {
    advise("psu_below_gpu_recommendation", "optional_improvement", "info", psu.part.instanceId, pcTarget.part(psu.part.instanceId), { part: displayName(psu.entry) }, [
      evidence("Power supply rated output", "قدرة مزوّد الطاقة المكتوبة", `${psuW} W`, `>= ${gpu.entry.spec.recommendedPsuW} W`, psu.entry.id),
      evidence("Recommended by the card's manufacturer", "نصيحة مصنّع الكرت", `${gpu.entry.spec.recommendedPsuW} W`, undefined, gpu.entry.id),
      evidence("Estimated load (teaching model)", "الحمل المقدَّر (نموذج تعليمي)", `${estimatedDrawW} W`),
    ]);
  }
  if (cpu) {
    if (!cooler) {
      const mount = board?.entry.mountPoints.find((m) => m.kind === "cpu_cooler_mount");
      blocking("operating_load", "cooler_missing", "operating_load_fault", "cooler", mount && board ? pcTarget.mount({ hostInstanceId: board.part.instanceId, mountPointId: mount.id }) : boardTarget, {}, [], [pcTarget.part(cpu.part.instanceId)]);
    } else {
      const name = displayName(cooler.entry);
      const coolerTarget = pcTarget.part(cooler.part.instanceId);
      const block = cooler.part.attachments.find((a) => mountSpec(v, a.target)?.kind === "cpu_cooler_mount")!;
      const total = mountSpec(v, block.target)?.fastener?.count ?? 0;
      if (block.seating !== "seated" || block.fastenersSecured < total) {
        blocking("operating_load", "cooler_not_secured", "assembly", cooler.part.instanceId, coolerTarget, { part: name }, [
          evidence("Seating", "حالة التثبيت", block.seating, "seated"),
          evidence("Mounting points fastened", "نقاط التثبيت المشدودة", `${block.fastenersSecured} / ${total}`, `${total} / ${total}`),
        ], [pcTarget.mount(block.target)]);
      }
      // An AIO radiator left hanging cannot shed heat.
      for (const role of cooler.entry.mounting) {
        if (role.kind === "radiator_mount" && !attachmentOf(cooler.part, role.role)) {
          blocking("operating_load", "part_not_mounted", "assembly", `${cooler.part.instanceId}.${role.role}`, coolerTarget, { part: role.label, symptom: SYMPTOM.overheats });
        }
      }
      // Its fan or pump has to run.
      for (const c of v.state.cables) {
        if (c.ownerInstanceId !== cooler.part.instanceId) continue;
        for (const e of cableSpec(v, c)?.ends ?? []) {
          if (!isMotorLead(e.function)) continue;
          const to = c.ends[e.id];
          const header = to ? socketInfo(v, to) : undefined;
          if (header && isMotorHeader(header.function)) continue;
          const headers = board ? board.entry.ports.filter((p) => p.function === (e.function === "pump_motor" ? "pump_header" : "cpu_fan_header")) : [];
          blocking("operating_load", e.function === "pump_motor" ? "pump_not_connected" : "cooler_fan_not_connected", "assembly", c.id, pcTarget.cableEnd(c.id, e.id), { part: name }, [],
            headers.slice(0, 1).map((p) => pcTarget.port({ kind: "part", instanceId: board!.part.instanceId, portId: p.id })));
        }
      }
      if (coolerW !== null && cpuW !== null && cpuW > coolerW) {
        blocking("operating_load", "cooler_insufficient_for_load", "operating_load_fault", cooler.part.instanceId, coolerTarget, { part: name, cpu: displayName(cpu.entry) }, [
          evidence("CPU sustained power", "طاقة المعالج المتواصلة", `${cpuW} W`, `<= ${coolerW} W`, cpu.entry.id),
          evidence(
            cooler.entry.spec.coolingCapacityW?.source === "manufacturer" ? "Cooler rating (manufacturer)" : "Cooler capacity (teaching assumption)",
            cooler.entry.spec.coolingCapacityW?.source === "manufacturer" ? "تصنيف المبرّد (من الشركة)" : "سعة المبرّد (افتراض تعليمي)",
            `${coolerW} W`,
            undefined,
            cooler.entry.id,
          ),
        ], [pcTarget.part(cpu.part.instanceId)]);
      }
    }
  }

  // ---------- Advisories: never change the outcome ----------
  // Parts still on the bench that no stage already reported.
  const reported = new Set(Object.values(stages).flat().map((d) => d.id));
  for (const part of v.state.parts) {
    const entry = entryOf(v, part);
    if (!entry || entry.mounting.length === 0 || isMounted(part)) continue;
    if (reported.has(`part_not_mounted:${part.instanceId}`) || advisories.some((d) => d.id === `part_not_mounted:${part.instanceId}`)) continue;
    advise("part_not_mounted", "assembly", "info", part.instanceId, pcTarget.part(part.instanceId), { part: displayName(entry) });
  }
  // Fasteners that are not all secured (the CPU lever and the cooler are judged in their stages).
  for (const part of v.state.parts) {
    const entry = entryOf(v, part);
    if (!entry || entry.category === "cpu") continue;
    for (const a of part.attachments) {
      const spec = mountSpec(v, a.target);
      const total = spec?.fastener?.count ?? 0;
      if (total === 0 || a.fastenersSecured >= total || spec?.kind === "cpu_cooler_mount") continue;
      advise("fasteners_missing", "assembly", "warning", `${part.instanceId}.${a.role}`, pcTarget.mount(a.target), { part: displayName(entry), done: a.fastenersSecured, total }, [
        evidence("Fasteners secured", "المثبّتات المقفّلة", `${a.fastenersSecured} / ${total}`, `${total} / ${total}`),
      ], [pcTarget.part(part.instanceId)]);
    }
  }
  // Memory layout and profile notes.
  if (board && modules.length > 0) {
    const used = modules.map((m) => m.part.attachments[0]!.target.mountPointId).sort();
    const rule = board.entry.spec.memory.recommendedPopulation.find((r) => r.modules === modules.length);
    if (rule && [...rule.slotIds].sort().join() !== used.join()) {
      const first = rule.slotIds.find((id) => !used.includes(id)) ?? rule.slotIds[0]!;
      advise("ram_population_not_recommended", "optional_improvement", "info", "ram-slots", pcTarget.mount({ hostInstanceId: board.part.instanceId, mountPointId: first }), {}, [
        evidence("Slots in use", "الفتحات المستخدمة", used.map((s) => s.replace("dimm-", "DIMM_").toUpperCase()).join(" + "), [...rule.slotIds].sort().map((s) => s.replace("dimm-", "DIMM_").toUpperCase()).join(" + "), board.entry.id),
      ], modules.map((m) => pcTarget.part(m.part.instanceId)));
    }
    if (modules.length === 1 && board.entry.spec.memory.slots > 1) {
      advise("ram_single_module", "optional_improvement", "info", "ram-count", pcTarget.part(modules[0]!.part.instanceId), {}, [evidence("Modules installed", "الرامات المركّبة", "1", ">= 2")]);
    }
    const noted = new Set<string>();
    for (const m of modules) {
      const d = m.entry.spec.defaultSpeedMTs;
      if (d === null || d >= m.entry.spec.ratedSpeedMTs || noted.has(m.entry.id)) continue;
      noted.add(m.entry.id);
      advise("ram_profile_note", "optional_improvement", "info", m.entry.id, pcTarget.part(m.part.instanceId), { part: displayName(m.entry), default: d, rated: m.entry.spec.ratedSpeedMTs }, [
        evidence("Default rate", "السرعة الافتراضية", `${d} MT/s`, undefined, m.entry.id),
        evidence("Rated with profile", "السرعة المكتوبة مع البروفايل", `${m.entry.spec.ratedSpeedMTs} MT/s`, undefined, m.entry.id),
      ]);
    }
  }
  // Power plugs the build needs but the power supply cannot offer.
  if (psu) {
    const plugs = v.state.cables.filter((c) => c.ownerInstanceId === psu.part.instanceId).flatMap((c) => (cableSpec(v, c)?.ends ?? []).filter((e) => e.side === "device").map((e) => e.connector));
    const needs: { owner: Placed; portId: string }[] = [];
    if (board) for (const p of board.entry.ports) if ((p.function === "atx_main_power" || p.function === "cpu_power") && p.requirement !== "optional") needs.push({ owner: board, portId: p.id });
    if (gpu) for (const p of gpu.entry.ports) if (p.function === "gpu_power" && p.requirement === "required") needs.push({ owner: gpu, portId: p.id });
    const pool = [...plugs];
    const take = (socket: (typeof plugs)[number]): boolean => {
      const i = pool.findIndex((plug) => connectorsMate(plug, socket));
      if (i < 0) return false;
      pool.splice(i, 1);
      return true;
    };
    for (const n of needs) {
      const port = n.owner.entry.ports.find((p) => p.id === n.portId)!;
      let satisfied = take(port.connector);
      // A graphics card's supplied adapter turns several 8-pin plugs into its 16-pin plug.
      if (!satisfied) {
        const adapter = n.owner.entry.cables.find((c) => c.kind === "gpu_power_adapter" && c.ends.some((e) => e.side === "device" && connectorsMate(e.connector, port.connector)));
        const inputs = adapter?.ends.filter((e) => e.side === "source") ?? [];
        if (adapter && inputs.length > 0) {
          const before = [...pool];
          satisfied = inputs.every((e) => take(e.connector));
          if (!satisfied) pool.splice(0, pool.length, ...before);
        }
      }
      if (!satisfied) {
        advise("psu_connector_unavailable", "impossible_fit", "warning", `${n.owner.part.instanceId}/${n.portId}`, pcTarget.port({ kind: "part", instanceId: n.owner.part.instanceId, portId: n.portId }), { part: displayName(psu.entry), port: port.label }, [
          evidence("Socket that needs power", "المدخل اللي يحتاج طاقة", CONNECTOR_NAME[port.connector], undefined, n.owner.entry.id),
          evidence("Plugs on the power supply's cables", "الرؤوس اللي في كيبلات مزوّد الطاقة", [...new Set(plugs.map((c) => CONNECTOR_NAME[c]))].join(", "), undefined, psu.entry.id),
        ], [pcTarget.part(psu.part.instanceId)]);
      }
    }
  }
  // Lighting that is wanted but not wired. Never a startup matter.
  if (v.state.rgbPreference === "with_rgb") {
    for (const part of v.state.parts) {
      const entry = entryOf(v, part);
      if (!entry?.rgb || entry.rgb.control === "integrated" || !part.lighting?.enabled || !isMounted(part)) continue;
      if (lightingLeadConnected(v, part)) continue;
      const lead = v.state.cables.find((c) => c.ownerInstanceId === part.instanceId && c.cableSpecId === entry.rgb?.lightingCableId);
      advise("lighting_not_connected", "optional_improvement", "info", part.instanceId, lead ? pcTarget.cableEnd(lead.id, "plug") : pcTarget.part(part.instanceId), { part: displayName(entry) }, [], [pcTarget.part(part.instanceId)]);
    }
  }
  // Cables: half-connected, and untidy.
  let untidy = 0;
  let firstUntidy: CableInstance | undefined;
  for (const c of v.state.cables) {
    const spec = cableSpec(v, c);
    const connected = Object.values(c.ends).filter(Boolean).length;
    if (!spec || connected === 0) continue;
    if (!c.tidied) {
      untidy += 1;
      firstUntidy ??= c;
    }
    const peers = spec.ends.filter((e) => e.side === "peer");
    const looseSource = spec.ends.find((e) => e.side === "source" && e.gender === "plug" && !c.ends[e.id]);
    const loosePeer = peers.length === 2 ? peers.find((e) => !c.ends[e.id]) : undefined;
    const looseEnd = loosePeer ?? looseSource;
    const alreadyReported = Object.values(stages).flat().some((d) => d.code === "power_cable_source_loose" && d.target.id.includes(`:${c.id}/`));
    if (looseEnd && !alreadyReported) {
      advise("cable_end_loose", "assembly", "warning", c.id, pcTarget.cableEnd(c.id, looseEnd.id), { cable: cableLabel(v, c) });
    }
  }
  if (untidy > 0 && firstUntidy) {
    advise("cable_untidy", "optional_improvement", "info", "cables", pcTarget.cableEnd(firstUntidy.id, Object.keys(firstUntidy.ends)[0] ?? "plug"), { count: untidy }, [
      evidence("Connected cables not tidied", "كيبلات موصّلة مو مرتّبة", String(untidy), "0"),
    ]);
  }
  if (theCase && v.state.sidePanelOpen) advise("side_panel_open", "optional_improvement", "info", "panel", pcTarget.setting("side-panel"));

  return {
    stages,
    advisories,
    loadModel: { estimatedDrawW, psuRatedW: psuW, cpuHeatW: cpuW, coolerCapacityW: coolerW },
  };
}

function lightingLeadConnected(v: View, part: InstalledPart): boolean {
  const entry = entryOf(v, part);
  if (!entry?.rgb || entry.rgb.control === "integrated") return true;
  const lead = v.state.cables.find((c) => c.ownerInstanceId === part.instanceId && c.cableSpecId === entry.rgb?.lightingCableId);
  const want = entry.rgb.control === "argb_5v_3pin" ? "argb_header" : "rgb_header";
  return !!lead && Object.values(lead.ends).some((to) => !!to && socketInfo(v, to)?.function === want);
}

/**
 * Everything wrong or improvable in the build, whether or not the power button has been pressed:
 * blocking findings of all five stages (each tagged with its `stage`) followed by advisories.
 * Pass only `projectRevision` in `ctx`; these are not results of a startup run.
 */
export function diagnoseBuild(state: PCBuildState, catalog: PCCatalog, ctx: PCEvaluationContext = {}): PCDiagnostic[] {
  const a = analyse(makeView(state, catalog, ctx), false);
  return [...STARTUP_STAGES.flatMap((s) => a.stages[s]), ...a.advisories];
}

const OUTCOME_BY_STAGE: Record<StartupStage, StartupOutcome> = {
  power: "no_power",
  post: "no_post",
  firmware_display: "no_display",
  boot_device: "no_boot_device",
  operating_load: "load_fault",
};

/**
 * What happens when the power button is pressed, stage by stage. Stops at the first stage with a blocking
 * finding; later stages are `not_reached`, so the learner diagnoses one thing at a time.
 * Lighting never affects any stage, and the same build evaluates identically with or without RGB.
 */
export function evaluateStartup(state: PCBuildState, catalog: PCCatalog, ctx: PCEvaluationContext = {}): StartupResult {
  const v = makeView(state, catalog, ctx);
  const a = analyse(v, true);
  const pressed = state.power.pressed;

  let failedAt: StartupStage | null = null;
  const stages: StageResult[] = STARTUP_STAGES.map((stage) => {
    if (!pressed) return { stage, status: "not_reached", observation: stage === "power" ? STAGE_IDLE : STAGE_NOT_REACHED, diagnostics: [] };
    if (failedAt) return { stage, status: "not_reached", observation: STAGE_NOT_REACHED, diagnostics: [] };
    const found = a.stages[stage];
    if (found.length > 0) {
      failedAt = stage;
      return { stage, status: "failed", observation: STAGE_FAILED[stage], diagnostics: found };
    }
    return { stage, status: "passed", observation: STAGE_PASSED[stage], diagnostics: [] };
  });
  const failed = failedAt as StartupStage | null;
  const outcome: StartupOutcome = !pressed ? "idle" : failed ? OUTCOME_BY_STAGE[failed] : "operational";
  const passed = (stage: StartupStage) => stages.find((s) => s.stage === stage)?.status === "passed";
  const powered = pressed && passed("power");

  // Fans and pumps turn as soon as the board has power, whatever happens afterwards.
  const board = partsOf(v, "motherboard").find((b) => isMounted(b.part));
  const spinning: string[] = [];
  if (powered && board && psuLive(v)) {
    for (const c of state.cables) {
      if (!c.ownerInstanceId || spinning.includes(c.ownerInstanceId)) continue;
      const runs = (cableSpec(v, c)?.ends ?? []).some((e) => {
        const to = c.ends[e.id];
        const header = to ? socketInfo(v, to) : undefined;
        return isMotorLead(e.function) && !!to && to.kind === "part" && to.instanceId === board.part.instanceId && !!header && isMotorHeader(header.function);
      });
      if (runs) spinning.push(c.ownerInstanceId);
    }
  }

  // Light only where there is hardware, it is wanted and enabled, its connection is valid, and it has power.
  const lighting: LightingStatus[] = [];
  for (const part of state.parts) {
    const entry = entryOf(v, part);
    if (!entry?.rgb || !part.lighting) continue;
    const connected = entry.rgb.control === "integrated" ? part.attachments.some((x) => x.seating === "seated") : lightingLeadConnected(v, part);
    const integratedPowered =
      entry.category !== "gpu" || entry.ports.filter((p) => p.function === "gpu_power" && p.requirement === "required").every((p) => feedOf(v, part.instanceId, p.id).feed === "connected");
    const reason: LightingStatus["reason"] =
      state.rgbPreference === "without_rgb"
        ? "preference_without_rgb"
        : !part.lighting.enabled
          ? "disabled"
          : !connected
            ? "not_connected"
            : !powered || !integratedPowered
              ? "not_powered"
              : "lit";
    lighting.push({
      instanceId: part.instanceId,
      lit: reason === "lit",
      reason,
      color: reason === "lit" ? part.lighting.color : null,
      effect: reason === "lit" ? part.lighting.effect : null,
    });
  }

  const screen: ScreenState =
    !pressed || !powered || !passed("post")
      ? "off"
      : !passed("firmware_display")
        ? "no_signal"
        : !passed("boot_device")
          ? "no_boot_device"
          : "operating_system";

  return {
    model: "educational",
    disclaimer: DISCLAIMER,
    outcome,
    stages,
    observable: { spinning, lighting, screen },
    advisories: a.advisories,
    loadModel: a.loadModel,
  };
}

// Kept for callers that only need to know whether a cable is electrically joined to the power supply.
export { cableReachesPsu };
