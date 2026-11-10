// Pure helpers for the network lab view: reading stored projects, the ready-made home networks,
// and the rows the list view shows. Rules stay in the engine (@ytl/simulation); nothing here
// decides what is allowed, and nothing here touches a real network.
import {
  type Localized,
  type NetworkCable,
  type NetworkCableEndId,
  type NetworkDevice,
  type NetworkPortSpec,
  type NetworkProjectData,
  type NetworkState,
  type WireColor,
} from "@ytl/contracts";
import { network } from "@ytl/simulation";

export { NETWORK_PROJECT_DATA_VERSION } from "@ytl/contracts";

export const CABLE_ENDS = ["a", "b"] as const satisfies readonly NetworkCableEndId[];

// ---------- Ready-made networks ----------

export type NetworkPreset = network.NetworkPreset;

/** The engine's complete home networks, with their titles in both languages. Everything is virtual. */
export const NETWORK_PRESETS = network.networkPresets;

/** Project data for an empty bench or a ready network. Null when the engine refuses a step of the preset. */
export function newNetworkProjectData(preset?: NetworkPreset): NetworkProjectData | null {
  if (!preset) return { state: network.createNetwork(), log: [] };
  const replayed = network.replay(preset.actions);
  return replayed.rejection ? null : { state: replayed.state, log: [...preset.actions] };
}

// ---------- Stored data ----------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks that stored data has the shape of a network project, so the view can render it. Null otherwise. */
export function parseNetworkProjectData(raw: unknown): NetworkProjectData | null {
  if (!isObject(raw) || !isObject(raw.state) || !Array.isArray(raw.log)) return null;
  const { devices, cables } = raw.state;
  if (!Array.isArray(devices) || !Array.isArray(cables)) return null;
  for (const device of devices) {
    if (!isObject(device) || typeof device.id !== "string" || typeof device.kind !== "string" || typeof device.powered !== "boolean") return null;
    if (!isObject(device.name) || typeof device.name.en !== "string" || typeof device.name.ar !== "string") return null;
    if (!Array.isArray(device.roles) || !isObject(device.config) || !Array.isArray(device.ports)) return null;
    if (!device.ports.every((port) => isObject(port) && typeof port.id === "string" && typeof port.label === "string")) return null;
  }
  for (const cable of cables) {
    if (!isObject(cable) || typeof cable.id !== "string" || (cable.medium !== "fiber" && cable.medium !== "rj45") || !isObject(cable.ends)) return null;
  }
  if (!raw.log.every((action) => isObject(action) && typeof action.type === "string")) return null;
  return raw as unknown as NetworkProjectData;
}

// ---------- Rows of the list view ----------

export interface PortRow {
  port: NetworkPortSpec;
  /** The cable end in this port, if any. */
  plugged: { cableId: string; endId: NetworkCableEndId; cableNumber: number } | null;
}

export interface DeviceRow {
  device: NetworkDevice;
  ports: PortRow[];
}

export interface CableEndRow {
  endId: NetworkCableEndId;
  /** Where this end is plugged in, or null when it is loose. */
  pluggedInto: { device: Localized; portLabel: string } | null;
}

export interface CableRow {
  cable: NetworkCable;
  /** 1-based position among the cables, for a name such as "Cable 2". */
  number: number;
  ends: CableEndRow[];
}

export function networkRows(state: NetworkState): { devices: DeviceRow[]; cables: CableRow[] } {
  const devices = state.devices.map((device) => ({
    device,
    ports: device.ports.map((port) => {
      let plugged: PortRow["plugged"] = null;
      state.cables.forEach((cable, index) => {
        for (const endId of CABLE_ENDS) {
          const to = cable.ends[endId];
          if (to && to.deviceId === device.id && to.portId === port.id) plugged = { cableId: cable.id, endId, cableNumber: index + 1 };
        }
      });
      return { port, plugged };
    }),
  }));
  const cables = state.cables.map((cable, index) => ({
    cable,
    number: index + 1,
    ends: CABLE_ENDS.map((endId) => {
      const to = cable.ends[endId];
      const device = to && state.devices.find((item) => item.id === to.deviceId);
      const port = device?.ports.find((item) => item.id === to?.portId);
      return { endId, pluggedInto: device && port ? { device: device.name, portLabel: port.label } : null };
    }),
  }));
  return { devices, cables };
}

/**
 * The wires as they come out of the jacket before the learner arranges them: the engine's
 * scrambled order for a seed, the same after every reload and never already a wiring standard.
 * The seed comes from what the plug belongs to, so each cable end starts differently.
 */
export function looseWireOrder(key = "practice"): WireColor[] {
  let seed = 7;
  for (const character of key) seed = (seed * 31 + character.charCodeAt(0)) % 100003;
  return network.scrambledWireOrder(seed);
}

/** Addresses typed in one field, separated by commas or spaces. */
export function splitAddresses(text: string): string[] {
  return text.split(/[\s,]+/).filter((item) => item.length > 0);
}
