import { describe, expect, it } from "vitest";
import { BENCH_MAT_COLOR, FINISHES, contrast } from "./palette";

describe("parts on the workbench", () => {
  it("every dark part surface has at least 3:1 contrast with the bench mat (WCAG non-text contrast)", () => {
    for (const finish of ["pcb_black", "black_metal", "black_plastic", "rubber", "silicon"]) {
      expect(contrast(FINISHES[finish]!.color, BENCH_MAT_COLOR), finish).toBeGreaterThanOrEqual(3);
    }
  });

  it("light surfaces still show on the mat as shapes, never at 1:1", () => {
    for (const finish of ["white_plastic", "nickel", "aluminium", "label", "grey_plastic"]) {
      expect(contrast(FINISHES[finish]!.color, BENCH_MAT_COLOR), finish).toBeGreaterThan(1.4);
    }
  });
});
