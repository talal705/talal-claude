// The physical layer as a graph: which cables and Wi-Fi associations carry frames, and which
// parts of which devices they join. Deterministic: order follows `state.cables`, then
// `state.devices`.
import type { CableWiremap, NetworkCable, NetworkDevice, NetworkPortSpec, NetworkState } from "@ytl/contracts";
import { checkCable } from "./wiremap";

/**
 * A device is one or more places a frame can be. All ports of one group pass frames among
 * themselves. `bridge`: a switch, an ONT, an access point. `lan`: the LAN side of a routing
 * device (its switch ports and its Wi-Fi), where its LAN interface listens. `wan`, `nic`, `isp`:
 * a single interface.
 */
export type Group = "bridge" | "lan" | "wan" | "nic" | "isp";
export type NodeKey = string;

export const nodeKey = (deviceId: string, group: Group): NodeKey => `${deviceId}|${group}`;
export const deviceOfNode = (key: NodeKey): string => key.slice(0, key.lastIndexOf("|"));

const routes = (device: NetworkDevice) => device.roles.includes("routing");

export function groupOfPort(device: NetworkDevice, port: NetworkPortSpec): Group {
  if (device.kind === "isp") return "isp";
  if (routes(device)) return port.role === "wan" || port.role === "pon" ? "wan" : "lan";
  if (device.roles.includes("client")) return "nic";
  return "bridge";
}

/** Where a Wi-Fi client lands on the device that gives it Wi-Fi. */
export const wifiGroup = (device: NetworkDevice): Group => (routes(device) ? "lan" : "bridge");

export type LinkProblem =
  /** `looseEnd`: which end is not plugged in (`both` when neither is). */
  | { code: "link_disconnected"; looseEnd: "a" | "b" | "both" }
  | { code: "device_off"; deviceId: string }
  | { code: "cable_fault"; wiremap: CableWiremap }
  /** The two ports have the same pinout and neither adapts: `needs` says which cable this pair of ports takes. */
  | { code: "crossover_needed"; needs: "crossover" | "straight_through"; has: "crossover" | "straight_through" }
  | { code: "wifi_not_joined"; why: "no_network_chosen" | "network_not_found" | "wrong_passphrase" };

export interface LinkEnd {
  deviceId: string;
  /** Absent for the wireless side. */
  portId?: string;
  node: NodeKey;
}

export interface Link {
  /** The cable ID, or `wifi/<clientId>`. */
  id: string;
  kind: "cable" | "wifi";
  a: LinkEnd | null;
  b: LinkEnd | null;
  up: boolean;
  problem?: LinkProblem;
}

function endOf(state: NetworkState, cable: NetworkCable, endId: "a" | "b"): { end: LinkEnd; device: NetworkDevice; port: NetworkPortSpec } | null {
  const at = cable.ends[endId];
  if (!at) return null;
  const device = state.devices.find((d) => d.id === at.deviceId);
  const port = device?.ports.find((p) => p.id === at.portId);
  if (!device || !port) return null;
  return { end: { deviceId: device.id, portId: port.id, node: nodeKey(device.id, groupOfPort(device, port)) }, device, port };
}

export function resolveLinks(state: NetworkState): Link[] {
  const links: Link[] = [];
  for (const cable of state.cables) {
    const a = endOf(state, cable, "a");
    const b = endOf(state, cable, "b");
    const link: Link = { id: cable.id, kind: "cable", a: a?.end ?? null, b: b?.end ?? null, up: false };
    if (!a || !b) {
      link.problem = { code: "link_disconnected", looseEnd: !a && !b ? "both" : !a ? "a" : "b" };
    } else if (!a.device.powered || !b.device.powered) {
      link.problem = { code: "device_off", deviceId: !a.device.powered ? a.device.id : b.device.id };
    } else if (cable.medium === "rj45") {
      const wiremap = checkCable(cable);
      if (!wiremap.passed) {
        link.problem = { code: "cable_fault", wiremap };
      } else {
        const has = wiremap.wiring === "crossover" ? "crossover" : "straight_through";
        const needs = a.port.pinout === b.port.pinout ? "crossover" : "straight_through";
        if (has !== needs && !a.port.autoMdix && !b.port.autoMdix) link.problem = { code: "crossover_needed", needs, has };
        else link.up = true;
      }
    } else {
      link.up = true;
    }
    links.push(link);
  }
  for (const client of state.devices) {
    if (client.kind !== "wifi_client") continue;
    const id = `wifi/${client.id}`;
    const here: LinkEnd = { deviceId: client.id, node: nodeKey(client.id, "nic") };
    const wanted = client.config.wifiClient;
    if (!client.powered) {
      links.push({ id, kind: "wifi", a: here, b: null, up: false, problem: { code: "device_off", deviceId: client.id } });
      continue;
    }
    if (!wanted || wanted.ssid === "") {
      links.push({ id, kind: "wifi", a: here, b: null, up: false, problem: { code: "wifi_not_joined", why: "no_network_chosen" } });
      continue;
    }
    const offering = state.devices.filter((d) => d.roles.includes("wifi_access") && d.powered && d.config.wifi?.enabled && d.config.wifi.ssid === wanted.ssid);
    const match = offering.find((d) => d.config.wifi!.passphrase === wanted.passphrase);
    if (!match) {
      links.push({ id, kind: "wifi", a: here, b: null, up: false, problem: { code: "wifi_not_joined", why: offering.length ? "wrong_passphrase" : "network_not_found" } });
      continue;
    }
    links.push({ id, kind: "wifi", a: here, b: { deviceId: match.id, node: nodeKey(match.id, wifiGroup(match)) }, up: true });
  }
  return links;
}

export interface Hop {
  link: Link;
  from: LinkEnd;
  to: LinkEnd;
}

export interface Graph {
  links: Link[];
  /** Every place reachable from `start` without crossing a routing interface, `start` included. */
  segment(start: NodeKey): Set<NodeKey>;
  /** The hops from one place to another over links that are up, or null when there is no way. Shortest first; ties follow link order. */
  path(from: NodeKey, to: NodeKey): Hop[] | null;
  /** The links attached to a place, up or not. */
  linksAt(node: NodeKey): Link[];
}

export function buildGraph(state: NetworkState): Graph {
  const links = resolveLinks(state);
  const neighbours = new Map<NodeKey, Hop[]>();
  for (const link of links) {
    if (!link.up || !link.a || !link.b) continue;
    for (const [from, to] of [[link.a, link.b], [link.b, link.a]] as const) {
      const list = neighbours.get(from.node) ?? [];
      list.push({ link, from, to });
      neighbours.set(from.node, list);
    }
  }
  const walk = (start: NodeKey): Map<NodeKey, Hop | null> => {
    const cameBy = new Map<NodeKey, Hop | null>([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const node = queue.shift()!;
      for (const hop of neighbours.get(node) ?? []) {
        if (cameBy.has(hop.to.node)) continue;
        cameBy.set(hop.to.node, hop);
        queue.push(hop.to.node);
      }
    }
    return cameBy;
  };
  return {
    links,
    segment: (start) => new Set(walk(start).keys()),
    path(from, to) {
      const cameBy = walk(from);
      if (!cameBy.has(to)) return null;
      const hops: Hop[] = [];
      for (let node = to; node !== from; ) {
        const hop = cameBy.get(node)!;
        hops.unshift(hop);
        node = hop.from.node;
      }
      return hops;
    },
    linksAt: (node) => links.filter((link) => link.a?.node === node || link.b?.node === node),
  };
}
