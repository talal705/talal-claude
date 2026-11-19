"use client";
// The CPU socket's retention mechanism drawn as moving parts the learner operates directly: the Intel
// load lever and load plate (each turning about its own pivot), or the AMD ZIF lever. Each part has a
// generous, invisible hit area so a small lever is easy to click or tap. What is drawn follows the
// board's `mechanisms` record only: the engine decides what may move (see the reducer), the scene
// shows it and reports clicks.
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { InstalledPart } from "@ytl/contracts";
import type { PartGeometry, Vec3 } from "./geometry";
import { FINISHES } from "./palette";

export interface SocketLayout {
  /** "lga": load lever + load plate (Intel); "zif": a single lever (AMD AM4). */
  kind: "lga" | "zif";
  /** Ids of the board's own static solids this component replaces. */
  replaces: string[];
  centre: Vec3;
  size: Vec3;
  /** Where the lever turns, and its length along +z from there. */
  leverPivot: Vec3;
  leverLength: number;
  /** The plate's hinge line (along x) at the far edge of the socket. */
  plateHinge: Vec3;
  /** The socket's orientation mark (the corner the CPU's gold triangle must sit over). */
  mark: Vec3;
}

/** The socket and its mechanism in the board's own coordinates; null when the board draws no socket. */
export function socketLayout(geometry: PartGeometry | undefined, mountId: string, kind: "lga" | "zif"): SocketLayout | null {
  const socket = geometry?.solids.find((s) => s.id === mountId);
  const lever = geometry?.solids.find((s) => s.id === `${mountId}-lever`);
  if (!socket?.size || !lever) return null;
  const [cx, cy, cz] = socket.at;
  const [sx, sy, sz] = socket.size;
  const top = cy + sy / 2;
  const length = lever.height ?? sz;
  return {
    kind,
    replaces: [`${mountId}-lever`, `${mountId}-load-plate`, `${mountId}-load-plate-far`],
    centre: [cx, cy, cz],
    size: [sx, sy, sz],
    leverPivot: [lever.at[0], lever.at[1], lever.at[2] - length / 2],
    leverLength: length,
    plateHinge: [cx, top + 0.4, cz + sz / 2 - 2],
    mark: [cx - sx / 2 + 3.5, top + 0.25, cz + sz / 2 - 3.5],
  };
}

/** Points the guide robot can point at, in the board's coordinates. */
export function socketPoint(layout: SocketLayout, what: "lever" | "plate" | "mark", moved: { leverUp?: boolean; plateOpen?: boolean } = {}): Vec3 {
  const [px, py, pz] = layout.leverPivot;
  const L = layout.leverLength;
  if (what === "lever") return moved.leverUp ? [px, py + L * 0.7, pz + L * 0.05] : [px, py + 4, pz + L * 0.8];
  const [hx, hy, hz] = layout.plateHinge;
  if (what === "plate") return moved.plateOpen ? [hx, hy + layout.size[2] * 0.45, hz + 2] : [layout.centre[0], layout.centre[1] + layout.size[1] / 2 + 2, layout.centre[2]];
  return layout.mark;
}
/** The lever and plate positions a board's mechanism record describes. */
export const socketMoved = (board: InstalledPart | undefined, retentionId: string, kind: "lga" | "zif") => ({
  leverUp: board?.mechanisms?.[kind === "lga" ? `${retentionId}:lever` : retentionId] === "open",
  plateOpen: kind === "lga" && board?.mechanisms?.[retentionId] === "open",
});

const LEVER_UP = (-100 * Math.PI) / 180;
const PLATE_UP = (105 * Math.PI) / 180;
const ZIF_UP = (-90 * Math.PI) / 180;
const TURN_MS = 450;

const material = (finish: keyof typeof FINISHES, emissive?: string) => {
  const f = FINISHES[finish]!;
  return new THREE.MeshStandardMaterial({ color: f.color, metalness: f.metalness, roughness: f.roughness, ...(emissive ? { emissive, emissiveIntensity: 0.35 } : {}) });
};
// Hit areas: not drawn, but still hit by the pointer (a zero-opacity material keeps the mesh raycastable).
const HIT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

/** A small texture of rows of contacts: socket pins (LGA) or pin holes (AM4). */
function contactTexture(holes: boolean): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = holes ? "#e9e4d6" : "#2a2a2a";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = holes ? "#3a3a3a" : "#d4a52a";
  for (let y = 4; y < size; y += 8) for (let x = 4 + ((y / 8) % 2) * 4; x < size; x += 8) { ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

/** Turns a group about its local x axis towards `target` radians, eased (or at once with reduced motion). */
function useTurn(target: number, reducedMotion: boolean) {
  const ref = useRef<THREE.Group>(null);
  const from = useRef<{ angle: number; start: number } | null>(null);
  const invalidate = useThree((three) => three.invalidate);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reducedMotion || Math.abs(node.rotation.x - target) < 1e-3) { node.rotation.x = target; from.current = null; invalidate(); return; }
    from.current = { angle: node.rotation.x, start: performance.now() };
    invalidate();
  }, [target, reducedMotion, invalidate]);
  useFrame(() => {
    const node = ref.current;
    const f = from.current;
    if (!node || !f) return;
    const t = Math.min(1, (performance.now() - f.start) / TURN_MS);
    const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    node.rotation.x = f.angle + (target - f.angle) * k;
    if (t >= 1) from.current = null;
    invalidate();
  });
  return ref;
}

export function SocketMechanism({ layout, board, retentionId, cpuIn, reducedMotion, onLever, onPlate, highlight }: {
  layout: SocketLayout;
  board: InstalledPart;
  retentionId: string;
  /** A CPU is in the socket (its contacts are covered). */
  cpuIn: boolean;
  reducedMotion: boolean;
  onLever?: () => void;
  onPlate?: () => void;
  /** The part of the mechanism the current step is about (drawn with a soft glow). */
  highlight?: "lever" | "plate" | "mark" | null;
}) {
  const lga = layout.kind === "lga";
  const leverOpen = board.mechanisms?.[lga ? `${retentionId}:lever` : retentionId] === "open";
  const plateOpen = lga && board.mechanisms?.[retentionId] === "open";
  const coverOn = lga && board.mechanisms?.[`${retentionId}:cover`] !== "open";
  const lever = useTurn(leverOpen ? (lga ? LEVER_UP : ZIF_UP) : 0, reducedMotion);
  const plate = useTurn(plateOpen ? PLATE_UP : 0, reducedMotion);
  const mats = useMemo(() => ({
    nickel: material("nickel"), nickelGlow: material("nickel", "#38c6ff"), black: material("black_plastic"), gold: material("gold"), goldGlow: material("gold", "#ffd34d"),
    contacts: new THREE.MeshStandardMaterial({ map: contactTexture(!lga), metalness: 0.3, roughness: 0.5 }),
  }), [lga]);
  useEffect(() => () => { for (const m of Object.values(mats)) { m.dispose(); (m as THREE.MeshStandardMaterial).map?.dispose(); } }, [mats]);

  const [cx, cy, cz] = layout.centre;
  const [sx, sy, sz] = layout.size;
  const top = cy + sy / 2;
  const click = (handler?: () => void) => handler ? (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); handler(); } : undefined;
  const hover = (on: boolean) => (handler?: () => void) => handler ? () => { document.body.style.cursor = on ? "pointer" : ""; } : undefined;
  const plateLength = sz - 4;

  return (
    <group>
      {/* The contacts: visible only while the socket is open and empty (an LGA socket's pins, an AM4 socket's holes). */}
      {(lga ? plateOpen && !coverOn : leverOpen) && !cpuIn && (
        <mesh position={[cx, top + 0.15, cz]} material={mats.contacts}>
          <boxGeometry args={[sx - 14, 0.3, sz - 14]} />
        </mesh>
      )}
      {/* The socket's orientation mark. */}
      <mesh position={layout.mark} material={highlight === "mark" ? mats.goldGlow : mats.gold}>
        <boxGeometry args={[4, 0.5, 4]} />
      </mesh>

      {lga && (
        <group position={layout.plateHinge}>
          <group ref={plate}>
            {/* A frame of four strips with the tongue the lever's cam holds down; it opens about its hinge. */}
            <group position={[0, 0, -plateLength / 2]}>
              {[[0, -plateLength / 2 + 2, sx - 4, 4], [0, plateLength / 2 - 2, sx - 4, 4], [-(sx - 4) / 2 + 2, 0, 4, plateLength], [(sx - 4) / 2 - 2, 0, 4, plateLength]].map(([x, z, w, d], i) => (
                <mesh key={i} position={[x!, 0, z!]} material={highlight === "plate" ? mats.nickelGlow : mats.nickel}>
                  <boxGeometry args={[w!, 0.8, d!]} />
                </mesh>
              ))}
              <mesh position={[0, 0, -plateLength / 2 - 2]} material={mats.nickel}><boxGeometry args={[10, 0.8, 4]} /></mesh>
              {/* The protective cover snapped into the plate until a CPU is locked in. */}
              {coverOn && <mesh position={[0, 1.4, 0]} material={mats.black}><boxGeometry args={[sx - 12, 2.2, plateLength - 10]} /></mesh>}
              {onPlate && (
                <mesh position={[0, 1, 0]} material={HIT} onClick={click(onPlate)} onPointerOver={hover(true)(onPlate)} onPointerOut={hover(false)(onPlate)} userData={{ mechanismHandle: true }}>
                  <boxGeometry args={[sx + 2, 6, plateLength + 4]} />
                </mesh>
              )}
            </group>
          </group>
        </group>
      )}

      <group position={layout.leverPivot}>
        <group ref={lever}>
          <mesh position={[0, 0, layout.leverLength / 2]} rotation={[Math.PI / 2, 0, 0]} material={highlight === "lever" ? mats.nickelGlow : mats.nickel}>
            <cylinderGeometry args={[1.1, 1.1, layout.leverLength, 10]} />
          </mesh>
          {/* The bent end the thumb presses. */}
          <mesh position={[2.5, 0, layout.leverLength]} material={highlight === "lever" ? mats.nickelGlow : mats.nickel}><boxGeometry args={[6, 2, 2.2]} /></mesh>
          {onLever && (
            <mesh position={[1.5, 0, layout.leverLength / 2]} material={HIT} onClick={click(onLever)} onPointerOver={hover(true)(onLever)} onPointerOut={hover(false)(onLever)} userData={{ mechanismHandle: true }}>
              <boxGeometry args={[11, 11, layout.leverLength + 6]} />
            </mesh>
          )}
        </group>
      </group>
      {/* The retention tab the lever locks under. */}
      {lga && <mesh position={[layout.leverPivot[0] + 2.5, layout.leverPivot[1] + 1.2, layout.leverPivot[2] + layout.leverLength - 1]} material={mats.black}><boxGeometry args={[4, 1.2, 4]} /></mesh>}
    </group>
  );
}
