// Small builders shared by the catalog data files. Data only: no simulation rules live here.
import type {
  AssetRef,
  CableEndSpec,
  CableKind,
  CableSpec,
  ConnectorType,
  InspectZone,
  Localized,
  MountPointSpec,
  PortFunction,
  PortSpec,
  SpecSource,
} from "@ytl/contracts";

export const L = (en: string, ar: string): Localized => ({ en, ar });

/** Date of the first fetch round; sources fetched later pass their own date. */
export const RETRIEVED_ON = "2026-10-10";

export const source = (publisher: string, title: string, url: string, retrievedOn: string = RETRIEVED_ON): SpecSource => ({
  url,
  title,
  publisher,
  retrievedOn,
});

/** No visual exists yet for any entry; none may be counted as a finished catalog entry until this changes. */
export const NO_ASSET: AssetRef = {
  model: null,
  thumbnail: null,
  kind: "none",
  provenance: "none",
  license: null,
  orientation: { up: "+y", front: "+z" },
  metresPerUnit: 1,
  quality: "missing",
};

/** Appended to entries whose mount points carry fastener counts. */
export const FASTENER_NOTE =
  "Fastener counts on mount points are teaching values (typical for the form factor), not taken from the manufacturer page, except where a note says otherwise.";

export const zone = (id: string, label: Localized, description: Localized): InspectZone => ({ id, label, description });

export const port = (
  id: string,
  connector: ConnectorType,
  fn: PortFunction,
  label: Localized,
  requirement: PortSpec["requirement"] = "optional",
  keying?: string,
): PortSpec => ({ id, connector, function: fn, label, requirement, ...(keying ? { keying } : {}) });

export const end = (
  id: string,
  connector: ConnectorType,
  fn: PortFunction,
  gender: CableEndSpec["gender"],
  side: CableEndSpec["side"],
  label: Localized,
  keying?: string,
): CableEndSpec => ({ id, connector, function: fn, gender, side, label, ...(keying ? { keying } : {}) });

export const cable = (
  id: string,
  kind: CableKind,
  attachment: CableSpec["attachment"],
  label: Localized,
  ends: CableEndSpec[],
  quantity = 1,
): CableSpec => ({ id, kind, label, attachment, ends, quantity });

// ---------- Recurring leads ----------

/** Captive motor lead of a fan. */
export const fanLead = (id: string, connector: "fan_4pin_pwm" | "fan_3pin", label: Localized): CableSpec =>
  cable(id, "fan_lead", "captive", label, [
    end("plug", connector, "fan_motor", "plug", "device", L("Fan plug", "راس المروحة")),
  ]);

/** Captive 5 V addressable lighting lead. */
export const argbLead = (id: string, label: Localized): CableSpec =>
  cable(id, "lighting_lead", "captive", label, [
    end("plug", "argb_5v_3pin", "argb_device", "plug", "device", L("A-RGB plug (5 V, 3-pin)", "راس A-RGB (5 فولت، 3 سنون)")),
  ]);

const fpLead = (id: string, fn: PortFunction, label: Localized): CableSpec =>
  cable(id, "front_panel_lead", "captive", label, [end("plug", "front_panel_2pin", fn, "plug", "device", label)]);

/** Front-panel leads of a case. Only the leads the manufacturer's front I/O list supports are passed as true. */
export const frontPanelLeads = (o: { reset: boolean; powerLed: boolean; driveLed: boolean; usb3: boolean; usbC: boolean; audio: boolean }): CableSpec[] => [
  fpLead("power-switch", "power_switch", L("Power switch lead", "سلك زر التشغيل")),
  ...(o.reset ? [fpLead("reset-switch", "reset_switch", L("Reset switch lead", "سلك زر الريستارت"))] : []),
  ...(o.powerLed ? [fpLead("power-led", "power_led", L("Power LED lead", "سلك لمبة التشغيل"))] : []),
  ...(o.driveLed ? [fpLead("drive-led", "drive_led", L("Drive activity LED lead", "سلك لمبة القرص"))] : []),
  ...(o.audio
    ? [
        cable("front-audio", "front_panel_lead", "captive", L("Front audio lead", "سلك الصوت الأمامي"), [
          end("plug", "hd_audio_header", "front_audio", "plug", "device", L("HD Audio plug", "راس HD Audio")),
        ]),
      ]
    : []),
  ...(o.usb3
    ? [
        cable("front-usb3", "front_panel_lead", "captive", L("Front USB 3 lead", "سلك USB 3 الأمامي"), [
          end("plug", "usb3_header_19pin", "front_usb3", "plug", "device", L("USB 3 19-pin plug", "راس USB 3 أبو 19 سنّ")),
        ]),
      ]
    : []),
  ...(o.usbC
    ? [
        cable("front-usb-c", "front_panel_lead", "captive", L("Front USB Type-C lead", "سلك USB Type-C الأمامي"), [
          end("plug", "usb_c_header_type_e", "front_usb_c", "plug", "device", L("USB Type-C header plug", "راس مدخل USB Type-C")),
        ]),
      ]
    : []),
];

// ---------- Motherboard ----------

const numbered = (n: number, make: (i: number) => PortSpec): PortSpec[] => Array.from({ length: n }, (_, i) => make(i + 1));

/** Ports every board in this catalog has, with the counts read from its specification page or manual. */
export const boardPorts = (o: {
  eps8: number;
  /** 4-pin +12V CPU power sockets after the 8-pin ones; always optional (no manual instruction was read for them). */
  eps4?: number;
  /** How many of the EPS sockets beyond the first the manual instructs to connect. */
  epsRecommended: number;
  chassisFans: number;
  argb: number;
  rgb: number;
  sata: number;
  usb2: number;
  usbC: boolean;
  hdmi: number;
  displayPort: number;
}): PortSpec[] => [
  port("atx-24", "atx_24pin", "atx_main_power", L("24-pin main power connector", "موصّل الطاقة الرئيسي 24 سنّ"), "required"),
  ...numbered(o.eps8, (i) =>
    port(
      `eps-${i}`,
      "eps_8pin",
      "cpu_power",
      L(`8-pin +12V CPU power connector ${i}`, `موصّل طاقة المعالج 8 سنون +12V رقم ${i}`),
      i === 1 ? "required" : i <= 1 + o.epsRecommended ? "recommended" : "optional",
    ),
  ),
  ...numbered(o.eps4 ?? 0, (i) =>
    port(`eps4-${i}`, "eps_4pin", "cpu_power", L(`4-pin +12V CPU power connector ${i}`, `موصّل طاقة المعالج 4 سنون +12V رقم ${i}`)),
  ),
  port("cpu-fan", "fan_4pin_pwm", "cpu_fan_header", L("CPU fan header (CPU_FAN)", "مدخل مروحة المعالج (CPU_FAN)")),
  port("cpu-opt", "fan_4pin_pwm", "cpu_fan_header", L("CPU optional fan header (CPU_OPT)", "مدخل مروحة المعالج الإضافي (CPU_OPT)")),
  port("aio-pump", "fan_4pin_pwm", "pump_header", L("AIO pump header (AIO_PUMP)", "مدخل مضخة التبريد المائي (AIO_PUMP)")),
  ...numbered(o.chassisFans, (i) =>
    port(`cha-fan-${i}`, "fan_4pin_pwm", "system_fan_header", L(`Chassis fan header ${i} (CHA_FAN${i})`, `مدخل مروحة الهيكل ${i} (CHA_FAN${i})`)),
  ),
  ...numbered(o.argb, (i) =>
    port(`argb-${i}`, "argb_5v_3pin", "argb_header", L(`Addressable Gen 2 header ${i} (5 V, 3-pin)`, `مدخل الإضاءة القابلة للعنونة ${i} (5 فولت، 3 سنون)`)),
  ),
  ...numbered(o.rgb, (i) =>
    port(`rgb-${i}`, "rgb_12v_4pin", "rgb_header", L(`Aura RGB header ${i} (12 V, 4-pin)`, `مدخل Aura RGB رقم ${i} (12 فولت، 4 سنون)`)),
  ),
  port("panel-pwrsw", "front_panel_2pin", "power_switch", L("System panel: power button pins (PWRSW)", "لوحة النظام: سنون زر التشغيل (PWRSW)"), "required"),
  port("panel-reset", "front_panel_2pin", "reset_switch", L("System panel: reset button pins (RESET)", "لوحة النظام: سنون زر الريستارت (RESET)")),
  port("panel-pled", "front_panel_2pin", "power_led", L("System panel: power LED pins (PLED)", "لوحة النظام: سنون لمبة التشغيل (PLED)")),
  port("panel-hddled", "front_panel_2pin", "drive_led", L("System panel: drive LED pins (HDD_LED)", "لوحة النظام: سنون لمبة القرص (HDD_LED)")),
  port("hd-audio", "hd_audio_header", "front_audio", L("Front panel audio header (AAFP)", "مدخل الصوت الأمامي (AAFP)")),
  port("usb3-header", "usb3_header_19pin", "front_usb3", L("USB 3.2 Gen 1 header", "مدخل USB 3.2 Gen 1")),
  ...(o.usbC ? [port("usb-c-header", "usb_c_header_type_e", "front_usb_c", L("USB Type-C front panel connector", "موصّل USB Type-C للوحة الأمامية"))] : []),
  ...numbered(o.usb2, (i) => port(`usb2-${i}`, "usb2_header_9pin", "front_usb2", L(`USB 2.0 header ${i}`, `مدخل USB 2.0 رقم ${i}`))),
  ...numbered(o.sata, (i) => port(`sata-${i}`, "sata_data", "sata_data", L(`SATA 6Gb/s port ${i} (SATA6G_${i})`, `منفذ SATA 6Gb/s رقم ${i} (SATA6G_${i})`))),
  ...numbered(o.hdmi, () => port("hdmi-out", "hdmi", "display_out", L("Rear HDMI port (integrated graphics)", "منفذ HDMI الخلفي (الكرت المدمج)"))),
  ...numbered(o.displayPort, () => port("dp-out", "displayport", "display_out", L("Rear DisplayPort (integrated graphics)", "منفذ DisplayPort الخلفي (الكرت المدمج)"))),
];

/** The SATA data cables a board ships with (its "Accessories" list). Loose: either end goes to the drive or the board. */
export const sataDataCables = (quantity: number): CableSpec =>
  cable(
    "sata-data",
    "sata_data",
    "loose",
    L("SATA 6Gb/s data cable (supplied with the motherboard)", "كيبل بيانات SATA 6Gb/s (يجي مع اللوحة الأم)"),
    [
      end("a", "sata_data", "sata_data", "plug", "peer", L("SATA data plug A", "راس بيانات SATA ـ أ")),
      end("b", "sata_data", "sata_data", "plug", "peer", L("SATA data plug B", "راس بيانات SATA ـ ب")),
    ],
    quantity,
  );

export const dimmSlots = (generation: "ddr4" | "ddr5"): MountPointSpec[] =>
  (["a1", "a2", "b1", "b2"] as const).map((s) => ({
    id: `dimm-${s}`,
    kind: "dimm_slot" as const,
    generation,
    moduleType: "udimm" as const,
    label: L(`Memory slot DIMM_${s.toUpperCase()} (${generation.toUpperCase()})`, `فتحة الرام DIMM_${s.toUpperCase()} (${generation.toUpperCase()})`),
  }));

// ---------- Case ----------

export const fanMounts = (location: "front" | "top" | "rear" | "side", count: number, sizesMm: number[], en: string, ar: string): MountPointSpec[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `fan-${location}-${i + 1}`,
    kind: "fan_mount" as const,
    location,
    sizesMm,
    label: L(`${en} fan position ${i + 1}`, `مكان مروحة ${ar} رقم ${i + 1}`),
    fastener: { kind: "fan_screw" as const, count: 4 },
  }));
