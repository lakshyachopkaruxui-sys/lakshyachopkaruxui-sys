// Actual local forest assets; geometry and shader-source checks, not GPU/FPS validation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
const sourceRoot = new URL('../src/', import.meta.url).href;
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
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
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

const { FOREST_POND_LEVEL, forestPondBankLift, forestPondShore } = await import('../src/worlds/ForestPond.ts');
const water = world.root.getObjectByName('Shallow glade pool');
const p = water.geometry.attributes.position, depth = water.geometry.attributes.pondDepth;
const ignoreExceptPond = new Set([...world.collisions.obstacles.keys()].filter(id => id !== 'forest-pond'));

test('raised pond is seated against the real floor with no arbitrary cut edge', () => {
  assert.ok(Math.abs(FOREST_POND_LEVEL - (-.045) - .11) < 1e-10);
  const edges = new Map();
  const key = i => [p.getX(i), p.getZ(i)].map(v => v.toFixed(5)).join(',');
  for (let i = 0; i < p.count; i++) {
    assert.ok(Math.abs(p.getY(i) - FOREST_POND_LEVEL) < 1e-7);
    const measured = FOREST_POND_LEVEL - world.terrain.heightAt(p.getX(i), p.getZ(i));
    assert.ok(Math.abs(measured - depth.getX(i)) < 2e-6, 'depth must follow the rendered floor triangles');
    assert.ok(water.geometry.attributes.normal.getY(i) > .999);
  }
  for (let i = 0; i < p.count; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = i+j, b = i+(j+1)%3, edge = [key(a), key(b)].sort().join('|');
      const value = edges.get(edge) ?? { count: 0, a, b };
      value.count++; edges.set(edge,value);
    }
  }
  const shoreEdges = [...edges.values()].filter(edge => edge.count === 1);
  assert.ok(shoreEdges.length > 30);
  for (const edge of shoreEdges) {
    assert.ok(depth.getX(edge.a) < 2e-6 && depth.getX(edge.b) < 2e-6,
      `edge ${key(edge.a)} to ${key(edge.b)}: depths ${depth.getX(edge.a)}, ${depth.getX(edge.b)}`);
  }
  const shore = forestPondShore((x,z)=>world.groundHeight(x,z));
  assert.ok(Math.max(...shore.map(p=>p.z)) < -5, 'water stays clear of the original review patch');
  for (const at of shore) {
    assert.ok(Math.abs(world.groundHeight(at.x,at.z)-FOREST_POND_LEVEL) < 1e-6);
    assert.ok(world.collisions.queryLocal(at.x,at.z,.01,1.7,0,ignoreExceptPond),
      'raised shore must stay inside the pond collider, without depending on nearby rocks or trees');
  }
});

test('pond keeps a single small surface pass, shared animation time and portal masking', () => {
  const m = water.material;
  assert.ok(p.count / 3 < 500);
  assert.equal(m.transmission, 0, 'no full-scene refraction pass');
  assert.equal(m.clearcoat, 0, 'no duplicate reflection lobe');
  assert.equal(m.side, THREE.FrontSide);
  assert.equal(m.forceSinglePass, true);
  assert.equal(water.castShadow, false);
  assert.equal(m.transparent, true);
  assert.equal(m.depthWrite, false);
  assert.equal(m.normalMap.image.width, 128);
  assert.equal(m.normalMap.generateMipmaps, true, 'small ripples must filter at a distance');
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  m.onBeforeCompile(shader, {});
  assert.ok(shader.vertexShader.includes('vPondDepth = pondDepth;'));
  assert.ok(shader.fragmentShader.includes('vec3 rippleA ='));
  assert.ok(shader.fragmentShader.includes('vec3 rippleB ='));
  assert.ok(shader.fragmentShader.includes('smoothstep(0.0,.035,vPondDepth)'));
  world.update(3.25,0); assert.equal(shader.uniforms.pondTime.value,3.25);
  world.stencilLayer = 2; world.refreshStencil();
  assert.equal(m.stencilRef,2); assert.equal(m.stencilWrite,true);
  world.stencilLayer = 1; world.refreshStencil();
});

test('higher bank stays local and retains existing forest floor material hooks', () => {
  assert.equal(forestPondBankLift(5,-9),0);
  for (const [x,z] of [[0,0],[0,-4],[5,-4.5],[14,-9],[-12,4],[5,-17]])
    assert.equal(forestPondBankLift(x,z),0);
  const floor = world.root.getObjectByName('Continuous forest floor').material;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  floor.onBeforeCompile(shader,{});
  for (const name of ['forestCanopy','forestLitterColor','forestLitterNormal','forestLitterARM'])
    assert.ok(shader.uniforms[name]?.value.isTexture, name);
  assert.ok(shader.fragmentShader.includes('float pondWet ='));
  assert.ok(shader.fragmentShader.includes('float sampleWeight ='));
  assert.ok(shader.fragmentShader.indexOf('float pondWet =') < shader.fragmentShader.indexOf('roughnessFactor = mix(roughnessFactor,.61,pondWet)'));
});

test('balanced pond banks keep planted roots seated above water', t => {
  const insideWater = (x,z) => {
    for (let i=0;i<p.count;i+=3) {
      const cross=[];
      for (let j=0;j<3;j++) {
        const a=i+j,b=i+(j+1)%3;
        cross.push((p.getX(b)-p.getX(a))*(z-p.getZ(a))-(p.getZ(b)-p.getZ(a))*(x-p.getX(a)));
      }
      if (cross.every(v=>v>1e-8)||cross.every(v=>v< -1e-8)) return true;
    }
    return false;
  };
  let bankRoots = 0;
  for (const cell of world.understory.cells.values()) for (const root of cell.base) {
    if (root.x <= 0 || root.x >= 10 || root.z <= -17 || root.z >= -4) continue;
    bankRoots++;
    const height = world.groundHeight(root.x,root.z);
    assert.ok(Math.abs(root.y+.009-height)<1e-6, 'every bank root follows the actual terrain triangles');
    assert.equal(insideWater(root.x,root.z),false,
      `grass root at ${root.x},${root.z} must not emerge from beneath the actual pond surface`);
  }
  assert.ok(bankRoots>100, 'the pond retains a planted natural bank');
  t.diagnostic(`${bankRoots} bank roots seated against the current terrain. Density is tested against the balanced coverage budget.`);
});

test('pond collision contains the complete water surface and stops approaches from every side', () => {
  for (let i=0;i<p.count;i+=3) {
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3;
    const z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    assert.ok(world.collisions.queryLocal(x,z,.01,1.7,0,ignoreExceptPond),
      'every water triangle must remain inside pond-only collision protection');
  }
  const shore=forestPondShore((x,z)=>world.groundHeight(x,z));
  for (let i=0;i<shore.length;i+=Math.max(1,Math.floor(shore.length/12))) {
    const at=shore[i], outward=new THREE.Vector3(at.x-5,0,at.z+9).normalize();
    const start=new THREE.Vector3(at.x+outward.x,0,at.z+outward.z);
    start.y=world.groundHeight(start.x,start.z);
    const destination=new THREE.Vector3(5,start.y,-9);
    const result=world.collisions.moveLocal(start,destination,{radius:.2,height:1.7,ignoreIds:ignoreExceptPond});
    assert.ok(world.groundHeight(result.x,result.z)>=FOREST_POND_LEVEL-.001,
      'walking toward the pond must stop on dry ground');
  }
});

