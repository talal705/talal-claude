"use client";

// The 3D view of a build. It draws what the engine's state says and offers the same actions as the
// list view (pick a part, then a highlighted place); it decides nothing about what is allowed.
// Rendering is on demand: a frame is drawn when something changes, the camera moves, or a fan
// turns, and never in an idle loop.
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { pcTarget, type InstalledPart, type PCBuildState, type StartupResult, type TargetRect } from "@ytl/contracts";
import { getTargetRegistry } from "@/lib/targets";
import { pc } from "@ytl/simulation";
import { catalogIndex } from "../catalog";
import { pcStore, usePC } from "../pc-client";
import type { AssemblyCandidate } from "@/lib/interaction/assembly";
import type { Frame, PartGeometry, Solid, Vec3 } from "./geometry";
import { add, boxCorners, compose, placeCableEnds, placeParts, rotate, scale, workbenchArea, type PlacedCableEnd, type PlacedPart } from "./placement";
import { PIXEL_RATIO_CAP, sceneStore, selectCableEnd, selectPart, useScene, type CameraCommand } from "./scene-store";
import { fitDistance } from "./camera-fit";
import { clickBox, fastenerMarkers, settingHotspots, type FastenerMarker, type Hotspot } from "./controls3d";
import { BENCH_MAT_COLOR, BENCH_TOP_COLOR, FINISHES } from "./palette";
import { useGeometry } from "./use-geometry";
import { cableRoutePoints, connectorSize } from "./cable-visuals";

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
    // Matte and non-metallic: a metallic surface with nothing to reflect renders black.
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
    materials.set(key, material);
  }
  return material;
}
const finishMaterials = new Map<string, THREE.MeshStandardMaterial>();
function finishMaterial(finish: string): THREE.MeshStandardMaterial | null {
  const look = FINISHES[finish];
  if (!look) return null;
  let material = finishMaterials.get(finish);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: look.color,
      metalness: look.metalness,
      roughness: look.roughness,
      ...(look.opacity !== undefined ? { transparent: true, opacity: look.opacity, depthWrite: false } : {}),
    });
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
const EDGE = new THREE.LineBasicMaterial({ color: "#e4e4ea", transparent: true, opacity: 0.14 });
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

const drawable = (solid: Solid) => (solid.shape === "box" || solid.shape === "cylinder" || solid.shape === "fins" || solid.shape === "rotor" || solid.shape === "ring") && !solid.role.endsWith("_keepout");
/** Empty places for other parts (a tray, a bay, a fan or radiator position): drawn as outlines, never as solid shapes. */
const PLACE_ROLES = new Set(["tray", "bay", "fan_mount", "radiator_mount"]);
const PLACE_EDGE = new THREE.LineDashedMaterial({ color: "#9a9aa6", dashSize: 0.08, gapSize: 0.06 });

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
            <mesh geometry={CYLINDER} material={materialFor("fan", category)} scale={[radius * 0.34, height * 0.9, radius * 0.34]} userData={{ fanRotor: solid.id }} />
            {Array.from({ length: blades }, (_, i) => (
              <group key={i} rotation={[0, (i * 2 * Math.PI) / blades, 0]}>
                <mesh geometry={FAN_BLADE} material={bladeMaterial} scale={[radius * 0.93, radius * 0.93, radius * 0.93]} />
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
function SolidView({ solid, category, lit, partId }: { solid: Solid; category: string; lit: string | null; partId: string }) {
  const material = solidMaterial(solid, category, lit);
  if (solid.shape === "ring") return <mesh geometry={RING} material={material} position={solid.at as [number, number, number]} quaternion={AXIS_TURN[solid.axis ?? "y"]} scale={solid.radius ?? 1} userData={{ part: partId }} />;
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
      <mesh geometry={box ? BOX : CYLINDER} material={material} quaternion={box ? undefined : AXIS_TURN[solid.axis ?? "y"]} scale={dims} userData={{ part: partId }} />
      <lineSegments geometry={box ? EDGES : CYLINDER_EDGES} material={EDGE} quaternion={box ? undefined : AXIS_TURN[solid.axis ?? "y"]} scale={dims} raycast={noRaycast} />
    </group>
  );
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
}: {
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
      if (event.intersections.some((hit) => hit.object.userData.simpleCableTarget || hit.object.userData.looseEnd)) return;
      event.stopPropagation(); onSelectPart(part.instanceId); return;
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
    <group key={group} position={frame.at as [number, number, number]} quaternion={frame.quat as [number, number, number, number]} onClick={onClick}>
      {geometry!.solids
        .filter((solid) => solid.group === group && drawable(solid))
        .map((solid) =>
          solid.role === "fan" && (solid.shape === "cylinder" || solid.shape === "rotor") ? (
            <Fan key={solid.id} solid={solid} category={category} spinning={spinning} reducedMotion={reducedMotion} />
          ) : (
            <SolidView key={solid.id} solid={solid} category={category} lit={lit && lightSolids.has(solid.id) ? lit : null} partId={part.instanceId} />
          ),
        )}
    </group>
  ));

  return (
    <>
    {groupBodies}
    {geometry && <Hoses geometry={geometry} placed={placed} category={category} />}
    <group position={placed.frame.at as [number, number, number]} quaternion={placed.frame.quat as [number, number, number, number]} onClick={onClick}>
      {geometry ? (
        geometry.solids.filter((solid) => drawable(solid) && !(solid.group && placed.groupFrames[solid.group])).map((solid) =>
          PLACE_ROLES.has(solid.role) && solid.shape === "box" ? (
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
            <SolidView key={solid.id} solid={solid} category={category} lit={lit && lightSolids.has(solid.id) ? lit : null} partId={part.instanceId} />
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
      {selected && <lineSegments geometry={EDGES} material={SELECTED} position={centre} scale={[width * 1.02, height * 1.02, depth * 1.02]} raycast={noRaycast} />}
    </group>
    </>
  );
}

// ---------- Liquid cooler hoses ----------

/**
 * The two hoses of a liquid cooler, from the stubs on its pump block to the fittings on its
 * radiator, wherever each body is (mounted, or on the bench). Drawn only for parts that have both.
 */
function Hoses({ geometry, placed, category }: { geometry: PartGeometry; placed: PlacedPart; category: string }) {
  const stubs = geometry.solids.filter((solid) => solid.role === "tube");
  const fitting = geometry.solids.find((solid) => solid.id === "hose-fittings") ?? geometry.solids.find((solid) => solid.group === "radiator" && solid.role !== "fan");
  const tubes = useMemo(() => {
    if (stubs.length === 0 || !fitting) return [];
    const frameOf = (group: string | undefined) => (group && placed.groupFrames[group]) || placed.frame;
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
        <mesh key={index} geometry={tube} material={materialFor("tube", category)} raycast={noRaycast} />
      ))}
    </>
  );
}

// ---------- Cables ----------

/** One colour per kind of cable, all clear of the selection cyan. */
const CABLE_COLORS: Record<string, string> = {
  atx_main: "#c9c9d3",
  cpu_power: "#c9c9d3",
  gpu_power: "#c9c9d3",
  gpu_power_adapter: "#c9c9d3",
  sata_power: "#c9c9d3",
  peripheral_power: "#c9c9d3",
  sata_data: "#f472b6",
  fan_lead: "#facc15",
  pump_lead: "#facc15",
  lighting_lead: "#fb923c",
  front_panel_lead: "#a78bfa",
  display: "#60a5fa",
};
const cableMaterials = new Map<string, THREE.MeshStandardMaterial>();
function cableMaterial(kind: string): THREE.MeshStandardMaterial {
  let material = cableMaterials.get(kind);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color: CABLE_COLORS[kind] ?? "#c9c9d3", roughness: 0.6 });
    cableMaterials.set(kind, material);
  }
  return material;
}
const LOOSE_END = new THREE.MeshStandardMaterial({ color: "#374151", emissive: "#fbbf24", emissiveIntensity: 0.3, roughness: 0.5 });
const SELECTED_END = new THREE.MeshStandardMaterial({ color: "#0e7490", emissive: "#22d3ee", emissiveIntensity: 0.6, roughness: 0.4 });
const CONNECTOR = new THREE.MeshStandardMaterial({ color: "#20252e", roughness: 0.48, metalness: 0.08 });
const CONTACT = new THREE.MeshStandardMaterial({ color: "#d1b46d", roughness: 0.35, metalness: 0.5 });

/** Sleeved wires and keyed connector housings. A captive lead includes its fixed source. */
function Cable({ cableId, kind, ends, fixedSource, orientations, simple = false, selected = false, onSelectSimpleCable }: {
  cableId: string; kind: string; ends: [string, PlacedCableEnd][]; fixedSource?: Vec3; orientations?: ReadonlyMap<string, THREE.Quaternion>;
  simple?: boolean; selected?: boolean; onSelectSimpleCable?: (cableId: string) => void;
}) {
  const assembly = usePC((store) => store.assembly);
  const power = ["atx_main", "cpu_power", "gpu_power", "gpu_power_adapter"].includes(kind);
  const geometry = useMemo(() => {
    const points = fixedSource ? [fixedSource, ...ends.map(([, end]) => end.at)] : ends.map(([, end]) => end.at);
    const tubes: THREE.TubeGeometry[] = [];
    for (let pair = 1; pair < points.length; pair++) {
      const a = points[pair - 1], b = points[pair];
      if (Math.hypot(...a.map((v, i) => b[i] - v)) < 2) continue;
      // Parallel strands make large power bundles distinct from thin fan/front-panel leads.
      const strands = power ? 4 : 1;
      for (let strand = 0; strand < strands; strand++) {
        const offset = (strand - (strands - 1) / 2) * 2.8;
        const path = cableRoutePoints(a, b).map((at, i, all) => new THREE.Vector3(at[0] + ((i === 0 || i === all.length - 1) ? offset * 0.4 : offset), at[1], at[2]));
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, false, "centripetal"), 32, power ? 1.5 : 1.8, 6, false));
      }
    }
    return tubes;
  }, [ends, fixedSource, power]);
  useEffect(() => () => geometry.forEach((tube) => tube.dispose()), [geometry]);
  const size = connectorSize(kind);
  return (
    <group>
      {geometry.map((tube, index) => <mesh key={index} geometry={tube} material={selected ? SELECTED_END : cableMaterial(kind)} raycast={noRaycast} />)}
      {fixedSource && <mesh geometry={BOX} material={CONNECTOR} position={fixedSource as [number, number, number]} scale={[9, 8, 9]} raycast={noRaycast} />}
      {ends.map(([endId, end]) => (
        <group key={endId} position={end.at as [number, number, number]} quaternion={orientations?.get(endId)} onClick={(event) => {
          if (simple) { event.stopPropagation(); onSelectSimpleCable?.(cableId); return; }
          if (assembly.phase !== "idle") return;
          event.stopPropagation(); selectCableEnd(`${cableId}/${endId}`);
          if (end.plugged) return;
          sceneStore.setState({ pickInScene: true }); pcStore.getState().selectCableEnd(cableId, endId);
        }}>
          <mesh geometry={BOX} material={selected ? SELECTED_END : end.plugged ? CONNECTOR : LOOSE_END} scale={size} userData={{ cableEnd: `${cableId}/${endId}`, looseEnd: !end.plugged }} />
          <mesh geometry={BOX} material={CONTACT} position={[0, -size[1] / 2 - 0.3, 0]} scale={[size[0] * 0.76, 0.8, size[2] * 0.76]} userData={{ looseEnd: !end.plugged }} />
          <mesh geometry={BOX} material={CONNECTOR} position={[size[0] / 2 + 0.7, 0, 0]} scale={[1.4, size[1] * 0.5, size[2] * 0.4]} userData={{ looseEnd: !end.plugged }} />
          {!end.plugged && <mesh geometry={BOX} material={PICK} scale={size.map((s) => Math.max(22, s + 8)) as [number, number, number]} userData={{ cableEnd: `${cableId}/${endId}`, looseEnd: true }} />}
        </group>
      ))}
    </group>
  );
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
function Fasteners({ part, markers }: { part: InstalledPart; markers: FastenerMarker[] }) {
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
          onClick={(event) => {
            if (pcStore.getState().assembly.phase !== "idle") return;
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
  const partCount = placed.size;
  const initialViewDone = useRef(false);
  const orbitCentre = useRef<THREE.Vector3 | null>(null);
  const lastCommandSeq = useRef(command?.seq);

  useEffect(() => {
    controls.enableDamping = false;
    // Orbit and zoom around the middle; a secondary-button drag must not move the pivot.
    controls.enablePan = false;
    controls.zoomToCursor = false;
    controls.minDistance = 60;
    controls.maxDistance = 9000;
    const onChange = () => {
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
};
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
const BENCH_TOP = new THREE.MeshStandardMaterial({ color: BENCH_TOP_COLOR, roughness: 0.9, metalness: 0 });
const BENCH_MAT = new THREE.MeshStandardMaterial({ color: BENCH_MAT_COLOR, roughness: 0.95, metalness: 0 });

/** The workbench every part lies on until it is installed: a wooden top with an anti-static mat on it. */
function Workbench({ placed }: { placed: ReadonlyMap<string, PlacedPart> }) {
  // An empty workbench is still a workbench.
  const area = workbenchArea(placed) ?? { min: [-80, -80] as [number, number], max: [1200, 600] as [number, number] };
  const width = area.max[0] - area.min[0];
  const depth = area.max[1] - area.min[1];
  const centre: [number, number] = [(area.min[0] + area.max[0]) / 2, (area.min[1] + area.max[1]) / 2];
  return (
    <group>
      <mesh geometry={BOX} material={BENCH_TOP} position={[centre[0], -BENCH_TOP_MM / 2 - 2, centre[1]]} scale={[width + 120, BENCH_TOP_MM, depth + 120]} raycast={noRaycast} />
      <mesh geometry={BOX} material={BENCH_MAT} position={[centre[0], -1, centre[1]]} scale={[width, 2, depth]} raycast={noRaycast} />
    </group>
  );
}

function Contents({ state, startup, reducedMotion, noModel, rtl, simple = false, viewId, onSelectPart, simpleCableIds, selectedSimpleCableId, onSelectSimpleCable, onConnectSimpleCable, simpleCableTarget }: PcSceneProps) {
  const projectId = usePC((store) => store.projectId);
  const { geometry, ready } = useGeometry(useMemo(() => state.parts.map((part) => part.catalogId), [state.parts]));
  const placed = useMemo(() => placeParts({ state, geometry, fallbackSize, isAside, standsFirst, benchRowMm: BENCH_ROW_MM }), [state, geometry]);
  const cableEnds = useMemo(() => placeCableEnds(state, placed, geometry), [state, placed, geometry]);
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

  const spinning = new Set(startup.observable.spinning);
  const lit = new Map(startup.observable.lighting.filter((item) => item.lit && item.color).map((item) => [item.instanceId, item.color!]));

  return (
    <>
      {/* Bright, even light: this is a diagram to read, not a mood. */}
      <ambientLight intensity={1.9} />
      <hemisphereLight args={["#ffffff", "#5a6070", 1.2]} />
      <directionalLight position={[500, 900, 700]} intensity={2.4} />
      <directionalLight position={[-600, 400, -500]} intensity={1.1} />
      {/* A rim light from behind and above: it lights the top and back edges of dark parts so their outlines
          separate from the bench. */}
      <directionalLight position={[200, 1200, -1400]} intensity={1.6} />
      <Camera key={viewId ?? projectId} placed={placed} aside={aside} ready={ready} />
      <Workbench placed={placed} />
      {state.parts.map((part) => {
        const item = placed.get(part.instanceId);
        return item ? (
          <Part
            key={part.instanceId}
            part={part}
            placed={item}
            geometry={geometry.get(part.catalogId)}
            selected={selectedId === part.instanceId}
            lit={lit.get(part.instanceId) ?? null}
            spinning={spinning.has(part.instanceId)}
            reducedMotion={reducedMotion}
            noModel={noModel}
            rtl={rtl}
            onSelectPart={onSelectPart}
          />
        ) : null;
      })}
      {state.cables.filter((cable) => !simple || simpleCableIds?.includes(cable.id)).map((cable) => {
        const spec = pc.cableSpecOf(catalogIndex.byId.get(cable.catalogId), cable.cableSpecId);
        const endIds = simple ? Object.keys(cable.ends).slice(0, 1) : Object.keys(cable.ends);
        const ends = endIds.flatMap((endId) => {
          const end = cableEnds.get(`${cable.id}/${endId}`);
          return end ? [[endId, end] as [string, PlacedCableEnd]] : [];
        });
        const owner = cable.ownerInstanceId ? placed.get(cable.ownerInstanceId) : undefined;
        const lead = owner && geometry.get(cable.catalogId)?.leads[cable.cableSpecId];
        const fixedSource = spec?.attachment === "captive" && owner && lead ? compose(owner.frame, { at: lead.at, quat: [0, 0, 0, 1] }).at : undefined;
        const orientations = new Map<string, THREE.Quaternion>();
        for (const [endId] of ends) {
          const to = cable.ends[endId];
          if (to?.kind !== "part") continue;
          const host = placed.get(to.instanceId);
          const hostCatalogId = state.parts.find((part) => part.instanceId === to.instanceId)?.catalogId;
          const port = hostCatalogId && geometry.get(hostCatalogId)?.ports[to.portId];
          if (!host || !port) continue;
          const local = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...port.facing).normalize());
          orientations.set(endId, new THREE.Quaternion(...host.frame.quat).multiply(local));
        }
        return <Cable key={cable.id} cableId={cable.id} kind={spec?.kind ?? ""} ends={ends} fixedSource={fixedSource} orientations={orientations} simple={simple} selected={simple && selectedSimpleCableId === cable.id} onSelectSimpleCable={onSelectSimpleCable} />;
      })}
      {!state.sidePanelOpen && state.parts.filter((part) => part.catalogId === "corsair-4000d-airflow-black").map((part) => {
        const item = placed.get(part.instanceId);
        if (!item) return null;
        const [w, h, d] = item.size;
        return <group key={`window-${part.instanceId}`} position={item.frame.at as [number, number, number]} quaternion={item.frame.quat as [number, number, number, number]}>
          <mesh geometry={BOX} material={finishMaterial("glass")!} position={[w / 2, h / 2, d - 3.5]} scale={[w - 18, h - 32, 1.2]} raycast={noRaycast} />
        </group>;
      })}
      {simple && selectedSimpleCableId && simpleCableTarget && (() => {
        const host = placed.get(simpleCableTarget.instanceId);
        const catalogId = state.parts.find((part) => part.instanceId === simpleCableTarget.instanceId)?.catalogId;
        const port = host && catalogId && geometry.get(catalogId)?.ports[simpleCableTarget.portId];
        if (!host || !port) return null;
        const at = compose(host.frame, { at: add(port.at, scale(port.facing, 10)), quat: [0, 0, 0, 1] }).at;
        return <group position={at as [number, number, number]} quaternion={host.frame.quat as [number, number, number, number]} onClick={(event) => { event.stopPropagation(); onConnectSimpleCable?.(selectedSimpleCableId); }}>
          <mesh geometry={BOX} material={CANDIDATE.ok} scale={(port.size ?? [14, 14, 14]).map((side) => Math.max(26, side + 12)) as [number, number, number]} userData={{ simpleCableTarget: true }} renderOrder={30} />
          <mesh geometry={RING} material={SELECTED_END} scale={20} raycast={noRaycast} renderOrder={31} />
        </group>;
      })()}
      <Candidates markers={markers} />
      {!simple && selectedPart && <Fasteners part={selectedPart} markers={fasteners} />}
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
  simpleCableTarget?: { instanceId: string; portId: string } | null;
  onSelectSimpleCable?: (cableId: string) => void;
  onConnectSimpleCable?: (cableId: string) => void;
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
      camera={{ fov: 40, near: 10, far: 20000, position: [600, 500, 900] }}
      onPointerMissed={() => { if (!props.simple) sceneStore.setState({ selectedPartId: null, selectedCableEnd: null }); }}
    >
      <ContextEvents onLost={onContextLost} />
      <Contents {...props} />
    </Canvas>
  );
}
