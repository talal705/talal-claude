// Ready-made topologies, as action logs. Replaying one on an empty network builds it; nothing in
// them is special-cased by the engine.
import type { Localized, NetworkAction } from "@ytl/contracts";
import { L } from "./text";

const plug = (cableId: string, a: [string, string], b: [string, string]): NetworkAction[] => [
  { type: "connect_cable_end", cableId, endId: "a", to: { deviceId: a[0], portId: a[1] } },
  { type: "connect_cable_end", cableId, endId: "b", to: { deviceId: b[0], portId: b[1] } },
];

/** Virtual ISP -> fibre -> ONT -> Ethernet -> router WAN; router LAN -> PC; a phone on the router's Wi-Fi. */
export const HOME_WITH_ONT: NetworkAction[] = [
  { type: "add_device", kind: "isp" },
  { type: "add_device", kind: "ont" },
  { type: "add_device", kind: "router" },
  { type: "add_device", kind: "wired_client" },
  { type: "add_device", kind: "wifi_client" },
  { type: "add_cable", medium: "fiber" },
  { type: "add_cable", medium: "rj45" },
  { type: "add_cable", medium: "rj45" },
  ...plug("cable-1", ["isp-1", "drop-1"], ["ont-1", "pon"]),
  ...plug("cable-2", ["ont-1", "eth"], ["router-1", "wan"]),
  ...plug("cable-3", ["router-1", "lan-1"], ["pc-1", "eth0"]),
  { type: "set_wifi_client", deviceId: "phone-1", ssid: "HomeLab", passphrase: "learn-1234" },
];

/** Virtual ISP -> fibre -> integrated fibre gateway; gateway LAN -> PC; a phone on its Wi-Fi. */
export const HOME_WITH_GATEWAY: NetworkAction[] = [
  { type: "add_device", kind: "isp" },
  { type: "add_device", kind: "fiber_gateway" },
  { type: "add_device", kind: "wired_client" },
  { type: "add_device", kind: "wifi_client" },
  { type: "add_cable", medium: "fiber" },
  { type: "add_cable", medium: "rj45" },
  ...plug("cable-1", ["isp-1", "drop-1"], ["gateway-1", "pon"]),
  ...plug("cable-2", ["gateway-1", "lan-1"], ["pc-1", "eth0"]),
  { type: "set_wifi_client", deviceId: "phone-1", ssid: "HomeLab", passphrase: "learn-1234" },
];

export interface NetworkPreset {
  id: string;
  title: Localized;
  description: Localized;
  actions: readonly NetworkAction[];
}

export const networkPresets: readonly NetworkPreset[] = [
  {
    id: "home-with-ont",
    title: L("Home network with an ONT and a router", "شبكة بيت فيها ONT وراوتر"),
    description: L(
      "Provider, fibre, ONT, router, one computer on a cable and one phone on Wi-Fi. Everything is connected and working.",
      "مزوّد، ألياف، ONT، راوتر، كمبيوتر بسلك وجوال بالواي فاي. كل شي موصّل وشغّال.",
    ),
    actions: HOME_WITH_ONT,
  },
  {
    id: "home-with-gateway",
    title: L("Home network with an integrated fibre gateway", "شبكة بيت فيها راوتر ألياف مدمج"),
    description: L(
      "Provider, fibre, one gateway that is ONT and router in one box, one computer on a cable and one phone on Wi-Fi.",
      "مزوّد، ألياف، جهاز واحد يجمع ONT والراوتر، كمبيوتر بسلك وجوال بالواي فاي.",
    ),
    actions: HOME_WITH_GATEWAY,
  },
];
