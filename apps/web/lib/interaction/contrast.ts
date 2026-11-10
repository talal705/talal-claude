// WCAG 2.2 contrast arithmetic (success criteria 1.4.3 and 1.4.11). Pure functions over colour
// values, used by tests that read the design tokens; nothing here touches the DOM.

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)` and `rgba(r, g, b, a)`. Null for anything else. */
export function parseColor(text: string): Rgb | null {
  const value = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    const part = (index: number) => Number.parseInt(digits.slice(index, index + 2), 16);
    return { r: part(0), g: part(2), b: part(4), a: digits.length === 8 ? part(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/.exec(value);
  if (!rgb) return null;
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
  const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
  if ([r, g, b].some((channel) => channel > 255) || a > 1) return null;
  return { r, g, b, a };
}

/** A translucent colour as it appears on an opaque background. */
export function over(top: Rgb, bottom: Rgb): Rgb {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/** Relative luminance as defined by WCAG. */
export function luminance(color: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** Contrast ratio between two colours, 1 to 21. A translucent foreground is first laid over the background. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const shown = foreground.a < 1 ? over(foreground, background) : foreground;
  const [lighter, darker] = [luminance(shown), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastUse =
  /** Body text: 4.5:1. */
  | "text"
  /** Text of at least 24 px, or 18.66 px bold: 3:1. */
  | "large-text"
  /** The boundary or state indicator of a control, a focus indicator, a meaningful graphic: 3:1. */
  | "ui";

export const AA_MINIMUM: Record<ContrastUse, number> = { text: 4.5, "large-text": 3, ui: 3 };

export function meetsAA(foreground: Rgb, background: Rgb, use: ContrastUse): boolean {
  return contrastRatio(foreground, background) >= AA_MINIMUM[use];
}

/** Reads `--name: value;` custom properties from a CSS rule body. */
export function readCustomProperties(css: string, selector = ":root"): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  const body = css.slice(start, css.indexOf("}", start));
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) found[match[1]] = match[2].trim();
  return found;
}
