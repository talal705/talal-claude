// Entries added for the build planner (2026-11-18): a legacy DDR3 route, an entry board, an RTX 5060,
// a 3.5-inch hard drive, a small and a large case and a 140 mm fan. Every figure below was read from
// the source listed on its entry on 2026-11-18; fields that could not be read are named in
// `unverifiedFields` and are not invented. Boards whose BIOS history was not read carry the single
// version "unrecorded": the engine then treats the CPU as supported, and the planner reports the BIOS
// question as unknown (conditional) instead of guessing a version.
import type { CaseEntry, CoolingEntry, CpuEntry, FanEntry, GpuEntry, MotherboardEntry, MountPointSpec, RamEntry, StorageEntry } from "@ytl/contracts";
import { FASTENER_NOTE, L, NO_ASSET, SLOT_COVERS, boardPorts, dimmSlots, lgaSocketDetail, m2QLatch, pcieSlotDetail, fanLead, fanMounts, frontPanelLeads, port, sataDataCables, source, zone } from "./helpers";

const ON = "2026-11-18";
/** BIOS history not read for this board; see the file comment. */
export const UNRECORDED_BIOS = "unrecorded";
const BIOS_NOTE =
  "The BIOS version history and the first BIOS for each CPU were not read for this board. The engine treats the listed CPUs as supported; the planner reports 'BIOS support not confirmed' as a conditional finding.";

const socket = (s: "lga1150" | "lga1700", name: string): MountPointSpec[] => [
  { id: "cpu-socket", kind: "cpu_socket", socket: s, label: L(`CPU socket (${name})`, `مقبس المعالج (${name})`), fastener: { kind: "socket_lever", count: 1 },
    ...lgaSocketDetail(s === "lga1150" ? "LGA1150 load plate and lever as in the ASUS H81M-K manual E8601 (CPU installation section, not read page by page)." : "LGA1700 load plate and lever (Intel independent loading mechanism); this board's manual was not read for the steps.") },
  { id: "cooler-mount", kind: "cpu_cooler_mount", socket: s, label: L("CPU cooler mounting position", "مكان تثبيت مبرّد المعالج"), fastener: { kind: "cooler_bracket", count: 4 } },
];
const x16 = (gen: number, label: string): MountPointSpec => ({
  id: "pcie-x16-1", kind: "pcie_slot", mechanical: "x16", lanes: 16, pcieGeneration: gen,
  label: L(`${label} x16 slot (graphics card)`, `فتحة ${label} x16 (كرت الشاشة)`), fastener: { kind: "case_screw", count: 2 },
  ...pcieSlotDetail("PCIe slot latch: this board's manual was not read for it, so the latch type is not verified."),
});
const boardZones = (memoryEn: string, memoryAr: string) => [
  zone("cpu-area", L("CPU socket", "مقبس المعالج"), L("The CPU sits here, under the cooler.", "هنا ينحط المعالج، تحت المبرّد.")),
  zone("memory-slots", L("Memory slots", "فتحات الرام"), L(memoryEn, memoryAr)),
  zone("system-panel", L("System panel header", "مدخل لوحة النظام"), L("Pins for the case's power button and lights.", "سنون زر التشغيل ولمبات الهيكل.")),
];

// ---------- Legacy LGA1150 + DDR3 route ----------

export const legacyCpu: CpuEntry = {
  id: "intel-core-i5-4590",
  category: "cpu",
  brand: "Intel",
  model: "Core i5-4590",
  partNumber: null,
  generic: false,
  description: L(
    "A 4-core processor from 2014 for the older LGA1150 socket. It uses DDR3 memory only and has integrated graphics (HD Graphics 4600). It is here to show an older platform: it cannot go in an LGA1700 board, and DDR4 or DDR5 cannot go in its board.",
    "معالج 4 أنوية من 2014 لمقبس LGA1150 القديم. يشتغل مع رام DDR3 بس، وفيه كرت مدمج (HD Graphics 4600). موجود هنا عشان يوضّح منصة قديمة: ما يركب في لوحة LGA1700، ورام DDR4 أو DDR5 ما تركب في لوحته.",
  ),
  sources: [source("Intel", "Intel Core i5-4590 Processor — Specifications", "https://www.intel.com/content/www/us/en/products/sku/80815/intel-core-i54590-processor-6m-cache-up-to-3-70-ghz/specifications.html", ON)],
  verification: "partially_verified",
  unverifiedFields: ["spec.maxPowerW (Intel lists TDP 84 W only; no maximum turbo power is published for this generation)", "spec.coolerIncluded (boxed units shipped with a cooler; the tray CPU modelled here has none)"],
  teachingNotes: ["basePowerW is Intel's TDP (84 W). This older generation has no separate published maximum turbo power figure."],
  dimensions: { lengthMm: 37.5, widthMm: 37.5, heightMm: null },
  formFactor: "FCLGA1150",
  mountPoints: [],
  mounting: [{ role: "main", kind: "cpu_socket", label: L("CPU socket of the motherboard", "مقبس المعالج في اللوحة الأم") }],
  zones: [zone("heat-spreader", L("Heat spreader", "غطا المعالج المعدني"), L("Thermal paste goes between this lid and the cooler.", "المعجون الحراري ينحط بين هذا الغطا والمبرّد."))],
  ports: [],
  cables: [],
  rgb: null,
  asset: NO_ASSET,
  spec: {
    vendor: "intel", socket: "lga1150", family: "Intel Core i5 (4th gen)", cores: 4, threads: 4, integratedGraphics: "Intel HD Graphics 4600",
    basePowerW: 84, maxPowerW: null, memorySupport: [{ generation: "ddr3", maxSpeedMTs: 1600 }], maxMemoryGb: 32, coolerIncluded: false,
  },
};

export const legacyBoard: MotherboardEntry = {
  id: "asus-h81m-k",
  category: "motherboard",
  brand: "ASUS",
  model: "H81M-K",
  partNumber: null,
  generic: false,
  description: L(
    "A small micro-ATX board from 2013 for LGA1150 processors. It has two DDR3 slots, no M.2 slot, four SATA ports, one chassis fan header and a 4-pin CPU power socket. Use it to learn an older platform; it is not a cheaper version of a modern board.",
    "لوحة micro-ATX صغيرة من 2013 لمعالجات LGA1150. فيها فتحتين رام DDR3، وبدون فتحة M.2، وأربع منافذ SATA، ومدخل مروحة هيكل واحد، ومدخل طاقة معالج 4 سنون. استخدمها عشان تتعلّم منصة قديمة؛ هي مو نسخة أرخص من لوحة حديثة.",
  ),
  sources: [
    source("ASUS", "H81M-K — Tech Specs", "https://www.asus.com/Motherboards-Components/Motherboards/Business/H81MK/techspec", ON),
    source("ASUS", "H81M-K User's Manual E8601 (ASUS PDF, copy hosted by Newegg) — layout, connectors, memory configurations", "https://images10.newegg.com/UploadFilesForNewegg/itemintelligence/ASUS/E8601_H81M_K1401382880151.pdf", ON),
  ],
  verification: "partially_verified",
  unverifiedFields: [
    "spec.biosVersions, spec.cpuSupport.sinceBios (not read)",
    "mountPoints.pcie-x16-1.pcieGeneration (the manual does not state it; modelled as 3.0)",
    "ports display outputs (the board has DVI-D and D-Sub, which this lab does not model)",
    "motherboard-tray screws: the manual shows 6 screw holes; the case model uses its own standoff count",
  ],
  teachingNotes: [FASTENER_NOTE, BIOS_NOTE, "The manual lists 1, 2, 4 and 8 GB modules, so maxPerModuleGb is 8.", "The two SATA 3 Gb/s ports are modelled as ordinary SATA ports."],
  dimensions: { lengthMm: 226, widthMm: 175, heightMm: null },
  formFactor: "micro-ATX",
  mountPoints: [...socket("lga1150", "LGA1150"), ...dimmSlots("ddr3", ["a1", "b1"]), x16(3, "PCIe")],
  mounting: [{ role: "main", kind: "motherboard_tray", label: L("Motherboard tray of the case", "صينية اللوحة الأم في الهيكل") }],
  zones: boardZones("Two DDR3 slots, one per channel (DIMM_A1, DIMM_B1). DDR4 and DDR5 modules have the notch elsewhere and do not go in.", "فتحتين DDR3، وحدة لكل قناة (DIMM_A1 و DIMM_B1). رام DDR4 و DDR5 شقّها في مكان ثاني وما تدخل."),
  ports: boardPorts({ eps8: 0, eps4: 1, epsRecommended: 0, chassisFans: 1, argb: 0, rgb: 0, sata: 4, usb2: 2, usbC: false, hdmi: 0, displayPort: 0, cpuOpt: false, pumpHeader: false, usb3: false }),
  cables: [sataDataCables(2)],
  rgb: null,
  asset: NO_ASSET,
  spec: {
    vendorPlatform: "intel", socket: "lga1150", chipset: "Intel H81", formFactor: "micro_atx",
    memory: { generation: "ddr3", moduleType: "udimm", slots: 2, maxTotalGb: 16, maxPerModuleGb: 8, recommendedPopulation: [{ modules: 1, slotIds: ["dimm-a1"] }, { modules: 2, slotIds: ["dimm-a1", "dimm-b1"] }] },
    cpuSupport: [{ cpuId: "intel-core-i5-4590", sinceBios: UNRECORDED_BIOS }],
    biosVersions: [{ version: UNRECORDED_BIOS, releasedOn: null }],
    factoryBiosVersion: UNRECORDED_BIOS,
    biosFlashWithoutCpu: null,
    hasIntegratedDisplayOutputs: true,
    sataPorts: 4,
  },
};

export const legacyRam: RamEntry = {
  id: "corsair-vengeance-lp-ddr3-1600-16gb-kit",
  category: "ram",
  brand: "Corsair",
  model: "Vengeance LP 16GB (2x8GB) DDR3 1600MHz CL10 Memory Kit",
  partNumber: "CML16GX3M2A1600C10",
  generic: false,
  description: L(
    "Two 8 GB DDR3 modules at 1600 MT/s and 1.5 V. DDR3 modules have 240 pins and the notch in a different place from DDR4 (288 pins), so they fit DDR3 slots only.",
    "رامتين DDR3 كل وحدة 8 قيقا، سرعة 1600 MT/s وفولت 1.5. رام DDR3 فيها 240 سنّ وشقّها في مكان غير DDR4 (288 سنّ)، فتدخل في فتحات DDR3 بس.",
  ),
  sources: [source("Corsair", "Vengeance LP CML16GX3M2A1600C10 — product SKU sheet (Corsair document, copy hosted by Megekko)", "https://pdf.megekko.nl/00351170-specs.pdf", ON)],
  verification: "partially_verified",
  unverifiedFields: ["spec.voltageV (1.5 V is printed by retailers; the SKU sheet excerpt read does not show it)", "spec.defaultSpeedMTs", "dimensions"],
  teachingNotes: ["One build instance is one module; the kit has two."],
  dimensions: { lengthMm: null, widthMm: null, heightMm: null },
  formFactor: "DDR3 UDIMM (240-pin)",
  mountPoints: [],
  mounting: [{ role: "main", kind: "dimm_slot", label: L("Memory slot of the motherboard", "فتحة رام في اللوحة الأم") }],
  zones: [zone("notch", L("Key notch", "شقّ التوجيه"), L("Its position marks DDR3; DDR4 and DDR5 slots block it.", "مكانه يميّز DDR3؛ فتحات DDR4 و DDR5 تمنعه."))],
  ports: [],
  cables: [],
  rgb: null,
  asset: NO_ASSET,
  spec: { generation: "ddr3", moduleType: "udimm", modulesInKit: 2, capacityPerModuleGb: 8, kitCapacityGb: 16, ratedSpeedMTs: 1600, defaultSpeedMTs: null, profiles: ["xmp_2"], casLatency: 10, voltageV: 1.5, moduleHeightMm: null },
};

// ---------- Entry LGA1700 board ----------

export const entryBoard: MotherboardEntry = {
  id: "asus-prime-b760m-a-wifi",
  category: "motherboard",
  brand: "ASUS",
  model: "PRIME B760M-A WIFI",
  partNumber: null,
  generic: false,
  description: L(
    "A micro-ATX DDR5 board for the LGA1700 socket with two M.2 slots and four memory slots. It has no AIO_PUMP header: a liquid cooler's pump goes to CPU_OPT. Smaller than ATX, so it fits small cases; size says nothing about speed.",
    "لوحة micro-ATX لرام DDR5 ومقبس LGA1700، فيها فتحتين M.2 وأربع فتحات رام. ما فيها مدخل AIO_PUMP: مضخة التبريد المائي تروح لـ CPU_OPT. أصغر من ATX فتركب في الكيسات الصغيرة؛ والحجم ما له علاقة بالسرعة.",
  ),
  sources: [source("ASUS", "PRIME B760M-A WIFI — Tech Specs", "https://www.asus.com/motherboards-components/motherboards/prime/prime-b760m-a-wifi/techspec/", ON)],
  verification: "partially_verified",
  unverifiedFields: [
    "spec.biosVersions, spec.cpuSupport.sinceBios (not read)",
    "spec.memory.maxPerModuleGb (not stated on the spec page)",
    "spec.memory.recommendedPopulation (manual not read; A2/B2 assumed as on other ASUS boards)",
    "ports: the spec page lists 2 x HDMI and 1 x DisplayPort on the back; one HDMI and the DisplayPort are modelled",
    "ports: the spec page lists 2 x USB 3.2 Gen 1 headers; one is modelled",
  ],
  teachingNotes: [FASTENER_NOTE, BIOS_NOTE, "The second and third x16-size slots run at x4 and x1 from the chipset; only the first is modelled."],
  dimensions: { lengthMm: 244, widthMm: 244, heightMm: null },
  formFactor: "micro-ATX",
  mountPoints: [
    ...socket("lga1700", "LGA1700"),
    ...dimmSlots("ddr5"),
    x16(4, "PCIe 4.0"),
    { id: "m2-1", kind: "m2_slot", lengths: ["m2_2242", "m2_2260", "m2_2280"], interfaces: ["nvme"], pcieGeneration: 4, label: L("M.2_1 slot (PCIe 4.0 x4, CPU)", "فتحة M.2_1 (PCIe 4.0 x4، من المعالج)"), fastener: { kind: "m2_latch", count: 1 }, ...m2QLatch("m2-1", "Q-Latch as in the TUF GAMING Z790-PLUS WIFI manual E21279 p. 2-8 (turn to unlock, insert, press down, turn to lock); other ASUS Q-Latch boards are assumed to work the same way.") },
    { id: "m2-2", kind: "m2_slot", lengths: ["m2_2242", "m2_2260", "m2_2280"], interfaces: ["nvme"], pcieGeneration: 4, label: L("M.2_2 slot (PCIe 4.0 x4, chipset)", "فتحة M.2_2 (PCIe 4.0 x4، من الشيبست)"), fastener: { kind: "m2_latch", count: 1 }, ...m2QLatch("m2-2", "Q-Latch as in the TUF GAMING Z790-PLUS WIFI manual E21279 p. 2-8 (turn to unlock, insert, press down, turn to lock); other ASUS Q-Latch boards are assumed to work the same way.") },
  ],
  mounting: [{ role: "main", kind: "motherboard_tray", label: L("Motherboard tray of the case", "صينية اللوحة الأم في الهيكل") }],
  zones: boardZones("Four DDR5 slots in two channels.", "أربع فتحات DDR5 على قناتين."),
  ports: boardPorts({ eps8: 1, epsRecommended: 0, chassisFans: 2, argb: 3, rgb: 1, sata: 4, usb2: 3, usbC: true, hdmi: 1, displayPort: 1, pumpHeader: false }),
  cables: [sataDataCables(2)],
  rgb: null,
  asset: NO_ASSET,
  spec: {
    vendorPlatform: "intel", socket: "lga1700", chipset: "Intel B760", formFactor: "micro_atx",
    memory: { generation: "ddr5", moduleType: "udimm", slots: 4, maxTotalGb: 192, maxPerModuleGb: null, recommendedPopulation: [{ modules: 1, slotIds: ["dimm-a2"] }, { modules: 2, slotIds: ["dimm-a2", "dimm-b2"] }, { modules: 4, slotIds: ["dimm-a1", "dimm-a2", "dimm-b1", "dimm-b2"] }] },
    cpuSupport: ["intel-core-i5-14600k", "intel-core-i7-14700k", "intel-core-i9-14900k"].map((cpuId) => ({ cpuId, sinceBios: UNRECORDED_BIOS })),
    biosVersions: [{ version: UNRECORDED_BIOS, releasedOn: null }],
    factoryBiosVersion: UNRECORDED_BIOS,
    biosFlashWithoutCpu: null,
    hasIntegratedDisplayOutputs: true,
    sataPorts: 4,
  },
};

// ---------- RTX 5060 ----------

export const rtx5060: GpuEntry = {
  id: "asus-dual-rtx5060-o8g",
  category: "gpu",
  brand: "ASUS",
  model: "Dual GeForce RTX 5060 8GB GDDR7 OC Edition",
  partNumber: "DUAL-RTX5060-O8G",
  generic: false,
  description: L(
    "A two-fan RTX 5060 card, 228 mm long and 2.5 slots thick. It takes one 8-pin PCIe power plug; ASUS recommends a 550 W power supply.",
    "كرت RTX 5060 بمروحتين، طوله 228 مم وسماكته 2.5 فتحة. ياخذ راس طاقة PCIe واحد 8 سنون، و ASUS تنصح بمزوّد 550 واط.",
  ),
  sources: [
    source("ASUS", "ASUS Dual GeForce RTX 5060 8GB GDDR7 OC Edition — Tech Specs", "https://www.asus.com/motherboards-components/graphics-cards/dual/dual-rtx5060-o8g/techspec/", ON),
    source("NVIDIA", "GeForce RTX 5060 Family — specifications (Total Graphics Power 145 W, required system power 550 W)", "https://www.nvidia.com/en-in/geforce/graphics-cards/50-series/rtx-5060-family/", ON),
  ],
  verification: "partially_verified",
  unverifiedFields: ["dimensions axis order (the page lists 228 x 123 x 50 mm without naming the axes)", "mounting fastener count"],
  teachingNotes: [FASTENER_NOTE, "powerDrawW (145 W) is NVIDIA's Total Graphics Power for the RTX 5060 reference specification, not a measurement of this card."],
  dimensions: { lengthMm: 228, widthMm: 123, heightMm: 50 },
  formFactor: "2.5 slot",
  mountPoints: [],
  mounting: [{ role: "main", kind: "pcie_slot", label: L("PCIe x16 slot of the motherboard", "فتحة PCIe x16 في اللوحة الأم") }],
  zones: [zone("power-socket", L("Power socket", "مدخل الطاقة"), L("One 8-pin PCIe plug from the power supply goes here.", "راس PCIe واحد 8 سنون من مزوّد الطاقة ينحط هنا."))],
  ports: [
    port("power-8pin", "pcie_8pin", "gpu_power", L("8-pin PCIe power socket", "مدخل طاقة PCIe 8 سنون"), "required"),
    port("hdmi-1", "hdmi", "display_out", L("HDMI output 1", "مخرج HDMI رقم 1")),
    ...[1, 2, 3].map((i) => port(`dp-${i}`, "displayport", "display_out", L(`DisplayPort output ${i}`, `مخرج DisplayPort رقم ${i}`))),
  ],
  cables: [],
  rgb: null,
  asset: NO_ASSET,
  spec: { chipset: "GeForce RTX 5060", lengthMm: 228, slotThickness: 2.5, recommendedPsuW: 550, powerDrawW: 145, fanCount: 2 },
};

// ---------- 3.5-inch hard drive ----------

export const hdd: StorageEntry = {
  id: "seagate-barracuda-2tb-st2000dm008",
  category: "storage",
  brand: "Seagate",
  model: "BarraCuda 2TB 3.5\" HDD",
  partNumber: "ST2000DM008",
  generic: false,
  description: L(
    "A 2 TB spinning hard drive in the 3.5-inch size with a SATA interface: slower than an SSD but cheap per terabyte. It goes in a 3.5-inch bay and needs SATA data and SATA power cables.",
    "هارديسك دوّار سعته 2 تيرا بمقاس 3.5 بوصة وواجهة SATA: أبطأ من SSD بس أرخص لكل تيرا. يركب في مكان 3.5 بوصة ويحتاج كيبل بيانات SATA وكيبل طاقة SATA.",
  ),
  sources: [source("Seagate", "BarraCuda 3.5 HDD data sheet DS1900.14 (ST2000DM008 column)", "https://www.seagate.com/content/dam/seagate/migrated-assets/www-content/datasheets/pdfs/3-5-barracudaDS1900-14-2007US-en_US.pdf", ON)],
  verification: "verified",
  unverifiedFields: [],
  teachingNotes: ["3.5-inch and 2.5-inch are sizes; SATA is the interface. Both drives use the same SATA cables."],
  dimensions: { lengthMm: 146.99, widthMm: 101.85, heightMm: 20.2 },
  formFactor: "3.5 inch",
  mountPoints: [],
  mounting: [{ role: "main", kind: "drive_bay", label: L("3.5-inch drive bay of the case", "مكان قرص 3.5 بوصة في الهيكل") }],
  zones: [zone("sata-connectors", L("SATA connectors", "موصّلات SATA"), L("The short connector is data, the long one power.", "الموصّل القصير للبيانات والطويل للطاقة."))],
  ports: [
    port("sata-data", "sata_data", "sata_data", L("SATA data connector", "موصّل بيانات SATA"), "required"),
    port("sata-power", "sata_power", "sata_power", L("SATA power connector", "موصّل طاقة SATA"), "required"),
  ],
  cables: [],
  rgb: null,
  asset: NO_ASSET,
  spec: { interface: "sata", formFactor: "3.5_inch", capacityGb: 2000, protocol: "SATA 6 Gb/s, 7200 RPM" },
};

// ---------- Cases ----------

const tray = (formFactors: ("atx" | "micro_atx" | "mini_itx" | "e_atx")[]): MountPointSpec => ({
  id: "motherboard-tray", kind: "motherboard_tray", formFactors, label: L("Motherboard tray", "صينية اللوحة الأم"), fastener: { kind: "standoff_screw", count: 9 }, retention: SLOT_COVERS,
});
const psuBay = (maxLengthMm: number): MountPointSpec => ({
  id: "psu-bay", kind: "psu_bay", formFactors: ["atx"], maxLengthMm, label: L("Power supply bay", "حجرة مزوّد الطاقة"), fastener: { kind: "case_screw", count: 4 },
});
const bays = (count: number, sizes: ("2.5_inch" | "3.5_inch")[], prefix: string, en: string, ar: string): MountPointSpec[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i + 1}`, kind: "drive_bay" as const, sizes, label: L(`${en} ${i + 1}`, `${ar} ${i + 1}`), fastener: { kind: "case_screw" as const, count: 4 } }));
const rad = (id: string, location: "front" | "top" | "rear", sizes: number[], blocks: string[], en: string, ar: string): MountPointSpec => ({
  id, kind: "radiator_mount", location, radiatorSizesMm: sizes, label: L(en, ar), fastener: { kind: "radiator_screw", count: sizes.some((s) => s >= 240) ? 8 : 4 }, blocks,
});
const caseZones = [
  zone("front-panel", L("Front panel", "اللوحة الأمامية"), L("Air enters here; the power button is wired to the board.", "الهوا يدخل من هنا؛ وزر التشغيل موصّل باللوحة.")),
  zone("main-chamber", L("Main chamber", "الحجرة الرئيسية"), L("Its depth limits cooler height and its length limits the graphics card.", "عمقها يحدّد ارتفاع المبرّد وطولها يحدّد طول الكرت.")),
];
const FITTED_FANS_NOTE = (n: string) => `The case ships with ${n}. They are not modelled as parts yet; add case fans from the catalog.`;

export const smallCase: CaseEntry = {
  id: "fractal-pop-mini-air-rgb-black-tg",
  category: "case",
  brand: "Fractal Design",
  model: "Pop Mini Air RGB Black TG Clear Tint",
  partNumber: null,
  generic: false,
  description: L(
    "A small micro-ATX tower. It takes micro-ATX and Mini-ITX boards only (not ATX), radiators up to 240 mm, graphics cards up to 365 mm and coolers up to 170 mm.",
    "كيس صغير micro-ATX. ياخذ لوحات micro-ATX و Mini-ITX بس (مو ATX)، ورادياتير لين 240 مم، وكروت لين 365 مم، ومبرّدات لين 170 مم.",
  ),
  sources: [source("Fractal Design", "Pop Mini Air RGB Black TG Clear Tint — Specifications", "https://www.fractal-design.com/products/cases/pop/pop-mini-air/black-tg-clear-tint/", ON)],
  verification: "partially_verified",
  unverifiedFields: ["cables.power-switch (assumed, as on every ATX-style case)", "cables USB-C (a USB-C module is sold separately; not modelled)", "fastener counts", "radiator positions blocking fan positions (modelled from the shared front/top/rear positions)"],
  teachingNotes: [FASTENER_NOTE, FITTED_FANS_NOTE("three Aspect 12 RGB fans (two front, one rear)")],
  dimensions: { lengthMm: 432, widthMm: 215, heightMm: 393 },
  formFactor: "Micro Tower",
  mountPoints: [
    tray(["mini_itx", "micro_atx"]),
    psuBay(150),
    ...fanMounts("front", 2, [120], "Front", "أمامية"),
    ...fanMounts("top", 2, [120], "Top", "علوية"),
    ...fanMounts("rear", 1, [120], "Rear", "خلفية"),
    rad("rad-front", "front", [120, 240], ["fan-front-1", "fan-front-2"], "Front radiator position", "مكان الرادياتير الأمامي"),
    rad("rad-top", "top", [120, 240], ["fan-top-1", "fan-top-2"], "Top radiator position", "مكان الرادياتير العلوي"),
    rad("rad-rear", "rear", [120], ["fan-rear-1"], "Rear radiator position", "مكان الرادياتير الخلفي"),
    ...bays(2, ["2.5_inch"], "drive-25", "Dedicated 2.5-inch mount", "حامل قرص 2.5 بوصة"),
    ...bays(2, ["3.5_inch", "2.5_inch"], "drive-35", "Combined 3.5/2.5-inch mount", "حامل قرص 3.5/2.5 بوصة"),
  ],
  mounting: [],
  zones: caseZones,
  ports: [],
  cables: [...frontPanelLeads({ reset: false, powerLed: false, driveLed: false, usb3: true, usbC: false, audio: true })],
  rgb: null,
  asset: NO_ASSET,
  spec: { color: "black", towerClass: "Micro Tower", sidePanel: "tempered_glass", maxGpuLengthMm: 365, maxCpuCoolerHeightMm: 170, maxPsuLengthMm: 150, includedFanCount: 0 },
};

export const largeCase: CaseEntry = {
  id: "corsair-7000d-airflow-black",
  category: "case",
  brand: "Corsair",
  model: "7000D AIRFLOW Full-Tower ATX Case — Black",
  partNumber: "CC-9011218-WW",
  generic: false,
  description: L(
    "A full tower: E-ATX, ATX, micro-ATX and Mini-ITX boards, graphics cards up to 450 mm, coolers up to 190 mm and radiators up to 480 mm. Bigger room, same parts: size changes what fits, not how fast the computer is.",
    "كيس فل تاور: ياخذ لوحات E-ATX و ATX و micro-ATX و Mini-ITX، وكروت لين 450 مم، ومبرّدات لين 190 مم، ورادياتير لين 480 مم. مساحة أكبر لنفس القطع: الحجم يغيّر وش يركب، مو سرعة الجهاز.",
  ),
  sources: [
    source("Corsair", "7000D AIRFLOW Full-Tower ATX PC Case — Tech Specs (CC-9011218-WW / CC-9011219-WW)", "https://www.corsair.com/ww/en/p/pc-cases/cc-9011219-ww/7000d-airflow-full-tower-atx-pc-case-white-cc-9011219-ww", ON),
    source("Corsair", "CORSAIR 4000, 5000 and 7000 Series PC Cases — comparison table", "https://www.corsair.com/explorer/diy-builder/cases/corsair-4000-5000-and-7000-series-pc-cases/", ON),
  ],
  verification: "partially_verified",
  unverifiedFields: [
    "fan and radiator positions per location (Corsair lists totals: 12 x 120 mm or 7 x 140 mm fans, radiators 120–480 mm; the split front/top/rear is modelled from a retailer listing)",
    "cables.power-switch (assumed)",
    "fastener counts",
  ],
  teachingNotes: [
    FASTENER_NOTE,
    FITTED_FANS_NOTE("three 140 mm AirGuide fans"),
    "Corsair lists 6 x 3.5-inch and 4 x 2.5-inch drive bays; the model draws 2 of each.",
    "Corsair lists radiators up to 480 mm; the model offers 240/280/360 mm at the front and top, which covers every cooler in this catalog.",
  ],
  dimensions: { lengthMm: 550, widthMm: 248, heightMm: 600 },
  formFactor: "Full-Tower",
  mountPoints: [
    tray(["mini_itx", "micro_atx", "atx", "e_atx"]),
    psuBay(225),
    ...fanMounts("front", 3, [120, 140], "Front", "أمامية"),
    ...fanMounts("top", 3, [120, 140], "Top", "علوية"),
    ...fanMounts("rear", 1, [120, 140], "Rear", "خلفية"),
    rad("rad-front", "front", [240, 280, 360], ["fan-front-1", "fan-front-2", "fan-front-3"], "Front radiator position", "مكان الرادياتير الأمامي"),
    rad("rad-top", "top", [240, 280, 360], ["fan-top-1", "fan-top-2", "fan-top-3"], "Top radiator position", "مكان الرادياتير العلوي"),
    rad("rad-rear", "rear", [120, 140], ["fan-rear-1"], "Rear radiator position", "مكان الرادياتير الخلفي"),
    ...bays(2, ["2.5_inch"], "drive-25", "2.5-inch SSD mount", "حامل قرص 2.5 بوصة"),
    ...bays(2, ["3.5_inch", "2.5_inch"], "drive-35", "3.5-inch drive tray", "صينية قرص 3.5 بوصة"),
  ],
  mounting: [],
  zones: caseZones,
  ports: [],
  cables: [...frontPanelLeads({ reset: true, powerLed: false, driveLed: false, usb3: true, usbC: true, audio: true })],
  rgb: null,
  asset: NO_ASSET,
  spec: { color: "black", towerClass: "Full-Tower", sidePanel: "tempered_glass", maxGpuLengthMm: 450, maxCpuCoolerHeightMm: 190, maxPsuLengthMm: 225, includedFanCount: 0 },
};

// ---------- 140 mm fan ----------

export const fan140: FanEntry = {
  id: "arctic-p14-pwm-pst",
  category: "fan",
  brand: "ARCTIC",
  model: "P14 PWM PST",
  partNumber: "ACFAN00125A",
  generic: false,
  description: L(
    "A 140 mm case fan with a 4-pin PWM lead and no lighting, 200–1700 rpm. A 140 mm fan needs a 140 mm position; a 120 mm-only position does not take it.",
    "مروحة هيكل 140 مم بسلك PWM أبو 4 سنون وبدون إضاءة، من 200 لين 1700 لفّة. المروحة 140 تحتاج مكان 140؛ المكان اللي ياخذ 120 بس ما يركب فيه.",
  ),
  sources: [source("ARCTIC", "P14 PWM PST — General Specifications", "https://www.arctic.de/en/P14-PWM-PST/ACFAN00125A", ON)],
  verification: "verified",
  unverifiedFields: [],
  teachingNotes: ["The page lists '4-pin connector plus 4-pin socket'; the daisy-chain socket is not modelled."],
  dimensions: { lengthMm: 140, widthMm: 140, heightMm: 27 },
  formFactor: "140 mm",
  mountPoints: [],
  mounting: [{ role: "main", kind: "fan_mount", label: L("Fan position of the case", "مكان مروحة في الهيكل") }],
  zones: [zone("frame-arrows", L("Airflow arrows", "أسهم اتجاه الهوا"), L("Arrows on the frame show the airflow direction.", "الأسهم على الإطار تبيّن اتجاه الهوا."))],
  ports: [],
  cables: [fanLead("fan", "fan_4pin_pwm", L("Fan lead (4-pin PWM)", "سلك المروحة (PWM من 4 سنون)"))],
  rgb: null,
  asset: NO_ASSET,
  spec: { sizeMm: 140, thicknessMm: 27, control: "pwm_4pin", maxRpm: 1700 },
};

// ---------- Compact air cooler (fits LGA1150 as well as LGA1700) ----------

export const compactAirCooler: CoolingEntry = {
  id: "arctic-freezer-7-x",
  category: "cooling",
  brand: "ARCTIC",
  model: "Freezer 7 X",
  partNumber: "ACFRE00077A",
  generic: false,
  description: L(
    "A small air cooler, 132.5 mm tall, with one 100 mm fan and pre-applied MX-4 thermal paste. Its brackets cover older Intel sockets (115X, which includes LGA1150) as well as LGA1700 and LGA1851.",
    "مبرّد هوائي صغير، ارتفاعه 132.5 مم، بمروحة 100 مم ومعجون MX-4 محطوط من المصنع. تثبيته يناسب مقابس Intel القديمة (115X ومنها LGA1150) وبعد LGA1700 و LGA1851.",
  ),
  sources: [source("ARCTIC", "Freezer 7 X — General Specifications", "https://www.arctic.de/en/Freezer-7-X/ACFRE00077A", ON)],
  verification: "verified",
  unverifiedFields: [],
  teachingNotes: [FASTENER_NOTE, "coolingCapacityW is null: ARCTIC publishes no wattage rating for this cooler, so the lab does not judge whether it is enough for a given CPU.", "The page lists the pre-applied paste: do not add more on top of it."],
  dimensions: { lengthMm: 74.3, widthMm: 110.5, heightMm: 132.5 },
  formFactor: "Compact tower air cooler",
  mountPoints: [],
  mounting: [{ role: "main", kind: "cpu_cooler_mount", label: L("CPU cooler position on the motherboard", "مكان مبرّد المعالج على اللوحة الأم") }],
  zones: [zone("cold-plate", L("Contact plate with paste", "قاعدة التلامس مع المعجون"), L("The paste is already on the plate; peel the protective cover off just before mounting.", "المعجون محطوط على القاعدة؛ شيل الغطا الواقي قبل التركيب مباشرة."))],
  ports: [],
  cables: [fanLead("fan", "fan_4pin_pwm", L("Cooler fan lead (4-pin PWM)", "سلك مروحة المبرّد (PWM من 4 سنون)"))],
  rgb: null,
  asset: NO_ASSET,
  spec: { type: "air", supportedSockets: ["lga1851", "lga1700", "lga1200", "lga1150", "am5", "am4"], heightMm: 132.5, radiatorSizeMm: null, fanCount: 1, fanSizeMm: 100, coolingCapacityW: null },
};

export const expansionEntries = { cpus: [legacyCpu], motherboards: [entryBoard, legacyBoard], ram: [legacyRam], gpus: [rtx5060], storage: [hdd], cases: [smallCase, largeCase], fans: [fan140], cooling: [compactAirCooler] };
