// Colours of the 3D view that must read against each other: the generic surfaces of parts and the
// workbench they lie on. Kept apart from the scene so the contrast rule can be tested without WebGL.

/**
 * Generic surfaces named by the geometry (`finish`): bare circuit board, gold contacts, anodised metal,
 * moulded plastic, glass, mesh. Metals keep a low metalness: with no environment to reflect, a fully
 * metallic surface would render black.
 */
export const FINISHES: Record<string, { color: string; metalness: number; roughness: number; opacity?: number }> = {
  pcb_black: { color: "#1d2128", metalness: 0.12, roughness: 0.48 },
  pcb_green: { color: "#1f6b46", metalness: 0.12, roughness: 0.48 },
  gold: { color: "#d4a52a", metalness: 0.45, roughness: 0.35 },
  copper: { color: "#b86b3c", metalness: 0.45, roughness: 0.4 },
  nickel: { color: "#c3c7cf", metalness: 0.4, roughness: 0.35 },
  aluminium: { color: "#b4bbc7", metalness: 0.42, roughness: 0.3 },
  black_metal: { color: "#303640", metalness: 0.38, roughness: 0.3 },
  black_plastic: { color: "#252b34", metalness: 0.03, roughness: 0.48 },
  grey_plastic: { color: "#525e70", metalness: 0, roughness: 0.5 },
  white_plastic: { color: "#e6e8ec", metalness: 0, roughness: 0.6 },
  rubber: { color: "#3b3f47", metalness: 0, roughness: 0.95 },
  glass: { color: "#9fb6c9", metalness: 0.1, roughness: 0.1, opacity: 0.25 },
  mesh: { color: "#3a3f49", metalness: 0.2, roughness: 0.8, opacity: 0.85 },
  wood: { color: "#8a5a35", metalness: 0, roughness: 0.8 },
  silicon: { color: "#2b2f37", metalness: 0.1, roughness: 0.4 },
  label: { color: "#d8dbe2", metalness: 0, roughness: 0.6 },
  brushed_mark: { color: "#495364", metalness: 0.25, roughness: 0.35 },
};

/** The wooden bench top and the anti-static mat on it. The mat is mid-grey so dark parts stand out on it. */
export const BENCH_TOP_COLOR = "#6b5541";
export const BENCH_MAT_COLOR = "#86909f";

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG contrast ratio of two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
