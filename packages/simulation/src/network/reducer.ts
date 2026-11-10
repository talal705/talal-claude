// The topology reducer: (state, action) -> result. Pure and deterministic; a rejected action
// returns the unchanged state with the reason. Also the port list for the non-drag cabling flow
// and the undo/redo history.
import {
  networkTarget,
  type CablePortOption,
  type Localized,
  type NetworkAction,
  type NetworkActionResult,
  type NetworkCable,
  type NetworkCableEndId,
  type NetworkDevice,
  type NetworkDiagnostic,
  type NetworkHistory,
  type NetworkInterfaceConfig,
  type NetworkPortRef,
  type NetworkProjectData,
  type NetworkState,
} from "@ytl/contracts";
import { ID_PREFIX, createDevice } from "./devices";
import { rejection, unknownDevice } from "./diagnostics";
import { maskPrefix, parseIpv4 } from "./ip";
import { L, fill, portLabel } from "./text";
import { isValidOrder } from "./wiremap";

export function createNetwork(): NetworkState {
  return { devices: [], cables: [] };
}

const isEnd = (endId: string): endId is NetworkCableEndId => endId === "a" || endId === "b";

/** The next free number for an ID prefix, so IDs stay unique after removals and are the same on replay. */
function nextOrdinal(ids: readonly string[], prefix: string): number {
  let highest = 0;
  for (const id of ids) {
    const match = id.startsWith(`${prefix}-`) ? Number(id.slice(prefix.length + 1)) : Number.NaN;
    if (Number.isInteger(match) && match > highest) highest = match;
  }
  return highest + 1;
}

export function portOccupant(state: NetworkState, to: NetworkPortRef): { cable: NetworkCable; endId: NetworkCableEndId } | null {
  for (const cable of state.cables) {
    for (const endId of ["a", "b"] as const) {
      const at = cable.ends[endId];
      if (at && at.deviceId === to.deviceId && at.portId === to.portId) return { cable, endId };
    }
  }
  return null;
}

/** Why this cable end cannot go into this port, or null when it can. The reducer and the option list share it. */
export function checkConnect(state: NetworkState, cableId: string, endId: string, to: NetworkPortRef): NetworkDiagnostic | null {
  const cable = state.cables.find((c) => c.id === cableId);
  if (!cable || !isEnd(endId)) {
    return rejection("unknown_reference", `${cableId}/${endId}`, fill(L("There is no cable end {id}.", "ما في طرف سلك {id}."), { id: `${cableId}/${endId}` }), networkTarget.cableEnd(cableId, endId));
  }
  const device = state.devices.find((d) => d.id === to.deviceId);
  const port = device?.ports.find((p) => p.id === to.portId);
  if (!device || !port) {
    return rejection("unknown_reference", `${to.deviceId}/${to.portId}`, fill(L("There is no port {id}.", "ما في منفذ {id}."), { id: `${to.deviceId}/${to.portId}` }), networkTarget.port(to));
  }
  const where = portLabel(device, port);
  if (cable.ends[endId]) {
    return rejection("cable_end_occupied", `${cableId}/${endId}`, L("This end is already plugged in. Unplug it first.", "هذا الطرف موصّل أصلاً. افصله أول."), networkTarget.cableEnd(cableId, endId));
  }
  if (port.medium !== cable.medium) {
    const message =
      cable.medium === "fiber"
        ? fill(L("A fibre connector does not fit {port}, which is an Ethernet (RJ45) port.", "فيشة الألياف ما تركب في {port}، لأنه منفذ إيثرنت (RJ45)."), { port: where })
        : fill(L("An Ethernet (RJ45) plug does not fit {port}, which is a fibre port.", "فيشة الإيثرنت (RJ45) ما تركب في {port}، لأنه منفذ ألياف."), { port: where });
    return rejection("medium_mismatch", `${cableId}/${endId}>${to.deviceId}/${to.portId}`, message, networkTarget.port(to));
  }
  if (portOccupant(state, to)) {
    return rejection("port_occupied", `${to.deviceId}/${to.portId}`, fill(L("{port} already has a cable.", "{port} فيه سلك أصلاً."), { port: where }), networkTarget.port(to));
  }
  const otherEnd = cable.ends[endId === "a" ? "b" : "a"];
  if (otherEnd && otherEnd.deviceId === to.deviceId) {
    return rejection("not_supported", `${cableId}>${to.deviceId}`, L("The other end of this cable is already in the same device.", "الطرف الثاني من هذا السلك موصّل في نفس الجهاز."), networkTarget.port(to));
  }
  return null;
}

/**
 * Every port in the network for this cable end, in device then port order, each either usable
 * or with the reason it is not. Empty when the end is already plugged in (unplug it first).
 */
export function cablePortOptions(state: NetworkState, cableId: string, endId: string): CablePortOption[] {
  const cable = state.cables.find((c) => c.id === cableId);
  if (!cable || !isEnd(endId) || cable.ends[endId]) return [];
  const options: CablePortOption[] = [];
  for (const device of state.devices) {
    for (const port of device.ports) {
      const to = { deviceId: device.id, portId: port.id };
      const refused = checkConnect(state, cableId, endId, to);
      options.push({ to, label: portLabel(device, port), ok: !refused, ...(refused ? { reason: refused.message } : {}) });
    }
  }
  return options;
}

function checkInterface(deviceId: string, name: string, config: NetworkInterfaceConfig): NetworkDiagnostic | null {
  const bad = (field: string, value: string | undefined, what: Localized) =>
    rejection("invalid_address", `${deviceId}/${name}.${field}`, fill(L("{value} is not a valid {what}.", "{value} مو {what} صحيح."), { value: value ?? "", what }), networkTarget.setting(deviceId, `${name}.${field}`));
  if (config.mode !== "static" && config.mode !== "dhcp" && config.mode !== "none") {
    return rejection("not_supported", `${deviceId}/${name}.mode`, L("Choose automatic (DHCP), manual, or off.", "اختر تلقائي (DHCP)، يدوي، أو مقفل."), networkTarget.setting(deviceId, `${name}.mode`));
  }
  if (config.mode === "static") {
    if (parseIpv4(config.address) === null) return bad("address", config.address, L("IPv4 address", "عنوان IPv4"));
    if (maskPrefix(config.mask) === null) return bad("mask", config.mask, L("subnet mask", "قناع شبكة"));
  }
  if (config.gateway !== undefined && config.gateway !== "" && parseIpv4(config.gateway) === null) return bad("gateway", config.gateway, L("gateway address", "عنوان بوابة"));
  for (const server of config.dns ?? []) {
    if (parseIpv4(server) === null) return bad("dns", server, L("DNS server address", "عنوان خادم DNS"));
  }
  return null;
}

export function applyAction(state: NetworkState, action: NetworkAction): NetworkActionResult {
  const refuse = (rejected: NetworkDiagnostic): NetworkActionResult => ({ ok: false, state, rejection: rejected });
  const device = (id: string): NetworkDevice | undefined => state.devices.find((d) => d.id === id);
  const withDevice = (id: string, change: (d: NetworkDevice) => NetworkDevice): NetworkActionResult => ({
    ok: true,
    state: { ...state, devices: state.devices.map((d) => (d.id === id ? change(d) : d)) },
  });
  const withCable = (id: string, change: (c: NetworkCable) => NetworkCable): NetworkActionResult => ({
    ok: true,
    state: { ...state, cables: state.cables.map((c) => (c.id === id ? change(c) : c)) },
  });
  const noCable = (cableId: string, endId = "") =>
    rejection("unknown_reference", `${cableId}/${endId}`, fill(L("There is no cable {id}.", "ما في سلك {id}."), { id: cableId }), networkTarget.cable(cableId));
  const unsupported = (deviceId: string, what: string) =>
    rejection("not_supported", `${deviceId}/${what}`, L("This device does not have that setting.", "هذا الجهاز ما عنده هذا الإعداد."), networkTarget.device(deviceId));

  switch (action.type) {
    case "add_device": {
      if (!(action.kind in ID_PREFIX)) return refuse(rejection("not_supported", String(action.kind), L("That kind of device does not exist here.", "هذا النوع من الأجهزة مو موجود هنا."), networkTarget.device("new")));
      if (action.kind === "isp" && state.devices.some((d) => d.kind === "isp")) {
        return refuse(rejection("not_supported", "isp", L("This network already has its internet provider.", "هذي الشبكة فيها مزوّد إنترنت أصلاً."), networkTarget.device(state.devices.find((d) => d.kind === "isp")!.id)));
      }
      if (action.variant !== undefined && action.variant !== "standard" && action.variant !== "no_auto_mdix") {
        return refuse(rejection("not_supported", String(action.variant), L("That version of the device does not exist here.", "هذي النسخة من الجهاز مو موجودة هنا."), networkTarget.device("new")));
      }
      const created = createDevice(action.kind, nextOrdinal(state.devices.map((d) => d.id), ID_PREFIX[action.kind]), action.variant);
      return { ok: true, state: { ...state, devices: [...state.devices, created] }, created: { deviceId: created.id } };
    }
    case "remove_device": {
      if (!device(action.deviceId)) return refuse(unknownDevice(action.deviceId));
      const unplug = (at: NetworkPortRef | null) => (at && at.deviceId === action.deviceId ? null : at);
      return {
        ok: true,
        state: {
          devices: state.devices.filter((d) => d.id !== action.deviceId),
          cables: state.cables.map((c) => ({ ...c, ends: { a: unplug(c.ends.a), b: unplug(c.ends.b) } })),
        },
      };
    }
    case "set_power":
      if (!device(action.deviceId)) return refuse(unknownDevice(action.deviceId));
      return withDevice(action.deviceId, (d) => ({ ...d, powered: Boolean(action.powered) }));
    case "move_device": {
      if (!device(action.deviceId)) return refuse(unknownDevice(action.deviceId));
      const { x, y } = action.position ?? { x: Number.NaN, y: Number.NaN };
      if (!Number.isFinite(x) || !Number.isFinite(y)) return refuse(unsupported(action.deviceId, "position"));
      return withDevice(action.deviceId, (d) => ({ ...d, position: { x, y } }));
    }
    case "add_cable": {
      if (action.medium !== "fiber" && action.medium !== "rj45") return refuse(rejection("not_supported", "cable", L("Choose a fibre or an Ethernet cable.", "اختر سلك ألياف أو سلك إيثرنت."), networkTarget.cable("new")));
      if (action.medium === "fiber" && action.terminated) {
        // Fibre termination is a different skill from crimping RJ45 and is not an exercise here.
        return refuse(rejection("not_supported", "cable", L("Fibre is not terminated with an RJ45 crimp. Fibre cables here come ready-made.", "الألياف ما تنكبس مثل فيشة RJ45. أسلاك الألياف هنا تجي جاهزة."), networkTarget.cable("new")));
      }
      const id = `cable-${nextOrdinal(state.cables.map((c) => c.id), "cable")}`;
      const cable: NetworkCable = {
        id,
        medium: action.medium,
        ...(action.medium === "rj45" ? { category: action.category ?? "cat5e" } : {}),
        ends: { a: null, b: null },
        ...(action.medium === "rj45" && action.terminated ? { plugs: { a: null, b: null } } : {}),
      };
      return { ok: true, state: { ...state, cables: [...state.cables, cable] }, created: { cableId: id } };
    }
    case "remove_cable":
      if (!state.cables.some((c) => c.id === action.cableId)) return refuse(noCable(action.cableId));
      return { ok: true, state: { ...state, cables: state.cables.filter((c) => c.id !== action.cableId) } };
    case "connect_cable_end": {
      const refused = checkConnect(state, action.cableId, action.endId, action.to);
      if (refused) return refuse(refused);
      return withCable(action.cableId, (c) => ({ ...c, ends: { ...c.ends, [action.endId]: { deviceId: action.to.deviceId, portId: action.to.portId } } }));
    }
    case "disconnect_cable_end": {
      const cable = state.cables.find((c) => c.id === action.cableId);
      if (!cable || !isEnd(action.endId)) return refuse(noCable(action.cableId, action.endId));
      return withCable(action.cableId, (c) => ({ ...c, ends: { ...c.ends, [action.endId]: null } }));
    }
    case "set_plug": {
      const cable = state.cables.find((c) => c.id === action.cableId);
      if (!cable || !isEnd(action.endId)) return refuse(noCable(action.cableId, action.endId));
      const target = networkTarget.cableEnd(action.cableId, action.endId);
      if (!cable.plugs) return refuse(rejection("not_supported", `${action.cableId}/plug`, L("This cable came with its plugs already fitted.", "هذا السلك جاي بفيشاته جاهزة."), target));
      const plug = action.plug;
      if (plug !== null) {
        const pinsOk = (pins: readonly number[]) => pins.every((pin) => Number.isInteger(pin) && pin >= 1 && pin <= 8);
        if (!plug || !Array.isArray(plug.order) || !isValidOrder(plug.order) || !pinsOk(plug.open ?? []) || !pinsOk((plug.shorted ?? []).flat())) {
          return refuse(rejection("invalid_plug", `${action.cableId}/${action.endId}`, L("A plug needs each of the eight wires exactly once.", "الفيشة تحتاج كل سلك من الثمانية مرة وحدة بالضبط."), target));
        }
      }
      const stored = plug ? { order: [...plug.order], ...(plug.open?.length ? { open: [...plug.open] } : {}), ...(plug.shorted?.length ? { shorted: plug.shorted.map(([x, y]) => [x, y] as [number, number]) } : {}) } : null;
      return withCable(action.cableId, (c) => ({ ...c, plugs: { ...c.plugs!, [action.endId]: stored } }));
    }
    case "set_interface": {
      const found = device(action.deviceId);
      if (!found) return refuse(unknownDevice(action.deviceId));
      if (!(action.interface in found.config) || !["nic", "wan", "lan"].includes(action.interface)) return refuse(unsupported(action.deviceId, action.interface));
      if (action.interface === "lan" && action.config.mode !== "static") {
        return refuse(rejection("not_supported", `${action.deviceId}/lan.mode`, L("A router's own LAN address is always set by hand.", "عنوان الراوتر على الشبكة المحلية دايم ينحط يدوي."), networkTarget.setting(action.deviceId, "lan.mode")));
      }
      const refused = checkInterface(action.deviceId, action.interface, action.config);
      if (refused) return refuse(refused);
      const { mode, address, mask, gateway, dns } = action.config;
      const clean: NetworkInterfaceConfig = { mode, ...(address ? { address } : {}), ...(mask ? { mask } : {}), ...(gateway ? { gateway } : {}), ...(dns?.length ? { dns: [...dns] } : {}) };
      return withDevice(action.deviceId, (d) => ({ ...d, config: { ...d.config, [action.interface]: clean } }));
    }
    case "set_dhcp_server": {
      const found = device(action.deviceId);
      if (!found) return refuse(unknownDevice(action.deviceId));
      if (!found.config.dhcpServer) return refuse(unsupported(action.deviceId, "dhcpServer"));
      const { enabled, poolStart, poolEnd, mask, gateway, dns } = action.config;
      const start = parseIpv4(poolStart);
      const end = parseIpv4(poolEnd);
      const invalid = (field: string) =>
        rejection("invalid_address", `${action.deviceId}/dhcp.${field}`, L("The DHCP settings contain something that is not a valid address.", "إعدادات DHCP فيها شي مو عنوان صحيح."), networkTarget.setting(action.deviceId, `dhcp.${field}`));
      if (start === null || end === null || end < start) return refuse(invalid("pool"));
      if (maskPrefix(mask) === null) return refuse(invalid("mask"));
      if (parseIpv4(gateway) === null) return refuse(invalid("gateway"));
      if (!Array.isArray(dns) || dns.some((server) => parseIpv4(server) === null)) return refuse(invalid("dns"));
      return withDevice(action.deviceId, (d) => ({ ...d, config: { ...d.config, dhcpServer: { enabled: Boolean(enabled), poolStart, poolEnd, mask, gateway, dns: [...dns] } } }));
    }
    case "set_nat": {
      const found = device(action.deviceId);
      if (!found) return refuse(unknownDevice(action.deviceId));
      if (found.config.nat === undefined) return refuse(unsupported(action.deviceId, "nat"));
      return withDevice(action.deviceId, (d) => ({ ...d, config: { ...d.config, nat: Boolean(action.enabled) } }));
    }
    case "set_wifi": {
      const found = device(action.deviceId);
      if (!found) return refuse(unknownDevice(action.deviceId));
      if (!found.config.wifi) return refuse(unsupported(action.deviceId, "wifi"));
      const { enabled, ssid, passphrase } = action.config;
      return withDevice(action.deviceId, (d) => ({ ...d, config: { ...d.config, wifi: { enabled: Boolean(enabled), ssid: String(ssid), passphrase: String(passphrase) } } }));
    }
    case "set_wifi_client": {
      const found = device(action.deviceId);
      if (!found) return refuse(unknownDevice(action.deviceId));
      if (!found.config.wifiClient) return refuse(unsupported(action.deviceId, "wifiClient"));
      return withDevice(action.deviceId, (d) => ({ ...d, config: { ...d.config, wifiClient: { ssid: String(action.ssid), passphrase: String(action.passphrase) } } }));
    }
    default:
      return refuse(rejection("not_supported", "action", L("That action does not exist.", "هذا الإجراء مو موجود."), networkTarget.device("none")));
  }
}

// ---------- History ----------

export function createHistory(state: NetworkState = createNetwork()): NetworkHistory {
  return { past: [], present: state, future: [], log: [] };
}

/** Applies an action. An accepted action becomes one undo step; a rejected one changes nothing. */
export function dispatch(history: NetworkHistory, action: NetworkAction): { history: NetworkHistory; result: NetworkActionResult } {
  const result = applyAction(history.present, action);
  if (!result.ok) return { history, result };
  return { history: { past: [...history.past, history.present], present: result.state, future: [], log: [...history.log.slice(0, history.past.length), action] }, result };
}

export const canUndo = (history: NetworkHistory): boolean => history.past.length > 0;
export const canRedo = (history: NetworkHistory): boolean => history.future.length > 0;

export function undo(history: NetworkHistory): NetworkHistory {
  if (!canUndo(history)) return history;
  return { ...history, past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}

export function redo(history: NetworkHistory): NetworkHistory {
  if (!canRedo(history)) return history;
  return { ...history, past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

/** The actions that produced the present state (undone ones excluded). */
export const timelineLog = (history: NetworkHistory): NetworkAction[] => history.log.slice(0, history.past.length);

export function toProjectData(history: NetworkHistory): NetworkProjectData {
  return { state: history.present, log: timelineLog(history) };
}

/** Rebuilds a state from a log. Stops at the first action that is not accepted and reports it. */
export function replay(log: readonly NetworkAction[], from: NetworkState = createNetwork()): { state: NetworkState; applied: number; rejection?: NetworkDiagnostic } {
  let state = from;
  for (let index = 0; index < log.length; index += 1) {
    const result = applyAction(state, log[index]);
    if (!result.ok) return { state, applied: index, rejection: result.rejection };
    state = result.state;
  }
  return { state, applied: log.length };
}
