// The faults a learner can put into a working build or network to make a challenge. Every fault is
// engine actions, offered only when the engine accepts them on a copy and the copy then really
// stops working. Pure: no storage, no rendering.
import type { NetworkAction, NetworkDevice, NetworkState, PCAction, PCBuildState, PCCatalog } from "@ytl/contracts";
import { network, pc } from "@ytl/simulation";

export type PCFaultKind = "ram_partial" | "unplug" | "remove_gpu" | "no_os" | "psu_off";
export type NetworkFaultKind = "unplug" | "device_off" | "wrong_gateway" | "dhcp_off" | "wifi_passphrase" | "nat_off";

export interface FaultOption<K extends string, A> {
  id: string;
  kind: K;
  /** What the fault touches, named as the lab names it (a part and slot, a cable end, a device). Language-neutral. */
  subject: string;
  actions: A[];
}

// ---------- PC ----------

/** The build as it would be with mains on, the supply switched on and the power button pressed. */
export function poweredCopy(state: PCBuildState): PCBuildState {
  return { ...state, power: { wallConnected: true, psuSwitchOn: true, pressed: true } };
}

export function pcOutcome(state: PCBuildState, catalog: PCCatalog) {
  return pc.evaluateStartup(poweredCopy(state), catalog).outcome;
}

/** A PC counts as working when, switched on, the engine's startup model reaches the operating system. */
export function isPcWorking(state: PCBuildState, catalog: PCCatalog): boolean {
  return pcOutcome(state, catalog) === "operational";
}

function applyPc(state: PCBuildState, actions: readonly PCAction[], catalog: PCCatalog): PCBuildState | null {
  let current = state;
  for (const action of actions) {
    const result = pc.applyAction(current, action, catalog);
    if (!result.ok) return null;
    current = result.state;
  }
  return current;
}

export function pcFaults(state: PCBuildState, catalog: PCCatalog): FaultOption<PCFaultKind, PCAction>[] {
  const { byId } = pc.indexCatalog(catalog);
  const name = (instanceId: string) => {
    const entry = byId.get(state.parts.find((part) => part.instanceId === instanceId)?.catalogId ?? "");
    return entry ? `${entry.brand} ${entry.model}` : instanceId;
  };
  // Hardware cannot change while the computer is on; a fault starts with switching it off.
  const off: PCAction[] = state.power.pressed ? [{ type: "power_off" }] : [];
  const candidates: FaultOption<PCFaultKind, PCAction>[] = [];

  for (const part of state.parts) {
    const entry = byId.get(part.catalogId);
    if (!entry) continue;
    for (const attachment of part.attachments) {
      if (entry.category === "ram" && attachment.seating === "seated") {
        candidates.push({
          id: `ram_partial:${part.instanceId}`,
          kind: "ram_partial",
          subject: `${name(part.instanceId)} (${attachment.target.mountPointId})`,
          actions: [...off, { type: "set_seating", instanceId: part.instanceId, role: attachment.role, seating: "partial" }],
        });
      }
      if (entry.category === "gpu") {
        candidates.push({
          id: `remove_gpu:${part.instanceId}`,
          kind: "remove_gpu",
          subject: name(part.instanceId),
          actions: [...off, { type: "set_seating", instanceId: part.instanceId, role: attachment.role, seating: "placed" }, { type: "unmount_part", instanceId: part.instanceId, role: attachment.role }],
        });
      }
    }
    if (entry.category === "storage" && part.bootable) {
      candidates.push({ id: `no_os:${part.instanceId}`, kind: "no_os", subject: name(part.instanceId), actions: [...off, { type: "set_storage_bootable", instanceId: part.instanceId, bootable: false }] });
    }
  }
  for (const cable of state.cables) {
    const spec = pc.cableSpecOf(byId.get(cable.catalogId), cable.cableSpecId);
    for (const [endId, to] of Object.entries(cable.ends)) {
      if (!to) continue;
      const end = spec?.ends.find((item) => item.id === endId);
      candidates.push({
        id: `unplug:${cable.id}/${endId}`,
        kind: "unplug",
        subject: `${spec?.label.en ?? cable.id}: ${end?.label.en ?? endId}`,
        actions: [...off, { type: "disconnect_cable_end", cableId: cable.id, endId }],
      });
    }
  }
  if (state.power.psuSwitchOn) candidates.push({ id: "psu_off", kind: "psu_off", subject: "PSU", actions: [...off, { type: "set_psu_switch", on: false }] });

  // Only what the engine accepts, and only what then really stops the computer from working.
  return candidates.filter((fault) => {
    const broken = applyPc(state, fault.actions, catalog);
    if (!broken) return false;
    // Switching the supply off is itself the fault, so it is judged without switching it back on.
    if (fault.kind === "psu_off") return pc.evaluateStartup({ ...broken, power: { ...broken.power, pressed: true } }, catalog).outcome !== "operational";
    return pcOutcome(broken, catalog) !== "operational";
  });
}

// ---------- Network ----------

export interface NetworkProbe {
  fromDeviceId: string;
  to: string;
}

/** The test a network challenge is judged by: a ping from the first client to the first host of the virtual internet. */
export function networkProbe(state: NetworkState): NetworkProbe | null {
  const client = state.devices.find((device) => device.roles.includes("client"));
  const host = state.devices.find((device) => device.config.isp)?.config.isp?.hosts[0];
  return client && host ? { fromDeviceId: client.id, to: host } : null;
}

export function pingSucceeds(state: NetworkState, probe: NetworkProbe): boolean {
  return network.runConnectivity(state, { kind: "ping", fromDeviceId: probe.fromDeviceId, to: probe.to }).succeeded;
}

/** A network counts as working when nothing blocking is reported and the probe ping arrives. */
export function isNetworkWorking(state: NetworkState): boolean {
  const probe = networkProbe(state);
  return !!probe && pingSucceeds(state, probe) && !network.diagnoseNetwork(state).some((item) => item.severity === "blocking");
}

function applyNetwork(state: NetworkState, actions: readonly NetworkAction[]): NetworkState | null {
  let current = state;
  for (const action of actions) {
    const result = network.applyAction(current, action);
    if (!result.ok) return null;
    current = result.state;
  }
  return current;
}

/** Another address in the same /24 as `address`, so a wrong gateway is still plausible. */
function wrongGateway(address: string, gateway: string | undefined): string {
  const parts = address.split(".");
  for (const last of ["254", "253", "200"]) {
    const candidate = [...parts.slice(0, 3), last].join(".");
    if (candidate !== gateway && candidate !== address) return candidate;
  }
  return [...parts.slice(0, 3), "250"].join(".");
}

export function networkFaults(state: NetworkState): FaultOption<NetworkFaultKind, NetworkAction>[] {
  const probe = networkProbe(state);
  if (!probe) return [];
  const label = (device: NetworkDevice) => device.name.en;
  const candidates: FaultOption<NetworkFaultKind, NetworkAction>[] = [];
  const interfaces = network.resolveInterfaces(state);

  state.cables.forEach((cable, index) => {
    for (const endId of ["a", "b"] as const) {
      const to = cable.ends[endId];
      if (!to) continue;
      const device = state.devices.find((item) => item.id === to.deviceId);
      const port = device?.ports.find((item) => item.id === to.portId);
      candidates.push({
        id: `unplug:${cable.id}/${endId}`,
        kind: "unplug",
        subject: `Cable ${index + 1} (${device ? label(device) : to.deviceId}, ${port?.label ?? to.portId})`,
        actions: [{ type: "disconnect_cable_end", cableId: cable.id, endId }],
      });
    }
  });
  for (const device of state.devices) {
    if (device.kind !== "isp" && device.powered) candidates.push({ id: `device_off:${device.id}`, kind: "device_off", subject: label(device), actions: [{ type: "set_power", deviceId: device.id, powered: false }] });
    const nic = interfaces.find((item) => item.deviceId === device.id && item.interface === "nic");
    if (device.roles.includes("client") && nic?.address && nic.mask) {
      candidates.push({
        id: `wrong_gateway:${device.id}`,
        kind: "wrong_gateway",
        subject: label(device),
        actions: [{ type: "set_interface", deviceId: device.id, interface: "nic", config: { mode: "static", address: nic.address, mask: nic.mask, gateway: wrongGateway(nic.address, nic.gateway), ...(nic.dns?.length ? { dns: nic.dns } : {}) } }],
      });
    }
    if (device.config.dhcpServer?.enabled) {
      candidates.push({ id: `dhcp_off:${device.id}`, kind: "dhcp_off", subject: label(device), actions: [{ type: "set_dhcp_server", deviceId: device.id, config: { ...device.config.dhcpServer, enabled: false } }] });
    }
    if (device.config.wifiClient?.ssid) {
      candidates.push({
        id: `wifi_passphrase:${device.id}`,
        kind: "wifi_passphrase",
        subject: label(device),
        actions: [{ type: "set_wifi_client", deviceId: device.id, ssid: device.config.wifiClient.ssid, passphrase: `${device.config.wifiClient.passphrase}-x` }],
      });
    }
    if (device.config.nat) candidates.push({ id: `nat_off:${device.id}`, kind: "nat_off", subject: label(device), actions: [{ type: "set_nat", deviceId: device.id, enabled: false }] });
  }

  // Only what the engine accepts and what then really breaks the network: the probe fails or something blocking appears.
  return candidates.filter((fault) => {
    const broken = applyNetwork(state, fault.actions);
    return !!broken && (!pingSucceeds(broken, probe) || network.diagnoseNetwork(broken).some((item) => item.severity === "blocking"));
  });
}

export { applyNetwork, applyPc };
