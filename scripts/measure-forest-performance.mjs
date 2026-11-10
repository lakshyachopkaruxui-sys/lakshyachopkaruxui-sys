// Host-side CPU and geometry audit. This does not render WebGL or measure XR FPS.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
const sourceRoot = new URL('../src/', import.meta.url).href;
const originalRevision = process.argv.includes('--baseline');
const movementBaseline = process.argv.includes('--movement-baseline');
const trimBaseline = process.argv.includes('--trim-baseline');
const pondBaseline = process.argv.includes('--pond-baseline');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
      const name = url.split('/').at(-1), saved = new URL('../validation/' +
        (trimBaseline ? 'forest-trim-2026-10-18' : pondBaseline ? 'forest-pond-2026-10-17' : movementBaseline ? 'forest-movement-performance-2026-10-17' : 'forest-performance-2026-10-17') + '/before-' + name, import.meta.url);
      return { format: 'module', source: stripTypeScriptTypes(readFileSync((originalRevision || movementBaseline || pondBaseline || trimBaseline) && existsSync(saved) ? saved : new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    }
    return next(url, context);
  }
});
globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } };
globalThis.document = { createElement() {
  const gradient = { addColorStop() {} };
  const context = new Proxy({ createRadialGradient: () => gradient, createLinearGradient: () => gradient,
    measureText: text => ({ width: String(text).length * 8 }) }, { get: (target, key) => key in target ? target[key] : () => {} });
  return { width: 1, height: 1, getContext: () => context };
} };
THREE.TextureLoader.prototype.load = function (url, onLoad) {
  const texture = new THREE.Texture(); texture.userData.path = url;
  queueMicrotask(() => onLoad?.(texture)); return texture;
};
HDRLoader.prototype.loadAsync = async () => new THREE.DataTexture();
GLTFLoader.prototype.loadAsync = async function (url) {
  const file = new URL('../public' + url, import.meta.url), raw = readFileSync(file);
  let data, binary;
  if (url.endsWith('.glb')) {
    const length = raw.readUInt32LE(12); data = JSON.parse(raw.subarray(20, 20 + length)); binary = raw.subarray(28 + length);
  } else data = JSON.parse(raw);
  for (const buffer of data.buffers ?? []) buffer.uri = 'data:application/octet-stream;base64,' +
    (buffer.uri ? readFileSync(new URL(buffer.uri, file)) : binary).toString('base64');
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'NODE_AUDIT_TEXTURES', loadTexture() {
    const texture = new THREE.Texture(); texture.flipY = false; return Promise.resolve(texture);
  } }));
  return loader.parseAsync(JSON.stringify(data), '');
};
const { WorldTwo } = await import('../src/worlds/WorldTwo.ts');
const world = new WorldTwo(new THREE.Vector3()); await world.ready;
if (world.understory.status !== 'ready') throw new Error('Forest assets did not load');
const hash = value => createHash('sha256').update(value).digest('hex');
const instances = [];
world.root.traverse(mesh => { if (mesh.isInstancedMesh) instances.push({ name: mesh.name, count: mesh.count,
  matrixHash: hash(Buffer.from(mesh.instanceMatrix.array.buffer)),
  colorHash: mesh.instanceColor ? hash(Buffer.from(mesh.instanceColor.array.buffer)) : null }); });
const plantingHash = hash(JSON.stringify([...world.understory.cells.entries()]));
const plantingLayoutHash = hash(JSON.stringify([...world.understory.cells.entries()], (key,value) => key === 'cosine' || key === 'sine' ? undefined : value));
const camera = new THREE.PerspectiveCamera(70, 1.5, .1, 160);
const viewer = new THREE.Vector3(), target = new THREE.Vector3(), frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
const samples = [];
for (const xr of [false, true]) {
  world.understory.setXRMode(xr); camera.fov = xr ? 95 : 70; camera.aspect = xr ? 1 : 1.5; camera.updateProjectionMatrix();
  for (let i = 0; i < 40; i++) {
    const a = i * Math.PI / 10, radius = i < 20 ? 0 : 14;
    viewer.set(Math.sin(a) * radius, 1.65, Math.cos(a) * radius - 4);
    viewer.y += world.groundHeight(viewer.x, viewer.z);
    world.updateView(viewer, true, 1 / 60); world.root.updateMatrixWorld(true);
    camera.position.copy(viewer); target.copy(viewer).add(new THREE.Vector3(Math.sin(a), -.08, -Math.cos(a)));
    camera.lookAt(target); camera.updateMatrixWorld(true);
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const groups = {}, shadow = { triangles: 0, batches: 0 };
    world.root.traverseVisible(mesh => {
      if (!mesh.isMesh) return;
      const triangles = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * (mesh.count ?? 1);
      if (mesh.castShadow) { shadow.triangles += triangles; shadow.batches++; }
      if (mesh.frustumCulled && !mesh.intersectsFrustum(frustum)) return;
      const group = mesh.name.startsWith('Forest permanent') ? 'permanentGrass' : mesh.name.startsWith('Forest cover detail') ? 'accentGrass'
        : mesh.name.startsWith('Scanned-material fir') ? 'trees' : mesh.name.startsWith('Scanned fern') ? 'ferns' : 'other';
      groups[group] ??= { triangles: 0, batches: 0 };
      groups[group].triangles += triangles; groups[group].batches++;
    });
    samples.push({ xr, view: i, groups, shadowCastersBeforeShadowFrustum: shadow,
      totalTriangles: Object.values(groups).reduce((n, g) => n + g.triangles, 0),
      totalBatches: Object.values(groups).reduce((n, g) => n + g.batches, 0) });
  }
}
world.understory.setXRMode(false);
const allCoverMeshes = [...world.understory.base.map(batch => batch.mesh),
  ...(world.understory.patches ? world.understory.patches.map(patch => patch.batch.mesh)
    : [...world.understory.detail, ...world.understory.props].map(batch => batch.mesh))];
const versions = new Map(allCoverMeshes.map(mesh => [mesh,mesh.instanceMatrix.version]));
let requestedMatrixUploadBytes = 0, requestedMatrixUploads = 0;
const cpu = { view: [], animation: [], matrices: [], total: [] };
for (let frame = 0; frame < 1500; frame++) {
  const z = -14 + Math.sin(frame / 400) * 10;
  viewer.set(2, world.groundHeight(2, z) + 1.65, z);
  const a = performance.now(); world.updateView(viewer, true, 1 / 60);
  const b = performance.now(); world.update(frame / 60, 0);
  const c = performance.now(); world.scene.updateMatrixWorld();
  const d = performance.now();
  for (const mesh of allCoverMeshes) if (mesh.instanceMatrix.version !== versions.get(mesh)) {
    requestedMatrixUploads++; requestedMatrixUploadBytes += mesh.count * 16 * 4;
    versions.set(mesh,mesh.instanceMatrix.version);
  }
  if (frame > 150) { cpu.view.push(b-a); cpu.animation.push(c-b); cpu.matrices.push(d-c); cpu.total.push(d-a); }
}
const times = Object.fromEntries(Object.entries(cpu).map(([name, values]) => {
  values.sort((a, b) => a-b); return [name, { medianMs: values[Math.floor(values.length*.5)], p95Ms: values[Math.floor(values.length*.95)], maxMs: values.at(-1) }];
}));
const summary = Object.fromEntries([false,true].map(xr => {
  const views = samples.filter(s => s.xr === xr), peak = views.reduce((a,b) => a.totalTriangles>b.totalTriangles?a:b);
  return [xr ? 'xrGeometry' : 'desktopGeometry', { peakTriangles: peak.totalTriangles, peakBatches: Math.max(...views.map(s=>s.totalBatches)), peakView: peak }];
}));
const output = { scope: 'Actual local meshes, simulated movement, host CPU timings. No browser GPU or headset frame-time measurement.',
  planted: world.understory.stats.planted, accentPositions: world.understory.stats.detailClumps,
  plantingHash, plantingLayoutHash, instances, requestedMatrixUploads, requestedMatrixUploadBytes,
  ...summary, cpu: times, samples };
const label = process.argv[2] || 'current';
const folder = new URL('../validation/forest-performance-2026-10-17/', import.meta.url); mkdirSync(folder, { recursive: true });
writeFileSync(new URL(label + '.json', folder), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ ...output, samples: undefined, instances: undefined }, null, 2));
