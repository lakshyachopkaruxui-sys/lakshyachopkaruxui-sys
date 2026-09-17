import * as THREE from 'three';

// The curled/folded flap around the tear boundary — gives the opening
// visible thickness and the "edges fold backward" look the brief asks for.
// A triangle strip: each boundary point gets an OUTER vertex (on the wall
// surface) and an INNER vertex (pulled toward the hole's centroid and
// pushed backward in -Z, i.e. curling away from the viewer into the gap).
// Reuses the exact same boundary points TearGeometry cut the hole from, so
// the flap always matches the hole precisely.
export class TearEdgeGeometry {
  constructor(segments = 44) {
    this.segments = segments;
    this.geometry = new THREE.BufferGeometry();

    const posArray = new Float32Array(segments * 2 * 3);
    const uvArray = new Float32Array(segments * 2 * 2);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(segments * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage)
    );

    const indices = [];
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const o0 = i * 2, in0 = i * 2 + 1;
      const o1 = next * 2, in1 = next * 2 + 1;
      indices.push(o0, in0, o1, in0, in1, o1);
    }
    this.geometry.setIndex(indices);

    this.mesh = new THREE.Mesh(this.geometry, null);
    this.geometry.setDrawRange(0, 0);
  }

  update(boundaryPoints, signal, timeSeed) {
    if (!boundaryPoints || boundaryPoints.length === 0) {
      this.geometry.setDrawRange(0, 0);
      return;
    }

    const n = Math.min(boundaryPoints.length, this.segments);
    const posAttr = this.geometry.attributes.position;
    const uvAttr = this.geometry.attributes.uv;

    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      cx += boundaryPoints[i].x;
      cy += boundaryPoints[i].y;
    }
    cx /= n;
    cy /= n;

    const curlDepth = THREE.MathUtils.lerp(0.008, 0.07, signal.stress);
    const curlInset = THREE.MathUtils.lerp(0.006, 0.045, signal.openAmount);

    for (let i = 0; i < n; i++) {
      const p = boundaryPoints[i];
      const o = i * 2, inn = i * 2 + 1;
      posAttr.setXYZ(o, p.x, p.y, 0);

      const dx = cx - p.x, dy = cy - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      const jitter = 0.55 + 0.45 * Math.sin(i * 12.9 + timeSeed * 0.3);
      posAttr.setXYZ(inn, p.x + nx * curlInset * jitter, p.y + ny * curlInset * jitter, -curlDepth * jitter);

      uvAttr.setXY(o, i / n, 0);
      uvAttr.setXY(inn, i / n, 1);
    }

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, n * 6);
    this.geometry.computeVertexNormals();
  }
}
