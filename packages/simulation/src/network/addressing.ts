// Which address every interface ends up with: static configuration, or a DHCP lease handed out
// by a server on the same link segment. Derived from the state each time, in device order, so
// the same topology always gets the same leases.
import type { NetworkDevice, NetworkDiagnosticCode, NetworkResolvedInterface, NetworkState } from "@ytl/contracts";
import { formatIpv4, maskPrefix, parseIpv4 } from "./ip";
import { nodeKey, type Graph, type Group, type NodeKey } from "./links";

export type InterfaceName = NetworkResolvedInterface["interface"];

export interface Resolved extends NetworkResolvedInterface {
  node: NodeKey;
  /** Numeric address and prefix length when there is a usable address. */
  ip?: number;
  prefix?: number;
  gatewayIp?: number;
  /** Why there is no address, when there is none. */
  problem?: Extract<NetworkDiagnosticCode, "no_address" | "link_disconnected" | "dhcp_disabled" | "dhcp_no_server" | "dhcp_pool_exhausted">;
  /** For `dhcp_disabled`: the device whose DHCP server is switched off. */
  problemDeviceId?: string;
}

const GROUP: Record<InterfaceName, Group> = { nic: "nic", wan: "wan", lan: "lan", isp: "isp" };

export interface Addressing {
  all: Resolved[];
  of(deviceId: string, name: InterfaceName): Resolved | undefined;
  /** Interfaces whose place is in this segment. */
  onSegment(segment: Set<NodeKey>): Resolved[];
}

export function resolveAddressing(state: NetworkState, graph: Graph): Addressing {
  const all: Resolved[] = [];
  const find = (deviceId: string, name: InterfaceName) => all.find((r) => r.deviceId === deviceId && r.interface === name);
  const put = (resolved: Resolved) => {
    const index = all.findIndex((r) => r.deviceId === resolved.deviceId && r.interface === resolved.interface);
    if (index >= 0) all[index] = resolved;
    else all.push(resolved);
  };
  const base = (device: NetworkDevice, name: InterfaceName): Resolved => ({ deviceId: device.id, interface: name, source: "none", node: nodeKey(device.id, GROUP[name]) });
  const usable = (device: NetworkDevice, name: InterfaceName, source: "static" | "dhcp", address?: string, mask?: string, gateway?: string, dns?: string[], leasedBy?: string): Resolved => {
    const ip = parseIpv4(address);
    const prefix = maskPrefix(mask);
    if (ip === null || prefix === null) return { ...base(device, name), problem: "no_address" };
    const gatewayIp = parseIpv4(gateway);
    const servers = (dns ?? []).filter((server) => parseIpv4(server) !== null);
    return {
      ...base(device, name),
      source,
      address: formatIpv4(ip),
      mask: mask!,
      ip,
      prefix,
      ...(gatewayIp !== null ? { gateway: formatIpv4(gatewayIp), gatewayIp } : {}),
      ...(servers.length ? { dns: servers } : {}),
      ...(leasedBy ? { leasedBy } : {}),
    };
  };

  // 1. Everything configured by hand.
  for (const device of state.devices) {
    if (!device.powered) {
      for (const name of ["isp", "nic", "wan", "lan"] as const) if (device.config[name]) put({ ...base(device, name), problem: "no_address" });
      continue;
    }
    if (device.config.isp) put(usable(device, "isp", "static", device.config.isp.address, device.config.isp.mask));
    for (const name of ["lan", "wan", "nic"] as const) {
      const config = device.config[name];
      if (!config) continue;
      if (config.mode === "static") put(usable(device, name, "static", config.address, config.mask, config.gateway, config.dns));
      else put({ ...base(device, name), problem: "no_address" });
    }
  }

  // 2. DHCP. Each server hands out its pool in order; the first server on the segment (device order) answers.
  const leased = new Map<string, Set<number>>();
  const lease = (device: NetworkDevice, name: "wan" | "nic"): Resolved => {
    const config = device.config[name]!;
    const here = base(device, name);
    const segment = graph.segment(here.node);
    if (segment.size === 1) return { ...here, problem: "link_disconnected" };
    let disabledAt: string | undefined;
    // A DHCP server on the local network answers before the provider's (it is closer); see README.
    const servers = [...state.devices.filter((d) => !d.config.isp), ...state.devices.filter((d) => d.config.isp)];
    for (const server of servers) {
      if (!server.powered || server.id === device.id) continue;
      let pool: { start: string; end: string; mask: string; gateway: string; dns: string[]; own: Resolved | undefined } | null = null;
      if (server.config.isp && segment.has(nodeKey(server.id, "isp"))) {
        const isp = server.config.isp;
        pool = { start: isp.poolStart, end: isp.poolEnd, mask: isp.mask, gateway: isp.address, dns: [isp.dnsAddress], own: find(server.id, "isp") };
      } else if (server.config.dhcpServer && segment.has(nodeKey(server.id, "lan"))) {
        const dhcp = server.config.dhcpServer;
        if (!dhcp.enabled) {
          disabledAt ??= server.id;
          continue;
        }
        // No DNS list of its own: pass on what this router learned on its WAN side.
        const dns = dhcp.dns.length ? dhcp.dns : (find(server.id, "wan")?.dns ?? []);
        pool = { start: dhcp.poolStart, end: dhcp.poolEnd, mask: dhcp.mask, gateway: dhcp.gateway, dns, own: find(server.id, "lan") };
      }
      if (!pool) continue;
      const start = parseIpv4(pool.start);
      const end = parseIpv4(pool.end);
      if (start === null || end === null) continue;
      const taken = leased.get(server.id) ?? new Set<number>();
      leased.set(server.id, taken);
      // Addresses typed by hand on this segment are skipped, as a server that checks before offering would.
      const fixed = new Set(all.filter((r) => r.source === "static" && r.ip !== undefined && segment.has(r.node)).map((r) => r.ip!));
      for (let candidate = start; candidate <= end; candidate += 1) {
        if (taken.has(candidate) || fixed.has(candidate) || candidate === pool.own?.ip) continue;
        taken.add(candidate);
        return usable(device, name, "dhcp", formatIpv4(candidate), pool.mask, pool.gateway, config.dns?.length ? config.dns : pool.dns, server.id);
      }
      return { ...here, problem: "dhcp_pool_exhausted", problemDeviceId: server.id };
    }
    return disabledAt ? { ...here, problem: "dhcp_disabled", problemDeviceId: disabledAt } : { ...here, problem: "dhcp_no_server" };
  };
  // WAN sides first (twice, so a router behind another router sees the outer one's DNS), then clients.
  for (let pass = 0; pass < 2; pass += 1) {
    leased.clear();
    for (const device of state.devices) {
      if (device.powered && device.config.wan?.mode === "dhcp") put(lease(device, "wan"));
    }
  }
  for (const device of state.devices) {
    if (device.powered && device.config.nic?.mode === "dhcp") put(lease(device, "nic"));
  }

  return {
    all,
    of: find,
    onSegment: (segment) => all.filter((r) => segment.has(r.node)),
  };
}

/** The public shape, without the engine's working fields. */
export function publicInterfaces(addressing: Addressing): NetworkResolvedInterface[] {
  return addressing.all.map(({ deviceId, interface: name, source, address, mask, gateway, dns, leasedBy }) => ({
    deviceId,
    interface: name,
    source,
    ...(address ? { address } : {}),
    ...(mask ? { mask } : {}),
    ...(gateway ? { gateway } : {}),
    ...(dns ? { dns } : {}),
    ...(leasedBy ? { leasedBy } : {}),
  }));
}
