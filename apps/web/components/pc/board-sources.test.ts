import { afterEach, describe, expect, it } from "vitest";
import { planModel } from "./plan-model";
import * as M from "./simple-model";
import en from "../../messages/en/labs.json";
import ar from "../../messages/ar/labs.json";

const Z790 = "asus-tuf-gaming-z790-plus-wifi", D4 = "asus-tuf-gaming-z790-plus-wifi-d4", B760 = "asus-prime-b760m-a-wifi";
const use = (motherboard: string) => {
  const ram = motherboard === D4 ? "corsair-vengeance-lpx-ddr4-3600-16gb-kit" : "corsair-vengeance-rgb-ddr5-6000-32gb-kit";
  M.activateSimpleModel(planModel({ version: 1, purpose: "gaming", workload: "1080p", parts: { case: "corsair-4000d-airflow-black", motherboard, cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm850x-atx31", gpu: "asus-dual-rtx5060-o8g", ram: { id: ram, modules: 2 }, storage: ["samsung-990-pro-1tb"], fans: [] } } as never));
  return M.createSimpleBuild();
};
afterEach(() => M.activateSimpleModel(M.LEGACY_MODEL));
type Note = { key: string; values?: Record<string, string> };
const words = (note: Note, messages: typeof en) => Object.entries(note.values ?? {}).reduce((text, [k, v]) => text.replace(`{${k}}`, v), messages.simplePc.hands[note.key.replace("hands.", "") as "gpuSource"]);
const both = (note: Note) => [words(note, en), words(note, ar as typeof en)];

describe("the CPU socket note", () => {
  it("cites the Z790 manual on that board only; other Intel boards get ASUS's general guide, said not to be their manual", () => {
    use(Z790);
    for (const text of both({ key: M.simpleCpuSourceKey(true) })) expect(text).toContain("E21279");
    for (const text of both({ key: M.simpleCpuSourceKey(true) })) expect(text).not.toContain("H81");
    for (const board of [D4, B760]) {
      use(board);
      const [e, a] = both({ key: M.simpleCpuSourceKey(true) });
      for (const text of [e, a]) { expect(text).toContain("1047659"); expect(text, board).not.toMatch(/E21279|Z790/); }
      expect(e).toMatch(/General guide.*not checked/);
      expect(a).toMatch(/عام.*ما تم التحقق/);
    }
    // The AM4 lever: the same general guide, not a board's manual.
    for (const text of both({ key: M.simpleCpuSourceKey(false) })) expect(text).toContain("1047659");
    expect(both({ key: M.simpleCpuSourceKey(false) })[0]).toMatch(/General guide/);
  });
});

describe("the M.2 note follows the board and the slot's own retention", () => {
  const noteFor = (board: string, slot: string) => M.simpleM2SourceNote(use(board), "storage", slot);
  it("Q-Latch boards: their own manual and the page for that slot", () => {
    for (const [board, manual, name] of [[Z790, "E21279", "Z790-PLUS WIFI"], [D4, "E20581", "Z790-PLUS WIFI D4"]] as const) {
      for (const [slot, page] of [["m2-1", "2-8"], ["m2-2", "2-10"], ["m2-3", "2-8"], ["m2-4", "2-11"]] as const) {
        for (const text of both(noteFor(board, slot))) { expect(text).toContain("Q-Latch"); expect(text).toContain(manual); expect(text).toContain(page); expect(text).toContain(name); expect(text).not.toContain("{"); }
      }
    }
    for (const text of both(noteFor(D4, "m2-1"))) expect(text).not.toContain("E21279");
  });
  it("a screw-and-stand board never mentions a Q-Latch", () => {
    for (const slot of ["m2-1", "m2-2"]) {
      for (const text of both(noteFor(B760, slot))) { expect(text).toContain("E21693"); expect(text).toContain("1-14"); expect(text).not.toMatch(/Q-Latch|E21279|Z790/); }
    }
  });
  it("with no slot chosen: no mechanism and no manual is claimed", () => {
    const state = use(Z790);
    for (const text of both(M.simpleM2SourceNote(state, "storage", undefined))) expect(text).not.toMatch(/Q-Latch|E2\d{4}/);
  });
  it("the robot's refusal and mechanism lines for a screw slot never name a Q-Latch", () => {
    const state = use(B760);
    const key = M.simpleM2OpenFirstKey(state, "storage", "m2-1");
    for (const messages of [en, ar as typeof en]) expect(messages.simplePc.companion.hands[key.replace("hands.", "") as "m2OpenFirst"]).not.toMatch(/Q-Latch/);
    expect(M.simpleM2OpenFirstKey(use(Z790), "storage", "m2-1")).toBe("hands.m2OpenFirst");
  });
});
