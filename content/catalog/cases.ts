import type { CaseEntry, MountPointSpec } from "@ytl/contracts";
import { FASTENER_NOTE, L, NO_ASSET, fanMounts, frontPanelLeads, source, zone } from "./helpers";

const tray = (formFactors: ("atx" | "micro_atx" | "mini_itx" | "e_atx")[]): MountPointSpec => ({
  id: "motherboard-tray",
  kind: "motherboard_tray",
  formFactors,
  label: L("Motherboard tray", "صينية اللوحة الأم"),
  fastener: { kind: "standoff_screw", count: 9 },
});

const psuBay = (maxLengthMm: number): MountPointSpec => ({
  id: "psu-bay",
  kind: "psu_bay",
  formFactors: ["atx"],
  maxLengthMm,
  label: L("Power supply bay", "حجرة مزوّد الطاقة"),
  fastener: { kind: "case_screw", count: 4 },
});

const driveBays = (count: number, sizes: ("2.5_inch" | "3.5_inch")[], prefix: string, en: string, ar: string): MountPointSpec[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    kind: "drive_bay" as const,
    sizes,
    label: L(`${en} ${i + 1}`, `${ar} ${i + 1}`),
    fastener: { kind: "case_screw" as const, count: 4 },
  }));

const caseZones = [
  zone(
    "front-panel",
    L("Front panel and I/O", "اللوحة الأمامية والمنافذ"),
    L(
      "Air enters here. The power button and the front USB and audio sockets are wired to headers on the motherboard.",
      "الهوا يدخل من هنا. زر التشغيل ومنافذ USB والصوت اللي قدّام موصّلة بمداخل على اللوحة الأم.",
    ),
  ),
  zone(
    "main-chamber",
    L("Main chamber", "الحجرة الرئيسية"),
    L(
      "The motherboard, graphics card and cooler live here. Its depth limits cooler height and its length limits the graphics card.",
      "هنا تنحط اللوحة الأم وكرت الشاشة والمبرّد. عمقها يحدّد أعلى مبرّد يركب، وطولها يحدّد أطول كرت شاشة.",
    ),
  ),
  zone(
    "psu-shroud",
    L("Power supply shroud", "غطا مزوّد الطاقة"),
    L(
      "Covers the power supply and spare cable length at the bottom of the case.",
      "يغطّي مزوّد الطاقة والزايد من الكيبلات تحت في الهيكل.",
    ),
  ),
];

export const cases: CaseEntry[] = [
  {
    id: "corsair-4000d-airflow-black",
    category: "case",
    brand: "Corsair",
    model: "4000D AIRFLOW Tempered Glass Mid-Tower ATX Case — Black",
    partNumber: "CC-9011200-WW",
    generic: false,
    description: L(
      "A mid-tower case with a perforated steel front for airflow. It takes ATX boards, graphics cards up to 360 mm and CPU coolers up to 170 mm, so most parts fit; check the length and height limits before choosing a card or cooler.",
      "هيكل وسط (ميد تاور) واجهته حديد مثقّب عشان الهوا يمشي. ياخذ لوحات ATX، وكروت شاشة لين 360 مم، ومبرّدات معالج لين 170 مم، فأغلب القطع تركب فيه. بس شيّك على حدّ الطول وحدّ الارتفاع قبل ما تختار الكرت أو المبرّد.",
    ),
    sources: [
      source(
        "Corsair",
        "4000D AIRFLOW Tempered Glass Mid-Tower ATX Case — Black (Tech Specs)",
        "https://www.corsair.com/us/en/p/pc-cases/cc-9011200-ww/4000d-airflow-tempered-glass-mid-tower-atx-case-black-cc-9011200-ww",
      ),
    ],
    verification: "partially_verified",
    unverifiedFields: [
      "cables.power-switch (the page lists front USB and audio only; a power button lead is assumed, as on every ATX case)",
      "mountPoints.rad-top (the tech-spec table gives front and rear radiator support only; no top radiator mount is modelled)",
      "mountPoints.drive-*.fastener, mountPoints.*.fastener",
    ],
    teachingNotes: [
      FASTENER_NOTE,
      "The two fitted fans are separate parts (catalog entry corsair-airguide-120-4000d) that arrive mounted at the front positions; they can be taken out like any fan.",
      "A front radiator blocks the three front fan positions in this model.",
    ],
    dimensions: { lengthMm: 453, widthMm: 230, heightMm: 466 },
    formFactor: "Mid-Tower",
    mountPoints: [
      tray(["mini_itx", "micro_atx", "atx", "e_atx"]),
      psuBay(220),
      ...fanMounts("front", 3, [120, 140], "Front", "أمامية"),
      ...fanMounts("top", 2, [120, 140], "Top", "علوية"),
      ...fanMounts("rear", 1, [120], "Rear", "خلفية"),
      {
        id: "rad-front",
        kind: "radiator_mount",
        location: "front",
        radiatorSizesMm: [240, 280, 360],
        label: L("Front radiator position", "مكان الرادياتير الأمامي"),
        fastener: { kind: "radiator_screw", count: 8 },
        blocks: ["fan-front-1", "fan-front-2", "fan-front-3"],
      },
      {
        id: "rad-rear",
        kind: "radiator_mount",
        location: "rear",
        radiatorSizesMm: [120],
        label: L("Rear radiator position", "مكان الرادياتير الخلفي"),
        fastener: { kind: "radiator_screw", count: 4 },
        blocks: ["fan-rear-1"],
      },
      ...driveBays(2, ["2.5_inch"], "drive-25", "2.5-inch SSD tray", "صينية قرص 2.5 بوصة"),
      ...driveBays(2, ["3.5_inch", "2.5_inch"], "drive-35", "3.5-inch drive tray", "صينية قرص 3.5 بوصة"),
    ],
    mounting: [],
    zones: caseZones,
    ports: [],
    cables: [
      ...frontPanelLeads({ reset: false, powerLed: false, driveLed: false, usb3: true, usbC: true, audio: true }),
    ],
    rgb: null,
    asset: NO_ASSET,
    spec: {
      color: "black",
      towerClass: "Mid-Tower",
      sidePanel: "tempered_glass",
      maxGpuLengthMm: 360,
      maxCpuCoolerHeightMm: 170,
      maxPsuLengthMm: 220,
      includedFanCount: 2,
    },
  },
  {
    id: "fractal-north-charcoal-black-mesh",
    category: "case",
    brand: "Fractal Design",
    model: "North Charcoal Black (mesh side panel)",
    partNumber: "FD-C-NOR1C-01",
    generic: false,
    description: L(
      "A mid-tower case with a wooden front and a ventilated mesh side panel. Its limits are tighter than they look: graphics cards up to 355 mm and CPU coolers up to 145 mm, so a tall tower cooler or a very long card will not fit.",
      "هيكل وسط واجهته خشب وغطاه الجانبي شبك يدخّل هوا. حدوده أضيق من اللي يبان: كروت شاشة لين 355 مم ومبرّدات معالج لين 145 مم، فالمبرّد البرجي الطويل أو الكرت الطويل مرة ما يركبون فيه.",
    ),
    sources: [
      source("Fractal Design", "North Charcoal Black — Specifications", "https://www.fractal-design.com/products/cases/north/north/charcoal-black/"),
    ],
    verification: "partially_verified",
    unverifiedFields: [
      "mountPoints.*.fastener",
      "mountPoints.rad-side (side radiator support is listed as '2x 120/140 mm' and is not modelled)",
    ],
    teachingNotes: [
      FASTENER_NOTE,
      "The two fitted front fans are separate parts (catalog entry fractal-aspect-14-pwm-north) that arrive mounted at the front; they can be taken out like any fan.",
      "The page states the GPU limit drops to 300 mm with a 360 mm front radiator; that interaction is not modelled.",
    ],
    dimensions: { lengthMm: 447, widthMm: 215, heightMm: 469 },
    formFactor: "Mid-Tower",
    mountPoints: [
      tray(["atx", "micro_atx", "mini_itx"]),
      psuBay(255),
      ...fanMounts("front", 3, [120, 140], "Front", "أمامية"),
      ...fanMounts("top", 2, [120, 140], "Top", "علوية"),
      ...fanMounts("side", 2, [120, 140], "Side", "جانبية"),
      ...fanMounts("rear", 1, [120], "Rear", "خلفية"),
      {
        id: "rad-front",
        kind: "radiator_mount",
        location: "front",
        radiatorSizesMm: [120, 140, 240, 280, 360],
        label: L("Front radiator position", "مكان الرادياتير الأمامي"),
        fastener: { kind: "radiator_screw", count: 8 },
        blocks: ["fan-front-1", "fan-front-2", "fan-front-3"],
      },
      {
        id: "rad-top",
        kind: "radiator_mount",
        location: "top",
        radiatorSizesMm: [120, 240],
        label: L("Top radiator position", "مكان الرادياتير العلوي"),
        fastener: { kind: "radiator_screw", count: 8 },
        blocks: ["fan-top-1", "fan-top-2"],
      },
      {
        id: "rad-rear",
        kind: "radiator_mount",
        location: "rear",
        radiatorSizesMm: [120],
        label: L("Rear radiator position", "مكان الرادياتير الخلفي"),
        fastener: { kind: "radiator_screw", count: 4 },
        blocks: ["fan-rear-1"],
      },
      ...driveBays(2, ["2.5_inch"], "drive-25", "Dedicated 2.5-inch drive mount", "حامل قرص 2.5 بوصة"),
      ...driveBays(2, ["3.5_inch", "2.5_inch"], "drive-35", "Combined 3.5/2.5-inch drive mount", "حامل قرص 3.5/2.5 بوصة"),
    ],
    mounting: [],
    zones: caseZones,
    ports: [],
    cables: [
      ...frontPanelLeads({ reset: false, powerLed: false, driveLed: false, usb3: true, usbC: true, audio: true }),
    ],
    rgb: null,
    asset: NO_ASSET,
    spec: {
      color: "black",
      towerClass: "Mid-Tower",
      sidePanel: "mesh",
      maxGpuLengthMm: 355,
      maxCpuCoolerHeightMm: 145,
      maxPsuLengthMm: 255,
      includedFanCount: 2,
    },
  },
];
