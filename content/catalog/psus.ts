import type { CableEndSpec, CableSpec, PortSpec, PsuEntry } from "@ytl/contracts";
import { FASTENER_NOTE, L, NO_ASSET, cable, end, port, source, zone } from "./helpers";

const psuZones = [
  zone(
    "rear-switch",
    L("Mains inlet and switch", "مدخل الكهرباء والمفتاح"),
    L(
      "The mains cable plugs in here. The rocker switch must be on (I) before the case power button can start the computer.",
      "كيبل الكهرباء يتوصّل هنا. المفتاح لازم يكون على (I) قبل ما زر الهيكل يشغّل الكمبيوتر.",
    ),
  ),
  zone(
    "cable-side",
    L("Cable side", "جهة الكيبلات"),
    L(
      "Cables leave the unit here. On a modular unit only the manufacturer's cables for this exact cable type belong in these sockets, even when another cable's plug looks the same.",
      "الكيبلات تطلع من هنا. في المزوّد المودولار ما ينحط في هذي المداخل إلا كيبلات الشركة لهذا النوع بالذات، حتى لو راس كيبل ثاني شكله نفسه.",
    ),
  ),
  zone(
    "label",
    L("Rating label", "ملصق القدرة"),
    L(
      "States the rated continuous output in watts. The efficiency certificate describes how little power is wasted as heat; it does not change the rated output.",
      "مكتوب عليه القدرة المتواصلة بالواط. شهادة الكفاءة تقول كم يضيع من الكهرباء حرارة؛ وما تغيّر القدرة المكتوبة.",
    ),
  ),
];

const mounting = [{ role: "main", kind: "psu_bay" as const, label: L("Power supply bay of the case", "حجرة مزوّد الطاقة في الهيكل") }];

// Device-side plugs shared by all three units.
const atxPlug = end("device", "atx_24pin", "atx_main_power", "plug", "device", L("24-pin ATX plug", "راس ATX بـ24 سنّ"));
const epsPlug = end("device", "eps_4plus4pin", "cpu_power", "plug", "device", L("EPS12V 4+4-pin CPU plug", "راس المعالج EPS12V 4+4 سنون"));
const pciePlug = (id = "device") => end(id, "pcie_6plus2pin", "gpu_power", "plug", "device", L("PCIe 6+2-pin plug", "راس PCIe 6+2 سنون"));
const gpu16Plug = end("device", "pcie_12v_2x6", "gpu_power", "plug", "device", L("12V-2x6 (12+4-pin) plug", "راس 12V-2x6 (12+4 سنّ)"));
const sataPlugs = (n: number): CableEndSpec[] =>
  Array.from({ length: n }, (_, i) =>
    end(`sata-${i + 1}`, "sata_power", "sata_power", "plug", "device", L(`SATA power plug ${i + 1}`, `راس طاقة SATA رقم ${i + 1}`)),
  );
const molexPlugs = (n: number): CableEndSpec[] =>
  Array.from({ length: n }, (_, i) =>
    end(`molex-${i + 1}`, "molex_4pin", "peripheral_power", "plug", "device", L(`Peripheral (PATA) 4-pin plug ${i + 1}`, `راس الملحقات (PATA) 4 سنون رقم ${i + 1}`)),
  );

/** PSU-side plug of a modular cable. `keying` is `<family>:<socket class>`. */
const psuSide = (keying: string, id = "psu") =>
  end(id, "psu_modular", "psu_output", "plug", "source", L("Power supply side plug", "الراس من جهة مزوّد الطاقة"), keying);

const sockets = (keying: string, prefix: string, count: number, en: string, ar: string): PortSpec[] =>
  Array.from({ length: count }, (_, i) =>
    port(`${prefix}-${i + 1}`, "psu_modular", "psu_output", L(`${en} socket ${i + 1}`, `مدخل ${ar} رقم ${i + 1}`), "optional", keying),
  );

const SOCKET_NOTE =
  "The number and grouping of modular sockets on the unit are not on the product page. The model gives the unit exactly enough sockets of each class for all supplied cables; socket classes (24-pin, CPU/PCIe, peripheral) are a teaching simplification.";
const TYPE_NOTE =
  "Corsair's cable compatibility page states: 'Type 3 and Type 4 modular PSU cables are not compatible with Type 5 power supplies. Using incorrect PSU cables may damage hardware.' The engine rejects a cable whose family differs from the socket's.";

const T4 = "corsair-type4";
const T5 = "corsair-type5";

const rm850xCables: CableSpec[] = [
  cable("atx24", "atx_main", "modular", L("Modular ATX cable (24-pin), Type 4", "كيبل ATX المعياري (24 سنّ)، النوع 4"), [psuSide(`${T4}:atx24`), atxPlug]),
  cable("eps", "cpu_power", "modular", L("EPS / ATX 12V 8-pin (4+4) cable, Type 4", "كيبل EPS / ATX 12V 8 سنون (4+4)، النوع 4"), [psuSide(`${T4}:cpu-pcie`), epsPlug], 2),
  cable(
    "gpu-12v-2x6",
    "gpu_power",
    "modular",
    L("PCIe 12V-2x6 (12+4-pin) cable, Type 4", "كيبل PCIe 12V-2x6 (12+4 سنّ)، النوع 4"),
    [psuSide(`${T4}:cpu-pcie`, "psu-1"), psuSide(`${T4}:cpu-pcie`, "psu-2"), gpu16Plug],
  ),
  cable("pcie", "gpu_power", "modular", L("PCIe 8-pin (6+2) cable, Type 4", "كيبل PCIe 8 سنون (6+2)، النوع 4"), [psuSide(`${T4}:cpu-pcie`), pciePlug()], 3),
  cable("sata", "sata_power", "modular", L("SATA power cable (4 connectors), Type 4", "كيبل طاقة SATA (4 رؤوس)، النوع 4"), [psuSide(`${T4}:peripheral`), ...sataPlugs(4)], 2),
  cable("peripheral", "peripheral_power", "modular", L("PATA cable (3 connectors), Type 4", "كيبل PATA (3 رؤوس)، النوع 4"), [psuSide(`${T4}:peripheral`), ...molexPlugs(3)]),
];

const shiftCables: CableSpec[] = [
  cable("atx24", "atx_main", "modular", L("ATX motherboard (24-pin) cable, Type 5", "كيبل اللوحة الأم ATX (24 سنّ)، النوع 5"), [psuSide(`${T5}:atx24`), atxPlug]),
  cable("eps", "cpu_power", "modular", L("ATX12V / EPS12V (4+4-pin) cable, Type 5", "كيبل ATX12V / EPS12V (4+4 سنون)، النوع 5"), [psuSide(`${T5}:cpu-pcie`), epsPlug], 2),
  cable("pcie", "gpu_power", "modular", L("8-pin PCIe (6+2-pin) cable, Type 5", "كيبل PCIe 8 سنون (6+2)، النوع 5"), [psuSide(`${T5}:cpu-pcie`), pciePlug()], 2),
  cable(
    "gpu-12v-2x6",
    "gpu_power",
    "modular",
    L("90° 12V-2x6 to 600W 12V-2x6 (12+4-pin) cable, Type 5", "كيبل 12V-2x6 بزاوية 90° إلى 12V-2x6 بقدرة 600 واط، النوع 5"),
    [psuSide(`${T5}:12v-2x6`), gpu16Plug],
  ),
  cable(
    "gpu-2x8",
    "gpu_power",
    "modular",
    L("600W 90° 12V-2x6 to 2x 8-pin PCIe (6+2-pin) cable, Type 5", "كيبل 12V-2x6 بزاوية 90° إلى راسين PCIe 8 سنون (6+2)، النوع 5"),
    [psuSide(`${T5}:12v-2x6`), pciePlug("device-1"), pciePlug("device-2")],
  ),
  cable("sata", "sata_power", "modular", L("SATA power cable (3 connectors), Type 5", "كيبل طاقة SATA (3 رؤوس)، النوع 5"), [psuSide(`${T5}:peripheral`), ...sataPlugs(3)], 3),
  cable("peripheral", "peripheral_power", "modular", L("PATA cable (4 connectors), Type 5", "كيبل PATA (4 رؤوس)، النوع 5"), [psuSide(`${T5}:peripheral`), ...molexPlugs(4)]),
];

export const psus: PsuEntry[] = [
  {
    id: "corsair-rm850x-atx31",
    category: "psu",
    brand: "Corsair",
    model: "RMx Series RM850x Fully Modular Power Supply (ATX 3.1)",
    partNumber: "CP-9020270-NA",
    generic: false,
    description: L(
      "An 850 W fully modular power supply with Corsair Type 4 cables, including a native 12V-2x6 cable for modern graphics cards. Fully modular means every cable is detachable; use only this unit's Type 4 cables in its sockets.",
      "مزوّد طاقة 850 واط، كيبلاته كلها تنفصل (مودولار كامل)، وكيبلاته من نوع Corsair Type 4، ومنها كيبل 12V-2x6 أصلي لكروت الشاشة الجديدة. استخدم في مداخله بس كيبلات Type 4 حقته.",
    ),
    sources: [
      source("Corsair", "RMx Series RM850x Fully Modular Power Supply (Tech Specs, cable table)", "https://www.corsair.com/us/en/p/psu/cp-9020270-na/rmx-series-rm850x-fully-modular-power-supply-cp-9020270-na"),
      source("Corsair", "PSU Cable Compatibility", "https://www.corsair.com/uk/en/s/psu-cable-compatibility"),
    ],
    verification: "partially_verified",
    unverifiedFields: ["ports (modular socket count and grouping)", "mounting fastener count"],
    teachingNotes: [
      FASTENER_NOTE,
      SOCKET_NOTE,
      TYPE_NOTE,
      "The 12V-2x6 cable is modelled with two PSU-side plugs, following the compatibility page's Type 4 cable '2x 8-pin to PCIe 5.1 12V-2x6'.",
    ],
    dimensions: { lengthMm: 160, widthMm: 150, heightMm: 86 },
    formFactor: "ATX",
    mountPoints: [],
    mounting,
    zones: psuZones,
    ports: [
      ...sockets(`${T4}:atx24`, "out-atx", 1, "24-pin ATX", "ATX بـ24 سنّ"),
      ...sockets(`${T4}:cpu-pcie`, "out-cpu-pcie", 7, "CPU/PCIe", "المعالج/PCIe"),
      ...sockets(`${T4}:peripheral`, "out-peripheral", 3, "Peripheral/SATA", "الملحقات/SATA"),
    ],
    cables: rm850xCables,
    rgb: null,
    asset: NO_ASSET,
    spec: { wattageW: 850, efficiency: ["cybenetics_gold"], formFactor: "atx", modularity: "full", atxSpec: "ATX 3.1", cableFamily: T4 },
  },
  {
    id: "corsair-rm850x-shift",
    category: "psu",
    brand: "Corsair",
    model: "RM850x SHIFT Fully Modular ATX Power Supply",
    partNumber: "CP-9020299-NA",
    generic: false,
    description: L(
      "An 850 W fully modular power supply whose sockets face the side panel and take Corsair Type 5 cables. Type 4 cables from other Corsair units look similar but must not be used in it.",
      "مزوّد طاقة 850 واط مودولار كامل، مداخله على الجنب جهة الغطا الجانبي وتاخذ كيبلات Corsair Type 5. كيبلات Type 4 من مزوّدات Corsair الثانية شكلها قريب، بس لا تستخدمها فيه.",
    ),
    sources: [
      source("Corsair", "RM850x SHIFT Fully Modular ATX Power Supply (Tech Specs, cable table)", "https://www.corsair.com/us/en/p/psu/cp-9020299-na/rm850x-shift-fully-modular-atx-power-supply-cp-9020299-na"),
      source("Corsair", "PSU Cable Compatibility", "https://www.corsair.com/uk/en/s/psu-cable-compatibility"),
    ],
    verification: "partially_verified",
    unverifiedFields: ["ports (modular socket count and grouping)", "spec.modularity (the product name says fully modular; the tech-spec table has no 'Modular' row)", "mounting fastener count"],
    teachingNotes: [FASTENER_NOTE, SOCKET_NOTE, TYPE_NOTE],
    dimensions: { lengthMm: 160, widthMm: 150, heightMm: 86 },
    formFactor: "ATX",
    mountPoints: [],
    mounting,
    zones: psuZones,
    ports: [
      ...sockets(`${T5}:atx24`, "out-atx", 1, "24-pin ATX", "ATX بـ24 سنّ"),
      ...sockets(`${T5}:cpu-pcie`, "out-cpu-pcie", 4, "CPU/PCIe", "المعالج/PCIe"),
      ...sockets(`${T5}:12v-2x6`, "out-12v-2x6", 2, "12V-2x6", "12V-2x6"),
      ...sockets(`${T5}:peripheral`, "out-peripheral", 4, "Peripheral/SATA", "الملحقات/SATA"),
    ],
    cables: shiftCables,
    rgb: null,
    asset: NO_ASSET,
    spec: { wattageW: 850, efficiency: ["cybenetics_gold"], formFactor: "atx", modularity: "full", atxSpec: "ATX 3.1", cableFamily: T5 },
  },
  {
    id: "corsair-cx550",
    category: "psu",
    brand: "Corsair",
    model: "CX Series CX550 — 550 Watt 80 PLUS Bronze ATX Power Supply",
    partNumber: "CP-9020277-NA",
    generic: false,
    description: L(
      "A 550 W non-modular power supply: all cables are fixed to the unit. It has one CPU power cable and one PCIe cable with two 6+2-pin plugs, and no 16-pin graphics cable, so it suits modest builds rather than high-power graphics cards.",
      "مزوّد طاقة 550 واط كيبلاته ثابتة فيه وما تنفصل. فيه كيبل طاقة معالج واحد، وكيبل PCIe واحد براسين 6+2 سنون، وما فيه كيبل كرت شاشة 16 سنّ، فهو يناسب التجميعات البسيطة مو كروت الشاشة القوية.",
    ),
    sources: [
      source(
        "Corsair",
        "CX Series CX550 — 550 Watt 80 PLUS Bronze ATX Power Supply (Tech Specs, cable table)",
        "https://www.corsair.com/us/en/p/psu/cp-9020277-na/cx-series-cx550-550-watt-80-plus-bronze-atx-power-supply-cp-9020277-na",
      ),
    ],
    verification: "partially_verified",
    unverifiedFields: ["dimensions.widthMm", "dimensions.heightMm", "mounting fastener count"],
    teachingNotes: [FASTENER_NOTE],
    dimensions: { lengthMm: 125, widthMm: null, heightMm: null },
    formFactor: "ATX",
    mountPoints: [],
    mounting,
    zones: psuZones,
    ports: [],
    cables: [
      cable("atx24", "atx_main", "captive", L("ATX (24-pin) cable", "كيبل ATX (24 سنّ)"), [atxPlug]),
      cable("eps", "cpu_power", "captive", L("EPS / ATX 12V 8-pin (4+4) cable", "كيبل EPS / ATX 12V 8 سنون (4+4)"), [epsPlug]),
      cable("pcie", "gpu_power", "captive", L("PCIe cable with two 8-pin (6+2) plugs", "كيبل PCIe براسين 8 سنون (6+2)"), [pciePlug("device-1"), pciePlug("device-2")]),
      cable("sata", "sata_power", "captive", L("SATA power cable (3 connectors)", "كيبل طاقة SATA (3 رؤوس)"), sataPlugs(3)),
      cable("peripheral", "peripheral_power", "captive", L("PATA cable (2 connectors)", "كيبل PATA (راسين)"), molexPlugs(2)),
    ],
    rgb: null,
    asset: NO_ASSET,
    spec: { wattageW: 550, efficiency: ["80plus_bronze"], formFactor: "atx", modularity: "none", atxSpec: "ATX12V v2.31", cableFamily: null },
  },
];
