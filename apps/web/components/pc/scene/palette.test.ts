import { describe, expect, it } from "vitest";
import { BENCH_MAT_COLOR, FINISHES, contrast } from "./palette";

describe("parts on the workbench", () => {
  it("part outlines remain readable against the dark walnut surface", () => {
    // Dark component finishes are unchanged; the renderer's existing light outlines define their edges.
    expect(contrast("#e4e4ea", BENCH_MAT_COLOR)).toBeGreaterThanOrEqual(3);
  });

  it("light surfaces still show on the mat as shapes, never at 1:1", () => {
    for (const finish of ["white_plastic", "nickel", "aluminium", "label", "grey_plastic"]) {
      expect(contrast(FINISHES[finish]!.color, BENCH_MAT_COLOR), finish).toBeGreaterThan(1.4);
    }
  });
});
