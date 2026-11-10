import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AA_MINIMUM, contrastRatio, luminance, meetsAA, over, parseColor, readCustomProperties } from "./contrast";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const tokens = readCustomProperties(read("../../app/globals.css"));
const tutorCss = read("../../components/tutor/tutor.module.css");
const color = (name: string) => {
  const parsed = parseColor(tokens[name] ?? name);
  if (!parsed) throw new Error(`not a colour: ${name}`);
  return parsed;
};

describe("contrast arithmetic", () => {
  it("gives the WCAG reference values", () => {
    const white = parseColor("#ffffff")!;
    const black = parseColor("#000")!;
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBe(1);
    // #767676 on white is the well-known 4.54:1 boundary grey.
    expect(contrastRatio(parseColor("#767676")!, white)).toBeCloseTo(4.54, 2);
    expect(luminance(parseColor("#808080")!)).toBeCloseTo(0.2159, 4);
  });

  it("parses hex and rgb forms and rejects anything else", () => {
    expect(parseColor("#0d0d10")).toEqual({ r: 13, g: 13, b: 16, a: 1 });
    expect(parseColor("#FFF")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#ffffff80")?.a).toBeCloseTo(0.502, 2);
    expect(parseColor("rgba(34, 211, 238, 0.12)")).toEqual({ r: 34, g: 211, b: 238, a: 0.12 });
    expect(parseColor("rgb(0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    for (const bad of ["", "red", "#12", "rgb(300, 0, 0)", "var(--text)", "rgba(0,0,0,2)"]) expect(parseColor(bad)).toBeNull();
  });

  it("lays a translucent colour over its background before measuring", () => {
    const half = { r: 255, g: 255, b: 255, a: 0.5 };
    const black = parseColor("#000000")!;
    expect(over(half, black)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    expect(contrastRatio(half, black)).toBeCloseTo(contrastRatio({ r: 127.5, g: 127.5, b: 127.5, a: 1 }, black), 6);
  });

  it("applies 4.5:1 to text and 3:1 to large text and UI parts", () => {
    const grey = parseColor("#8a8a8a")!;
    const white = parseColor("#ffffff")!;
    expect(contrastRatio(grey, white)).toBeGreaterThan(3);
    expect(contrastRatio(grey, white)).toBeLessThan(4.5);
    expect(meetsAA(grey, white, "text")).toBe(false);
    expect(meetsAA(grey, white, "large-text")).toBe(true);
    expect(meetsAA(grey, white, "ui")).toBe(true);
    expect(AA_MINIMUM).toEqual({ text: 4.5, "large-text": 3, ui: 3 });
  });
});

describe("design tokens (apps/web/app/globals.css) against WCAG 2.2 AA", () => {
  const surfaces = ["bg", "surface", "surface-raised"];
  const textColors = ["text", "text-soft", "text-muted", "accent", "accent-strong", "accent-alt", "success", "warning", "danger"];

  it("has the tokens this check reads", () => {
    for (const name of [...surfaces, ...textColors, "border"]) expect(parseColor(tokens[name] ?? ""), name).not.toBeNull();
  });

  it("every text colour reaches 4.5:1 on every surface", () => {
    for (const foreground of textColors) {
      for (const background of surfaces) {
        expect(contrastRatio(color(foreground), color(background)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the dark text used on the accent button reaches 4.5:1 on the accent and on its hover colour", () => {
    for (const dark of ["#03191d", "#04131a"]) {
      expect(contrastRatio(parseColor(dark)!, color("accent"))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(parseColor(dark)!, color("accent-strong"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the focus outline (accent-strong) reaches 3:1 on every surface", () => {
    for (const background of surfaces) expect(meetsAA(color("accent-strong"), color(background), "ui")).toBe(true);
  });

  it("text on the selected-item tint (accent at 12% over a surface) still reaches 4.5:1", () => {
    const tint = over(parseColor("rgba(34, 211, 238, 0.12)")!, color("surface"));
    expect(contrastRatio(color("text"), tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color("accent-strong"), tint)).toBeGreaterThanOrEqual(4.5);
  });

  it("records that the border token is decorative: it is below 3:1 on every surface, so it must not be the only boundary of a control", () => {
    for (const background of surfaces) expect(contrastRatio(color("border"), color(background))).toBeLessThan(3);
  });
});

describe("tutor styles (components/tutor/tutor.module.css)", () => {
  /** The declarations of one class rule. */
  const rule = (selector: string) => {
    const start = tutorCss.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`no rule ${selector}`);
    return tutorCss.slice(start, tutorCss.indexOf("}", start));
  };
  const token = (declarations: string, property: string) => new RegExp(`${property}:\\s*var\\(--([a-z-]+)\\)`).exec(declarations)?.[1];

  it("uses only colour tokens or colours that parse, so every pair can be measured", () => {
    const literals = [...tutorCss.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((match) => match[0]);
    for (const literal of literals) expect(parseColor(literal), literal).not.toBeNull();
  });

  it("the primary button's dark text reaches 4.5:1 on the accent", () => {
    const primary = rule(".primary");
    const text = /(?<!-)color:\s*(#[0-9a-f]+)/.exec(primary)?.[1];
    expect(text).toBeDefined();
    expect(contrastRatio(parseColor(text!)!, color("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the question field's boundary reaches 3:1 against the panel and against its own fill", () => {
    const input = rule(".askInput");
    const border = /border:\s*1px solid var\(--([a-z-]+)\)/.exec(input)?.[1];
    expect(border).toBe("text-muted");
    expect(meetsAA(color(border!), color("surface"), "ui")).toBe(true);
    expect(meetsAA(color(border!), color(token(input, "background")!), "ui")).toBe(true);
  });

  it("small and muted text in the panel reaches 4.5:1 on the panel and on a hint card", () => {
    for (const selector of [".small", ".levelLabel", ".soft", ".evidence"]) {
      const name = token(rule(selector), "(?<!-)color");
      expect(name, selector).toBeDefined();
      for (const background of ["surface", "surface-raised", "bg"]) {
        expect(contrastRatio(color(name!), color(background)), `${selector} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the target marker and the notice borders reach 3:1 on the page", () => {
    expect(/border:\s*2px solid var\(--([a-z-]+)\)/.exec(rule(".ring"))?.[1]).toBe("accent-strong");
    expect(meetsAA(color("accent-strong"), color("bg"), "ui")).toBe(true);
    expect(meetsAA(color("warning"), color("surface"), "ui")).toBe(true);
    expect(meetsAA(color("success"), color("surface"), "ui")).toBe(true);
  });
});
