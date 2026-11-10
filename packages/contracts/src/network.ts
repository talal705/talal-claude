// Network lab contracts v1 (frozen by the lead 2026-10-10). Until the engine's acceptance tests pass, `interaction`
// may add fields and union members with notice to consumers; any other change goes through the lead.
// Consumers: packages/simulation/src/network (engine), apps/web network lab (frontend),
// apps/web/lib/interaction (cabling machines, playback, tutor topics). Everything here is
// JSON-serializable data or a type. Everything it describes stays inside the simulator: no real
// socket, address or name is ever contacted. Rendering never owns connectivity or success rules.
import type { Localized } from "./common";
import type { TutorTargetRef } from "./platform";

export const NETWORK_CONTRACTS_VERSION = 1;
/** `ProjectRecord.dataVersion` for a network project whose `data` is a `NetworkProjectData`. */
export const NETWORK_PROJECT_DATA_VERSION = 1;

// =====================================================================================
// Devices, roles and ports
// =====================================================================================

/**
 * What the box is. `fiber_gateway` is one device that combines optical termination, routing,
 * switching and Wi-Fi; it is its own kind, not an ONT plus a router. `isp` is the provider's
 * side: it ends the fibre, hands out the public address and hosts the virtual internet and DNS.
 */
export type NetworkDeviceKind =
  | "isp"
  | "ont"
  | "router"
  | "switch"
  | "access_point"
  | "fiber_gateway"
  | "wired_client"
  | "wifi_client";

/** What a device does. Kept separate from `kind` because one box can combine several. */
export type NetworkRole =
  | "internet_service"
  /** Converts the provider's fibre to Ethernet. */
  | "optical_termination"
  | "routing"
  | "nat"
  | "dhcp_server"
  | "switching"
  | "wifi_access"
  | "client";

/**
 * `standard`: a current generic device; every RJ45 port has Auto-MDIX.
 * `no_auto_mdix`: the same device with ports that do not adapt, for the straight-through versus
 * crossover lesson. (Added after the v1 freeze, additive.)
 */
export type NetworkDeviceVariant = "standard" | "no_auto_mdix";

export type NetworkMedium = "fiber" | "rj45";

/**
 * `pon`: the fibre port toward the provider. `fiber_drop`: the provider's end of that fibre.
 * `wan`: the RJ45 port that faces the provider side. `lan`: a port of the local network.
 * `uplink`: the single RJ45 port of an ONT or an access point. `nic`: a client's network port.
 */
export type NetworkPortRole = "pon" | "fiber_drop" | "wan" | "lan" | "uplink" | "nic";

export interface NetworkPortSpec {
  id: string;
  /** As printed on the device ("WAN", "LAN 2", "PON"). Shown left to right in both languages. */
  label: string;
  medium: NetworkMedium;
  role: NetworkPortRole;
  /** RJ45 only: which pin pairs transmit. Two `mdi` ports (or two `mdix`) need a crossover cable unless one has Auto-MDIX. */
  pinout?: "mdi" | "mdix";
  /** RJ45 only: the port adapts to either cable type. A modelled capability of this port, not of Ethernet in general. */
  autoMdix?: boolean;
}

export type NetworkDeviceId = string;
export type NetworkCableId = string;

export interface NetworkPortRef {
  deviceId: NetworkDeviceId;
  portId: string;
}

// =====================================================================================
// Configuration
// =====================================================================================

/** Dotted decimal, e.g. `192.168.1.10`. Stored as typed by the learner; the engine validates it. */
export type Ipv4Text = string;

/**
 * One IPv4 interface. `static` uses the fields as typed. `dhcp` asks a DHCP server on the same
 * link segment. `none` leaves the interface without an address.
 */
export interface NetworkInterfaceConfig {
  mode: "static" | "dhcp" | "none";
  address?: Ipv4Text;
  mask?: Ipv4Text;
  gateway?: Ipv4Text;
  dns?: Ipv4Text[];
}

export interface NetworkDhcpServerConfig {
  enabled: boolean;
  poolStart: Ipv4Text;
  poolEnd: Ipv4Text;
  /** Handed to clients. Mask and gateway normally equal the LAN interface's own. */
  mask: Ipv4Text;
  gateway: Ipv4Text;
  dns: Ipv4Text[];
}

export interface NetworkWifiConfig {
  enabled: boolean;
  ssid: string;
  passphrase: string;
}

/** A name the virtual DNS server knows. `address` is a host inside the virtual internet. */
export interface NetworkDnsRecord {
  name: string;
  address: Ipv4Text;
}

/**
 * Which fields exist depends on the device's roles:
 * - client: `nic`.
 * - routing: `wan` and `lan` (the LAN interface is always static), `nat`, `dhcpServer`.
 * - wifi_access: `wifi`. A Wi-Fi client has `wifiClient` and joins the access point whose SSID and passphrase match.
 * - internet_service: `isp`.
 */
export interface NetworkDeviceConfig {
  nic?: NetworkInterfaceConfig;
  wan?: NetworkInterfaceConfig;
  lan?: NetworkInterfaceConfig;
  nat?: boolean;
  dhcpServer?: NetworkDhcpServerConfig;
  wifi?: NetworkWifiConfig;
  wifiClient?: { ssid: string; passphrase: string };
  isp?: {
    /** The provider's own address on the subscriber network; it is the subscriber's WAN gateway. */
    address: Ipv4Text;
    mask: Ipv4Text;
    /** Addresses the provider hands to subscriber WAN interfaces by DHCP. */
    poolStart: Ipv4Text;
    poolEnd: Ipv4Text;
    /** The virtual DNS server. It lives in the virtual internet behind the provider. */
    dnsAddress: Ipv4Text;
    dnsRecords: NetworkDnsRecord[];
    /** Hosts of the virtual internet that answer a ping, besides the DNS server. */
    hosts: Ipv4Text[];
  };
}

// =====================================================================================
// Cables and Ethernet plugs
// =====================================================================================

export const WIRE_COLORS = [
  "white-orange",
  "orange",
  "white-green",
  "blue",
  "white-blue",
  "green",
  "white-brown",
  "brown",
] as const;
export type WireColor = (typeof WIRE_COLORS)[number];
export type WiringStandard = "T568A" | "T568B";
export const PLUG_POSITIONS = 8;

export type NetworkCableCategory = "cat5e" | "cat6" | "cat6a";

/**
 * One crimped RJ45 plug. `order` is the wire in each position, pin 1 first; pin 1 is on the left
 * with the clip facing away and the contacts up. `open` and `shorted` are crimp faults: pins whose
 * contact does not reach the wire, and pairs of pins bridged together. A lesson sets them for a
 * fault exercise; a plug the learner arranges has none.
 */
export interface PlugTermination {
  order: WireColor[];
  open?: number[];
  shorted?: [number, number][];
}

export type NetworkCableEndId = "a" | "b";

export interface NetworkCable {
  id: NetworkCableId;
  medium: NetworkMedium;
  /** RJ45 only. Never changes whether the link works in this model; no category is presented as faster for the exercise. */
  category?: NetworkCableCategory;
  /** Where each end is plugged in, or null when loose. */
  ends: Record<NetworkCableEndId, NetworkPortRef | null>;
  /**
   * RJ45 only. Present for a cable the learner terminates; absent for a factory-made patch cable,
   * which is straight-through and passes its wiremap.
   */
  plugs?: Record<NetworkCableEndId, PlugTermination | null>;
}

/** The single-plug exercise: what the learner made, sent to the engine when they crimp. */
export interface PlugAttempt {
  /** The standard the learner says they are wiring to. */
  standard: WiringStandard;
  order: readonly WireColor[];
}

export interface PlugPinResult {
  /** 1 to 8. */
  position: number;
  wire: WireColor;
  ok: boolean;
  /** What is wrong at this pin, as a sentence. Present when `ok` is false. */
  detail?: Localized;
}

/** The engine's verdict on one plug against the standard the learner chose. */
export interface PlugWiremap {
  passed: boolean;
  /** Eight entries, pin 1 first. */
  pins: readonly PlugPinResult[];
  /** One sentence stating the result. */
  summary: Localized;
}

/**
 * `ok`: this pin at end A reaches the pin it should at end B.
 * `open`: it reaches nothing. `short`: it is bridged to another pin.
 * `swapped`: it reaches a pin, but not the right one. `split_pair`: the pins connect one-to-one,
 * but the two wires carrying one signal are not a twisted pair.
 */
export type WiremapPinStatus = "ok" | "open" | "short" | "swapped" | "split_pair";

export interface CableWiremapPin {
  /** Pin number at end A, 1 to 8. */
  pin: number;
  /** The pin at end B this conductor arrives at, or null when it arrives nowhere. */
  farPin: number | null;
  status: WiremapPinStatus;
  /** Present unless `status` is `ok`. */
  detail?: Localized;
}

/**
 * A whole cable tested end to end. `straight_through`: both plugs use the same standard.
 * `crossover`: one plug is T568A and the other T568B. Both are valid cables; which one a link
 * needs depends on the two ports (see `NetworkPortSpec.pinout` and `autoMdix`).
 */
export interface CableWiremap {
  passed: boolean;
  /** Null when the cable is neither (it has a fault). */
  wiring: "straight_through" | "crossover" | null;
  /** The standard each plug matches, or null when it matches neither. */
  ends: Record<NetworkCableEndId, WiringStandard | null>;
  /** Eight entries, pin 1 of end A first. */
  pins: readonly CableWiremapPin[];
  summary: Localized;
}

// =====================================================================================
// Topology state
// =====================================================================================

export interface NetworkDevice {
  id: NetworkDeviceId;
  kind: NetworkDeviceKind;
  /** Generic educational devices only for now, e.g. "Generic home router". */
  name: Localized;
  roles: NetworkRole[];
  ports: NetworkPortSpec[];
  powered: boolean;
  config: NetworkDeviceConfig;
  /** Position on the canvas. Presentation only; the engine never reads it. */
  position?: { x: number; y: number };
}

export interface NetworkState {
  /** In creation order; the engine's deterministic order for leases and broadcasts. */
  devices: NetworkDevice[];
  cables: NetworkCable[];
}

export interface NetworkProjectData {
  state: NetworkState;
  /** Accepted actions since the topology was created; replaying them on an empty state reproduces `state`. */
  log: NetworkAction[];
}

// =====================================================================================
// Actions (pure reducers: (state, action) -> result) and history
// =====================================================================================

/** The cabling machine in apps/web/lib/interaction emits exactly this to plug a cable end in. */
export type CablingAction = { type: "connect_cable_end"; cableId: NetworkCableId; endId: string; to: NetworkPortRef };

export type NetworkAction =
  /** Adds a generic device of this kind with its default ports and configuration. `variant` defaults to `standard`. */
  | { type: "add_device"; kind: NetworkDeviceKind; variant?: NetworkDeviceVariant }
  /** Removes the device and unplugs its cables (the cables stay, loose). */
  | { type: "remove_device"; deviceId: NetworkDeviceId }
  | { type: "set_power"; deviceId: NetworkDeviceId; powered: boolean }
  | { type: "move_device"; deviceId: NetworkDeviceId; position: { x: number; y: number } }
  /** `terminated: true` adds an RJ45 cable whose plugs the learner makes; otherwise a factory patch cable. */
  | { type: "add_cable"; medium: NetworkMedium; category?: NetworkCableCategory; terminated?: boolean }
  | { type: "remove_cable"; cableId: NetworkCableId }
  | CablingAction
  | { type: "disconnect_cable_end"; cableId: NetworkCableId; endId: string }
  | { type: "set_plug"; cableId: NetworkCableId; endId: string; plug: PlugTermination | null }
  | { type: "set_interface"; deviceId: NetworkDeviceId; interface: "nic" | "wan" | "lan"; config: NetworkInterfaceConfig }
  | { type: "set_dhcp_server"; deviceId: NetworkDeviceId; config: NetworkDhcpServerConfig }
  | { type: "set_nat"; deviceId: NetworkDeviceId; enabled: boolean }
  | { type: "set_wifi"; deviceId: NetworkDeviceId; config: NetworkWifiConfig }
  | { type: "set_wifi_client"; deviceId: NetworkDeviceId; ssid: string; passphrase: string };

export type NetworkActionType = NetworkAction["type"];

export type NetworkActionResult =
  | { ok: true; state: NetworkState; created?: { deviceId?: NetworkDeviceId; cableId?: NetworkCableId } }
  | { ok: false; state: NetworkState; rejection: NetworkDiagnostic };

/** Undo/redo container. `past` and `future` hold whole immutable states. */
export interface NetworkHistory {
  past: NetworkState[];
  present: NetworkState;
  future: NetworkState[];
  log: NetworkAction[];
}

/** One port offered for a cable end by the engine's query. Rejected ports stay listed with the reason. */
export interface CablePortOption {
  to: NetworkPortRef;
  /** The destination alone: device name and port label. */
  label: Localized;
  ok: boolean;
  /** Why not, as a sentence. Present when `ok` is false. */
  reason?: Localized;
}

// =====================================================================================
// Diagnostics
// =====================================================================================

export type NetworkDiagnosticCode =
  // Rejected actions
  | "unknown_reference"
  | "port_occupied"
  | "cable_end_occupied"
  | "medium_mismatch"
  | "invalid_address"
  | "invalid_plug"
  | "not_supported"
  // Physical layer
  | "device_off"
  | "link_disconnected"
  | "cable_fault"
  | "crossover_needed"
  | "wan_lan_swapped"
  | "wifi_not_joined"
  // Addressing
  | "no_address"
  | "dhcp_disabled"
  | "dhcp_no_server"
  | "dhcp_pool_exhausted"
  | "duplicate_address"
  | "subnet_mismatch"
  // Routing
  | "gateway_missing"
  | "gateway_wrong"
  | "gateway_unreachable"
  | "no_route"
  | "nat_disabled"
  | "host_unreachable"
  | "hop_limit"
  // Names
  | "dns_not_configured"
  | "dns_unreachable"
  | "dns_name_unknown";

/** A fact the diagnostic rests on. `observed` and `expected` are language-neutral values (`192.168.2.10/24`, `LAN 1`), never sentences. */
export interface NetworkEvidence {
  label: Localized;
  observed: string;
  expected?: string;
}

/** Same shape and meaning as `PCDiagnostic`, so the tutor treats both labs alike. */
export interface NetworkDiagnostic {
  /** Stable for the same fault on the same subject: `<code>:<subject>`. */
  id: string;
  code: NetworkDiagnosticCode;
  /** `blocking` stops the tested traffic or rejects an action; `warning` and `info` never do. */
  severity: "blocking" | "warning" | "info";
  /** Hint level 1: the symptom only, without naming the cause or the place. */
  observation?: Localized;
  /** Hint level 2: what is wrong and where. */
  message: Localized;
  /** Hint level 3: the rule behind it. */
  explanation: Localized;
  evidence: NetworkEvidence[];
  /** Where to point. Built with `networkTarget`; stamped with the `NetworkEvaluationContext`. */
  target: TutorTargetRef;
  relatedTargets: TutorTargetRef[];
}

/** Stamped on every diagnostic and journey target so stale guidance can be detected. */
export interface NetworkEvaluationContext {
  projectRevision?: number;
  /** Set for a connectivity test; identifies that run. */
  executionId?: string;
}

// ---------- Target IDs ----------

const networkRef = (kind: TutorTargetRef["kind"], name: string): TutorTargetRef => ({ id: `network:${kind}:${name}`, kind });

/** The only place network target IDs are built, so the view and the engine cannot drift apart. */
export const networkTarget = {
  /** `network:component:router-1` */
  device: (deviceId: NetworkDeviceId): TutorTargetRef => networkRef("component", deviceId),
  /** `network:port:router-1/wan` */
  port: (ref: NetworkPortRef): TutorTargetRef => networkRef("port", `${ref.deviceId}/${ref.portId}`),
  /** `network:connector:cable-2` — the cable as a whole (a link on the canvas). */
  cable: (cableId: NetworkCableId): TutorTargetRef => networkRef("connector", cableId),
  /** `network:cable-end:cable-2/a` */
  cableEnd: (cableId: NetworkCableId, endId: string): TutorTargetRef => networkRef("cable-end", `${cableId}/${endId}`),
  /** `network:connector:wifi/phone-1` — the wireless association of a Wi-Fi client. */
  wifiLink: (clientId: NetworkDeviceId): TutorTargetRef => networkRef("connector", `wifi/${clientId}`),
  /** `network:setting:pc-1/nic.gateway` */
  setting: (deviceId: NetworkDeviceId, name: string): TutorTargetRef => networkRef("setting", `${deviceId}/${name}`),
} as const;

// =====================================================================================
// Addressing as the engine resolved it
// =====================================================================================

/** The address an interface ended up with, after static configuration or DHCP. */
export interface NetworkResolvedInterface {
  deviceId: NetworkDeviceId;
  interface: "nic" | "wan" | "lan" | "isp";
  /** `none`: no usable address (DHCP got no answer, or nothing configured). */
  source: "static" | "dhcp" | "none";
  address?: Ipv4Text;
  mask?: Ipv4Text;
  gateway?: Ipv4Text;
  dns?: Ipv4Text[];
  /** For a DHCP lease: the device that handed it out. */
  leasedBy?: NetworkDeviceId;
}

// =====================================================================================
// Connectivity tests and the packet journey
// =====================================================================================

export type ConnectivityRequest =
  /** A virtual ping. `to` is an IPv4 address or a name; a name is looked up first. */
  | { kind: "ping"; fromDeviceId: NetworkDeviceId; to: string }
  /** A virtual name lookup only. */
  | { kind: "lookup"; fromDeviceId: NetworkDeviceId; name: string };

export interface ConnectivityResult {
  request: ConnectivityRequest;
  /** True when the reply came back to the sender (ping), or the name was answered (lookup). */
  succeeded: boolean;
  /** The address the name resolved to, when a lookup happened and succeeded. */
  resolvedAddress?: Ipv4Text;
  /** The actual simulated path, ending exactly where the packet stopped. */
  journey: Journey;
  /** Why it failed, most specific first. Empty on success. */
  diagnostics: NetworkDiagnostic[];
  /** The addresses in force during this test. */
  interfaces: NetworkResolvedInterface[];
}

// ---------- Packet journey (frozen 2026-10-10) ----------
// Produced by the network engine, played back by apps/web/lib/interaction/playback.ts.
// The view shows exactly this list: it ends at the event where the packet stopped.

export interface JourneyEvent {
  /** Unique within the journey and stable for the same run. */
  id: string;
  /** Where it happened. Link ends are given in travel direction. */
  at:
    | { kind: "node"; nodeId: string }
    | { kind: "link"; linkId: string; fromNodeId: string; toNodeId: string };
  /** `info` is worth showing but is neither success nor failure (an ARP lookup, a table entry learned). */
  result: "ok" | "failed" | "info";
  /** What happened, as a sentence that stands alone; it is read out. */
  message: Localized;
  /** Why. Expected when `result` is `failed`. */
  reason?: Localized;
  /** What to highlight, stamped with projectRevision and executionId. */
  target: TutorTargetRef;
}

export interface Journey {
  id: string;
  /** In order. May be empty when nothing was sent. */
  events: readonly JourneyEvent[];
  /** `incomplete` means it stopped without a verdict, e.g. a hop limit. */
  outcome: "delivered" | "failed" | "incomplete";
  /** One sentence stating the outcome. */
  summary: Localized;
}
