// Generic educational devices. None of these is a commercial model; names say "Generic".
import type { NetworkDevice, NetworkDeviceConfig, NetworkDeviceKind, NetworkDeviceVariant, NetworkPortSpec, NetworkRole, NetworkWifiConfig } from "@ytl/contracts";
import { L } from "./text";

/** Short ID prefix per kind: `router-1`, `pc-2`. */
export const ID_PREFIX: Record<NetworkDeviceKind, string> = {
  isp: "isp",
  ont: "ont",
  router: "router",
  switch: "switch",
  access_point: "ap",
  fiber_gateway: "gateway",
  wired_client: "pc",
  wifi_client: "phone",
};

export const ROLES: Record<NetworkDeviceKind, NetworkRole[]> = {
  isp: ["internet_service"],
  ont: ["optical_termination"],
  router: ["routing", "nat", "dhcp_server", "switching", "wifi_access"],
  switch: ["switching"],
  access_point: ["wifi_access"],
  fiber_gateway: ["optical_termination", "routing", "nat", "dhcp_server", "switching", "wifi_access"],
  wired_client: ["client"],
  wifi_client: ["client"],
};

const NAMES: Record<NetworkDeviceKind, { en: string; ar: string }> = {
  isp: { en: "Virtual internet provider", ar: "مزوّد الإنترنت الافتراضي" },
  ont: { en: "Generic ONT", ar: "جهاز ONT عام" },
  router: { en: "Generic home router", ar: "راوتر منزلي عام" },
  switch: { en: "Generic switch", ar: "سويتش عام" },
  access_point: { en: "Generic access point", ar: "أكسس بوينت عام" },
  fiber_gateway: { en: "Generic fibre gateway", ar: "راوتر ألياف مدمج عام" },
  wired_client: { en: "Computer", ar: "كمبيوتر" },
  wifi_client: { en: "Phone", ar: "جوال" },
};

const rj45 = (id: string, label: string, role: NetworkPortSpec["role"], pinout: "mdi" | "mdix"): NetworkPortSpec => ({
  id,
  label,
  medium: "rj45",
  role,
  pinout,
  // Generic current devices adapt to either cable type. A lesson about crossover cables uses ports with this set to false.
  autoMdix: true,
});
const lanPorts = (count: number): NetworkPortSpec[] => Array.from({ length: count }, (_, i) => rj45(`lan-${i + 1}`, `LAN ${i + 1}`, "lan", "mdix"));

const PORTS: Record<NetworkDeviceKind, () => NetworkPortSpec[]> = {
  isp: () => [
    { id: "drop-1", label: "Fibre 1", medium: "fiber", role: "fiber_drop" },
    { id: "drop-2", label: "Fibre 2", medium: "fiber", role: "fiber_drop" },
  ],
  ont: () => [{ id: "pon", label: "PON", medium: "fiber", role: "pon" }, rj45("eth", "ETH", "uplink", "mdix")],
  router: () => [rj45("wan", "WAN", "wan", "mdi"), ...lanPorts(4)],
  switch: () => lanPorts(5),
  access_point: () => [rj45("uplink", "LAN", "uplink", "mdi")],
  fiber_gateway: () => [{ id: "pon", label: "PON", medium: "fiber", role: "pon" }, ...lanPorts(4)],
  wired_client: () => [rj45("eth0", "Ethernet", "nic", "mdi")],
  wifi_client: () => [],
};

const WIFI: NetworkWifiConfig = { enabled: true, ssid: "HomeLab", passphrase: "learn-1234" };

/**
 * The provider's addresses are from ranges reserved for shared address space (100.64.0.0/10) and
 * for documentation (203.0.113.0/24), and the names end in `.test`: none of them exists on the
 * real internet, and none is ever contacted.
 */
const CONFIG: Record<NetworkDeviceKind, () => NetworkDeviceConfig> = {
  isp: () => ({
    isp: {
      address: "100.64.0.1",
      mask: "255.255.255.0",
      poolStart: "100.64.0.10",
      poolEnd: "100.64.0.50",
      dnsAddress: "203.0.113.53",
      dnsRecords: [
        { name: "school.test", address: "203.0.113.10" },
        { name: "library.test", address: "203.0.113.20" },
      ],
      hosts: ["203.0.113.10", "203.0.113.20"],
    },
  }),
  ont: () => ({}),
  router: () => routerConfig(),
  switch: () => ({}),
  access_point: () => ({ wifi: { ...WIFI } }),
  fiber_gateway: () => routerConfig(),
  wired_client: () => ({ nic: { mode: "dhcp" } }),
  wifi_client: () => ({ nic: { mode: "dhcp" }, wifiClient: { ssid: "", passphrase: "" } }),
};

function routerConfig(): NetworkDeviceConfig {
  return {
    wan: { mode: "dhcp" },
    lan: { mode: "static", address: "192.168.1.1", mask: "255.255.255.0" },
    nat: true,
    // An empty `dns` list means: hand out the DNS server this router learned on its WAN side.
    dhcpServer: { enabled: true, poolStart: "192.168.1.100", poolEnd: "192.168.1.199", mask: "255.255.255.0", gateway: "192.168.1.1", dns: [] },
    wifi: { ...WIFI },
  };
}

/** `ordinal` is the 1-based count of this kind in the topology; it gives `router-1`, "Generic home router 1". */
export function createDevice(kind: NetworkDeviceKind, ordinal: number, variant: NetworkDeviceVariant = "standard"): NetworkDevice {
  const base = NAMES[kind];
  const fixed = variant === "no_auto_mdix";
  // The name says so, because the learner cannot see a port's wiring from outside.
  const en = kind === "isp" ? base.en : `${base.en} ${ordinal}${fixed ? " (no Auto-MDIX)" : ""}`;
  const ar = kind === "isp" ? base.ar : `${base.ar} ${ordinal}${fixed ? " (بدون Auto-MDIX)" : ""}`;
  const ports = PORTS[kind]().map((port) => (fixed && port.medium === "rj45" ? { ...port, autoMdix: false } : port));
  return { id: `${ID_PREFIX[kind]}-${ordinal}`, kind, name: L(en, ar), roles: [...ROLES[kind]], ports, powered: true, config: CONFIG[kind]() };
}
