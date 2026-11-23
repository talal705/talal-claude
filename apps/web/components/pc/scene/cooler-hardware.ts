// What the scene draws of the hardware around a CPU socket: the removed socket frame's screw holes, the cooler's
// contact frame, its screws (engaged or tight), the retention ring and pins, the cooler body's own screws and the
// backplate's support. It reads `InstalledPart.hardware` and `prep` only, so what is drawn is the state the engine
// checks (no animation state of its own) and reload and undo draw the same thing.
//
// The positions are schematic: the fasteners sit at the corners of the socket, in the order the controls and the
// robot name them (0, 1, 2, 3 round the frame, so 0 and 2 are opposite corners). The proportions are an educational
// approximation, not the manufacturer's drawing.
import type { InstalledPart } from "@ytl/contracts";
import type { Vec3 } from "./geometry";
import type { SocketLayout } from "./SocketMechanism";

/** empty: the hole only; engaged: screwed in by hand and standing proud; tight: down. */
export type ScrewDraw = "empty" | "engaged" | "tight";
export interface Fastener { id: string; at: Vec3; state: ScrewDraw }
export interface HardwareDraw {
  /** The board's own socket frame (plate, lever and tab) has been taken off. */
  ilmRemoved: boolean;
  frame: { at: Vec3; size: Vec3 } | null;
  frameScrews: Fastener[];
  ring: { at: Vec3; size: Vec3 } | null;
  pins: Fastener[];
  bodyScrews: Fastener[];
  backplate: { at: Vec3; size: Vec3; kind: "padding" | "tape" } | null;
}

const stateOf = (c: string | undefined): ScrewDraw => (c === "2" ? "tight" : c === "1" ? "engaged" : "empty");
const PIN_STATE = (c: string | undefined): ScrewDraw => (c === "1" || c === "2" ? "tight" : "empty");
/** The corners round the socket, so index i and i + 2 are opposite. */
const CORNERS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export function coolerHardwareDraw(board: InstalledPart, cooler: InstalledPart | undefined, layout: SocketLayout): HardwareDraw {
  const [cx, cy, cz] = layout.centre;
  const [sx, sy, sz] = layout.size;
  const top = cy + sy / 2;
  const hw = board.hardware ?? {};
  const ilmRemoved = hw.ilm === "removed";
  const corner = (i: number, outset: number, y: number): Vec3 => [cx + CORNERS[i]![0] * (sx / 2 + outset), y, cz + CORNERS[i]![1] * (sz / 2 + outset)];
  const rise = (s: ScrewDraw, flush: number) => (s === "engaged" ? flush + 3.5 : flush);

  const frameValue = hw.frame_screws ?? "0000";
  const frameScrews: Fastener[] = ilmRemoved
    ? CORNERS.map((_, i) => { const s = stateOf(frameValue[i]); return { id: `frame-screw-${i}`, state: s, at: corner(i, 3, top + (hw.frame === "placed" ? rise(s, 2.2) : 0.3)) }; })
    : [];
  const frame = ilmRemoved && hw.frame === "placed" ? { at: [cx, top + 0.9, cz] as Vec3, size: [sx + 8, 1.6, sz + 8] as Vec3 } : null;

  const placed = (cooler?.attachments.length ?? 0) > 0;
  const bodyValue = cooler?.hardware?.screws;
  const bodyScrews: Fastener[] = placed && bodyValue
    ? [0, 2].map((corner0, n) => { const s = stateOf(bodyValue[n]); return { id: `body-screw-${n}`, state: s, at: corner(corner0, 3, top + 7 + (s === "engaged" ? 3.5 : 0)) }; })
    : [];

  const ringOn = cooler?.hardware?.ring === "placed";
  const ring = ringOn ? { at: [cx, top + 0.6, cz] as Vec3, size: [sx + 26, 1.2, sz + 26] as Vec3 } : null;
  const pinValue = cooler?.hardware?.pins ?? "0000";
  const pins: Fastener[] = ringOn ? CORNERS.map((_, i) => { const s = PIN_STATE(pinValue[i]); return { id: `pin-${i}`, state: s, at: corner(i, 10, top + (s === "tight" ? 2.5 : 1.2)) }; }) : [];

  const support = board.prep?.backplate;
  const backplate = support === "padding" || support === "tape" ? { at: [cx, -1, cz] as Vec3, size: [sx + 24, 1.6, sz + 24] as Vec3, kind: support as "padding" | "tape" } : null;
  return { ilmRemoved, frame, frameScrews, ring, pins, bodyScrews, backplate };
}
