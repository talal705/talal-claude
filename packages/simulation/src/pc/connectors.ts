// Which plug physically goes into which socket, and which sockets suit which purpose.
// Look-alike connectors are separated on purpose; nothing here depends on rendering.
import type { ConnectorType, PortFunction } from "@ytl/contracts";

/** Plug -> sockets it physically fits. */
const MATING: Record<ConnectorType, ConnectorType[]> = {
  atx_24pin: ["atx_24pin"],
  eps_8pin: ["eps_8pin"],
  eps_4pin: ["eps_4pin"],
  eps_4plus4pin: ["eps_8pin", "eps_4pin"],
  pcie_8pin: ["pcie_8pin"],
  pcie_6pin: ["pcie_6pin"],
  pcie_6plus2pin: ["pcie_8pin", "pcie_6pin"],
  pcie_12vhpwr: ["pcie_12vhpwr", "pcie_12v_2x6"],
  pcie_12v_2x6: ["pcie_12v_2x6", "pcie_12vhpwr"],
  sata_power: ["sata_power"],
  sata_data: ["sata_data"],
  molex_4pin: ["molex_4pin"],
  fan_4pin_pwm: ["fan_4pin_pwm"],
  // A 3-pin fan plug fits a 4-pin header; it then runs without PWM control.
  fan_3pin: ["fan_3pin", "fan_4pin_pwm"],
  argb_5v_3pin: ["argb_5v_3pin"],
  rgb_12v_4pin: ["rgb_12v_4pin"],
  front_panel_2pin: ["front_panel_2pin"],
  hd_audio_header: ["hd_audio_header"],
  usb2_header_9pin: ["usb2_header_9pin"],
  usb3_header_19pin: ["usb3_header_19pin"],
  usb_c_header_type_e: ["usb_c_header_type_e"],
  hdmi: ["hdmi"],
  displayport: ["displayport"],
  psu_modular: ["psu_modular"],
};

export function connectorsMate(plug: ConnectorType, socket: ConnectorType): boolean {
  return MATING[plug].includes(socket);
}

export type ConnectorGroup = "cpu_power" | "gpu_power_8" | "gpu_power_16" | "lighting" | "fan" | "other";

/** Families a learner is likely to confuse. Used to explain a mismatch and to list look-alike destinations. */
export function connectorGroup(c: ConnectorType): ConnectorGroup {
  if (c === "eps_8pin" || c === "eps_4pin" || c === "eps_4plus4pin") return "cpu_power";
  if (c === "pcie_8pin" || c === "pcie_6pin" || c === "pcie_6plus2pin") return "gpu_power_8";
  if (c === "pcie_12vhpwr" || c === "pcie_12v_2x6") return "gpu_power_16";
  if (c === "argb_5v_3pin" || c === "rgb_12v_4pin") return "lighting";
  if (c === "fan_4pin_pwm" || c === "fan_3pin") return "fan";
  return "other";
}

/** True when the two connectors are different shapes that are commonly mistaken for each other. */
export function lookAlike(a: ConnectorType, b: ConnectorType): boolean {
  const ga = connectorGroup(a);
  const gb = connectorGroup(b);
  if (ga === "other" || gb === "other") return a === b;
  if (ga === gb) return true;
  return (ga === "cpu_power" && gb === "gpu_power_8") || (ga === "gpu_power_8" && gb === "cpu_power");
}

/** Short display name used as language-neutral evidence. */
export const CONNECTOR_NAME: Record<ConnectorType, string> = {
  atx_24pin: "ATX 24-pin",
  eps_8pin: "EPS 8-pin",
  eps_4pin: "EPS 4-pin",
  eps_4plus4pin: "EPS 4+4-pin",
  pcie_8pin: "PCIe 8-pin",
  pcie_6pin: "PCIe 6-pin",
  pcie_6plus2pin: "PCIe 6+2-pin",
  pcie_12vhpwr: "12VHPWR 16-pin",
  pcie_12v_2x6: "12V-2x6 16-pin",
  sata_power: "SATA power",
  sata_data: "SATA data",
  molex_4pin: "Molex 4-pin",
  fan_4pin_pwm: "Fan 4-pin PWM",
  fan_3pin: "Fan 3-pin",
  argb_5v_3pin: "ARGB 5V 3-pin",
  rgb_12v_4pin: "RGB 12V 4-pin",
  front_panel_2pin: "Front panel 2-pin",
  hd_audio_header: "HD Audio",
  usb2_header_9pin: "USB 2.0 9-pin",
  usb3_header_19pin: "USB 3 19-pin",
  usb_c_header_type_e: "USB Type-C header",
  hdmi: "HDMI",
  displayport: "DisplayPort",
  psu_modular: "PSU modular",
};

const FAN_HEADERS: PortFunction[] = ["cpu_fan_header", "pump_header", "system_fan_header"];

/** Headers on which a motor lead actually runs. */
export function isMotorHeader(fn: PortFunction): boolean {
  return FAN_HEADERS.includes(fn);
}
export function isMotorLead(fn: PortFunction): boolean {
  return fn === "fan_motor" || fn === "pump_motor";
}
