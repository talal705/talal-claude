"use client";
// The memory slots' clips as moving parts the learner operates directly: each clip tips out about its
// foot when opened and stands up when closed (a module pressed home closes it). Slots documented with a
// clip at each end get two; others one, at the end the board's documents show (the other end is fixed
// and is not drawn as a clip). What is drawn follows the
// board's `mechanisms` record; the engine decides what may move.
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import type { InstalledPart } from "@ytl/contracts";
import type { PartGeometry, Vec3 } from "./geometry";
import { FINISHES } from "./palette";
import { isTap } from "./tap";
import { useTurn } from "./SocketMechanism";

/** `far`: the slot's (first) moving clip, wherever it is; `near`: the second clip of a two-clip slot. `out`: the way each tips open (+1 toward the slot's bottom end). */
export interface DimmSlotLayout { slotId: string; clipId: string; nearId: string | null; far: { at: Vec3; size: Vec3; out: 1 | -1 }; near: { at: Vec3; size: Vec3; out: 1 | -1 } | null; slot: { at: Vec3; size: Vec3 } }

/** The clips and slot boxes of a board's memory slots, in its own coordinates. */
export function dimmLayout(geometry: PartGeometry | undefined, slots: { id: string; clipId: string; nearId: string | null }[]): DimmSlotLayout[] {
  if (!geometry) return [];
  const solid = (id: string) => geometry.solids.find((s) => s.id === id);
  return slots.flatMap((slot) => {
    const box = solid(slot.id); const far = solid(`${slot.id}-latch`); const near = solid(`${slot.id}-latch-near`);
    if (!box?.size || !far?.size) return [];
    // A clip tips away from the middle of its slot, whichever end it is at.
    const out = (at: Vec3): 1 | -1 => (at[2] >= box.at[2] ? 1 : -1);
    return [{ slotId: slot.id, clipId: slot.clipId, nearId: slot.nearId, far: { at: far.at, size: far.size, out: out(far.at) }, near: near?.size && slot.nearId ? { at: near.at, size: near.size, out: out(near.at) } : null, slot: { at: box.at, size: box.size } }];
  });
}
/** Ids of the board's own static clip solids these replace. */
export const dimmReplaces = (layout: DimmSlotLayout[]) => layout.flatMap((l) => [`${l.slotId}-latch`, ...(l.near ? [`${l.slotId}-latch-near`] : [])]);

const OPEN = (32 * Math.PI) / 180;
const HIT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

function Clip({ at, size, open, outward, glow, reducedMotion, onClick, material, glowMaterial }: { at: Vec3; size: Vec3; open: boolean; outward: 1 | -1; glow: boolean; reducedMotion: boolean; onClick?: () => void; material: THREE.Material; glowMaterial: THREE.Material }) {
  // Pivot at the clip's foot on the slot side; opening tips its top outward (away from the module).
  const turn = useTurn(open ? outward * OPEN : 0, reducedMotion);
  const foot: Vec3 = [at[0], at[1] - size[1] / 2, at[2] - (outward * size[2]) / 2];
  // Only a tap moves the clip: a camera drag that ends on it does not.
  const click = onClick ? (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (isTap(e)) onClick(); } : undefined;
  return (
    <group position={foot}>
      <group ref={turn}>
        <mesh position={[0, size[1] / 2 + 1, (outward * size[2]) / 2]} material={glow ? glowMaterial : material}>
          <boxGeometry args={[size[0], size[1] + 2, size[2]]} />
        </mesh>
        {onClick && (
          <mesh position={[0, size[1] / 2 + 2, (outward * size[2]) / 2]} material={HIT} onClick={click} userData={{ mechanismHandle: true }}
            onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = ""; }}>
            {/* Generous, but no wider than the slot pitch, so a neighbouring slot's clip stays reachable. */}
            <boxGeometry args={[Math.min(size[0] + 1, 9), size[1] + 10, size[2] + 8]} />
          </mesh>
        )}
      </group>
    </group>
  );
}

export function DimmClips({ layout, board, reducedMotion, onClip, glowClip, targetSlot, targetOk }: {
  layout: DimmSlotLayout[];
  board: InstalledPart;
  reducedMotion: boolean;
  onClip?: (slotId: string, near: boolean) => void;
  /** The clip the current step is about. */
  glowClip?: { slotId: string; near: boolean } | null;
  /** The slot the held module is over, and whether it is lined up closely enough to go in. */
  targetSlot?: string | null;
  targetOk?: boolean;
}) {
  const mats = useMemo(() => {
    const f = FINISHES.grey_plastic!;
    return {
      clip: new THREE.MeshStandardMaterial({ color: f.color, metalness: f.metalness, roughness: f.roughness }),
      glow: new THREE.MeshStandardMaterial({ color: f.color, metalness: f.metalness, roughness: f.roughness, emissive: "#38c6ff", emissiveIntensity: 0.6 }),
      target: new THREE.MeshBasicMaterial({ color: "#38c6ff", transparent: true, opacity: 0.28, depthWrite: false }),
      targetOk: new THREE.MeshBasicMaterial({ color: "#4ade80", transparent: true, opacity: 0.32, depthWrite: false }),
    };
  }, []);
  return (
    <group>
      {layout.map((l) => {
        const farOpen = board.mechanisms?.[l.clipId] === "open";
        const nearOpen = l.nearId ? board.mechanisms?.[l.nearId] === "open" : false;
        return (
          <group key={l.slotId}>
            <Clip at={l.far.at} size={l.far.size} open={farOpen} outward={l.far.out} glow={glowClip?.slotId === l.slotId && !glowClip.near} reducedMotion={reducedMotion} onClick={onClip ? () => onClip(l.slotId, false) : undefined} material={mats.clip} glowMaterial={mats.glow} />
            {l.near && <Clip at={l.near.at} size={l.near.size} open={nearOpen} outward={l.near.out} glow={glowClip?.slotId === l.slotId && glowClip.near} reducedMotion={reducedMotion} onClick={onClip ? () => onClip(l.slotId, true) : undefined} material={mats.clip} glowMaterial={mats.glow} />}
            {targetSlot === l.slotId && (
              // The slot the module is over: a thin band over its groove (green once it is lined up), not hiding the key.
              <mesh position={[l.slot.at[0], l.slot.at[1] + l.slot.size[1] / 2 + 0.6, l.slot.at[2]]} material={targetOk ? mats.targetOk : mats.target} raycast={() => null}>
                <boxGeometry args={[l.slot.size[0] + 1, 0.4, l.slot.size[2]]} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
