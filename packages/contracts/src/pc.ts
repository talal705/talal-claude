// PC lab contracts v1 (frozen by the lead 2026-10-10). Additive union members (connectors, diagnostic codes)
// may be added by pcsim with notice to consumers; any other change goes through the lead and bumps the version.
// Consumers: packages/simulation/src/pc (rule engine), content/catalog (data), apps/web PC lab (frontend),
// components/tutor + lib/targets (interaction). Everything here is JSON-serializable data or a type;
// no rendering, React or DOM. Rendering never owns compatibility or success rules.
import type { Localized } from "./common";
import type { TutorTargetRef } from "./platform";

export const PC_CONTRACTS_VERSION = 1;
/** `ProjectRecord.dataVersion` for a PC project whose `data` is a `PCProjectData`. */
export const PC_PROJECT_DATA_VERSION = 1;

// =====================================================================================
// Catalog
// =====================================================================================

/** The nine learner-facing categories of the brief (section 6). */
export type PCPartCategory =
  | "case"
  | "motherboard"
  | "cpu"
  | "ram"
  | "gpu"
  | "psu"
  | "storage"
  | "fan"
  | "cooling";

/**
 * Supporting entries that are not counted toward the per-category target.
 * "monitor" is kept only so that saved projects and archived catalog data from before 2026-10-27 still parse;
 * the PC lab no longer offers or requires a monitor (owner decision 11).
 */
export type PCAccessoryCategory = "cable" | "monitor";
export type PCCatalogCategory = PCPartCategory | PCAccessoryCategory;

export type CpuVendor = "intel" | "amd";
export type CpuSocket = "lga1200" | "lga1700" | "lga1851" | "am4" | "am5";
export type MotherboardFormFactor = "e_atx" | "atx" | "micro_atx" | "mini_itx";
export type PsuFormFactor = "atx" | "sfx" | "sfx_l";
export type MemoryGeneration = "ddr4" | "ddr5";
export type MemoryModuleType = "udimm" | "sodimm";
export type CoolingType = "air" | "aio_liquid";
export type StorageInterface = "sata" | "nvme";
export type StorageFormFactor = "2.5_inch" | "3.5_inch" | "m2_2230" | "m2_2242" | "m2_2260" | "m2_2280" | "m2_22110";
export type CaseLocation = "front" | "top" | "rear" | "bottom" | "side" | "psu_shroud";
export type PartColor = "black" | "white" | "silver" | "other";

/** Where a specification came from. Every commercial entry has at least one, fetched on `retrievedOn`. */
export interface SpecSource {
  /** Manufacturer page (or manual PDF) that was actually fetched. */
  url: string;
  title: string;
  publisher: string;
  /** ISO date (YYYY-MM-DD) of the fetch. */
  retrievedOn: string;
}

export type CatalogVerification =
  /** Every specification field used by the engine was read from `sources`. */
  | "verified"
  /** Read from `sources`, except the paths listed in `unverifiedFields`. */
  | "partially_verified"
  /** Not a commercial product: an educational part labelled as generic. `generic` is true. */
  | "generic";

export type AssetQuality =
  /** No visual exists. The entry must not be counted as a finished catalog entry. */
  | "missing"
  /** Box or simple stand-in. Not counted as finished. */
  | "placeholder"
  /** Recognisable original educational geometry, not manufacturer-accurate. */
  | "educational"
  /** Detailed model with documented provenance. */
  | "detailed";

export interface AssetRef {
  /** Path under `assets/`, or null when none exists yet. */
  model: string | null;
  thumbnail: string | null;
  kind: "glb" | "procedural" | "svg" | "none";
  /** Who made it and from what; "none" when missing. Never claims manufacturer accuracy for approximate geometry. */
  provenance: string;
  license: string | null;
  /** Axis conventions of the model file. */
  orientation: { up: "+y" | "+z"; front: "+z" | "-z" | "+x" | "-x" };
  /** Metres per model unit. */
  metresPerUnit: number;
  quality: AssetQuality;
}

/** Outer size of the part. Axis meaning is per category and stated in `docs/CATALOG.md`. Null when the manufacturer does not publish it. */
export interface DimensionsMm {
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}

/** A region of a part the learner can select to read about. */
export interface InspectZone {
  id: string;
  label: Localized;
  description: Localized;
  /** Name of the node/anchor in the visual asset. The visual layer resolves it; the engine ignores it. */
  anchor?: string;
}

// ---------- Connectors, ports and cables ----------

/**
 * Physical connector shapes. Whether two shapes mate is decided by the engine's mating table
 * (`connectorsMate`), never by string equality in the UI. Look-alikes are distinct on purpose:
 * `eps_8pin` and `pcie_8pin` are keyed differently, `argb_5v_3pin` and `rgb_12v_4pin` are different headers.
 */
export type ConnectorType =
  // Main board power
  | "atx_24pin"
  // CPU power (EPS12V). `eps_4plus4pin` is the split cable plug that fits an 8-pin or a 4-pin socket.
  | "eps_8pin"
  | "eps_4pin"
  | "eps_4plus4pin"
  // Graphics power. `pcie_6plus2pin` is the split cable plug that fits an 8-pin or a 6-pin socket.
  | "pcie_8pin"
  | "pcie_6pin"
  | "pcie_6plus2pin"
  /** 16-pin (12+4) high-power graphics connector: 12VHPWR (ATX 3.0) and its revision 12V-2x6 (ATX 3.1). They mate with each other. */
  | "pcie_12vhpwr"
  | "pcie_12v_2x6"
  // Drives and peripherals
  | "sata_power"
  | "sata_data"
  | "molex_4pin"
  // Fans and pumps. A 3-pin plug fits a 4-pin header (no PWM control).
  | "fan_4pin_pwm"
  | "fan_3pin"
  // Lighting. Not interchangeable: 5 V addressable 3-pin versus 12 V 4-pin.
  | "argb_5v_3pin"
  | "rgb_12v_4pin"
  // Front panel. All four leads share the 2-pin shape; `PortFunction` tells them apart.
  | "front_panel_2pin"
  | "hd_audio_header"
  | "usb2_header_9pin"
  | "usb3_header_19pin"
  | "usb_c_header_type_e"
  // Display
  | "hdmi"
  | "displayport"
  /** A socket or plug on the PSU side of a modular cable. Only cables with the same `keying` belong there. */
  | "psu_modular";

/** What a port or cable end is for. Physical fit comes from `ConnectorType`; logical correctness from this. */
export type PortFunction =
  | "atx_main_power"
  | "cpu_power"
  | "gpu_power"
  | "sata_power"
  | "sata_data"
  | "peripheral_power"
  | "cpu_fan_header"
  | "pump_header"
  | "system_fan_header"
  | "fan_motor"
  | "pump_motor"
  | "argb_header"
  | "rgb_header"
  | "argb_device"
  | "rgb_device"
  | "power_switch"
  | "reset_switch"
  | "power_led"
  | "drive_led"
  | "front_audio"
  | "front_usb2"
  | "front_usb3"
  | "front_usb_c"
  | "display_out"
  | "display_in"
  | "display_link"
  | "psu_output";

/** A fixed socket on the body of a part. */
export interface PortSpec {
  id: string;
  connector: ConnectorType;
  function: PortFunction;
  label: Localized;
  /**
   * `required`: the part cannot work without it (board ATX 24-pin, graphics card power).
   * `recommended`: the manufacturer's manual instructs connecting it, but the teaching model does not stop
   *                startup without it; reported as an assembly warning.
   * `optional`: works without it (spare fan header).
   */
  requirement: "required" | "recommended" | "optional";
  /** Extra physical/electrical key. For `psu_modular` it names the manufacturer cable family and socket class. */
  keying?: string;
  zoneId?: string;
  anchor?: string;
}

export interface CableEndSpec {
  id: string;
  connector: ConnectorType;
  function: PortFunction;
  /** A `plug` goes into a port or into a `receptacle` end of another cable (adapters). */
  gender: "plug" | "receptacle";
  /**
   * `source`: the side power or signal comes from (PSU side of a modular cable, PSU-cable inputs of an adapter).
   * `device`: the side that plugs into the consuming part.
   * `peer`: symmetric cables (SATA data, HDMI, DisplayPort).
   */
  side: "source" | "device" | "peer";
  label: Localized;
  keying?: string;
}

export type CableKind =
  | "atx_main"
  | "cpu_power"
  | "gpu_power"
  | "gpu_power_adapter"
  | "sata_power"
  | "peripheral_power"
  | "sata_data"
  | "fan_lead"
  | "pump_lead"
  | "lighting_lead"
  | "front_panel_lead"
  | "display";

export interface CableSpec {
  id: string;
  kind: CableKind;
  label: Localized;
  /**
   * `captive`: permanently fixed to the owning part (fan lead, case front-panel lead, non-modular PSU cable);
   *            only its free ends are listed.
   * `modular`: detachable PSU cable; its `source` end goes into a `psu_modular` port with the same keying.
   * `loose`:   independent cable or adapter (SATA data, display cable, graphics power adapter).
   */
  attachment: "captive" | "modular" | "loose";
  ends: CableEndSpec[];
  /** Number of identical cables of this spec supplied with the part. */
  quantity: number;
}

// ---------- Mounting ----------

export type FastenerKind =
  | "standoff_screw"
  | "case_screw"
  | "thumbscrew"
  | "m2_screw"
  | "m2_latch"
  | "fan_screw"
  | "radiator_screw"
  | "cooler_bracket"
  | "socket_lever"
  | "dimm_latch"
  | "slot_latch"
  | "tool_less";

export interface FastenerSpec {
  kind: FastenerKind;
  count: number;
}

interface MountPointBase {
  id: string;
  label: Localized;
  /** What holds a part here once seated. Absent when nothing has to be secured. */
  fastener?: FastenerSpec;
  /** Other mount points on the same part that become unusable while this one is occupied. */
  blocks?: string[];
  zoneId?: string;
  anchor?: string;
}

/** A place on a part where another part is installed. The `kind` discriminates what fits. */
export type MountPointSpec =
  | (MountPointBase & { kind: "motherboard_tray"; formFactors: MotherboardFormFactor[] })
  | (MountPointBase & { kind: "psu_bay"; formFactors: PsuFormFactor[]; maxLengthMm: number | null })
  | (MountPointBase & { kind: "drive_bay"; sizes: ("2.5_inch" | "3.5_inch")[] })
  | (MountPointBase & { kind: "fan_mount"; location: CaseLocation; sizesMm: number[] })
  | (MountPointBase & {
      kind: "radiator_mount";
      location: CaseLocation;
      /** Supported radiator sizes by nominal length (120, 140, 240, 280, 360, 420). */
      radiatorSizesMm: number[];
    })
  | (MountPointBase & { kind: "cpu_socket"; socket: CpuSocket })
  /** The cooler mounting position around the CPU socket. */
  | (MountPointBase & { kind: "cpu_cooler_mount"; socket: CpuSocket })
  | (MountPointBase & { kind: "dimm_slot"; generation: MemoryGeneration; moduleType: MemoryModuleType })
  | (MountPointBase & {
      kind: "pcie_slot";
      mechanical: "x16" | "x4" | "x1";
      /** Electrical lanes and PCIe generation as documented; null when not published. */
      lanes: number | null;
      pcieGeneration: number | null;
    })
  | (MountPointBase & {
      kind: "m2_slot";
      /** Module lengths the slot has mounting positions for, e.g. ["m2_2280", "m2_2260"]. */
      lengths: StorageFormFactor[];
      interfaces: StorageInterface[];
      pcieGeneration: number | null;
    });

export type MountKind = MountPointSpec["kind"];

/**
 * What a part needs in order to be installed. Most parts have one role (`main`).
 * An AIO cooler has two: `block` on the CPU cooler mount and `radiator` on a case radiator mount.
 */
export interface MountRoleSpec {
  role: string;
  kind: MountKind;
  label: Localized;
}

// ---------- Lighting hardware ----------

export type RgbControl =
  /** Lit and controlled through the part's own slot or power (memory, graphics card, on-board LEDs). */
  | "integrated"
  /** Needs its `argb_5v_3pin` lead on a 5 V addressable header. */
  | "argb_5v_3pin"
  /** Needs its `rgb_12v_4pin` lead on a 12 V RGB header. */
  | "rgb_12v_4pin";

/** Present only on parts that physically have light sources. `null` on a catalog entry means: never draw light on it. */
export interface RgbHardware {
  control: RgbControl;
  /** The cable (in `cables`) that carries lighting, for the two header-driven kinds. */
  lightingCableId?: string;
  zones: string[];
  /** False for fixed-colour LEDs. */
  addressable: boolean;
}

// ---------- Category-specific specifications ----------

export interface CaseSpec {
  color: PartColor;
  /** Manufacturer's class name, e.g. "Mid-Tower". */
  towerClass: string;
  sidePanel: "tempered_glass" | "steel" | "mesh" | "acrylic";
  maxGpuLengthMm: number;
  maxCpuCoolerHeightMm: number;
  maxPsuLengthMm: number | null;
  /** Number of fans supplied pre-installed, as documented. Their leads appear in `cables`. */
  includedFanCount: number;
}

export interface BiosVersion {
  version: string;
  /** ISO date when published by the manufacturer; null when not shown. */
  releasedOn: string | null;
}

/** One row of the manufacturer's CPU support list for this exact board. */
export interface CpuSupportEntry {
  /** Catalog ID of the CPU. */
  cpuId: string;
  /** First BIOS version that supports it, exactly as the support list prints it. */
  sinceBios: string;
}

export interface MemoryPopulationRule {
  /** Number of installed modules this recommendation applies to. */
  modules: number;
  /** DIMM mount point IDs the manual recommends, in any order. */
  slotIds: string[];
}

/** One line of a board's "Back Panel I/O" list. Only HDMI and DisplayPort take part in the rules (as ports); the rest is drawn. */
export interface RearPanelItem {
  kind: "usb_a" | "usb_c" | "hdmi" | "displayport" | "ethernet" | "audio_jack" | "optical_spdif" | "wifi_antenna" | "bios_flashback_button";
  count: number;
  /** The line as the spec page prints it. */
  label: string;
  /** Set when the item is also a modelled port of the entry. */
  portId?: string;
}

export interface MotherboardSpec {
  vendorPlatform: CpuVendor;
  socket: CpuSocket;
  chipset: string;
  formFactor: MotherboardFormFactor;
  memory: {
    generation: MemoryGeneration;
    moduleType: MemoryModuleType;
    slots: number;
    maxTotalGb: number;
    maxPerModuleGb: number | null;
    /** From the board manual. A supported but non-recommended layout is an optional improvement, never a POST failure. */
    recommendedPopulation: MemoryPopulationRule[];
  };
  /** Explicit support list. A CPU that fits the socket but is not listed is not assumed to work. */
  cpuSupport: CpuSupportEntry[];
  /** Oldest to newest. The engine compares positions in this list, never version strings. */
  biosVersions: BiosVersion[];
  /**
   * Teaching assumption, stated in the UI: the simulated board starts on this version.
   * A real board ships with whatever was current at manufacture.
   */
  factoryBiosVersion: string;
  /** The board can flash a BIOS file without a working CPU (named feature on the spec page). */
  biosFlashWithoutCpu: boolean | null;
  /** Rear display outputs exist and work only with a CPU that has integrated graphics. */
  hasIntegratedDisplayOutputs: boolean;
  sataPorts: number;
  /** The back panel as the spec page lists it; absent when not recorded. Used by the visual model only. */
  rearPanel?: RearPanelItem[];
}

export interface CpuSpec {
  vendor: CpuVendor;
  socket: CpuSocket;
  family: string;
  cores: number;
  threads: number;
  /** Null when the CPU has no integrated graphics; then the board's display outputs do nothing. */
  integratedGraphics: string | null;
  /** Manufacturer's base power figure (Intel Processor Base Power / AMD default TDP), watts. */
  basePowerW: number;
  /** Manufacturer's maximum sustained package power (Intel Maximum Turbo Power / AMD PPT), watts; null when not published. */
  maxPowerW: number | null;
  memorySupport: { generation: MemoryGeneration; maxSpeedMTs: number | null }[];
  maxMemoryGb: number | null;
  coolerIncluded: boolean;
}

export type MemoryProfile = "xmp_2" | "xmp_3" | "expo";

export interface RamSpec {
  generation: MemoryGeneration;
  moduleType: MemoryModuleType;
  /** One build instance is one module; the catalog entry is the retail kit. */
  modulesInKit: number;
  capacityPerModuleGb: number;
  kitCapacityGb: number;
  /** Advertised transfer rate in MT/s, reached only with a profile enabled. */
  ratedSpeedMTs: number;
  /** Rate without a profile (SPD/JEDEC default) when the manufacturer states it. */
  defaultSpeedMTs: number | null;
  profiles: MemoryProfile[];
  casLatency: number | null;
  voltageV: number | null;
  moduleHeightMm: number | null;
}

export interface GpuSpec {
  /** e.g. "GeForce RTX 4070". */
  chipset: string;
  /** Board-partner length; compared with the case limit. */
  lengthMm: number;
  /** Expansion-slot thickness as the manufacturer states it (e.g. 2.5); null when not published. */
  slotThickness: number | null;
  /** Manufacturer's recommended PSU wattage for a system with this card. */
  recommendedPsuW: number | null;
  /** Card power figure used by the teaching load model; null when the manufacturer page does not give one. */
  powerDrawW: number | null;
  /** Number of cooling fans as the product page states it; null when it states none. Used by the visual model only. */
  fanCount: number | null;
}

export type PsuEfficiency =
  | "80plus_white"
  | "80plus_bronze"
  | "80plus_silver"
  | "80plus_gold"
  | "80plus_platinum"
  | "80plus_titanium"
  | "cybenetics_gold"
  | "cybenetics_platinum"
  | "none";

export interface PsuSpec {
  /** Rated continuous output. Efficiency never changes this number. */
  wattageW: number;
  efficiency: PsuEfficiency[];
  formFactor: PsuFormFactor;
  modularity: "full" | "semi" | "none";
  /** e.g. "ATX 3.1"; null when not stated. */
  atxSpec: string | null;
  /** Manufacturer's modular cable family; cables from another family are not interchangeable even when the plug looks the same. */
  cableFamily: string | null;
}

export interface StorageSpec {
  interface: StorageInterface;
  formFactor: StorageFormFactor;
  capacityGb: number;
  /** e.g. "PCIe 4.0 x4, NVMe 2.0" or "SATA 6 Gb/s". */
  protocol: string;
}

export interface FanSpec {
  sizeMm: number;
  thicknessMm: number;
  control: "pwm_4pin" | "dc_3pin";
  maxRpm: number | null;
}

export interface CoolingSpec {
  type: CoolingType;
  supportedSockets: CpuSocket[];
  /** Air coolers: total height including fan, compared with the case limit. Null for AIO. */
  heightMm: number | null;
  /** AIO: nominal radiator size (120, 240, 280, 360, 420). Null for air. */
  radiatorSizeMm: number | null;
  fanCount: number;
  fanSizeMm: number | null;
  /**
   * Heat the cooler is treated as able to remove in the teaching load model, watts.
   * `source` says whether the manufacturer publishes it or it is a labelled teaching assumption.
   */
  coolingCapacityW: { value: number; source: "manufacturer" | "teaching_assumption" } | null;
}

/** Kept for saved data from before 2026-10-27 only (decision 11): no monitor is offered or required. */
export interface MonitorSpec {
  generic: true;
}

// ---------- Catalog entry ----------

interface CatalogEntryBase {
  /** Stable, lower-case, kebab-case. Never reused or renamed once published. */
  id: string;
  brand: string;
  model: string;
  /** Manufacturer part number of the exact SKU when known. */
  partNumber: string | null;
  /** True for an educational part that is not a commercial product. Shown to the learner as generic. */
  generic: boolean;
  /** What this part is and why it matters, written for a learner. */
  description: Localized;
  sources: SpecSource[];
  verification: CatalogVerification;
  /** Dotted paths (e.g. "spec.maxPsuLengthMm", "ports") that were not read from a source. Never silently guessed. */
  unverifiedFields: string[];
  /** Simplifications made for teaching, in English; surfaced in docs/CATALOG.md. */
  teachingNotes: string[];
  dimensions: DimensionsMm;
  /** Human-readable form factor, e.g. "ATX", "M.2 2280", "120 mm". */
  formFactor: string;
  /** Places on this part where other parts install. */
  mountPoints: MountPointSpec[];
  /** Where this part itself installs. Empty for the case, cables and the monitor. */
  mounting: MountRoleSpec[];
  zones: InspectZone[];
  ports: PortSpec[];
  /** Cables that belong to this part: captive leads, supplied modular cables, supplied adapters. */
  cables: CableSpec[];
  rgb: RgbHardware | null;
  asset: AssetRef;
}

export type CaseEntry = CatalogEntryBase & { category: "case"; spec: CaseSpec };
export type MotherboardEntry = CatalogEntryBase & { category: "motherboard"; spec: MotherboardSpec };
export type CpuEntry = CatalogEntryBase & { category: "cpu"; spec: CpuSpec };
export type RamEntry = CatalogEntryBase & { category: "ram"; spec: RamSpec };
export type GpuEntry = CatalogEntryBase & { category: "gpu"; spec: GpuSpec };
export type PsuEntry = CatalogEntryBase & { category: "psu"; spec: PsuSpec };
export type StorageEntry = CatalogEntryBase & { category: "storage"; spec: StorageSpec };
export type FanEntry = CatalogEntryBase & { category: "fan"; spec: FanSpec };
export type CoolingEntry = CatalogEntryBase & { category: "cooling"; spec: CoolingSpec };
/** A loose cable sold or supplied on its own; `cables` holds exactly one `loose` spec. */
export type CableEntry = CatalogEntryBase & { category: "cable"; spec: Record<string, never> };
export type MonitorEntry = CatalogEntryBase & { category: "monitor"; spec: MonitorSpec };

export type CatalogEntry =
  | CaseEntry
  | MotherboardEntry
  | CpuEntry
  | RamEntry
  | GpuEntry
  | PsuEntry
  | StorageEntry
  | FanEntry
  | CoolingEntry
  | CableEntry
  | MonitorEntry;

export type CatalogPart = Exclude<CatalogEntry, CableEntry | MonitorEntry>;

export interface PCCatalog {
  /** Changes whenever entries are added or corrected; stored in the build so stale projects are detectable. */
  version: string;
  entries: CatalogEntry[];
}

/** A ready assembly built from the shared catalog, expressed as the actions that produce it. */
export interface PCPreset {
  id: string;
  title: Localized;
  description: Localized;
  rgb: RgbPreference;
  actions: PCAction[];
}

// =====================================================================================
// Build state
// =====================================================================================

/**
 * Engine-assigned and deterministic. Parts: `<category>-<serial>` (e.g. `ram-4`), where the serial is the build-wide
 * `nextSerial` counter, so an ID is never reused after a removal. Cables that come with a part:
 * `<owner>.<cableSpecId>` or `<owner>.<cableSpecId>-<k>` when several are supplied; loose cables: `cable-<serial>`.
 */
export type InstanceId = string;
export type CableId = string;

export type RgbPreference = "with_rgb" | "without_rgb";

export interface MountRef {
  /** The part that has the mount point (the case, the motherboard). */
  hostInstanceId: InstanceId;
  mountPointId: string;
}

/**
 * `placed`: aligned on the mount but not pushed home.
 * `partial`: pushed in but not fully latched (a memory module with one latch closed). Distinct from `placed` and from an incompatible part.
 * `seated`: fully home.
 */
export type SeatingState = "placed" | "partial" | "seated";

export interface PartAttachment {
  /** Matches a `MountRoleSpec.role` of the part. */
  role: string;
  target: MountRef;
  seating: SeatingState;
  /** How many of the mount point's fasteners are secured (0..count). */
  fastenersSecured: number;
}

export interface PartLightingState {
  enabled: boolean;
  /** `#rrggbb`. */
  color: string;
  effect: "static" | "breathing" | "rainbow";
}

export interface InstalledPart {
  instanceId: InstanceId;
  catalogId: string;
  /** Empty while the part is selected but still on the bench. */
  attachments: PartAttachment[];
  /** Present only when the catalog entry has `rgb` hardware. */
  lighting?: PartLightingState;
  /** Motherboards only: the BIOS version currently flashed. */
  biosVersion?: string;
  /** Storage only: whether the drive carries an installed operating system. */
  bootable?: boolean;
}

/** One end of a connection: a port on a part, or a receptacle end of another cable (adapter). */
export type PortRef =
  | { kind: "part"; instanceId: InstanceId; portId: string }
  | { kind: "cable"; cableId: CableId; endId: string };

export interface CableInstance {
  id: CableId;
  /** Catalog entry and cable spec that define this cable's ends. */
  catalogId: string;
  cableSpecId: string;
  /** Set when the cable came with a part in the build; a captive cable is fixed to this part. */
  ownerInstanceId: InstanceId | null;
  /** For every end in the spec: where it is plugged, or null when loose. Both endpoint identities are always explicit. */
  ends: Record<string, PortRef | null>;
  /** Routing quality only. Never affects startup. */
  tidied: boolean;
}

export interface PowerState {
  /** Mains cable between the wall and the PSU. */
  wallConnected: boolean;
  /** Rocker switch on the PSU. */
  psuSwitchOn: boolean;
  /** The case power button has been pressed since the last power-off. */
  pressed: boolean;
}

export interface PCBuildState {
  catalogVersion: string;
  rgbPreference: RgbPreference;
  /** In creation order. */
  parts: InstalledPart[];
  cables: CableInstance[];
  sidePanelOpen: boolean;
  power: PowerState;
  /** Counter behind deterministic instance IDs; replaying the same actions yields the same IDs. */
  nextSerial: number;
}

/** `ProjectRecord<PCProjectData>.data` with `dataVersion = PC_PROJECT_DATA_VERSION`. */
export interface PCProjectData {
  state: PCBuildState;
  /** Accepted actions since the build was created; replaying them on an empty build reproduces `state`. */
  log: PCAction[];
}

// =====================================================================================
// Actions and events
// =====================================================================================

/** Every change to a build is one of these. Reducers are pure: (state, action, catalog) -> result. */
export type PCAction =
  | { type: "set_rgb_preference"; preference: RgbPreference }
  /** Adds one instance to the bench. For memory, one instance is one module. */
  | { type: "add_part"; catalogId: string }
  /** Removes the instance, anything mounted on it returns to the bench, and its cables are unplugged. */
  | { type: "remove_part"; instanceId: InstanceId }
  /** Aligns the part on a mount point (`placed`). Rejected with a reason when it cannot physically go there. */
  | { type: "mount_part"; instanceId: InstanceId; role?: string; target: MountRef }
  | { type: "unmount_part"; instanceId: InstanceId; role?: string }
  | { type: "set_seating"; instanceId: InstanceId; role?: string; seating: SeatingState }
  | { type: "set_fasteners"; instanceId: InstanceId; role?: string; secured: number }
  /**
   * Takes a loose cable from the catalog (`cableSpecId` defaults to its only spec), or a single cable of another
   * entry's spec without adding that part (e.g. a modular cable left over from a different power supply).
   * Cables that belong to a part in the build are created with the part and need no `add_cable`.
   */
  | { type: "add_cable"; catalogId: string; cableSpecId?: string }
  | { type: "remove_cable"; cableId: CableId }
  | { type: "connect_cable_end"; cableId: CableId; endId: string; to: PortRef }
  | { type: "disconnect_cable_end"; cableId: CableId; endId: string }
  | { type: "set_cable_tidy"; cableId: CableId; tidied: boolean }
  | { type: "set_part_lighting"; instanceId: InstanceId; lighting: Partial<PartLightingState> }
  | { type: "set_side_panel"; open: boolean }
  | { type: "set_wall_power"; connected: boolean }
  | { type: "set_psu_switch"; on: boolean }
  | { type: "press_power" }
  | { type: "power_off" }
  | { type: "update_bios"; instanceId: InstanceId; version: string }
  | { type: "set_storage_bootable"; instanceId: InstanceId; bootable: boolean };

export type PCActionType = PCAction["type"];

/** One entry of the replayable log. Rejected attempts are recorded too, so a lesson can see what was tried. */
export interface PCEvent {
  /** 1-based position in the log. */
  seq: number;
  action: PCAction;
  accepted: boolean;
  /** Present when `accepted` is false. */
  rejection?: PCDiagnostic;
  /** IDs created by the action (new part instance, new cables). */
  created?: { instanceId?: InstanceId; cableIds?: CableId[] };
}

export type PCActionResult =
  | { ok: true; state: PCBuildState; created?: { instanceId?: InstanceId; cableIds?: CableId[] } }
  | { ok: false; state: PCBuildState; rejection: PCDiagnostic };

/** Undo/redo container. `past` and `future` hold whole immutable states. */
export interface PCHistory {
  past: PCBuildState[];
  present: PCBuildState;
  future: PCBuildState[];
  events: PCEvent[];
}

// =====================================================================================
// Diagnostics
// =====================================================================================

/** The five classes of section 8. */
export type PCDiagnosticClass =
  /** The part or plug cannot physically go there. Reported when the action is rejected. */
  | "impossible_fit"
  /** Something is missing, loose, half-seated or connected to the wrong place. */
  | "assembly"
  /** Stops one of startup stages 1-4. */
  | "startup_fault"
  /** Appears only under the modelled load of stage 5. */
  | "operating_load_fault"
  /** Does not stop anything: tidiness, recommended memory slots, unsecured non-critical screws. */
  | "optional_improvement";

export type PCDiagnosticCode =
  // Rejected actions
  | "unknown_reference"
  | "invalid_action"
  | "power_is_on"
  | "mount_kind_mismatch"
  | "mount_occupied"
  | "mount_blocked"
  | "host_not_ready"
  | "cpu_socket_mismatch"
  | "ram_generation_mismatch"
  | "ram_module_type_mismatch"
  | "board_form_factor_unsupported"
  | "gpu_too_long"
  | "cooler_too_tall"
  | "cooler_socket_unsupported"
  | "radiator_size_unsupported"
  | "psu_form_factor_unsupported"
  | "psu_too_long"
  | "fan_size_unsupported"
  | "drive_bay_mismatch"
  | "m2_length_unsupported"
  | "m2_interface_unsupported"
  | "connector_mismatch"
  | "eps_pcie_not_interchangeable"
  | "rgb_argb_not_interchangeable"
  | "modular_cable_mismatch"
  | "port_occupied"
  | "seating_blocked"
  // Build diagnostics
  | "part_missing"
  | "part_not_mounted"
  | "part_not_seated"
  | "ram_partially_seated"
  | "cpu_lever_open"
  | "fasteners_missing"
  | "cooler_not_secured"
  | "wall_power_disconnected"
  | "psu_switch_off"
  | "required_power_missing"
  | "power_cable_source_loose"
  | "psu_connector_unavailable"
  | "power_switch_not_connected"
  | "power_switch_wrong_header"
  | "cpu_not_supported_by_board"
  | "cpu_needs_bios_update"
  | "ram_capacity_exceeded"
  | "ram_population_not_recommended"
  | "ram_single_module"
  | "ram_profile_note"
  | "graphics_missing"
  | "monitor_missing"
  | "monitor_not_connected"
  | "display_on_board_without_igpu"
  | "display_on_board_with_gpu"
  | "storage_missing"
  | "storage_not_detected"
  | "storage_not_bootable"
  | "psu_insufficient_for_load"
  | "psu_below_gpu_recommendation"
  | "cooler_missing"
  | "cooler_insufficient_for_load"
  | "cooler_fan_not_connected"
  | "pump_not_connected"
  | "lighting_not_connected"
  | "cable_untidy"
  | "cable_end_loose"
  | "side_panel_open";

/**
 * A fact the diagnostic rests on, so the learner (and the tutor) can check it rather than trust it.
 * `observed` and `expected` are language-neutral values with units (`357.6 mm`, `LGA1700`, `DDR4`, `0 / 2`),
 * never sentences; the UI renders them left-to-right inside the localized `label`.
 */
export interface PCEvidence {
  label: Localized;
  /** The observed value from the build or catalog. */
  observed: string;
  /** The value that would be acceptable, when there is one. */
  expected?: string;
  /** Catalog entry the value was read from. */
  catalogId?: string;
}

export interface PCDiagnostic {
  /** Stable for the same fault on the same subject: `<code>:<subject>`. */
  id: string;
  code: PCDiagnosticCode;
  class: PCDiagnosticClass;
  /** `blocking` stops a startup stage or rejects an action; `warning` and `info` never do. */
  severity: "blocking" | "warning" | "info";
  /** The startup stage where this shows up; absent for rejections and pure advisories. */
  stage?: StartupStage;
  /** Hint level 1: the symptom only, without naming the cause or the place. Absent when there is nothing to observe. */
  observation?: Localized;
  /** Hint level 2: what is wrong and where. */
  message: Localized;
  /** Hint level 3: the rule behind it. Reveals more than `message`; the tutor decides when to show it. */
  explanation: Localized;
  evidence: PCEvidence[];
  /**
   * Where to point. Built with `pcTarget`, so `id` and `kind` always agree. Carries the
   * `projectRevision` (and `executionId` for startup runs) passed in `PCEvaluationContext`.
   */
  target: TutorTargetRef;
  relatedTargets: TutorTargetRef[];
}

/** Stamped on every diagnostic target so stale guidance can be detected after the project changes. */
export interface PCEvaluationContext {
  projectRevision?: number;
  /** Set for a startup run; identifies that press of the power button. */
  executionId?: string;
}

// ---------- Target IDs ----------

const pcRef = (kind: TutorTargetRef["kind"], name: string): TutorTargetRef => ({ id: `pc:${kind}:${name}`, kind });

export type PCSettingTarget = "rgb-preference" | "psu-switch" | "wall-power" | "power-button" | "side-panel";

/**
 * The only place PC target IDs are built. The UI registers elements with these and the engine
 * points diagnostics at them, so the strings and kinds cannot drift apart.
 */
export const pcTarget = {
  /** `pc:component:ram-1` */
  part: (instanceId: InstanceId): TutorTargetRef => pcRef("component", instanceId),
  /** `pc:component:motherboard-1#vrm-heatsink` */
  zone: (instanceId: InstanceId, zoneId: string): TutorTargetRef => pcRef("component", `${instanceId}#${zoneId}`),
  /** `pc:connector:motherboard-1/dimm-a2` */
  mount: (ref: MountRef): TutorTargetRef => pcRef("connector", `${ref.hostInstanceId}/${ref.mountPointId}`),
  /** A port on a part is `pc:port:motherboard-1/atx-24`; a receptacle end of a cable is that cable end. */
  port: (ref: PortRef): TutorTargetRef =>
    ref.kind === "part" ? pcRef("port", `${ref.instanceId}/${ref.portId}`) : pcRef("cable-end", `${ref.cableId}/${ref.endId}`),
  /** `pc:cable-end:psu-1.cpu-1/device` */
  cableEnd: (cableId: CableId, endId: string): TutorTargetRef => pcRef("cable-end", `${cableId}/${endId}`),
  /** `pc:setting:psu-switch` */
  setting: (name: PCSettingTarget): TutorTargetRef => pcRef("setting", name),
} as const;

// ---------- Destination options (non-drag flow) ----------

/** One candidate destination for a part. Produced by a pure query; nothing is written to the event log. */
export interface PCMountOption {
  role: string;
  target: MountRef;
  label: Localized;
  ok: boolean;
  /** Why it cannot go there; present when `ok` is false. */
  rejection?: PCDiagnostic;
}

/** One candidate destination for a cable end. */
export interface PCCableEndOption {
  to: PortRef;
  label: Localized;
  ok: boolean;
  rejection?: PCDiagnostic;
}

// =====================================================================================
// Startup (educational model, not firmware emulation)
// =====================================================================================

export type StartupStage =
  | "power"
  | "post"
  | "firmware_display"
  | "boot_device"
  | "operating_load";

export const STARTUP_STAGES: readonly StartupStage[] = [
  "power",
  "post",
  "firmware_display",
  "boot_device",
  "operating_load",
];

export type StageStatus = "passed" | "failed" | "not_reached";

export interface StageResult {
  stage: StartupStage;
  status: StageStatus;
  /** What the learner would see or hear at this stage, without naming the cause. */
  observation: Localized;
  /** Blocking diagnostics that failed this stage. Empty unless `failed`. */
  diagnostics: PCDiagnostic[];
}

export type StartupOutcome =
  /** The power button has not been pressed. */
  | "idle"
  | "no_power"
  | "no_post"
  /** POST completed but nothing reaches the monitor. */
  | "no_display"
  /** Firmware setup is on screen; no bootable drive was found. Distinct from `no_post`. */
  | "no_boot_device"
  /** Boots, then the modelled load exposes a power or thermal problem. */
  | "load_fault"
  | "operational";

export type ScreenState = "off" | "no_signal" | "firmware_setup" | "no_boot_device" | "operating_system";

export type LightingReason =
  | "lit"
  | "preference_without_rgb"
  | "disabled"
  | "not_connected"
  | "not_powered";

export interface LightingStatus {
  instanceId: InstanceId;
  /** True only when the part has lighting hardware, lighting is enabled, the connection is valid and it has power. */
  lit: boolean;
  reason: LightingReason;
  color: string | null;
  effect: PartLightingState["effect"] | null;
}

export interface StartupResult {
  /** Always "educational": stage logic is a teaching model, not firmware emulation, a benchmark or a physical simulation. */
  model: "educational";
  disclaimer: Localized;
  outcome: StartupOutcome;
  /** Always five entries, in `STARTUP_STAGES` order. */
  stages: StageResult[];
  /** What can be observed. Spinning fans or lit parts are not proof of POST. */
  observable: {
    /** Fans and pumps that turn (they have motor power as soon as the PSU delivers power). */
    spinning: InstanceId[];
    /** One entry per part that has lighting hardware. Parts without hardware never appear. */
    lighting: LightingStatus[];
    screen: ScreenState;
  };
  /** Non-blocking findings: assembly warnings and optional improvements. They never change `outcome`. */
  advisories: PCDiagnostic[];
  /** Figures behind the stage 5 decision, so the rule is inspectable. */
  loadModel: {
    estimatedDrawW: number;
    psuRatedW: number | null;
    cpuHeatW: number | null;
    coolerCapacityW: number | null;
  };
}
