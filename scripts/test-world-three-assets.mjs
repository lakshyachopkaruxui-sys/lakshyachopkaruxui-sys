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
const jelly = await parseAsset('Jellyfish');
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
globalThis.document = { createElement() { return { width: 64, height: 64, getContext() { return { createRadialGradient() { return { addColorStop() {} }; }, fillRect() {}, set fillStyle(value) {} }; } }; } };
const { measureProp } = await import('../src/worlds/props.ts');
const { WorldThree } = await import('../src/worlds/WorldThree.ts');

function prepare() {
  GLTFLoader.prototype.load = (url, onLoad, _onProgress, onError) => {
    queueMicrotask(() => {
      if (url.endsWith('/Jellyfish.glb')) onLoad(jelly);
      else onError?.(new Error('Unexpected asset: ' + url));
    });
  };
  return new WorldThree(new THREE.Vector3(0, 1.35, -1.1));
}

test('six actual jellyfish have independent bones/materials, original idle clips and metre-scale motion', async () => {
  const world = prepare();
  world.stencilLayer = 0;
  const add = world.root.add;
  let checked = 0;
  world.root.add = function (group) {
    if (group.name === 'original floating jellyfish') {
      group.traverse(object => {
        if (object.isMesh) { assert.equal(object.material.stencilRef, 0, 'current stencil must be set before attachment'); checked++; }
      });
    }
    return add.call(this, group);
  };
  await world.ready;
  assert.equal(world.jellies.length, 6);
  assert.equal(checked, 6);
  const skeletons = [], materials = [];
  for (const j of world.jellies) j.root.traverse(object => {
    if (object.isSkinnedMesh) { skeletons.push(object.skeleton); materials.push(object.material); }
  });
  assert.equal(new Set(skeletons).size, 6);
  assert.equal(new Set(materials).size, 6);
  for (const material of materials) {
    assert.equal(material.color.getHex(), 0xffffff);
    assert.equal(material.emissive.getHex(), 0xffffff);
    assert.equal(material.map, null, 'coloured source atlas cannot tint the white jellyfish');
    assert.equal(material.emissiveMap, null);
    assert.equal(material.vertexColors, false);
    assert.ok(material.emissiveIntensity > 0.5 && material.emissiveIntensity < 1);
  }
  const bones = skeletons.map(s => s.bones.find(b => b.name === 'Head'));
  const initial = bones.map(b => b.quaternion.clone());
  let maximumSize = 0, motion = 0;
  for (let t = 0; t <= 16; t += 0.23) {
    world.update(t, 0);
    world.scene.updateMatrixWorld(true);
    for (const [i, j] of world.jellies.entries()) {
      const size = measureProp(j.model).getSize(new THREE.Vector3());
      maximumSize = Math.max(maximumSize, size.x, size.y, size.z);
      assert.ok(Math.max(size.x, size.y, size.z) > 1.2, 'jelly must be readable at intended distance');
      assert.ok(Math.max(size.x, size.y, size.z) < 2.9, `animation must not restore hundreds-unit dimensions: ${size.toArray()}`);
      assert.ok(j.root.position.y > 3.7 && j.root.position.y < 15, 'floating route remains above the player');
      motion = Math.max(motion, bones[i].quaternion.angleTo(initial[i]));
    }
  }
  assert.ok(motion > 0.03, 'the actual idle animation must articulate the rig');
  console.log(JSON.stringify({ actualJellyfishCount: 6, maximumAnimatedDimension: maximumSize, maxHeadRotationRadians: motion }));
});

test('unknown shadow creature keeps a faint silhouette and two visible eye accents without an external model', async () => {
  const world = prepare();
  await world.ready;
  const model = world.watcher.root.getObjectByName('unknown shadow creature');
  assert.ok(model, 'the observer has a complete original silhouette');
  const box = measureProp(model);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.y > 0.8 && size.y < 2.7 && size.x < 1.4, `bounded silhouette: ${size.toArray()}`);
  let bodyMeshes = 0;
  model.traverse(object => {
    if (!object.isMesh) return;
    bodyMeshes++;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      assert.ok(Math.max(material.color.r, material.color.g, material.color.b) < 0.03, 'body remains a dark silhouette');
      assert.equal(material.stencilRef, world.stencilLayer);
    }
  });
  assert.ok(bodyMeshes >= 2);
  const eyes = [];
  world.watcher.root.traverse(object => { if (object.name === 'watcher pale eye') eyes.push(object); });
  assert.equal(eyes.length, 2);
  for (const eye of eyes) {
    assert.ok(Math.min(eye.material.color.r, eye.material.color.g, eye.material.color.b) > 0.5);
    assert.equal(eye.material.depthTest, true, 'cover can hide eyes; no x-ray gaze');
  }
  assert.equal(world.watcher.root.visible, false, 'the observer remains hidden before entering violet');
});

test('upward stars retain a fixed budget and actually rise without unbounded growth', async () => {
  const world = prepare(); await world.ready;
  const stars = world.root.getObjectByName('stars falling upward');
  assert.ok(stars?.isPoints);
  assert.equal(stars.geometry.attributes.position.count, 450);
  world.update(10, 0);
  const before = Array.from(stars.geometry.attributes.position.array);
  world.update(10.1, 0);
  const after = stars.geometry.attributes.position.array;
  let rose = 0;
  for (let i = 0; i < 450; i++) {
    const y = after[i * 3 + 1], old = before[i * 3 + 1];
    assert.ok(y >= -8 && y <= 20);
    if (y >= old) rose++;
  }
  assert.ok(rose > 440, 'almost all stars rise; only a bounded off-screen wrap may descend');
});
