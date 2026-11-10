import type { FanEntry } from "@ytl/contracts";
import { L, NO_ASSET, argbLead, fanLead, source, zone } from "./helpers";

const mounting = [{ role: "main", kind: "fan_mount" as const, label: L("Fan position of the case", "مكان مروحة في الهيكل") }];

const fanZones = [
  zone(
    "frame-arrows",
    L("Frame and airflow direction", "الإطار واتجاه الهوا"),
    L(
      "Air leaves on the side with the support struts. Which way the fan faces decides whether it brings air into the case or pushes it out.",
      "الهوا يطلع من الجهة اللي فيها دعامات المحرّك. اتجاه المروحة يحدّد إذا تدخّل هوا للهيكل ولا تطلّعه.",
    ),
  ),
  zone(
    "leads",
    L("Leads", "الأسلاك"),
    L(
      "The 4-pin lead powers and controls the motor. On a lit fan a separate 3-pin lead carries the lighting; the two are not interchangeable.",
      "السلك أبو 4 سنون يغذّي المحرّك ويتحكم فيه. في المروحة اللي فيها إضاءة، سلك ثاني أبو 3 سنون للإضاءة؛ وما ينحط واحد مكان الثاني.",
    ),
  ),
];

export const fans: FanEntry[] = [
  {
    id: "arctic-p12-pwm-pst",
    category: "fan",
    brand: "ARCTIC",
    model: "P12 PWM PST",
    partNumber: "ACFAN00120A",
    generic: false,
    description: L(
      "A 120 mm case fan with a 4-pin PWM lead and no lighting. PWM lets the motherboard set its speed, here from 200 to 1800 rpm.",
      "مروحة هيكل 120 مم بسلك PWM أبو 4 سنون وبدون إضاءة. الـ PWM يخلّي اللوحة الأم تتحكم بسرعتها، وهنا من 200 لين 1800 لفّة بالدقيقة.",
    ),
    sources: [
      source("ARCTIC", "P12 PWM PST — General Specifications", "https://www.arctic.de/en/P12-PWM-PST/ACFAN00120A"),
      source("ARCTIC", "P12 PWM PST spec sheet (PDF, SKU ACFAN00120A listed)", "https://www.arctic.de/media/42/84/78/1693306001/Spec_Sheet_P12_PWM_PST_EN.pdf", "2026-10-11"),
    ],
    verification: "verified",
    unverifiedFields: [],
    teachingNotes: ["The spec sheet lists '4-Pin Connector + 4-Pin Socket'; the socket that daisy-chains a second fan is not modelled."],
    dimensions: { lengthMm: 120, widthMm: 120, heightMm: 25 },
    formFactor: "120 mm",
    mountPoints: [],
    mounting,
    zones: fanZones,
    ports: [],
    cables: [fanLead("fan", "fan_4pin_pwm", L("Fan lead (4-pin PWM)", "سلك المروحة (PWM من 4 سنون)"))],
    rgb: null,
    asset: NO_ASSET,
    spec: { sizeMm: 120, thicknessMm: 25, control: "pwm_4pin", maxRpm: 1800 },
  },
  {
    id: "arctic-p12-pwm-pst-argb",
    category: "fan",
    brand: "ARCTIC",
    model: "P12 PWM PST A-RGB",
    partNumber: "ACFAN00231A",
    generic: false,
    description: L(
      "A 120 mm case fan with 12 addressable LEDs. It has two leads: a 4-pin PWM lead for the motor and a 3-pin 5 V lead for the lighting. The fan spins without the lighting lead; the lights need it on a 5 V addressable header.",
      "مروحة هيكل 120 مم فيها 12 لمبة LED قابلة للعنونة. لها سلكين: سلك PWM أبو 4 سنون للمحرّك، وسلك 5 فولت أبو 3 سنون للإضاءة. المروحة تدور بدون سلك الإضاءة؛ بس الأنوار تحتاجه على مدخل 5 فولت قابل للعنونة.",
    ),
    sources: [
      source("ARCTIC", "P12 PWM PST A-RGB — General Specifications (EAN 4895213703154)", "https://www.arctic.de/en/P12-PWM-PST-A-RGB"),
      source("ARCTIC", "P12 PWM PST A-RGB spec sheet (PDF; single fan, black: SKU ACFAN00231A, EAN 4895213703154)", "https://www.arctic.de/media/4d/1d/d5/1696578108/Spec_Sheet_P12_PWM_PST_A-RGB_EN.pdf", "2026-10-11"),
    ],
    verification: "verified",
    unverifiedFields: [],
    teachingNotes: ["The spec sheet lists a 4-pin socket and a 3-pin A-RGB socket for daisy-chaining further fans; they are not modelled."],
    dimensions: { lengthMm: 120, widthMm: 120, heightMm: 25 },
    formFactor: "120 mm",
    mountPoints: [],
    mounting,
    zones: fanZones,
    ports: [],
    cables: [
      fanLead("fan", "fan_4pin_pwm", L("Fan lead (4-pin PWM)", "سلك المروحة (PWM من 4 سنون)")),
      argbLead("argb", L("Lighting lead (3-pin 5 V A-RGB)", "سلك الإضاءة (A-RGB 5 فولت من 3 سنون)")),
    ],
    rgb: { control: "argb_5v_3pin", lightingCableId: "argb", zones: ["fan-hub"], addressable: true },
    asset: NO_ASSET,
    spec: { sizeMm: 120, thicknessMm: 25, control: "pwm_4pin", maxRpm: 2000 },
  },
  // ---------- Fans that come fitted in a case. Not offered on their own: each case brings its own (see catalog.ts). ----------
  {
    id: "corsair-airguide-120-4000d",
    category: "fan",
    brand: "Corsair",
    model: "AirGuide 120 mm fan (fitted in the 4000D AIRFLOW)",
    partNumber: null,
    generic: false,
    description: L(
      "One of the two 120 mm fans that come fitted in the Corsair 4000D AIRFLOW. Its anti-vortex vanes concentrate the airflow. It is a fan like any other: you can take it out, move it to another position, or plug its lead into another fan header.",
      "وحدة من المروحتين 120 مم اللي تجي مركّبة في هيكل Corsair 4000D AIRFLOW. فيها زعانف تمنع الدوامات وتركّز الهوا. هي مروحة زي أي مروحة: تقدر تطلّعها، تنقلها لمكان ثاني، أو توصّل سلكها على مدخل مروحة ثاني.",
    ),
    sources: [
      source(
        "Corsair",
        "4000D AIRFLOW — product page ('Equipped with two CORSAIR 120mm AirGuide fans'; spare part '4000D/4000D Airflow 120mm 3-pin Fan')",
        "https://www.corsair.com/us/en/p/pc-cases/cc-9011200-ww/4000d-airflow-tempered-glass-mid-tower-atx-case-black-cc-9011200-ww",
        "2026-10-31",
      ),
    ],
    verification: "partially_verified",
    unverifiedFields: [
      "spec.control and cables.fan (3-pin, from the page's spare-part listing, not the included-fan text)",
      "spec.thicknessMm and dimensions.heightMm (25 mm, the common thickness; not stated)",
      "spec.maxRpm (not stated for the included fans)",
      "fitted positions (the page does not say where the two fans are fitted; the front is assumed)",
    ],
    teachingNotes: ["A 3-pin fan runs on a 4-pin header at a speed set by voltage, without PWM control."],
    dimensions: { lengthMm: 120, widthMm: 120, heightMm: 25 },
    formFactor: "120 mm",
    mountPoints: [],
    mounting,
    zones: fanZones,
    ports: [],
    cables: [fanLead("fan", "fan_3pin", L("Fan lead (3-pin)", "سلك المروحة (3 سنون)"))],
    rgb: null,
    asset: NO_ASSET,
    spec: { sizeMm: 120, thicknessMm: 25, control: "dc_3pin", maxRpm: null },
  },
  {
    id: "fractal-aspect-14-pwm-north",
    category: "fan",
    brand: "Fractal Design",
    model: "Aspect 14 PWM (fitted in the North)",
    partNumber: null,
    generic: false,
    description: L(
      "One of the two 140 mm Aspect 14 PWM fans that come fitted at the front of the Fractal North. Like any fan, it can be taken out and fitted elsewhere, and its PWM lead lets the motherboard set its speed.",
      "وحدة من مروحتين Aspect 14 PWM مقاس 140 مم اللي تجي مركّبة في واجهة هيكل Fractal North. زي أي مروحة، تقدر تطلّعها وتركّبها في مكان ثاني، وسلك الـ PWM يخلّي اللوحة الأم تتحكم بسرعتها.",
    ),
    sources: [
      source("Fractal Design", "North Charcoal Black — Specifications ('Fans included: 2x Aspect 14 PWM (front)')", "https://www.fractal-design.com/products/cases/north/north/charcoal-black/", "2026-10-31"),
    ],
    verification: "partially_verified",
    unverifiedFields: [
      "spec.control and cables.fan (a 4-pin PWM plug is inferred from the name 'PWM')",
      "spec.thicknessMm and dimensions.heightMm (25 mm, the common thickness; the fan's own page could not be read)",
      "spec.maxRpm (not on the case page)",
    ],
    teachingNotes: ["The 140 mm size is the '14' of the name and the case page's front fan support (2x 140 mm)."],
    dimensions: { lengthMm: 140, widthMm: 140, heightMm: 25 },
    formFactor: "140 mm",
    mountPoints: [],
    mounting,
    zones: fanZones,
    ports: [],
    cables: [fanLead("fan", "fan_4pin_pwm", L("Fan lead (4-pin PWM)", "سلك المروحة (PWM من 4 سنون)"))],
    rgb: null,
    asset: NO_ASSET,
    spec: { sizeMm: 140, thicknessMm: 25, control: "pwm_4pin", maxRpm: null },
  },
];
