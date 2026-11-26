import { describe, expect, it } from "vitest";
import type { InstalledPart } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { pcCatalog } from "../catalog";
import type { PartGeometry, Solid } from "./geometry";
import { withMechanisms } from "./mechanisms";

// Each expansion-slot cover is drawn from its own mechanism state, so the gap in the rear wall is the cover that is out.
const CASE = "corsair-4000d-airflow-black";
const geometry = pc.visual.partGeometry(pcCatalog.entries.find((e) => e.id === CASE)!, pcCatalog.version) as unknown as PartGeometry;
const drawn = (mechanisms: Record<string, "open" | "closed">) =>
  withMechanisms(geometry, { instanceId: "case-1", catalogId: CASE, attachments: [], mechanisms } as InstalledPart)!.solids.filter((s) => s.id.startsWith("slot-covers"));
const plates = (mechanisms: Record<string, "open" | "closed">) => drawn(mechanisms).reduce((n, s) => n + (s.count ?? 1), 0);
const top = (s: Solid) => s.at[1]! + s.size![1]! / 2;
const bottom = (s: Solid) => s.at[1]! - s.size![1]! / 2;

describe("expansion-slot covers in the scene", () => {
  it("draws every cover while all are in, as one unchanged stack", () => {
    const [stack, ...more] = drawn({ "slot-covers:1": "closed", "slot-covers:2": "closed" });
    expect(more).toEqual([]);
    expect(stack).toMatchObject({ id: "slot-covers", count: 7, at: geometry.solids.find((s) => s.id === "slot-covers")!.at });
  });

  it("takes out one cover at a time: the top one first, then the second", () => {
    expect(plates({ "slot-covers:1": "open", "slot-covers:2": "closed" })).toBe(6);
    expect(plates({ "slot-covers:1": "open", "slot-covers:2": "open" })).toBe(5);
    const original = geometry.solids.find((s) => s.id === "slot-covers")!;
    const [rest] = drawn({ "slot-covers:1": "open", "slot-covers:2": "open" });
    // The stack now starts two covers lower and ends where it ended.
    expect(top(rest!)).toBeCloseTo(top(original) - (2 * original.size![1]!) / 7);
    expect(bottom(rest!)).toBeCloseTo(bottom(original));
  });

  it("leaves a gap where only the second cover is out", () => {
    const parts = drawn({ "slot-covers:1": "closed", "slot-covers:2": "open" });
    expect(parts.map((s) => s.count)).toEqual([1, 5]);
    expect(bottom(parts[0]!)).toBeGreaterThan(top(parts[1]!));
  });
});
