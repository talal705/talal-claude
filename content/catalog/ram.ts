import type { RamEntry } from "@ytl/contracts";
import { L, NO_ASSET, source, zone } from "./helpers";

const ramZones = [
  zone(
    "notch",
    L("Key notch", "شقّ التوجيه"),
    L(
      "The gap in the row of contacts. Its position is different for DDR4 and DDR5, which is what stops a module entering a slot of the other generation.",
      "الفراغ اللي في صف نقاط التلامس. مكانه يختلف بين DDR4 و DDR5، وهذا اللي يمنع الرام تدخل في فتحة الجيل الثاني.",
    ),
  ),
  zone(
    "edge-ends",
    L("Module ends", "أطراف الرام"),
    L(
      "The slot's latches grip these ends. If one end is not pushed down until its latch clicks, the module is only partly seated.",
      "مشابك الفتحة تمسك هذي الأطراف. لو طرف ما انضغط لين يطقّ مشبكه، الرام تكون مو داخلة لين الآخر.",
    ),
  ),
];

const mounting = [{ role: "main", kind: "dimm_slot" as const, label: L("Memory slot of the motherboard", "فتحة رام في اللوحة الأم") }];

export const ram: RamEntry[] = [
  {
    id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit",
    category: "ram",
    brand: "Corsair",
    model: "VENGEANCE RGB 32GB (2x16GB) DDR5 DRAM 6000MT/s CL36 Memory Kit — Black",
    partNumber: "CMH32GX5M2B6000C36",
    generic: false,
    description: L(
      "A kit of two 16 GB DDR5 modules with a lit bar along the top. 6000 MT/s is reached only after enabling its XMP profile in the BIOS; without it the modules run at their default 4800 MT/s. The lighting is powered through the memory slot and needs no cable.",
      "طقم رامتين DDR5، كل وحدة 16 قيقا، وفوقها شريط إضاءة. سرعة 6000 MT/s ما توصل لها إلا لما تفعّل بروفايل XMP من البايوس؛ وبدونه الرامات تشتغل على السرعة الافتراضية 4800 MT/s. الإضاءة تاخذ كهرباءها من فتحة الرام وما تحتاج كيبل.",
    ),
    sources: [
      source(
        "Corsair",
        "VENGEANCE RGB 32GB (2x16GB) DDR5 DRAM 6000MT/s CL36 Memory Kit — Black (Tech Specs)",
        "https://www.corsair.com/us/en/p/memory/cmh32gx5m2b6000c36/vengeance-rgb-32gb-2x16gb-ddr5-dram-6000mt-s-cl36-memory-kit-black-cmh32gx5m2b6000c36",
      ),
    ],
    verification: "partially_verified",
    unverifiedFields: [
      "dimensions",
      "spec.moduleHeightMm",
      "spec.profiles (the tech-spec table says 'Performance Profile: Intel XMP' without a version; 'xmp_3' comes from the page's feature heading 'CUSTOM INTEL XMP 3.0 PROFILES', which the lead's re-check did not see)",
    ],
    teachingNotes: ["One build instance is one module; add two instances for this kit."],
    dimensions: { lengthMm: null, widthMm: null, heightMm: null },
    formFactor: "DDR5 UDIMM (288-pin)",
    mountPoints: [],
    mounting,
    zones: ramZones,
    ports: [],
    cables: [],
    rgb: { control: "integrated", zones: ["light-bar"], addressable: true },
    asset: NO_ASSET,
    spec: {
      generation: "ddr5",
      moduleType: "udimm",
      modulesInKit: 2,
      capacityPerModuleGb: 16,
      kitCapacityGb: 32,
      ratedSpeedMTs: 6000,
      defaultSpeedMTs: 4800,
      profiles: ["xmp_3"],
      casLatency: 36,
      voltageV: 1.25,
      moduleHeightMm: null,
    },
  },
  {
    id: "corsair-vengeance-lpx-ddr4-3600-16gb-kit",
    category: "ram",
    brand: "Corsair",
    model: "VENGEANCE LPX 16GB (2 x 8GB) DDR4 DRAM 3600MHz C18 Memory Kit — Black",
    partNumber: "CMK16GX4M2D3600C18",
    generic: false,
    description: L(
      "A kit of two 8 GB DDR4 modules with a low heat spreader and no lighting. 3600 MT/s needs its XMP 2.0 profile enabled; the default without it is 2133 MT/s. It fits DDR4 slots only.",
      "طقم رامتين DDR4، كل وحدة 8 قيقا، بمشتّت واطي وبدون إضاءة. سرعة 3600 MT/s تحتاج تفعيل بروفايل XMP 2.0؛ وبدونه الافتراضي 2133 MT/s. تدخل في فتحات DDR4 بس.",
    ),
    sources: [
      source(
        "Corsair",
        "VENGEANCE LPX 16GB (2 x 8GB) DDR4 DRAM 3600MHz C18 Memory Kit — Black (Tech Specs)",
        "https://www.corsair.com/us/en/p/memory/cmk16gx4m2d3600c18/vengeancea-lpx-16gb-2-x-8gb-ddr4-dram-3600mhz-c18-memory-kit-black-cmk16gx4m2d3600c18",
      ),
    ],
    verification: "partially_verified",
    unverifiedFields: ["dimensions", "spec.moduleHeightMm"],
    teachingNotes: ["One build instance is one module; add two instances for this kit."],
    dimensions: { lengthMm: null, widthMm: null, heightMm: null },
    formFactor: "DDR4 UDIMM (288-pin)",
    mountPoints: [],
    mounting,
    zones: ramZones,
    ports: [],
    cables: [],
    rgb: null,
    asset: NO_ASSET,
    spec: {
      generation: "ddr4",
      moduleType: "udimm",
      modulesInKit: 2,
      capacityPerModuleGb: 8,
      kitCapacityGb: 16,
      ratedSpeedMTs: 3600,
      defaultSpeedMTs: 2133,
      profiles: ["xmp_2"],
      casLatency: 18,
      voltageV: 1.35,
      moduleHeightMm: null,
    },
  },
];
