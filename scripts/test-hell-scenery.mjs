import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { THREE, GLTFLoader, actualAsset } from './shadow-test-fixture.mjs';
const { HellScenery, HELL_CRAG_ASSET, HELL_CRAGS } = await import('../src/worlds/HellScenery.ts');
const { HELL_RIVERS } = await import('../src/worlds/HellLandscape.ts');
const { WorldCollisions } = await import('../src/worlds/WorldCollisions.ts');
const scan = await actualAsset(HELL_CRAG_ASSET);

test('actual scanned crags stay within the added geometry budget and receive the current portal stencil', async t => {
  let finish;
  let layer = 1;
  t.mock.method(GLTFLoader.prototype, 'loadAsync', url => {
    assert.equal(url, HELL_CRAG_ASSET);
    return new Promise(resolve => { finish = resolve; });
  });
  const parent = new THREE.Group(), collisions = new WorldCollisions(parent);
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const scenery = new HellScenery(parent, () => 0, () => layer, collisions, material, HELL_RIVERS);
  assert.equal(scenery.status, 'loading');
  assert.equal(scenery.root.getObjectByName('Three photographed volcanic crags'), undefined);
  layer = 2;
  finish(scan);
  await scenery.ready;
  assert.equal(scenery.status, 'ready');
  const crags = scenery.root.getObjectByName('Three photographed volcanic crags');
  assert.equal(crags.count, 3);
  assert.equal(crags.geometry.index.count / 3, 20174);
  assert.equal(crags.geometry.index.count / 3 * crags.count, 60522);
  let triangles = 0, draws = 0;
  scenery.root.traverse(node => {
    assert.equal(node.isLight, undefined, 'scenery must not introduce lighting passes');
    if (!node.isMesh) return;
    draws++;
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 * node.count;
    assert.equal(node.isInstancedMesh, true);
    assert.equal(node.castShadow, false);
    assert.equal(node.receiveShadow, false);
    assert.equal(node.material.transparent, false);
    assert.equal(node.material.stencilRef, 2);
    assert.equal(node.material.stencilFunc, THREE.EqualStencilFunc);
    assert.ok(node.boundingSphere.radius > 0 && Number.isFinite(node.boundingSphere.radius));
  });
  assert.equal(draws, 3);
  assert.ok(triangles <= 80000, triangles);
  assert.ok(triangles > 60522, 'bank and crust detail must be included in the total');
  assert.equal(scenery.root.getObjectByName('Raised broken lava levees').material.map, material.map,
    'bank detail reuses the existing texture rather than loading a duplicate');
  assert.deepEqual(scenery.root.userData.budget, { triangles, draws, scannedCrags: 3,
    textureMiBWithMipmaps: 16, addedShadowPasses: 0, sourceLicense: 'CC0-1.0', status: 'ready' });
  mkdirSync(new URL('../validation/hell-refinement-2026-11-09/', import.meta.url), {recursive: true});
  writeFileSync(new URL('../validation/hell-refinement-2026-11-09/scenery-budget.json', import.meta.url),
    JSON.stringify({ ...scenery.root.userData.budget, scope: 'CPU mesh/asset budget, not a GPU or headset frame-rate measurement.' }, null, 2));
});

test('scanned rock footprints block their visible masses while arrival and the central approach stay open', async t => {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => scan);
  const parent = new THREE.Group(), collisions = new WorldCollisions(parent);
  const heightAt = (x, z) => x * .02 + z * .015;
  const scenery = new HellScenery(parent, heightAt, () => 1, collisions, undefined, HELL_RIVERS);
  await scenery.ready;
  for (const crag of HELL_CRAGS) {
    assert.equal(collisions.queryLocal(crag.x, crag.z, .3, 1.7, heightAt(crag.x, crag.z)), true);
  }
  for (const x of [-3, 0, 3]) for (const z of [2, -2, -6, -10]) {
    assert.equal(collisions.queryLocal(x, z, .3, 1.7, heightAt(x, z)), false, `arrival/approach ${x},${z}`);
  }
  const crags = scenery.root.getObjectByName('Three photographed volcanic crags');
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  const p = crags.geometry.attributes.position;
  for (let i = 0; i < crags.count; i++) {
    crags.getMatrixAt(i, matrix);
    let lowest = Infinity;
    for (let j = 0; j < p.count; j++) {
      point.fromBufferAttribute(p, j).applyMatrix4(matrix);
      lowest = Math.min(lowest, point.y - heightAt(point.x, point.z));
    }
    assert.ok(lowest < -.18 && lowest > -.6, `crag ${i} is buried rather than floating: ${lowest}`);
  }
  // Collision coordinates remain in the owning world's frame after portal alignment.
  parent.position.set(70, 0, -30); parent.rotation.y = .7; parent.updateMatrixWorld(true);
  const local = new THREE.Vector3(HELL_CRAGS[0].x, heightAt(HELL_CRAGS[0].x, HELL_CRAGS[0].z), HELL_CRAGS[0].z);
  assert.equal(collisions.queryWorld(parent.localToWorld(local), .3), true);
});

test('failed optional scan leaves cooled riverbanks and entry ready without invisible crag obstacles', async t => {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => { throw new Error('offline'); });
  const parent = new THREE.Group(), collisions = new WorldCollisions(parent);
  const scenery = new HellScenery(parent, () => 0, () => 1, collisions, undefined, HELL_RIVERS);
  const initialObstacles = collisions.size;
  await assert.doesNotReject(scenery.ready);
  assert.equal(scenery.status, 'fallback');
  assert.equal(scenery.root.getObjectByName('Three photographed volcanic crags'), undefined);
  assert.ok(scenery.root.getObjectByName('Raised broken lava levees'));
  assert.ok(scenery.root.getObjectByName('Black cooled crust rafts'));
  assert.equal(collisions.size, initialObstacles);
  assert.equal(collisions.queryLocal(0, 2, .3), false);
  assert.equal(scenery.root.userData.budget.scannedCrags, 0);
  assert.equal(scenery.root.userData.budget.textureMiBWithMipmaps, 0);
});

test('bundled scan retains verified source geometry, three 1K maps and CC0 provenance', () => {
  const root = new URL('../public/models/hell/rock-face-01/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('SOURCE-MANIFEST.json', root), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.author, 'Dario Barresi');
  assert.equal(manifest.source, 'https://polyhaven.com/a/rock_face_01');
  assert.equal(manifest.files.length, 5);
  let bytes = 0;
  for (const file of manifest.files) {
    const data = readFileSync(new URL(file.path, root));
    assert.equal(data.length, file.bytes);
    for (const algorithm of ['md5', 'sha256']) {
      assert.equal(createHash(algorithm).update(data).digest('hex'), file[algorithm]);
    }
    assert.equal(new URL(file.url).hostname, 'dl.polyhaven.org');
    bytes += data.length;
  }
  assert.ok(bytes < 3.1e6);
  const model = JSON.parse(readFileSync(new URL('rock_face_01_1k.gltf', root), 'utf8'));
  assert.equal(model.meshes.length, 1);
  assert.equal(model.materials.length, 1);
  assert.equal(model.images.length, 3);
  assert.ok(model.images.every(image => /_1k\.jpg$/.test(image.uri)));
  assert.equal(model.accessors[model.meshes[0].primitives[0].indices].count / 3, 20174);
});
