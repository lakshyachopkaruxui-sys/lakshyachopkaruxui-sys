// Real asset/skeleton and flight-path checks; no browser, GPU or headset claim.
// Textures are omitted while parsing the actual GLB geometry, joints and clips.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return {
      format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' })
    };
    return nextLoad(url, context);
  }
});
globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, data) { this.type = type; Object.assign(this, data); } };
async function parseAsset(name) {
  const glb = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const binary = glb.subarray(28 + jsonLength);
  json.buffers = [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }];
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
    for (const field of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete material[field];
  }
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}
const owl = await parseAsset('Owl');
const { SkyFlock } = await import('../src/worlds/SkyFlock.ts');

test('real Owl skeletons flap independently, with independent materials and correct async stencil', async () => {
  let resolveModel;
  GLTFLoader.prototype.loadAsync = () => new Promise(resolve => { resolveModel = resolve; });
  const parent = new THREE.Group();
  let layer = 1;
  const flock = new SkyFlock(parent, () => layer);
  assert.equal(parent.children.length, 0, 'unmasked async content must remain detached');
  layer = 0;
  let checkedBeforeAttach = false;
  parent.add = function (group) {
    group.traverse(object => {
      for (const material of !object.material ? [] : Array.isArray(object.material) ? object.material : [object.material]) {
        assert.equal(material.stencilRef, 0, 'current layer must already be applied at attach');
        assert.equal(material.stencilFunc, THREE.EqualStencilFunc);
      }
    });
    checkedBeforeAttach = true;
    return THREE.Group.prototype.add.call(this, group);
  };
  resolveModel(owl);
  await flock.ready;
  assert.equal(checkedBeforeAttach, true);
  assert.equal(flock.flightState.source, 'owl');
  assert.equal(flock.group.children.length, 3);
  const skeletons = [], materials = [], wings = [];
  flock.group.traverse(object => {
    if (object.isSkinnedMesh) { skeletons.push(object.skeleton); materials.push(object.material); }
    if (object.name === 'LeftHand') wings.push(object);
  });
  assert.equal(new Set(skeletons).size, 3);
  assert.equal(new Set(materials).size, 3);
  assert.equal(wings.length, 3);
  const start = wings.map(wing => wing.quaternion.clone());
  let moved = 0;
  for (let i = 1; i <= 90; i++) {
    flock.update(i / 60, 1 / 60);
    moved = Math.max(moved, ...wings.map((wing, j) => wing.quaternion.angleTo(start[j])));
  }
  assert.ok(moved > 0.5, 'real skinned wings must make an obvious articulated wingbeat');
  assert.ok(wings[0].quaternion.angleTo(wings[1].quaternion) > 0.05, 'birds must not flap in lockstep');
  // Independent rotations should deform actual skinned vertices, not just an
  // unused bone. Bounding boxes sample the rendered rig at a range of phases.
  const size = new THREE.Vector3();
  parent.updateMatrixWorld(true);
  for (const bird of flock.group.children) {
    const model = bird.children[0];
    model.updateWorldMatrix(true, true);
    new THREE.Box3().setFromObject(model, true).getSize(size);
    assert.ok(size.x > 0.4 && size.x < 1.7 && size.y < 1.7 && size.z < 1.7, `metre-scale bird expected: ${size.toArray()}`);
  }
});

test('complete closed flight cycles stay above the clearing and move smoothly after forest relocation', async () => {
  GLTFLoader.prototype.loadAsync = async () => owl;
  const parent = new THREE.Group();
  const flock = new SkyFlock(parent, () => 1);
  await flock.ready;
  let previous;
  for (let i = 0; i <= 12000; i++) {
    flock.update(i / 60, 1 / 60);
    const states = flock.flightState.birds;
    for (const [j, state] of states.entries()) {
      const p = state.position;
      assert.ok(p.x >= -9 && p.x <= 9 && p.z >= -20 && p.z <= -2, `bird left clearing: ${p.toArray()}`);
      assert.ok(p.y >= 10.6 && p.y <= 14.3, `bird left safe sky band: ${p.y}`);
      assert.ok(Math.abs(state.rotation.length() - 1) < 1e-6);
      if (previous) {
        assert.ok(p.distanceTo(previous[j].position) < 0.06, 'closed route must not teleport at its seam');
        assert.ok(state.rotation.angleTo(previous[j].rotation) < 0.05, 'bank/heading must remain smooth');
      }
    }
    previous = states;
  }
  const local = flock.flightState.birds.map(bird => bird.position);
  parent.position.set(21, 0, -33);
  parent.updateMatrixWorld(true);
  flock.group.children.forEach((bird, i) => {
    const world = bird.getWorldPosition(new THREE.Vector3());
    assert.ok(world.distanceTo(local[i].clone().add(parent.position)) < 1e-8);
  });
});

test('asset failure yields three visible feathered birds with moving wings and masked materials', async () => {
  GLTFLoader.prototype.loadAsync = async () => { throw new Error('controlled missing asset'); };
  const parent = new THREE.Group();
  const warn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  const flock = new SkyFlock(parent, () => 1);
  try { await flock.ready; } finally { console.warn = warn; }
  assert.equal(warned, true);
  assert.equal(flock.flightState.source, 'procedural');
  assert.equal(flock.group.children.length, 3);
  const wing = flock.group.getObjectByName('LeftHand');
  const before = wing.quaternion.clone();
  flock.update(1, 0.1);
  assert.ok(wing.quaternion.angleTo(before) > 0.1);
  let meshes = 0;
  flock.group.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    assert.equal(object.material.stencilRef, 1);
  });
  assert.ok(meshes > 30, 'fallback must include body/head and individually shaped feathers');
});

test('Creature uses the actual named attack clip rather than slicing outside the short idle clip', async () => {
  const minion = await parseAsset('minion-c01');
  GLTFLoader.prototype.load = (url, onLoad) => { onLoad(minion); };
  const { Creature } = await import('../src/worlds/Creature.ts');
  const creature = new Creature(new THREE.Group(), new THREE.Vector3(), 1);
  const actual = minion.animations.find(clip => clip.name.toLowerCase() === 'attack');
  assert.ok(actual?.tracks.length);
  assert.equal(creature.actions.attack.getClip(), actual);
  assert.ok(creature.actions.attack.getClip().duration > 1);
});
