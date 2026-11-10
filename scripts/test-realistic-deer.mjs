import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } };
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
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  }
});
const { ForestFauna } = await import('../src/worlds/ForestFauna.ts');
const { measureProp } = await import('../src/worlds/props.ts');
const bytes = readFileSync(new URL('../public/models/realistic-deer/doe.glb', import.meta.url));
const jsonSize = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
const bin = bytes.subarray(20 + jsonSize + 8);
async function sourceModel() {
  const data = structuredClone(json);
  data.buffers[0].uri = 'data:application/octet-stream;base64,' + bin.toString('base64');
  delete data.images; delete data.textures; delete data.samplers;
  data.materials = data.materials.map(m => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  return new GLTFLoader().parseAsync(JSON.stringify(data), '');
}
async function fixture(callback) {
  const model = await sourceModel(), original = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async url => { assert.equal(url, '/models/realistic-deer/doe.glb'); return model; };
  try { await callback(); } finally { GLTFLoader.prototype.loadAsync = original; }
}
function frames(fauna, seconds, viewer = new THREE.Vector3(0, 1.65, 0), active = true) {
  for (let i = 0; i < Math.round(seconds * 60); i++) { fauna.updateView(viewer, active, 1/60); fauna.update(1/60); }
}

test('textured doe retains creator provenance, matching hashes, real textures and baked source rig', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/models/realistic-deer/SOURCE-MANIFEST.json', import.meta.url), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.source_page, 'https://opengameart.org/content/deer-female');
  for (const record of [manifest.source, manifest.runtime]) {
    const data = readFileSync(new URL('../' + record.file, import.meta.url));
    assert.equal(data.length, record.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), record.sha256);
  }
  assert.equal(json.images.length, 2);
  assert.ok(json.images.every(image => image.mimeType === 'image/jpeg' && Number.isInteger(image.bufferView)));
  assert.equal(json.skins[0].joints.length, 31);
  assert.deepEqual(json.animations.map(clip => clip.name).sort(), ['Eat', 'Idle', 'LookAround', 'Run']);
  assert.equal(json.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n,p) => n + json.accessors[p.indices].count/3, 0), 0), 4784);
});

test('three textured source rigs are independently scaled, grounded and masked', async () => fixture(async () => {
  const fauna = new ForestFauna(new THREE.Group(), () => .2, () => 3); await fauna.ready;
  assert.equal(fauna.status, 'ready'); assert.equal(fauna.animals.length, 3);
  const heads = fauna.animals.map(a => a.root.getObjectByName('Head'));
  assert.equal(new Set(heads).size, 3);
  for (const [i, animal] of fauna.animals.entries()) {
    const bounds = measureProp(animal.root), size = bounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y - [1.38,1.22,1.33][i]) < 1e-5);
    assert.ok(Math.abs(bounds.min.y - .218) < 1e-5);
    assert.ok(animal.bodyHalfLength + animal.bodyRadius < animal.clearance,
      'the complete turning capsule must stay inside its swept clearance');
    animal.root.traverse(o => { if(o.isMesh) assert.equal(o.material.stencilRef, 3); });
  }
}));

test('herd walks, grazes and observes over repeated cycles instead of ending as statues', async () => fixture(async () => {
  const fauna = new ForestFauna(new THREE.Group(), () => 0, () => 1); await fauna.ready;
  const viewer = new THREE.Vector3(0,1.6,0), original = viewer.clone();
  const modes = fauna.animals.map(() => new Set());
  for (let frame=0;frame<60*75;frame++) {
    fauna.updateView(viewer,true,1/60); fauna.update(1/60);
    fauna.animals.forEach((animal,i) => modes[i].add(animal.mode));
  }
  fauna.animals.forEach((animal,i) => {
    assert.ok(animal.distanceTravelled > 18, 'each doe continuously explores over repeated cycles');
    assert.deepEqual([...modes[i]].sort(), ['graze','observe','walk']);
    assert.ok(Math.hypot(animal.root.position.x,animal.root.position.z) < 25);
  });
  assert.deepEqual(viewer,original);
}));

test('portal alignment does not change local animal paths and focus loss freezes without teleporting', async () => fixture(async () => {
  const parentA = new THREE.Group(), parentB = new THREE.Group();
  parentB.position.set(8,.3,-11); parentB.rotation.y=1.2; parentB.updateMatrixWorld(true);
  const a=new ForestFauna(parentA,()=>0,()=>1),b=new ForestFauna(parentB,()=>0,()=>2); await Promise.all([a.ready,b.ready]);
  const local=new THREE.Vector3(0,1.6,0),world=parentB.localToWorld(local.clone());
  frames(a,7,local);frames(b,7,world);
  for(let i=0;i<3;i++) {
    assert.ok(a.animals[i].root.position.distanceTo(b.animals[i].root.position)<1e-6);
    assert.ok(a.animals[i].root.quaternion.angleTo(b.animals[i].root.quaternion)<1e-6);
  }
  const before=a.animals.map(animal=>animal.root.position.clone());
  frames(a,8,local,false);
  a.animals.forEach((animal,i)=>assert.deepEqual(animal.root.position,before[i]));
  frames(a,3,local,true);
  assert.ok(a.animals.some((animal,i)=>animal.root.position.distanceTo(before[i])>.3));
  a.updateView(new THREE.Vector3(NaN,0,0),true,1); a.update(Infinity);
  assert.equal(a.active,false);
}));

test('walking gait stays grounded through moving and resting phases', async () => fixture(async () => {
  const terrain=(x,z)=>.006*x+.004*z;
  const fauna=new ForestFauna(new THREE.Group(),terrain,()=>1);await fauna.ready;
  let minimum=Infinity,maximum=-Infinity,restMaximum=-Infinity;
  for(let frame=0;frame<60*38;frame++) {
    fauna.updateView(new THREE.Vector3(0,1.6,0),true,1/60);fauna.update(1/60);
    if(frame%15)continue;
    for(const animal of fauna.animals) {
      const offset=measureProp(animal.root).min.y-terrain(animal.root.position.x,animal.root.position.z);
      minimum=Math.min(minimum,offset);maximum=Math.max(maximum,offset);
      if(animal.speed<.01)restMaximum=Math.max(restMaximum,offset);
    }
  }
  console.log(JSON.stringify({herdLowestSurfaceOffset:{minimum,maximum,restMaximum}}));
  assert.ok(minimum>-.08,'hooves do not sink materially below terrain');
  assert.ok(maximum<.12,'walking body stays grounded without a running flight phase');
  assert.ok(restMaximum<.09,'grazing/looking settles onto the terrain');
}));

test('herd movement resolves actual obstacles and dynamically registers all three bodies', async () => fixture(async () => {
  const { WorldCollisions }=await import('../src/worlds/WorldCollisions.ts');
  const parent=new THREE.Group(),collisions=new WorldCollisions(parent);
  collisions.addCircle({id:'trunk',x:-6.8,z:-9.3,radius:.6});
  const fauna=new ForestFauna(parent,()=>0,()=>1,collisions);await fauna.ready;
  assert.equal(collisions.size,4);
  for(let frame=0;frame<60*50;frame++) {
    fauna.updateView(new THREE.Vector3(0,1.6,0),true,1/60);fauna.update(1/60);
    for(const animal of fauna.animals) {
      const p=animal.root.position;
      assert.ok(Math.hypot(p.x+6.8,p.z+9.3)>=1.079,'animal cannot tunnel into solid trunk');
    }
  }
  assert.ok(fauna.animals[0].distanceTravelled>15,'obstacle does not leave the herd stuck');
}));

test('unavailable model settles readiness without restoring a cartoon fallback', async () => {
  const original=GLTFLoader.prototype.loadAsync;GLTFLoader.prototype.loadAsync=async()=>{throw new Error('offline');};
  try {
    const fauna=new ForestFauna(new THREE.Group(),()=>0,()=>1);await fauna.ready;
    assert.equal(fauna.status,'unavailable');assert.equal(fauna.root.children.length,0);
    fauna.updateView(new THREE.Vector3(),true,1/60);fauna.update(1/60);
  } finally {GLTFLoader.prototype.loadAsync=original;}
});

test('walking hooves hold their ground during stance and the head leads travel', async () => fixture(async () => {
  const parent = new THREE.Group();
  parent.position.set(12, 0, -7); parent.rotation.y = .8;
  const fauna = new ForestFauna(parent, () => 0, () => 1); await fauna.ready;
  const animal = fauna.animals[0];
  animal.root.rotation.y = 0;
  animal.route = [animal.root.position.clone(), animal.root.position.clone().add(new THREE.Vector3(0,0,100))];
  animal.waypoint = 1;
  const previous = new Map(); let measured = 0, worst = 0, worstCase;
  for (let frame=0; frame<600; frame++) {
    const before = animal.root.position.clone();
    fauna.updateView(parent.localToWorld(new THREE.Vector3(0,1.6,0)), true, 1/60); fauna.update(1/60);
    const head = parent.worldToLocal(animal.root.getObjectByName('Head').getWorldPosition(new THREE.Vector3()));
    const hip = parent.worldToLocal(animal.root.getObjectByName('Hip').getWorldPosition(new THREE.Vector3()));
    assert.ok(head.sub(hip).dot(animal.root.position.clone().sub(before)) >= -1e-6, 'the deer never travels hindquarters first');
    for (const leg of animal.gait.legs) {
      const point = parent.worldToLocal(leg.hoof.getWorldPosition(new THREE.Vector3()));
      const last = previous.get(leg);
      if (frame > 120 && animal.walkWeight > .999 && leg.wasStance && last?.stance) {
        const delta = point.distanceTo(last.point); if(delta>worst){worst=delta;worstCase={frame,leg:leg.hip.name,weight:animal.walkWeight,position:animal.root.position.toArray(),rest:leg.rest.toArray(),point:point.toArray(),planted:leg.planted.toArray(),rotation:animal.root.rotation.y};} measured++;
      }
      previous.set(leg, { point, stance: leg.wasStance });
    }
  }
  console.log(JSON.stringify({ plantedHoofSamples: measured, maxFrameSlipMetres: worst, worstCase }));
  assert.ok(measured > 500);
  assert.ok(worst < .002, 'stance feet must not slide with the moving torso');
}));
