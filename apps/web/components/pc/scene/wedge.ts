// A right-triangle prism one unit on each side, centred like a unit box: the triangle lies in x–z with its
// right angle at (−x, +z), and it is one unit tall along y. Scaled by a solid's size it draws the gold
// corner triangle of a CPU and the matching mark on its socket (geometry shape "wedge").
import * as THREE from "three";

function build(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Shape (x, s) becomes (x, ·, −s) after the turn below, so s = −0.5 is z = +0.5.
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(-0.5, 0.5);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.5, 0);
  g.computeVertexNormals();
  return g;
}

export const WEDGE = build();
