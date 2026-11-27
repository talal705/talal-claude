import { afterEach, describe, expect, it } from "vitest";
import { planModel } from "./plan-model";
import * as M from "./simple-model";
import en from "../../messages/en/labs.json";

const plan = { version: 1, purpose: "gaming", workload: "1080p", parts: { case: "corsair-4000d-airflow-black", motherboard: "asus-tuf-gaming-z790-plus-wifi", cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm850x-atx31", gpu: "asus-dual-rtx5060-o8g", ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 }, storage: ["samsung-990-pro-1tb"], fans: [] } };
afterEach(() => M.activateSimpleModel(M.LEGACY_MODEL));
const fitted = () => {
  M.activateSimpleModel(planModel(plan as never));
  let state = M.createSimpleBuild();
  for (const key of M.simplePartOrder(state)) { const r = M.installSimplePart(state, key); if (!r.ok) throw new Error(key); state = r.state; }
  return state;
};
const refusal = (r: ReturnType<typeof M.plugSimpleEnd>) => { if (r.ok || !r.message) throw new Error(JSON.stringify(r)); return r.message; };

describe("refusals when plugging: name the socket, say why, say what to do", () => {
  it("a header another lead uses", () => {
    let state = fitted();
    const choices = M.simplePortChoices(state, M.simpleCableEnds("caseFan1")[0]!).filter((c) => c.fits && !c.occupied);
    const header = choices[1]!.portId;
    const first = M.plugSimpleEnd(state, "caseFan1", 0, header, false);
    if (!first.ok) throw new Error("fan1");
    state = first.state;
    const said = refusal(M.plugSimpleEnd(state, "caseFan2", 0, header, false));
    const name = M.simpleSocketName(state, M.simpleCableEnds("caseFan2")[0]!.instanceId, header)!;
    expect(said.en).toContain(name.en);
    expect(said.en).toMatch(/already has a cable/);
    expect(said.en).toMatch(/free socket|unplug/i);
    expect(said.ar).toContain(name.ar);
  });

  it("a look-alike socket of another kind: the engine's reason, then where this plug goes", () => {
    const state = fitted();
    const ends = M.simpleCableEnds("atx");
    const board = ends.findIndex((e) => !e.instanceId.startsWith("psu"));
    const wrong = M.simplePortChoices(state, ends[board]!).find((c) => !c.fits)!;
    const planned = M.simpleSocketName(state, ends[board]!.instanceId, ends[board]!.portId)!;
    const said = refusal(M.plugSimpleEnd(state, "atx", board, wrong.portId, false));
    expect(said.en).toMatch(/does not go in|not a socket for this plug/);
    expect(said.en).toContain(planned.en);
    expect(said.ar).toContain(planned.ar);
  });

  it("a reversed plug: every kind of keying says what to do", () => {
    for (const [kind, line] of Object.entries(en.simplePc.companion.hands.reversed)) expect(line, kind).toMatch(/turn/i);
  });
});
