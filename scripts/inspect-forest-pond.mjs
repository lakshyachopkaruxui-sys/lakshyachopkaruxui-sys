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
        (movementBaseline ? 'forest-movement-performance-2026-10-17' : 'forest-performance-2026-10-17') + '/before-' + name, import.meta.url);
      return { format: 'module', source: stripTypeScriptTypes(readFileSync((originalRevision || movementBaseline) && existsSync(saved) ? saved : new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
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
const terrain = world.terrain.geometry;
const levels = [-.045, 0, .025, .055, .065, .075];
const contours = levels.map(level => {
  const shore = Array.from({ length: 192 }, (_, i) => {
    const a = i / 192 * Math.PI * 2;
    let r = .2;
    while (r < 2.5 && world.groundHeight(5+Math.cos(a)*2.4*r,-9+Math.sin(a)*4.2*r) < level) r += .002;
    const x=5+Math.cos(a)*2.4*r,z=-9+Math.sin(a)*4.2*r;
    return { x,z,r,collisionRadius:Math.hypot((x-5)/2.7,(z+9)/4.5) };
  });
  return { level, maxRadius:Math.max(...shore.map(v=>v.r)),maxCollisionRadius:Math.max(...shore.map(v=>v.collisionRadius)),shore };
});
const { forestPondShore } = await import('../src/worlds/ForestPond.ts');
const shore = forestPondShore((x,z)=>world.groundHeight(x,z));
const instances=[];
world.root.traverse(mesh=>{if(mesh.isInstancedMesh)instances.push({name:mesh.name,count:mesh.count,matrixHash:hash(Buffer.from(mesh.instanceMatrix.array.buffer)),colorHash:mesh.instanceColor?hash(Buffer.from(mesh.instanceColor.array.buffer)):null});});
const pool=world.root.getObjectByName('Shallow glade pool');
const report={shore,scope:'Actual terrain and assets. CPU geometry check, not rendered appearance or headset performance.',terrainHash:hash(Buffer.from(terrain.attributes.position.array.buffer)),plantingLayoutHash:hash(JSON.stringify([...world.understory.cells.entries()],(key,value)=>key==='cosine'||key==='sine'?undefined:value)), planted:world.understory.stats.planted, instances,contours,pool:pool?{vertices:pool.geometry.attributes.position.count,triangles:(pool.geometry.index?.count??pool.geometry.attributes.position.count)/3,material:pool.material.type}:null};
const out=new URL('../validation/forest-pond-2026-10-17/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL((process.argv[2]||'current')+'.json',out),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,instances:undefined,contours:contours.map(({shore,...rest})=>rest)},null,2));
