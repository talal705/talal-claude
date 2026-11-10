import { describe, expect, it } from "vitest";
import type { TargetRect } from "@ytl/contracts";
import { armAngle, nearestPointOn, overlapArea, placeBeside, placeHome, placeRobot, relevantObstacles, type RobotPlacement, type Size } from "./placement";

const viewport: Size = { width: 1280, height: 720 };
const robot: Size = { width: 72, height: 98 };
const rectOf = (p: { x: number; y: number }): TargetRect => ({ ...p, ...robot });
const inside = (p: { x: number; y: number }, v: Size) =>
  p.x >= 0 && p.y >= 0 && p.x + robot.width <= v.width && p.y + robot.height <= v.height;

describe("placeBeside", () => {
  const target: TargetRect = { x: 500, y: 300, width: 200, height: 120 };

  it("stands on the inline-end side: right in LTR, left in RTL", () => {
    const ltr = placeBeside({ target, viewport, robot, direction: "ltr" });
    const rtl = placeBeside({ target, viewport, robot, direction: "rtl" });
    expect(ltr.side).toBe("right");
    expect(ltr.x).toBe(target.x + target.width + 12);
    expect(rtl.side).toBe("left");
    expect(rtl.x + robot.width).toBe(target.x - 12);
  });

  it("never overlaps the target and stays inside the viewport, for targets all over the screen in both directions", () => {
    for (const v of [viewport, { width: 375, height: 667 }]) {
      for (const direction of ["ltr", "rtl"] as const) {
        for (let x = -40; x < v.width; x += 45) {
          for (let y = -20; y < v.height; y += 45) {
            const t: TargetRect = { x, y, width: 150, height: 60 };
            const placed = placeBeside({ target: t, viewport: v, robot, direction });
            expect(placed.coversTarget, `${direction} ${x},${y}`).toBe(false);
            expect(overlapArea(rectOf(placed), t), `${direction} ${x},${y}`).toBe(0);
            expect(inside(placed, v), `${direction} ${x},${y}`).toBe(true);
          }
        }
      }
    }
  });

  it("uses the other side when the inline-end side has no room", () => {
    const atRightEdge: TargetRect = { x: 1150, y: 300, width: 120, height: 60 };
    expect(placeBeside({ target: atRightEdge, viewport, robot, direction: "ltr" }).side).toBe("left");
    const atLeftEdge: TargetRect = { x: 10, y: 300, width: 120, height: 60 };
    expect(placeBeside({ target: atLeftEdge, viewport, robot, direction: "rtl" }).side).toBe("right");
  });

  it("goes below a full-width target at the top (a header) and above one at the bottom", () => {
    const header: TargetRect = { x: 0, y: 0, width: 1280, height: 60 };
    expect(placeBeside({ target: header, viewport, robot, direction: "ltr" }).side).toBe("below");
    const footer: TargetRect = { x: 0, y: 660, width: 1280, height: 60 };
    expect(placeBeside({ target: footer, viewport, robot, direction: "ltr" }).side).toBe("above");
  });

  it("keeps off an avoided rectangle when another side is free", () => {
    const panel: TargetRect = { x: 700, y: 250, width: 400, height: 400 };
    const placed = placeBeside({ target, viewport, robot, direction: "ltr", avoid: [panel] });
    expect(placed.side).toBe("left");
    expect(overlapArea(rectOf(placed), panel)).toBe(0);
  });

  it("honours the preferred order", () => {
    const placed = placeBeside({ target, viewport, robot, direction: "ltr", prefer: ["above", "inline-start"] });
    expect(placed.side).toBe("above");
    expect(placed.y + robot.height).toBe(target.y - 12);
  });

  it("a target that fills the viewport: reports that it cannot stay clear and stays inside the viewport", () => {
    const everything: TargetRect = { x: 0, y: 0, width: 1280, height: 720 };
    const placed = placeBeside({ target: everything, viewport, robot, direction: "ltr" });
    expect(placed.side).toBe("corner");
    expect(placed.coversTarget).toBe(true);
    expect(inside(placed, viewport)).toBe(true);
  });
});

describe("arm aim", () => {
  it("hangs down at 0 and turns toward the target", () => {
    const shoulder = { x: 100, y: 100 };
    expect(armAngle(shoulder, { x: 100, y: 200 })).toBeCloseTo(0);
    expect(armAngle(shoulder, { x: 200, y: 100 })).toBeCloseTo(-90);
    expect(armAngle(shoulder, { x: 0, y: 100 })).toBeCloseTo(90);
    expect(Math.abs(armAngle(shoulder, { x: 100, y: 0 }))).toBeCloseTo(180);
  });

  it("aims at the nearest point of the target", () => {
    const target: TargetRect = { x: 300, y: 100, width: 100, height: 50 };
    expect(nearestPointOn(target, { x: 200, y: 120 })).toEqual({ x: 300, y: 120 });
    expect(nearestPointOn(target, { x: 500, y: 400 })).toEqual({ x: 400, y: 150 });
  });
});

describe("placeRobot with obstacles", () => {
  const full: Size = { width: 72, height: 98 };
  const small: Size = { width: 56, height: 77 };
  const bodyOf = (placed: RobotPlacement, size: Size): TargetRect => ({
    x: placed.x,
    y: placed.y,
    width: size.width * placed.scale,
    height: size.height * placed.scale,
  });
  const coveredArea = (placed: RobotPlacement, size: Size, rects: TargetRect[]) =>
    rects.reduce((sum, rect) => sum + overlapArea(bodyOf(placed, size), rect), 0);
  const insideViewport = (placed: RobotPlacement, size: Size, v: Size) => {
    const body = bodyOf(placed, size);
    return body.x >= 0 && body.y >= 0 && body.x + body.width <= v.width && body.y + body.height <= v.height;
  };

  // The homepage at 1280: three cards in a row with 16px between them, hero text above.
  const wide: Size = { width: 1280, height: 800 };
  const cards: TargetRect[] = [
    { x: 135, y: 405, width: 326, height: 142 },
    { x: 477, y: 405, width: 326, height: 142 },
    { x: 819, y: 405, width: 326, height: 142 },
  ];
  const heroText: TargetRect[] = [
    { x: 410, y: 200, width: 460, height: 90 },
    { x: 320, y: 330, width: 640, height: 28 },
  ];

  it("wide, LTR: does not stand on the next card; takes the free inline-start side", () => {
    const placed = placeRobot({ target: cards[0], viewport: wide, robot: full, direction: "ltr", obstacles: [cards[1], cards[2], ...heroText] });
    expect(placed).toMatchObject({ rule: "beside", scale: 1, covered: 0 });
    expect(placed.x + full.width).toBeLessThanOrEqual(cards[0].x);
    expect(coveredArea(placed, full, [...cards, ...heroText])).toBe(0);
  });

  it("wide, RTL: the first card is on the right and the robot stands outside the grid, not on the second card", () => {
    const panel: TargetRect = { x: 16, y: 285, width: 360, height: 500 };
    const obstacles = [cards[1], cards[0], ...heroText, panel];
    const placed = placeRobot({ target: cards[2], viewport: wide, robot: full, direction: "rtl", obstacles });
    expect(placed).toMatchObject({ rule: "beside", scale: 1, covered: 0 });
    expect(placed.x).toBeGreaterThanOrEqual(cards[2].x + cards[2].width);
    expect(coveredArea(placed, full, [...cards, ...obstacles])).toBe(0);
  });

  it("wide, both directions: the middle card has neighbours on both sides, so the robot goes below it", () => {
    for (const direction of ["ltr", "rtl"] as const) {
      const placed = placeRobot({ target: cards[1], viewport: wide, robot: full, direction, obstacles: [cards[0], cards[2], ...heroText] });
      expect(placed, direction).toMatchObject({ rule: "beside", scale: 1, covered: 0 });
      expect(placed.y, direction).toBeGreaterThanOrEqual(cards[1].y + cards[1].height);
    }
  });

  // The homepage at 375: full-width cards stacked, text right above, the help panel over the lower half.
  const narrow: Size = { width: 375, height: 800 };
  const stacked: TargetRect[] = [
    { x: 16, y: 85, width: 343, height: 165 },
    { x: 16, y: 266, width: 343, height: 165 },
  ];
  const textAbove: TargetRect = { x: 30, y: -40, width: 315, height: 77 };
  const sheet: TargetRect = { x: 12, y: 336, width: 351, height: 452 };

  it("narrow, both directions: shrinks into the gap between the text and the card instead of covering either", () => {
    for (const direction of ["ltr", "rtl"] as const) {
      const obstacles = [stacked[1], textAbove, sheet];
      const placed = placeRobot({ target: stacked[0], viewport: narrow, robot: small, direction, obstacles });
      expect(placed, direction).toMatchObject({ rule: "beside-smaller", scale: 0.5, covered: 0 });
      expect(coveredArea(placed, small, [...stacked, ...obstacles]), direction).toBe(0);
      expect(placed.y + small.height * placed.scale, direction).toBeLessThanOrEqual(stacked[0].y);
      expect(insideViewport(placed, small, narrow), direction).toBe(true);
    }
  });

  it("narrow, two stacked cards near the top of the window: stands in the gap between the cards, covering neither", () => {
    // The homepage at 414 x 760 after a scroll: full-width cards 64 px apart (narrow-screen gap), hero text above the window.
    const view: Size = { width: 414, height: 760 };
    const first: TargetRect = { x: 16, y: 41, width: 381, height: 162 };
    const second: TargetRect = { x: 16, y: 41 + 162 + 64, width: 381, height: 162 };
    const heroLine: TargetRect = { x: 16, y: -20, width: 381, height: 28 };
    // The open help panel fills the lower part of a narrow window.
    const dock: TargetRect = { x: 0, y: 384, width: 414, height: 376 };
    for (const direction of ["ltr", "rtl"] as const) {
      const placed = placeRobot({ target: first, viewport: view, robot: small, direction, obstacles: [second, heroLine, dock] });
      expect(placed.rule, direction).not.toBe("least-overlap");
      expect(coveredArea(placed, small, [first, second, heroLine, dock]), direction).toBe(0);
      expect(insideViewport(placed, small, view), direction).toBe(true);
    }
    // With the old 16 px gap there is no such place: this is what the wider gap is for.
    const tight = placeRobot({ target: first, viewport: view, robot: small, direction: "ltr", obstacles: [{ ...second, y: 41 + 162 + 16 }, heroLine, dock] });
    expect(tight.rule).toBe("least-overlap");
  });

  it("narrow: slides along the edge to the end that is free", () => {
    const label: TargetRect = { x: 16, y: 20, width: 200, height: 60 };
    const placed = placeRobot({ target: stacked[0], viewport: narrow, robot: small, direction: "ltr", obstacles: [label, stacked[1], sheet] });
    // 85px above the card: the full-size robot (77px + gap + margin) does not fit, the next size does.
    expect(placed).toMatchObject({ rule: "beside-smaller", scale: 0.8, covered: 0 });
    expect(placed.x).toBeGreaterThanOrEqual(label.x + label.width);
  });

  it("no room next to the target: takes the nearest free spot and still covers nothing", () => {
    const viewport: Size = { width: 375, height: 667 };
    const target: TargetRect = { x: 16, y: 200, width: 343, height: 120 };
    const obstacles: TargetRect[] = [
      { x: 16, y: 60, width: 343, height: 136 },
      { x: 16, y: 324, width: 343, height: 200 },
    ];
    for (const direction of ["ltr", "rtl"] as const) {
      const placed = placeRobot({ target, viewport, robot: small, direction, obstacles });
      expect(placed.rule, direction).toBe("free-spot");
      expect(placed.covered, direction).toBe(0);
      expect(coveredArea(placed, small, [target, ...obstacles]), direction).toBe(0);
      expect(insideViewport(placed, small, viewport), direction).toBe(true);
    }
  });

  it("nothing free anywhere: smallest size, next to the target, never on the target, and says so", () => {
    const viewport: Size = { width: 375, height: 667 };
    const target: TargetRect = { x: 16, y: 200, width: 343, height: 120 };
    const wall: TargetRect[] = [
      { x: 0, y: 0, width: 375, height: 198 },
      { x: 0, y: 322, width: 375, height: 345 },
    ];
    const placed = placeRobot({ target, viewport, robot: small, direction: "ltr", obstacles: wall });
    expect(placed.rule).toBe("least-overlap");
    expect(placed.scale).toBe(0.5);
    expect(placed.covered).toBeGreaterThan(0);
    expect(overlapArea(bodyOf(placed, small), target)).toBe(0);
    expect(insideViewport(placed, small, viewport)).toBe(true);
  });

  it("never covers the target or an obstacle when it reports covered 0, across many layouts in both directions", () => {
    for (const v of [wide, narrow]) {
      const robot = v.width < 480 ? small : full;
      for (const direction of ["ltr", "rtl"] as const) {
        for (let x = 0; x < v.width - 100; x += 97) {
          for (let y = 0; y < v.height - 60; y += 83) {
            const target: TargetRect = { x, y, width: 180, height: 70 };
            const obstacles = relevantObstacles(
              [
                { x: x + 196, y, width: 180, height: 70 },
                { x: x - 196, y, width: 180, height: 70 },
                { x: v.width / 4, y: y - 60, width: v.width / 2, height: 30 },
              ],
              target,
              v,
            );
            const placed = placeRobot({ target, viewport: v, robot, direction, obstacles });
            const label = `${v.width} ${direction} ${x},${y} ${placed.rule}`;
            expect(overlapArea(bodyOf(placed, robot), target), label).toBe(0);
            expect(insideViewport(placed, robot, v), label).toBe(true);
            if (placed.rule !== "least-overlap") expect(coveredArea(placed, robot, obstacles), label).toBe(0);
          }
        }
      }
    }
  });

  it("the free spot keeps its offset from the target when the page scrolls", () => {
    const viewport: Size = { width: 375, height: 667 };
    const at = (scroll: number) => {
      const target: TargetRect = { x: 16, y: 300 - scroll, width: 343, height: 120 };
      const obstacles: TargetRect[] = [
        { x: 16, y: 160 - scroll, width: 343, height: 136 },
        { x: 16, y: 424 - scroll, width: 343, height: 150 },
      ];
      const placed = placeRobot({ target, viewport, robot: small, direction: "ltr", obstacles });
      return { rule: placed.rule, dx: placed.x - target.x, dy: placed.y - target.y };
    };
    expect(at(7)).toEqual(at(0));
    expect(at(23)).toEqual(at(0));
  });
});

describe("relevantObstacles", () => {
  const viewport: Size = { width: 1280, height: 800 };
  const target: TargetRect = { x: 100, y: 100, width: 300, height: 140 };

  it("drops the target's own label, its container, and anything off screen; keeps neighbours", () => {
    const label: TargetRect = { x: 124, y: 124, width: 120, height: 24 };
    const container: TargetRect = { x: 80, y: 80, width: 1100, height: 400 };
    const same: TargetRect = { ...target };
    const offscreen: TargetRect = { x: 100, y: 900, width: 300, height: 140 };
    const neighbour: TargetRect = { x: 416, y: 100, width: 300, height: 140 };
    const empty: TargetRect = { x: 10, y: 10, width: 0, height: 20 };
    expect(relevantObstacles([label, container, same, offscreen, neighbour, empty], target, viewport)).toEqual([neighbour]);
  });
});

describe("placeHome (idle robot)", () => {
  const full: Size = { width: 72, height: 98 };
  const wide: Size = { width: 1280, height: 800 };
  // The Help button in the bottom inline-end corner, with the slot inside it at its inline-start end.
  const dockLtr: TargetRect = { x: 1154, y: 740, width: 110, height: 44 };
  const slotLtr: TargetRect = { x: 1164, y: 744, width: 30, height: 36 };
  const dockRtl: TargetRect = { x: 16, y: 740, width: 110, height: 44 };
  const slotRtl: TargetRect = { x: 86, y: 744, width: 30, height: 36 };
  const body = (p: { x: number; y: number; scale: number }, robot: Size): TargetRect => ({
    x: p.x,
    y: p.y,
    width: robot.width * p.scale,
    height: robot.height * p.scale,
  });
  const within = (inner: TargetRect, outer: TargetRect) =>
    inner.x >= outer.x - 0.01 &&
    inner.y >= outer.y - 0.01 &&
    inner.x + inner.width <= outer.x + outer.width + 0.01 &&
    inner.y + inner.height <= outer.y + outer.height + 0.01;

  it("wide, empty page: floats full size above the Help button, at its inline-end edge in both directions", () => {
    const ltr = placeHome({ dock: dockLtr, slot: slotLtr, viewport: wide, robot: full, direction: "ltr", narrow: false, isFree: () => true });
    expect(ltr).toMatchObject({ rule: "beside-dock", scale: 1 });
    expect(ltr.x + full.width).toBe(dockLtr.x + dockLtr.width);
    expect(ltr.y + full.height).toBe(dockLtr.y - 8);
    const rtl = placeHome({ dock: dockRtl, slot: slotRtl, viewport: wide, robot: full, direction: "rtl", narrow: false, isFree: () => true });
    expect(rtl).toMatchObject({ rule: "beside-dock", scale: 1, x: dockRtl.x });
  });

  it("wide, content above the button: moves to the free inline-start side instead of covering it", () => {
    const content: TargetRect = { x: 1000, y: 560, width: 280, height: 120 };
    const isFree = (rect: TargetRect) => overlapArea(rect, content) === 0;
    const ltr = placeHome({ dock: dockLtr, slot: slotLtr, viewport: wide, robot: full, direction: "ltr", narrow: false, isFree });
    expect(ltr.rule).toBe("beside-dock");
    expect(overlapArea(body(ltr, full), content)).toBe(0);
    expect(ltr.x + full.width * ltr.scale).toBeLessThanOrEqual(dockLtr.x);
    const mirrored: TargetRect = { x: 0, y: 560, width: 280, height: 120 };
    const rtl = placeHome({
      dock: dockRtl, slot: slotRtl, viewport: wide, robot: full, direction: "rtl", narrow: false,
      isFree: (rect) => overlapArea(rect, mirrored) === 0,
    });
    expect(rtl.rule).toBe("beside-dock");
    expect(rtl.x).toBeGreaterThanOrEqual(dockRtl.x + dockRtl.width);
  });

  it("wide, a low strip of content above the button: uses a smaller size that fits under it", () => {
    const strip: TargetRect = { x: 0, y: 0, width: 1280, height: 660 };
    const beside: TargetRect = { x: 0, y: 660, width: 1150, height: 140 };
    const isFree = (rect: TargetRect) => overlapArea(rect, strip) === 0 && overlapArea(rect, beside) === 0;
    const placed = placeHome({ dock: dockLtr, slot: slotLtr, viewport: wide, robot: full, direction: "ltr", narrow: false, isFree });
    expect(placed).toMatchObject({ rule: "beside-dock", scale: 0.64 });
  });

  it("wide, content everywhere around the button: rests inside the Help button, fully inside its slot", () => {
    for (const [dock, slot, direction] of [[dockLtr, slotLtr, "ltr"], [dockRtl, slotRtl, "rtl"]] as const) {
      const placed = placeHome({ dock, slot, viewport: wide, robot: full, direction, narrow: false, isFree: () => false });
      expect(placed.rule, direction).toBe("in-launcher");
      expect(within(body(placed, full), slot), direction).toBe(true);
    }
  });

  it("narrow: always rests inside the Help button without asking whether the page is free", () => {
    const small: Size = { width: 56, height: 77 };
    const dock: TargetRect = { x: 253, y: 744, width: 110, height: 44 };
    const slot: TargetRect = { x: 263, y: 748, width: 30, height: 36 };
    let asked = 0;
    const placed = placeHome({
      dock, slot, viewport: { width: 375, height: 800 }, robot: small, direction: "ltr", narrow: true,
      isFree: () => { asked += 1; return true; },
    });
    expect(placed.rule).toBe("in-launcher");
    expect(asked).toBe(0);
    expect(within(body(placed, small), slot)).toBe(true);
    expect(placed.scale).toBeCloseTo(36 / 77);
  });

  it("open panel on a wide screen: the dock is tall, and the robot stays inside the viewport or goes into the button", () => {
    const tallDock: TargetRect = { x: 904, y: 272, width: 360, height: 512 };
    const placed = placeHome({ dock: tallDock, slot: slotLtr, viewport: wide, robot: full, direction: "ltr", narrow: false, isFree: () => true });
    expect(placed.rule).toBe("beside-dock");
    const rect = body(placed, full);
    expect(overlapArea(rect, tallDock)).toBe(0);
    expect(rect.y).toBeGreaterThanOrEqual(8);
  });
});
