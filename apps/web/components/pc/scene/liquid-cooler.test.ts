// The 280 mm liquid cooler of the guided build, as the 3D view draws it: block on the CPU, radiator
// upright behind the front panel, the case's two fans moved to the top, and two hoses between them.
// Checked on the real model files with the view's own details, so a clash shows up here first.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { InstalledPart, PCBuildState } from "@ytl/contracts";
import { createSimpleBuild, installSimplePart, type SimplePartKey } from "../simple-model";
import { simpleBenchLayout } from "../simple-scene";
import type { Frame, PartGeometry, Quat, Vec3 } from "./geometry";
import { boxCorners, compose, placeParts, scale, type PlacedPart } from "./placement";
import { HOSE_ROUTES, withVisualDetails } from "./visual-details";

const initial = createSimpleBuild();
const geometry = new Map<string, PartGeometry>();
for (const part of initial.parts) {
  const file = JSON.parse(readFileSync(new URL(`../../../../../assets/pc/geometry/${part.catalogId}.json`, import.meta.url), "utf8")) as PartGeometry;
  geometry.set(part.catalogId, withVisualDetails(file));
}
const AIO = "arctic-liquid-freezer-iii-280";

function build(keys: readonly SimplePartKey[]): PCBuildState {
  let state = initial;
  for (const key of keys) {
    const step = installSimplePart(state, key);
    if (!step.ok) throw new Error(`${key}: ${step.reason}`);
    state = step.state;
  }
  return state;
}
const place = (state: PCBuildState) => placeParts({ state, geometry, fallbackSize: () => [1, 1, 1], standsFirst: (p: InstalledPart) => p.catalogId === "corsair-4000d-airflow-black", benchRowMm: 950, ...simpleBenchLayout(initial) });

type Box = { id: string; min: number[]; max: number[] };
/** Every drawn solid of the fitted parts as a scene box; the case's walls and empty places are left out. */
function solids(state: PCBuildState, placed: Map<string, PlacedPart>): Box[] {
  const boxes: Box[] = [];
  for (const part of state.parts) {
    const item = placed.get(part.instanceId)!;
    if (item.onBench) continue;
    for (const solid of geometry.get(part.catalogId)!.solids) {
      if (!["box", "fins", "cylinder", "rotor"].includes(solid.shape) || ["tray", "bay", "fan_mount", "radiator_mount"].includes(solid.role) || solid.role.endsWith("_keepout")) continue;
      if (part.instanceId === "case-1") continue;
      const frame = (solid.group && item.groupFrames[solid.group]) || item.frame;
      const size = (solid.shape === "box" || solid.shape === "fins" ? solid.size! : (["x", "y", "z"] as const).map((a) => (a === (solid.axis ?? "y") ? solid.height ?? 1 : 2 * (solid.radius ?? 1)))) as Vec3;
      const corners = boxCorners(compose(frame, { at: solid.at, quat: (solid.rotation ?? [0, 0, 0, 1]) as Quat }), scale(size, -0.5), size);
      boxes.push({ id: `${part.instanceId}/${solid.id}`, min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]!))), max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]!))) });
    }
  }
  return boxes;
}
const overlap = (a: Box, b: Box) => [0, 1, 2].every((k) => a.min[k]! < b.max[k]! - 0.5 && b.min[k]! < a.max[k]! - 0.5);
const inside = (p: THREE.Vector3, b: Box, margin = 0) => p.x > b.min[0]! - margin && p.x < b.max[0]! + margin && p.y > b.min[1]! - margin && p.y < b.max[1]! + margin && p.z > b.min[2]! - margin && p.z < b.max[2]! + margin;

/** The hoses' centre lines, as the view draws them. */
function hoses(item: PlacedPart): THREE.CatmullRomCurve3[] {
  const route = HOSE_ROUTES[AIO]!;
  const frameOf = (group: string): Frame => item.groupFrames[group] ?? item.frame;
  const rot = (q: Quat, v: Vec3) => new THREE.Vector3(...v).applyQuaternion(new THREE.Quaternion(...q));
  return route.block.map((from, i) => {
    const to = route.radiator[i]!;
    const [bf, rf] = [frameOf("block"), frameOf("radiator")];
    const a = rot(bf.quat, from.at).add(new THREE.Vector3(...bf.at));
    const b = rot(rf.quat, to.at).add(new THREE.Vector3(...rf.at));
    const reach = Math.min(48, Math.max(22, a.distanceTo(b) * 0.22));
    return new THREE.CatmullRomCurve3([a, a.clone().add(rot(bf.quat, from.dir).multiplyScalar(reach * 0.75)), b.clone().add(rot(rf.quat, to.dir).multiplyScalar(reach)), b], false, "centripetal");
  });
}
function gap([one, two]: THREE.CatmullRomCurve3[]) {
  let least = Infinity;
  for (const a of one!.getPoints(160)) for (const b of two!.getPoints(160)) least = Math.min(least, a.distanceTo(b));
  return least;
}

describe("the 280 mm liquid cooler in the 3D view", () => {
  const state = build(["cpu2", "ram", "ram2", "storage", "motherboard", "aio", "gpu", "psu"]);
  const placed = place(state);
  const boxes = solids(state, placed);

  it("mounts the radiator upright in the front position and moves both case fans to the top", () => {
    const aio = placed.get("cooling-13")!;
    expect(Object.keys(aio.groupFrames).sort()).toEqual(["block", "radiator"]);
    const radiator = boxes.filter((b) => b.id.startsWith("cooling-13/radiator-core"))[0]!;
    // Its 277 mm core stands vertical, behind the front panel.
    expect(radiator.max[1]! - radiator.min[1]!).toBeGreaterThan(270);
    for (const fan of ["fan-9", "fan-10"]) {
      const part = state.parts.find((p) => p.instanceId === fan)!;
      expect(part.attachments[0]!.target.mountPointId, fan).toMatch(/^fan-top-/);
    }
  });

  it("touches nothing: radiator, block, moved fans and the rest of the build stay clear of each other", () => {
    const own = (b: Box) => b.id.startsWith("cooling-13/") || b.id.startsWith("fan-9/") || b.id.startsWith("fan-10/");
    const clashes: string[] = [];
    for (const a of boxes.filter(own)) {
      for (const b of boxes.filter((x) => !x.id.startsWith(a.id.split("/")[0]!))) {
        // The cold plate rests on the CPU's lid: contact, not a clash.
        if (a.id.startsWith("cooling-13/cold-plate") && b.id.startsWith("cpu-12/")) continue;
        if (overlap(a, b)) clashes.push(`${a.id} × ${b.id}`);
      }
    }
    expect(clashes).toEqual([]);
    // Everything stays inside the case: under its roof and behind its front.
    for (const b of boxes.filter(own)) expect(b.max[1]!, b.id).toBeLessThan(464);
  });

  it("runs two hoses side by side that pass through no other part, mounted and on the bench", () => {
    const radius = HOSE_ROUTES[AIO]!.radius;
    const mounted = hoses(placed.get("cooling-13")!);
    expect(gap(mounted)).toBeGreaterThan(2 * radius);
    const others = boxes.filter((b) => !b.id.startsWith("cooling-13/"));
    for (const hose of mounted) {
      const middle = hose.getPoints(80).slice(8, -8);
      const hit = others.find((b) => middle.some((p) => inside(p, b, radius * 0.5)));
      expect(hit?.id ?? null).toBeNull();
    }
    expect(gap(hoses(place(initial).get("cooling-13")!))).toBeGreaterThan(2 * radius);
  });
});
