import type { CableSpec, GpuEntry, PortSpec } from "@ytl/contracts";
import { FASTENER_NOTE, L, NO_ASSET, cable, end, port, source, zone } from "./helpers";

const gpuZones = [
  zone(
    "power-socket",
    L("Power socket", "مدخل الطاقة"),
    L(
      "The slot alone cannot power this card. Without the correct cable from the power supply here the card does not start.",
      "الفتحة لحالها ما تكفي تغذّي هذا الكرت. بدون الكيبل الصح من مزوّد الطاقة هنا، الكرت ما يشتغل.",
    ),
  ),
  zone(
    "display-outputs",
    L("Display outputs", "مخارج العرض"),
    L(
      "The card's HDMI and DisplayPort outputs, on its bracket. This lab connects no monitor, so they stay empty.",
      "مخارج HDMI و DisplayPort حق الكرت، على الحامل حقه. هذا المختبر ما يوصّل شاشة، فتبقى فاضية.",
    ),
  ),
  zone(
    "slot-edge",
    L("Slot connector and bracket", "موصّل الفتحة والحامل"),
    L(
      "The gold edge goes into the PCIe x16 slot until the slot latch closes; the metal bracket is then screwed to the case.",
      "الحافة الذهبية تدخل في فتحة PCIe x16 لين يتسكّر مشبك الفتحة؛ وبعدين الحامل المعدني ينربط بالهيكل ببراغي.",
    ),
  ),
];

const mounting = [{ role: "main", kind: "pcie_slot" as const, label: L("PCIe x16 slot of the motherboard", "فتحة PCIe x16 في اللوحة الأم") }];

const hdmiOut = (n: number): PortSpec[] =>
  Array.from({ length: n }, (_, i) => port(`hdmi-${i + 1}`, "hdmi", "display_out", L(`HDMI output ${i + 1}`, `مخرج HDMI رقم ${i + 1}`)));
const dpOut = (n: number): PortSpec[] =>
  Array.from({ length: n }, (_, i) => port(`dp-${i + 1}`, "displayport", "display_out", L(`DisplayPort output ${i + 1}`, `مخرج DisplayPort رقم ${i + 1}`)));

const power16 = port("power-16pin", "pcie_12vhpwr", "gpu_power", L("16-pin power socket", "مدخل الطاقة 16 سنّ"), "required");

/** Adapter supplied in the box: 16-pin plug for the card, 8-pin sockets that take PCIe plugs from the power supply. */
const adapter = (inputs: number): CableSpec =>
  cable(
    "adapter-16pin",
    "gpu_power_adapter",
    "loose",
    L(`Supplied adapter cable: 16-pin to ${inputs} x 8-pin`, `كيبل المحوّل المرفق: 16 سنّ إلى ${inputs} × 8 سنون`),
    [
      end("device", "pcie_12vhpwr", "gpu_power", "plug", "device", L("16-pin plug (to the card)", "راس 16 سنّ (إلى البطاقة)")),
      ...Array.from({ length: inputs }, (_, i) =>
        end(
          `in-${i + 1}`,
          "pcie_8pin",
          "gpu_power",
          "receptacle",
          "source",
          L(`8-pin input ${i + 1} (from the power supply)`, `مدخل 8 سنون رقم ${i + 1} (من مزوّد الطاقة)`),
        ),
      ),
    ],
  );

const CONNECTOR_NOTE =
  "ASUS lists the power connector as '1 x 16-pin' without naming the revision; it is modelled as 12VHPWR, which mates with 12V-2x6 cables.";
const POWER_NOTE = (w: number, chip: string) =>
  `powerDrawW (${w} W) is NVIDIA's 'Total Graphics Power' for the ${chip} reference specification, not a measurement of this board-partner card.`;

export const gpus: GpuEntry[] = [
  {
    id: "asus-dual-rtx4060-o8g",
    category: "gpu",
    brand: "ASUS",
    model: "Dual GeForce RTX 4060 OC Edition 8GB GDDR6",
    partNumber: "DUAL-RTX4060-O8G",
    generic: false,
    description: L(
      "A compact two-fan RTX 4060 card, 227.2 mm long, with no lighting. It takes one 8-pin PCIe power plug and ASUS recommends a 550 W power supply for a system built around it.",
      "كرت RTX 4060 صغير بمروحتين، طوله 227.2 مم، وبدون إضاءة. ياخذ راس طاقة PCIe واحد 8 سنون، و ASUS تنصح بمزوّد طاقة 550 واط للنظام اللي ينبني عليه.",
    ),
    sources: [
      source("ASUS", "ASUS Dual GeForce RTX 4060 OC Edition 8GB GDDR6 — Tech Specs", "https://www.asus.com/us/motherboards-components/graphics-cards/dual/dual-rtx4060-o8g/techspec/"),
      source("ASUS", "ASUS Dual GeForce RTX 4060 OC Edition 8GB GDDR6 — product page ('two powerful Axial-tech fans')", "https://www.asus.com/us/motherboards-components/graphics-cards/dual/dual-rtx4060-o8g/", "2026-10-12"),
      source("NVIDIA", "GeForce RTX 4060 Family — specifications (Total Graphics Power)", "https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4060-4060ti/"),
    ],
    verification: "partially_verified",
    unverifiedFields: ["ports (the fetched page lists one HDMI output; DisplayPort outputs are not listed there and are not modelled)", "mounting fastener count"],
    teachingNotes: [FASTENER_NOTE, POWER_NOTE(115, "RTX 4060")],
    dimensions: { lengthMm: 227.2, widthMm: 123.24, heightMm: 49.6 },
    formFactor: "2.5 slot",
    mountPoints: [],
    mounting,
    zones: gpuZones,
    ports: [port("power-8pin", "pcie_8pin", "gpu_power", L("8-pin PCIe power socket", "مدخل طاقة PCIe 8 سنون"), "required"), ...hdmiOut(1)],
    cables: [],
    rgb: null,
    asset: NO_ASSET,
    spec: { chipset: "GeForce RTX 4060", lengthMm: 227.2, slotThickness: 2.5, recommendedPsuW: 550, powerDrawW: 115, fanCount: 2 },
  },
  {
    id: "asus-tuf-rtx4070tis-o16g-gaming",
    category: "gpu",
    brand: "ASUS",
    model: "TUF Gaming GeForce RTX 4070 Ti SUPER 16GB GDDR6X OC Edition",
    partNumber: "TUF-RTX4070TIS-O16G-GAMING",
    generic: false,
    description: L(
      "A large three-fan RTX 4070 Ti SUPER card, 305 mm long and 3.25 slots thick, with addressable lighting. It uses one 16-pin power socket; a 1-to-2 adapter for two 8-pin PCIe plugs is in the box. ASUS recommends a 750 W power supply.",
      "كرت RTX 4070 Ti SUPER كبير بثلاث مراوح، طوله 305 مم وسماكته 3.25 فتحة، وفيه إضاءة قابلة للعنونة. له مدخل طاقة واحد 16 سنّ؛ وفي الكرتون محوّل من واحد لاثنين لراسين PCIe 8 سنون. ASUS تنصح بمزوّد طاقة 750 واط.",
    ),
    sources: [
      source(
        "ASUS",
        "ASUS TUF Gaming GeForce RTX 4070 Ti SUPER 16GB GDDR6X OC Edition — Tech Specs",
        "https://www.asus.com/us/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx4070tis-o16g-gaming/techspec/",
      ),
      source("ASUS", "ASUS TUF Gaming GeForce RTX 4070 Ti SUPER 16GB GDDR6X OC Edition — product page ('the three Axial-tech fans')", "https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx4070tis-o16g-gaming/", "2026-10-12"),
      source("NVIDIA", "GeForce RTX 4070 Family — specifications (Total Graphics Power)", "https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4070-family/"),
    ],
    verification: "partially_verified",
    unverifiedFields: ["ports (the fetched page lists two HDMI outputs; DisplayPort outputs are not listed there and are not modelled)", "mounting fastener count"],
    teachingNotes: [FASTENER_NOTE, CONNECTOR_NOTE, POWER_NOTE(285, "RTX 4070 Ti SUPER")],
    dimensions: { lengthMm: 305, widthMm: 138, heightMm: 65 },
    formFactor: "3.25 slot",
    mountPoints: [],
    mounting,
    zones: gpuZones,
    ports: [power16, ...hdmiOut(2)],
    cables: [adapter(2)],
    rgb: { control: "integrated", zones: ["shroud-logo"], addressable: true },
    asset: NO_ASSET,
    spec: { chipset: "GeForce RTX 4070 Ti SUPER", lengthMm: 305, slotThickness: 3.25, recommendedPsuW: 750, powerDrawW: 285, fanCount: 3 },
  },
  {
    id: "asus-rog-strix-rtx4090-o24g-gaming",
    category: "gpu",
    brand: "ASUS",
    model: "ROG Strix GeForce RTX 4090 OC Edition 24GB GDDR6X",
    partNumber: "ROG-STRIX-RTX4090-O24G-GAMING",
    generic: false,
    description: L(
      "A very large RTX 4090 card: 357.6 mm long and 3.5 slots thick, with addressable lighting. Its length rules out cases with a shorter graphics card limit, and ASUS recommends a 1000 W power supply. It uses one 16-pin power socket; an adapter cable is in the box.",
      "كرت RTX 4090 كبير مرة: طوله 357.6 مم وسماكته 3.5 فتحة، وفيه إضاءة قابلة للعنونة. طوله يستبعد الهياكل اللي حدّ كرت الشاشة فيها أقصر، و ASUS تنصح بمزوّد طاقة 1000 واط. له مدخل طاقة واحد 16 سنّ؛ وفي الكرتون كيبل محوّل.",
    ),
    sources: [
      source(
        "ASUS",
        "ROG Strix GeForce RTX 4090 OC Edition 24GB GDDR6X — Tech Specs",
        "https://rog.asus.com/graphics-cards/graphics-cards/rog-strix/rog-strix-rtx4090-o24g-gaming-model/spec/",
      ),
      source("ASUS", "ROG Strix GeForce RTX 4090 OC Edition 24GB GDDR6X — product page ('the three Axial-tech fans')", "https://rog.asus.com/graphics-cards/graphics-cards/rog-strix/rog-strix-rtx4090-o24g-gaming-model/", "2026-10-12"),
      source("NVIDIA", "GeForce RTX 4090 — specifications (Total Graphics Power, supplementary power connectors)", "https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/"),
    ],
    verification: "partially_verified",
    unverifiedFields: [
      "cables.adapter-16pin (ASUS lists '1 x Adapter Cable' without the input count; three 8-pin inputs follow NVIDIA's RTX 4090 page: '3x PCIe 8-pin cables (adapter in box)')",
      "mounting fastener count",
    ],
    teachingNotes: [FASTENER_NOTE, CONNECTOR_NOTE, POWER_NOTE(450, "RTX 4090")],
    dimensions: { lengthMm: 357.6, widthMm: 149.3, heightMm: 70.1 },
    formFactor: "3.5 slot",
    mountPoints: [],
    mounting,
    zones: gpuZones,
    ports: [power16, ...hdmiOut(2), ...dpOut(3)],
    cables: [adapter(3)],
    rgb: { control: "integrated", zones: ["shroud", "backplate-logo"], addressable: true },
    asset: NO_ASSET,
    spec: { chipset: "GeForce RTX 4090", lengthMm: 357.6, slotThickness: 3.5, recommendedPsuW: 1000, powerDrawW: 450, fanCount: 3 },
  },
  {
    id: "asus-dual-rtx3060-o12g-v2",
    category: "gpu",
    brand: "ASUS",
    model: "Dual GeForce RTX 3060 V2 OC Edition 12GB GDDR6",
    partNumber: "DUAL-RTX3060-O12G-V2",
    generic: false,
    description: L(
      "A two-fan RTX 3060 card, 200 mm long and two slots thick, with no lighting. It takes one 8-pin PCIe power plug, and ASUS recommends a 650 W power supply for a system built around it.",
      "كرت RTX 3060 بمروحتين، طوله 200 مم وسماكته فتحتين، وبدون إضاءة. ياخذ راس طاقة PCIe واحد 8 سنون، و ASUS تنصح بمزوّد طاقة 650 واط للنظام اللي ينبني عليه.",
    ),
    sources: [
      source("ASUS", "Dual GeForce RTX 3060 V2 OC Edition — Tech Specs", "https://www.asus.com/motherboards-components/graphics-cards/dual/dual-rtx3060-o12g-v2/techspec/", "2026-10-15"),
      source("ASUS", "Dual GeForce RTX 3060 V2 OC Edition — product page ('two Axial-tech fans')", "https://www.asus.com/motherboards-components/graphics-cards/dual/dual-rtx3060-o12g-v2/", "2026-10-15"),
      source("NVIDIA", "GeForce RTX 3060 Family — specifications (Graphics Card Power)", "https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3060-3060ti/", "2026-10-15"),
    ],
    verification: "partially_verified",
    unverifiedFields: ["mounting fastener count"],
    teachingNotes: [FASTENER_NOTE, "powerDrawW (170 W) is NVIDIA's 'Graphics Card Power' for the RTX 3060 reference specification, not a measurement of this board-partner card."],
    dimensions: { lengthMm: 200, widthMm: 123, heightMm: 38 },
    formFactor: "2 slot",
    mountPoints: [],
    mounting,
    zones: gpuZones,
    ports: [port("power-8pin", "pcie_8pin", "gpu_power", L("8-pin PCIe power socket", "مدخل طاقة PCIe 8 سنون"), "required"), ...hdmiOut(1), ...dpOut(3)],
    cables: [],
    rgb: null,
    asset: NO_ASSET,
    spec: { chipset: "GeForce RTX 3060", lengthMm: 200, slotThickness: 2, recommendedPsuW: 650, powerDrawW: 170, fanCount: 2 },
  },
  {
    id: "asus-tuf-rtx5090-o32g-gaming",
    category: "gpu",
    brand: "ASUS",
    model: "TUF Gaming GeForce RTX 5090 32GB GDDR7 OC Edition",
    partNumber: "TUF-RTX5090-O32G-GAMING",
    generic: false,
    description: L(
      "An RTX 5090 card with three fans, 348 mm long and 3.6 slots thick, with addressable lighting. NVIDIA rates the RTX 5090 at 575 W on its own, and ASUS recommends a 1000 W power supply. It has one 16-pin power socket; the adapter in the box takes four 8-pin PCIe plugs.",
      "كرت RTX 5090 بثلاث مراوح، طوله 348 مم وسماكته 3.6 فتحة، وفيه إضاءة قابلة للعنونة. NVIDIA تقدّر طاقة RTX 5090 لحاله بـ 575 واط، و ASUS تنصح بمزوّد طاقة 1000 واط. له مدخل طاقة واحد 16 سنّ؛ والمحوّل اللي في الكرتون ياخذ أربع رؤوس PCIe 8 سنون.",
    ),
    sources: [
      source("ASUS", "ASUS TUF Gaming GeForce RTX 5090 32GB GDDR7 OC Edition — Tech Specs", "https://www.asus.com/us/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5090-o32g-gaming/techspec/", "2026-10-15"),
      source("ASUS", "ASUS TUF Gaming GeForce RTX 5090 32GB GDDR7 OC Edition — product page ('All three fans stop...')", "https://www.asus.com/us/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx5090-o32g-gaming/", "2026-10-15"),
      source("NVIDIA", "GeForce RTX 5090 — specifications (Total Graphics Power, supplementary power connectors)", "https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/", "2026-10-15"),
    ],
    verification: "partially_verified",
    unverifiedFields: ["mounting fastener count"],
    teachingNotes: [FASTENER_NOTE, CONNECTOR_NOTE, POWER_NOTE(575, "RTX 5090")],
    dimensions: { lengthMm: 348, widthMm: 146, heightMm: 72 },
    formFactor: "3.6 slot",
    mountPoints: [],
    mounting,
    zones: gpuZones,
    ports: [power16, ...hdmiOut(2), ...dpOut(3)],
    cables: [adapter(4)],
    rgb: { control: "integrated", zones: ["shroud"], addressable: true },
    asset: NO_ASSET,
    spec: { chipset: "GeForce RTX 5090", lengthMm: 348, slotThickness: 3.6, recommendedPsuW: 1000, powerDrawW: 575, fanCount: 3 },
  },
];
