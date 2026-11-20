import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { inView, screenHoverPoint } from "./GuideRobot";

// A close-up like the memory-slot view: the eye 240 mm from the slot, looking down at an angle.
function closeUp(aspect: number) {
  const camera = new THREE.PerspectiveCamera(40, aspect, 1, 5000);
  camera.position.set(0, 200, 140);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}
const screen = (p: readonly number[], camera: THREE.Camera) => new THREE.Vector3(...p).project(camera);
const gap = (a: THREE.Vector3, b: THREE.Vector3, aspect: number) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

describe("the robot beside a memory clip", () => {
  const clip = [0, 9, 60] as const;
  // The other clips and keys along the slots, 9.5 mm apart.
  const avoid = [-19, -9.5, 9.5, 19].flatMap((x) => [[x, 9, 60], [x, 9, -5]] as [number, number, number][]);

  for (const aspect of [16 / 10, 0.6]) {
    it(`stays in view, clear of the clip and the other features (aspect ${aspect.toFixed(2)})`, () => {
      const camera = closeUp(aspect);
      const at = screenHoverPoint([...clip], camera, avoid, [], 0.18);
      expect(at).not.toBeNull();
      const n = screen(at!, camera);
      expect(inView(n, 0.15)).toBe(true);
      expect(gap(n, screen(clip, camera), aspect)).toBeGreaterThan(0.2);
      for (const a of avoid) expect(gap(n, screen(a, camera), aspect)).toBeGreaterThanOrEqual(0.2);
      // Above the board, under the eye.
      expect(at![1]).toBeGreaterThan(clip[1]);
    });
  }

  it("stays in view when the target is out of view (and does not move the camera)", () => {
    const camera = closeUp(16 / 10);
    const before = camera.position.clone();
    const far: [number, number, number] = [400, 9, 60];
    expect(inView(screen(far, camera))).toBe(false);
    const at = screenHoverPoint(far, camera, [], [], 0.18);
    expect(at).not.toBeNull();
    expect(inView(screen(at!, camera), 0.15)).toBe(true);
    expect(camera.position.equals(before)).toBe(true);
  });
});
