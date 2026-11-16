// Fine surface detail for the 3D parts, made in code: no image files, nothing downloaded.
//
// Each detail is a small tileable texture drawn once into a canvas (copper traces on a board,
// brushing on metal, perforation on a mesh panel, a satin grain on plastic, the weave of cable
// sleeving) and used as a normal or roughness map. Shapes keep their exact size: edges are only
// softened by a fraction of a millimetre, and the pointer still hits the original box.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** One texture unit of the box-projected UVs below, in millimetres: textures repeat in real size. */
export const UV_MM = 40;

// ---------- Canvas textures ----------

type Draw = (context: CanvasRenderingContext2D, size: number, random: () => number) => void;

/** A deterministic random sequence, so every load draws the same detail. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function heightCanvas(size: number, seed: number, draw: Draw): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#808080";
  context.fillRect(0, 0, size, size);
  // The same strokes drawn again one tile over in every direction (same seed, so the same strokes):
  // whatever runs off one edge comes back in at the opposite one, and the tiles join without a seam.
  for (const dy of [-size, 0, size]) {
    for (const dx of [-size, 0, size]) {
      context.save();
      context.translate(dx, dy);
      draw(context, size, seeded(seed));
      context.restore();
    }
  }
  return canvas;
}

/** A tangent-space normal map from a grey height field (Sobel, wrapping at the edges so it tiles). */
function normalTexture(height: HTMLCanvasElement, strength: number, tileMm: number): THREE.CanvasTexture {
  const size = height.width;
  const source = height.getContext("2d")!.getImageData(0, 0, size, size).data;
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const context = out.getContext("2d")!;
  const image = context.createImageData(size, size);
  const at = (x: number, y: number) => source[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      image.data[i] = ((-dx / length) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      image.data[i + 2] = ((1 / length) * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return finish(new THREE.CanvasTexture(out), tileMm);
}

/** A roughness map: the green channel multiplies the material's roughness (1 keeps it). */
function roughnessTexture(height: HTMLCanvasElement, tileMm: number): THREE.CanvasTexture {
  return finish(new THREE.CanvasTexture(height), tileMm);
}

function finish(texture: THREE.CanvasTexture, tileMm: number): THREE.CanvasTexture {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  const repeat = UV_MM / tileMm;
  texture.repeat.set(repeat, repeat);
  return texture;
}

/** Copper traces, pads and vias under the solder mask: raised lines, only felt as relief. */
const drawTraces: Draw = (context, size, random) => {
  context.strokeStyle = "#b4b4b4";
  context.lineCap = "round";
  for (let i = 0; i < 46; i++) {
    context.lineWidth = random() < 0.75 ? 1.6 : 3.2;
    let x = Math.floor(random() * size);
    let y = Math.floor(random() * size);
    context.beginPath();
    context.moveTo(x, y);
    // Routed like a real board: straight runs with 45-degree jogs.
    for (let leg = 0; leg < 3; leg++) {
      const length = 18 + random() * 70;
      const direction = Math.floor(random() * 8) * (Math.PI / 4);
      x += Math.round(Math.cos(direction) * length);
      y += Math.round(Math.sin(direction) * length);
      context.lineTo(x, y);
    }
    context.stroke();
  }
  context.fillStyle = "#c8c8c8";
  for (let i = 0; i < 70; i++) {
    context.beginPath();
    context.arc(random() * size, random() * size, 1.6 + random() * 1.4, 0, Math.PI * 2);
    context.fill();
  }
};

/** Fine brushing along one direction, as on machined aluminium and stamped steel. */
const drawBrushed: Draw = (context, size, random) => {
  for (let i = 0; i < 900; i++) {
    const shade = 150 + Math.floor(random() * 105);
    context.fillStyle = `rgb(${shade},${shade},${shade})`;
    context.fillRect(random() * size, random() * size, 20 + random() * 90, 1);
  }
};

/** Round perforations in a staggered grid, as on a mesh front or a dust filter. */
const drawPerforation: Draw = (context, size) => {
  const pitch = size / 8;
  context.fillStyle = "#1a1a1a";
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      context.beginPath();
      context.arc(col * pitch + (row % 2) * pitch * 0.5, row * pitch * 0.866 * 1.155, pitch * 0.32, 0, Math.PI * 2);
      context.fill();
    }
  }
};

/** A soft satin grain for moulded plastic: breaks up flat highlights without visible pattern. */
const drawSatin: Draw = (context, size, random) => {
  for (let i = 0; i < 2600; i++) {
    const shade = 205 + Math.floor(random() * 50);
    context.fillStyle = `rgb(${shade},${shade},${shade})`;
    context.fillRect(random() * size, random() * size, 2, 2);
  }
};

/** Braided sleeving: diagonal strands crossing over and under. */
const drawBraid: Draw = (context, size) => {
  const strands = 8;
  const pitch = size / strands;
  for (let i = -strands; i < strands * 2; i++) {
    for (const [direction, shade] of [[1, "#c4c4c4"], [-1, "#9c9c9c"]] as const) {
      context.strokeStyle = shade;
      context.lineWidth = pitch * 0.42;
      context.beginPath();
      context.moveTo(i * pitch, 0);
      context.lineTo(i * pitch + direction * size, size);
      context.stroke();
    }
  }
};

export interface SurfaceSet {
  pcbNormal: THREE.Texture;
  brushedRoughness: THREE.Texture;
  meshNormal: THREE.Texture;
  satinRoughness: THREE.Texture;
  braidNormal: THREE.Texture;
}

let surfaces: SurfaceSet | null = null;

/** The detail textures, drawn on first use (in the browser only) and shared by every part. */
export function surfaceSet(): SurfaceSet | null {
  if (typeof document === "undefined") return null;
  surfaces ??= {
    pcbNormal: normalTexture(heightCanvas(256, 7, drawTraces), 2.2, 34),
    brushedRoughness: roughnessTexture(heightCanvas(256, 11, drawBrushed), 28),
    meshNormal: normalTexture(heightCanvas(128, 13, drawPerforation), 3, 7),
    satinRoughness: roughnessTexture(heightCanvas(128, 17, drawSatin), 14),
    braidNormal: normalTexture(heightCanvas(64, 19, drawBraid), 2.5, 4),
  };
  return surfaces;
}

/** Which detail a surface gets, by its finish (or, without one, its role). */
export function detailFor(finish: string | undefined, role: string): { normal?: keyof SurfaceSet; roughness?: keyof SurfaceSet; normalScale?: number } {
  const key = finish ?? role;
  if (key === "pcb_black" || key === "pcb_green" || key === "pcb") return { normal: "pcbNormal", normalScale: 0.55 };
  if (key === "aluminium" || key === "nickel" || key === "black_metal" || key === "brushed_mark" || key === "heatsink" || key === "bracket" || key === "io_shield" || key === "backplate") return { roughness: "brushedRoughness" };
  if (key === "mesh" || key === "grille") return { normal: "meshNormal", normalScale: 0.8 };
  if (key === "black_plastic" || key === "grey_plastic" || key === "white_plastic" || key === "shroud" || key === "body" || key === "panel" || key === "plate") return { roughness: "satinRoughness" };
  return {};
}

/** Puts a surface's detail maps on a material (once, when the material is made). */
export function applyDetail(material: THREE.MeshStandardMaterial, finish: string | undefined, role: string): THREE.MeshStandardMaterial {
  const set = surfaceSet();
  if (!set) return material;
  const detail = detailFor(finish, role);
  if (detail.normal) {
    material.normalMap = set[detail.normal];
    material.normalScale.set(detail.normalScale ?? 1, detail.normalScale ?? 1);
  }
  if (detail.roughness) material.roughnessMap = set[detail.roughness];
  return material;
}

// ---------- Geometry with real-size UVs and softened edges ----------

const boxes = new Map<string, THREE.BufferGeometry>();
const cylinders = new Map<string, THREE.BufferGeometry>();
const key = (...values: number[]) => values.map((value) => value.toFixed(2)).join("x");

/**
 * UVs projected from the dominant axis of each vertex normal, in UV_MM units: a texture tiles at
 * its real size on every face, whatever the box's proportions.
 */
function boxProject(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const [nx, ny, nz] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))];
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const [u, v] = nx >= ny && nx >= nz ? [z, y] : ny >= nz ? [x, z] : [x, y];
    uv[i * 2] = u / UV_MM;
    uv[i * 2 + 1] = v / UV_MM;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * A box of the given size (millimetres), centred, with edges rounded by a fraction of a millimetre
 * so light catches them as on a moulded or machined part. Very thin boxes keep sharp edges. Cached
 * by size: parts share their geometry.
 */
export function detailedBox(width: number, height: number, depth: number): THREE.BufferGeometry {
  const id = key(width, height, depth);
  let geometry = boxes.get(id);
  if (!geometry) {
    const smallest = Math.min(width, height, depth);
    geometry = smallest >= 2
      // One bevel step: at these radii (a millimetre or less) it catches the light as well as more
      // steps would, at about a third of the triangles (108 per box rather than 300), which keeps
      // the frame rate of the full build close to the plain boxes.
      ? new RoundedBoxGeometry(width, height, depth, 1, Math.min(1.2, Math.max(0.25, smallest * 0.06)))
      : new THREE.BoxGeometry(width, height, depth);
    boxes.set(id, boxProject(geometry));
  }
  return geometry;
}

/** A cylinder along y (radius, height in mm) whose UVs run at real size around and along it. */
export function detailedCylinder(radius: number, height: number): THREE.BufferGeometry {
  const id = key(radius, height);
  let geometry = cylinders.get(id);
  if (!geometry) {
    geometry = new THREE.CylinderGeometry(radius, radius, height, 40);
    const uv = geometry.getAttribute("uv");
    const around = (2 * Math.PI * radius) / UV_MM;
    const along = height / UV_MM;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * along);
    cylinders.set(id, geometry);
  }
  return geometry;
}

const unitBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
const hits: THREE.Intersection[] = [];
const scratchScale = new THREE.Vector3();
/**
 * A raycast against the plain box of `size` (the shape the part had before its edges were
 * rounded), so what the pointer hits, and where, is exactly what it was.
 */
export function boxRaycast(size: readonly [number, number, number]) {
  return function raycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    unitBox.matrixWorld.copy(this.matrixWorld).scale(scratchScale.set(size[0], size[1], size[2]));
    // The part's own material, so faces are hit-tested on the same side(s) as before.
    unitBox.material = this.material;
    hits.length = 0;
    unitBox.raycast(raycaster, hits);
    for (const hit of hits) intersects.push({ ...hit, object: this });
  };
}

/** A cylinder hit test with the plain cylinder's shape (radius, height), for the same reason. */
const unitCylinder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40));
export function cylinderRaycast(radius: number, height: number) {
  return function raycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    unitCylinder.matrixWorld.copy(this.matrixWorld).scale(scratchScale.set(radius, height, radius));
    unitCylinder.material = this.material;
    hits.length = 0;
    unitCylinder.raycast(raycaster, hits);
    for (const hit of hits) intersects.push({ ...hit, object: this });
  };
}

/**
 * Sleeving texture coordinates in real length: along a tube the texture repeats every UV_MM
 * millimetres, so the braid pitch is the same on a short fan lead and a long 24-pin run.
 */
export function stretchTubeUv(geometry: THREE.BufferGeometry, lengthMm: number, radiusMm: number): THREE.BufferGeometry {
  const uv = geometry.getAttribute("uv");
  const around = (2 * Math.PI * radiusMm) / UV_MM;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (lengthMm / UV_MM), uv.getY(i) * around);
  uv.needsUpdate = true;
  return geometry;
}
