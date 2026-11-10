import { assetUrl } from '../utils/assetUrl';
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Point = [number, number, number];
type Field = (x: number, y: number, z: number) => number;
const blend = (a: number, b: number, k = .11) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * .25;
};
function oval(x: number, y: number, z: number, p: Point, r: Point) {
  return (Math.hypot((x - p[0]) / r[0], (y - p[1]) / r[1], (z - p[2]) / r[2]) - 1) * Math.min(...r);
}
function limb(x: number, y: number, z: number, a: Point, b: Point, ra: number, rb: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const t = THREE.MathUtils.clamp(((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / (dx * dx + dy * dy + dz * dz), 0, 1);
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t, z - a[2] - dz * t) - THREE.MathUtils.lerp(ra, rb, t);
}

/** One implicit surface sampled at creation; never polygonized per frame. */
function sculpt(field: Field, min: Point, max: Point, resolution: number) {
  const placeholder = new THREE.MeshBasicMaterial();
  const volume = new MarchingCubes(resolution, placeholder, false, false, 42000);
  volume.isolation = 0;
  const span = max.map((v, i) => v - min[i]);
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    volume.field[x + y * resolution + z * resolution * resolution] = -field(min[0] + x / resolution * span[0], min[1] + y / resolution * span[1], min[2] + z / resolution * span[2]);
  }
  volume.update();
  const position = volume.geometry.getAttribute('position'), count = volume.count;
  const vertices = new Float32Array(count * 3), uv = new Float32Array(count * 2), normal = new Float32Array(count * 3);
  const h = .003, n = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const x = min[0] + (position.getX(i) + 1) * .5 * span[0];
    const y = min[1] + (position.getY(i) + 1) * .5 * span[1];
    const z = min[2] + (position.getZ(i) + 1) * .5 * span[2];
    vertices.set([x, y, z], i * 3); uv.set([x * 1.2 + z * .3, y * .8], i * 2);
    n.set(field(x + h, y, z) - field(x - h, y, z), field(x, y + h, z) - field(x, y - h, z), field(x, y, z + h) - field(x, y, z - h)).normalize();
    normal.set(n.toArray(), i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  volume.geometry.dispose(); placeholder.dispose();
  return geometry;
}

/** Tapered curved strand with sealed ends and continuous UVs. */
export function sinew(points: Point[], radius: number, segments = 28, sides = 7, tip = .015) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  const frames = curve.computeFrenetFrames(segments, false), length = curve.getLength();
  const vertices: number[] = [], uv: number[] = [], index: number[] = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments, p = curve.getPointAt(t), r = radius * (1 - t) ** .7 + tip * t;
    for (let col = 0; col <= sides; col++) {
      const a = col / sides * Math.PI * 2;
      const v = p.clone().addScaledVector(frames.normals[row], Math.cos(a) * r).addScaledVector(frames.binormals[row], Math.sin(a) * r);
      vertices.push(v.x, v.y, v.z); uv.push(col / sides, t * length * 1.3);
      if (row < segments && col < sides) {
        const k = row * (sides + 1) + col;
        index.push(k, k + sides + 1, k + 1, k + 1, k + sides + 1, k + sides + 2);
      }
    }
  }
  const first = vertices.length / 3; vertices.push(...points[0]); uv.push(.5, 0);
  const last = vertices.length / 3; vertices.push(...points[points.length - 1]); uv.push(.5, 1);
  for (let k = 0; k < sides; k++) {
    index.push(first, k + 1, k);
    const end = segments * (sides + 1); index.push(last, end + k, end + k + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}
function joined(parts: THREE.BufferGeometry[], material: THREE.Material, name: string) {
  const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
export function horrorSkin(deform = false) {
  const loader = new THREE.TextureLoader();
  const map = loader.load(assetUrl('/textures/refined/oak_color.jpg')), normalMap = loader.load(assetUrl('/textures/refined/oak_normal.jpg')), roughnessMap = loader.load(assetUrl('/textures/refined/oak_roughness.jpg'));
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap, roughnessMap]) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4; }
  const material = new THREE.MeshStandardMaterial({ color: 0xb0a59d, map, normalMap, roughnessMap, normalScale: new THREE.Vector2(.5, .5), roughness: .81, metalness: 0 });
  if (deform) {
    const time = { value: 0 }; material.userData.livingTime = time;
    material.onBeforeCompile = shader => {
      shader.uniforms.uLivingTime = time;
      shader.vertexShader = 'uniform float uLivingTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float living = smoothstep(.35,1.65,position.y);
        transformed.x += living * .018 * sin(position.y * 3.1 + uLivingTime * .31);
        transformed.z += living * .014 * sin(position.y * 4.3 - uLivingTime * .24);
      `);
    };
    material.customProgramCacheKey = () => 'original-living-root-v1';
  }
  return material;
}

/** Original fused anatomy. This is generated geometry, not an imported character scan. */
export function createHorrorCreature(material: THREE.MeshStandardMaterial, variant: number) {
  const model = new THREE.Group(); model.name = 'original rootbound shapeshifter';
  const asymmetry = variant ? -1 : 1;
  const ovals: [Point, Point][] = [
    [[.07, 1.83, -.12], [.30, .48, .235]], [[.04, 2.19, -.09], [.39, .39, .265]],
    [[.34, 2.40, -.09], [.30, .23, .245]], [[-.30, 2.33, -.055], [.22, .20, .21]], [[.13, 2.57, -.02], [.145, .32, .155]],
    [[-.27, .085, .18], [.16, .12, .33]], [[.39, .065, .12], [.18, .10, .37]],
    [[-.75, .93, .115], [.13, .18, .12]], [[.79, .59, .10], [.14, .21, .13]]
  ];
  const limbs: [Point, Point, number, number][] = [
    [[-.16, 1.4, -.02], [-.36, .78, -.14], .16, .105], [[-.36, .78, -.14], [-.27, .13, .13], .105, .085],
    [[.17, 1.4, -.02], [.40, .74, .06], .18, .115], [[.40, .74, .06], [.39, .11, .13], .115, .08],
    [[-.30, 2.33, -.055], [-.61, 1.76, -.15], .155, .105], [[-.61, 1.76, -.15], [-.75, .95, .115], .11, .078],
    [[.36, 2.39, -.08], [.82, 1.55, -.22], .18, .10], [[.82, 1.55, -.22], [.79, .60, .10], .115, .09]
  ];
  const bodyField: Field = (x0, y, z) => {
    const x = x0 * asymmetry;
    let d = oval(x, y, z, [.02, 1.37, -.06], [.245, .30, .20]);
    for (const [p, r] of ovals) d = blend(d, oval(x, y, z, p, r));
    for (const [a, b, ra, rb] of limbs) d = blend(d, limb(x, y, z, a, b, ra, rb));
    d += Math.sin(x * 14 + y * 4) * Math.sin(y * 20 + z * 12) * .007;
    return Math.max(d, -.025 - y);
  };
  const body = new THREE.Mesh(sculpt(bodyField, [-1.16, -.15, -.65], [1.16, 2.98, .68], 66), material);
  body.name = 'continuous sculpted body'; body.castShadow = true; body.receiveShadow = true; model.add(body);
  const strands: THREE.BufferGeometry[] = [];
  const mirror = (p: Point[]): Point[] => p.map(([x, y, z]) => [x * asymmetry, y, z]);
  for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 5; i++) {
    const y = 1.83 + i * .115;
    strands.push(sinew(mirror([[.06, y + .13, .135], [side * .18, y + .07, .175], [side * .29, y, .08], [side * .23, y - .09, -.08]]), .027, 14, 6, .013));
  }
  for (const side of [-1, 1]) for (let finger = 0; finger < 4; finger++) {
    const x = side === -1 ? -.75 : .79, y = side === -1 ? .90 : .56, spread = (finger - 1.5) * .07;
    strands.push(sinew(mirror([[x + spread, y, .115], [x + spread * 1.5, y - .18 - finger * .023, .16], [x + spread * 1.8, y - .42 - finger * .025, .29], [x + spread * 1.6, y - .48 - finger * .027, .37]]), .038, 18, 7, .006));
  }
  for (let i = 0; i < 7; i++) {
    const x = -.28 + i * .085;
    strands.push(sinew(mirror([[x, 2.24, -.19], [x * 1.1, 2.50 + Math.sin(i * 2) * .12, -.29], [x * 1.2, 2.73 + i * .026, -.33], [x * 1.15 + .12, 2.90 + i * .025, -.27]]), .048, 20, 7, .008));
  }
  for (const [x, z] of [[-.27, .18], [.39, .12]]) for (let toe = 0; toe < 3; toe++) {
    const spread = (toe - 1) * .11;
    strands.push(sinew(mirror([[x + spread * .5, .09, z], [x + spread, .025, z + .20], [x + spread * 1.4, -.012, z + .36]]), .06, 12, 7, .009));
  }
  model.add(joined(strands, material, 'attached sinew and root fingers'));
  const head = new THREE.Group(); head.name = 'articulated hollow face'; head.position.set(.13 * asymmetry, 2.73, .035);
  const headField: Field = (x, y, z) => {
    let d = oval(x, y, z, [0, .20, -.015], [.235, .34, .20]);
    d = blend(d, oval(x, y, z, [.07 * asymmetry, .40, -.065], [.25, .22, .20]), .10);
    d = blend(d, oval(x, y, z, [-.025 * asymmetry, -.02, .04], [.13, .24, .13]), .11);
    for (const side of [-1, 1]) {
      d = blend(d, oval(x, y, z, [side * .15, .10, .12], [.065, .19, .09]), .06);
      d = Math.max(d, -oval(x, y, z, [side * .102, .255 + side * .012, .18], [.077, .070, .085]));
    }
    d = Math.max(d, -oval(x, y, z, [.008, .005, .155], [.032, .137, .067]));
    return d + .0035 * Math.sin(y * 45 + x * 31) * Math.cos(z * 32);
  };
  const skull = new THREE.Mesh(sculpt(headField, [-.43, -.32, -.39], [.46, .78, .37], 46), material);
  skull.name = 'sculpted recessed face'; skull.castShadow = true; skull.receiveShadow = true; head.add(skull);
  const eyes: THREE.Mesh[] = [];
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x818677, emissive: 0x818671, emissiveIntensity: .18, roughness: .38 });
  const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0x0a0c0b });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), eyeMaterial);
    eye.name = 'recessed watching eye'; eye.scale.set(.030, .009, .015);
    eye.position.set(side * .102, .255 + side * .012, .145);
    eye.rotation.z = side * -.18; head.add(eye); eyes.push(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), pupilMaterial);
    pupil.name = 'vertical eye pupil'; pupil.position.copy(eye.position).add(new THREE.Vector3(0, 0, .014)); pupil.scale.set(.004, .008, .002); head.add(pupil);
  }
  const headRoots: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.43, x = Math.cos(a) * .18;
    headRoots.push(sinew([[x, .45, -.11], [x * 1.7, .66 + .06 * i, -.12], [x * 2.0 + .10 * asymmetry, .88 + .03 * i, -.21], [x * 1.7 + .19 * asymmetry, .91 + .035 * i, -.29]], .050, 18, 7, .004));
  }
  head.add(joined(headRoots, material, 'fused cranial tendrils')); model.add(head);
  return { model, body, head, eyes };
}

/** Hanging strands grow from the high scanned arch, never from empty air. */
export function createHorrorCanopy(material: THREE.MeshStandardMaterial) {
  const root = new THREE.Group(); root.name = 'root-attached hanging canopy';
  const parts: THREE.BufferGeometry[] = [], anchors: Point[] = [];
  const strands = [[-3.18, 1.17, .13], [-2.63, 2.16, .055], [-1.77, 1.70, .11], [-1.49, 3.15, .04], [-.36, 1.30, .07], [.19, 2.80, .145], [1.47, 3.10, .045], [2.12, 1.18, .09], [3.20, 1.74, .06]];
  for (const [i, [x, length, radius]] of strands.entries()) {
    // The scan arches slope down toward x=+-3.3; matching that curve keeps
    // every strand embedded in wood instead of suspended above its shoulder.
    const y = 8.25 - .22 * x * x;
    const a: Point = [x, y, -8.3]; anchors.push(a);
    const endY = Math.max(3.75, y - length), curl = Math.sin(i * 2.7) * .58;
    parts.push(sinew([a, [x + curl * .3, y - .45, -8.0], [x + curl, endY + .33, -7.6 - Math.cos(i) * .25], [x + curl * 1.25 - .12, endY, -7.85 + Math.sin(i) * .25]], radius, 36, 8, .005));
    if (i === 2 || i === 5) parts.push(sinew([[x + curl * .3, y - .45, -8], [x - .22, y - .9, -7.85], [x - .48, y - 1.4, -7.60]], radius * .48, 20, 7, .003));
  }
  parts.push(sinew([[-3.5, 5.55, -8.3], [-1.9, 7.3, -8.0], [.2, 8.15, -8.15], [3.35, 5.75, -8.3]], .12, 52, 9, .10));
  root.add(joined(parts, material, 'continuous hanging root sinews'));
  root.userData.anchors = anchors;
  return root;
}
