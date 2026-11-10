import assert from 'node:assert/strict';
import test from 'node:test';
import { THREE } from './shadow-test-fixture.mjs';
const { remapHellSpillCoordinates } = await import('../src/worlds/HellSpillCoordinates.ts');
const { buildHellVolcanoGeometry } = await import('../src/worlds/HellVolcanoGeometry.ts');

function strip() {
  const positions = [], uvs = [], indices = [];
  for (const [z, y] of [[0, 5], [1, 5], [1.1, 0], [2, 0]]) {
    for (let col = 0; col <= 2; col++) {
      const u = col / 2;
      positions.push((u - .5) * 2, y + (u - .5) * .6, z); uvs.push(u, z / 3);
    }
  }
  for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
    const a = row * 3 + col, b = a + 3; indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
  geometry.setAttribute('lavaLift', new THREE.Float32BufferAttribute(positions.map((_, i) => i).filter(i => i % 3 === 0).map(() => .045), 1));
  return geometry;
}

function assertForwardChart(geometry, before) {
  const uv = geometry.getAttribute('uv'), index = geometry.getIndex();
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const ab = uv.getX(b) - uv.getX(a), ac = uv.getX(c) - uv.getX(a);
    const old = ab * (before[c * 2 + 1] - before[a * 2 + 1]) - ac * (before[b * 2 + 1] - before[a * 2 + 1]);
    const current = ab * (uv.getY(c) - uv.getY(a)) - ac * (uv.getY(b) - uv.getY(a));
    if (Math.abs(old) > 1e-10) assert.ok(current * old > 0, `triangle ${i / 3} reverses its flow chart`);
  }
}

test('five-metre cliff retains five metres of texture flow instead of stretching its tiny ground footprint', () => {
  const geometry = strip(), uv = geometry.getAttribute('uv'), before = uv.array.slice();
  remapHellSpillCoordinates(geometry);
  assert.ok(Math.abs((uv.getY(7) - uv.getY(4)) * 3 - Math.hypot(5, .1)) < .002);
  assert.ok(Math.abs(uv.getY(6) - uv.getY(8)) > .1, 'side-height differences need a local surface projection');
  assert.equal(geometry.userData.spillUvBlend, 1);
  assertForwardChart(geometry, before);
});

test('UV repair changes no positions, topology, bank coordinates or existing attributes and is idempotent', () => {
  const geometry = strip(), position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const index = geometry.getIndex(), lift = geometry.getAttribute('lavaLift');
  const positions = position.array.slice(), indices = index.array.slice(), lifts = lift.array.slice();
  const banks = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
  remapHellSpillCoordinates(geometry); const once = uv.array.slice(); remapHellSpillCoordinates(geometry);
  assert.equal(geometry.getAttribute('position'), position); assert.equal(geometry.getIndex(), index);
  assert.equal(geometry.getAttribute('lavaLift'), lift); assert.deepEqual(position.array, positions);
  assert.deepEqual(index.array, indices); assert.deepEqual(lift.array, lifts); assert.deepEqual(uv.array, once);
  for (let i = 0; i < uv.count; i++) { assert.equal(uv.getX(i), banks[i]); assert.ok(Number.isFinite(uv.getY(i))); }
  assert.equal(geometry.attributes.uv.count, position.count);
});

test('actual clipped volcano overflow keeps finite forward UVs with a physical centerline metric', () => {
  const { spill } = buildHellVolcanoGeometry(4, -46, 23, 19);
  const uv = spill.getAttribute('uv'), p = spill.getAttribute('position'), index = spill.getIndex();
  const before = uv.array.slice(); remapHellSpillCoordinates(spill); assertForwardChart(spill, before);
  assert.equal(spill.userData.spillUvCenterBlend, 1, 'side constraints must not roll back the safe centerline metric');
  let exercised = 0, maximumStretch = 0;
  for (let i = 0; i < index.count; i += 3) {
    // The builder may already run the remap. Verify its final chart directly,
    // so this assertion remains meaningful after production integration.
    const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2);
    assert.ok((uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) -
      (uv.getX(ic) - uv.getX(ia)) * (uv.getY(ib) - uv.getY(ia)) > 0, `fitted flow triangle ${i / 3} must remain forward`);
    for (let j = 0; j < 3; j++) {
      const a = index.getX(i + j), b = index.getX(i + (j + 1) % 3);
      assert.ok(Number.isFinite(uv.getY(a)));
      if (Math.abs(uv.getX(a) - .5) < 1e-6 && Math.abs(uv.getX(b) - .5) < 1e-6 && Math.abs(p.getY(a) - p.getY(b)) > .1) {
        maximumStretch = Math.max(maximumStretch, Math.abs(p.getY(a) - p.getY(b)) / Math.abs(uv.getY(a) - uv.getY(b)));
        exercised++;
      }
    }
  }
  assert.ok(exercised > 10, 'exercise steep centerline segments on actual clipped facets');
  assert.ok(maximumStretch < 3.2, `surface metric stretched to ${maximumStretch} m/V`);
});
