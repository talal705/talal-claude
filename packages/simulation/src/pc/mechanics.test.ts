import { describe, expect, it } from "vitest";
import type { PCAction, PCBuildState } from "@ytl/contracts";
import { pcCatalog } from "../../../../content/catalog";
import { applyAction, createBuild, evaluateStartup } from "./index";

const run = (s: PCBuildState, actions: PCAction[]) => actions.reduce((st, a) => { const r = applyAction(st, a, pcCatalog); if (!r.ok) throw new Error(`${a.type}: ${r.rejection.code}`); return r.state; }, s);
const code = (s: PCBuildState, a: PCAction) => { const r = applyAction(s, a, pcCatalog); return r.ok ? "ok" : r.rejection.code; };
const at = (mountPointId: string) => ({ hostInstanceId: "motherboard-1", mountPointId });
const good = { rotationDeg: 0, offsetMm: [0, 0] as [number, number] };
const start = () => run(createBuild(pcCatalog), [
  { type: "set_mechanics", mode: "detailed" },
  { type: "add_part", catalogId: "asus-tuf-gaming-z790-plus-wifi" },
  { type: "add_part", catalogId: "intel-core-i5-14600k" },
  { type: "add_part", catalogId: "corsair-vengeance-rgb-ddr5-6000-32gb-kit" },
  { type: "add_part", catalogId: "arctic-freezer-36" },
]);

describe("detailed mechanics: CPU", () => {
  it("starts with the plate closed and the cover on", () => {
    expect(start().parts[0]!.mechanisms).toMatchObject({ "cpu-socket-plate": "closed", "cpu-socket-plate:cover": "closed", "dimm-a2-latch": "closed" });
  });

  it("needs the plate open, the triangle matched and the CPU centred", () => {
    let s = start();
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good })).toBe("retention_closed");
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "open" }, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" }]);
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket") })).toBe("alignment_required");
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: { rotationDeg: 180, offsetMm: [0, 0] } })).toBe("keying_wrong");
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: { rotationDeg: 0, offsetMm: [5, 0] } })).toBe("alignment_off");
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: { rotationDeg: 360, offsetMm: [1, 1] } })).toBe("ok");
  });

  it("closes only over a seated CPU, which locks it and pops the cover; the lever is the only way to secure it", () => {
    let s = run(start(), [
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "open" },
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" },
      { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good },
    ]);
    expect(code(s, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "closed" })).toBe("retention_blocked");
    s = run(s, [{ type: "set_seating", instanceId: "cpu-2", seating: "seated" }]);
    expect(code(s, { type: "set_fasteners", instanceId: "cpu-2", secured: 1 })).toBe("invalid_action");
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "closed" }]);
    expect(s.parts.find((p) => p.instanceId === "cpu-2")!.attachments[0]!.fastenersSecured).toBe(0);
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "closed" }]);
    expect(s.parts.find((p) => p.instanceId === "cpu-2")!.attachments[0]!.fastenersSecured).toBe(1);
    expect(s.parts[0]!.mechanisms!["cpu-socket-plate:cover"]).toBe("open");
    expect(code(s, { type: "unmount_part", instanceId: "cpu-2" })).toBe("retention_closed");
    // Removal in reverse: the plate cannot open before the lever is released.
    expect(code(s, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" })).toBe("retention_blocked");
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "open" }, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" }, { type: "unmount_part", instanceId: "cpu-2" }]);
    expect(s.parts.find((p) => p.instanceId === "cpu-2")!.attachments).toEqual([]);
  });

  it("will not open the plate under a mounted cooler", () => {
    const s = run(start(), [
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "open" },
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" },
      { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good },
      { type: "set_seating", instanceId: "cpu-2", seating: "seated" },
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "closed" },
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "closed" },
      { type: "set_prep", instanceId: "cooling-4", prep: "paste", value: "applied" },
      { type: "mount_part", instanceId: "cooling-4", target: at("cooler-mount") },
    ]);
    expect(code(s, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "open" })).toBe("retention_blocked");
    expect(code(s, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" })).toBe("retention_blocked");
  });

  it("needs the lever up before the plate opens, and the plate shut before the lever locks", () => {
    let s = start();
    expect(code(s, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" })).toBe("retention_blocked");
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "open" }, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" }]);
    expect(code(s, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "closed" })).toBe("retention_blocked");
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "closed" }, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "closed" }]);
    // An empty socket keeps its cover.
    expect(s.parts[0]!.mechanisms!["cpu-socket-plate:cover"]).toBe("closed");
  });
});

describe("detailed mechanics: other sockets", () => {
  const board = (boardId: string, cpuId: string) => run(createBuild(pcCatalog), [{ type: "set_mechanics", mode: "detailed" }, { type: "add_part", catalogId: boardId }, { type: "add_part", catalogId: cpuId }]);
  it("LGA1150 (ASUS H81M-K) uses the same lever-then-plate sequence", () => {
    let s = board("asus-h81m-k", "intel-core-i5-4590");
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good })).toBe("retention_closed");
    expect(code(s, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" })).toBe("retention_blocked");
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "open" }, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" }, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good }]);
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good })).not.toBe("ok");
    expect(code(s, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "closed" })).toBe("retention_blocked");
    s = run(s, [{ type: "set_seating", instanceId: "cpu-2", seating: "seated" }, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "closed" }, { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "closed" }]);
    expect(s.parts.find((p) => p.instanceId === "cpu-2")!.attachments[0]!.fastenersSecured).toBe(1);
  });
  it("AM4 (ASUS TUF GAMING B550-PLUS, archived) has a single ZIF lever", () => {
    const lever = { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-lever" } as const;
    let s = board("asus-tuf-gaming-b550-plus", "amd-ryzen-5-5600");
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good })).toBe("retention_closed");
    s = run(s, [{ ...lever, state: "open" }]);
    expect(code(s, { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: { rotationDeg: 90, offsetMm: [0, 0] } })).toBe("keying_wrong");
    s = run(s, [{ type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good }]);
    expect(code(s, { ...lever, state: "closed" })).toBe("retention_blocked");
    s = run(s, [{ type: "set_seating", instanceId: "cpu-2", seating: "seated" }, { ...lever, state: "closed" }]);
    expect(s.parts.find((p) => p.instanceId === "cpu-2")!.attachments[0]!.fastenersSecured).toBe(1);
    expect(code(s, { type: "unmount_part", instanceId: "cpu-2" })).toBe("retention_closed");
  });
});

describe("detailed mechanics: memory", () => {
  it("needs the latch open and the notch the right way round; pressing home closes the latch; opening releases it", () => {
    let s = start();
    expect(code(s, { type: "mount_part", instanceId: "ram-3", target: at("dimm-a2"), alignment: good })).toBe("retention_closed");
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "dimm-a2-latch", state: "open" }]);
    expect(code(s, { type: "mount_part", instanceId: "ram-3", target: at("dimm-a2"), alignment: { rotationDeg: 180, offsetMm: [0, 0] } })).toBe("keying_wrong");
    s = run(s, [{ type: "mount_part", instanceId: "ram-3", target: at("dimm-a2"), alignment: good }, { type: "set_seating", instanceId: "ram-3", seating: "seated" }]);
    expect(s.parts[0]!.mechanisms!["dimm-a2-latch"]).toBe("closed");
    expect(code(s, { type: "unmount_part", instanceId: "ram-3" })).toBe("retention_closed");
    s = run(s, [{ type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "dimm-a2-latch", state: "open" }]);
    expect(s.parts.find((p) => p.instanceId === "ram-3")!.attachments[0]!.seating).toBe("placed");
    expect(code(s, { type: "unmount_part", instanceId: "ram-3" })).toBe("ok");
  });

  it("an open latch leaves the module unseated, which the startup check reports", () => {
    const s = run(start(), [
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "dimm-a2-latch", state: "open" },
      { type: "mount_part", instanceId: "ram-3", target: at("dimm-a2"), alignment: good },
    ]);
    expect(evaluateStartup(s, pcCatalog).outcome).not.toBe("operational");
  });
});

describe("detailed mechanics: preparation before fitting", () => {
  it("a cooler supplied with a tube needs paste on the CPU first, and only once", () => {
    let s = run(start(), [
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "open" },
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "open" },
      { type: "mount_part", instanceId: "cpu-2", target: at("cpu-socket"), alignment: good },
      { type: "set_seating", instanceId: "cpu-2", seating: "seated" },
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate", state: "closed" },
      { type: "set_mechanism", instanceId: "motherboard-1", mechanismId: "cpu-socket-plate:lever", state: "closed" },
    ]);
    expect(code(s, { type: "mount_part", instanceId: "cooling-4", target: at("cooler-mount") })).toBe("prep_missing");
    // The film is not recorded for this cooler, so peeling it is neither asked for nor accepted.
    expect(code(s, { type: "set_prep", instanceId: "cooling-4", prep: "film", value: "removed" })).toBe("prep_wrong");
    s = run(s, [{ type: "set_prep", instanceId: "cooling-4", prep: "paste", value: "applied" }]);
    expect(code(s, { type: "set_prep", instanceId: "cooling-4", prep: "paste", value: "applied" })).toBe("prep_wrong");
    expect(code(s, { type: "mount_part", instanceId: "cooling-4", target: at("cooler-mount") })).toBe("ok");
  });
});
