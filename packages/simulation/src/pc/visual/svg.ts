// Draws a 2D thumbnail from a part's geometry: one or more orthographic views side by side, a symbol per
// kind of solid, pin dots where the pin count is stated, and the printed markings. Deterministic; no DOM.
import { extent } from "./build";
import type { PartGeometry, Solid, SolidRole, Vec3 } from "./types";

/** `top`: seen from +y. `front`: seen from +z. `back`: seen from -x (the rear edge of a board, the bracket of a card). `end`: seen from +x (the front of a case). */
export type View = "top" | "front" | "back" | "end";

// Site tokens: glossy black, cyan accent, white text.
const C = { bg: "#05070a", line: "#22d3ee", dim: "#155e75", body: "#0f172a", metal: "#1e293b", slot: "#111827", gold: "#eab308", light: "#67e8f9", text: "#e2e8f0" };
const n = (v: number) => String(Math.round(v * 10) / 10);
/** Marking height in millimetres; set per drawing so it stays readable on large parts. */
let FONT = 3.2;
const GAP = 12;

interface Rect { x: number; y: number; w: number; h: number; depth: number; round: boolean }

const TOWARD_VIEWER: Record<View, Vec3> = { top: [0, 1, 0], front: [0, 0, 1], back: [-1, 0, 0], end: [1, 0, 0] };

function viewSize(g: PartGeometry, view: View): [number, number] {
  const [x, y, z] = g.bounds.size;
  return view === "top" ? [x, z] : view === "front" ? [x, y] : [z, y];
}

function project(s: Solid, view: View, by: number, bz: number): Rect {
  const e = extent(s);
  const round = (s.shape === "cylinder" || s.shape === "rotor") && s.axis === (view === "top" ? "y" : view === "front" ? "z" : "x");
  if (view === "end") return { x: bz - e.max[2], y: by - e.max[1], w: e.max[2] - e.min[2], h: e.max[1] - e.min[1], depth: e.max[0], round };
  if (view === "top") return { x: e.min[0], y: e.min[2], w: e.max[0] - e.min[0], h: e.max[2] - e.min[2], depth: e.max[1], round };
  if (view === "front") return { x: e.min[0], y: by - e.max[1], w: e.max[0] - e.min[0], h: e.max[1] - e.min[1], depth: e.max[2], round };
  return { x: e.min[2], y: by - e.max[1], w: e.max[2] - e.min[2], h: e.max[1] - e.min[1], depth: -e.min[0], round };
}

/** Among solids at the same depth, what is drawn last (on top). */
const PRIORITY: Record<SolidRole, number> = {
  pcb: 0, backplate: 1, heatsink: 2, io_shield: 2, shroud: 3, cooler_keepout: 4, cpu_socket: 5, dimm_slot: 5, pcie_slot: 5, m2_slot: 5,
  edge_connector: 5, bracket: 6, fan: 7, light: 8, port: 9,
  body: 1, panel: 1, tray: 2, bay: 3, fan_mount: 4, radiator_mount: 3, grille: 6, radiator: 2, tube: 4, plate: 5, chip: 6, plug: 8, screen: 6,
};

const box = (r: Rect, fill: string, stroke: string, rx = 0.8) =>
  `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;

function hatch(r: Rect, pitch: number): string {
  let d = "";
  if (r.w >= r.h) for (let x = r.x + pitch; x < r.x + r.w - 0.5; x += pitch) d += `M${n(x)} ${n(r.y + 1)}V${n(r.y + r.h - 1)}`;
  else for (let y = r.y + pitch; y < r.y + r.h - 0.5; y += pitch) d += `M${n(r.x + 1)} ${n(y)}H${n(r.x + r.w - 1)}`;
  return d ? `<path d="${d}" stroke="${C.dim}" stroke-width="0.4" fill="none"/>` : "";
}

/** Pin dots in one or two rows along the longer side, when there is room to tell them apart. */
function pins(r: Rect, count: number): string {
  const rows = count > 4 ? 2 : 1;
  const perRow = Math.ceil(count / rows);
  const along = Math.max(r.w, r.h);
  const across = Math.min(r.w, r.h);
  const step = along / (perRow + 1);
  if (step < 1.1 || across / (rows + 1) < 0.9) return "";
  let out = "";
  for (let row = 0; row < rows; row += 1) {
    for (let i = 0; i < perRow && row * perRow + i < count; i += 1) {
      const a = (i + 1) * step;
      const b = ((row + 1) * across) / (rows + 1);
      const [cx, cy] = r.w >= r.h ? [r.x + a, r.y + b] : [r.x + b, r.y + a];
      out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="0.45"/>`;
    }
  }
  return `<g fill="${C.line}">${out}</g>`;
}

function symbol(s: Solid, r: Rect, facesViewer: boolean): string {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (s.shape === "cylinder" && r.round && s.role === "light") return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r.w / 2)}" fill="${C.light}"/>`;
  if ((s.shape === "cylinder" || s.shape === "rotor") && r.round && s.role === "fan") {
    const rad = r.w / 2;
    let blades = "";
    const count = s.count ?? 9;
    for (let i = 0; i < count; i += 1) {
      const a = (i * 2 * Math.PI) / count;
      blades += `M${n(cx + Math.cos(a) * rad * 0.24)} ${n(cy + Math.sin(a) * rad * 0.24)}Q${n(cx + Math.cos(a + 0.1) * rad * 0.7)} ${n(cy + Math.sin(a + 0.1) * rad * 0.7)} ${n(cx + Math.cos(a + 0.5) * rad * 0.92)} ${n(cy + Math.sin(a + 0.5) * rad * 0.92)}`;
    }
    return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rad)}" fill="${C.bg}" stroke="${C.line}" stroke-width="0.8"/><path d="${blades}" stroke="${C.dim}" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rad * 0.22)}" fill="${C.metal}" stroke="${C.line}" stroke-width="0.6"/>`;
  }
  switch (s.role) {
    case "pcb":
      return box(r, C.body, C.line, Math.min(3, r.h / 2));
    case "heatsink":
      return box(r, C.metal, C.dim) + hatch(r, 3);
    case "shroud":
    case "backplate":
    case "io_shield":
    case "fan":
      return box(r, C.metal, C.dim, Math.min(2, r.h / 2));
    case "bracket":
      return box(r, "#94a3b8", "#cbd5e1", 0.3);
    case "edge_connector":
      return box(r, C.gold, C.gold, 0.2) + hatch(r, 2);
    case "light":
      return box(r, C.light, C.light, 0.5);
    case "cpu_socket": {
      if (!facesViewer) return box(r, C.slot, C.line);
      const inner: Rect = { ...r, x: r.x + r.w * 0.14, y: r.y + r.h * 0.14, w: r.w * 0.72, h: r.h * 0.72 };
      // Frame, contact field and the retention lever along one side.
      return `${box(r, C.slot, C.line, 1.5)}${box(inner, C.metal, C.dim, 0.5)}<path d="M${n(r.x + r.w + 2)} ${n(r.y + 2)}V${n(r.y + r.h - 6)}h-4" stroke="${C.line}" stroke-width="0.8" fill="none"/>`;
    }
    case "cooler_keepout": {
      if (!facesViewer) return "";
      // Outline of the cooler position and its four mounting holes.
      const holes = [0, 1, 2, 3].map((i) => `<circle cx="${n(r.x + (i % 2 ? r.w - 3 : 3))}" cy="${n(r.y + (i > 1 ? r.h - 3 : 3))}" r="1.8" fill="${C.bg}" stroke="${C.line}" stroke-width="0.5"/>`).join("");
      return `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="none" stroke="${C.dim}" stroke-width="0.4" stroke-dasharray="2 2"/>${holes}`;
    }
    case "dimm_slot":
    case "pcie_slot": {
      if (!facesViewer) return box(r, C.slot, C.line);
      const long = r.h > r.w;
      // Latches at the ends.
      const latch = long
        ? `<rect x="${n(r.x - 0.8)}" y="${n(r.y - 2)}" width="${n(r.w + 1.6)}" height="3" fill="${C.line}"/><rect x="${n(r.x - 0.8)}" y="${n(r.y + r.h - 1)}" width="${n(r.w + 1.6)}" height="3" fill="${C.line}"/>`
        : `<rect x="${n(r.x + r.w - 1)}" y="${n(r.y - 0.8)}" width="4" height="${n(r.h + 1.6)}" fill="${C.line}"/>`;
      return box(r, C.slot, C.line) + latch;
    }
    case "m2_slot":
      if (!facesViewer) return box(r, C.metal, C.dim);
      // Connector at one end, stand-off at the other.
      return `${box(r, C.metal, C.dim, 1)}<rect x="${n(r.x)}" y="${n(r.y + 3)}" width="5" height="${n(r.h - 6)}" fill="${C.slot}" stroke="${C.line}" stroke-width="0.5"/><circle cx="${n(r.x + r.w - 4)}" cy="${n(cy)}" r="1.8" fill="${C.bg}" stroke="${C.line}" stroke-width="0.5"/>`;
    case "port":
      return box(r, C.bg, C.line, 0.5) + (facesViewer && s.pins ? pins(r, s.pins) : "");
    case "body":
    case "panel":
      return box(r, C.metal, C.dim, Math.min(2, r.h / 2, r.w / 2));
    case "tray":
    case "bay":
      // An empty place for a part: dashed outline.
      return `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="1.5" fill="${C.body}" stroke="${C.line}" stroke-width="0.6" stroke-dasharray="4 2"/>`;
    case "fan_mount":
      return r.round
        ? `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r.w / 2)}" fill="none" stroke="${C.line}" stroke-width="0.6" stroke-dasharray="4 2"/><path d="M${n(cx - 4)} ${n(cy)}h8M${n(cx)} ${n(cy - 4)}v8" stroke="${C.dim}" stroke-width="0.6"/>`
        : `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="${C.body}" stroke="${C.line}" stroke-width="0.6" stroke-dasharray="4 2"/>`;
    case "radiator_mount":
      return `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="none" stroke="${C.light}" stroke-width="0.5" stroke-dasharray="1.5 1.5"/>`;
    case "radiator":
      return box(r, C.metal, C.dim) + hatch(r, 2);
    case "grille":
      return r.round
        ? [1, 0.72, 0.44].map((k) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n((r.w / 2) * k)}" fill="${k === 1 ? C.bg : "none"}" stroke="${C.dim}" stroke-width="0.7"/>`).join("")
        : box(r, C.bg, C.dim);
    case "tube":
      return box(r, C.slot, C.dim, Math.min(r.w, r.h) / 2);
    case "plate":
      return r.round ? `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r.w / 2)}" fill="${C.bg}" stroke="${C.dim}" stroke-width="0.5"/>` : box(r, C.slot, C.dim, 0.6);
    case "chip":
      return box(r, "#020617", C.dim, 0.4);
    case "plug":
      return box(r, C.bg, C.line, 1);
    case "screen":
      return box(r, "#020617", C.line, 1);
  }
}

/** The printed marking: inside the shape when it fits, otherwise beside it, away from the nearest edge. */
function marking(text: string, r: Rect, vw: number, vh: number, keepClear: boolean): string {
  const tw = text.length * FONT * 0.62;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const t = (x: number, y: number, anchor: string, rotate = 0) =>
    `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" dominant-baseline="central"${rotate ? ` transform="rotate(${rotate} ${n(x)} ${n(y)})"` : ""}>${text}</text>`;
  // A socket that shows its pins keeps its marking outside, so the two do not overprint.
  if (!keepClear && r.w >= tw + 2 && r.h >= FONT + 1) return t(cx, cy, "middle");
  if (!keepClear && r.h >= tw + 2 && r.w >= FONT + 1) return t(cx, cy, "middle", -90);
  // In a narrow strip (an edge view) a marking goes under or over its socket.
  if (vh < 40 && r.y + r.h + FONT + 2 <= vh + 6) return t(cx, r.y + r.h + FONT * 0.8, "middle");
  if (vh < 40) return t(cx, r.y - FONT * 0.8, "middle");
  if (r.y + r.h > vh - 14) return t(cx, r.y - 1.5, "start", -90);
  if (r.x + r.w > vw - 18) return t(r.x - 1.5, cy, "end");
  if (r.x < 18) return t(r.x + r.w + 1.5, cy, "start");
  if (r.y < 14) return t(cx, r.y + r.h + 1.5, "start", 90);
  return t(r.x + r.w + 1.5, cy, "start");
}

/** Marks which catalog element a drawn solid stands for, so a page can attach behaviour without guessing. */
function dataAttrs(g: PartGeometry, s: Solid): string {
  let out = ` data-solid="${s.id}"`;
  for (const [id, m] of Object.entries(g.mounts)) if (m.solid === s.id) out += ` data-mount="${id}"`;
  for (const [id, p] of Object.entries(g.ports)) if (p.solid === s.id) out += ` data-port="${id}"`;
  const zones = Object.entries(g.zones).filter(([, z]) => z.solids.includes(s.id)).map(([id]) => id);
  if (zones.length) out += ` data-zone="${zones.join(" ")}"`;
  return out;
}

function drawView(g: PartGeometry, view: View, main: boolean): string {
  const [vw, vh] = viewSize(g, view);
  // A narrow edge view (a board's back panel) uses smaller markings so neighbouring sockets do not collide.
  const drawingFont = FONT;
  if (vh < 40) FONT = Math.min(FONT, 2.4);
  const toward = TOWARD_VIEWER[view];
  const facing = (s: Solid): boolean => {
    const port = Object.values(g.ports).find((p) => p.solid === s.id);
    const mount = Object.values(g.mounts).find((m) => m.solid === s.id);
    const f = port?.facing ?? mount?.facing ?? s.facing;
    // Solids that are neither a port nor a mount show their detail in the main view.
    return f ? f[0] * toward[0] + f[1] * toward[1] + f[2] * toward[2] > 0.5 : main;
  };
  const items = g.solids
    // Secondary views of a case are cut-aways: the outer panels would hide the fan positions behind them.
    .filter((s) => main || s.role !== "panel")
    .map((s) => ({ s, r: project(s, view, g.bounds.size[1], g.bounds.size[2]) }))
    // Depth in half-millimetre steps: coordinates are rounded to 0.1 mm, and a socket flush with a face must not sort behind it.
    .sort((a, b) => Math.round(a.r.depth * 2) - Math.round(b.r.depth * 2) || PRIORITY[a.s.role] - PRIORITY[b.s.role] || a.s.id.localeCompare(b.s.id));
  const shapes = items.map(({ s, r }) => `<g${dataAttrs(g, s)}>${symbol(s, r, facing(s))}</g>`).join("");
  const texts = items
    // A radiator position seen edge-on shares its line with the fan positions; only those are marked.
    .filter(({ s, r }) => s.label && facing(s) && !(s.role === "radiator_mount" && Math.min(r.w, r.h) < 10))
    .map(({ s, r }) => marking(s.label ?? "", r, vw, vh, s.role === "port" && !!s.pins))
    .join("");
  const out = `${shapes}<g font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${FONT}" fill="${C.text}" stroke="${C.bg}" stroke-width="0.7" paint-order="stroke">${texts}</g>`;
  FONT = drawingFont;
  return out;
}

/**
 * The first view is the main one; a `back` view is placed to its right and any other below it.
 * Each view is a `<g data-view>` so a page can caption it in the reader's language.
 */
export function renderThumbnail(g: PartGeometry, views: View[], title: string): string {
  const pad = 8;
  const [mw, mh] = viewSize(g, views[0] ?? "top");
  FONT = Math.round(Math.min(8, Math.max(3.2, Math.max(mw, mh) / 75)) * 10) / 10;
  let width = mw;
  let height = mh;
  let body = "";
  views.forEach((view, i) => {
    const [vw, vh] = viewSize(g, view);
    let dx = 0;
    let dy = 0;
    if (i > 0 && (view === "back" || view === "end")) {
      dx = width + GAP;
      width = dx + vw;
      height = Math.max(height, vh);
    } else if (i > 0) {
      dy = height + GAP;
      height = dy + vh;
      width = Math.max(width, vw);
    }
    body += `<g data-view="${view}" transform="translate(${n(dx)} ${n(dy)})">${drawView(g, view, i === 0)}</g>`;
  });
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(-pad)} ${n(-pad)} ${n(width + 2 * pad)} ${n(height + 2 * pad)}" role="img" data-catalog-id="${g.catalogId}">` +
    `<title>${esc(title)} — ${esc(g.label.en)}</title>` +
    `<rect x="${n(-pad)}" y="${n(-pad)}" width="${n(width + 2 * pad)}" height="${n(height + 2 * pad)}" fill="${C.bg}"/>` +
    body +
    `</svg>\n`
  );
}
