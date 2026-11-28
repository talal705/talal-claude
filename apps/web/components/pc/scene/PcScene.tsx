"use client";

// The 3D view of a build. It draws what the engine's state says and offers the same actions as the
// list view (pick a part, then a highlighted place); it decides nothing about what is allowed.
// Rendering is on demand: a frame is drawn when something changes, the camera moves, or a fan
// turns, and never in an idle loop.
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SimpleSceneTarget } from "../simple-scene";
import { pcTarget, type InstalledPart, type PCBuildState, type StartupResult, type TargetRect } from "@ytl/contracts";
import { getTargetRegistry } from "@/lib/targets";
import { pc } from "@ytl/simulation";
import { catalogIndex } from "../catalog";
import { pcStore, usePC } from "../pc-client";
import type { AssemblyCandidate } from "@/lib/interaction/assembly";
import type { Frame, PartGeometry, Quat, Solid, Vec3 } from "./geometry";
import { add, boxCorners, compose, inverse, placeCableEnds, placeParts, rotate, scale, workbenchArea, type PlacedCableEnd, type PlacedPart } from "./placement";
import { heldFrame, withMechanisms } from "./mechanisms";
import { PIXEL_RATIO_CAP, sceneStore, selectCableEnd, selectPart, useScene, type CameraCommand, type SceneQuality } from "./scene-store";
import { fitDistance } from "./camera-fit";
import { clickBox, fastenerMarkers, settingHotspots, type FastenerMarker, type Hotspot } from "./controls3d";
import { BENCH_MAT_COLOR, BENCH_TOP_COLOR, FINISHES } from "./palette";
import { useGeometry } from "./use-geometry";
import { HOSE_ROUTES } from "./visual-details";
import { GuideRobot } from "./GuideRobot";
import { WEDGE } from "./wedge";
import { isTap, pastSlop } from "./tap";
import { DimmClips, dimmLayout, dimmReplaces } from "./DimmClips";
import { SocketMechanism, socketLayout, socketMoved, socketPoint } from "./SocketMechanism";
import { coolerHardwareDraw } from "./cooler-hardware";
import type { GuideFocus } from "../guide";
import { avoidObstacles, cableStrands, connectorSize, smoothCableRoute, type Obstacle } from "./cable-visuals";
import { applyDetail, boxRaycast, cylinderRaycast, detailedBox, detailedCylinder, stretchTubeUv, surfaceSet } from "./surface-details";

// ---------- Shared resources: one geometry per shape, one material per look ----------

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 40);
const RING = new THREE.TorusGeometry(1, 0.027, 6, 48).rotateX(Math.PI / 2);
const FAN_BLADE = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(0.15, -0.04);
  shape.bezierCurveTo(0.42, -0.12, 0.86, -0.12, 0.96, 0.19);
  shape.bezierCurveTo(0.82, 0.45, 0.44, 0.48, 0.24, 0.23);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2);
})();
const EDGES = new THREE.EdgesGeometry(BOX);
const CYLINDER_EDGES = new THREE.EdgesGeometry(CYLINDER, 30);
// Dashed lines need distances along each segment; computed once on the shared outline.
new THREE.LineSegments(EDGES).computeLineDistances();
/** Lines and labels are never hit by the pointer or by the hidden-part test. */
const noRaycast = () => null;
const AXIS_TURN: Record<"x" | "y" | "z", THREE.Quaternion> = {
  x: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
  y: new THREE.Quaternion(),
  z: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
};

// Mid tones, each role its own, so shapes read on the black page; cyan is kept for selection.
const ROLE_COLORS: Record<string, string> = {
  pcb: "#2f8f66",
  heatsink: "#9aa1ad",
  fan: "#6c7486",
  shroud: "#565d70",
  backplate: "#6a7389",
  bracket: "#c2c7d1",
  port: "#e2e5ea",
  edge_connector: "#d9ad36",
  io_shield: "#a9afba",
  light: "#8b90a0",
  cpu_socket: "#c9b98f",
  dimm_slot: "#7d86a0",
  pcie_slot: "#8c7fb0",
  m2_slot: "#7fa0a8",
};
const DEFAULT_ROLE_COLOR = "#7b8296";
// Each kind of part has its own hue, so a board, a memory module, a graphics card, a power supply,
// a cooler and a drive can be told apart at a glance; the solid's role then shifts it a little.
const CATEGORY_COLORS: Record<string, string> = {
  case: "#8b93a3",
  motherboard: "#2f8f66",
  cpu: "#c9b98f",
  ram: "#c9773f",
  gpu: "#7c6fd0",
  psu: "#b9a43c",
  storage: "#c0608c",
  cooling: "#4f8fc9",
  fan: "#7fa27a",
  monitor: "#6f7890",
};
const materials = new Map<string, THREE.MeshStandardMaterial>();
function materialFor(role: string, category = ""): THREE.MeshStandardMaterial {
  const key = `${category}:${role}`;
  let material = materials.get(key);
  if (!material) {
    const color = new THREE.Color(ROLE_COLORS[role] ?? DEFAULT_ROLE_COLOR);
    const hue = CATEGORY_COLORS[category];
    // Mostly the part's own hue; the role keeps heatsinks, slots and ports distinguishable within it.
    if (hue) color.lerp(new THREE.Color(hue), role === "port" || role === "edge_connector" ? 0.25 : 0.7);
    // The scene has a soft studio environment (SceneEnvironment), so surfaces may reflect a little.
    const look = ROLE_SURFACE[role] ?? { roughness: 0.62, metalness: 0.05 };
    material = applyDetail(new THREE.MeshStandardMaterial({ color, ...look }), undefined, role);
    materials.set(key, material);
  }
  return material;
}
/** Metal parts of a role read as metal (heatsinks, brackets, contacts); the rest is satin plastic and solder mask. */
const ROLE_SURFACE: Record<string, { roughness: number; metalness: number }> = {
  heatsink: { roughness: 0.34, metalness: 0.72 },
  bracket: { roughness: 0.3, metalness: 0.78 },
  io_shield: { roughness: 0.36, metalness: 0.7 },
  backplate: { roughness: 0.4, metalness: 0.55 },
  edge_connector: { roughness: 0.25, metalness: 0.85 },
  port: { roughness: 0.38, metalness: 0.45 },
  cpu_socket: { roughness: 0.42, metalness: 0.35 },
  pcb: { roughness: 0.48, metalness: 0.08 },
};
/**
 * The finishes named by the geometry, made physically plausible now that there is an environment to
 * reflect: real metals get most of their metalness, plastics stay dielectric. Colours are unchanged.
 */
const FINISH_UPGRADE: Record<string, { metalness: number; roughness: number }> = {
  gold: { metalness: 0.92, roughness: 0.24 },
  copper: { metalness: 0.9, roughness: 0.3 },
  nickel: { metalness: 0.88, roughness: 0.26 },
  aluminium: { metalness: 0.82, roughness: 0.3 },
  black_metal: { metalness: 0.7, roughness: 0.34 },
  brushed_mark: { metalness: 0.6, roughness: 0.3 },
  pcb_black: { metalness: 0.08, roughness: 0.42 },
  pcb_green: { metalness: 0.08, roughness: 0.42 },
  black_plastic: { metalness: 0.02, roughness: 0.4 },
};
const finishMaterials = new Map<string, THREE.MeshStandardMaterial>();
function finishMaterial(finish: string): THREE.MeshStandardMaterial | null {
  const look = FINISHES[finish];
  if (!look) return null;
  let material = finishMaterials.get(finish);
  if (!material) {
    const upgrade = FINISH_UPGRADE[finish];
    material = new THREE.MeshStandardMaterial({
      color: look.color,
      metalness: upgrade?.metalness ?? look.metalness,
      roughness: upgrade?.roughness ?? look.roughness,
      ...(look.opacity !== undefined ? { transparent: true, opacity: look.opacity, depthWrite: false } : {}),
    });
    applyDetail(material, finish, "");
    finishMaterials.set(finish, material);
  }
  return material;
}
/** The material of one solid: lit colour, then its finish, then the role and category colour. */
function solidMaterial(solid: Solid, category: string, lit: string | null): THREE.MeshStandardMaterial {
  if (lit) return litMaterial(lit);
  return (solid.finish && finishMaterial(solid.finish)) || materialFor(solid.role, category);
}

const litMaterials = new Map<string, THREE.MeshStandardMaterial>();
function litMaterial(color: string): THREE.MeshStandardMaterial {
  let material = litMaterials.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 });
    litMaterials.set(color, material);
  }
  return material;
}
/** The edge of every solid: #e4e4ea is 15:1 against the scene's background, far above the 3:1 non-text minimum. */
const EDGE = new THREE.LineBasicMaterial({ color: "#e4e4ea", transparent: true, opacity: 0.1 });
/** A part with no model: dashed lines only, never a filled face. */
const OUTLINE = new THREE.LineDashedMaterial({ color: "#e4e4ea", dashSize: 0.06, gapSize: 0.04 });
const SELECTED = new THREE.LineBasicMaterial({ color: "#67e8f9" });
/** Lets an outline box be clicked without drawing anything. */
const PICK = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const BLADE = new THREE.MeshStandardMaterial({ color: "#d0d4dc", roughness: 0.85 });
const candidateMaterial = (ok: boolean, active: boolean) =>
  new THREE.MeshBasicMaterial({ color: ok ? "#22d3ee" : "#fbbf24", transparent: true, opacity: active ? 0.75 : 0.4, depthTest: false });
const CANDIDATE = { okActive: candidateMaterial(true, true), ok: candidateMaterial(true, false), noActive: candidateMaterial(false, true), no: candidateMaterial(false, false) };

const labelTextures = new Map<string, THREE.CanvasTexture>();
/**
 * The sign on an outline box: the part's name and "no model yet", on a dark plate with a light
 * border so it reads at any camera distance. Drawn once per text into a texture.
 */
function labelTexture(name: string, note: string, rtl: boolean): THREE.CanvasTexture {
  const key = `${name}\n${note}`;
  let texture = labelTextures.get(key);
  if (!texture) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 192;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(8, 8, 10, 0.92)";
    context.strokeStyle = "#e4e4ea";
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(4, 4, 632, 184, 22);
    context.fill();
    context.stroke();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.direction = "ltr";
    context.font = "600 38px system-ui, sans-serif";
    context.fillText(name, 320, 66, 600);
    context.direction = rtl ? "rtl" : "ltr";
    context.fillStyle = "#fbbf24";
    context.font = "600 42px system-ui, sans-serif";
    context.fillText(note, 320, 130, 600);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    labelTextures.set(key, texture);
  }
  return texture;
}

const drawable = (solid: Solid) => (solid.shape === "box" || solid.shape === "cylinder" || solid.shape === "fins" || solid.shape === "rotor" || solid.shape === "ring" || solid.shape === "wedge") && !solid.role.endsWith("_keepout");
/** Empty places for other parts (a tray, a bay, a fan or radiator position): drawn as outlines, never as solid shapes. */
const PLACE_ROLES = new Set(["tray", "bay", "fan_mount", "radiator_mount"]);
const PLACE_EDGE = new THREE.LineDashedMaterial({ color: "#9a9aa6", dashSize: 0.08, gapSize: 0.06 });
/** An empty fan place: two thin concentric rings (frame opening and hub), like the dashed outlines of other places. */
const PLACE_RING = mergeGeometries([new THREE.TorusGeometry(1, 0.012, 6, 72), new THREE.TorusGeometry(0.3, 0.02, 6, 36)])!.rotateX(Math.PI / 2);
const PLACE_RING_MATERIAL = new THREE.MeshBasicMaterial({ color: "#9a9aa6", transparent: true, opacity: 0.55 });

// ---------- Parts ----------

/**
 * A fan rotor: hub and blades, each blade a thin slab turned to its pitch. A plain cylinder `fan` (older
 * files) gets one bar across it so turning can be seen. Turns only while the engine says it spins.
 */
function Fan({ solid, category, spinning, reducedMotion }: { solid: Solid; category: string; spinning: boolean; reducedMotion: boolean }) {
  const rotor = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!spinning || reducedMotion || !rotor.current) return;
    rotor.current.rotation.y += delta * 6;
    state.invalidate();
  });
  const radius = solid.radius ?? 1;
  const height = solid.height ?? 1;
  const blades = solid.shape === "rotor" ? Math.max(3, Math.min(13, solid.count ?? 7)) : 0;
  const bladeMaterial = (solid.finish && finishMaterial(solid.finish)) || BLADE;
  return (
    <group position={solid.at as Vec3 as [number, number, number]} quaternion={AXIS_TURN[solid.axis ?? "y"]}>
      <group ref={rotor}>
        {blades > 0 ? (
          <>
            <mesh geometry={CYLINDER} material={materialFor("fan", category)} scale={[radius * 0.34, height * 0.9, radius * 0.34]} userData={{ fanRotor: solid.id }} castShadow />
            {Array.from({ length: blades }, (_, i) => (
              <group key={i} rotation={[0, (i * 2 * Math.PI) / blades, 0]}>
                <mesh geometry={FAN_BLADE} material={bladeMaterial} scale={[radius * 0.93, radius * 0.93, radius * 0.93]} castShadow />
              </group>
            ))}
          </>
        ) : (
          <>
            <mesh geometry={CYLINDER} material={materialFor("fan", category)} scale={[radius, height, radius]} />
            <lineSegments geometry={CYLINDER_EDGES} material={EDGE} scale={[radius, height, radius]} raycast={noRaycast} />
            <mesh geometry={BOX} material={BLADE} scale={[radius * 1.8, height * 1.2, radius * 0.18]} />
          </>
        )}
      </group>
      {blades > 0 && <mesh geometry={RING} material={finishMaterial("grey_plastic")!} scale={[radius, radius, radius]} raycast={noRaycast} />}
    </group>
  );
}

/** A fin stack: `count` thin plates across the solid's box along its axis. */
function Fins({ solid, material }: { solid: Solid; material: THREE.Material }) {
  const size = (solid.size ?? [1, 1, 1]) as [number, number, number];
  const count = Math.max(1, Math.min(160, solid.count ?? 10));
  const k = solid.axis === "x" ? 0 : solid.axis === "z" ? 2 : 1;
  const pitch = size[k] / count;
  const plate: [number, number, number] = [...size];
  plate[k] = Math.max(0.3, pitch * 0.38);
  const mesh = useMemo(() => {
    const instanced = new THREE.InstancedMesh(BOX, material, count);
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) {
      const offset: [number, number, number] = [0, 0, 0];
      offset[k] = -size[k] / 2 + pitch * (i + 0.5);
      matrix.compose(new THREE.Vector3(...offset), new THREE.Quaternion(), new THREE.Vector3(...plate));
      instanced.setMatrixAt(i, matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    return instanced;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solid.id, material, count, k, pitch, size[0], size[1], size[2]]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

/** One solid of a part, in its own frame: a box, a cylinder or a fin stack, with its outline. */
function SolidView({ solid, category, lit, partId, override }: { solid: Solid; category: string; lit: string | null; partId: string; override?: THREE.MeshStandardMaterial }) {
  const material = override ?? solidMaterial(solid, category, lit);
  if (solid.shape === "wedge") return <mesh geometry={WEDGE} material={material} position={solid.at as [number, number, number]} quaternion={(solid.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]} scale={(solid.size ?? [1, 1, 1]) as [number, number, number]} userData={{ part: partId }} castShadow receiveShadow />;
  if (solid.shape === "ring") return <mesh geometry={RING} material={material} position={solid.at as [number, number, number]} quaternion={AXIS_TURN[solid.axis ?? "y"]} scale={solid.radius ?? 1} userData={{ part: partId }} castShadow receiveShadow />;
  if (solid.shape === "fins") {
    return (
      <group position={solid.at as [number, number, number]} quaternion={(solid.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]}>
        <Fins solid={solid} material={material} />
        {/* The stack's envelope catches clicks; its plates are drawn but not hit-tested one by one. */}
        <mesh geometry={BOX} material={PICK} scale={solid.size as [number, number, number]} userData={{ part: partId }} />
        <lineSegments geometry={EDGES} material={EDGE} scale={solid.size as [number, number, number]} raycast={noRaycast} />
      </group>
    );
  }
  const box = solid.shape === "box";
  const dims: [number, number, number] = box ? (solid.size as [number, number, number]) : [solid.radius ?? 1, solid.height ?? 1, solid.radius ?? 1];
  return (
    <group position={solid.at as [number, number, number]} quaternion={(solid.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]}>
      {/* Real-size geometry (softened edges, texture at true scale); the pointer still hits the plain shape. */}
      <mesh
        geometry={box ? detailedBox(dims[0], dims[1], dims[2]) : detailedCylinder(dims[0], dims[1])}
        material={material}
        quaternion={box ? undefined : AXIS_TURN[solid.axis ?? "y"]}
        raycast={box ? boxRaycast(dims) : cylinderRaycast(dims[0], dims[1])}
        userData={{ part: partId }}
        castShadow={!material.transparent}
        receiveShadow
      />
      {/* Tiny details (screws, surface-mount parts, vent slots) get no outline: their lines would read as white noise. */}
      {!(solid.role === "detail" && Math.min(...dims) < 1.2) && (
        <lineSegments geometry={box ? EDGES : CYLINDER_EDGES} material={EDGE} quaternion={box ? undefined : AXIS_TURN[solid.axis ?? "y"]} scale={dims} raycast={noRaycast} />
      )}
    </group>
  );
}

/** How long a part takes to travel to its new place, and how high it lifts on the way (mm). */
export const MOVE_MS = 720;
const MOVE_LIFT_MM = 90;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Parts in motion, by key: the probe reports when every move has finished. */
const moving = new Set<string>();
/** The drawn group of every part (by instance ID, or `id#group`), so leads can follow a part while it moves. */
const liveGroups = new Map<string, THREE.Group>();

/**
 * A frame that glides to where the build puts it: when `frame` changes, the group travels from where
 * it is drawn now to the new frame, lifting off the bench in an arc and turning on the way. With
 * `animate` off (the detailed lab) or reduced motion, it jumps. Rendering stays on demand: frames are
 * requested only while a move runs.
 */
function FrameGroup({ frame, animate, reducedMotion, moveKey, onClick, children }: { frame: Frame; animate: boolean; reducedMotion: boolean; moveKey: string; onClick?: (event: ThreeEvent<MouseEvent>) => void; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const move = useRef<{ fromAt: THREE.Vector3; fromQuat: THREE.Quaternion; toAt: THREE.Vector3; toQuat: THREE.Quaternion; start: number; lift: number } | null>(null);
  const placedOnce = useRef(false);
  const invalidate = useThree((three) => three.invalidate);
  const [x, y, z] = frame.at;
  const [qx, qy, qz, qw] = frame.quat;
  useLayoutEffect(() => {
    const node = group.current;
    if (!node) return;
    const toAt = new THREE.Vector3(x, y, z);
    const toQuat = new THREE.Quaternion(qx, qy, qz, qw);
    if (!placedOnce.current || !animate || reducedMotion) {
      placedOnce.current = true;
      move.current = null;
      moving.delete(moveKey);
      node.position.copy(toAt);
      node.quaternion.copy(toQuat);
      return;
    }
    if (node.position.distanceTo(toAt) < 0.01 && node.quaternion.angleTo(toQuat) < 1e-4) return;
    const distance = node.position.distanceTo(toAt);
    move.current = { fromAt: node.position.clone(), fromQuat: node.quaternion.clone(), toAt, toQuat, start: performance.now(), lift: Math.min(MOVE_LIFT_MM, distance * 0.35) };
    moving.add(moveKey);
    invalidate();
  }, [x, y, z, qx, qy, qz, qw, animate, reducedMotion, moveKey, invalidate]);
  useEffect(() => () => { moving.delete(moveKey); }, [moveKey]);
  useLayoutEffect(() => {
    const node = group.current;
    if (!node) return;
    liveGroups.set(moveKey, node);
    return () => { if (liveGroups.get(moveKey) === node) liveGroups.delete(moveKey); };
  }, [moveKey]);
  useFrame(() => {
    const node = group.current;
    const current = move.current;
    if (!node || !current) return;
    const t = Math.min(1, (performance.now() - current.start) / MOVE_MS);
    const k = easeInOut(t);
    node.position.lerpVectors(current.fromAt, current.toAt, k);
    node.position.y += Math.sin(Math.PI * k) * current.lift;
    node.quaternion.slerpQuaternions(current.fromQuat, current.toQuat, k);
    if (t >= 1) {
      move.current = null;
      moving.delete(moveKey);
      getTargetRegistry().invalidate();
    }
    invalidate();
  });
  return <group ref={group} onClick={onClick}>{children}</group>;
}

function Part({
  part,
  placed,
  geometry,
  selected,
  lit,
  spinning,
  reducedMotion,
  noModel,
  rtl,
  onSelectPart,
  animate = false,
  hiddenSolids,
  rgb = "off",
}: {
  animate?: boolean;
  /** Optional RGB lighting: `off` draws the part as always; `unlit` shows its diffusers; `lit` lights them. */
  rgb?: "off" | "unlit" | "lit";
  /** Empty places of this part drawn nowhere: fan places covered by a fitted radiator, and that radiator's outline. */
  hiddenSolids?: ReadonlySet<string>;
  part: InstalledPart;
  placed: PlacedPart;
  geometry: PartGeometry | undefined;
  selected: boolean;
  /** Colour of this part's lights, only when the engine reports them lit. */
  lit: string | null;
  spinning: boolean;
  reducedMotion: boolean;
  noModel: string;
  rtl: boolean;
  onSelectPart?: (instanceId: string) => void;
}) {
  const [width, height, depth] = placed.size;
  const centre: [number, number, number] = [width / 2, height / 2, depth / 2];
  const lightSolids = useMemo(() => new Set(geometry?.lights.flatMap((light) => light.solids)), [geometry]);
  const entry = catalogIndex.byId.get(part.catalogId);
  const name = entry ? `${entry.brand} ${entry.model}` : part.instanceId;
  const category = entry?.category ?? "";
  // Signs of parts packed into one case would cover each other: the case always shows its sign, any other part when it is selected.
  const showSign = selected || category === "case";

  function onClick(event: ThreeEvent<MouseEvent>) {
    if (onSelectPart) {
      // A place to install into, or a loose lead, wins over the body it lies on.
      if (event.intersections.some((hit) => hit.object.userData.simpleTarget || hit.object.userData.looseEnd || hit.object.userData.heldHandle || hit.object.userData.mechanismHandle)) return;
      // A camera drag that ends on a part does not pick it up.
      event.stopPropagation(); if (isTap(event)) onSelectPart(part.instanceId); return;
    }
    // While places are offered, a click that also hits a place marker (a slot on a board, the tray
    // in a case) goes on to the marker: parts never swallow it. A click on a part with no marker
    // behind it picks that part instead, dropping the open pick.
    const picking = pcStore.getState().assembly.phase !== "idle";
    if (picking && event.intersections.some((hit) => hit.object.userData.candidate)) return;
    // A loose cable end hangs from this part, often inside its box: the end wins the click.
    if (!picking && event.intersections.some((hit) => hit.object.userData.looseEnd)) return;
    event.stopPropagation();
    if (picking) pcStore.getState().send({ type: "cancel" });
    selectPart(part.instanceId);
    // The same step as "Place…" in the list: the engine lists where it can go.
    if (entry && entry.mounting.some((role) => !part.attachments.some((attachment) => attachment.role === role.role))) {
      sceneStore.setState({ pickInScene: true });
      pcStore.getState().selectPart(part.instanceId);
    }
  }

  // Bodies of a part that are mounted on their own (a cooler's block and radiator) are drawn where they are mounted.
  const mountedGroups = geometry ? Object.entries(placed.groupFrames) : [];
  const groupBodies = mountedGroups.map(([group, frame]) => (
    <FrameGroup key={group} frame={frame} animate={animate} reducedMotion={reducedMotion} moveKey={`${part.instanceId}#${group}`} onClick={onClick}>
      {geometry!.solids
        .filter((solid) => solid.group === group && drawable(solid) && (solid.role !== "rgb" || rgb !== "off"))
        .map((solid) =>
          solid.role === "fan" && (solid.shape === "cylinder" || solid.shape === "rotor") ? (
            <Fan key={solid.id} solid={solid} category={category} spinning={spinning} reducedMotion={reducedMotion} />
          ) : (
            <SolidView key={solid.id} solid={solid} category={category} lit={lit && lightSolids.has(solid.id) ? lit : null} partId={part.instanceId} override={rgbMaterial(solid, rgb)} />
          ),
        )}
    </FrameGroup>
  ));

  return (
    <>
    {groupBodies}
    {geometry && <Hoses geometry={geometry} placed={placed} category={category} />}
    <FrameGroup frame={placed.frame} animate={animate} reducedMotion={reducedMotion} moveKey={part.instanceId} onClick={onClick}>
      {geometry ? (
        geometry.solids.filter((solid) => drawable(solid) && !(solid.group && placed.groupFrames[solid.group]) && !hiddenSolids?.has(solid.id) && (solid.role !== "rgb" || rgb !== "off")).map((solid) =>
          PLACE_ROLES.has(solid.role) && solid.shape === "cylinder" ? (
            // An empty fan place: a thin dashed-looking ring where the fan would sit, not a solid disc.
            <mesh key={solid.id} geometry={PLACE_RING} material={PLACE_RING_MATERIAL} position={solid.at as [number, number, number]} quaternion={AXIS_TURN[solid.axis ?? "y"]} scale={solid.radius ?? 60} raycast={noRaycast} />
          ) : PLACE_ROLES.has(solid.role) && solid.shape === "box" ? (
            <lineSegments
              key={solid.id}
              geometry={EDGES}
              material={PLACE_EDGE}
              position={solid.at as [number, number, number]}
              quaternion={(solid.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]}
              scale={solid.size as [number, number, number]}
              raycast={noRaycast}
            />
          ) : solid.role === "fan" && (solid.shape === "cylinder" || solid.shape === "rotor") ? (
            <Fan key={solid.id} solid={solid} category={category} spinning={spinning} reducedMotion={reducedMotion} />
          ) : (
            <SolidView key={solid.id} solid={solid} category={category} lit={lit && lightSolids.has(solid.id) ? lit : null} partId={part.instanceId} override={rgbMaterial(solid, rgb)} />
          ),
        )
      ) : (
        // No model exists for this part: an outline of its catalog size, labelled as such, never a finished-looking shape.
        <>
          <lineSegments geometry={EDGES} material={OUTLINE} position={centre} scale={[width, height, depth]} raycast={noRaycast} />
          <mesh geometry={BOX} material={PICK} position={centre} scale={[width, height, depth]} userData={{ part: part.instanceId }} />
          {/* A fixed size on screen, so the sign reads from the default camera and from far away. */}
          {showSign && (
            <sprite position={centre} scale={[0.2, 0.06, 1]} renderOrder={20} raycast={noRaycast}>
              <spriteMaterial map={labelTexture(name, noModel, rtl)} transparent depthTest={false} sizeAttenuation={false} />
            </sprite>
          )}
        </>
      )}
      {/* On the guided page a small part on the bench (a CPU, an M.2 drive) gets a finger-sized, invisible tap area. */}
      {animate && placed.onBench && category !== "case" && (
        <mesh geometry={BOX} material={PICK} position={centre} scale={[Math.max(width, 64), Math.max(height, 26), Math.max(depth, 28)]} userData={{ part: part.instanceId }} />
      )}
      {/* The detailed lab keeps its idle, on-demand rendering: only the guided page breathes. */}
      {selected && <SelectionHalo centre={centre} size={[width, height, depth]} reducedMotion={reducedMotion || !animate} />}
    </FrameGroup>
    </>
  );
}

const HALO = new THREE.MeshBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.1, depthWrite: false });
/** The selected part: a bright outline and a soft glowing shell that breathes, so it reads at a glance. */
function SelectionHalo({ centre, size, reducedMotion }: { centre: [number, number, number]; size: [number, number, number]; reducedMotion: boolean }) {
  const shell = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (reducedMotion || !shell.current) return;
    const k = 1.04 + Math.sin(state.clock.elapsedTime * 3.2) * 0.02;
    shell.current.scale.set(size[0] * k + 6, size[1] * k + 6, size[2] * k + 6);
    state.invalidate();
  });
  return (
    <>
      <lineSegments geometry={EDGES} material={SELECTED} position={centre} scale={[size[0] * 1.03 + 2, size[1] * 1.03 + 2, size[2] * 1.03 + 2]} raycast={noRaycast} />
      <mesh ref={shell} geometry={BOX} material={HALO} position={centre} scale={[size[0] * 1.05 + 6, size[1] * 1.05 + 6, size[2] * 1.05 + 6]} raycast={noRaycast} renderOrder={5} />
    </>
  );
}

// ---------- Optional RGB lighting (cosmetic) ----------

/**
 * One shared light colour for every RGB diffuser, driven by `RgbDriver`: a slow hue drift, faded in
 * when the build starts. Restrained: no bloom, emissive well under the parts' own highlights.
 */
const RGB_LIGHT = new THREE.MeshStandardMaterial({ color: "#3a4452", emissive: "#38bdf8", emissiveIntensity: 0, roughness: 0.6, metalness: 0 });
/** A diffuser while the build is off: milky, unlit. */
const RGB_DIFFUSER = new THREE.MeshStandardMaterial({ color: "#d7dde6", roughness: 0.55, metalness: 0, transparent: true, opacity: 0.85 });
/** The material of a solid under the RGB option, or undefined for the part's own. */
function rgbMaterial(solid: Solid, rgb: "off" | "unlit" | "lit"): THREE.MeshStandardMaterial | undefined {
  if (solid.role === "rgb") return rgb === "lit" ? RGB_LIGHT : RGB_DIFFUSER;
  // The RAM's own light bar: lit only with the option on and the build running; otherwise as always.
  if (solid.role === "light" && rgb === "lit") return RGB_LIGHT;
  return undefined;
}

/** Fades the RGB light in or out and drifts its hue; still under reduced motion. */
function RgbDriver({ lit, reducedMotion }: { lit: boolean; reducedMotion: boolean }) {
  const level = useRef(0);
  const hue = useRef(0.53);
  useFrame((frame, delta) => {
    const want = lit ? 1 : 0;
    level.current = reducedMotion ? want : THREE.MathUtils.damp(level.current, want, 2.2, Math.min(delta, 0.05));
    if (!reducedMotion && lit) hue.current = (hue.current + Math.min(delta, 0.05) / 14) % 1;
    // A saturated light on a dark diffuser: coloured, not white, and not brighter than it needs to be.
    RGB_LIGHT.color.setHSL(hue.current, 0.7, 0.18 + 0.12 * (1 - level.current));
    RGB_LIGHT.emissive.setHSL(hue.current, 1, 0.5);
    RGB_LIGHT.emissiveIntensity = 1.15 * level.current;
    if ((!reducedMotion && lit) || Math.abs(level.current - want) > 0.01) frame.invalidate();
  });
  return null;
}

// ---------- Liquid cooler hoses ----------

/** Black sleeved rubber, as on the Liquid Freezer III. */
const HOSE_SLEEVE = new THREE.MeshStandardMaterial({ color: "#1c1f25", roughness: 0.82, metalness: 0.02 });

/**
 * The two hoses of a liquid cooler, from the stubs on its pump block to the fittings on its
 * radiator, wherever each body is (mounted, or on the bench). Drawn only for parts that have both.
 */
function Hoses({ geometry, placed, category }: { geometry: PartGeometry; placed: PlacedPart; category: string }) {
  const stubs = geometry.solids.filter((solid) => solid.role === "tube");
  const fitting = geometry.solids.find((solid) => solid.id === "hose-fittings") ?? geometry.solids.find((solid) => solid.group === "radiator" && solid.role !== "fan");
  const route = HOSE_ROUTES[geometry.catalogId];
  const tubes = useMemo(() => {
    const frameOf = (group: string | undefined) => (group && placed.groupFrames[group]) || placed.frame;
    if (route) {
      // Fittings with a direction: each hose leaves its fitting straight, then bends to the other one,
      // so it clears what lies between (memory, the case's top fans) instead of arching over it.
      const at = (frame: Frame, local: Vec3) => new THREE.Vector3(...compose(frame, { at: local, quat: [0, 0, 0, 1] }).at);
      const way = (frame: Frame, local: Vec3) => new THREE.Vector3(...rotate(frame.quat, local));
      return route.block.flatMap((from, index) => {
        const to = route.radiator[index];
        if (!to) return [];
        const blockFrame = frameOf("block");
        const radiatorFrame = frameOf("radiator");
        const a = at(blockFrame, from.at);
        const b = at(radiatorFrame, to.at);
        const reach = Math.min(48, Math.max(22, a.distanceTo(b) * 0.22));
        const points = [a, a.clone().add(way(blockFrame, from.dir).multiplyScalar(reach * 0.75)), b.clone().add(way(radiatorFrame, to.dir).multiplyScalar(reach)), b];
        return [new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "centripetal"), 64, route.radius, 14, false)];
      });
    }
    if (stubs.length === 0 || !fitting) return [];
    return stubs.map((stub, index) => {
      const from = compose(frameOf(stub.group), { at: stub.at, quat: [0, 0, 0, 1] }).at;
      const fittingFrame = frameOf(fitting.group);
      const to = compose(fittingFrame, { at: add(fitting.at, [(index - (stubs.length - 1) / 2) * 16, 0, 0]), quat: [0, 0, 0, 1] }).at;
      const a = new THREE.Vector3(...from);
      const b = new THREE.Vector3(...to);
      // Hoses are stiff: they bow out rather than sag.
      const middle = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 40 + a.distanceTo(b) * 0.1, 0));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, middle, b]), 32, 6, 10, false);
    });
    // The geometry and frames fully determine the hoses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, placed]);
  useEffect(() => () => tubes.forEach((tube) => tube.dispose()), [tubes]);
  return (
    <>
      {tubes.map((tube, index) => (
        <mesh key={index} geometry={tube} material={route ? HOSE_SLEEVE : materialFor("tube", category)} raycast={noRaycast} castShadow />
      ))}
    </>
  );
}

// ---------- Cables ----------

/** One colour per kind of cable, all clear of the selection cyan. */
/**
 * Sleeving colours: power and fan leads in charcoal (as supplied, but light enough to read against a
 * black case), data and front-panel leads in their usual colours. The selection cyan is kept apart.
 */
const CABLE_COLORS: Record<string, string> = {
  atx_main: "#4a515e",
  cpu_power: "#4a515e",
  gpu_power: "#4a515e",
  gpu_power_adapter: "#4a515e",
  sata_power: "#4a515e",
  peripheral_power: "#4a515e",
  sata_data: "#f472b6",
  fan_lead: "#3f4550",
  pump_lead: "#3f4550",
  lighting_lead: "#fb923c",
  front_panel_lead: "#a78bfa",
  display: "#60a5fa",
};
const cableMaterials = new Map<string, THREE.MeshStandardMaterial>();
function cableMaterial(kind: string): THREE.MeshStandardMaterial {
  let material = cableMaterials.get(kind);
  if (!material) {
    // Braided sleeving: a soft sheen, not a plastic shine.
    material = new THREE.MeshStandardMaterial({ color: CABLE_COLORS[kind] ?? "#4a515e", roughness: 0.5, metalness: 0.1 });
    const braid = surfaceSet()?.braidNormal;
    if (braid) { material.normalMap = braid; material.normalScale.set(0.7, 0.7); }
    cableMaterials.set(kind, material);
  }
  return material;
}
const LOOSE_END = new THREE.MeshStandardMaterial({ color: "#374151", emissive: "#fbbf24", emissiveIntensity: 0.3, roughness: 0.5 });
const SELECTED_END = new THREE.MeshStandardMaterial({ color: "#0e7490", emissive: "#22d3ee", emissiveIntensity: 0.6, roughness: 0.4 });
const CONNECTOR = new THREE.MeshStandardMaterial({ color: "#1c2027", roughness: 0.5, metalness: 0.05 });
const CONTACT = new THREE.MeshStandardMaterial({ color: "#d1b46d", roughness: 0.25, metalness: 0.9 });
const BOOT = new THREE.MeshStandardMaterial({ color: "#2a2f37", roughness: 0.7, metalness: 0 });

/** One bundle along a route: `count` round conductors side by side, merged into one mesh, sleeving at real scale. */
/** The last centre line drawn for each cable and the parts it had to avoid, for the probe's clipping check. */
const drawnRoutes = new Map<string, { line: Vec3[]; obstacles: readonly Obstacle[] }[]>();

function bundleGeometry(route: Vec3[], kind: string, obstacles: readonly Obstacle[], record?: { line: Vec3[]; obstacles: readonly Obstacle[] }[]): THREE.BufferGeometry | null {
  const { count, radius, pitch, rows } = cableStrands(kind);
  const start = new THREE.Vector3(...route[0]);
  const end = new THREE.Vector3(...route[route.length - 1]);
  const along = end.clone().sub(start);
  if (along.length() < 2) return null;
  // The centre line, sampled and bent out of the parts it would pass through; the plug ends stay put.
  const centre = new THREE.CatmullRomCurve3(route.map((at) => new THREE.Vector3(...at)), false, "centripetal").getPoints(40).map((p) => p.toArray() as Vec3);
  const clear = avoidObstacles(centre, obstacles, Math.max(5, (count * pitch) / 2 + radius + 2), 3);
  record?.push({ line: clear, obstacles });
  // The strands lie side by side across the run, flat against the board like a real ribbon.
  let across = along.clone().cross(new THREE.Vector3(0, 0, 1));
  if (across.lengthSq() < 1e-6) across = new THREE.Vector3(1, 0, 0);
  across.normalize();
  // A two-row plug (24-pin, 8-pin) keeps its second row stacked behind the first.
  const behind = across.clone().cross(along).normalize();
  const tubes: THREE.BufferGeometry[] = [];
  for (let row = 0; row < rows; row++) for (let strand = 0; strand < count; strand++) {
    const offset = (strand - (count - 1) / 2) * pitch;
    const depth = (row - (rows - 1) / 2) * pitch * 0.92;
    // Strands converge into the plug at both ends and spread to their ribbon width between.
    const path = clear.map((at, i, all) => {
      const fromEnd = Math.min(i, all.length - 1 - i);
      const share = 0.35 + 0.65 * Math.min(1, fromEnd / 4);
      return new THREE.Vector3(...at).addScaledVector(across, offset * share).addScaledVector(behind, depth * share);
    });
    const curve = new THREE.CatmullRomCurve3(path, false, "centripetal");
    tubes.push(stretchTubeUv(new THREE.TubeGeometry(curve, 64, radius, 8, false), curve.getLength(), radius));
  }
  const merged = mergeGeometries(tubes);
  tubes.forEach((tube) => tube.dispose());
  return merged;
}

/** Where a cable point is held: a spot in the frame of a part, so it moves exactly with that part. */
export interface CableAnchor { hostId: string; local: Vec3; turn?: Quat }

/** How long a plug takes to go into (or come out of) its port, and how far it arcs on the way. */
const PLUG_MS = 420;
const PLUG_ARC_MM = 18;
/** A loose end follows its part with this lag (seconds): the lead trails a little, then settles. */
const TRAIL_S = 0.09;
const SETTLED_MM = 0.05;

/**
 * Sleeved wires and keyed connector housings. A captive lead includes its fixed source.
 *
 * The geometry follows what is drawn, not only the build state: a point held by a part (a plugged
 * end, the lead's source, a loose end hanging from its part) is read from that part's live
 * transform every frame, so while a part glides into place its leads stay attached. A plug that is
 * connected or unplugged travels to its new place on a short arc; a loose end trails its part
 * slightly and settles. None of this changes what the build says is connected.
 */
function Cable({ cableId, kind, ends, fixedSource, orientations, anchors, obstacles, simple = false, selected = false, reducedMotion = false, onSelectSimpleCable }: {
  cableId: string; kind: string; ends: [string, PlacedCableEnd][]; fixedSource?: Vec3; orientations?: ReadonlyMap<string, THREE.Quaternion>;
  /** Point ID ("source", or an end ID) to the part frame that holds it. */
  anchors?: ReadonlyMap<string, CableAnchor>;
  obstacles?: readonly Obstacle[];
  simple?: boolean; selected?: boolean; reducedMotion?: boolean; onSelectSimpleCable?: (cableId: string) => void;
}) {
  const assembly = usePC((store) => store.assembly);
  const invalidate = useThree((three) => three.invalidate);
  const tube = useRef<THREE.Mesh>(null);
  const plugs = useRef(new Map<string, THREE.Group>());
  const ids = useMemo(() => [...(fixedSource ? ["source"] : []), ...ends.map(([endId]) => endId)], [fixedSource, ends]);
  /** What is drawn now, per point; and a plug's move in progress. */
  const shown = useRef(new Map<string, THREE.Vector3>());
  const turns = useRef(new Map<string, THREE.Quaternion>());
  const plugged = useRef(new Map<string, boolean>());
  const moves = useRef(new Map<string, { from: THREE.Vector3; start: number }>());
  const built = useRef<{ key: string; geometry: THREE.BufferGeometry | null }>({ key: "", geometry: null });
  const last = useRef(performance.now());

  /** Where each point should be now: its anchor's live transform, or the build's place for it. */
  const targetOf = (id: string, out: THREE.Vector3): THREE.Vector3 => {
    const anchor = anchors?.get(id);
    const group = anchor && liveGroups.get(anchor.hostId);
    if (anchor && group) {
      group.updateWorldMatrix(true, false);
      return group.localToWorld(out.set(...anchor.local));
    }
    const at = id === "source" ? fixedSource! : ends.find(([endId]) => endId === id)![1].at;
    return out.set(...at);
  };
  const turnOf = (id: string, out: THREE.Quaternion): THREE.Quaternion | null => {
    const anchor = anchors?.get(id);
    const group = anchor?.turn && liveGroups.get(anchor.hostId);
    if (anchor?.turn && group) return group.getWorldQuaternion(out).multiply(scratchQuat.set(...anchor.turn));
    const fixed = orientations?.get(id);
    return fixed ? out.copy(fixed) : null;
  };

  /** Moves the drawn points one step; true while anything is still moving. */
  const step = (now: number, dt: number): boolean => {
    let busy = false;
    for (const id of ids) {
      const target = targetOf(id, scratchVec.clone());
      const isPlugged = id !== "source" && Boolean(ends.find(([endId]) => endId === id)?.[1].plugged);
      let point = shown.current.get(id);
      if (!point) { shown.current.set(id, target.clone()); plugged.current.set(id, isPlugged); continue; }
      const wasPlugged = plugged.current.get(id);
      if (wasPlugged !== undefined && wasPlugged !== isPlugged && !reducedMotion) moves.current.set(id, { from: point.clone(), start: now });
      plugged.current.set(id, isPlugged);
      const move = moves.current.get(id);
      if (move) {
        const t = Math.min(1, (now - move.start) / PLUG_MS);
        // Ease out with a whisper of overshoot, so the plug seats and stops.
        const k = 1 - (1 - t) ** 3 + Math.sin(Math.PI * t) * 0.04 * (1 - t);
        point.lerpVectors(move.from, target, k);
        point.y += Math.sin(Math.PI * t) * PLUG_ARC_MM;
        if (t >= 1) { moves.current.delete(id); point.copy(target); } else busy = true;
      } else if (id === "source" || isPlugged || reducedMotion) {
        // Held by a part: exactly where the part is, every frame.
        point.copy(target);
      } else {
        // Loose: trail the part a little, then settle.
        const share = 1 - Math.exp(-dt / TRAIL_S);
        point.lerp(target, share);
        if (point.distanceTo(target) < SETTLED_MM) point.copy(target); else busy = true;
      }
      const turn = turnOf(id, turns.current.get(id) ?? new THREE.Quaternion());
      if (turn) turns.current.set(id, turn);
    }
    return busy;
  };

  /** Rebuilds the sleeving when the drawn points moved, and places the plugs. */
  const draw = () => {
    const points = ids.map((id) => shown.current.get(id)!.toArray() as Vec3);
    const key = `${points.map((p) => p.map((v) => v.toFixed(2)).join(",")).join("|")}#${obstacles?.length ?? 0}`;
    if (key !== built.current.key) {
      const segments: THREE.BufferGeometry[] = [];
      const record: { line: Vec3[]; obstacles: readonly Obstacle[] }[] = [];
      for (let pair = 1; pair < points.length; pair++) {
        const a = points[pair - 1], b = points[pair];
        if (Math.hypot(...a.map((v, i) => b[i] - v)) < 2) continue;
        const id = ids[pair];
        // A plugged end arrives straight out of its port; a loose one simply lies where it fell.
        const turn = plugged.current.get(id) ? turns.current.get(id) : undefined;
        const facing = turn ? (new THREE.Vector3(0, 1, 0).applyQuaternion(turn).toArray() as Vec3) : undefined;
        const bundle = bundleGeometry(smoothCableRoute(a, b, facing), kind, obstacles ?? [], record);
        if (bundle) segments.push(bundle);
      }
      const geometry = segments.length > 1 ? mergeGeometries(segments) : (segments[0] ?? null);
      if (segments.length > 1) segments.forEach((segment) => segment.dispose());
      built.current.geometry?.dispose();
      built.current = { key, geometry };
      drawnRoutes.set(cableId, record);
      if (tube.current) {
        tube.current.geometry = geometry ?? EMPTY_GEOMETRY;
        tube.current.visible = geometry !== null;
      }
    }
    for (const [id, group] of plugs.current) {
      const at = shown.current.get(id);
      if (at) group.position.copy(at);
      const turn = turns.current.get(id);
      if (turn) group.quaternion.copy(turn);
    }
  };

  // A new build state: take a step at once (so a still scene is right on its first frame), then animate.
  useLayoutEffect(() => {
    const now = performance.now();
    const busy = step(now, 0);
    draw();
    last.current = now;
    if (busy) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ends, fixedSource, anchors, obstacles, orientations]);

  useFrame(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last.current) / 1000);
    last.current = now;
    // Anchored points follow their part even while nothing in this cable changed (the part is gliding).
    const anchoredMoving = ids.some((id) => { const hostId = anchors?.get(id)?.hostId; return hostId !== undefined && moving.has(hostId); });
    if (!anchoredMoving && moves.current.size === 0 && ids.every((id) => { const p = shown.current.get(id); return p && p.distanceTo(targetOf(id, scratchVec)) < SETTLED_MM; })) return;
    const busy = step(now, dt);
    draw();
    if (busy || anchoredMoving) invalidate();
  });

  useEffect(() => () => { built.current.geometry?.dispose(); drawnRoutes.delete(cableId); }, [cableId]);

  const size = connectorSize(kind);
  const strands = cableStrands(kind);
  const bootRadius = Math.max(1.6, (strands.count * strands.pitch) / 2 * 0.7 + strands.radius);
  const housing = detailedBox(size[0], size[1], size[2]);
  return (
    <group>
      <mesh ref={tube} geometry={EMPTY_GEOMETRY} material={selected ? SELECTED_END : cableMaterial(kind)} raycast={noRaycast} castShadow receiveShadow />
      {fixedSource && <mesh geometry={detailedBox(9, 8, 9)} material={CONNECTOR} position={fixedSource as [number, number, number]} raycast={noRaycast} castShadow />}
      {ends.map(([endId, end]) => (
        <group key={endId} ref={(node) => { if (node) plugs.current.set(endId, node); else plugs.current.delete(endId); }} onClick={(event) => {
          if (simple) { event.stopPropagation(); if (isTap(event)) onSelectSimpleCable?.(cableId); return; }
          if (assembly.phase !== "idle") return;
          event.stopPropagation(); selectCableEnd(`${cableId}/${endId}`);
          if (end.plugged) return;
          sceneStore.setState({ pickInScene: true }); pcStore.getState().selectCableEnd(cableId, endId);
        }}>
          {/* Housing (softened edges, same hit box), contacts under it, the retention latch with its
              hook on one side, a darker pin face, and the moulded boot where the wires enter. */}
          <mesh geometry={housing} material={selected ? SELECTED_END : end.plugged ? CONNECTOR : LOOSE_END} raycast={boxRaycast(size)} userData={{ cableEnd: `${cableId}/${endId}`, looseEnd: !end.plugged }} castShadow />
          <mesh geometry={BOX} material={PIN_FACE} position={[0, -size[1] / 2 + 0.2, 0]} scale={[size[0] * 0.86, 0.5, size[2] * 0.86]} raycast={noRaycast} />
          <mesh geometry={BOX} material={CONTACT} position={[0, -size[1] / 2 - 0.3, 0]} scale={[size[0] * 0.76, 0.8, size[2] * 0.76]} userData={{ looseEnd: !end.plugged }} />
          <mesh geometry={BOX} material={CONNECTOR} position={[size[0] / 2 + 0.7, 0, 0]} scale={[1.4, size[1] * 0.5, size[2] * 0.4]} userData={{ looseEnd: !end.plugged }} />
          <mesh geometry={BOX} material={CONNECTOR} position={[size[0] / 2 + 1.2, size[1] * 0.2, 0]} scale={[1, size[1] * 0.35, Math.min(6, size[2] * 0.5)]} raycast={noRaycast} />
          {/* One wire cavity per pin on the back of the housing, in the plug's real rows. */}
          <mesh geometry={pinGrid(kind)} material={PIN_FACE} position={[0, size[1] / 2 + 0.06, 0]} raycast={noRaycast} />
          <mesh geometry={BOOT_GEOMETRY} material={BOOT} position={[0, size[1] / 2 + 2.6, 0]} scale={[Math.min(bootRadius, size[0] / 2), 5.2, Math.min(bootRadius * 0.6 + 1, size[2] / 2)]} raycast={noRaycast} castShadow />
          {!end.plugged && <mesh geometry={BOX} material={PICK} scale={size.map((s) => Math.max(22, s + 8)) as [number, number, number]} userData={{ cableEnd: `${cableId}/${endId}`, looseEnd: true }} />}
        </group>
      ))}
    </group>
  );
}

const scratchVec = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const EMPTY_GEOMETRY = new THREE.BufferGeometry();
/** A strain-relief boot: wider where it meets the housing, tapering toward the wires. */
const BOOT_GEOMETRY = new THREE.CylinderGeometry(0.78, 1, 1, 24);
const PIN_FACE = new THREE.MeshStandardMaterial({ color: "#0d0f13", roughness: 0.8, metalness: 0 });
/** The grid of square wire cavities on a plug's back face, one per wire, built once per kind of lead. */
const pinGrids = new Map<string, THREE.BufferGeometry>();
function pinGrid(kind: string): THREE.BufferGeometry {
  let grid = pinGrids.get(kind);
  if (!grid) {
    const { count, pitch, rows } = cableStrands(kind);
    const [sx, , sz] = connectorSize(kind);
    // The pins run along the housing's longer side; a cavity is a little smaller than its pitch.
    const alongX = sx >= sz;
    const step = Math.min(pitch, ((alongX ? sx : sz) - 2) / Math.max(count, 1));
    const cell = step * 0.62;
    const cells: THREE.BufferGeometry[] = [];
    for (let row = 0; row < rows; row++) for (let i = 0; i < count; i++) {
      const u = (i - (count - 1) / 2) * step;
      const v = (row - (rows - 1) / 2) * Math.min(step, ((alongX ? sz : sx) - 2) / Math.max(rows, 1));
      cells.push(new THREE.BoxGeometry(cell, 0.12, cell).translate(alongX ? u : v, 0, alongX ? v : u));
    }
    grid = cells.length ? mergeGeometries(cells) : new THREE.BufferGeometry();
    cells.forEach((cell) => cell.dispose());
    pinGrids.set(kind, grid);
  }
  return grid;
}


// ---------- Destinations of the picked-up part or cable end ----------

interface CandidateMarker {
  id: string;
  ok: boolean;
  /** Mount point or port ID on the host, for the probe. */
  hostId: string;
  placeId: string;
  frame: Frame;
  /** Size of the marker box (the place plus a margin). */
  size: Vec3;
  /** Direction from which the place is seen, in the scene. */
  facing: Vec3;
}

/** Where each offered place is drawn, from the host's geometry; without geometry the markers float above the host, one per candidate. */
function candidateMarkers(candidates: readonly AssemblyCandidate[], placed: Map<string, PlacedPart>, geometry: ReadonlyMap<string, PartGeometry>, state: PCBuildState): CandidateMarker[] {
  const catalogOf = (instanceId: string) => state.parts.find((part) => part.instanceId === instanceId)?.catalogId ?? "";
  const markers: CandidateMarker[] = [];
  candidates.forEach((candidate, index) => {
    const { action } = candidate;
    let hostId: string;
    let placeId: string;
    let local: { at: Vec3; size?: Vec3; facing?: Vec3; insert?: Vec3 } | undefined;
    if (action.type === "mount_part") {
      hostId = action.target.hostInstanceId;
      placeId = action.target.mountPointId;
      local = geometry.get(catalogOf(hostId))?.mounts[placeId];
    } else if (action.type === "connect_cable_end" && action.to.kind === "part") {
      hostId = action.to.instanceId;
      placeId = action.to.portId;
      local = geometry.get(catalogOf(hostId))?.ports[placeId];
    } else return;
    const host = placed.get(hostId);
    if (!host) return;
    const at = local ? local.at : ([host.size[0] / 2, host.size[1] + 30 + index * 26, host.size[2] / 2] as Vec3);
    const size = local?.size ?? ([22, 22, 22] as Vec3);
    const facing = local?.facing ?? (local?.insert ? scale(local.insert, -1) : ([0, 1, 0] as Vec3));
    markers.push({
      id: candidate.id,
      ok: candidate.ok,
      hostId,
      placeId,
      frame: compose(host.frame, { at, quat: [0, 0, 0, 1] }),
      size: [size[0] + 6, size[1] + 6, size[2] + 6],
      facing: rotate(host.frame.quat, facing),
    });
  });
  return markers;
}

/** The marker rectangles on screen, by `host/place`, for the probe: exactly what the learner clicks. */
const markerRects = new Map<string, () => TargetRect | null>();

function Candidates({ markers }: { markers: CandidateMarker[] }) {
  const activeIndex = usePC((store) => (store.assembly.phase === "idle" ? -1 : store.assembly.activeIndex));
  const activeId = usePC((store) => (store.assembly.phase === "idle" ? null : (store.assembly.candidates[activeIndex]?.id ?? null)));

  useEffect(() => {
    for (const marker of markers) {
      const half = scale(marker.size, -0.5);
      markerRects.set(`${marker.hostId}/${marker.placeId}`, () => screenRect(boxCorners(marker.frame, half, marker.size)));
    }
    return () => markerRects.clear();
  }, [markers]);

  return (
    <>
      {markers.map((marker) => {
        const active = marker.id === activeId;
        return (
          <mesh
            key={marker.id}
            geometry={BOX}
            material={marker.ok ? (active ? CANDIDATE.okActive : CANDIDATE.ok) : active ? CANDIDATE.noActive : CANDIDATE.no}
            position={marker.frame.at as [number, number, number]}
            quaternion={marker.frame.quat as [number, number, number, number]}
            scale={marker.size as [number, number, number]}
            renderOrder={10}
            userData={{ candidate: marker.id }}
            onClick={(event) => {
              event.stopPropagation();
              // A rejected place answers with the engine's reason, read out and shown in the list.
              pcStore.getState().send({ type: "pick", candidateId: marker.id });
            }}
          />
        );
      })}
    </>
  );
}


// ---------- Places to click on the single-PC page ----------

const TARGET_FILL = new THREE.MeshBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.42, depthTest: false, depthWrite: false });
const TARGET_RING = new THREE.MeshBasicMaterial({ color: "#a5f3fc", transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
const TARGET_EDGE = new THREE.LineBasicMaterial({ color: "#67e8f9", depthTest: false, transparent: true });
/** Rectangles of the simple targets by ID, for the probe: exactly what the learner taps. */
const simpleTargetRects = new Map<string, () => TargetRect | null>();
/** The smallest marker side, so a header a few millimetres wide is still a fair target for a finger. */
const MIN_MARKER_MM = 24;
/** A glowing place smaller than this on screen (CSS px) brings the camera closer. */
const MIN_TAP_PX = 32;

/**
 * The place the selected part or lead goes glows and breathes; other slots or headers of the same
 * kind are invisible but clickable, so a wrong choice gets an explanation instead of nothing.
 */
function SimpleTargets({ targets, placed, geometry, state, reducedMotion, onTarget, autoFocus }: {
  targets: readonly SimpleSceneTarget[]; placed: ReadonlyMap<string, PlacedPart>; geometry: ReadonlyMap<string, PartGeometry>; state: PCBuildState; reducedMotion: boolean; onTarget?: (id: string) => void;
  /** Whether offering a small place may glide the camera in to it (and back after). Off on the single-PC page (decision 14). */
  autoFocus: boolean;
}) {
  const pulse = useRef<THREE.Group>(null);
  // With look-alike slots or headers offered beside it, the glowing place keeps (about) its real size,
  // so a click on the neighbour reaches the neighbour and gets its explanation.
  const crowded = targets.some((target) => target.role === "decoy");
  const markers = useMemo(() => targets.flatMap((target) => {
    const host = placed.get(target.hostInstanceId);
    const catalogId = state.parts.find((part) => part.instanceId === target.hostInstanceId)?.catalogId;
    const own = catalogId ? geometry.get(catalogId) : undefined;
    if (!host || !own) return [];
    if (target.kind === "mount") {
      const mount = own.mounts[target.placeId];
      if (!mount) return [];
      // The glowing place is enlarged to be easy to hit; a decoy stays its real size, so it never covers a neighbour.
      const size = (mount.size ?? [24, 24, 24]).map((side) => (target.role === "target" && !crowded ? Math.max(MIN_MARKER_MM, side + 8) : side + (target.role === "target" ? 3 : 1))) as unknown as Vec3;
      // Side by side, the places are thin plates on the board: a tall box would catch a ray aimed past it at its neighbour.
      if (crowded) (size as unknown as number[])[1] = Math.min(size[1], 3);
      const facing = rotate(host.frame.quat, mount.facing ?? scale(mount.insert, -1));
      return [{ target, frame: compose(host.frame, { at: mount.at, quat: mount.quat }), size, facing }];
    }
    const port = own.ports[target.placeId];
    if (!port) return [];
    const size = (port.size ?? [14, 14, 14]).map((side) => (target.role === "target" && !crowded ? Math.max(MIN_MARKER_MM, side + 12) : side + (target.role === "target" ? 5 : 2))) as unknown as Vec3;
    if (crowded) (size as unknown as number[])[1] = Math.min(size[1], 4);
    // Just proud of the header, toward where the plug comes from.
    return [{ target, frame: compose(host.frame, { at: add(port.at, scale(port.facing, 6)), quat: [0, 0, 0, 1] }), size, facing: rotate(host.frame.quat, port.facing) }];
  }), [targets, placed, geometry, state, crowded]);

  useEffect(() => {
    for (const marker of markers) {
      const half = scale(marker.size, -0.5);
      simpleTargetRects.set(marker.target.id, () => screenRect(boxCorners(marker.frame, half, marker.size)));
    }
    getTargetRegistry().invalidate();
    return () => simpleTargetRects.clear();
  }, [markers]);

  // A header is a few millimetres wide: when a lead is picked up, the camera glides in to its port,
  // close enough to tap it (and to tell it from the headers beside it). Parts' places are big enough.
  // The same for a part's place that is too small on screen to tap (a CPU socket on a phone).
  const glowing = markers.find((marker) => marker.target.role === "target");
  const tooSmall = (marker: typeof glowing) => {
    if (!marker) return false;
    const rect = screenRect(boxCorners(marker.frame, scale(marker.size, -0.5), marker.size));
    return rect !== null && Math.min(rect.width, rect.height) < MIN_TAP_PX;
  };
  // Decided once per place: after the camera has come closer the place is no longer small, and must stay focused.
  const focused = useRef<string | null>(null);
  // Never on the single-PC page: there the camera moves only when the learner moves it (Centre, zoom, Close-up).
  if (autoFocus && glowing && focused.current !== glowing.target.id && (glowing.target.kind === "port" || tooSmall(glowing))) focused.current = glowing.target.id;
  const focusKey = autoFocus && glowing && focused.current === glowing.target.id ? glowing.target.id : null;
  if (!glowing) focused.current = null;
  useEffect(() => {
    if (!autoFocus) return;
    const marker = markers.find((item) => item.target.id === focusKey);
    if (!marker || !api) return;
    // Remember the learner's own view once, before the first glide in.
    savedView ??= { target: api.controls.target.clone(), position: api.camera.position.clone() };
    const distance = marker.target.kind === "port" ? 340 : Math.max(340, Math.max(...marker.size) * 3);
    return glideCamera(marker.frame.at, marker.facing, distance, reducedMotion);
    // Only a new port to aim at moves the camera; re-renders of the same one do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, focusKey]);
  // The lead is in (or put down): back to the view the learner had, so the next part is in sight.
  useEffect(() => {
    if (!autoFocus || focusKey || !savedView || !api) return;
    const view = savedView;
    savedView = null;
    glideCameraTo(view.target, view.position, reducedMotion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, focusKey]);

  useFrame((frame) => {
    if (!pulse.current || reducedMotion || markers.length === 0) return;
    const k = 1 + Math.sin(frame.clock.elapsedTime * 4) * 0.12;
    pulse.current.scale.setScalar(k);
    TARGET_FILL.opacity = 0.32 + Math.sin(frame.clock.elapsedTime * 4) * 0.12;
    frame.invalidate();
  });

  return (
    <>
      {markers.map(({ target, frame, size }) => (
        <group key={target.id} position={frame.at as [number, number, number]} quaternion={frame.quat as [number, number, number, number]}>
          <mesh
            geometry={BOX}
            material={target.role === "target" ? TARGET_FILL : PICK}
            scale={size as [number, number, number]}
            renderOrder={30}
            userData={{ simpleTarget: target.id }}
            // The nearest place under the pointer answers; it stops the event, so one behind it does not.
            // A clip or lever in front of it gets the press instead; a camera drag ending here places nothing.
            onClick={(event) => {
              if (event.intersections.some((hit) => hit.object.userData.mechanismHandle)) return;
              event.stopPropagation();
              if (isTap(event)) onTarget?.(target.id);
            }}
          />
          {target.role === "target" && (
            <group ref={pulse}>
              <lineSegments geometry={EDGES} material={TARGET_EDGE} scale={[size[0] + 4, size[1] + 4, size[2] + 4]} raycast={noRaycast} renderOrder={31} />
              <mesh geometry={RING} material={TARGET_RING} scale={Math.min(60, Math.max(12, Math.min(size[0], size[2]) * 0.62 + 6))} raycast={noRaycast} renderOrder={31} />
            </group>
          )}
        </group>
      ))}
    </>
  );
}

// ---------- Fasteners and switches ----------

const FASTENER = new THREE.SphereGeometry(1, 14, 10);
const FASTENER_SECURED = new THREE.MeshStandardMaterial({ color: "#c7ccd6", metalness: 0, roughness: 0.4, emissive: "#4ade80", emissiveIntensity: 0.35 });
const FASTENER_LOOSE = new THREE.MeshStandardMaterial({ color: "#fbbf24", emissive: "#fbbf24", emissiveIntensity: 0.5 });
const SWITCH_ON = new THREE.MeshStandardMaterial({ color: "#4ade80", emissive: "#4ade80", emissiveIntensity: 0.6 });
const SWITCH_OFF = new THREE.MeshStandardMaterial({ color: "#9aa1ad", emissive: "#f87171", emissiveIntensity: 0.35 });
const SWITCH_HANDLE = new THREE.MeshStandardMaterial({ color: "#67e8f9", emissive: "#0e7490", emissiveIntensity: 0.5 });
const PANEL = new THREE.MeshStandardMaterial({ color: "#a5b4c8", transparent: true, opacity: 0.22, depthWrite: false });
const PANEL_OPEN = new THREE.MeshStandardMaterial({ color: "#67e8f9", transparent: true, opacity: 0.08, depthWrite: false });

/** Screen rectangles of the fastener markers (`instanceId/role#index`) and switches (`name`), for the probe. */
const fastenerRects = new Map<string, () => TargetRect | null>();
const hotspotRects = new Map<string, () => TargetRect | null>();
const FASTENER_RADIUS = 7;

/** One marker per fastener of the selected part: a click secures one more, or loosens one that is secured. */
function Fasteners({ part, markers, interactive = true }: { part: InstalledPart; markers: FastenerMarker[]; interactive?: boolean }) {
  useEffect(() => {
    for (const marker of markers) {
      const r = FASTENER_RADIUS + 3;
      fastenerRects.set(`${part.instanceId}/${marker.role}#${marker.index}`, () => screenRect(boxCorners({ at: marker.at, quat: [0, 0, 0, 1] }, [-r, -r, -r], [2 * r, 2 * r, 2 * r])));
    }
    return () => fastenerRects.clear();
  }, [part.instanceId, markers]);
  return (
    <>
      {markers.map((marker) => (
        <mesh
          key={`${marker.role}#${marker.index}`}
          geometry={FASTENER}
          material={marker.secured ? FASTENER_SECURED : FASTENER_LOOSE}
          position={marker.at as [number, number, number]}
          scale={FASTENER_RADIUS}
          renderOrder={9}
          userData={{ fastener: `${marker.role}#${marker.index}` }}
          // The simple page draws the state only: its panel and toolbar take each screw as one checked step.
          {...(interactive ? {} : { raycast: noRaycast })}
          onClick={(event) => {
            if (!interactive || pcStore.getState().assembly.phase !== "idle") return;
            event.stopPropagation();
            const attachment = part.attachments.find((item) => item.role === marker.role);
            if (!attachment) return;
            const secured = marker.secured ? attachment.fastenersSecured - 1 : attachment.fastenersSecured + 1;
            pcStore.getState().act({ type: "set_fasteners", instanceId: part.instanceId, role: marker.role, secured });
          }}
        />
      ))}
    </>
  );
}

/** The case's power button and side panel, the power supply's switch and mains socket. */
function Hotspots({ spots, state }: { spots: Hotspot[]; state: PCBuildState }) {
  useEffect(() => {
    for (const spot of spots) {
      const { frame, size } = clickBox(spot);
      hotspotRects.set(spot.name, () => screenRect(boxCorners(frame, scale(size, -0.5), size)));
    }
    return () => hotspotRects.clear();
  }, [spots]);
  const act = (action: Parameters<ReturnType<typeof pcStore.getState>["act"]>[0]) => {
    const result = pcStore.getState().act(action);
    if (result?.ok && action.type === "press_power") sceneStore.setState((store) => ({ pressSeq: store.pressSeq + 1 }));
  };
  return (
    <>
      {spots.map((spot) => {
        const on =
          spot.name === "power-button" ? state.power.pressed : spot.name === "side-panel" ? !state.sidePanelOpen : spot.name === "psu-switch" ? state.power.psuSwitchOn : state.power.wallConnected;
        // The side panel is drawn whole (glass when closed, a faint outline when open) and never catches a click
        // meant for the parts behind it; it is opened and closed by its handle, a strip along its top edge.
        const material = spot.name === "side-panel" ? SWITCH_HANDLE : on ? SWITCH_ON : SWITCH_OFF;
        const { frame, size } = clickBox(spot);
        const sheet =
          spot.name === "side-panel" ? (
            <mesh
              key="side-panel-sheet"
              geometry={BOX}
              material={on ? PANEL : PANEL_OPEN}
              position={spot.frame.at as [number, number, number]}
              quaternion={spot.frame.quat as [number, number, number, number]}
              scale={spot.size as [number, number, number]}
              raycast={noRaycast}
            />
          ) : null;
        return [
          sheet,
          <mesh
            key={spot.name}
            geometry={BOX}
            material={material}
            position={frame.at as [number, number, number]}
            quaternion={frame.quat as [number, number, number, number]}
            scale={size as [number, number, number]}
            renderOrder={8}
            userData={{ setting: spot.name }}
            onClick={(event) => {
              if (pcStore.getState().assembly.phase !== "idle") return;
              event.stopPropagation();
              if (spot.name === "power-button") act(state.power.pressed ? { type: "power_off" } : { type: "press_power" });
              else if (spot.name === "side-panel") act({ type: "set_side_panel", open: !state.sidePanelOpen });
              else if (spot.name === "psu-switch") act({ type: "set_psu_switch", on: !state.power.psuSwitchOn });
              else act({ type: "set_wall_power", connected: !state.power.wallConnected });
            }}
          />,
        ];
      })}
    </>
  );
}

// ---------- Camera ----------

const OFF_WINDOW: TargetRect = { x: -10000, y: -10000, width: 1, height: 1 };

interface SceneApi {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  invalidate(): void;
}
/** The live scene, for the tutor targets. Null while no scene is mounted. */
let api: SceneApi | null = null;

/** The sphere the default views frame: the build without what stands aside (the monitor). */
function buildSphere(placed: Map<string, PlacedPart>, aside: ReadonlySet<string>): THREE.Sphere {
  const box = new THREE.Box3();
  const framed = [...placed.values()].filter((item) => !aside.has(item.instanceId));
  for (const item of framed.length > 0 ? framed : placed.values()) for (const corner of boxCorners(item.frame, [0, 0, 0], item.size)) box.expandByPoint(new THREE.Vector3(...corner));
  if (box.isEmpty()) box.set(new THREE.Vector3(-150, 0, -150), new THREE.Vector3(150, 150, 150));
  return box.getBoundingSphere(new THREE.Sphere());
}

// A case's frame runs from its rear panel to its front along +x, and from the tray to the open side
// along +z: "Front" looks at the front panel, "Side" through the open side, at the board.
const VIEW_DIRECTIONS: Partial<Record<CameraCommand, [number, number, number]>> = { front: [1, 0.15, 0.05], top: [0.05, 1, 0.35], side: [0.05, 0.2, 1], angle: [0.7, 0.55, 0.9], fit: [0.3, 0.9, 0.8] };
// "Fit" (also the first view) looks down on the workbench from the front, so parts lying on it are seen from above.

function Camera({ placed, aside, ready }: { placed: Map<string, PlacedPart>; aside: ReadonlySet<string>; ready: boolean }) {
  const { camera, gl, scene, invalidate } = useThree();
  const command = useScene((state) => state.camera);
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);
  const sphere = useMemo(() => buildSphere(placed, aside), [placed, aside]);
  // Read by the pan limit below, which outlives a render.
  const bounds = useRef(sphere);
  bounds.current = sphere;
  const partCount = placed.size;
  const initialViewDone = useRef(false);
  const orbitCentre = useRef<THREE.Vector3 | null>(null);
  const lastCommandSeq = useRef(command?.seq);

  useEffect(() => {
    controls.enableDamping = false;
    // The learner's own camera (owner decision, 2026-11-28): orbit at any height, pan (right-drag, Shift-drag or
    // two fingers) and zoom towards the pointer for close details. Only "Focus selected part" and "Reset view" move it
    // otherwise; installing, selecting and re-rendering never do.
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.minDistance = 40;
    controls.maxDistance = 9000;
    const onChange = () => {
      // The pivot stays near the build, so a pan can never lose it (Reset view brings back the whole build).
      const { center, radius } = bounds.current;
      const away = controls.target.clone().sub(center);
      const limit = radius * 1.5 + 200;
      if (away.length() > limit) {
        const back = away.setLength(away.length() - limit);
        controls.target.sub(back);
        camera.position.sub(back);
      }
      invalidate();
      // Whatever the tutor points at moved on screen.
      getTargetRegistry().invalidate();
    };
    const onManualMove = () => { initialViewDone.current = true; };
    controls.addEventListener("start", onManualMove);
    controls.addEventListener("change", onChange);
    api = { camera: camera as THREE.PerspectiveCamera, controls, scene, canvas: gl.domElement, invalidate };
    const host = window as typeof window & { __ytlScene?: SceneProbe };
    host.__ytlScene = probe;
    return () => {
      controls.removeEventListener("start", onManualMove);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      api = null;
      delete host.__ytlScene;
    };
  }, [controls, camera, gl, scene, invalidate]);

  function view(direction: [number, number, number]) {
    const perspective = camera as THREE.PerspectiveCamera;
    // Fit the corners of what is shown to the canvas's own shape, so parts are as large as it allows.
    const centrePoint = (orbitCentre.current ??= sphere.center.clone());
    const centre = centrePoint.toArray() as Vec3;
    const corners = [...placed.values()].filter((item) => !aside.has(item.instanceId)).flatMap((item) => boxCorners(item.frame, [0, 0, 0], item.size));
    const distance =
      corners.length > 0
        ? Math.max(fitDistance(corners, centre, direction, perspective.fov, perspective.aspect), controls.minDistance)
        : (sphere.radius / Math.sin(THREE.MathUtils.degToRad(perspective.fov) / 2)) * 1.05;
    controls.target.copy(centrePoint);
    camera.position.copy(centrePoint).add(new THREE.Vector3(...direction).normalize().multiplyScalar(distance));
    controls.update();
    invalidate();
  }

  // Fit once, after the first models finish loading. Selection, assembly, geometry changes
  // and additions/removals must never replace the learner's chosen viewpoint.
  useEffect(() => {
    if (!ready || partCount === 0 || initialViewDone.current) return;
    initialViewDone.current = true;
    view(VIEW_DIRECTIONS.fit!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, partCount]);

  useEffect(() => {
    if (!command || command.seq === lastCommandSeq.current) return;
    lastCommandSeq.current = command.seq;
    initialViewDone.current = true;
    const preset = VIEW_DIRECTIONS[command.command];
    if (preset) {
      // Only an explicit Fit all request picks a new centre after the build changes.
      if (command.command === "fit") orbitCentre.current = sphere.center.clone();
      view(preset);
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (command.command === "left") spherical.theta -= Math.PI / 12;
    if (command.command === "right") spherical.theta += Math.PI / 12;
    if (command.command === "up") spherical.phi = Math.max(0.1, spherical.phi - Math.PI / 18);
    if (command.command === "down") spherical.phi = Math.min(Math.PI - 0.1, spherical.phi + Math.PI / 18);
    if (command.command === "in") spherical.radius = Math.max(controls.minDistance, spherical.radius * 0.8);
    if (command.command === "out") spherical.radius = Math.min(controls.maxDistance, spherical.radius * 1.25);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    controls.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  return null;
}

// ---------- Tutor targets ----------

const MIN_TARGET_PX = 24;
/** The rectangle function of every registered target, by target ID, for the automation probe below. */
const targetRects = new Map<string, () => TargetRect | null>();
let frames = 0;

/**
 * For browser automation, present only while a scene is mounted: where a part or a position is
 * on screen (the same rectangle the tutor gets), how many frames have been drawn (to show that
 * rendering idles), and where the camera is. Read-only.
 */
interface SceneProbe {
  partRect(instanceId: string): TargetRect | null;
  mountRect(hostInstanceId: string, mountPointId: string): TargetRect | null;
  frames(): number;
  camera(): { position: number[]; target: number[] } | null;
  /** The offered-place marker the learner clicks, while a pick is open. */
  markerRect(hostInstanceId: string, placeId: string): TargetRect | null;
  cableEndRect(cableId: string, endId: string): TargetRect | null;
  /** A fastener marker of the selected part: `role` as the engine names it, `index` from 0. */
  fastenerRect(instanceId: string, role: string, index: number): TargetRect | null;
  /** The case's power button and side panel, the power supply's switch and mains socket. */
  hotspotRect(name: "power-button" | "side-panel" | "psu-switch" | "wall-power"): TargetRect | null;
  /** A place on the single-PC page (`target:dimm-a2`, `decoy:dimm-a1`), while it is offered. */
  simpleTargetRect(id: string): TargetRect | null;
  /** IDs of the places offered now on the single-PC page. */
  simpleTargets(): string[];
  /** True while any part is still travelling to its new place. */
  moving(): boolean;
  /** Per cable: how many points of its centre line (plug ends aside) lie inside a solid part. */
  cableClipping(): Record<string, number>;
  /** The last drawn point of a cable (its plug end), scene millimetres. */
  cableEnd(cableId: string): number[] | null;
  /** Where a part is drawn this frame (it may be mid-move): position and rotation. */
  liveFrame(instanceId: string): { at: number[]; quat: number[] } | null;
  /** Where a part is drawn now (scene millimetres), for checking that installed parts reach their place. */
  partFrame(instanceId: string): { at: number[]; quat: number[]; onBench: boolean } | null;
}
const probe: SceneProbe = {
  partRect: (instanceId) => targetRects.get(pcTarget.part(instanceId).id)?.() ?? null,
  mountRect: (hostInstanceId, mountPointId) => targetRects.get(pcTarget.mount({ hostInstanceId, mountPointId }).id)?.() ?? null,
  frames: () => frames,
  camera: () => (api ? { position: api.camera.position.toArray(), target: api.controls.target.toArray() } : null),
  markerRect: (hostInstanceId, placeId) => markerRects.get(`${hostInstanceId}/${placeId}`)?.() ?? null,
  cableEndRect: (cableId, endId) => targetRects.get(pcTarget.cableEnd(cableId, endId).id)?.() ?? null,
  fastenerRect: (instanceId, role, index) => fastenerRects.get(`${instanceId}/${role}#${index}`)?.() ?? null,
  hotspotRect: (name) => hotspotRects.get(name)?.() ?? null,
  simpleTargetRect: (id) => simpleTargetRects.get(id)?.() ?? null,
  simpleTargets: () => [...simpleTargetRects.keys()],
  moving: () => moving.size > 0,
  cableEnd: (cableId) => { const runs = drawnRoutes.get(cableId); const line = runs?.at(-1)?.line; return line ? [...line[line.length - 1]] : null; },
  liveFrame: (instanceId) => {
    const group = liveGroups.get(instanceId);
    if (!group) return null;
    group.updateWorldMatrix(true, false);
    return { at: group.getWorldPosition(new THREE.Vector3()).toArray(), quat: group.getWorldQuaternion(new THREE.Quaternion()).toArray() };
  },
  cableClipping: () => Object.fromEntries([...drawnRoutes].map(([id, runs]) => [id, runs.reduce((sum, run) => sum + run.line.slice(3, -3).filter((p) => run.obstacles.some((box) => p.every((v, k) => v > box.min[k] && v < box.max[k]))).length, 0)])),
  partFrame: (instanceId) => {
    const item = lastPlaced?.get(instanceId);
    return item ? { at: [...item.frame.at], quat: [...item.frame.quat], onBench: item.onBench } : null;
  },
};
/** The placement last drawn, for the probe. */
let lastPlaced: ReadonlyMap<string, PlacedPart> | null = null;
const raycaster = new THREE.Raycaster();

/** Screen rectangle of a set of scene points, or null when none is in front of the camera. */
function screenRect(points: Vec3[]): TargetRect | null {
  if (!api) return null;
  const box = api.canvas.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = false;
  const point = new THREE.Vector3();
  for (const [x, y, z] of points) {
    point.set(x, y, z).project(api.camera);
    if (point.z > 1) continue;
    seen = true;
    const px = box.left + ((point.x + 1) / 2) * box.width;
    const py = box.top + ((1 - point.y) / 2) * box.height;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  if (!seen) return null;
  // What lies outside the canvas is not on show.
  minX = Math.max(minX, box.left);
  minY = Math.max(minY, box.top);
  maxX = Math.min(maxX, box.right);
  maxY = Math.min(maxY, box.bottom);
  return maxX > minX && maxY > minY ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/** True when another part is in front of this point, as seen from the camera. */
function hiddenBehindAnotherPart(centre: Vec3, ownerId: string): boolean {
  if (!api) return false;
  const target = new THREE.Vector3(...centre);
  const from = api.camera.position;
  raycaster.camera = api.camera;
  raycaster.set(from, target.clone().sub(from).normalize());
  const reach = from.distanceTo(target);
  for (const hit of raycaster.intersectObjects(api.scene.children, true)) {
    if (hit.distance >= reach - 2) return false;
    const owner = hit.object.userData.part as string | undefined;
    if (owner && owner !== ownerId) return true;
  }
  return false;
}

/**
 * Moves the camera to look at `centre` from `distance` mm away, from between where it looks from now
 * and the side the place faces (so the view turns a little, never flips). Returns a cancel function.
 */
/** The view the learner had before the camera glided in to a port, to return to afterwards. */
let savedView: { target: THREE.Vector3; position: THREE.Vector3 } | null = null;

function glideCamera(centre: Vec3, facing: Vec3, distance: number, reducedMotion: boolean): () => void {
  if (!api) return () => {};
  const { camera, controls } = api;
  const toTarget = new THREE.Vector3(...centre);
  const now = camera.position.clone().sub(controls.target).normalize();
  const face = new THREE.Vector3(...facing).normalize();
  // Look from above the place's facing side, blended with the current direction.
  const direction = now.clone().multiplyScalar(0.55).add(face.multiplyScalar(0.45)).add(new THREE.Vector3(0, 0.35, 0)).normalize();
  const toPosition = toTarget.clone().addScaledVector(direction, Math.max(controls.minDistance, distance));
  return glideCameraTo(toTarget, toPosition, reducedMotion);
}

function glideCameraTo(toTarget: THREE.Vector3, toPosition: THREE.Vector3, reducedMotion: boolean): () => void {
  if (!api) return () => {};
  const { camera, controls } = api;
  const fromTarget = controls.target.clone();
  const fromPosition = camera.position.clone();
  const settle = () => { api?.controls.update(); api?.invalidate(); getTargetRegistry().invalidate(); };
  if (reducedMotion) {
    controls.target.copy(toTarget);
    camera.position.copy(toPosition);
    settle();
    return () => {};
  }
  const start = performance.now();
  let frame = 0;
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / 650);
    const k = easeInOut(t);
    controls.target.lerpVectors(fromTarget, toTarget, k);
    camera.position.lerpVectors(fromPosition, toPosition, k);
    settle();
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** Turns the camera to look at a point from the given side, keeping its distance. */
function lookAt(centre: Vec3, direction: Vec3) {
  if (!api) return;
  const target = new THREE.Vector3(...centre);
  const distance = Math.min(Math.max(api.camera.position.distanceTo(api.controls.target), 250), 1500);
  api.controls.target.copy(target);
  api.camera.position.copy(target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(distance));
  api.controls.update();
  api.invalidate();
  requestAnimationFrame(() => getTargetRegistry().invalidate());
}

/**
 * Registers every part, and every position and port that has geometry, as a tutor target whose
 * rectangle is its projected box. Registered again after each change, so while the scene is
 * mounted it is the view the tutor points into. Hidden behind another part: a place outside the
 * window, so the tutor asks for `reveal`, which turns the camera. Smaller than a finger: the
 * part it belongs to is marked instead.
 */
function useSceneTargets(placed: Map<string, PlacedPart>, geometry: ReadonlyMap<string, PartGeometry>, state: PCBuildState, cableEnds: ReadonlyMap<string, PlacedCableEnd>) {
  useEffect(() => {
    const registry = getTargetRegistry();
    const unregister: (() => void)[] = [];
    // `side` is the direction from the target toward where a viewer sees it best. For a position or
    // a port (`facesOneWay`), looking from behind counts as hidden.
    const register = (
      ref: { id: string; kind: Parameters<typeof registry.register>[0]["kind"] },
      ownerId: string,
      corners: () => Vec3[],
      centre: () => Vec3,
      side: () => Vec3,
      parent?: () => Vec3[],
      facesOneWay = false,
    ) => {
      try {
        const getRect = (): TargetRect | null => source.getRect();
        targetRects.set(ref.id, getRect);
        unregister.push(() => {
          if (targetRects.get(ref.id) === getRect) targetRects.delete(ref.id);
        });
        const source = {
            getRect(): TargetRect | null {
              if (!api) return null;
              const middle = centre();
              // Seen from behind or covered by another part: hidden here, so the registry lets the same
              // thing's row in the list answer instead (a drive's port inside the case, for one).
              if (facesOneWay) {
                const toCamera = api.camera.position.clone().sub(new THREE.Vector3(...middle));
                if (toCamera.dot(new THREE.Vector3(...side())) <= 0) return null;
              }
              if (hiddenBehindAnotherPart(middle, ownerId)) return null;
              const rect = screenRect(corners());
              if (!rect) return OFF_WINDOW;
              if (parent && (rect.width < MIN_TARGET_PX || rect.height < MIN_TARGET_PX)) return screenRect(parent()) ?? OFF_WINDOW;
              return rect;
            },
            // Turn the camera to the target, then bring the 3D view itself into the window: a target
            // inside a view that is scrolled away is still off the screen however the camera looks.
            reveal: ({ reducedMotion, block = "center" }: { reducedMotion: boolean; block?: ScrollLogicalPosition }) => {
              lookAt(centre(), side());
              api?.canvas.scrollIntoView({ block, inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
            },
          };
        unregister.push(registry.register(ref, source));
      } catch {
        // An ID the registry refuses is left to the list view.
      }
    };

    for (const part of state.parts) {
      const item = placed.get(part.instanceId);
      if (!item) continue;
      const partCorners = () => boxCorners(item.frame, [0, 0, 0], item.size);
      const partCentre = () => compose(item.frame, { at: scale(item.size, 0.5), quat: [0, 0, 0, 1] }).at;
      // A part lying on the workbench is shown from above, so the parts in the next row do not cover it.
      register(pcTarget.part(part.instanceId), part.instanceId, partCorners, partCentre, () => (item.onBench && !standsFirst(part) ? [0.25, 0.9, 0.35] : [0.6, 0.55, 0.75]));

      const own = geometry.get(part.catalogId);
      if (!own) continue;
      const local = (at: Vec3, size: Vec3) => () => boxCorners(item.frame, add(at, scale(size, -0.5)), size);
      const world = (at: Vec3) => () => compose(item.frame, { at, quat: [0, 0, 0, 1] }).at;
      for (const [mountPointId, mount] of Object.entries(own.mounts)) {
        const size = mount.size ?? ([20, 20, 20] as Vec3);
        register(pcTarget.mount({ hostInstanceId: part.instanceId, mountPointId }), part.instanceId, local(mount.at, size), world(mount.at), () => rotate(item.frame.quat, mount.facing ?? scale(mount.insert, -1)), partCorners, true);
      }
      for (const [portId, port] of Object.entries(own.ports)) {
        const size = port.size ?? ([12, 12, 12] as Vec3);
        register(pcTarget.port({ kind: "part", instanceId: part.instanceId, portId }), part.instanceId, local(port.at, size), world(port.at), () => rotate(item.frame.quat, port.facing), partCorners, true);
      }
    }
    // Cable ends: a small box around each end, falling back to nothing smaller than a finger.
    for (const [key, end] of cableEnds) {
      const [cableId, endId] = [key.slice(0, key.lastIndexOf("/")), key.slice(key.lastIndexOf("/") + 1)];
      const cable = state.cables.find((item) => item.id === cableId);
      const owner = cable?.ownerInstanceId ?? "";
      const half = 14;
      register(
        pcTarget.cableEnd(cableId, endId),
        owner,
        () => boxCorners({ at: end.at, quat: [0, 0, 0, 1] }, [-half, -half, -half], [2 * half, 2 * half, 2 * half]),
        () => end.at,
        () => [0.4, 0.6, 0.7],
      );
    }

    // The switches outside the build, where they are drawn.
    for (const spot of settingHotspots(state, placed, (part) => catalogIndex.byId.get(part.catalogId)?.category)) {
      const { frame, size } = clickBox(spot);
      register(pcTarget.setting(spot.name), spot.ownerId, () => boxCorners(frame, scale(size, -0.5), size), () => frame.at, () => [0.6, 0.55, 0.75]);
    }

    registry.invalidate();
    return () => {
      for (const off of unregister) off();
      registry.invalidate();
    };
  }, [placed, geometry, state, cableEnds]);
}

// ---------- The scene ----------

function fallbackSize(part: InstalledPart): Vec3 {
  const dimensions = catalogIndex.byId.get(part.catalogId)?.dimensions;
  // A part with unpublished dimensions still gets a box, of a plainly nominal size.
  return [dimensions?.lengthMm ?? 120, dimensions?.heightMm ?? 40, dimensions?.widthMm ?? 120];
}

const isAside = (part: InstalledPart) => catalogIndex.byId.get(part.catalogId)?.category === "monitor";
/** The case stands first on the workbench: it is where the build happens. */
const standsFirst = (part: InstalledPart) => catalogIndex.byId.get(part.catalogId)?.category === "case";

const BENCH_TOP_MM = 36;
/** Rows of the workbench: short enough that the bench is nearly square, so the default view can come close. */
const BENCH_ROW_MM = 950;
/** An M.2 drive only inserted (not pressed flat) is drawn at its place's insertion angle (mid-range). */
const insertTiltDeg = (hostCatalogId: string, mountPointId: string): number => {
  const range = catalogIndex.byId.get(hostCatalogId)?.mountPoints.find((m) => m.id === mountPointId)?.keying?.insertTiltDeg;
  return range ? (range[0] + range[1]) / 2 : 0;
};
const BENCH_TOP = new THREE.MeshStandardMaterial({ color: BENCH_TOP_COLOR, roughness: 0.9, metalness: 0 });
const BENCH_MAT = new THREE.MeshStandardMaterial({ color: BENCH_MAT_COLOR, roughness: 0.95, metalness: 0 });

/** The workbench every part lies on until it is installed: a wooden top with an anti-static mat on it. */
type BenchArea = { min: [number, number]; max: [number, number] };
function Workbench({ placed, keep = false, slots }: { placed: ReadonlyMap<string, PlacedPart>; keep?: boolean; slots?: ReadonlyMap<string, { at: Vec3; size: Vec3 }> }) {
  // An empty workbench is still a workbench. With fixed slots, it covers every slot, filled or not.
  const slotParts = new Map<string, PlacedPart>([...(slots ?? new Map<string, { at: Vec3; size: Vec3 }>())].map(([id, slot]) => [id, { instanceId: id, frame: { at: slot.at, quat: [0, 0, 0, 1] }, size: slot.size, hostInstanceId: null, onBench: true, groupFrames: {} }]));
  const now = workbenchArea(new Map([...placed, ...slotParts])) ?? { min: [-80, -80] as [number, number], max: [1200, 600] as [number, number] };
  // On the guided page the bench keeps its size as parts leave it: it is furniture, not a frame.
  const kept = useRef<BenchArea | null>(null);
  let area: BenchArea = now;
  if (keep) {
    const before = kept.current;
    area = before ? { min: [Math.min(before.min[0], now.min[0]), Math.min(before.min[1], now.min[1])], max: [Math.max(before.max[0], now.max[0]), Math.max(before.max[1], now.max[1])] } : now;
    kept.current = area;
  }
  const width = area.max[0] - area.min[0];
  const depth = area.max[1] - area.min[1];
  const centre: [number, number] = [(area.min[0] + area.max[0]) / 2, (area.min[1] + area.max[1]) / 2];
  return (
    <group>
      <mesh geometry={BOX} material={BENCH_TOP} position={[centre[0], -BENCH_TOP_MM / 2 - 2, centre[1]]} scale={[width + 120, BENCH_TOP_MM, depth + 120]} raycast={noRaycast} receiveShadow />
      <mesh geometry={BOX} material={BENCH_MAT} position={[centre[0], -1, centre[1]]} scale={[width, 2, depth]} raycast={noRaycast} receiveShadow />
    </group>
  );
}

/**
 * A soft studio environment for reflections (metals look like metal), generated once per renderer
 * from three.js's built-in room; no files are downloaded. Off at low quality.
 */
function SceneEnvironment({ enabled }: { enabled: boolean }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    if (!enabled) return;
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const texture = generator.fromScene(room, 0.04).texture;
    scene.environment = texture;
    scene.environmentIntensity = 0.55;
    invalidate();
    return () => {
      scene.environment = null;
      texture.dispose();
      generator.dispose();
      room.traverse((node) => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); });
    };
  }, [enabled, gl, scene, invalidate]);
  return null;
}

/**
 * An invisible grip around the held part, kept as an optional way to move it (clicking a place is the
 * main one): press on it and drag, and the part slides over its place in the plane it is held in
 * (orbiting stops while dragging). A tap never moves it: it starts moving only once the pointer leaves
 * the tap radius, and a tap's click goes on to the place underneath. It never lowers the part: that
 * stays a separate, checked step.
 */
function HeldHandle({ item, offset, turnDeg, onDrag }: { item: PlacedPart; offset: [number, number]; turnDeg: number; onDrag: (offsetMm: [number, number]) => void }) {
  const { camera, gl } = useThree();
  const drag = useRef<{ plane: THREE.Plane; start: THREE.Vector3; offset: [number, number]; quat: THREE.Quaternion; from: [number, number]; moving: boolean } | null>(null);
  const centre = add(item.frame.at, rotate(item.frame.quat, scale(item.size, 0.5)));
  const pointOn = (clientX: number, clientY: number, plane: THREE.Plane) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moving && !pastSlop(d.from, event.clientX, event.clientY)) return;
      d.moving = true;
      const p = pointOn(event.clientX, event.clientY, d.plane);
      if (!p) return;
      const local = p.sub(d.start).applyQuaternion(d.quat.clone().invert());
      onDrag([Math.round((d.offset[0] + local.x) * 2) / 2, Math.round((d.offset[1] + local.z) * 2) / 2]);
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      if (api) api.controls.enabled = true;
      document.body.style.cursor = "";
    };
    // Any end of the drag gives the camera back: release, cancel, the window losing focus, Escape, or unmount.
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") up(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); window.removeEventListener("blur", up); window.removeEventListener("keydown", key); };
  });
  // Unmounted mid-drag (the part was put down another way): the camera is given back.
  useEffect(() => () => { if (drag.current && api) api.controls.enabled = true; drag.current = null; }, []);
  const [qx, qy, qz, qw] = item.frame.quat;
  return (
    <mesh
      position={centre}
      quaternion={[qx, qy, qz, qw]}
      userData={{ heldHandle: true }}
      onPointerDown={(event) => {
        // A clip or lever under the grip (a memory clip at the end of the slot the module is over) gets the press.
        if (event.intersections.some((hit) => hit.object.userData.mechanismHandle)) return;
        event.stopPropagation();
        // The offset is measured along the place's own axes: the held part's frame without its turn.
        const quat = new THREE.Quaternion(qx, qy, qz, qw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-turnDeg * Math.PI) / 180));
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...centre));
        const start = pointOn(event.nativeEvent.clientX, event.nativeEvent.clientY, plane);
        if (!start) return;
        drag.current = { plane, start, offset, quat, from: [event.nativeEvent.clientX, event.nativeEvent.clientY], moving: false };
        if (api) api.controls.enabled = false;
        document.body.style.cursor = "grabbing";
      }}
      // A clip, a lever or a place under the grip answers the click (a slot the module is held near).
      onClick={(event) => { if (!event.intersections.some((hit) => hit.object.userData.mechanismHandle || hit.object.userData.simpleTarget)) event.stopPropagation(); }}
      onPointerOver={() => { if (!drag.current) document.body.style.cursor = "grab"; }}
      onPointerOut={() => { if (!drag.current) document.body.style.cursor = ""; }}
    >
      <boxGeometry args={[item.size[0] + 16, item.size[1] + 10, item.size[2] + 16]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Contents({ state, startup, reducedMotion, noModel, rtl, simple = false, viewId, onSelectPart, simpleCableIds, selectedSimpleCableId, onSelectSimpleCable, simpleTargets, onSimpleTarget, benchOrder, beside, quality, guide, guideAnimate = true, rgb = false, held, socket, onHeldDrag, dimm }: PcSceneProps & { quality: SceneQuality }) {
  const projectId = usePC((store) => store.projectId);
  const { geometry, ready } = useGeometry(useMemo(() => state.parts.map((part) => part.catalogId), [state.parts]));
  const benchSlots = useMemo(() => new Map<string, { at: Vec3; size: Vec3 }>(), [state, geometry, benchOrder, beside]);
  const basePlaced = useMemo(() => placeParts({ state, geometry, fallbackSize, isAside, standsFirst, benchRowMm: BENCH_ROW_MM, benchOrder, beside, slotsOut: benchOrder ? benchSlots : undefined, placedTiltDeg: insertTiltDeg }), [state, geometry, benchOrder, beside, benchSlots]);
  // A part the learner holds over its place: where it would be once placed, then turned, shifted and lifted as held.
  const placed = useMemo(() => {
    if (!held) return basePlaced;
    const ghostState = { ...state, parts: state.parts.map((p) => (p.instanceId === held.instanceId ? { ...p, attachments: [{ role: "main", target: held.target, seating: "placed" as const, fastenersSecured: 0 }] } : p)) };
    const ghost = placeParts({ state: ghostState, geometry, fallbackSize, isAside, standsFirst, benchRowMm: BENCH_ROW_MM, benchOrder, beside }).get(held.instanceId);
    if (!ghost) return basePlaced;
    const next = new Map(basePlaced);
    next.set(held.instanceId, heldFrame(ghost, geometry.get(state.parts.find((p) => p.instanceId === held.instanceId)?.catalogId ?? ""), held));
    return next;
  }, [basePlaced, held, state, geometry, benchOrder, beside]);
  // In the practice view every CPU socket's lever and plate are moving parts of their own (SocketMechanism).
  const socketHosts = useMemo(() => {
    const out = new Map<string, { mountId: string; kind: "lga" | "zif"; retentionId: string; layout: NonNullable<ReturnType<typeof socketLayout>> }>();
    if (!simple) return out;
    for (const p of state.parts) {
      const mount = catalogIndex.byId.get(p.catalogId)?.mountPoints.find((m) => m.kind === "cpu_socket" && (m.retention?.kind === "lga_load_plate" || m.retention?.kind === "zif_lever"));
      if (!mount?.retention || !p.mechanisms) continue;
      const kind = mount.retention.kind === "lga_load_plate" ? "lga" : "zif";
      const layout = socketLayout(geometry.get(p.catalogId), mount.id, kind);
      if (layout) out.set(p.instanceId, { mountId: mount.id, kind, retentionId: mount.retention.id, layout });
    }
    return out;
  }, [simple, state.parts, geometry]);
  // …and every memory slot's clips too (DimmClips).
  const dimmHosts = useMemo(() => {
    const out = new Map<string, ReturnType<typeof dimmLayout>>();
    if (!simple) return out;
    for (const p of state.parts) {
      const slots = (catalogIndex.byId.get(p.catalogId)?.mountPoints ?? []).filter((m) => m.kind === "dimm_slot" && m.retention).map((m) => ({ id: m.id, clipId: m.retention!.id, nearId: m.retention!.latches === "both" ? `${m.retention!.id}:near` : null }));
      if (!slots.length || !p.mechanisms) continue;
      const layout = dimmLayout(geometry.get(p.catalogId), slots);
      if (layout.length) out.set(p.instanceId, layout);
    }
    return out;
  }, [simple, state.parts, geometry]);
  const mechGeometry = useMemo(() => new Map(state.parts.map((p) => [p.instanceId, withMechanisms(geometry.get(p.catalogId), p, socketHosts.has(p.instanceId) || dimmHosts.has(p.instanceId))])), [state.parts, geometry, socketHosts, dimmHosts]);
  // A close-up only when the learner asks for one (the "close-up" button), never as a side effect.
  const focus = useScene((store) => store.focus);
  useEffect(() => {
    if (!focus) return;
    const host = placed.get(focus.hostInstanceId);
    if (!host) return;
    // The part itself ("Focus selected part"): its middle, from above its side, far enough to see all of it.
    if (!focus.mountPointId) {
      const corners = boxCorners(host.frame, [0, 0, 0], host.size);
      const middle = scale(corners.reduce((sum, c) => add(sum, c), [0, 0, 0] as Vec3), 1 / corners.length);
      return glideCamera(middle, rotate(host.frame.quat, [0, 1, 0]), Math.min(Math.max(Math.max(...host.size) * 2.2, 180), 1600), reducedMotion);
    }
    const catalogId = state.parts.find((p) => p.instanceId === focus.hostInstanceId)?.catalogId;
    const mount = catalogId ? geometry.get(catalogId)?.mounts[focus.mountPointId] : undefined;
    if (!mount) return;
    // A memory slot is long: aim at the middle of the slot itself (its mount point sits at one end) and
    // stand back far enough to see both ends and the module held over it.
    const slotSolid = focus.mountPointId.startsWith("dimm-") ? geometry.get(catalogId!)?.solids.find((x) => x.id === mount.solid && x.size) : undefined;
    const world = compose(host.frame, { at: slotSolid ? slotSolid.at : mount.at, quat: mount.quat });
    return glideCamera(world.at, rotate(host.frame.quat, [0, 1, 0]), slotSolid ? 240 : 170, reducedMotion);
    // Only a new request moves the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq]);
  lastPlaced = placed;
  const rich = quality !== "low";
  const cableEnds = useMemo(() => placeCableEnds(state, placed, geometry), [state, placed, geometry]);
  // For browser checks (like window.__ytlSimplePc): where the socket's lever and plate and the held part are on screen.
  const three = useThree();
  useEffect(() => {
    const w = window as unknown as { __ytlSocketScreen?: () => Record<string, [number, number]> };
    // The camera's pose, to check that no assembly step moves it.
    (window as unknown as { __ytlCamera?: () => number[] }).__ytlCamera = () => [...three.camera.position.toArray(), ...three.camera.quaternion.toArray()].map((n) => Math.round(n * 1000) / 1000);
    w.__ytlSocketScreen = () => {
      const out: Record<string, [number, number]> = {};
      const rect = three.gl.domElement.getBoundingClientRect();
      const screen = (p: Vec3): [number, number] => { const v = new THREE.Vector3(...p).project(three.camera); return [Math.round(rect.left + ((v.x + 1) / 2) * rect.width), Math.round(rect.top + ((1 - v.y) / 2) * rect.height)]; };
      for (const [hostId, s] of socketHosts) {
        const item = placed.get(hostId);
        if (!item) continue;
        out.centre = screen(compose(item.frame, { at: [s.layout.centre[0], s.layout.centre[1] + s.layout.size[1] / 2 + 22, s.layout.centre[2]], quat: [0, 0, 0, 1] }).at);
        for (const what of ["lever", "plate", "mark"] as const) out[what] = screen(compose(item.frame, { at: socketPoint(s.layout, what, socketMoved(state.parts.find((p) => p.instanceId === hostId), s.retentionId, s.kind)), quat: [0, 0, 0, 1] }).at);
      }
      // Every M.2 slot (its top face), to click it in the view.
      for (const part of state.parts) {
        const item = placed.get(part.instanceId);
        const slots = geometry.get(part.catalogId)?.solids.filter((x) => x.role === "m2_slot") ?? [];
        for (const slot of slots) if (item && slot.size) out[`m2:${slot.id}`] = screen(compose(item.frame, { at: [slot.at[0], slot.at[1] + slot.size[1] / 2, slot.at[2]], quat: [0, 0, 0, 1] }).at);
      }
      for (const [hostId, layout] of dimmHosts) {
        const item = placed.get(hostId);
        if (!item) continue;
        for (const l of layout) {
          out[`clip:${l.slotId}`] = screen(compose(item.frame, { at: [l.far.at[0], l.far.at[1] + 2, l.far.at[2]], quat: [0, 0, 0, 1] }).at);
          if (l.near) out[`near:${l.slotId}`] = screen(compose(item.frame, { at: [l.near.at[0], l.near.at[1] + 2, l.near.at[2]], quat: [0, 0, 0, 1] }).at);
          out[`slot:${l.slotId}`] = screen(compose(item.frame, { at: [l.slot.at[0], l.slot.at[1] + l.slot.size[1] / 2, l.slot.at[2]], quat: [0, 0, 0, 1] }).at);
        }
      }
      const h = held ? placed.get(held.instanceId) : undefined;
      // A point low on the held part, in the middle of its footprint (a tall module's middle can be out of view close up).
      // Measured on the grip itself (what a press lands on), as drawn.
      let grip: THREE.Object3D | undefined;
      three.scene.traverse((o) => { if (o.userData.heldHandle) grip = o; });
      if (h && grip) { const w = grip.localToWorld(new THREE.Vector3(0, -h.size[1] / 2 + Math.min(h.size[1] / 2, 4), 0)); out.held = screen([w.x, w.y, w.z]); }
      return out;
    };
    return () => { delete w.__ytlSocketScreen; };
  }, [three, socketHosts, dimmHosts, placed, held, state.parts]);
  // What a lead must not pass through: every solid of every part (a cooler's fin stack, its fan, a
  // card's shroud…), each as its own box, so a lead may run between them as real ones do. The case is
  // a container, not an obstacle; places for other parts and keep-out volumes are not solid.
  const cableObstacles = useMemo(() => {
    const boxes: Obstacle[] = [];
    const bounds = (corners: Vec3[]): Obstacle => ({
      min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]))) as unknown as Vec3,
      max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]))) as unknown as Vec3,
    });
    for (const part of state.parts) {
      const item = placed.get(part.instanceId);
      if (!item || standsFirst(part)) continue;
      const own = geometry.get(part.catalogId);
      if (!own) { boxes.push(bounds(boxCorners(item.frame, [0, 0, 0], item.size))); continue; }
      for (const solid of own.solids) {
        if (!drawable(solid) || PLACE_ROLES.has(solid.role) || solid.role === "rgb") continue;
        const frame = (solid.group && item.groupFrames[solid.group]) || item.frame;
        const box = solid.shape === "box" || solid.shape === "fins" ? (solid.size as Vec3)
          : (["x", "y", "z"] as const).map((axis) => (axis === (solid.axis ?? "y") ? solid.height ?? 1 : 2 * (solid.radius ?? 1))) as unknown as Vec3;
        // Surface details thinner than a wire (screws, surface-mount parts, slots) are not in a lead's way.
        if (solid.role === "detail" && Math.min(...box) < 2) continue;
        const solidFrame = compose(frame, { at: solid.at, quat: (solid.rotation ?? [0, 0, 0, 1]) as Quat });
        boxes.push(bounds(boxCorners(solidFrame, scale(box, -0.5), box)));
      }
    }
    return boxes;
  }, [placed, state, geometry]);
  const candidates = usePC((store) => (simple || store.assembly.phase === "idle" ? null : store.assembly.candidates));
  const markers = useMemo(() => (candidates ? candidateMarkers(candidates as readonly AssemblyCandidate[], placed, geometry, state) : []), [candidates, placed, geometry, state]);
  // The monitor stands behind the build and is left out of the default framing.
  const aside = useMemo(() => new Set(state.parts.filter(isAside).map((part) => part.instanceId)), [state.parts]);
  const selectedId = useScene((store) => store.selectedPartId);
  const selectedPart = state.parts.find((part) => part.instanceId === selectedId);
  const fasteners = useMemo(
    () =>
      selectedPart
        ? fastenerMarkers(selectedPart, placed, geometry, (id) => state.parts.find((part) => part.instanceId === id)?.catalogId, (host, mount) => {
            const hostPart = state.parts.find((part) => part.instanceId === host);
            return (hostPart && catalogIndex.byId.get(hostPart.catalogId)?.mountPoints.find((item) => item.id === mount)?.fastener?.count) ?? 0;
          })
        : [],
    [selectedPart, placed, geometry, state.parts],
  );
  const spots = useMemo(() => settingHotspots(state, placed, (part) => catalogIndex.byId.get(part.catalogId)?.category), [state, placed]);
  const invalidate = useThree((three) => three.invalidate);
  useSceneTargets(placed, geometry, state, cableEnds);

  // Counts drawn frames; in on-demand mode this runs only when a frame is actually rendered.
  useFrame(() => {
    frames += 1;
  });

  // On demand: a frame after anything that changes the picture.
  useEffect(() => {
    invalidate();
  }, [invalidate, placed, selectedId, startup]);

  // A fitted radiator covers the fan places behind it (catalog `blocks`): their empty markers would show through it.
  const coveredPlaces = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const host of state.parts) {
      const radiators = catalogIndex.byId.get(host.catalogId)?.mountPoints.filter((mount) => mount.kind === "radiator_mount") ?? [];
      for (const mount of radiators) {
        if (!state.parts.some((part) => part.attachments.some((a) => a.target.hostInstanceId === host.instanceId && a.target.mountPointId === mount.id))) continue;
        const set = result.get(host.instanceId) ?? new Set<string>();
        set.add(mount.id);
        for (const id of mount.blocks ?? []) set.add(id);
        // The fans moved aside for it fill their new places: those are not empty either.
        for (const part of state.parts) for (const a of part.attachments) if (a.target.hostInstanceId === host.instanceId && a.target.mountPointId.startsWith("fan-")) set.add(a.target.mountPointId);
        result.set(host.instanceId, set);
      }
    }
    return result;
  }, [state.parts]);
  // Lit only while the build really runs (pressed and operational): RGB never makes a build look on.
  const rgbLit = rgb && state.power.pressed && startup.outcome === "operational";
  const rgbState: "off" | "unlit" | "lit" = !rgb ? "off" : rgbLit ? "lit" : "unlit";
  const spinning = new Set(startup.observable.spinning);
  const lit = new Map(startup.observable.lighting.filter((item) => item.lit && item.color).map((item) => [item.instanceId, item.color!]));

  return (
    <>
      {/* Bright and even, still a diagram to read: the studio environment adds reflections, so the fill
          lights are a little lower than before; the key light casts soft shadows onto the bench. */}
      <SceneEnvironment enabled={rich} />
      <ambientLight intensity={rich ? 1.15 : 1.9} />
      <hemisphereLight args={["#ffffff", "#5a6070", rich ? 0.9 : 1.2]} />
      <KeyLight shadows={rich} quality={quality} />
      <directionalLight position={[-600, 400, -500]} intensity={1.1} />
      {/* A rim light from behind and above: it lights the top and back edges of dark parts so their outlines
          separate from the bench. */}
      <directionalLight position={[200, 1200, -1400]} intensity={1.6} />
      <Camera key={viewId ?? projectId} placed={placed} aside={aside} ready={ready} />
      <Workbench placed={placed} keep={simple} slots={benchOrder ? benchSlots : undefined} />
      {state.parts.map((part) => {
        const item = placed.get(part.instanceId);
        return item ? (
          <Part
            key={part.instanceId}
            part={part}
            placed={item}
            geometry={mechGeometry.get(part.instanceId)}
            selected={selectedId === part.instanceId}
            lit={lit.get(part.instanceId) ?? null}
            spinning={spinning.has(part.instanceId)}
            reducedMotion={reducedMotion}
            noModel={noModel}
            rtl={rtl}
            onSelectPart={onSelectPart}
            animate={simple}
            hiddenSolids={socketHosts.has(part.instanceId) || dimmHosts.has(part.instanceId) ? new Set([...(coveredPlaces.get(part.instanceId) ?? []), ...(socketHosts.get(part.instanceId)?.layout.replaces ?? []), ...dimmReplaces(dimmHosts.get(part.instanceId) ?? [])]) : coveredPlaces.get(part.instanceId)}
            rgb={rgbState}
          />
        ) : null;
      })}
      {[...socketHosts].map(([hostId, s]) => {
        const item = placed.get(hostId);
        const board = state.parts.find((p) => p.instanceId === hostId);
        if (!item || !board) return null;
        const active = socket && socket.hostInstanceId === hostId ? socket : null;
        const cpuIn = state.parts.some((p) => p.attachments.some((a) => a.target.hostInstanceId === hostId && a.target.mountPointId === s.mountId));
        return (
          <FrameGroup key={`socket-${hostId}`} frame={item.frame} animate={simple} reducedMotion={reducedMotion} moveKey={`${hostId}#socket`}>
            <SocketMechanism layout={s.layout} board={board} retentionId={s.retentionId} cpuIn={cpuIn} reducedMotion={reducedMotion} onLever={active?.onLever} onPlate={active?.onPlate} highlight={active?.highlight ?? null} hardware={coolerHardwareDraw(board, state.parts.find((p) => catalogIndex.byId.get(p.catalogId)?.category === "cooling" && (p.attachments.some((a) => a.target.hostInstanceId === hostId) || p.hardware)), s.layout)} />
          </FrameGroup>
        );
      })}
      {[...dimmHosts].map(([hostId, layout]) => {
        const item = placed.get(hostId);
        const board = state.parts.find((p) => p.instanceId === hostId);
        if (!item || !board) return null;
        return (
          <FrameGroup key={`dimm-${hostId}`} frame={item.frame} animate={simple} reducedMotion={reducedMotion} moveKey={`${hostId}#dimm`}>
            <DimmClips layout={layout} board={board} reducedMotion={reducedMotion} onClip={dimm?.onClip} glowClip={dimm?.glowClip ?? null} targetSlot={dimm?.targetSlot ?? null} targetOk={dimm?.targetOk ?? false} />
          </FrameGroup>
        );
      })}
      {held && onHeldDrag && placed.get(held.instanceId) && <HeldHandle item={placed.get(held.instanceId)!} offset={held.offsetMm} turnDeg={held.rotationDeg} onDrag={onHeldDrag} />}
      {state.cables.filter((cable) => !simple || simpleCableIds?.includes(cable.id)).map((cable) => {
        const spec = pc.cableSpecOf(catalogIndex.byId.get(cable.catalogId), cable.cableSpecId);
        // Practice view: every end that is plugged in (so a lead shows both its plugs), plus the first one while loose.
        const endIds = simple ? Object.keys(cable.ends).filter((id, i) => i === 0 || cable.ends[id]) : Object.keys(cable.ends);
        const ends = endIds.flatMap((endId) => {
          const end = cableEnds.get(`${cable.id}/${endId}`);
          return end ? [[endId, end] as [string, PlacedCableEnd]] : [];
        });
        const owner = cable.ownerInstanceId ? placed.get(cable.ownerInstanceId) : undefined;
        const lead = owner && geometry.get(cable.catalogId)?.leads[cable.cableSpecId];
        const fixedSource = spec?.attachment === "captive" && owner && lead ? compose(owner.frame, { at: lead.at, quat: [0, 0, 0, 1] }).at : undefined;
        const orientations = new Map<string, THREE.Quaternion>();
        // Each point of the lead is held by a part: the plug by the part it is plugged into, the source
        // (and a loose end) by the lead's own part. The cable reads those parts' live transforms.
        const anchors = new Map<string, CableAnchor>();
        if (fixedSource && owner && lead) anchors.set("source", { hostId: owner.instanceId, local: lead.at });
        for (const [endId, end] of ends) {
          const to = cable.ends[endId];
          if (to?.kind !== "part") {
            if (owner && !end.plugged) anchors.set(endId, { hostId: owner.instanceId, local: compose(inverse(owner.frame), { at: end.at, quat: [0, 0, 0, 1] }).at });
            continue;
          }
          const host = placed.get(to.instanceId);
          const hostCatalogId = state.parts.find((part) => part.instanceId === to.instanceId)?.catalogId;
          const port = hostCatalogId && geometry.get(hostCatalogId)?.ports[to.portId];
          if (!host || !port) continue;
          const local = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...port.facing).normalize());
          orientations.set(endId, new THREE.Quaternion(...host.frame.quat).multiply(local));
          anchors.set(endId, { hostId: to.instanceId, local: port.at, turn: local.toArray() as unknown as Quat });
        }
        return <Cable key={cable.id} cableId={cable.id} kind={spec?.kind ?? ""} ends={ends} fixedSource={fixedSource} orientations={orientations} anchors={anchors} obstacles={cableObstacles} reducedMotion={reducedMotion} simple={simple} selected={simple && selectedSimpleCableId === cable.id} onSelectSimpleCable={onSelectSimpleCable} />;
      })}
      {!state.sidePanelOpen && state.parts.filter((part) => part.catalogId === "corsair-4000d-airflow-black").map((part) => {
        const item = placed.get(part.instanceId);
        if (!item) return null;
        const [w, h, d] = item.size;
        return <group key={`window-${part.instanceId}`} position={item.frame.at as [number, number, number]} quaternion={item.frame.quat as [number, number, number, number]}>
          <mesh geometry={BOX} material={finishMaterial("glass")!} position={[w / 2, h / 2, d - 3.5]} scale={[w - 18, h - 32, 1.2]} raycast={noRaycast} />
        </group>;
      })}
      {/* Mounted for the whole guided page (also with nothing offered), so the camera can return after a lead is in. */}
      {simple && simpleTargets && (
        <SimpleTargets targets={simpleTargets} placed={placed} geometry={geometry} state={state} reducedMotion={reducedMotion} onTarget={onSimpleTarget} autoFocus={!simple} />
      )}
      {rgb && <RgbDriver lit={rgbLit} reducedMotion={reducedMotion} />}
      {simple && guide !== undefined && (
        <GuideRobot focus={guide} placed={placed} geometry={geometry} state={state} obstacles={cableObstacles} caseId={state.parts.find(standsFirst)?.instanceId ?? null} animate={guideAnimate && !reducedMotion} />
      )}
      <Candidates markers={markers} />
      {selectedPart && (!simple || catalogIndex.byId.get(selectedPart.catalogId)?.category !== "cooling") && <Fasteners part={selectedPart} markers={fasteners} interactive={!simple} />}
      {!simple && <Hotspots spots={spots} state={state} />}
    </>
  );
}

export interface PcSceneProps {
  state: PCBuildState;
  /** The engine's startup result: which fans turn and which parts are lit. */
  startup: StartupResult;
  reducedMotion: boolean;
  /** Localized "no model yet", drawn on outline boxes. */
  noModel: string;
  rtl: boolean;
  /** The graphics context was lost (driver reset, too many contexts): the caller falls back to the list. */
  onContextLost?: () => void;
  /** Compact assembly: local part/cable callbacks; never mutates the detailed PC store. */
  simple?: boolean;
  viewId?: string;
  onSelectPart?: (instanceId: string) => void;
  simpleCableIds?: readonly string[];
  selectedSimpleCableId?: string | null;
  onSelectSimpleCable?: (cableId: string) => void;
  /** Places to click for what is in hand (the glowing target and same-kind decoys). */
  simpleTargets?: readonly SimpleSceneTarget[];
  onSimpleTarget?: (id: string) => void;
  /** A click on the canvas that hit nothing (no part, place or lead). */
  onSimpleMiss?: () => void;
  /** The guide robot's focus on the guided page (see `guide.ts`); null parks it, undefined leaves it out. */
  guide?: GuideFocus | null;
  /** False: the robot appears without flying or bobbing (animated guidance turned off). */
  guideAnimate?: boolean;
  /** Optional decorative RGB lighting (case fans, RAM, liquid cooler). Lit only while the build runs. */
  rgb?: boolean;
  /** A fixed workbench (see `placeParts`). */
  benchOrder?: readonly string[];
  beside?: Readonly<Record<string, string>>;
  /**
   * The CPU socket the learner is working on: clicking its lever or plate in the view calls these (the
   * engine still decides whether it may move). `highlight` glows the piece the current step is about.
   */
  socket?: { hostInstanceId: string; onLever?: () => void; onPlate?: () => void; highlight?: "lever" | "plate" | "mark" | null } | null;
  /** Memory slots in the practice view: clip clicks, the clip to glow, and the slot the held module is over. */
  dimm?: { onClip?: (slotId: string, near: boolean) => void; glowClip?: { slotId: string; near: boolean } | null; targetSlot?: string | null; targetOk?: boolean } | null;
  /** Dragging the held part: its new offset from its place, mm along the place's own axes. */
  onHeldDrag?: (offsetMm: [number, number]) => void;
  /** A part the learner is holding over its place (rotation and offset as held; nothing is fitted yet). */
  held?: { instanceId: string; target: { hostInstanceId: string; mountPointId: string }; rotationDeg: number; offsetMm: [number, number]; liftMm: number; tiltDeg?: number } | null;
}

/** The main light, from the front and above; it casts the shadows at medium and high quality. */
function KeyLight({ shadows, quality }: { shadows: boolean; quality: SceneQuality }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const node = light.current;
    if (!node) return;
    // Centred on the workbench; the light keeps its direction (same offset from target as before).
    node.target.position.set(650, 0, 280);
    node.target.updateMatrixWorld();
    const camera = node.shadow.camera;
    // The whole workbench (case and rows of parts), in millimetres.
    // Only the bench and the case: the same shadow map covers less, so contact shadows are crisper.
    camera.left = -1050; camera.right = 1050; camera.top = 1050; camera.bottom = -1050; camera.near = 50; camera.far = 4200;
    camera.updateProjectionMatrix();
    node.shadow.bias = -0.0004;
    node.shadow.normalBias = 0.8;
    node.shadow.radius = 4;
  }, [quality]);
  const size = quality === "high" ? 2048 : 1024;
  return <directionalLight ref={light} position={[1150, 1500, 1380]} intensity={2.4} castShadow={shadows} shadow-mapSize={[size, size]} />;
}

/** A retired canvas must not report its intentional disposal as a failure of the next view. */
function ContextEvents({ onLost }: { onLost?: () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      if (!canvas.isConnected) return;
      event.preventDefault();
      onLost?.();
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, onLost]);
  return null;
}

export default function PcScene(props: PcSceneProps) {
  const quality = useScene((state) => state.quality);
  const { onContextLost } = props;
  return (
    <Canvas
      // Antialiasing is fixed when the renderer is created, so that choice makes a new one.
      key={quality === "low" ? "plain" : "smooth"}
      frameloop="demand"
      dpr={[1, PIXEL_RATIO_CAP[quality]]}
      gl={{ antialias: quality !== "low", powerPreference: "default" }}
      shadows={quality === "low" ? false : "percentage"}
      camera={{ fov: 40, near: 10, far: 20000, position: [600, 500, 900] }}
      onPointerMissed={() => { if (!props.simple) sceneStore.setState({ selectedPartId: null, selectedCableEnd: null }); else props.onSimpleMiss?.(); }}
    >
      <ContextEvents onLost={onContextLost} />
      <Contents {...props} quality={quality} />
    </Canvas>
  );
}
