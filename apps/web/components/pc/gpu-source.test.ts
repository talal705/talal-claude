import { afterEach, describe, expect, it } from "vitest";
import { planModel } from "./plan-model";
import * as M from "./simple-model";
import en from "../../messages/en/labs.json";
import ar from "../../messages/ar/labs.json";

const plan = (motherboard: string, ram: string) => ({ version: 1, purpose: "gaming", workload: "1080p", parts: { case: "corsair-4000d-airflow-black", motherboard, cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm850x-atx31", gpu: "asus-dual-rtx5060-o8g", ram: { id: ram, modules: 2 }, storage: ["samsung-990-pro-1tb"], fans: [] } });
afterEach(() => M.activateSimpleModel(M.LEGACY_MODEL));
const note = (key: string, messages: typeof en) => messages.simplePc.hands[key.replace("hands.", "") as "gpuSource"];

describe("the note under the graphics card's steps", () => {
  it("on the board whose manual was read: that manual and page, the real button, and what the lab simplifies", () => {
    M.activateSimpleModel(planModel(plan("asus-tuf-gaming-z790-plus-wifi", "corsair-vengeance-rgb-ddr5-6000-32gb-kit") as never));
    const key = M.simpleGpuSourceKey();
    for (const messages of [en, ar as typeof en]) {
      const text = note(key, messages);
      for (const word of ["TUF GAMING Z790-PLUS WIFI", "E21279", "2-19", "Q-Release"]) expect(text).toContain(word);
      expect(text).not.toContain("B760");
    }
    expect(note(key, en)).toMatch(/not drawn/);
    expect(note(key, ar as typeof en)).toMatch(/غير مرسوم|مو مرسوم/);
  });

  it("on any other board: general guidance, said to be unverified, citing no manual", () => {
    M.activateSimpleModel(planModel(plan("asus-tuf-gaming-z790-plus-wifi-d4", "corsair-vengeance-lpx-ddr4-3600-16gb-kit") as never));
    const key = M.simpleGpuSourceKey();
    for (const messages of [en, ar as typeof en]) expect(note(key, messages)).not.toMatch(/E21279|2-19|Z790|B760|Q-Release/);
    expect(note(key, en)).toMatch(/not verified/);
    expect(note(key, ar as typeof en)).toMatch(/غير موثّق|مو موثّق/);
  });
});
