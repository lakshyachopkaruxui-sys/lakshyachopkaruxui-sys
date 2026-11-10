import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { THREE } from './shadow-test-fixture.mjs';
const { HellSkyLife, HELL_SKY_LIFE_ASSET, HELL_SKY_LIFE_COUNT } = await import('../src/worlds/HellSkyLife.ts');
const assetRoot = new URL('../public/models/hell/sky-life/', import.meta.url);
const metadata = JSON.parse(readFileSync(new URL('vampire-flight.json', assetRoot), 'utf8'));
const binary = readFileSync(new URL('vampire-flight.bin', assetRoot));

function mockAssets(t) {
  t.mock.method(globalThis, 'fetch', async url => {
    const file = new URL('../public' + String(url), import.meta.url);
    return new Response(readFileSync(file));
  });
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', async () => new THREE.Texture());
}
function batch(life) { return life.root.children.find(object => object.isInstancedMesh); }
function floats(name) {
  const a = metadata.accessors[name];
  return new Float32Array(binary.buffer.slice(binary.byteOffset + a.offset, binary.byteOffset + a.offset + a.bytes));
}

test('actual CC0 bat binary preserves articulated flight, finite poses and a bounded local payload', () => {
  const source = JSON.parse(readFileSync(new URL('SOURCE.json', assetRoot), 'utf8'));
  assert.equal(source.license, 'CC0-1.0');
  assert.equal(source.author, 'rubberduck');
  assert.equal(metadata.sourceAction, 'Bat_Flying');
  assert.equal(metadata.triangles, 1700);
  assert.equal(metadata.binaryBytes, binary.length);
  assert.ok(metadata.triangles * HELL_SKY_LIFE_COUNT <= 15000);
  let total = 0;
  for (const item of source.runtimeFiles) {
    const bytes = readFileSync(new URL(item.file, assetRoot));
    assert.equal(bytes.length, item.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    total += bytes.length;
  }
  assert.ok(total < 500000, 'runtime bat data and textures must stay below 500 KB');
  const first = floats('pose0');
  let largestWingMovement = 0;
  for (let pose = 0; pose < 8; pose++) {
    const positions = floats(`pose${pose}`), normals = floats(`normal${pose}`);
    assert.equal(positions.length, metadata.vertices * 3);
    for (let i = 0; i < positions.length; i++) {
      assert.ok(Number.isFinite(positions[i]));
      largestWingMovement = Math.max(largestWingMovement, Math.abs(positions[i] - first[i]));
    }
    for (let i = 0; i < normals.length; i += 3) assert.ok(Math.abs(Math.hypot(...normals.subarray(i, i + 3)) - 1) < .015);
  }
  assert.ok(largestWingMovement > .6, 'authored wings must visibly deform, not retain the saved static preview pose');
});

test('asynchronous attachment applies current portal stencil before the one shared batch is visible', async t => {
  mockAssets(t);
  const parent = new THREE.Group();
  let layer = 1;
  const life = new HellSkyLife(parent, () => 0, () => layer);
  assert.equal(life.root.children.length, 0);
  let attached = false;
  life.root.add = function (object) {
    assert.equal(object.material.stencilRef, 0);
    assert.equal(object.material.stencilFunc, THREE.EqualStencilFunc);
    attached = true;
    return THREE.Group.prototype.add.call(this, object);
  };
  layer = 0;
  await life.ready;
  assert.equal(life.status, 'ready');
  assert.ok(attached);
  assert.equal(life.root.children.length, 1);
  const bats = batch(life);
  assert.equal(bats.count, 7);
  assert.equal(bats.geometry.groups.length, 0);
  assert.equal(bats.castShadow, false);
  assert.equal(bats.receiveShadow, false);
  assert.equal(bats.material.transparent, false);
  assert.equal(bats.geometry.morphAttributes.position.length, 8);
  assert.equal(bats.geometry.morphAttributes.normal.length, 8);
  assert.ok(bats.morphTexture, 'built-in texture-backed instanced morphs must avoid vertex attribute overflow');
  layer = 1; life.refreshStencil();
  assert.equal(bats.material.stencilRef, 1);
  assert.equal(life.budget.drawBatches, 1);
  assert.equal(life.budget.triangles, 11900);
});

test('long flight cycles stay inside fixed bounds and retain head clearance without LOD disappearance', async t => {
  mockAssets(t);
  const parent = new THREE.Group();
  const life = new HellSkyLife(parent, () => 0, () => 0);
  await life.ready;
  const bats = batch(life), positions = [], previous = [];
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), position = new THREE.Vector3();
  for (let frame = 0; frame <= 10800; frame += 4) {
    life.update(frame / 60);
    assert.equal(life.getAudioPositions(positions), 7);
    for (let i = 0; i < positions.length; i++) {
      bats.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
      assert.ok(position.distanceTo(positions[i]) < 1e-5, 'audio and rendered transform positions must agree');
      assert.ok(bats.boundingBox.containsPoint(position));
      assert.ok(position.y - .65 > 6.85, 'full downstroke must clear a high desktop eye by over four metres');
      assert.ok(Math.abs(rotation.length() - 1) < 1e-6);
      if (previous[i]) assert.ok(previous[i].distanceTo(position) < .35, 'no path-wrap teleport or abrupt movement');
      (previous[i] ??= new THREE.Vector3()).copy(position);
    }
  }
  assert.equal(bats.visible, true);
});

test('flight pose and spatial audio remain deterministic across frame schedules and world relocation', async t => {
  mockAssets(t);
  const parent = new THREE.Group(), life = new HellSkyLife(parent, () => 0, () => 0);
  await life.ready;
  const bats = batch(life), expected = new THREE.Matrix4(), actual = new THREE.Matrix4();
  const geometry = bats.geometry, array = geometry.attributes.position.array;
  life.update(42.75); bats.getMatrixAt(0, expected);
  life.update(0);
  for (let i = 0; i < 4275; i++) life.update(i / 100);
  life.update(42.75); bats.getMatrixAt(0, actual);
  assert.deepEqual(actual.elements, expected.elements);
  parent.position.set(35, 4, -12); parent.rotation.y = 1.4; parent.updateMatrixWorld(true);
  const before = []; life.getAudioPositions(before);
  life.update(42.75);
  const after = []; life.getAudioPositions(after);
  assert.ok(before.every((p, i) => p.equals(after[i])), 'audio positions must remain root-local after world alignment');
  assert.equal(bats.geometry, geometry); assert.equal(geometry.attributes.position.array, array);
  life.update(NaN); bats.getMatrixAt(0, actual); assert.deepEqual(actual.elements, expected.elements);
});

test('two wide routes inhabit the rear hemisphere at review times and sweep all basin azimuths', async t => {
  mockAssets(t);
  const life = new HellSkyLife(new THREE.Group(), () => 0, () => 0);
  await life.ready;
  const positions = [];
  for (const time of [0, 24, 45]) {
    life.update(time); life.getAudioPositions(positions);
    assert.ok(positions.slice(5).some(p => p.z > 4), `rear sky must have a readable flyer at ${time}s`);
  }
  const sectors = [new Set(), new Set()];
  const furthestRear = [-Infinity, -Infinity];
  for (let time = 0; time <= 166; time += .2) {
    life.update(time); life.getAudioPositions(positions);
    for (let i = 5; i < 7; i++) {
      const p = positions[i];
      assert.ok(p.y > 17, 'wide circuits must stay high and cannot become a close head buzz');
      assert.ok(Math.hypot(p.x, p.z) > 18, 'wide circuits must remain outside the visitor basin');
      const angle = (Math.atan2(p.x, p.z) + Math.PI * 2) % (Math.PI * 2);
      sectors[i - 5].add(Math.floor(angle / (Math.PI / 4)));
      furthestRear[i - 5] = Math.max(furthestRear[i - 5], p.z);
    }
  }
  assert.ok(sectors.every(s => s.size === 8), 'each rear route must cover all eight azimuth sectors over two cycles');
  assert.ok(furthestRear.every(z => z > 24 && z < 31), 'both circuits must reach the rear cloud field without leaving conservative bounds');
  assert.equal(life.budget.birds, 7); assert.equal(life.budget.triangles, 11900); assert.equal(life.budget.drawBatches, 1);
});

test('independent flight/glide weights stay convex and position/normal morph targets share one tiny instance texture', async t => {
  mockAssets(t);
  const life = new HellSkyLife(new THREE.Group(), () => 0, () => 0);
  await life.ready;
  const bats = batch(life), sample = new THREE.Mesh(bats.geometry), states = [];
  life.update(10.36);
  for (let i = 0; i < 7; i++) {
    bats.getMorphAt(i, sample);
    const weights = sample.morphTargetInfluences;
    assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
    assert.ok(weights.every(value => value >= 0 && value <= 1));
    states.push(weights.map(value => value.toFixed(3)).join(','));
  }
  assert.ok(new Set(states).size >= 5, 'flight phases and glides must not move in lockstep');
  assert.equal(bats.morphTexture.image.data.byteLength, 7 * 9 * 4);
});

test('optional download failure settles without visible partial creatures, new colliders or an unhandled rejection', async t => {
  mockAssets(t);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  const parent = new THREE.Group(), life = new HellSkyLife(parent, () => 0, () => 1);
  await life.ready;
  assert.equal(life.status, 'failed');
  assert.equal(life.root.children.length, 0);
  assert.equal(life.getAudioPositions([]), 0);
  assert.equal(life.budget.drawBatches, 0);
});

test('a late successful sibling texture is disposed after another texture fails', async t => {
  mockAssets(t);
  t.mock.method(console, 'warn', () => {});
  const texture = new THREE.Texture();
  let disposed = false, resolveLate;
  texture.addEventListener('dispose', () => { disposed = true; });
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', url => url.includes('normal')
    ? Promise.reject(new Error('Missing normal map'))
    : new Promise(resolve => { resolveLate = resolve; }));
  const life = new HellSkyLife(new THREE.Group(), () => 0, () => 0);
  await Promise.resolve();
  assert.equal(life.status, 'loading');
  resolveLate(texture);
  await life.ready;
  assert.equal(life.status, 'failed');
  assert.equal(disposed, true);
  assert.equal(life.root.children.length, 0);
});
