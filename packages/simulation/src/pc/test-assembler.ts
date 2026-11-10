// Shared by the PC engine tests only; not exported from the package.
// Builds a computer from any list of catalog parts by asking the engine where things may go
// (`mountOptions`, `cableEndOptions`) and taking the first sensible answer, the way a careful
// learner would. It never decides compatibility itself: a part the engine refuses everywhere is
// left on the bench, and the startup result says what that means.
import type { CatalogEntry, PCAction, PCBuildState, PCCatalog, PortFunction, PortRef } from "@ytl/contracts";
import { applyAction, cableEndOptions, createBuild, mountOptions } from "./index";

export interface Assembled {
  state: PCBuildState;
  /** Parts that no mount point accepted, with the engine's reason for the first refused option. */
  unplaced: { catalogId: string; code: string | null }[];
}

/** Mount order: the board goes into the case first, then what sits on the board, then the rest. */
const ORDER: CatalogEntry["category"][] = ["case", "motherboard", "cpu", "ram", "cooling", "gpu", "storage", "psu", "fan"];

const POWER_FUNCTIONS: PortFunction[] = ["atx_main_power", "cpu_power", "gpu_power", "sata_power", "sata_data"];
const FRONT_PANEL: PortFunction[] = ["power_switch", "reset_switch", "power_led", "drive_led", "front_audio", "front_usb2", "front_usb3", "front_usb_c"];

export function assemble(catalog: PCCatalog, catalogIds: readonly string[]): Assembled {
  const byId = new Map(catalog.entries.map((e) => [e.id, e]));
  let state = createBuild(catalog);
  const act = (action: PCAction): boolean => {
    const r = applyAction(state, action, catalog);
    if (r.ok) state = r.state;
    return r.ok;
  };

  const added: { instanceId: string; entry: CatalogEntry }[] = [];
  for (const id of catalogIds) {
    const entry = byId.get(id);
    if (!entry) throw new Error(`no catalog entry ${id}`);
    const r = applyAction(state, { type: "add_part", catalogId: id }, catalog);
    if (!r.ok || !r.created?.instanceId) throw new Error(`add_part ${id} refused`);
    state = r.state;
    added.push({ instanceId: r.created.instanceId, entry });
  }

  // A real board is flashed to its newest BIOS before a new processor goes in.
  for (const { instanceId, entry } of added) {
    if (entry.category === "motherboard") act({ type: "update_bios", instanceId, version: entry.spec.biosVersions.at(-1)!.version });
  }

  const unplaced: Assembled["unplaced"] = [];
  const sorted = [...added].sort((a, b) => ORDER.indexOf(a.entry.category) - ORDER.indexOf(b.entry.category));
  for (const { instanceId, entry } of sorted) {
    for (const role of entry.mounting) {
      const options = mountOptions(state, catalog, instanceId).filter((o) => o.role === role.role);
      const fine = options.filter((o) => o.ok);
      if (fine.length === 0) {
        unplaced.push({ catalogId: entry.id, code: options.find((o) => !o.ok)?.rejection?.code ?? null });
        continue;
      }
      let choice = fine[0]!;
      if (entry.category === "ram") {
        // The board manual's recommended slots for two modules, when it has a recommendation.
        const board = state.parts.find((p) => p.instanceId === choice.target.hostInstanceId);
        const boardEntry = board && byId.get(board.catalogId);
        const wanted = boardEntry?.category === "motherboard" ? boardEntry.spec.memory.recommendedPopulation.find((r) => r.modules === 2)?.slotIds ?? [] : [];
        choice = fine.find((o) => wanted.includes(o.target.mountPointId)) ?? choice;
      }
      act({ type: "mount_part", instanceId, role: role.role, target: choice.target });
      act({ type: "set_seating", instanceId, role: role.role, seating: "seated" });
      const host = state.parts.find((p) => p.instanceId === choice.target.hostInstanceId);
      const count = (host && byId.get(host.catalogId)?.mountPoints.find((m) => m.id === choice.target.mountPointId)?.fastener?.count) ?? 0;
      if (count > 0) act({ type: "set_fasteners", instanceId, role: role.role, secured: count });
    }
  }

  wire(catalog, () => state, act);

  act({ type: "set_side_panel", open: false });
  act({ type: "set_wall_power", connected: true });
  act({ type: "set_psu_switch", on: true });
  return { state, unplaced };
}

function wire(catalog: PCCatalog, current: () => PCBuildState, act: (a: PCAction) => boolean): void {
  const byId = new Map(catalog.entries.map((e) => [e.id, e]));
  const entryOfPart = (instanceId: string) => {
    const part = current().parts.find((p) => p.instanceId === instanceId);
    return part ? byId.get(part.catalogId) : undefined;
  };
  const socketOf = (to: PortRef) => {
    if (to.kind === "part") {
      const entry = entryOfPart(to.instanceId);
      const port = entry?.ports.find((p) => p.id === to.portId);
      return port && entry ? { fn: port.function, requirement: port.requirement, category: entry.category, cable: false } : undefined;
    }
    const cable = current().cables.find((c) => c.id === to.cableId);
    const end = cable && byId.get(cable.catalogId)?.cables.find((s) => s.id === cable.cableSpecId)?.ends.find((e) => e.id === to.endId);
    return end ? { fn: end.function, requirement: "required" as const, category: "cable", cable: true } : undefined;
  };
  const RANK = { required: 0, recommended: 1, optional: 2 } as const;

  for (let pass = 0; pass < 8; pass++) {
    let progress = false;
    for (const cable of current().cables) {
      const spec = byId.get(cable.catalogId)?.cables.find((s) => s.id === cable.cableSpecId);
      const owner = cable.ownerInstanceId ? entryOfPart(cable.ownerInstanceId) : undefined;
      for (const end of spec?.ends ?? []) {
        const live = current().cables.find((c) => c.id === cable.id)!;
        if (end.gender !== "plug" || live.ends[end.id]) continue;
        const connected = Object.values(live.ends).some(Boolean);
        // The power-supply side goes in only once the other end serves something.
        if (end.side === "source" && !connected) continue;
        const options = cableEndOptions(current(), catalog, cable.id, end.id)
          .filter((o) => o.ok)
          .map((o) => ({ o, s: socketOf(o.to) }))
          .filter(({ s }) => {
            if (!s) return false;
            if (end.side === "source") return true;
            if (POWER_FUNCTIONS.includes(end.function) || FRONT_PANEL.includes(end.function)) {
              if (s.fn !== end.function) return false;
              // A data cable joins a drive to the board: its first end goes to the drive.
              if (end.function === "sata_data") return connected ? s.category === "motherboard" : s.category === "storage";
              return true;
            }
            if (end.function === "fan_motor") return s.fn === (owner?.category === "cooling" ? "cpu_fan_header" : "system_fan_header");
            if (end.function === "pump_motor") return s.fn === "pump_header";
            if (end.function === "argb_device") return s.fn === "argb_header";
            if (end.function === "rgb_device") return s.fn === "rgb_header";
            return false;
          })
          .sort((a, b) => RANK[a.s!.requirement] - RANK[b.s!.requirement]);
        const pick = options[0];
        if (pick && act({ type: "connect_cable_end", cableId: cable.id, endId: end.id, to: pick.o.to })) progress = true;
      }
    }
    if (!progress) break;
  }
}
