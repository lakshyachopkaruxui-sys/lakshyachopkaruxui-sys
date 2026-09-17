import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../utils/math';

function merge(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  geometry.computeVertexNormals();
  return geometry;
}

/** All planted assets start at Y=0; the terrain sampler owns their attachment. */
export function coralBranches() {
  const parts: THREE.BufferGeometry[] = [];
  const rng = mulberry32(721);
  const branch = (start: THREE.Vector3, end: THREE.Vector3, radius: number) => {
    const middle = start.clone().lerp(end, .52).add(new THREE.Vector3(.035, .03, -.025));
    parts.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, middle, end), 5, radius, 6, false));
    const tip = new THREE.SphereGeometry(radius, 6, 4); tip.translate(end.x, end.y, end.z); parts.push(tip);
  };
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996;
    const end = new THREE.Vector3(Math.cos(a) * (.3 + rng() * .24), .7 + rng() * .45, Math.sin(a) * (.3 + rng() * .24));
    branch(new THREE.Vector3(0, .032, 0), end, .035);
    for (let j = 0; j < 3; j++) {
      const at = new THREE.Vector3().lerpVectors(new THREE.Vector3(0, .03, 0), end, .4 + j * .18);
      const tip = at.clone().add(new THREE.Vector3(Math.cos(a + j) * .22, .3 + rng() * .2, Math.sin(a + j) * .22));
      branch(at, tip, .023);
    }
  }
  const geometry = merge(parts);
  geometry.computeBoundingBox(); geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  return geometry;
}

export function plateCoral() {
  const parts: THREE.BufferGeometry[] = [];
  const stem = new THREE.CylinderGeometry(.075, .14, .65, 10); stem.translate(0, .325, 0); parts.push(stem);
  for (let row = 0; row < 4; row++) {
    const radius = .73 - row * .115;
    const points = [new THREE.Vector2(.02, -.02), new THREE.Vector2(radius * .45, .035), new THREE.Vector2(radius * .88, .095), new THREE.Vector2(radius, .13), new THREE.Vector2(radius * .995, .105), new THREE.Vector2(radius * .86, .058), new THREE.Vector2(radius * .42, -.005), new THREE.Vector2(.02, -.045)];
    const plate = new THREE.LatheGeometry(points, 36);
    const p = plate.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), d = Math.hypot(x, z) / radius;
      const wave = Math.sin(a * 7 + row) * .021 * d + Math.sin(a * 13) * .013 * d;
      p.setY(i, p.getY(i) + wave);
    }
    plate.translate(Math.sin(row * 2) * .12, .2 + row * .2, Math.cos(row * 2) * .1); parts.push(plate);
  }
  return merge(parts);
}

export function tubeSponges() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const height = .44 + i % 3 * .19, radius = .11 + i % 2 * .025;
    const points = [new THREE.Vector2(.055, 0), new THREE.Vector2(radius * .8, height * .23), new THREE.Vector2(radius, height * .8), new THREE.Vector2(radius * .96, height), new THREE.Vector2(radius * .75, height), new THREE.Vector2(radius * .68, height * .67), new THREE.Vector2(.025, height * .14)];
    const tube = new THREE.LatheGeometry(points, 16);
    tube.rotateZ(Math.sin(i * 3) * .12);
    tube.translate(Math.sin(i * 2.4) * .24, .027, Math.cos(i * 2.4) * .24); parts.push(tube);
  }
  const geometry = merge(parts); geometry.computeBoundingBox(); geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  return geometry;
}

/** A delicate open fan made of real branches, no opaque billboard rectangle. */
export function seaFan() {
  const parts: THREE.BufferGeometry[] = [];
  const center = new THREE.Vector3(0, .14, 0);
  parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(0, .008, 0), center), 1, .015, 4, false));
  for (let i = 0; i < 13; i++) {
    const a = -.96 + i / 12 * 1.92;
    const end = new THREE.Vector3(Math.sin(a) * .85, .28 + Math.cos(a) * 1.05, Math.sin(i * .8) * .065);
    const curve = new THREE.QuadraticBezierCurve3(center, new THREE.Vector3(end.x * .35, .65, .04), end);
    parts.push(new THREE.TubeGeometry(curve, 8, .010, 4, false));
    for (let j = 2; j < 7; j++) {
      const at = curve.getPoint(j / 8), reach = .07 + Math.sin(j / 8 * Math.PI) * .08;
      for (const side of [-1, 1]) {
        const tip = at.clone().add(new THREE.Vector3(side * reach, reach * .65, .012));
        parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(at, tip), 1, .005, 3, false));
      }
    }
  }
  const geometry = merge(parts); geometry.computeBoundingBox(); geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  return geometry;
}

/** Long leaf blades curve in three dimensions; base points remain pinned. */
export function ribbonPlant(tall: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const blades = tall ? 7 : 9;
  for (let k = 0; k < blades; k++) {
    const length = tall ? 2.9 + k % 4 * .62 : .25 + k % 4 * .09;
    const width = tall ? .10 + k % 2 * .035 : .016;
    const angle = k * 2.39996;
    const positions: number[] = [], uv: number[] = [], indices: number[] = [];
    const segments = tall ? 20 : 8;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = Math.sin(t * 2.8 + k) * t * (tall ? .6 : .12);
      const z = Math.cos(t * 3.2 + k) * t * (tall ? .48 : .16);
      const y = length * t * (1 - t * .085);
      const w = width * Math.pow(Math.sin(Math.PI * t), .55) + .001;
      for (let side = -1; side <= 1; side++) {
        positions.push(x + side * w, y + (side === 0 ? w * .22 : 0), z + Math.sin(t * 16 + k) * w * .35);
        uv.push((side + 1) / 2, t);
      }
      if (i < segments) for (let side = 0; side < 2; side++) {
        const a = i * 3 + side; indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals();
    g.rotateY(angle); parts.push(g);
  }
  return merge(parts);
}

export function scallopShell() {
  const p: number[] = [], uv: number[] = [], index: number[] = [];
  const rings = 10, sectors = 24;
  for (let ring = 0; ring <= rings; ring++) for (let j = 0; j <= sectors; j++) {
    const r = ring / rings, a = -1.15 + j / sectors * 2.3;
    const ridge = 1 + .035 * Math.cos(j * Math.PI);
    p.push(Math.sin(a) * r * .16 * ridge, .013 + Math.sin(r * Math.PI) * .043 + Math.cos(j * Math.PI) * .003 * r, Math.cos(a) * r * .19 * ridge);
    uv.push(j / sectors, r);
    if (ring < rings && j < sectors) { const k = ring * (sectors + 1) + j; index.push(k, k + sectors + 1, k + 1, k + 1, k + sectors + 1, k + sectors + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(index); g.computeVertexNormals();
  g.computeBoundingBox(); g.translate(0, -g.boundingBox!.min.y, 0);
  return g;
}

export function seaStar() {
  const shape = new THREE.Shape();
  for (let j = 0; j < 10; j++) {
    const a = j * Math.PI / 5, r = j % 2 === 0 ? .23 : .072;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (j === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .023, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .018, bevelThickness: .014, curveSegments: 6 });
  geometry.rotateX(-Math.PI / 2); geometry.computeBoundingBox(); geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  // ExtrudeGeometry emits material groups. One material keeps this one draw call.
  geometry.clearGroups();
  return geometry;
}

export function anemone() {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.SphereGeometry(.11, 12, 6); base.scale(1, .4, 1); base.translate(0, .044, 0); parts.push(base);
  for (let i = 0; i < 24; i++) {
    const a = i * 2.39996, r = Math.sqrt((i + 1) / 24) * .11;
    const start = new THREE.Vector3(Math.cos(a) * r, .03, Math.sin(a) * r);
    const end = start.clone().multiplyScalar(1.45); end.y = .12 + Math.sin(i * 3) * .015;
    const mid = start.clone().lerp(end, .5); mid.y += .09;
    parts.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 4, .008, 4, false));
  }
  return merge(parts);
}
