"use client";

// The guide robot in the 3D view: the page's robot, modelled in 3D, hovering beside the place the
// guide points at (see `guide.ts`). It never decides anything: the target comes from the simulation,
// its position from the same mount and port frames the scene draws with. It is not clickable, never
// moves the camera, and stays out of parts, out of the case and out of the line of sight to its target.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { PCBuildState } from "@ytl/contracts";
import type { GuideFocus, GuideTarget } from "../guide";
import type { PartGeometry, Vec3 } from "./geometry";
import type { Obstacle } from "./cable-visuals";
import { add, compose, rotate, scale, type PlacedPart } from "./placement";
import { socketLayout, socketMoved, socketPoint } from "./SocketMechanism";
import { catalogIndex } from "../catalog";
const pcCatalogMount = (catalogId: string | undefined, mountId: string) => (catalogId ? catalogIndex.byId.get(catalogId)?.mountPoints.find((m) => m.id === mountId)?.retention?.id : undefined);

const noRaycast = () => null;
/** Compact guide: about 110 mm tall, leaving the component and its mounting point visible. */
const SIZE = 1;
const BASE_RADIUS = 46 * SIZE;
/**
 * Seen from close up (a phone's view glides in to a small place), the robot shrinks and comes closer, so
 * it stays about the same size on screen and never fills the view: 1 from the default distance, down to 0.4.
 */
// Close up it shrinks well below the size of a socket, so it never covers what it points at.
export const nearScale = (cameraToTarget: number) => THREE.MathUtils.clamp(cameraToTarget / 1300, 0.15, 1);
const TABLE_CLEAR = 60;

// ---------- Where things are ----------

/** The scene point of a guide target, from the frames the scene already uses. */
export function targetPoint(target: GuideTarget, placed: ReadonlyMap<string, PlacedPart>, geometry: ReadonlyMap<string, PartGeometry>, state: PCBuildState, caseId: string | null): Vec3 | null {
  const catalogOf = (id: string) => state.parts.find((part) => part.instanceId === id)?.catalogId;
  if (target.kind === "powerButton") {
    const item = caseId ? placed.get(caseId) : undefined;
    if (!item) return null;
    const [x, y, z] = item.size;
    return compose(item.frame, { at: [x - 30, y + 4, z / 2], quat: [0, 0, 0, 1] }).at;
  }
  if (target.kind === "part") {
    const item = placed.get(target.instanceId);
    if (!item) return null;
    const groups = Object.values(item.groupFrames);
    const frame = groups[0] ?? item.frame;
    // A part made of two bodies points at its first one (a liquid cooler's block); others at their middle.
    return groups.length ? frame.at : add(frame.at, rotate(frame.quat, scale(item.size, 0.5)));
  }
  const host = placed.get(target.hostInstanceId);
  const own = geometry.get(catalogOf(target.hostInstanceId) ?? "");
  if (!host || !own) return null;
  if (target.kind === "solid") {
    const solid = own.solids.find((x) => x.id === target.solidId);
    return solid ? compose(host.frame, { at: [solid.at[0], solid.at[1] + (solid.size?.[1] ?? 0) / 2 + 3, solid.at[2]], quat: [0, 0, 0, 1] }).at : null;
  }
  if (target.kind === "socket") {
    const layout = socketLayout(own, target.placeId, target.socket);
    const board = state.parts.find((part) => part.instanceId === target.hostInstanceId);
    const retentionId = pcCatalogMount(board?.catalogId, target.placeId);
    return layout ? compose(host.frame, { at: socketPoint(layout, target.what, retentionId ? socketMoved(board, retentionId, target.socket) : {}), quat: [0, 0, 0, 1] }).at : null;
  }
  if (target.kind === "mount") {
    const mount = own.mounts[target.placeId];
    return mount ? compose(host.frame, { at: mount.at, quat: mount.quat }).at : null;
  }
  const port = own.ports[target.placeId];
  return port ? compose(host.frame, { at: port.at, quat: [0, 0, 0, 1] }).at : null;
}

const inside = (p: THREE.Vector3, box: Obstacle, margin: number) =>
  p.x > box.min[0] - margin && p.x < box.max[0] + margin && p.y > box.min[1] - margin && p.y < box.max[1] + margin && p.z > box.min[2] - margin && p.z < box.max[2] + margin;

/** Distance from `p` to the segment a–b, and where along it (0 at a, 1 at b). */
function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): { distance: number; t: number } {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
  return { distance: p.distanceTo(a.clone().add(ab.multiplyScalar(t))), t };
}

/**
 * Where the robot hovers for a target seen from `eye`: near it, on the viewer's side, clear of every
 * part (and outside the case unless the target is the case's own button), above the table, and off
 * the line from the eye to the target so it never covers what it points at.
 */
export function hoverPoint(target: Vec3, eye: Vec3, obstacles: readonly Obstacle[], caseBox: Obstacle | null, k = 1): Vec3 {
  const t = new THREE.Vector3(...target);
  const camera = new THREE.Vector3(...eye);
  const RADIUS = BASE_RADIUS * k;
  const inCase = caseBox !== null && inside(t, caseBox, 0);
  const toEye = camera.clone().sub(t).setY(0).normalize();
  const side = new THREE.Vector3(-toEye.z, 0, toEye.x);
  const candidates: THREE.Vector3[] = [];
  if (inCase && caseBox) {
    // Inside the case: outside its open (glass) side, level with the target, a little to one side.
    for (const dy of [80, 20, 150]) for (const dx of [190, -190, 130, -130, 260, -260]) {
      candidates.push(new THREE.Vector3(t.x + dx * k, t.y + dy * k, caseBox.max[2] + RADIUS + 50 * k));
    }
  } else {
    for (const up of [150, 200, 120, 260, 40, -40]) for (const across of [160, -160, 100, -100, 230, -230]) for (const toward of [80, 0, 160, 240]) {
      candidates.push(t.clone().add(side.clone().multiplyScalar(across * k)).add(toEye.clone().multiplyScalar(toward * k)).setY(t.y + up * k));
    }
  }
  let best: THREE.Vector3 | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    // Close up (small k) it may come down near the board, or it would hang halfway to the camera and look huge.
    c.y = Math.max(c.y, RADIUS + TABLE_CLEAR * k);
    if (obstacles.some((box) => inside(c, box, RADIUS))) continue;
    if (caseBox && inside(c, caseBox, RADIUS * 0.6)) continue;
    // Outside the case, it never hovers over it either: seen from above, it would look as if it were inside.
    if (!inCase && caseBox && c.x > caseBox.min[0] - RADIUS * 0.6 && c.x < caseBox.max[0] + RADIUS * 0.6 && c.z > caseBox.min[2] - RADIUS * 0.6 && c.z < caseBox.max[2] + RADIUS * 0.6) continue;
    const sight = segmentDistance(c, camera, t);
    if (sight.t < 0.98 && sight.distance < RADIUS * 1.5) continue;
    // Close to the target, toward the viewer, and not far off the screen's line to it.
    const score = c.distanceTo(t) - 0.35 * c.clone().sub(t).dot(camera.clone().sub(t).normalize()) + 0.2 * Math.abs(c.y - t.y - 140 * k);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  // Nothing clear: beside the target and above it, not toward the eye (that would cover the view).
  const chosen = best ?? t.clone().add(side.multiplyScalar(160 * k)).setY(Math.max(t.y + 160 * k, RADIUS + TABLE_CLEAR * k));
  return [chosen.x, chosen.y, chosen.z];
}

/** Memory clips and slots, and a module in hand: small features worked on close up, placed on screen. */
const standoffFor = (target: GuideTarget | undefined, placed: ReadonlyMap<string, PlacedPart>) =>
  target?.kind === "solid" || (target?.kind === "mount" && target.placeId.startsWith("dimm-")) || (target?.kind === "part" && target.instanceId.startsWith("ram-") && placed.get(target.instanceId)?.onBench === false);

/** Where a point is on screen, in normalised device coordinates (x right, y up, both −1…1 when in view). */
const toScreen = (p: THREE.Vector3, camera: THREE.Camera) => p.clone().project(camera);
/** A point just inside the view's edge in the direction of an out-of-view point (behind the eye: mirrored). */
const edgeToward = (n: THREE.Vector3) => {
  const d = new THREE.Vector2(n.z > 1 ? -n.x : n.x, n.z > 1 ? -n.y : n.y);
  if (d.lengthSq() < 1e-6) d.set(1, 0);
  const k = 0.9 / Math.max(Math.abs(d.x), Math.abs(d.y));
  return new THREE.Vector3(d.x * k, d.y * k, 0.5);
};
/** True when a point is in front of the camera and inside the view (with a margin). */
export const inView = (n: THREE.Vector3, margin = 0) => n.z > -1 && n.z < 1 && Math.abs(n.x) <= 1 - margin && Math.abs(n.y) <= 1 - margin;

/**
 * For close work on small features (memory clips, a slot's key, a module's notch): the robot is placed by
 * where it will appear on screen, not by a fixed distance. It stays inside the view (with a margin), a
 * clear distance from its target and from every other feature to work on, in front of nothing it should
 * not cover, and hovers just above the board under that spot. The camera is never moved for it; when no
 * such spot exists, `null` (the caller falls back to the usual placement).
 */
export function screenHoverPoint(target: Vec3, camera: THREE.Camera, avoid: readonly Vec3[], obstacles: readonly Obstacle[], k: number): Vec3 | null {
  const t = new THREE.Vector3(...target);
  const aspect = (camera as THREE.PerspectiveCamera).aspect || 1;
  const raw = toScreen(t, camera);
  // A target out of view: stay in view, at the edge on its side (it will not point until it can be seen).
  const tN = inView(raw) ? raw : edgeToward(raw);
  const RADIUS = BASE_RADIUS * k;
  const avoidN = avoid.map((a) => toScreen(new THREE.Vector3(...a), camera));
  const screenGap = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const ray = new THREE.Raycaster();
  // Strict first (well inside the view, well clear of every feature); a little less strict when nothing fits,
  // as in a small or narrow view.
  for (const [gap, margin] of [[0.12, 0.18], [0.07, 0.12], [0.03, 0.06]] as const) {
    const found = pick(gap, margin);
    if (found) return found;
  }
  return null;
  function pick(gap: number, margin: number): Vec3 | null {
  let best: THREE.Vector3 | null = null;
  let bestScore = Infinity;
  for (const ring of [0.32, 0.42, 0.26, 0.55, 0.2, 0.7]) for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const n = new THREE.Vector2(tN.x + (Math.cos(angle) * ring) / aspect, tN.y + Math.sin(angle) * ring);
    if (Math.abs(n.x) > 1 - margin || Math.abs(n.y) > 1 - margin) continue;
    ray.setFromCamera(n, camera);
    // Hover a little above the target's height, under that point of the screen.
    for (const lift of [45, 80, 130]) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(t.y + lift * k));
      const c = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!c) continue;
      if (obstacles.some((box) => inside(c, box, RADIUS))) continue;
      const cN = toScreen(c, camera);
      // Its own size on screen there (NDC, vertical), so the clearances below are measured from its edge.
      const fov = ((camera as THREE.PerspectiveCamera).fov ?? 40) * (Math.PI / 180);
      const r = RADIUS / Math.max(1, c.distanceTo(camera.position)) / Math.tan(fov / 2);
      if (!inView(cN, margin + r)) continue;
      // Never over its target or another feature the learner works on (its body or its pointing arm).
      if (screenGap(cN, tN) < 1.3 * r + gap) continue;
      if (avoidN.some((a) => inView(a) && screenGap(a, cN) < 1.3 * r + gap)) continue;
      // Prefer beside the target (left or right) to above or below it, and as low as is clear.
      const score = Math.abs(screenGap(cN, tN) - 0.34) + 0.15 * Math.abs(Math.sin(angle)) + lift / 1000;
      if (score < bestScore) { bestScore = score; best = c; }
      break;
    }
  }
  return best ? [best.x, best.y, best.z] : null;
  }
}

// ---------- The robot ----------

const SHELL = new THREE.MeshStandardMaterial({ color: "#eef1f6", roughness: 0.32, metalness: 0.08 });
const SHELL_SHADE = new THREE.MeshStandardMaterial({ color: "#c3cad6", roughness: 0.4, metalness: 0.1 });
const VISOR = new THREE.MeshStandardMaterial({ color: "#07090d", roughness: 0.18, metalness: 0.35 });
const EYE = new THREE.MeshStandardMaterial({ color: "#7dd3fc", emissive: "#38bdf8", emissiveIntensity: 1.6, roughness: 0.3 });
const CORE = new THREE.MeshStandardMaterial({ color: "#22d3ee", emissive: "#22d3ee", emissiveIntensity: 1.3 });
const GLOW = new THREE.MeshBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
const SPHERE = new THREE.SphereGeometry(1, 32, 24);
const ROD = new THREE.CylinderGeometry(1, 1, 1, 16);
const CONE = new THREE.ConeGeometry(1, 1, 24, 1, true);
const RING = new THREE.TorusGeometry(1, 0.06, 10, 64);
const DOT = new THREE.SphereGeometry(1, 10, 8);

/** Rings and a dotted line that mark a target that is not already glowing (a part to pick up, a port, the button). */
const MARK = { prerequisite: "#fbbf24", next: "#67e8f9", place: "#67e8f9", celebrate: "#4ade80" } as const;
const markMaterials = new Map<string, THREE.MeshBasicMaterial>();
const markMaterial = (color: string) => {
  let material = markMaterials.get(color);
  if (!material) { material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }); markMaterials.set(color, material); }
  return material;
};

export interface GuideRobotProps {
  focus: GuideFocus | null;
  placed: ReadonlyMap<string, PlacedPart>;
  geometry: ReadonlyMap<string, PartGeometry>;
  state: PCBuildState;
  obstacles: readonly Obstacle[];
  caseId: string | null;
  /** False: no flying, bobbing or blinking; the robot appears where it points (reduced motion, or animated guidance off). */
  animate: boolean;
}

export function GuideRobot({ focus, placed, geometry, state, obstacles, caseId, animate }: GuideRobotProps) {
  const camera = useThree((three) => three.camera);
  const invalidate = useThree((three) => three.invalidate);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const pointer = useRef<THREE.Group>(null);
  const other = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Mesh>(null);
  const line = useRef<THREE.Group>(null);

  const points = useMemo(
    () => (focus ? focus.targets.map((target) => targetPoint(target, placed, geometry, state, caseId)).filter((p): p is Vec3 => p !== null) : []),
    [focus, placed, geometry, state, caseId],
  );
  const caseBox = useMemo<Obstacle | null>(() => {
    const item = caseId ? placed.get(caseId) : undefined;
    if (!item) return null;
    const a = item.frame.at;
    const b = add(a, rotate(item.frame.quat, item.size));
    return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
  }, [placed, caseId]);

  // Where it hovers: chosen when the target changes, and again once the learner stops turning the view.
  const goal = useRef<THREE.Vector3 | null>(null);
  const near = useRef(1);
  const shownScale = useRef(1);
  const placedFrom = useRef(new THREE.Vector3());
  const still = useRef(0);
  // The features worked on close up (memory clips, slot keys, a module's notch): never covered by the robot.
  const avoid = useMemo(() => {
    const out: Vec3[] = [];
    for (const [id, item] of placed) {
      const own = geometry.get(state.parts.find((p) => p.instanceId === id)?.catalogId ?? "");
      for (const solid of own?.solids ?? []) {
        if (/^dimm-[a-z0-9]+-(latch|latch-near|key)$/.test(solid.id) || solid.id === "notch") out.push(compose(item.frame, { at: solid.at, quat: [0, 0, 0, 1] }).at);
      }
    }
    return out;
  }, [placed, geometry, state.parts]);
  const scene = useThree((three) => three.scene);
  const size = useThree((three) => three.size);
  const occluded = useRef(false);
  const blocker = useRef("");
  const pointing = useRef(true);
  /** True when something solid stands between the eye and the target (see-through and invisible parts aside). */
  const sightAge = useRef(Infinity);
  const blocked = (target: Vec3, own?: string, ownRadius = 0) => {
    const t = new THREE.Vector3(...target);
    const dir = t.clone().sub(camera.position);
    const dist = dir.length();
    const ray = new THREE.Raycaster(camera.position.clone(), dir.normalize(), 0, dist);
    for (const hit of ray.intersectObjects(scene.children, true)) {
      const o = hit.object as THREE.Mesh;
      if (!o.visible || o.userData.heldHandle || o.userData.mechanismHandle) continue;
      // A part pointed at as a whole is not hidden by its own surface.
      if (own && o.userData.part === own) continue;
      const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material | undefined;
      // Pick boxes (drawn with colour off), see-through and invisible materials hide nothing.
      if (!m || (m.transparent && m.opacity < 0.6) || !m.visible || m.colorWrite === false) continue;
      let shown = true;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) { shown = false; break; }
      if (!shown) continue;
      if (hit.distance < dist - Math.max(6, ownRadius)) { blocker.current = `${o.type}:${o.name || ""}:${JSON.stringify(o.userData)}:${m.type}:${Math.round(dist - hit.distance)}`; return true; }
      return false;
    }
    return false;
  };
  const choose = () => {
    const target = points[0];
    if (!target) { goal.current = null; return; }
    near.current = nearScale(camera.position.distanceTo(new THREE.Vector3(...target)));
    const close = standoffFor(focus?.targets[0], placed) ? screenHoverPoint(target, camera, avoid, obstacles, near.current) : null;
    let at: Vec3 = close ?? hoverPoint(target, camera.position.toArray() as unknown as Vec3, obstacles, caseBox, near.current);
    // The line of sight is checked again on the next frame (not here: one scene raycast at a time).
    sightAge.current = Infinity;
    // Celebrating: beside the case, up high, where the whole build stays in view.
    if (focus?.reason === "celebrate" && caseBox) at = [caseBox.max[0] + 120, caseBox.max[1] - 40, (caseBox.min[2] + caseBox.max[2]) / 2 + 140];
    goal.current = new THREE.Vector3(...at);
    placedFrom.current.copy(camera.position);
  };
  /** Set when the way to the new spot would pass through the case: it blinks out and in there instead. */
  const hop = useRef(false);
  // The same target again (a re-render with an equal focus): nothing to do. Re-choosing here would restart a
  // hop (fade out and in) on every render and could keep the robot from ever showing.
  const lastChosen = useRef("");
  useEffect(() => {
    const key = `${JSON.stringify(points.map((p) => p.map((v) => Math.round(v * 2) / 2)))}|${focus?.reason}|${animate}|${size.width}x${size.height}`;
    if (key === lastChosen.current) return;
    lastChosen.current = key;
    const from = root.current?.position.clone();
    choose();
    if (from && goal.current && caseBox && root.current?.visible && segmentCrosses(from, goal.current, caseBox)) hop.current = true;
    // A new target: an immediate frame, and a jump when not animating.
    if (!animate && goal.current && root.current) root.current.position.copy(goal.current);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, focus?.reason, animate, size.width, size.height]);

  const visible = useRef(0);
  const shown = focus !== null && points.length > 0;
  // For browser checks: where the robot and its target are on screen, its size there, and whether it points.
  useEffect(() => {
    const w = window as unknown as { __ytlRobot?: () => unknown };
    w.__ytlRobot = () => {
      const node = root.current;
      if (!node || !node.visible) return { shown: false };
      const px = (p: THREE.Vector3) => { const n = toScreen(p, camera); return [Math.round(((n.x + 1) / 2) * size.width), Math.round(((1 - n.y) / 2) * size.height)]; };
      const at = node.getWorldPosition(new THREE.Vector3());
      // Its radius measured across the screen (the camera's own up), whatever the view's angle.
      const edge = at.clone().add(new THREE.Vector3(0, BASE_RADIUS * node.scale.y, 0).applyQuaternion(camera.quaternion));
      const centre = px(at);
      return { shown: true, centre, radiusPx: Math.abs(px(edge)[1] - centre[1]), target: points[0] ? px(new THREE.Vector3(...points[0])) : null, pointing: pointing.current, occluded: occluded.current, blocker: blocker.current, avoid: avoid.map((a) => px(new THREE.Vector3(...a))), size: [size.width, size.height] };
    };
    return () => { delete w.__ytlRobot; };
  }, [camera, size, points, avoid]);
  useFrame((frame, delta) => {
    const node = root.current;
    if (!node) return;
    const dt = Math.min(delta, 0.05);
    // The camera came much closer or went much farther (a close-up glide, a zoom): size and spot again,
    // so close up it stays small beside what it points at instead of filling the view.
    if (points[0] && Math.abs(nearScale(camera.position.distanceTo(new THREE.Vector3(...points[0]))) - near.current) > 0.08) choose();
    const time = frame.clock.elapsedTime;
    // Fade in and out by scale. Appearing, it starts where it is needed (it does not fly in from afar).
    const want = shown && !hop.current ? 1 : 0;
    const wasHidden = !node.visible;
    visible.current = animate ? THREE.MathUtils.damp(visible.current, want, 10, dt) : want;
    node.visible = visible.current > 0.02;
    shownScale.current = animate ? THREE.MathUtils.damp(shownScale.current, near.current, 6, dt) : near.current;
    node.scale.setScalar(Math.max(0.001, visible.current) * SIZE * shownScale.current);
    if (hop.current && visible.current < 0.06) {
      if (goal.current) node.position.copy(goal.current);
      hop.current = false;
      frame.invalidate();
    }
    if (!node.visible) return;
    if (wasHidden && goal.current) node.position.copy(goal.current);
    // The learner turned the view: once it has been still for a moment, find a spot again.
    if (camera.position.distanceTo(placedFrom.current) > 40) {
      still.current += dt;
      if (still.current > 0.35) { still.current = 0; choose(); }
    } else still.current = 0;
    const g = goal.current;
    if (g) {
      // It appears where it is needed, then flies from one target to the next.
      // Still growing in: stay put at the goal (a frame can come before the goal is first set).
      if (animate && visible.current > 0.5) node.position.lerp(g, 1 - Math.exp(-dt * 5));
      else node.position.copy(g);
    }
    const target = points[0] ? new THREE.Vector3(...points[0]) : null;
    const celebrate = focus?.reason === "celebrate";
    // Is the target hidden behind something? Checked at most twice a second (a raycast through the scene).
    sightAge.current += dt;
    if (target && sightAge.current > 0.5) {
      sightAge.current = 0;
      const first = focus?.targets[0];
      const own = first?.kind === "part" ? placed.get(first.instanceId) : undefined;
      // A part pointed at as a whole: its own body never hides it, and its middle is inside it.
      occluded.current = blocked(points[0]!, first?.kind === "part" ? first.instanceId : undefined, own ? Math.hypot(...own.size) / 2 : 0);
    }
    // Points only at what the learner can see now: in view and not hidden (checked when it last chose a spot).
    const canPoint = Boolean(target && inView(toScreen(target, camera)) && !occluded.current);
    pointing.current = canPoint;
    // Face the viewer, turned slightly toward the target, so its face stays readable while it points.
    const toCamera = Math.atan2(camera.position.x - node.position.x, camera.position.z - node.position.z);
    const toTarget = target ? Math.atan2(target.x - node.position.x, target.z - node.position.z) : toCamera;
    const yaw = celebrate ? toCamera : toCamera + Math.atan2(Math.sin(toTarget - toCamera), Math.cos(toTarget - toCamera)) * 0.2;
    node.rotation.y = animate ? dampAngle(node.rotation.y, yaw + (celebrate ? Math.sin(time * 2.4) * 0.25 : 0), 6, dt) : yaw;
    if (body.current) body.current.position.y = animate ? Math.sin(time * 1.8) * 1.8 + (celebrate ? Math.abs(Math.sin(time * 4)) * 6 : 0) : 0;
    if (head.current && target) {
      // Keep its face readable from above; the arm already indicates the installation target.
      const viewer = node.worldToLocal(camera.position.clone());
      const tilt = THREE.MathUtils.clamp(-Math.atan2(viewer.y - 40, Math.hypot(viewer.x, viewer.z)) * 0.7, -0.65, 0.35);
      head.current.rotation.x = animate ? THREE.MathUtils.damp(head.current.rotation.x, tilt, 8, dt) : tilt;
    }
    // The arm on the target's side points (so it never reaches across the body); the other rests, or both cheer.
    if (pointer.current && other.current && target) {
      const side = node.worldToLocal(target.clone()).x >= 0 ? 1 : -1;
      pointer.current.position.x = 28 * side;
      other.current.position.x = -28 * side;
    }
    if (pointer.current) {
      if (celebrate) pointer.current.rotation.set(0, 0, -Math.sign(pointer.current.position.x || -1) * (Math.PI * 0.85 + (animate ? Math.sin(time * 8) * 0.25 : 0)));
      else if (target && !canPoint) {
        // The target is out of view or hidden behind something: no pointing at a spot that cannot be seen.
        const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -(Math.sign(pointer.current.position.x) || 1) * 0.18));
        if (animate) pointer.current.quaternion.slerp(rest, 1 - Math.exp(-10 * dt));
        else pointer.current.quaternion.copy(rest);
      } else if (target) {
        const local = node.worldToLocal(target.clone()).sub(pointer.current.position).normalize();
        const pointing = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), local);
        if (animate) pointer.current.quaternion.slerp(pointing, 1 - Math.exp(-10 * dt));
        else pointer.current.quaternion.copy(pointing);
      }
    }
    if (other.current) {
      const out = Math.sign(other.current.position.x) || 1;
      other.current.rotation.set(0, 0, celebrate ? out * (Math.PI * 0.85 + (animate ? Math.sin(time * 8) * 0.25 : 0)) : out * 0.18);
    }
    if (eyes.current) eyes.current.scale.y = animate && time % 4.2 > 4.05 ? 0.15 : 1;
    if (flame.current) flame.current.scale.set(7, 11 + (animate ? Math.sin(time * 10) * 0.7 : 0), 7);
    // The dotted line from the fingertip to the target, when the target is not already glowing.
    if (line.current) line.current.visible = canPoint;
    if (line.current && pointer.current && target && canPoint) {
      const tip = pointer.current.localToWorld(new THREE.Vector3(0, -36, 0));
      const dots = line.current.children;
      dots.forEach((dot, i) => {
        const k = (i + 1) / (dots.length + 1);
        const travel = animate ? ((time * 0.6 + k) % 1) : k;
        dot.position.copy(tip.clone().lerp(target, travel));
      });
    }
    if (animate || node.position.distanceTo(g ?? node.position) > 0.5) frame.invalidate();
  });

  const reason = focus?.reason ?? "next";
  const markColor = MARK[reason];
  // A place already glows (the scene's own target): no ring over it, only the dotted line.
  const showRings = reason !== "place" && reason !== "celebrate";
  const showLine = reason !== "celebrate";
  return (
    <>
      <group ref={root} visible={false}>
        <group ref={body}>
          {/* Body: an egg, with a seam and the glowing core of the page robot. */}
          <mesh geometry={SPHERE} material={SHELL} scale={[27, 34, 25]} position={[0, 0, 0]} raycast={noRaycast} castShadow />
          <mesh geometry={RING} material={SHELL_SHADE} scale={[25, 25, 25]} position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast} />
          <mesh geometry={SPHERE} material={CORE} scale={[4, 4, 2]} position={[0, 6, 23.5]} raycast={noRaycast} />
          {/* Head: a wide shell with a dark visor and two eyes; a short antenna with a light. */}
          <group ref={head} position={[0, 40, 0]}>
            <mesh geometry={SPHERE} material={SHELL} scale={[33, 25, 28]} raycast={noRaycast} castShadow />
            <mesh geometry={SPHERE} material={VISOR} scale={[24, 14, 8]} position={[0, -1, 22]} raycast={noRaycast} />
            <group ref={eyes} position={[0, 0, 28.5]}>
              <mesh geometry={SPHERE} material={EYE} scale={[4.6, 5.6, 2]} position={[-9, 0, 0]} raycast={noRaycast} />
              <mesh geometry={SPHERE} material={EYE} scale={[4.6, 5.6, 2]} position={[9, 0, 0]} raycast={noRaycast} />
            </group>
            <mesh geometry={SPHERE} material={SHELL_SHADE} scale={[5, 8, 8]} position={[-33, 0, 0]} raycast={noRaycast} />
            <mesh geometry={SPHERE} material={SHELL_SHADE} scale={[5, 8, 8]} position={[33, 0, 0]} raycast={noRaycast} />
            <mesh geometry={ROD} material={SHELL_SHADE} scale={[1.4, 14, 1.4]} position={[0, 30, 0]} raycast={noRaycast} />
            <mesh geometry={SPHERE} material={CORE} scale={3.4} position={[0, 38, 0]} raycast={noRaycast} />
          </group>
          {/* Arms from the shoulders: the right one points, the left one rests (both cheer). */}
          <group ref={pointer} position={[-28, 10, 0]}>
            <mesh geometry={ROD} material={SHELL} scale={[5.5, 30, 5.5]} position={[0, -15, 0]} raycast={noRaycast} castShadow />
            <mesh geometry={SPHERE} material={SHELL} scale={6} position={[0, -31, 0]} raycast={noRaycast} />
          </group>
          <group ref={other} position={[28, 10, 0]}>
            <mesh geometry={ROD} material={SHELL} scale={[5.5, 30, 5.5]} position={[0, -15, 0]} raycast={noRaycast} castShadow />
            <mesh geometry={SPHERE} material={SHELL} scale={6} position={[0, -31, 0]} raycast={noRaycast} />
          </group>
          {/* A soft hover glow under it: it floats, so it never stands on (or in) the table. */}
          <mesh ref={flame} geometry={CONE} material={GLOW} position={[0, -39, 0]} rotation={[Math.PI, 0, 0]} raycast={noRaycast} />
        </group>
      </group>
      {shown && showLine && (
        <>
          {showRings && points.map((p, i) => <TargetRing key={i} at={p} color={markColor} animate={animate} />)}
          <group ref={line}>{Array.from({ length: 9 }, (_, i) => <mesh key={i} geometry={DOT} material={markMaterial(markColor)} scale={2.2} renderOrder={40} raycast={noRaycast} />)}</group>
        </>
      )}
    </>
  );
}

/** A ring that lies around a target (never over it) and breathes slowly. */
function TargetRing({ at, color, animate }: { at: Vec3; color: string; animate: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((frame) => {
    if (!ring.current) return;
    const k = animate ? 1 + Math.sin(frame.clock.elapsedTime * 3) * 0.08 : 1;
    ring.current.scale.set(30 * k, 30 * k, 30 * k);
    if (animate) frame.invalidate();
  });
  return <mesh ref={ring} geometry={RING} material={markMaterial(color)} position={at as unknown as [number, number, number]} rotation={[Math.PI / 2, 0, 0]} renderOrder={40} raycast={noRaycast} />;
}

/** True when the straight way from a to b passes through the box (sampled; the box is large). */
function segmentCrosses(a: THREE.Vector3, b: THREE.Vector3, box: Obstacle): boolean {
  for (let i = 1; i < 24; i++) if (inside(a.clone().lerp(b, i / 24), box, BASE_RADIUS * 0.4)) return true;
  return false;
}

function dampAngle(from: number, to: number, lambda: number, dt: number) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * (1 - Math.exp(-lambda * dt));
}
