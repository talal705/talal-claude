import type { StorageEntry } from "@ytl/contracts";
import { L, NO_ASSET, port, source, zone } from "./helpers";

export const storage: StorageEntry[] = [
  {
    id: "samsung-990-pro-1tb",
    category: "storage",
    brand: "Samsung",
    model: "990 PRO PCIe 4.0 NVMe M.2 SSD 1TB",
    partNumber: "MZ-V9P1T0BW",
    generic: false,
    description: L(
      "A 1 TB solid-state drive in the M.2 2280 form factor that uses the NVMe protocol over PCIe. M.2 is the shape, NVMe is how it talks to the computer. It plugs straight into an M.2 slot that supports NVMe and needs no cables.",
      "قرص SSD سعته 1 تيرا بشكل M.2 2280 ويشتغل ببروتوكول NVMe عن طريق PCIe. M.2 هو الشكل، و NVMe هو طريقة كلامه مع الكمبيوتر. يركب مباشرة في فتحة M.2 تدعم NVMe وما يحتاج كيبلات.",
    ),
    sources: [
      source("Samsung", "Samsung 990 PRO NVMe M.2 1TB SSD (MZ-V9P1T0BW) — Specs", "https://www.samsung.com/uk/memory-storage/nvme-ssd/990-pro-1tb-nvme-pcie-gen-4-mz-v9p1t0bw/"),
    ],
    verification: "verified",
    unverifiedFields: [],
    teachingNotes: [],
    dimensions: { lengthMm: 80, widthMm: 22, heightMm: 2.3 },
    formFactor: "M.2 2280",
    mountPoints: [],
    mounting: [{ role: "main", kind: "m2_slot", label: L("M.2 slot of the motherboard", "فتحة M.2 في اللوحة الأم") }],
    zones: [
      zone(
        "connector-edge",
        L("M-key connector edge", "حافة الموصّل بمفتاح M"),
        L(
          "The notched gold edge slides into the M.2 slot at an angle, then the far end is held down by the slot's screw or latch.",
          "الحافة الذهبية اللي فيها الشقّ تدخل في فتحة M.2 بميلان، وبعدين الطرف البعيد يتثبّت ببرغي الفتحة أو مشبكها.",
        ),
      ),
    ],
    ports: [],
    cables: [],
    rgb: null,
    asset: NO_ASSET,
    spec: { interface: "nvme", formFactor: "m2_2280", capacityGb: 1000, protocol: "PCIe Gen 4.0 x4, NVMe 2.0" },
  },
  {
    id: "samsung-870-evo-1tb",
    category: "storage",
    brand: "Samsung",
    model: "870 EVO SATA 2.5\" SSD 1TB",
    partNumber: "MZ-77E1T0B/EU",
    generic: false,
    description: L(
      "A 1 TB solid-state drive in the 2.5-inch form factor with a SATA interface. It mounts in a drive bay and needs two cables: SATA data to the motherboard and SATA power from the power supply.",
      "قرص SSD سعته 1 تيرا بمقاس 2.5 بوصة وواجهته SATA. يركب في مكان الأقراص ويحتاج كيبلين: بيانات SATA للوحة الأم، وطاقة SATA من مزوّد الطاقة.",
    ),
    sources: [
      source("Samsung", "870 EVO SATA 2.5\" SSD 1TB (MZ-77E1T0B/EU) — Specs", "https://www.samsung.com/uk/memory-storage/sata-ssd/870-evo-1tb-sata-3-2-5-ssd-mz-77e1t0b-eu/"),
    ],
    verification: "verified",
    unverifiedFields: [],
    teachingNotes: [],
    dimensions: { lengthMm: 100, widthMm: 69.85, heightMm: 6.8 },
    formFactor: "2.5 inch",
    mountPoints: [],
    mounting: [{ role: "main", kind: "drive_bay", label: L("2.5-inch drive bay of the case", "مكان قرص 2.5 بوصة في الهيكل") }],
    zones: [
      zone(
        "sata-connectors",
        L("SATA connectors", "موصّلات SATA"),
        L(
          "Two L-shaped connectors side by side: the short one carries data, the long one carries power. Each accepts only its own cable.",
          "موصّلين على شكل حرف L جنب بعض: القصير للبيانات والطويل للطاقة. كل واحد ياخذ كيبله بس.",
        ),
      ),
    ],
    ports: [
      port("sata-data", "sata_data", "sata_data", L("SATA data connector", "موصّل بيانات SATA"), "required"),
      port("sata-power", "sata_power", "sata_power", L("SATA power connector", "موصّل طاقة SATA"), "required"),
    ],
    cables: [],
    rgb: null,
    asset: NO_ASSET,
    spec: { interface: "sata", formFactor: "2.5_inch", capacityGb: 1000, protocol: "SATA 6 Gb/s" },
  },
];
