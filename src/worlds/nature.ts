import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** PBR textures are local assets; no third-party requests during an experience. */
export function surfaceMaps(kind: 'ground' | 'rock', repeat = 1) {
  const loader = new THREE.TextureLoader();
  const load = (suffix: string, color = false) => {
    const texture = loader.load(`/textures/refined/${kind}_${suffix}.jpg`);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 4;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  return { map: load('color', true), normalMap: load('normal'), roughnessMap: load('roughness') };
}

/** A gently cupped leaf with a real centre ridge, curved tip and smooth normals. */
export function leafGeometry(length = 0.2, width = 0.05, segments = 8) {
  const p: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, w = Math.sin(Math.PI * t) * width;
    for (let j = 0; j < 3; j++) {
      p.push((j - 1) * w, Math.sin(t * Math.PI) * length * 0.13 + (j === 1 ? w * 0.22 : 0), t * length);
      uv.push(j / 2, t);
    }
    if (i < segments) for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Fine paired leaflets on arched fronds; its root is exactly at local Y=0. */
export function fernGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let f = 0; f < 7; f++) {
    const angle = f * Math.PI * 2 / 7;
    const length = 0.4 + (f % 3) * 0.07;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(), new THREE.Vector3(0, 0.8, length * 0.3), new THREE.Vector3(0, 0.3, length)
    );
    const stem = new THREE.TubeGeometry(curve, 12, 0.006, 3, false);
    stem.rotateY(angle); parts.push(stem);
    for (let i = 1; i < 9; i++) for (const side of [-1, 1]) {
      const t = i / 10;
      const g = leafGeometry(0.13 * Math.sin(t * Math.PI) + 0.025, 0.019, 4);
      g.rotateY(side * 1.03);
      const at = curve.getPoint(t);
      g.translate(at.x, at.y, at.z);
      g.rotateY(angle); parts.push(g);
    }
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach(g => g.dispose());
  return merged;
}

/** Rounded weathered stone. Displacement is a function of position, so UV seams stay welded. */
export function stoneGeometry() {
  const g = new THREE.SphereGeometry(1, 24, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.075 * Math.sin(x * 5 + z * 4) * Math.cos(y * 6 - z * 3) + 0.035 * Math.sin(z * 9 + y * 2);
    p.setXYZ(i, x * n, y * n * 0.64 + 0.64, z * n * 0.86);
  }
  g.computeVertexNormals();
  return g;
}

/** Cheap contact shade retained when dynamic XR shadows are disabled. */
export function contactTexture() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    const k = (y * size + x) * 4;
    data[k] = data[k + 1] = data[k + 2] = 255;
    data[k + 3] = Math.round(255 * Math.pow(Math.max(0, 1 - r), 2));
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
