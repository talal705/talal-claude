import { describe, expect, it } from "vitest";
import type { PCCatalog } from "@ytl/contracts";
import { PC_CONTRACTS_VERSION } from "@ytl/contracts";
import { ARCHIVED_CATALOG_IDS, offeredEntries, pcCatalog } from "../../../../content/catalog";
import { pcPresets } from "../../../../content/catalog/presets";
import { CATALOG_OPTIONS_PER_CATEGORY, PC_PART_CATEGORIES, countCatalog, replay, validateCatalog } from "./index";

describe("catalog", () => {
  it("is internally consistent", () => {
    expect(validateCatalog(pcCatalog)).toEqual([]);
  });

  it("has unique, stable-format IDs", () => {
    const ids = pcCatalog.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9][a-z0-9-]*$/.test(id))).toBe(true);
  });

  it("every commercial entry has a fetched source with a date; generic entries are labelled and never pose as commercial", () => {
    for (const e of pcCatalog.entries) {
      if (e.generic) {
        expect([e.id, e.verification, e.brand]).toEqual([e.id, "generic", "Generic"]);
        expect(e.sources).toEqual([]);
      } else {
        expect(e.sources.length, e.id).toBeGreaterThan(0);
        for (const s of e.sources) {
          expect(s.url, e.id).toMatch(/^https:\/\//);
          expect(s.retrievedOn, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        // Nothing is marked fully verified while it lists unverified fields.
        expect(e.verification === "verified" ? e.unverifiedFields : [], e.id).toEqual([]);
      }
    }
  });

  it("every description and label exists in English and Arabic", () => {
    const arabic = /[؀-ۿ]/;
    for (const e of pcCatalog.entries) {
      const texts = [e.description, ...e.zones.flatMap((z) => [z.label, z.description]), ...e.ports.map((p) => p.label), ...e.mountPoints.map((m) => m.label), ...e.mounting.map((m) => m.label), ...e.cables.flatMap((c) => [c.label, ...c.ends.map((x) => x.label)])];
      for (const t of texts) {
        expect(t.en.trim().length, e.id).toBeGreaterThan(0);
        expect(arabic.test(t.ar), `${e.id}: ${t.en}`).toBe(true);
      }
    }
  });

  it("connection targets resolve: CPU support rows, recommended memory slots, lighting leads and every preset action", () => {
    const byId = new Map(pcCatalog.entries.map((e) => [e.id, e]));
    for (const e of pcCatalog.entries) {
      if (e.category === "motherboard") {
        for (const row of e.spec.cpuSupport) {
          const cpu = byId.get(row.cpuId);
          expect(cpu?.category, row.cpuId).toBe("cpu");
          expect(cpu?.category === "cpu" && cpu.spec.socket).toBe(e.spec.socket);
        }
        const slots = e.mountPoints.filter((m) => m.kind === "dimm_slot").map((m) => m.id);
        for (const rule of e.spec.memory.recommendedPopulation) expect(rule.slotIds.every((s) => slots.includes(s))).toBe(true);
        expect(e.spec.biosVersions.map((b) => b.version)).toContain(e.spec.factoryBiosVersion);
      }
      if (e.rgb && e.rgb.control !== "integrated") expect(e.cables.map((c) => c.id)).toContain(e.rgb.lightingCableId);
    }
    for (const p of pcPresets) expect(replay(p.actions, pcCatalog).clean, p.id).toBe(true);
  });

  it("carries the compatibility data the engine reads", () => {
    for (const e of pcCatalog.entries) {
      if (e.category === "case") expect([e.spec.maxGpuLengthMm > 0, e.spec.maxCpuCoolerHeightMm > 0], e.id).toEqual([true, true]);
      if (e.category === "gpu") expect([e.spec.lengthMm > 0, e.spec.recommendedPsuW !== null, e.ports.some((p) => p.function === "gpu_power")], e.id).toEqual([true, true, true]);
      if (e.category === "psu") expect(e.spec.wattageW, e.id).toBeGreaterThan(0);
      if (e.category === "cpu") expect([e.spec.basePowerW > 0, e.spec.memorySupport.length > 0], e.id).toEqual([true, true]);
      if (e.category === "ram") expect(e.spec.capacityPerModuleGb * e.spec.modulesInKit, e.id).toBe(e.spec.kitCapacityGb);
      if (e.category === "cooling") expect(e.spec.supportedSockets.length, e.id).toBeGreaterThan(0);
    }
  });

  it("validateCatalog catches a duplicate ID, a missing source, an unresolved CPU reference and a missing translation", () => {
    const first = pcCatalog.entries[0]!;
    const board = pcCatalog.entries.find((e) => e.category === "motherboard")!;
    const broken: PCCatalog = {
      version: "test",
      entries: [
        first,
        { ...first },
        { ...pcCatalog.entries.find((e) => e.category === "fan")!, id: "fan-without-source", sources: [] },
        board.category === "motherboard" ? { ...board, id: "board-bad-ref", spec: { ...board.spec, cpuSupport: [{ cpuId: "no-such-cpu", sinceBios: "1" }] } } : board,
        { ...pcCatalog.entries.find((e) => e.category === "storage")!, id: "storage-no-arabic", description: { en: "A drive.", ar: "" } },
      ],
    };
    const rules = validateCatalog(broken).map((i) => `${i.entryId}:${i.rule}`);
    expect(rules).toContain(`${first.id}:duplicate_id`);
    expect(rules).toContain("fan-without-source:missing_source");
    expect(rules).toContain("board-bad-ref:unresolved_reference");
    expect(rules).toContain("storage-no-arabic:missing_text");
  });

  it("offers exactly two options per category; archived entries stay in the catalog so saved builds still open", () => {
    const offered: PCCatalog = { ...pcCatalog, entries: [...offeredEntries] };
    const counts = countCatalog(offered);
    expect(counts.map((c) => c.category)).toEqual([...PC_PART_CATEGORIES]);
    expect(counts.every((c) => c.total === CATALOG_OPTIONS_PER_CATEGORY)).toBe(true);
    expect(counts.reduce((n, c) => n + c.generic, 0)).toBe(0);
    // No monitor or display cable is offered (decision 11); the only accessory left is none at all.
    expect(offeredEntries.filter((e) => e.category === "monitor" || e.category === "cable")).toEqual([]);
    expect(offeredEntries.flatMap((e) => e.cables).filter((c) => c.kind === "display")).toEqual([]);
    // The CPUs are one Core i5 and one Core i7; the boards give one DDR4 and one DDR5 configuration.
    expect(offeredEntries.filter((e) => e.category === "cpu").map((e) => e.model).sort()).toEqual(["Core i5-14600K", "Core i7-14700K"]);
    expect(offeredEntries.flatMap((e) => (e.category === "motherboard" ? [e.spec.memory.generation] : [])).sort()).toEqual(["ddr4", "ddr5"]);
    expect(offeredEntries.flatMap((e) => (e.category === "ram" ? [e.spec.generation] : [])).sort()).toEqual(["ddr4", "ddr5"]);
    for (const id of ARCHIVED_CATALOG_IDS) expect(pcCatalog.entries.some((e) => e.id === id), id).toBe(true);
    // Finished = asset quality `educational` or better. Placeholders are generated but do not count.
    expect(Object.fromEntries(counts.map((c) => [c.category, c.finishedVisuals]))).toEqual({
      case: 2, motherboard: 2, cpu: 2, ram: 2, gpu: 2, psu: 2, storage: 2, fan: 2, cooling: 2,
    });
    // Every entry has generated files; none claims more than procedural educational geometry.
    expect(pcCatalog.entries.every((e) => e.asset.kind === "procedural" && e.asset.model !== null && e.asset.thumbnail !== null)).toBe(true);
    expect(pcCatalog.entries.every((e) => e.asset.quality === "educational" || e.asset.quality === "placeholder")).toBe(true);
    expect(PC_CONTRACTS_VERSION).toBe(1);
  });

  it("every board supplies the SATA data cables its accessory list names", () => {
    for (const e of offeredEntries) {
      if (e.category !== "motherboard") continue;
      expect(e.cables.find((c) => c.kind === "sata_data"), e.id).toMatchObject({ attachment: "loose", quantity: 2 });
    }
  });
});

describe("M.2 slots, from each board's own manual", () => {
  const slots = (boardId: string) => {
    const board = pcCatalog.entries.find((e) => e.id === boardId)!;
    return { board, m2: Object.fromEntries(board.mountPoints.filter((m) => m.kind === "m2_slot").map((m) => [m.id, m])) as Record<string, Extract<(typeof board.mountPoints)[number], { kind: "m2_slot" }>> };
  };
  const pages = (boardId: string) => pcCatalog.entries.find((e) => e.id === boardId)!.sources.map((s) => s.title).join(" | ");

  it("TUF GAMING Z790-PLUS WIFI and its D4 version: two screwed heatsinks (M.2_1; M.2_3 + M.2_4), M.2_2 bare; Q-Latch, screw stand for short drives in M.2_4", () => {
    for (const [id, manual] of [["asus-tuf-gaming-z790-plus-wifi", "E21279"], ["asus-tuf-gaming-z790-plus-wifi-d4", "E20581"]] as const) {
      const { m2 } = slots(id);
      expect(Object.keys(m2), id).toEqual(["m2-1", "m2-2", "m2-3", "m2-4"]);
      expect(m2["m2-1"]!.heatsink?.id, id).toBe("m2-hs-1");
      expect(m2["m2-2"]!.heatsink, id).toBeUndefined();
      expect(m2["m2-3"]!.heatsink?.id, id).toBe("m2-hs-2");
      expect(m2["m2-4"]!.heatsink?.id, id).toBe("m2-hs-2");
      for (const s of Object.values(m2)) {
        expect(s.retention?.kind, `${id} ${s.id}`).toBe("m2_qlatch");
        if (s.heatsink) expect([s.heatsink.screws, s.heatsink.padFilm], `${id} ${s.id}`).toEqual([2, true]);
        expect(s.keying?.insertTiltDeg, `${id} ${s.id}`).toEqual([15, 35]);
      }
      expect(m2["m2-4"]!.shortRetention, id).toBe("m2_screw");
      expect(m2["m2-1"]!.shortRetention, id).toBeUndefined();
      expect(pages(id), id).toMatch(new RegExp(`${manual} — [^|]*pp\\. 2-7 to 2-12`));
    }
  });

  it("PRIME B760M-A WIFI: one screwed heatsink over M.2_1, M.2_2 bare; a screw stand and a screw, no Q-Latch", () => {
    const { m2 } = slots("asus-prime-b760m-a-wifi");
    expect(Object.keys(m2)).toEqual(["m2-1", "m2-2"]);
    expect(m2["m2-1"]!.heatsink).toMatchObject({ id: "m2-hs-1", screws: 2, padFilm: true });
    expect(m2["m2-2"]!.heatsink).toBeUndefined();
    for (const s of Object.values(m2)) {
      expect(s.retention).toMatchObject({ id: `${s.id}-screw`, kind: "m2_screw" });
      expect(s.fastener).toEqual({ kind: "m2_screw", count: 1 });
      expect(s.retention?.note).not.toMatch(/assumed/);
      expect(s.keying?.insertTiltDeg).toEqual([15, 35]);
    }
    expect(pages("asus-prime-b760m-a-wifi")).toContain("E21693 — p. 1-2 (layout), p. 1-14 (M.2 installation)");
  });
});

describe("CPU cooler mounting, from each cooler's own manual", () => {
  type Mounting = { kind: string; sockets: string[]; backplate: string; kit: { id: string; count: number }[]; frame?: { screws: number }; ring?: { pins: number; positions: { id: string; sockets: string[] }[] }; bodyScrews: { count: number; order: string; verified: boolean } };
  const cooler = (id: string) => pcCatalog.entries.find((e) => e.id === id && e.category === "cooling") as unknown as { spec: { mounting?: Mounting[]; paste?: { supplied: string; film: boolean | null }; connections?: { cableId: string; requirement: string }[] }; sources: { url: string }[]; unverifiedFields: string[]; description: { en: string }; teachingNotes: string[] };
  const on = (id: string, socket: string) => cooler(id).spec.mounting?.find((m) => m.sockets.includes(socket));
  const kit = (m: Mounting | undefined) => Object.fromEntries((m?.kit ?? []).map((k) => [k.id, k.count]));

  it("Freezer 36 and both Liquid Freezer III on LGA1700 are held by the contact frame; the board's backplate is kept", () => {
    for (const id of ["arctic-freezer-36", "arctic-liquid-freezer-iii-240-argb", "arctic-liquid-freezer-iii-280"]) {
      const m = on(id, "lga1700");
      expect([m?.kind, m?.backplate, m?.frame?.screws], id).toEqual(["contact_frame", "retained", 4]);
      expect(kit(m), id).toMatchObject({ "contact-frame": 1, "shoulder-screw": 4, "t20-driver": 1 });
      expect(on(id, "am4"), `${id} AM4 is not modelled`).toBeUndefined();
    }
    expect(on("arctic-freezer-36", "lga1700")?.bodyScrews).toEqual({ count: 2, order: "alternate", verified: false });
    for (const id of ["arctic-liquid-freezer-iii-240-argb", "arctic-liquid-freezer-iii-280"]) {
      expect(on(id, "lga1700")?.bodyScrews, id).toEqual({ count: 2, order: "alternate", verified: true });
      expect(kit(on(id, "lga1700")), id).toMatchObject({ "vrm-fan-module": 1 });
    }
  });

  it("Freezer 7 X on LGA1150 uses its retention ring and 4 pins, with the mounting position matched to the socket", () => {
    const m = on("arctic-freezer-7-x", "lga1150");
    expect([m?.kind, m?.backplate, m?.ring?.pins]).toEqual(["retention_ring", "none", 4]);
    expect(kit(m)).toMatchObject({ "retention-ring": 1, "retention-pin": 4 });
    expect(m?.ring?.positions.map((p) => [p.id, p.sockets.includes("lga1150")])).toEqual([["1700", false], ["1200", true]]);
    expect(m?.ring?.positions.find((p) => p.id === "1700")?.sockets).toEqual(expect.arrayContaining(["lga1700", "lga1851"]));
  });

  it("paste and film as each manual shows them; no compound is named where ARCTIC's own documents disagree", () => {
    for (const id of ["arctic-freezer-36", "arctic-liquid-freezer-iii-240-argb", "arctic-liquid-freezer-iii-280"]) expect(cooler(id).spec.paste, id).toMatchObject({ supplied: "tube", film: true });
    expect(cooler("arctic-freezer-7-x").spec.paste).toMatchObject({ supplied: "pre_applied", film: true });
    const prose = (id: string) => [cooler(id).description.en, ...cooler(id).teachingNotes].join(" ");
    for (const id of ["arctic-freezer-36", "arctic-liquid-freezer-iii-240-argb", "arctic-liquid-freezer-iii-280", "arctic-freezer-7-x"]) expect(prose(id), id).not.toMatch(/MX-[2467]/);
  });

  it("each mechanism cites its manual page, lists what was not verified, and keeps wiring as metadata for Stage 10", () => {
    const urls = (id: string) => cooler(id).sources.map((s) => s.url).join(" ");
    expect(urls("arctic-freezer-36")).toContain("https://support.arctic.de/freezer-36");
    expect(urls("arctic-liquid-freezer-iii-240-argb")).toContain("https://support.arctic.de/liquid-freezer-III-240-A-RGB");
    expect(urls("arctic-liquid-freezer-iii-280")).toContain("https://support.arctic.de/liquid-freezer-III-280");
    expect(urls("arctic-freezer-7-x")).toContain("https://support.arctic.de/freezer7xr3");
    expect(cooler("arctic-freezer-36").unverifiedFields.join(" ")).toMatch(/heatsink screw/i);
    expect(cooler("arctic-freezer-36").unverifiedFields.join(" ")).toMatch(/RAM clearance/i);
    expect(cooler("arctic-liquid-freezer-iii-280").unverifiedFields.join(" ")).toMatch(/radiator screw/i);
    expect(cooler("arctic-freezer-36").spec.connections?.map((c) => [c.cableId, c.requirement])).toEqual([["fan", "required"]]);
    expect(cooler("arctic-liquid-freezer-iii-280").spec.connections?.map((c) => c.cableId).sort()).toEqual(["fan", "pump"]);
    expect(cooler("arctic-liquid-freezer-iii-240-argb").spec.connections?.find((c) => c.cableId === "argb")?.requirement).toBe("optional");
  });

  it("the generic educational cooler keeps the legacy mounting", () => {
    expect(cooler("generic-low-profile-air-cooler").spec.mounting).toBeUndefined();
  });
});
