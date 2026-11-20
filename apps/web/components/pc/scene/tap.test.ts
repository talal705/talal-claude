import { describe, expect, it } from "vitest";
import { isTap, pastSlop, TAP_SLOP_PX } from "./tap";

describe("a tap is not a camera drag", () => {
  it("a release within a few pixels of the press is a tap; a longer travel is a drag that selects nothing", () => {
    expect(isTap({ delta: 0 })).toBe(true);
    expect(isTap({ delta: TAP_SLOP_PX })).toBe(true);
    expect(isTap({ delta: TAP_SLOP_PX + 0.5 })).toBe(false);
    expect(isTap({ delta: 120 })).toBe(false);
  });
  it("a held part only starts moving once the pointer has left the tap radius (a tap never nudges it)", () => {
    expect(pastSlop([100, 100], 103, 104)).toBe(false);
    expect(pastSlop([100, 100], 100 + TAP_SLOP_PX + 1, 100)).toBe(true);
  });
});
