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
  /** CPU_OPT header; absent on some entry boards. Default true. */
  cpuOpt?: boolean;
  /** Dedicated AIO_PUMP header; absent on some entry boards (a pump then goes to CPU_OPT or a fan header). Default true. */
  pumpHeader?: boolean;
  /** USB 3 front header. Default true. */
  usb3?: boolean;
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
    // On a board with no 8-pin socket the first 4-pin one is the CPU's only power input, so it is required.
    port(`eps4-${i}`, "eps_4pin", "cpu_power", L(`4-pin +12V CPU power connector ${i}`, `موصّل طاقة المعالج 4 سنون +12V رقم ${i}`), o.eps8 === 0 && i === 1 ? "required" : "optional"),
  ),
  port("cpu-fan", "fan_4pin_pwm", "cpu_fan_header", L("CPU fan header (CPU_FAN)", "مدخل مروحة المعالج (CPU_FAN)")),
  ...(o.cpuOpt === false ? [] : [port("cpu-opt", "fan_4pin_pwm", "cpu_fan_header", L("CPU optional fan header (CPU_OPT)", "مدخل مروحة المعالج الإضافي (CPU_OPT)"))]),
  ...(o.pumpHeader === false ? [] : [port("aio-pump", "fan_4pin_pwm", "pump_header", L("AIO pump header (AIO_PUMP)", "مدخل مضخة التبريد المائي (AIO_PUMP)"))]),
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
  ...(o.usb3 === false ? [] : [port("usb3-header", "usb3_header_19pin", "front_usb3", L("USB 3.2 Gen 1 header", "مدخل USB 3.2 Gen 1"))]),
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

export interface DimmClips { latches: "one_side" | "both" | "unverified"; note: string; latchEnd?: "top" | "bottom" }
const UNVERIFIED_CLIPS: DimmClips = { latches: "unverified", note: "Clip arrangement not confirmed for this board; one moving clip is modelled at the slot's far end." };
/**
 * Memory slots. The notch is off centre, so a module fits one way round (ASUS FAQ 1047257: open the clip,
 * match the notch to the slot's key, push straight down until the clip locks). `clips` says which ends move.
 * Alignment tolerance: 1.5 mm, about the clearance a module edge has to find the slot's groove (an
 * educational figure, not a manufacturer one).
 */
export const dimmSlots = (generation: "ddr3" | "ddr4" | "ddr5", slots: readonly string[] = ["a1", "a2", "b1", "b2"], clips: DimmClips = UNVERIFIED_CLIPS): MountPointSpec[] =>
  slots.map((s) => ({
    id: `dimm-${s}`,
    kind: "dimm_slot" as const,
    generation,
    moduleType: "udimm" as const,
    label: L(`Memory slot DIMM_${s.toUpperCase()} (${generation.toUpperCase()})`, `فتحة الرام DIMM_${s.toUpperCase()} (${generation.toUpperCase()})`),
    retention: { id: `dimm-${s}-latch`, kind: "dimm_latch" as const, latches: clips.latches, note: clips.note, ...(clips.latchEnd ? { latchEnd: clips.latchEnd } : {}) },
    keying: { rotationDeg: 0, toleranceMm: 1.5, mark: "notch" as const },
  }));

/** An M.2 slot held by ASUS's tool-free Q-Latch: turned open, the drive goes in at an angle, is pressed flat and the latch turned shut. */
export const m2QLatch = (slotId: string, note: string) => ({
  retention: { id: `${slotId}-qlatch`, kind: "m2_qlatch" as const, note },
  keying: M2_KEYING,
});
/**
 * The angle an M.2 drive goes in at, in degrees from flat. The manuals draw an angled insertion without a
 * figure: 15–35° is an educational approximation, not a manufacturer value.
 */
export const M2_INSERT_TILT_DEG: [number, number] = [15, 35];
const M2_KEYING = { rotationDeg: 0, toleranceMm: 2, mark: "notch" as const, insertTiltDeg: M2_INSERT_TILT_DEG };
/** An M.2 slot where the drive is held by a screw stand at its length hole and one screw (no Q-Latch). */
export const m2ScrewStand = (slotId: string, note: string) => ({
  retention: { id: `${slotId}-screw`, kind: "m2_screw" as const, note },
  fastener: { kind: "m2_screw" as const, count: 1 },
  keying: M2_KEYING,
});
/** A board's M.2 heatsink: held by screws, a plastic film on its thermal pad. Slots under it share the id. */
export const m2Heatsink = (id: string, note: string, screws = 2) => ({ id, screws, padFilm: true, note });

/** A PCIe x16 slot's latch and the card's alignment (connector over the slot, bracket in the case opening). */
export const pcieSlotDetail = (note: string) => ({
  retention: { id: "pcie-x16-1-latch", kind: "pcie_latch" as const, note },
  keying: { rotationDeg: 0, toleranceMm: 3, mark: "bracket" as const },
});
/**
 * A case's expansion-slot covers (they come out for a card's bracket), one at a time as `slot-covers:1`, `:2`.
 * Two openings is the lab's schematic: ASUS's pages for the catalog cards give slot thickness (2 to 3.6) but not the
 * bracket's openings, and the cases' manuals do not say how each cover is fixed (screws, tool-free) per model.
 */
export const SLOT_COVERS = { id: "slot-covers", kind: "slot_covers" as const, openings: 2, note: "Expansion-slot covers, taken out one at a time. Opening count and fixing are schematic (not documented per case or card)." };

/** The CPU socket's retention and keying: an LGA load plate with its lever, and the corner triangle. */
export const lgaSocketDetail = (note: string) => ({
  retention: { id: "cpu-socket-plate", kind: "lga_load_plate" as const, note },
  keying: { rotationDeg: 0, toleranceMm: 3, mark: "triangle" as const },
});

// ---------- Case ----------

export const fanMounts = (location: "front" | "top" | "rear" | "side", count: number, sizesMm: number[], en: string, ar: string, bank?: { id: string; capacityBySizeMm: Record<string, number> }): MountPointSpec[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `fan-${location}-${i + 1}`,
    kind: "fan_mount" as const,
    location,
    sizesMm,
    label: L(`${en} fan position ${i + 1}`, `مكان مروحة ${ar} رقم ${i + 1}`),
    fastener: { kind: "fan_screw" as const, count: 4 },
    ...(bank ? { bank } : {}),
  }));

// ---------- CPU cooler mounting (from the coolers' own manuals) ----------

/** Kit parts named in a cooler's packaging list. */
export const KIT = {
  contactFrame: { id: "contact-frame", label: L("CPU Contact Frame", "إطار التلامس للمعالج") },
  shoulderScrew: { id: "shoulder-screw", label: L("Shoulder screw", "برغي كتف") },
  t20Driver: { id: "t20-driver", label: L("T20 driver", "مفك T20") },
  vrmFanModule: { id: "vrm-fan-module", label: L("VRM fan module", "مروحة وحدة الطاقة (VRM)") },
  retentionRing: { id: "retention-ring", label: L("Intel retention ring", "حلقة التثبيت لإنتل") },
  retentionPin: { id: "retention-pin", label: L("Retention pin", "دبوس تثبيت") },
} as const;
const kit = (part: { id: string; label: ReturnType<typeof L> }, count: number) => ({ id: part.id, count, label: part.label });

/**
 * ARCTIC's contact-frame mounting on Intel LGA1700 / LGA1851: the board's backplate is kept, the socket's ILM is
 * taken off, and the frame (4 screws, engaged then tightened in a cross pattern) holds the CPU. `verifiedBody`:
 * whether the manual's text states the cooler body's two screws and their alternate tightening.
 */
export const contactFrameMounting = (source: string, verifiedBody: boolean, extraKit: ReturnType<typeof kit>[] = []) => ({
  kind: "contact_frame" as const,
  sockets: ["lga1700" as const, "lga1851" as const],
  backplate: "retained" as const,
  kit: [kit(KIT.contactFrame, 1), kit(KIT.shoulderScrew, 4), kit(KIT.t20Driver, 1), ...extraKit],
  frame: { screws: 4 },
  bodyScrews: { count: 2, order: "alternate" as const, verified: verifiedBody },
  source,
});

/** ARCTIC Freezer 7 X on Intel: a retention ring and 4 push pins, the mounting position set to the socket family. */
export const retentionRingMounting = (source: string) => ({
  kind: "retention_ring" as const,
  sockets: ["lga1700" as const, "lga1851" as const, "lga1200" as const, "lga1150" as const],
  backplate: "none" as const,
  kit: [kit(KIT.retentionRing, 1), kit(KIT.retentionPin, 4)],
  ring: {
    pins: 4,
    positions: [
      { id: "1700", sockets: ["lga1700" as const, "lga1851" as const], label: L("LGA1851 / LGA1700 position", "وضع LGA1851 / LGA1700") },
      { id: "1200", sockets: ["lga1200" as const, "lga1150" as const], label: L("LGA1200 / LGA115x position", "وضع LGA1200 / LGA115x") },
    ],
  },
  source,
});
export const vrmModule = (count = 1) => kit(KIT.vrmFanModule, count);
