// What the build planner offers, and its suggestions per purpose. Suggestions are only a starting
// point the learner may change; compatibility is always decided by `pc.checkPlan`, never by whether a
// part was suggested.
import type { CatalogEntry } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "./catalog";
import type { BuildPurpose } from "./plan-model";

export type PlannerCategory = "cpu" | "motherboard" | "ram" | "storage" | "cooler" | "gpu" | "psu" | "case" | "fans";
export const PLANNER_CATEGORIES: readonly PlannerCategory[] = ["cpu", "motherboard", "ram", "storage", "cooler", "gpu", "psu", "case", "fans"];

/** Entries offered by the planner, per category, in display order. */
export const PLANNER_IDS: Record<PlannerCategory, readonly string[]> = {
  cpu: ["intel-core-i5-4590", "intel-core-i5-14600k", "intel-core-i7-14700k", "intel-core-i9-14900k"],
  motherboard: ["asus-h81m-k", "asus-prime-b760m-a-wifi", "asus-tuf-gaming-z790-plus-wifi-d4", "asus-tuf-gaming-z790-plus-wifi"],
  ram: ["corsair-vengeance-lp-ddr3-1600-16gb-kit", "corsair-vengeance-lpx-ddr4-3600-16gb-kit", "corsair-vengeance-rgb-ddr5-6000-32gb-kit"],
  storage: ["samsung-990-pro-1tb", "samsung-870-evo-1tb", "seagate-barracuda-2tb-st2000dm008"],
  cooler: ["arctic-freezer-7-x", "arctic-freezer-36", "arctic-liquid-freezer-iii-240-argb", "arctic-liquid-freezer-iii-280"],
  gpu: ["asus-dual-rtx3060-o12g-v2", "asus-dual-rtx4060-o8g", "asus-dual-rtx5060-o8g", "asus-tuf-rtx4070tis-o16g-gaming"],
  psu: ["corsair-cx550", "corsair-rm650e-2025", "corsair-rm850x-atx31", "corsair-rm1200x-shift"],
  case: ["fractal-pop-mini-air-rgb-black-tg", "corsair-4000d-airflow-black", "fractal-north-charcoal-black-mesh", "corsair-7000d-airflow-black"],
  fans: ["arctic-p12-pwm-pst", "arctic-p12-pwm-pst-argb", "arctic-p14-pwm-pst"],
};

/** Board tiers by features (slots, headers, chipset), never by size. The DDR3 board is an older platform. */
export const BOARD_TIER: Record<string, "legacy" | "entry" | "mid" | "advanced"> = {
  "asus-h81m-k": "legacy",
  "asus-prime-b760m-a-wifi": "entry",
  "asus-tuf-gaming-z790-plus-wifi-d4": "mid",
  "asus-tuf-gaming-z790-plus-wifi": "advanced",
};

const byId = new Map(pcCatalog.entries.map((e) => [e.id, e]));
export const plannerEntry = (id: string): CatalogEntry | undefined => byId.get(id);

/** The workloads offered for each purpose; the first is the default. */
export const WORKLOADS: Record<BuildPurpose, readonly string[]> = {
  study: [],
  gaming: ["1080p", "1440p"],
  creator: ["photo", "video1080", "video4k"],
};

/** A suggested build for a purpose and workload. Every suggestion passes `checkPlan` (tested). */
export function suggestBuild(purpose: BuildPurpose, workload: string): pc.BuildPlan {
  if (purpose === "study") {
    return {
      case: "fractal-pop-mini-air-rgb-black-tg",
      motherboard: "asus-prime-b760m-a-wifi",
      cpu: "intel-core-i5-14600k",
      cooler: "arctic-freezer-7-x",
      psu: "corsair-rm650e-2025",
      gpu: null,
      ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 },
      storage: ["samsung-990-pro-1tb"],
      fans: [],
    };
  }
  if (purpose === "gaming") {
    return {
      case: "corsair-4000d-airflow-black",
      motherboard: "asus-tuf-gaming-z790-plus-wifi",
      cpu: "intel-core-i5-14600k",
      cooler: "arctic-freezer-36",
      psu: workload === "1440p" ? "corsair-rm850x-atx31" : "corsair-rm650e-2025",
      gpu: workload === "1440p" ? "asus-tuf-rtx4070tis-o16g-gaming" : "asus-dual-rtx5060-o8g",
      ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 },
      storage: ["samsung-990-pro-1tb"],
      fans: ["arctic-p12-pwm-pst"],
    };
  }
  return {
    case: workload === "video4k" ? "corsair-7000d-airflow-black" : "corsair-4000d-airflow-black",
    motherboard: "asus-tuf-gaming-z790-plus-wifi",
    cpu: "intel-core-i7-14700k",
    cooler: "arctic-liquid-freezer-iii-280",
    psu: "corsair-rm850x-atx31",
    gpu: workload === "photo" ? "asus-dual-rtx4060-o8g" : workload === "video4k" ? "asus-tuf-rtx4070tis-o16g-gaming" : "asus-dual-rtx5060-o8g",
    ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: workload === "video4k" ? 4 : 2 },
    storage: ["samsung-990-pro-1tb", "seagate-barracuda-2tb-st2000dm008"],
    fans: ["arctic-p12-pwm-pst"],
  };
}

/** The planner slot a catalog category fills. */
export const slotOfCategory: Record<PlannerCategory, pc.PlanSlot> = {
  cpu: "cpu", motherboard: "motherboard", ram: "ram", storage: "storage", cooler: "cooler", gpu: "gpu", psu: "psu", case: "case", fans: "fans",
};
export const categoryOfSlot = (slot: pc.PlanSlot): PlannerCategory => (PLANNER_CATEGORIES.find((c) => slotOfCategory[c] === slot) ?? "cpu");

/** The plan with `id` put in `category`: replacing the single part, or adding a drive or fan. */
export function withChoice(plan: pc.BuildPlan, category: PlannerCategory, id: string): pc.BuildPlan {
  switch (category) {
    case "ram": {
      const kit = byId.get(id);
      const modules = kit?.category === "ram" ? kit.spec.modulesInKit : 2;
      return { ...plan, ram: { id, modules: plan.ram?.id === id ? plan.ram.modules : modules } };
    }
    case "storage": return { ...plan, storage: [...(plan.storage ?? []), id] };
    case "fans": return { ...plan, fans: [...(plan.fans ?? []), id] };
    default: return { ...plan, [category]: id };
  }
}

/** The plan without one part: a single part cleared, or one drive/fan (by position) removed. */
export function withoutChoice(plan: pc.BuildPlan, category: PlannerCategory, index = 0): pc.BuildPlan {
  switch (category) {
    case "ram": return { ...plan, ram: null };
    case "storage": return { ...plan, storage: (plan.storage ?? []).filter((_, i) => i !== index) };
    case "fans": return { ...plan, fans: (plan.fans ?? []).filter((_, i) => i !== index) };
    default: return { ...plan, [category]: null };
  }
}

/** Options for `category` that clear every incompatible finding the current choice has in that slot. */
export function compatibleOptions(plan: pc.BuildPlan, category: PlannerCategory): string[] {
  const slot = slotOfCategory[category];
  const badNow = (p: pc.BuildPlan) => pc.checkPlan(p, pcCatalog).findings.filter((f) => f.severity === "incompatible" && f.slots.includes(slot)).length;
  return PLANNER_IDS[category].filter((id) => {
    const replaced = category === "storage" || category === "fans" ? withChoice(withoutChoice(plan, category, (plan[category === "storage" ? "storage" : "fans"] ?? []).length - 1), category, id) : withChoice(plan, category, id);
    return badNow(replaced) === 0;
  });
}

/** Which explanation fits a finding code. */
export function explainTopic(code: string): string {
  if (/socket/.test(code)) return code.startsWith("cooler") ? "cooler" : "socket";
  if (/ram|memory/.test(code)) return "memory";
  if (/form_factor/.test(code)) return "size";
  if (/too_long|too_tall/.test(code)) return code.includes("cooler") ? "cooler" : "length";
  if (/radiator/.test(code)) return "radiator";
  if (/psu|power/.test(code)) return "power";
  if (/m2|sata|drive/.test(code)) return "storage";
  if (/fan|pump/.test(code)) return "fans";
  if (/bios/.test(code)) return "bios";
  return "general";
}
