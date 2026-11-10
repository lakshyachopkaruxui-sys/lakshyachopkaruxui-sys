import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { THREE, GLTFLoader, actualAsset } from './shadow-test-fixture.mjs';
const { HellRelics, HELL_RELIC_ASSETS, HELL_ROOTS, HELL_REMAINS, HELL_DEAD_TREES } = await import('../src/worlds/HellRelics.ts');
const { WorldCollisions } = await import('../src/worlds/WorldCollisions.ts');
const { SHADOW_PATROL_ROUTES } = await import('../src/worlds/ShadowFauna.ts');
const assets = new Map(await Promise.all(Object.values(HELL_RELIC_ASSETS).map(async path => [path, await actualAsset(path)])));

function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  for (let offset = 2; offset < bytes.length;) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    offset += length;
  }
  throw new Error('No JPEG dimensions');
}

function webpDimensions(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  for (let offset = 12; offset + 8 < bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), data = offset + 8;
    if (kind === 'VP8 ') return [bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff];
    if (kind === 'VP8L') { const dimensions = bytes.readUInt32LE(data + 1); return [(dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1]; }
    if (kind === 'VP8X') return [bytes.readUIntLE(data + 4, 3) + 1, bytes.readUIntLE(data + 7, 3) + 1];
    offset += 8 + length + (length % 2);
  }
  throw new Error('No WebP dimensions');
}

test('relic binaries retain finite geometry, checked 1K images and explicit source provenance', () => {
  const kits = [
    ['dead-quiver-branch-01', 'branch', 3994],
    ['weathered-skull', 'skull', 6942]
  ];
  for (const [folder, name, triangles] of kits) {
    const root = new URL(`../public/models/hell/${folder}/`, import.meta.url);
    const source = JSON.parse(readFileSync(new URL('SOURCE-MANIFEST.json', root), 'utf8'));
    const balanced = JSON.parse(readFileSync(new URL('BALANCED.json', root), 'utf8'));
    const model = JSON.parse(readFileSync(new URL(`${name}.gltf`, root), 'utf8'));
    assert.equal(source.license, 'CC0-1.0');
    assert.equal(model.meshes.length, 1); assert.equal(model.materials.length, 1);
    assert.equal(model.meshes[0].primitives.length, 1);
    const primitive = model.meshes[0].primitives[0];
    assert.equal(model.accessors[primitive.indices].count / 3, triangles);
    assert.equal(balanced.runtimeTriangles, triangles);
    for (const file of balanced.files) {
      const bytes = readFileSync(new URL(file.file, root));
      assert.equal(bytes.length, file.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
    for (const image of model.images) assert.deepEqual(jpegDimensions(readFileSync(new URL(image.uri, root))), [1024, 1024]);
    const geometry = assets.get(HELL_RELIC_ASSETS[name === 'branch' ? 'roots' : 'remains']).scene.children[0].geometry;
    for (const attribute of Object.values(geometry.attributes)) {
      for (const value of attribute.array ?? attribute.data.array) assert.ok(Number.isFinite(value));
    }
    for (const index of geometry.index.array) assert.ok(index < geometry.attributes.position.count);
    if (name === 'branch') {
      for (const file of source.files) {
        const bytes = readFileSync(new URL(file.file, root));
        for (const hash of ['md5', 'sha256']) assert.equal(createHash(hash).update(bytes).digest('hex'), file[hash]);
      }
    } else {
      assert.equal(source.origin.aiContent, true);
      assert.match(readFileSync(new URL('LICENSE.txt', root), 'utf8'), /AI-assisted/);
      for (const image of balanced.unchangedImages) {
        assert.equal(createHash('sha256').update(readFileSync(new URL(image.file, root))).digest('hex'), image.sha256);
      }
      assert.equal(model.materials[0].normalTexture, undefined, 'do not invent a normal map absent from the source binary');
    }
  }
  const root = new URL('../public/models/hell/skeletal-dead-tree/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('SOURCE-MANIFEST.json', root), 'utf8'));
  const raw = readFileSync(new URL(manifest.file.path, root)), jsonLength = raw.readUInt32LE(12);
  const doc = JSON.parse(raw.subarray(20, 20 + jsonLength)), binary = raw.subarray(28 + jsonLength);
  assert.equal(manifest.license, 'CC0-1.0'); assert.match(manifest.origin, /Procedural/);
  assert.equal(raw.length, manifest.file.bytes);
  assert.equal(createHash('sha256').update(raw).digest('hex'), manifest.file.sha256);
  assert.equal(doc.meshes.length, 1); assert.equal(doc.materials.length, 1); assert.equal(doc.images.length, 3);
  for (const image of doc.images) {
    const view = doc.bufferViews[image.bufferView];
    assert.deepEqual(webpDimensions(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)), [512, 512]);
  }
  const tree = assets.get(HELL_RELIC_ASSETS.trees).scene.children[0].geometry;
  assert.equal(tree.index.count / 3, 3608);
  assert.ok(tree.attributes.position.isInterleavedBufferAttribute, 'exercise actual interleaved source geometry');
  for (const attribute of Object.values(tree.attributes)) for (const value of attribute.array ?? attribute.data.array) assert.ok(Number.isFinite(value));
  for (const index of tree.index.array) assert.ok(index < tree.attributes.position.count);
});

test('fallen wood, remains and skeletal trees share three batches and acquire the current layer after asynchronous loading', async t => {
  const finishes = new Map(); let layer = 1;
  t.mock.method(GLTFLoader.prototype, 'loadAsync', url => new Promise(resolve => finishes.set(url, resolve)));
  const parent = new THREE.Group(), collisions = new WorldCollisions(parent);
  const relics = new HellRelics(parent, () => 0, () => layer, collisions);
  assert.equal(relics.status, 'loading'); assert.equal(collisions.size, 0);
  layer = 2;
  for (const [url, resolve] of finishes) resolve(assets.get(url));
  await relics.ready;
  assert.equal(relics.status, 'ready');
  assert.deepEqual(relics.assetStatus, { roots: 'ready', remains: 'ready', trees: 'ready' });
  let draws = 0, triangles = 0, instances = 0;
  relics.root.traverse(object => {
    assert.equal(object.isLight, undefined);
    if (!object.isMesh) return;
    draws++; assert.equal(object.isInstancedMesh, true);
    assert.equal(object.count, object.userData.source === HELL_RELIC_ASSETS.trees ? 2 : 3);
    instances += object.count;
    assert.equal(object.castShadow, false); assert.equal(object.receiveShadow, false);
    assert.equal(object.material.transparent, false); assert.equal(object.material.stencilRef, 2);
    assert.equal(object.material.stencilFunc, THREE.EqualStencilFunc);
    triangles += object.geometry.index.count / 3 * object.count;
  });
  assert.equal(draws, 3); assert.equal(triangles, 40024); assert.equal(instances, 8); assert.equal(collisions.size, 8);
  assert.deepEqual(relics.root.userData.budget, { triangles, draws, addedLights: 0, addedShadowPasses: 0, status: 'ready' });
  mkdirSync(new URL('../validation/hell-depth-2026-11-09/', import.meta.url), {recursive: true});
  writeFileSync(new URL('../validation/hell-depth-2026-11-09/relic-budget.json', import.meta.url),
    JSON.stringify({ ...relics.root.userData.budget, scope: 'Actual mesh budget; not GPU or headset FPS.' }, null, 2));
});

test('relic bases seat on uneven terrain, visible masses collide and arrival plus full patrols stay clear', async t => {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => assets.get(url));
  const parent = new THREE.Group(), collisions = new WorldCollisions(parent);
  const ground = (x, z) => x * .023 - z * .018 + .035 * Math.sin(x * .7 + z * .3);
  const relics = new HellRelics(parent, ground, () => 1, collisions); await relics.ready;
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  for (const mesh of relics.root.children) {
    const p = mesh.geometry.attributes.position;
    for (let instance = 0; instance < mesh.count; instance++) {
      const placement = mesh.userData.placements[instance]; mesh.getMatrixAt(instance, matrix);
      assert.equal(collisions.queryLocal(placement.x, placement.z, .25, 1.7, ground(placement.x, placement.z)), true);
      let rootSamples = 0, maximum = -Infinity, minimum = Infinity, low = Infinity;
      for (let i = 0; i < p.count; i++) { point.fromBufferAttribute(p, i).applyMatrix4(matrix); low = Math.min(low, point.y); }
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i).applyMatrix4(matrix);
        if (point.y > low + Math.min(.08, placement.height * .12) + 1e-6) continue;
        const clearance = point.y - ground(point.x, point.z);
        maximum = Math.max(maximum, clearance); minimum = Math.min(minimum, clearance); rootSamples++;
      }
      assert.ok(rootSamples > 0); assert.ok(maximum < -.005, `base floats ${maximum}`);
      assert.ok(minimum > -placement.height * .25 - .1, `excessive burial ${minimum}`);
    }
  }
  for (const x of [-1.5, 0, 1.5]) for (const z of [2, 0, -2]) {
    assert.equal(collisions.queryLocal(x, z, .4, 1.7, ground(x, z)), false, `arrival ${x},${z}`);
  }
  const blockedPatrol = [];
  for (const route of SHADOW_PATROL_ROUTES) for (let segment = 0; segment < route.length; segment++) {
    const a = route[segment], b = route[(segment + 1) % route.length];
    for (let step = 0; step <= 30; step++) {
      const x = THREE.MathUtils.lerp(a[0], b[0], step / 30), z = THREE.MathUtils.lerp(a[1], b[1], step / 30);
      const obstacleIds = [['roots', HELL_ROOTS], ['remains', HELL_REMAINS], ['trees', HELL_DEAD_TREES]]
        .flatMap(([kind, placements]) => placements.map((_, index) => `hell-relic-${kind}-${index}`));
      const hits = obstacleIds.filter(id => collisions.queryLocal(x, z, .7, 2.5, ground(x, z), new Set(obstacleIds.filter(other => other !== id))));
      if (collisions.queryLocal(x, z, .7, 2.5, ground(x, z))) blockedPatrol.push({ x, z, hits });
    }
  }
  assert.deepEqual(blockedPatrol, [], 'Every creature patrol segment must remain clear for a0.70m body radius');
  parent.position.set(47, 0, -19); parent.rotation.y = .8; parent.updateMatrixWorld(true);
  const placement = HELL_ROOTS[0];
  const local = new THREE.Vector3(placement.x, ground(placement.x, placement.z), placement.z);
  assert.equal(collisions.queryWorld(parent.localToWorld(local), .3), true, 'aligned portal keeps collision coordinates local');
});

test('one missing relic kit preserves the other without adding invisible colliders', async t => {
  for (const failingKind of ['roots', 'remains', 'trees']) {
    const mock = t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
      if (url === HELL_RELIC_ASSETS[failingKind]) throw new Error('offline');
      return assets.get(url);
    });
    const parent = new THREE.Group(), collisions = new WorldCollisions(parent), registered = [];
    const originalAdd = collisions.addPolygon.bind(collisions);
    t.mock.method(collisions, 'addPolygon', shape => { registered.push(shape.id); originalAdd(shape); });
    const relics = new HellRelics(parent, () => 0, () => 1, collisions);
    await assert.doesNotReject(relics.ready);
    assert.equal(relics.status, 'fallback'); assert.equal(relics.assetStatus[failingKind], 'fallback');
    assert.equal(relics.root.children.length, 2); assert.equal(collisions.size, failingKind === 'trees' ? 6 : 5);
    assert.ok(relics.root.children.every(mesh => mesh.userData.source !== HELL_RELIC_ASSETS[failingKind]));
    assert.ok(registered.every(id => !id.startsWith(`hell-relic-${failingKind}-`)), 'failed kit must not register invisible colliders');
    mock.mock.restore();
  }
});
