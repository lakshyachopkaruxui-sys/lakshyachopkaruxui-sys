import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type ReefFishKind = 'silver' | 'tang' | 'banner';

/** Original smooth reef fish, authored in metres with the nose along +Z.
 * Body, eyes and fins share one vertex-coloured geometry, so a whole shoal
 * needs one draw call. These are original geometry, not downloaded models.
 */
export function reefFishGeometry(kind: ReefFishKind) {
  const parts: THREE.BufferGeometry[] = [];
  const tall = kind === 'tang' ? 0.255 : kind === 'banner' ? 0.23 : 0.135;
  const wide = kind === 'silver' ? 0.10 : 0.085;
  const colours = kind === 'silver' ? [0x56aab8, 0xc3ece1] : kind === 'tang' ? [0x197eaa, 0x68d1d1] : [0xf3d48a, 0xffefba];
  const upper = new THREE.Color(colours[0]), lower = new THREE.Color(colours[1]);
  const body = new THREE.SphereGeometry(1, 18, 12);
  body.scale(wide, tall, 0.365);
  body.translate(0, 0, 0.065);
  paint(body, (x, y, z) => {
    const shade = lower.clone().lerp(upper, THREE.MathUtils.smoothstep(y, -tall, tall));
    if (kind === 'banner' && ((z > -0.15 && z < -0.025) || (z > 0.16 && z < 0.245))) shade.multiplyScalar(0.16);
    if (kind === 'tang' && z < -0.12) shade.lerp(new THREE.Color(0xf9d370), 0.5);
    return shade;
  });
  parts.push(body);
  // Pointed dorsal and anal fins, with a taller trailing ribbon on bannerfish.
  const dorsal = kind === 'banner' ? [[0, 0.19, 0.17], [0, 0.50, 0.05], [0, 0.42, -0.26], [0, 0.16, -0.28]] :
    [[0, tall * 0.82, 0.22], [0, tall * 1.48, 0.02], [0, tall * 1.1, -0.21], [0, tall * 0.50, -0.29]];
  const finColour = kind === 'tang' ? 0xf3d36a : kind === 'banner' ? 0xeccb7d : 0x76b9be;
  parts.push(fin(dorsal, finColour));
  parts.push(fin([[0, -tall * 0.6, 0.08], [0, -tall * 1.2, -0.12], [0, -tall * 0.45, -0.30]], finColour));
  // Forked tail; slightly curved in X instead of a completely flat triangle.
  parts.push(fin([[0, 0.035, -0.27], [0.012, 0.175, -0.58], [0, 0.012, -0.49], [-0.009, -0.16, -0.58], [0, -0.035, -0.27]], finColour));
  for (const sign of [-1, 1]) {
    parts.push(fin([[sign * wide * 0.8, 0.015, 0.19], [sign * 0.23, -0.095, 0.03], [sign * wide * 0.65, -0.07, -0.04]], finColour));
    const iris = new THREE.SphereGeometry(0.024, 8, 6);
    iris.scale(0.48, 1, 1);
    iris.translate(sign * wide * 0.67, tall * 0.30, 0.306);
    paint(iris, () => new THREE.Color(0xebdfad)); parts.push(iris);
    const pupil = new THREE.SphereGeometry(0.0155, 8, 6);
    pupil.scale(0.32, 1, 1);
    pupil.translate(sign * (wide * 0.67 + 0.008), tall * 0.30, 0.312);
    paint(pupil, () => new THREE.Color(0x101e25)); parts.push(pupil);
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  merged.computeBoundingSphere();
  return merged;
}

function paint(geometry: THREE.BufferGeometry, colour: (x: number, y: number, z: number) => THREE.Color) {
  const p = geometry.getAttribute('position'), values: number[] = [];
  for (let i = 0; i < p.count; i++) values.push(...colour(p.getX(i), p.getY(i), p.getZ(i)).toArray());
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(values, 3));
}

function fin(points: number[][], colour: number) {
  const g = new THREE.BufferGeometry();
  const indices: number[] = [];
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(points.flatMap((_, i) => [i / (points.length - 1), i % 2]), 2));
  g.setIndex(indices); g.computeVertexNormals();
  paint(g, (_, y, z) => new THREE.Color(colour).multiplyScalar(0.87 + 0.13 * Math.cos(y * 15 + z * 8)));
  return g;
}

/** Original articulated ray fallback. Its broad, curved wings have multiple
 * surface rows and smoothly blended normals; the body never bobs the camera. */
export function fallbackRay() {
  const model = new THREE.Group(); model.name = 'original-manta-ray';
  const skin = new THREE.MeshStandardMaterial({ color: 0x305d70, roughness: 0.43, metalness: 0.04, side: THREE.DoubleSide });
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), skin);
  belly.scale.set(0.45, 0.16, 0.60); model.add(belly);
  for (const sign of [-1, 1]) {
    const wing = new THREE.Group(); wing.name = sign < 0 ? 'marine-left-fin' : 'marine-right-fin';
    const rows = 14, cols = 8, p: number[] = [], uv: number[] = [], index: number[] = [];
    for (let row = 0; row <= rows; row++) {
      const t = row / rows, breadth = 0.54 * Math.pow(1 - t, 0.65) + 0.015;
      for (let col = 0; col <= cols; col++) {
        const u = col / cols * 2 - 1;
        p.push(sign * (0.25 + t * 1.45), Math.sin(t * Math.PI) * 0.08 - u * u * 0.04, u * breadth - t * t * 0.52);
        uv.push(t, col / cols);
      }
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + cols + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index); geometry.computeVertexNormals();
    wing.add(new THREE.Mesh(geometry, skin)); model.add(wing);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), new THREE.MeshStandardMaterial({ color: 0x091e25, roughness: 0.18 }));
    eye.position.set(sign * 0.34, 0.10, 0.37); model.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.047, 1.18, 8), skin);
  tail.rotation.x = -Math.PI / 2; tail.position.z = -1.05; model.add(tail);
  return model;
}

/** The offline fallback preserves a readable whale/shark silhouette when an
 * asset fails, rather than replacing the animal with a cube or a light orb. */
export function fallbackLargeFish(kind: 'whale' | 'shark' | 'turtle') {
  if (kind === 'turtle') return seaTurtle();
  const model = new THREE.Group(); model.name = `original-${kind}`;
  const material = new THREE.MeshStandardMaterial({ color: kind === 'whale' ? 0x547787 : 0x608897, roughness: 0.43, metalness: 0.025, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), material);
  body.scale.set(0.29, 0.30, 0.9); model.add(body);
  const tail = new THREE.Group(); tail.name = 'marine-tail'; tail.position.z = -0.62;
  {
    const caudal = fin([[0, 0, 0.05], [0, 0.46, -0.65], [0, 0.015, -0.42], [0, -0.37, -0.65]], 0x5c8592);
    const mesh = new THREE.Mesh(caudal, material);
    if (kind === 'whale') mesh.rotation.z = Math.PI / 2;
    tail.add(mesh); model.add(tail);
    const dorsal = new THREE.Mesh(fin([[0, 0.24, 0.16], [0, 0.64, -0.04], [0, 0.24, -0.32]], 0x5c8592), material);
    model.add(dorsal);
  }
  for (const sign of [-1, 1]) {
    const flipper = new THREE.Group(); flipper.name = sign < 0 ? 'marine-left-fin' : 'marine-right-fin';
    flipper.add(new THREE.Mesh(fin([[sign * 0.19, -0.03, 0.43], [sign * (kind === 'whale' ? 0.93 : 0.66), -0.19, -0.08], [sign * 0.27, -0.05, -0.20]], 0x5c8592), material));
    model.add(flipper);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshStandardMaterial({ color: 0x061c24, roughness: 0.18 }));
    eye.position.set(sign * 0.19, 0.08, 0.67); model.add(eye);
  }
  return model;
}

/** Original sea turtle with a domed, scuted shell, pale plastron, a distinct
 * neck/head and four tapered flippers. Front flippers articulate as it swims. */
function seaTurtle() {
  const model = new THREE.Group(); model.name = 'original-sea-turtle';
  const shell = new THREE.SphereGeometry(1, 40, 24);
  paint(shell, (x, y, z) => {
    const angle = Math.atan2(z, x), radius = Math.hypot(x, z);
    const ring = Math.abs(radius - 0.62) < 0.034 || Math.abs(radius - 0.91) < 0.027;
    const scute = Math.abs(Math.sin(angle * 5)) < 0.08 && radius > 0.4;
    return new THREE.Color(ring || scute ? 0x243c30 : 0x587355).multiplyScalar(0.87 + 0.13 * Math.sin(x * 9 + z * 11));
  });
  shell.scale(0.50, 0.22, 0.62);
  const shellMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.56, metalness: 0.02 });
  model.add(new THREE.Mesh(shell, shellMaterial));
  const skin = new THREE.MeshStandardMaterial({ color: 0x879c70, roughness: 0.55, side: THREE.DoubleSide });
  const underside = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({ color: 0xcccea1, roughness: 0.62 }));
  underside.scale.set(0.455, 0.12, 0.57); underside.position.y = -0.095; model.add(underside);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), skin);
  head.scale.set(0.15, 0.135, 0.26); head.position.set(0, 0.006, 0.72); model.add(head);
  for (const sign of [-1, 1]) {
    const front = new THREE.Group(); front.name = sign < 0 ? 'marine-left-fin' : 'marine-right-fin';
    const flipper = new THREE.SphereGeometry(1, 20, 10);
    flipper.scale(0.13, 0.035, 0.43); flipper.rotateY(-sign * 1.04); flipper.translate(sign * 0.61, -0.04, 0.17);
    front.add(new THREE.Mesh(flipper, skin)); model.add(front);
    const rear = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), skin);
    rear.scale.set(0.15, 0.032, 0.21); rear.rotation.y = sign * 0.60; rear.position.set(sign * 0.39, -0.10, -0.52); model.add(rear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.029, 10, 8), new THREE.MeshStandardMaterial({ color: 0x092326, roughness: 0.15 }));
    eye.position.set(sign * 0.129, 0.05, 0.83); model.add(eye);
  }
  return model;
}
