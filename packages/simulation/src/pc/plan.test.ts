import { describe, expect, it } from "vitest";
import { pcCatalog } from "../../../../content/catalog";
import { checkPlan, type BuildPlan } from "./plan";

const base: BuildPlan = {
  case: "corsair-4000d-airflow-black",
  motherboard: "asus-tuf-gaming-z790-plus-wifi",
  cpu: "intel-core-i5-14600k",
  cooler: "arctic-freezer-36",
  psu: "corsair-rm850x-atx31",
  gpu: "asus-dual-rtx4060-o8g",
  ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 },
  storage: ["samsung-990-pro-1tb"],
  fans: [],
};
const codes = (plan: BuildPlan) => checkPlan(plan, pcCatalog).findings.map((f) => `${f.severity}:${f.code}`).filter((c) => c !== "conditional:bios_update_needed");

describe("checkPlan", () => {
  it("passes a matching build and reports nothing missing", () => {
    const r = checkPlan(base, pcCatalog);
    expect(r.missing).toEqual([]);
    // The board's factory BIOS predates the i5-14600K: a conditional note, not a refusal.
    expect(r.findings.map((f) => `${f.severity}:${f.code}`)).toEqual(["conditional:bios_update_needed"]);
    expect(r.ready).toBe(true);
    expect(r.estimatedLoadW).toBe(181 + 115 + 50);
  });

  it("lists missing required parts and is not ready", () => {
    const r = checkPlan({ case: base.case }, pcCatalog);
    expect(r.missing).toEqual(["motherboard", "cpu", "cooler", "psu", "ram", "storage"]);
    expect(r.ready).toBe(false);
  });

  it("refuses DDR4 memory on a DDR5 board with the engine's code", () => {
    expect(codes({ ...base, ram: { id: "corsair-vengeance-lpx-ddr4-3600-16gb-kit", modules: 2 } })).toContain("incompatible:ram_generation_mismatch");
  });

  it("refuses a CPU of another socket", () => {
    expect(codes({ ...base, cpu: "intel-core-i5-4590" })).toContain("incompatible:cpu_socket_mismatch");
  });

  it("runs the legacy DDR3 route end to end", () => {
    const r = checkPlan({ ...base, case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-rm650e-2025", ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"] }, pcCatalog);
    expect(r.findings.filter((f) => f.severity === "incompatible")).toEqual([]);
    expect(r.findings.map((f) => f.code)).toContain("bios_unconfirmed");
    expect(r.ready).toBe(true);
  });

  it("refuses an ATX board in the micro-ATX case", () => {
    expect(codes({ ...base, case: "fractal-pop-mini-air-rgb-black-tg" })).toContain("incompatible:board_form_factor_unsupported");
  });

  it("refuses a 280 mm radiator in a case that takes 240 mm at most", () => {
    const plan = { ...base, case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-prime-b760m-a-wifi", psu: "corsair-rm650e-2025", cooler: "arctic-liquid-freezer-iii-280" };
    expect(codes(plan)).toContain("incompatible:radiator_size_unsupported");
    expect(codes({ ...plan, cooler: "arctic-liquid-freezer-iii-240-argb" }).filter((c) => c.startsWith("incompatible"))).toEqual([]);
  });

  it("refuses a card longer than the case allows", () => {
    expect(codes({ ...base, case: "fractal-north-charcoal-black-mesh", gpu: "asus-rog-strix-rtx4090-o24g-gaming" })).toContain("incompatible:gpu_too_long");
  });

  it("flags too many memory modules for the slots", () => {
    expect(codes({ ...base, motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 4 } })).toContain("incompatible:ram_slots_exceeded");
  });

  it("flags a power supply below the estimated load, never one above it", () => {
    expect(codes({ ...base, cpu: "intel-core-i9-14900k", gpu: "asus-tuf-rtx5090-o32g-gaming", psu: "corsair-cx550" })).toContain("incompatible:psu_insufficient_for_load");
    expect(codes({ ...base, psu: "corsair-rm1200x-shift" })).toEqual([]);
  });

  it("states the i9 liquid requirement as an exercise rule (conditional), not an incompatibility", () => {
    const f = checkPlan({ ...base, cpu: "intel-core-i9-14900k" }, pcCatalog).findings.find((x) => x.code === "exercise_needs_liquid");
    expect(f?.severity).toBe("conditional");
    expect(codes({ ...base, cpu: "intel-core-i9-14900k", cooler: "arctic-liquid-freezer-iii-280" })).not.toContain("conditional:exercise_needs_liquid");
  });

  it("checks SATA power plugs, drive bays and M.2 slots", () => {
    const four = ["samsung-990-pro-1tb", "samsung-990-pro-1tb", "samsung-990-pro-1tb", "samsung-990-pro-1tb", "samsung-990-pro-1tb"];
    expect(codes({ ...base, storage: four })).toContain("incompatible:m2_slots_exceeded");
    expect(codes({ ...base, storage: ["seagate-barracuda-2tb-st2000dm008", "seagate-barracuda-2tb-st2000dm008", "seagate-barracuda-2tb-st2000dm008"] })).toContain("incompatible:drive_bays_exceeded");
    expect(codes({ ...base, storage: ["samsung-870-evo-1tb", "seagate-barracuda-2tb-st2000dm008"] })).toEqual([]);
  });

  it("refuses a 140 mm fan where only 120 mm positions exist, and needs a hub past the headers", () => {
    expect(codes({ ...base, case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-prime-b760m-a-wifi", fans: ["arctic-p14-pwm-pst"] })).toContain("incompatible:fan_size_unsupported");
    expect(codes({ ...base, motherboard: "asus-prime-b760m-a-wifi", fans: ["arctic-p12-pwm-pst", "arctic-p12-pwm-pst", "arctic-p12-pwm-pst"] })).toContain("conditional:fan_headers_short");
  });

  it("notes a missing pump header as conditional", () => {
    expect(codes({ ...base, motherboard: "asus-prime-b760m-a-wifi", cooler: "arctic-liquid-freezer-iii-280" })).toContain("conditional:no_pump_header");
  });

  it("never judges colour or brand: the same build with ARGB fans is still clean", () => {
    expect(codes({ ...base, fans: ["arctic-p12-pwm-pst-argb"] })).toEqual([]);
  });
});
