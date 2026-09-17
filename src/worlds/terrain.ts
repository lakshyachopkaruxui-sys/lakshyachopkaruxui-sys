import * as THREE from 'three';

/** A real subdivided surface. Contact queries interpolate its rendered triangles. */
export class HeightField {
  readonly geometry: THREE.BufferGeometry;
  private readonly heights: Float32Array;
  constructor(readonly size: number, readonly segments: number, height: (x: number, z: number) => number) {
    const n = segments + 1;
    const positions = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    this.heights = new Float32Array(n * n);
    const indices: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i / segments - 0.5) * size;
      const z = (j / segments - 0.5) * size;
      const k = j * n + i;
      this.heights[k] = height(x, z);
      positions.set([x, this.heights[k], z], k * 3);
      uv.set([i / segments, j / segments], k * 2);
      if (i < segments && j < segments) {
        // Consistent +Y winding, diagonal from (0,1) to (1,0).
        indices.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(indices);
    this.geometry.computeVertexNormals();
  }

  heightAt(x: number, z: number) {
    const u = THREE.MathUtils.clamp((x / this.size + 0.5) * this.segments, 0, this.segments);
    const v = THREE.MathUtils.clamp((z / this.size + 0.5) * this.segments, 0, this.segments);
    const i = Math.min(this.segments - 1, Math.floor(u));
    const j = Math.min(this.segments - 1, Math.floor(v));
    const a = u - i, b = v - j, n = this.segments + 1, k = j * n + i;
    const h = this.heights;
    return a + b <= 1
      ? h[k] * (1 - a - b) + h[k + 1] * a + h[k + n] * b
      : h[k + n + 1] * (a + b - 1) + h[k + n] * (1 - a) + h[k + 1] * (1 - b);
  }
}
