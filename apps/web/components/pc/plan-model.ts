// The assembly model of a build the learner planned: the same page, the same steps, with the parts
// that were chosen. Instance IDs, mount points, screws and leads are all read from the catalog and
// from the engine, so a different board, case or power supply changes the assembly accordingly
// (an M.2 drive goes in the board's M.2 slot, a 3.5-inch drive in a 3.5-inch bay, a modular cable is
// plugged into the power supply as well as the part, a pump goes to CPU_OPT on a board without
// AIO_PUMP, a fan past the board's fan headers has no lead to connect).
import type { CatalogEntry, PCAction, PCBuildState, PortSpec } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { pcCatalog, suppliedPartActions } from "./catalog";
import { applySimpleStep, createSimpleBuild, deriveSimpleLists, emptySimpleSnapshot, isPositionKey, type SimpleStep, type CableExtraEnd, type CableSpec, type PartSpec, type SimpleModel, type SimplePartKey, type SimpleSnapshot } from "./simple-model";

/** What the learner is building for. */
export type BuildPurpose = "study" | "gaming" | "creator";
export const PURPOSES: readonly BuildPurpose[] = ["study", "gaming", "creator"];

/** A planned build as it is saved: the purpose, the workload choice and the parts. */
export interface PlannedBuild {
  version: 1;
  purpose: BuildPurpose | null;
  /** Gaming: "1080p" | "1440p"; creator: "photo" | "video1080" | "video4k"; study: "" */
  workload: string;
  parts: pc.BuildPlan;
}

const byId = new Map(pcCatalog.entries.map((e) => [e.id, e]));
const entry = <C extends CatalogEntry["category"]>(id: string | null | undefined, category: C) => {
  const e = id ? byId.get(id) : undefined;
  return e?.category === category ? (e as Extract<CatalogEntry, { category: C }>) : undefined;
};

function run(actions: readonly PCAction[]): PCBuildState {
  let state = pc.createBuild(pcCatalog);
  for (const action of actions) {
    const r = pc.applyAction(state, action, pcCatalog);
    if (!r.ok) throw new Error(`Planned PC: ${r.rejection.code}`);
    state = r.state;
  }
  return state;
}

/** The cable spec a cable instance comes from. */
const specOf = (state: PCBuildState, cableId: string) => {
  const c = state.cables.find((x) => x.id === cableId);
  return c ? byId.get(c.catalogId)?.cables.find((s) => s.id === c.cableSpecId) : undefined;
};

/**
 * The assembly model of a plan. Throws when the plan is not assemblable (the planner only offers
 * "Start assembly" when `checkPlan` reports it ready).
 */
export function planModel(build: PlannedBuild): SimpleModel {
  const plan = build.parts;
  const caseE = entry(plan.case, "case")!;
  const board = entry(plan.motherboard, "motherboard")!;
  const cpu = entry(plan.cpu, "cpu")!;
  const cooler = entry(plan.cooler, "cooling")!;
  const psu = entry(plan.psu, "psu")!;
  const gpu = entry(plan.gpu, "gpu");
  const ram = entry(plan.ram?.id, "ram")!;
  const modules = Math.max(1, plan.ram?.modules ?? ram.spec.modulesInKit);
  const drives = (plan.storage ?? []).map((id) => entry(id, "storage")!).filter(Boolean);
  const fanEntries = (plan.fans ?? []).map((id) => entry(id, "fan")!).filter(Boolean);
  const liquid = cooler.spec.type === "aio_liquid";

  // ---------- The starting build and its instance IDs ----------
  const supplied = suppliedPartActions(caseE.id, "case-1", 2);
  const order: { key: string; catalogId: string }[] = [
    { key: "motherboard", catalogId: board.id },
    { key: "cpu", catalogId: cpu.id },
    ...Array.from({ length: modules }, (_, i) => ({ key: i === 0 ? "ram" : `ram${i + 1}`, catalogId: ram.id })),
    ...drives.map((d, i) => ({ key: i === 0 ? "storage" : `storage${i + 1}`, catalogId: d.id })),
    { key: liquid ? "aio" : "cooler", catalogId: cooler.id },
    ...(gpu ? [{ key: "gpu", catalogId: gpu.id }] : []),
    { key: "psu", catalogId: psu.id },
    ...fanEntries.map((f, i) => ({ key: `fan${i + 1}`, catalogId: f.id })),
  ];
  const baseActions: PCAction[] = [
    { type: "set_rgb_preference", preference: "with_rgb" },
    { type: "add_part", catalogId: caseE.id },
    ...supplied.actions,
    ...order.map((o): PCAction => ({ type: "add_part", catalogId: o.catalogId })),
  ];
  const initial = run(baseActions);
  const loose = initial.parts.filter((p) => p.attachments.length === 0 && p.catalogId !== caseE.id);
  const idOf = new Map<string, string>();
  order.forEach((o, i) => idOf.set(o.key, loose[i]!.instanceId));
  const boardId = idOf.get("motherboard")!;
  const psuId = idOf.get("psu")!;

  // The latest BIOS the catalog records, when the CPU needs a newer one than the factory version.
  const versions = board.spec.biosVersions.map((b) => b.version);
  const since = board.spec.cpuSupport.find((s) => s.cpuId === cpu.id)?.sinceBios;
  const needsUpdate = since !== undefined && versions.indexOf(since) > versions.indexOf(board.spec.factoryBiosVersion);
  const createActions = (): PCAction[] => [...baseActions, ...(needsUpdate ? [{ type: "update_bios", instanceId: boardId, version: versions.at(-1)! } as PCAction] : [])];

  const mountOf = (host: CatalogEntry, id: string) => host.mountPoints.find((m) => m.id === id);
  const screws = (host: CatalogEntry, id: string) => mountOf(host, id)?.fastener?.count ?? 0;

  // ---------- Where each part goes ----------
  const pop = board.spec.memory.recommendedPopulation.find((p) => p.modules === modules)?.slotIds;
  const dimms = board.mountPoints.filter((m) => m.kind === "dimm_slot").map((m) => m.id);
  const ramSlots = pop && pop.length === modules ? pop : dimms.slice(0, modules);
  const parts: PartSpec[] = [];
  const add = (p: PartSpec) => parts.push(p);
  add({ key: "cpu", id: idOf.get("cpu")!, catalogId: cpu.id, host: boardId, mount: "cpu-socket", screws: screws(board, "cpu-socket") });
  for (let i = 0; i < modules; i += 1) add({ key: i === 0 ? "ram" : `ram${i + 1}`, id: idOf.get(i === 0 ? "ram" : `ram${i + 1}`)!, catalogId: ram.id, host: boardId, mount: "dimm", screws: 0 });

  const usedM2 = new Set<string>();
  const usedBays = new Set<string>();
  const m2Keys: string[] = [];
  const sataKeys: string[] = [];
  drives.forEach((d, i) => {
    const key = i === 0 ? "storage" : `storage${i + 1}`;
    const id = idOf.get(key)!;
    if (d.spec.formFactor.startsWith("m2_")) {
      const slot = board.mountPoints.find((m) => m.kind === "m2_slot" && !usedM2.has(m.id) && (m.lengths as string[]).includes(d.spec.formFactor) && (m.interfaces as string[]).includes(d.spec.interface));
      if (!slot) throw new Error("Planned PC: no M.2 slot");
      usedM2.add(slot.id);
      m2Keys.push(key);
      add({ key, id, catalogId: d.id, host: boardId, mount: slot.id, screws: slot.fastener?.count ?? 0 });
    } else {
      const bay = caseE.mountPoints.find((m) => m.kind === "drive_bay" && !usedBays.has(m.id) && (m.sizes as string[]).includes(d.spec.formFactor));
      if (!bay) throw new Error("Planned PC: no drive bay");
      usedBays.add(bay.id);
      sataKeys.push(key);
      add({ key, id, catalogId: d.id, host: "case-1", mount: bay.id, screws: bay.fastener?.count ?? 0 });
    }
  });

  // Fan places already taken by the case's own fans.
  const suppliedFans = supplied.instanceIds.map((instanceId) => ({ instanceId, mount: initial.parts.find((p) => p.instanceId === instanceId)!.attachments[0]!.target.mountPointId }));
  const takenFan = new Set(suppliedFans.map((f) => f.mount));
  let radiator: PartSpec["radiator"];
  if (liquid) {
    const size = cooler.spec.radiatorSizeMm ?? 0;
    const fanSize = (instanceId: string) => entry(initial.parts.find((p) => p.instanceId === instanceId)!.catalogId, "fan")!.spec.sizeMm;
    // The first position of the radiator's size whose covered fan places can be cleared (as checkPlan does).
    let place: (typeof caseE.mountPoints)[number] | undefined;
    let moveFans: [string, string][] = [];
    for (const m of caseE.mountPoints) {
      if (m.kind !== "radiator_mount" || !m.radiatorSizesMm.includes(size)) continue;
      const blocked = new Set(m.blocks ?? []);
      const taken = new Set(takenFan);
      const moves: [string, string][] = [];
      let ok = true;
      for (const f of suppliedFans.filter((x) => blocked.has(x.mount))) {
        const to = caseE.mountPoints.find((x) => x.kind === "fan_mount" && !blocked.has(x.id) && !taken.has(x.id) && x.sizesMm.includes(fanSize(f.instanceId)));
        if (!to) { ok = false; break; }
        taken.delete(f.mount);
        taken.add(to.id);
        moves.push([f.instanceId, to.id]);
      }
      if (!ok) continue;
      place = m;
      moveFans = moves;
      takenFan.clear();
      for (const t of taken) takenFan.add(t);
      for (const b of blocked) takenFan.add(b);
      break;
    }
    if (!place || place.kind !== "radiator_mount") throw new Error("Planned PC: no radiator position");
    radiator = { host: "case-1", mount: place.id, screws: place.fastener?.count ?? 0, moveFans };
  }
  add({ key: liquid ? "aio" : "cooler", id: idOf.get(liquid ? "aio" : "cooler")!, catalogId: cooler.id, host: boardId, mount: "cooler-mount", screws: screws(board, "cooler-mount"), ...(liquid ? { slot: "cooler" } : {}), ...(radiator ? { radiator } : {}) });
  add({ key: "motherboard", id: boardId, catalogId: board.id, host: "case-1", mount: "motherboard-tray", screws: screws(caseE, "motherboard-tray") });
  if (gpu) add({ key: "gpu", id: idOf.get("gpu")!, catalogId: gpu.id, host: boardId, mount: "pcie-x16-1", screws: screws(board, "pcie-x16-1") });
  add({ key: "psu", id: psuId, catalogId: psu.id, host: "case-1", mount: "psu-bay", screws: screws(caseE, "psu-bay") });
  const fanKeys: string[] = [];
  fanEntries.forEach((f, i) => {
    const key = `fan${i + 1}`;
    const place = caseE.mountPoints.find((m) => m.kind === "fan_mount" && !takenFan.has(m.id) && m.sizesMm.includes(f.spec.sizeMm));
    if (!place) throw new Error("Planned PC: no fan position");
    takenFan.add(place.id);
    fanKeys.push(key);
    add({ key, id: idOf.get(key)!, catalogId: f.id, host: "case-1", mount: place.id, screws: place.fastener?.count ?? 0 });
  });

  // ---------- Leads ----------
  const cables: CableSpec[] = [];
  const usedEnds = new Set<string>();
  const usedPorts = new Set<string>();
  const usedPsuSockets = new Set<string>();
  const psuCables = initial.cables.filter((c) => c.ownerInstanceId === psuId || c.id.startsWith(`${psuId}.`));
  /** A free plug of one of these connectors on the power supply's cables, and the PSU socket a modular cable needs. */
  const takePlug = (connectors: readonly string[]): { cableId: string; endId: string; extra: CableExtraEnd[] } | null => {
    for (const c of psuCables) {
      const spec = specOf(initial, c.id);
      if (!spec) continue;
      const end = spec.ends.find((e) => e.side === "device" && connectors.includes(e.connector) && !usedEnds.has(`${c.id}/${e.id}`));
      if (!end) continue;
      const extra: CableExtraEnd[] = [];
      if (spec.attachment === "modular") {
        for (const source of spec.ends.filter((e) => e.side === "source")) {
          if (usedEnds.has(`${c.id}/${source.id}`)) continue;
          const socket = psu.ports.find((p) => p.connector === "psu_modular" && p.keying === source.keying && !usedPsuSockets.has(p.id));
          if (!socket) return null;
          usedPsuSockets.add(socket.id);
          usedEnds.add(`${c.id}/${source.id}`);
          extra.push({ cableId: c.id, endId: source.id, instanceId: psuId, portId: socket.id });
        }
      }
      usedEnds.add(`${c.id}/${end.id}`);
      return { cableId: c.id, endId: end.id, extra };
    }
    return null;
  };
  // Every learner step of one modular cable re-checks the PSU end, so later plugs of the same cable list it too.
  const psuEndsOf = new Map<string, CableExtraEnd[]>();
  const plugTo = (key: string, connectors: readonly string[], instanceId: string, portId: string, requires: SimplePartKey[], essential: boolean) => {
    const plug = takePlug(connectors);
    if (!plug) return false;
    const psuEnds = [...(psuEndsOf.get(plug.cableId) ?? []), ...plug.extra];
    psuEndsOf.set(plug.cableId, psuEnds);
    cables.push({ key, id: plug.cableId, endId: plug.endId, instanceId, portId, requires, essential, ...(psuEnds.length ? { extra: psuEnds } : {}) });
    usedPorts.add(`${instanceId}/${portId}`);
    return true;
  };
  const freePort = (host: CatalogEntry, hostId: string, test: (p: PortSpec) => boolean) => host.ports.find((p) => test(p) && !usedPorts.has(`${hostId}/${p.id}`));

  plugTo("atx", ["atx_24pin"], boardId, "atx-24", ["psu", "motherboard"], true);
  board.ports.filter((p) => p.function === "cpu_power" && p.requirement !== "optional").forEach((p, i) => {
    plugTo(i === 0 ? "cpuPower" : `cpuPower${i + 1}`, ["eps_4plus4pin", "eps_8pin"], boardId, p.id, ["psu", "motherboard"], p.requirement === "required");
  });
  if (gpu) {
    gpu.ports.filter((p) => p.function === "gpu_power").forEach((p, i) => {
      const connectors = p.connector === "pcie_8pin" ? ["pcie_6plus2pin", "pcie_8pin"] : ["pcie_12v_2x6", "pcie_12vhpwr"];
      plugTo(i === 0 ? "gpuPower" : `gpuPower${i + 1}`, connectors, idOf.get("gpu")!, p.id, ["psu", "gpu"], true);
    });
  }

  // Cooler leads: a fan lead to CPU_FAN; a pump to AIO_PUMP, else CPU_OPT, else CPU_FAN when the cooler has no separate fan lead.
  const coolerKey = liquid ? "aio" : "cooler";
  const coolerId = idOf.get(coolerKey)!;
  const coolerCables = initial.cables.filter((c) => c.ownerInstanceId === coolerId);
  const motorEnds = coolerCables.flatMap((c) => (specOf(initial, c.id)?.ends ?? []).filter((e) => e.function === "fan_motor" || e.function === "pump_motor").map((e) => ({ cableId: c.id, end: e })));
  const hasFanLead = motorEnds.some((m) => m.end.function === "fan_motor");
  const port = (id: string) => board.ports.find((p) => p.id === id && !usedPorts.has(`${boardId}/${p.id}`))?.id;
  for (const m of motorEnds.filter((x) => x.end.function === "fan_motor")) {
    const to = port("cpu-fan");
    if (!to) continue;
    usedPorts.add(`${boardId}/${to}`);
    cables.push({ key: liquid ? "aioFan" : "cpuFan", id: m.cableId, endId: m.end.id, instanceId: boardId, portId: to, requires: liquid ? [coolerKey, "motherboard"] : ["cpu", coolerKey], essential: true });
  }
  for (const m of motorEnds.filter((x) => x.end.function === "pump_motor")) {
    const to = port("aio-pump") ?? port("cpu-opt") ?? (!hasFanLead ? port("cpu-fan") : undefined) ?? freePort(board, boardId, (p) => p.function === "system_fan_header")?.id;
    if (!to) continue;
    usedPorts.add(`${boardId}/${to}`);
    cables.push({ key: "aioPump", id: m.cableId, endId: m.end.id, instanceId: boardId, portId: to, requires: [coolerKey, "motherboard"], essential: true });
  }

  cables.push({ key: "powerSwitch", id: "case-1.power-switch", endId: "plug", instanceId: boardId, portId: "panel-pwrsw", requires: ["motherboard"], essential: true });

  // Drives on SATA: the board's data cables and the power supply's SATA plugs.
  const dataCables = initial.cables.filter((c) => c.ownerInstanceId === boardId && c.cableSpecId === "sata-data").map((c) => c.id);
  sataKeys.forEach((key, i) => {
    const driveId = idOf.get(key)!;
    const essential = key === "storage";
    const dataCable = dataCables[i];
    const sataPort = freePort(board, boardId, (p) => p.function === "sata_data");
    if (dataCable && sataPort) {
      usedPorts.add(`${boardId}/${sataPort.id}`);
      cables.push({ key: `sataData${i + 1}`, id: dataCable, endId: "b", instanceId: boardId, portId: sataPort.id, requires: [key, "motherboard"], essential, extra: [{ cableId: dataCable, endId: "a", instanceId: driveId, portId: "sata-data" }] });
    }
    plugTo(`sataPower${i + 1}`, ["sata_power"], driveId, "sata-power", [key, "psu"], essential);
  });

  // Case fans, the case's own first, one per chassis fan header; a fan past the headers would need a hub.
  const fanLeads = [...supplied.instanceIds, ...fanKeys.map((k) => idOf.get(k)!)];
  let caseFan = 0;
  for (const fanId of fanLeads) {
    const lead = initial.cables.find((c) => c.ownerInstanceId === fanId && specOf(initial, c.id)?.ends.some((e) => e.function === "fan_motor"));
    const header = freePort(board, boardId, (p) => p.function === "system_fan_header");
    if (!lead || !header) continue;
    usedPorts.add(`${boardId}/${header.id}`);
    caseFan += 1;
    const ownKey = fanKeys.find((k) => idOf.get(k) === fanId);
    cables.push({ key: `caseFan${caseFan}`, id: lead.id, endId: specOf(initial, lead.id)!.ends.find((e) => e.function === "fan_motor")!.id, instanceId: boardId, portId: header.id, requires: ownKey ? [ownKey, "motherboard"] : ["motherboard"], essential: false });
  }

  // Addressable lighting leads to the board's 5 V headers (cosmetic: never needed to start).
  let argb = 0;
  for (const part of initial.parts) {
    for (const c of initial.cables.filter((x) => x.ownerInstanceId === part.instanceId)) {
      const e = specOf(initial, c.id)?.ends.find((x) => x.function === "argb_device");
      if (!e) continue;
      const header = freePort(board, boardId, (p) => p.function === "argb_header");
      if (!header) continue;
      usedPorts.add(`${boardId}/${header.id}`);
      argb += 1;
      const ownKey = parts.find((p) => p.id === part.instanceId)?.key;
      cables.push({ key: `argb${argb}`, id: c.id, endId: e.id, instanceId: boardId, portId: header.id, requires: ownKey ? [ownKey, "motherboard"] : ["motherboard"], essential: false });
    }
  }

  const ramKeys = parts.filter((p) => /^ram\d*$/.test(p.key)).map((p) => p.key);
  // No part has to be on the board before it goes into the case: fitting the CPU, memory and M.2
  // drive on the bench is easier (the guide suggests it), but doing it in the case is a valid order.
  const boardPrep: string[] = [];
  const partList = ["cpu", ...ramKeys, coolerKey, ...m2Keys, "motherboard", ...sataKeys, ...(gpu ? ["gpu"] : []), "psu", ...fanKeys];
  const cableOrder = cables.map((c) => c.key);
  const exercise = pc.EXERCISE_LIQUID_CPU_IDS.has(cpu.id);
  return {
    kind: "plan",
    parts,
    alternatives: [],
    partList,
    swappable: [],
    removable: [],
    boardPrep,
    ramSlots,
    cables,
    swapCables: [],
    swapCablesWith: null,
    swapCablesReplace: [],
    partOrder: () => ["cpu", ...ramKeys, ...m2Keys, ...(liquid ? ["motherboard", "aio"] : ["cooler", "motherboard"]), ...sataKeys, ...(gpu ? ["gpu"] : []), "psu", ...fanKeys],
    cableOrder,
    rule: exercise ? { cpuKeys: ["cpu"], coolerKeys: liquid ? ["aio"] : [] } : null,
    createActions,
    plan: build,
  };
}

/**
 * Progress of `snapshot` (made under `from`) carried over to the model `to` after parts were
 * replaced. Only what the change affects is undone: the replaced parts, the parts that sat on a
 * replaced host (all of them when the case changes), and the leads of any of these or whose ends
 * moved. Every other step stays, in its order; a step that can no longer be taken is dropped.
 */
export function rebaseProgress(snapshot: { placed: string[]; connected: string[]; history: string[]; powered: boolean }, from: SimpleModel, to: SimpleModel) {
  const fromPart = new Map(from.parts.map((p) => [p.key, p]));
  const toPart = new Map(to.parts.map((p) => [p.key, p]));
  // Instance IDs shift when a part is added or removed earlier in the list; compare by part key instead.
  const keyOfId = (m: SimpleModel) => new Map(m.parts.map((p) => [p.id, p.key]));
  const fromKeys = keyOfId(from);
  const toKeys = keyOfId(to);
  const hostKey = (keys: Map<string, string>, id: string) => keys.get(id) ?? id;
  const changed = new Set<string>();
  for (const [key, p] of fromPart) {
    const q = toPart.get(key);
    // A bay or fan place is the learner's choice, so the plan's suggested one moving does not undo the part's steps.
    if (!q || q.catalogId !== p.catalogId || (q.mount !== p.mount && !isPositionKey(key)) || hostKey(toKeys, q.host) !== hostKey(fromKeys, p.host)) changed.add(key);
  }
  const fromCase = from.createActions().find((a) => a.type === "add_part");
  const toCase = to.createActions().find((a) => a.type === "add_part");
  const caseChanged = JSON.stringify(fromCase) !== JSON.stringify(toCase);
  // Parts resting on a changed part come off with it (the board carries the CPU, memory, drives, card).
  let grew = true;
  while (grew) {
    grew = false;
    for (const [key, p] of fromPart) {
      if (changed.has(key)) continue;
      const onKey = fromKeys.get(p.host);
      if ((onKey && changed.has(onKey)) || (caseChanged && p.host === "case-1")) { changed.add(key); grew = true; }
    }
  }
  const fromCable = new Map(from.cables.map((c) => [c.key, c]));
  const toCable = new Map(to.cables.map((c) => [c.key, c]));
  /** A lead with its part IDs written as part keys (`motherboard.atx24`), so renumbering does not count as a change. */
  const norm = (c: CableSpec, keys: Map<string, string>) => JSON.stringify(c, (_, v) => {
    if (typeof v !== "string") return v;
    const dot = v.indexOf(".");
    const head = dot > 0 ? v.slice(0, dot) : v;
    return keys.has(head) ? `${keys.get(head)}${dot > 0 ? v.slice(dot) : ""}` : v;
  });
  const keepCable = (key: string) => {
    const a = fromCable.get(key);
    const b = toCable.get(key);
    return !!a && !!b && norm(a, fromKeys) === norm(b, toKeys) && !b.requires.some((k) => changed.has(k));
  };
  const history = snapshot.history.filter((step) => {
    const kind = step.slice(0, step.indexOf(":"));
    const key = step.slice(step.indexOf(":") + 1);
    if (kind === "cable") return keepCable(key);
    if (kind === "plug") return keepCable(key.slice(0, key.lastIndexOf(":")));
    // Levers and latches belong to the board: they stay unless the board itself changed.
    if (kind === "mech") return !changed.has("motherboard");
    // prep:<part>:<what>:<value>, screw:<part>:<corner> and place:<part>@<position> belong to their part.
    const part = key.split(/[:@]/)[0]!;
    return toPart.has(part) && !changed.has(part);
  });
  return { history, changed: [...changed] };
}

/** The active model's snapshot of these steps, in order, without any step that can no longer be taken. */
export function snapshotFromHistory(history: readonly string[]): SimpleSnapshot {
  const empty = emptySimpleSnapshot();
  let state = createSimpleBuild();
  const kept: SimpleStep[] = [];
  for (const step of history as SimpleStep[]) {
    try {
      state = applySimpleStep(state, step);
      kept.push(step);
    } catch { /* Dropped: it depended on something no longer in. */ }
  }
  return { ...empty, history: kept, ...deriveSimpleLists(kept) };
}

/** Parses a saved planned build; null when it is not one. */
export function parsePlannedBuild(value: unknown): PlannedBuild | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.parts !== "object" || v.parts === null) return null;
  const purpose = PURPOSES.includes(v.purpose as BuildPurpose) ? (v.purpose as BuildPurpose) : null;
  const p = v.parts as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && byId.has(x) ? x : null);
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string" && byId.has(i)).slice(0, 8) : []);
  const ramRaw = p.ram as { id?: unknown; modules?: unknown } | null | undefined;
  const ram = ramRaw && str(ramRaw.id) ? { id: ramRaw.id as string, modules: Math.min(8, Math.max(1, Number(ramRaw.modules) || 2)) } : null;
  return {
    version: 1,
    purpose,
    workload: typeof v.workload === "string" ? v.workload.slice(0, 20) : "",
    parts: { case: str(p.case), motherboard: str(p.motherboard), cpu: str(p.cpu), cooler: str(p.cooler), psu: str(p.psu), gpu: str(p.gpu), ram, storage: list(p.storage), fans: list(p.fans) },
  };
}
