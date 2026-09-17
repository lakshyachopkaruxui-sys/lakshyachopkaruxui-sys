// Isolated verification of the stencil portal pipeline used by the real
// experience (see src/portal/PortalRenderer.ts). Checks, by reading pixels:
//  1. inside the mask, the inner world replaces the outer world's background
//     (depth reset works — the red wall behind the tear is removed);
//  2. an outer-world object in FRONT of the tear still occludes the portal;
//  3. fragments discarded by the mask shader do not write stencil;
//  4. outside the mask nothing of the inner world leaks.
import * as THREE from 'three';

const W = 640;
const H = 480;

const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.autoClear = false;
renderer.setClearColor(0x000000, 1);
document.getElementById('stage')!.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, W / H, 0.05, 100);
camera.position.set(0, 1.5, 2);
camera.lookAt(0, 1.5, 0);

function stencilLayer<T extends THREE.Material>(m: T, ref: number): T {
  m.stencilWrite = true;
  m.stencilFunc = THREE.EqualStencilFunc;
  m.stencilRef = ref;
  m.stencilFail = THREE.KeepStencilOp;
  m.stencilZFail = THREE.KeepStencilOp;
  m.stencilZPass = THREE.KeepStencilOp;
  return m;
}

// Outer world: red wall behind the tear plane, green occluder in front of it.
const outer = new THREE.Scene();
const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), stencilLayer(new THREE.MeshBasicMaterial({ color: 0xff0000 }), 0));
wall.position.set(0, 1.5, -1);
const occluder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), stencilLayer(new THREE.MeshBasicMaterial({ color: 0x00ff00 }), 0));
occluder.position.set(-0.2, 1.62, 0.6);
outer.add(wall, occluder);

// Mask: a circle on the tear plane whose right half is discarded in the shader.
const maskVert = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const maskGeo = new THREE.CircleGeometry(0.4, 64);
const maskMat = new THREE.ShaderMaterial({
  vertexShader: maskVert,
  fragmentShader: /* glsl */ `
    varying vec2 vLocal;
    void main() {
      if (vLocal.x > 0.0) discard;
      gl_FragColor = vec4(1.0);
    }`,
  colorWrite: false,
  depthWrite: false,
  depthTest: true
});
maskMat.stencilWrite = true;
maskMat.stencilFunc = THREE.EqualStencilFunc;
maskMat.stencilRef = 0;
maskMat.stencilZPass = THREE.IncrementStencilOp;
const resetMat = new THREE.ShaderMaterial({
  vertexShader: maskVert,
  fragmentShader: /* glsl */ `
    varying vec2 vLocal;
    void main() {
      if (vLocal.x > 0.0) discard;
      gl_FragColor = vec4(1.0);
      gl_FragDepth = 1.0;
    }`,
  colorWrite: false,
  depthWrite: true,
  depthTest: true,
  depthFunc: THREE.AlwaysDepth
});
stencilLayer(resetMat, 1);
const maskScene = new THREE.Scene();
const mask = new THREE.Mesh(maskGeo, maskMat);
const reset = new THREE.Mesh(maskGeo, resetMat);
mask.position.set(0, 1.5, 0);
reset.position.copy(mask.position);
reset.renderOrder = 1;
maskScene.add(mask, reset);

// Inner world: blue sphere far behind the red wall.
const inner = new THREE.Scene();
const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 16), stencilLayer(new THREE.MeshBasicMaterial({ color: 0x0000ff }), 1));
sphere.position.set(0, 1.5, -4);
inner.add(sphere);

renderer.clear(true, true, true);
renderer.render(outer, camera);
renderer.render(maskScene, camera);
renderer.render(inner, camera);

const gl = renderer.getContext();
function pixelAt(world: THREE.Vector3): string {
  const p = world.clone().project(camera);
  const x = Math.round((p.x * 0.5 + 0.5) * W);
  const y = Math.round((p.y * 0.5 + 0.5) * H);
  const buf = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  if (buf[0] > 200 && buf[1] < 50 && buf[2] < 50) return 'red';
  if (buf[1] > 200 && buf[0] < 50) return 'green';
  if (buf[2] > 200 && buf[0] < 50) return 'blue';
  return `rgb(${buf[0]},${buf[1]},${buf[2]})`;
}

const checks: [string, THREE.Vector3, string][] = [
  ['inside mask (left half) shows inner world', new THREE.Vector3(-0.15, 1.45, 0), 'blue'],
  ['discarded half of mask keeps outer world', new THREE.Vector3(0.15, 1.45, 0), 'red'],
  ['outside mask keeps outer world', new THREE.Vector3(-0.6, 1.5, 0), 'red'],
  ['outer object in front of tear occludes portal', occluder.position.clone(), 'green']
];

const lines = checks.map(([name, pos, want]) => {
  const got = pixelAt(pos);
  return `${got === want ? 'PASS' : 'FAIL'}  ${name}  (want ${want}, got ${got})`;
});
const allPass = lines.every((l) => l.startsWith('PASS'));
lines.push('', allPass ? 'ALL PASS' : 'SOME CHECKS FAILED');
document.getElementById('out')!.textContent = lines.join('\n');
(window as unknown as { __stencilResult: unknown }).__stencilResult = { allPass, lines };
