import type { CoolingEntry } from "@ytl/contracts";
import { FASTENER_NOTE, L, NO_ASSET, argbLead, cable, end, fanLead, source, zone } from "./helpers";

const CAPACITY_NOTE =
  "coolingCapacityW is null: the fetched page publishes no wattage rating, and no figure is invented for a real product. The load stage therefore checks that this cooler is fitted, fastened and running, but does not judge whether it is adequate for a given CPU.";

const baseZone = zone(
  "cold-plate",
  L("Contact plate", "قاعدة التلامس"),
  L(
    "The flat metal face that presses on the CPU. It needs thermal paste and even mounting pressure to carry heat away.",
    "الوجه المعدني المسطّح اللي يضغط على المعالج. يحتاج معجون حراري وضغط تثبيت متساوي عشان يسحب الحرارة.",
  ),
);

export const cooling: CoolingEntry[] = [
  {
    id: "arctic-freezer-36",
    category: "cooling",
    brand: "ARCTIC",
    model: "Freezer 36 (Black)",
    partNumber: "ACFRE00123A",
    generic: false,
    description: L(
      "A tower air cooler with four heat pipes and two 120 mm fans, 159 mm tall. It mounts on LGA1700, LGA1851, AM4 and AM5. Its height is the thing to check: it does not fit a case whose cooler limit is lower than 159 mm.",
      "مبرّد هوائي برجي بأربع أنابيب حرارية ومروحتين 120 مم، وارتفاعه 159 مم. يركب على LGA1700 و LGA1851 و AM4 و AM5. ارتفاعه هو اللي لازم تشيّك عليه: ما يركب في هيكل حدّ المبرّد فيه أقل من 159 مم.",
    ),
    sources: [
      source("ARCTIC", "Freezer 36 (Black) — General Specifications", "https://www.arctic.de/en/Freezer-36-Black/ACFRE00123A"),
      source("ARCTIC", "Freezer 36 spec sheet (PDF, SKU ACFRE00123A listed)", "https://www.arctic.de/media/6b/50/57/1709195123/Spec_Sheet_Freezer_36_EN.pdf", "2026-10-11"),
    ],
    verification: "verified",
    unverifiedFields: [],
    teachingNotes: [
      FASTENER_NOTE,
      CAPACITY_NOTE,
      "The two fans share one lead ('4-Pin PWM-Connector + 4-Pin Plug' on the page); it is modelled as a single 4-pin plug.",
    ],
    dimensions: { lengthMm: 104, widthMm: 126, heightMm: 159 },
    formFactor: "Tower air cooler",
    mountPoints: [],
    mounting: [{ role: "main", kind: "cpu_cooler_mount", label: L("CPU cooler position on the motherboard", "مكان مبرّد المعالج على اللوحة الأم") }],
    zones: [
      baseZone,
      zone(
        "fin-stack",
        L("Fin stack and fans", "الزعانف والمراوح"),
        L(
          "Heat pipes carry heat up into the fins; the two fans push air through them. The fans must be connected or the fins cannot shed the heat.",
          "الأنابيب الحرارية تنقل الحرارة للزعانف؛ والمروحتين يدفعون الهوا فيها. لازم المراوح تتوصّل، وإلا الزعانف ما تقدر تتخلص من الحرارة.",
        ),
      ),
    ],
    ports: [],
    cables: [fanLead("fan", "fan_4pin_pwm", L("Cooler fan lead (4-pin PWM)", "سلك مروحة المبرّد (PWM من 4 سنون)"))],
    rgb: null,
    asset: NO_ASSET,
    spec: {
      type: "air",
      supportedSockets: ["lga1851", "lga1700", "am5", "am4"],
      heightMm: 159,
      radiatorSizeMm: null,
      fanCount: 2,
      fanSizeMm: 120,
      coolingCapacityW: null,
    },
  },
  {
    id: "arctic-liquid-freezer-iii-240-argb",
    category: "cooling",
    brand: "ARCTIC",
    model: "Liquid Freezer III 240 A-RGB (Black)",
    partNumber: "ACFRE00142A",
    generic: false,
    description: L(
      "An all-in-one liquid cooler: a pump block on the CPU, two hoses and a 240 mm radiator with two lit 120 mm fans already fitted. The block goes on the CPU and the radiator needs a 240 mm radiator position in the case. One 4-pin lead runs the pump and fans; a separate 3-pin 5 V lead runs the lighting.",
      "مبرّد مائي جاهز: بلوك المضخة على المعالج، وليّين، ورادياتير 240 مم عليه مروحتين 120 مم بإضاءة ومركّبين من المصنع. البلوك ينحط على المعالج، والرادياتير يحتاج مكان رادياتير 240 مم في الهيكل. سلك واحد أبو 4 سنون يشغّل المضخة والمراوح؛ وسلك ثاني 5 فولت أبو 3 سنون يشغّل الإضاءة.",
    ),
    sources: [
      source("ARCTIC", "Liquid Freezer III 240 A-RGB (Black) — General Specifications", "https://www.arctic.de/en/Liquid-Freezer-III-240-A-RGB/ACFRE00142A"),
      source("ARCTIC", "Liquid Freezer III 240 A-RGB spec sheet (PDF)", "https://www.arctic.de/media/8e/66/69/1708429821/Spec_Sheet_Liquid_Freezer_III_240_A-RGB_EN.pdf", "2026-10-11"),
    ],
    verification: "verified",
    unverifiedFields: [],
    teachingNotes: [
      FASTENER_NOTE,
      CAPACITY_NOTE,
      "The page lists an 'All-In-One Connector: 4-Pin PWM' (and an alternative 3x 4-pin splitter). Only the single all-in-one lead is modelled; it may go on a CPU fan, pump or chassis fan header.",
    ],
    dimensions: { lengthMm: 277, widthMm: 120, heightMm: 38 },
    formFactor: "240 mm AIO",
    mountPoints: [],
    mounting: [
      { role: "block", kind: "cpu_cooler_mount", label: L("Pump block on the CPU cooler position", "بلوك المضخة على مكان مبرّد المعالج") },
      { role: "radiator", kind: "radiator_mount", label: L("Radiator on a case radiator position", "الرادياتير على مكان رادياتير في الهيكل") },
    ],
    zones: [
      baseZone,
      zone(
        "radiator",
        L("Radiator and fans", "الرادياتير والمراوح"),
        L(
          "The liquid gives up its heat here. The radiator is 277 mm long and 38 mm thick before the fans, so it needs a 240 mm radiator position.",
          "هنا السائل يتخلص من حرارته. الرادياتير طوله 277 مم وسماكته 38 مم بدون المراوح، فيحتاج مكان رادياتير 240 مم.",
        ),
      ),
    ],
    ports: [],
    cables: [
      cable("pump-fan", "pump_lead", "captive", L("All-in-one pump and fan lead (4-pin PWM)", "السلك الموحّد للمضخة والمراوح (PWM من 4 سنون)"), [
        end("plug", "fan_4pin_pwm", "pump_motor", "plug", "device", L("4-pin PWM plug", "راس PWM من 4 سنون")),
      ]),
      argbLead("argb", L("Lighting lead (3-pin A-RGB)", "سلك الإضاءة (A-RGB من 3 سنون)")),
    ],
    rgb: { control: "argb_5v_3pin", lightingCableId: "argb", zones: ["radiator-fans"], addressable: true },
    asset: NO_ASSET,
    spec: {
      type: "aio_liquid",
      supportedSockets: ["lga1851", "lga1700", "am5", "am4"],
      heightMm: null,
      radiatorSizeMm: 240,
      fanCount: 2,
      fanSizeMm: 120,
      coolingCapacityW: null,
    },
  },
  {
    id: "generic-low-profile-air-cooler",
    category: "cooling",
    brand: "Generic",
    model: "Educational low-profile air cooler (65 W class)",
    partNumber: null,
    generic: true,
    description: L(
      "A generic teaching part, not a commercial product: a small single-fan cooler of the kind bundled with 65 W processors. It mounts on the common sockets and fits any case, but in the lab's load model it cannot hold a processor that draws far more than 65 W.",
      "قطعة تعليمية عامة، مو منتج تجاري: مبرّد صغير بمروحة وحدة من النوع اللي يجي مع معالجات 65 واط. يركب على المراس المعروفة ويدخل أي هيكل، بس في نموذج الضغط حق المختبر ما يكفي معالج يسحب أكثر من 65 واط بواجد.",
    ),
    sources: [],
    verification: "generic",
    unverifiedFields: [],
    teachingNotes: [FASTENER_NOTE, "Every figure of this entry is a teaching value chosen for the lab; it describes no real product."],
    dimensions: { lengthMm: 95, widthMm: 95, heightMm: 55 },
    formFactor: "Low-profile air cooler",
    mountPoints: [],
    mounting: [{ role: "main", kind: "cpu_cooler_mount", label: L("CPU cooler position on the motherboard", "مكان مبرّد المعالج على اللوحة الأم") }],
    zones: [baseZone],
    ports: [],
    cables: [fanLead("fan", "fan_4pin_pwm", L("Cooler fan lead (4-pin PWM)", "سلك مروحة المبرّد (PWM من 4 سنون)"))],
    rgb: null,
    asset: NO_ASSET,
    spec: {
      type: "air",
      supportedSockets: ["lga1700", "am4", "am5"],
      heightMm: 55,
      radiatorSizeMm: null,
      fanCount: 1,
      fanSizeMm: 92,
      coolingCapacityW: { value: 65, source: "teaching_assumption" },
    },
  },
];
