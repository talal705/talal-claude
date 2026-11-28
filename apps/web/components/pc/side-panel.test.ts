import { afterEach, describe, expect, it } from "vitest";
import type { PCBuildState } from "@ytl/contracts";
import { planModel } from "./plan-model";
import * as M from "./simple-model";

const plan = { version: 1, purpose: "gaming", workload: "1080p", parts: { case: "corsair-4000d-airflow-black", motherboard: "asus-tuf-gaming-z790-plus-wifi", cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm850x-atx31", gpu: "asus-dual-rtx5060-o8g", ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 }, storage: ["samsung-990-pro-1tb"], fans: [] } };
afterEach(() => M.activateSimpleModel(M.LEGACY_MODEL));
const must = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return (r as T & { state: PCBuildState }).state; };
const shut = (state: PCBuildState) => ({ ...state, sidePanelOpen: false });
const finished = () => {
  M.activateSimpleModel(planModel(plan as never));
  let state = M.createSimpleBuild();
  for (const key of M.simplePartOrder(state)) state = must(M.installSimplePart(state, key));
  for (const lead of M.simpleCablesFor(state)) state = must(M.connectSimpleCable(state, lead.key));
  return state;
};

describe("a closed side panel: what an action changes inside the case is refused", () => {
  it("every step of taking the card out and putting it back, judged by what that step changes", () => {
    let open = finished();
    const latch = () => M.simpleRetention(open, "gpu")!.id;
    const cover = M.slotCovers(open)[0]!.id;
    const steps: [string, () => { ok: boolean }][] = [
      ["unplug the card's end", () => M.unplugSimpleEnd(open, "gpuPower", 1)],
      ["screw out", () => M.unscrewSimplePart(open, "gpu")],
      ["screw out", () => M.unscrewSimplePart(open, "gpu")],
      ["release the latch", () => M.setSimpleMechanism(open, latch(), "open")],
      ["lift the card", () => M.liftSimplePart(open, "gpu")],
      ["refit a slot cover", () => M.setSimpleMechanism(open, cover, "closed")],
      ["take the cover out again", () => M.setSimpleMechanism(open, cover, "open")],
      ["lower the card", () => M.lowerSimplePart(open, "gpu", { rotationDeg: 0, offsetMm: [0, 0] })],
      ["screw in", () => M.screwSimplePart(open, "gpu")],
      ["screw in", () => M.screwSimplePart(open, "gpu")],
      ["plug the card's end", () => M.plugSimpleEnd(open, "gpuPower", 1, M.simpleCableEnds("gpuPower")[1]!.portId, false)],
    ];
    for (const [name, run] of steps) {
      const next = must(run());
      const before = shut(open);
      const copy = JSON.stringify(before);
      expect(M.simpleChangesBehindPanel(before, shut(next)), name).toBe(true);
      expect(JSON.stringify(before), name).toBe(copy);
      expect(M.simpleChangesBehindPanel(open, next), `${name}, panel open`).toBe(false);
      open = next;
    }
  });

  it("the supply end of a lead counts too, and the readiness controls never do", () => {
    const open = finished();
    expect(M.simpleChangesBehindPanel(shut(open), shut(must(M.unplugSimpleEnd(open, "gpuPower", 0))))).toBe(true);
    const before = shut(open);
    for (const [control, value] of [["panel", "open"], ["wall", "in"], ["psu", "on"]] as const) {
      expect(M.simpleChangesBehindPanel(before, must(M.setSimpleSystem(before, control, value))), control).toBe(false);
    }
  });

  it("bench work is not blocked: the CPU, cooler and its lead on a board that is not in the case", () => {
    M.activateSimpleModel(planModel(plan as never));
    let state = shut(M.createSimpleBuild());
    const allowed = (next: PCBuildState, name: string) => { expect(M.simpleChangesBehindPanel(state, next), name).toBe(false); state = next; };
    const socket = M.simpleRetention(state, "cpu")!;
    allowed(must(M.setSimpleMechanism(state, socket.leverId!, "open")), "socket lever on the bench");
    state = shut(must(M.installSimplePart({ ...M.createSimpleBuild() }, "cpu")));
    allowed(must(M.installSimplePart({ ...state, sidePanelOpen: true }, "cooler")), "cooler on the bench");
  });
});
