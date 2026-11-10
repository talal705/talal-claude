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
